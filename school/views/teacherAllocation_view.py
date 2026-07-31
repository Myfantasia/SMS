from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import IsAuthenticated
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from django.db import transaction
from django.db.models import Count
from django.core.exceptions import ValidationError
from django.core.cache import cache
from school.models.classSubjects_models import SubjectQuota, SubjectAllocation, ClassStream, Subject, GradeLevel, \
    SubjectSplittingRule, StudentSubjectEnrollment, GlobalAllocationPolicy, SystemAuditLog, SubjectBlock, \
    get_effective_is_core
from school.models.models import (
    TeacherExtra, ExamTerm, AcademicYear, AttendanceSession
)
from school.models.timetable_models import LessonAllocation, Timetable
from school.utils import build_grade_subject_block_map, get_subject_block_names, is_tech_subject, \
    AllocationValidator, reserve_class_teacher_slot, fill_remaining_subjects, get_cached_unscheduled_errors, \
    get_subjects_with_active_virtual_groups, get_published_classroom_ids, publish_allocation, unpublish_allocation
from school.views.views_timetable import sync_timetable_with_allocation_changes
from django.views.decorators.csrf import csrf_exempt
from django.shortcuts import get_object_or_404
from django.http import JsonResponse
import json
import math
import random
from school.decorators import require_permission
from school.rbac import HasModulePermission
from school.jobs import dispatch_background_job
from school.tasks import rollover_allocations_task, bulk_auto_allocate_task


class CsrfExemptSessionAuthentication(SessionAuthentication):
    def enforce_csrf(self, request):
        return


class AllocationMatrixAPIView(APIView):
    authentication_classes = [CsrfExemptSessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'allocations.view'
    rbac_edit_permission = 'allocations.edit'

    def get(self, request):
        """
        Fetches the complete subject layout for a class and lists all eligible teachers.
        """
        class_id = request.query_params.get('class_id')
        term_id = request.query_params.get('term_id')
        year_id = request.query_params.get('year_id')

        if not all([class_id, term_id, year_id]):
            return Response({"error": "Missing ID parameters."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            classroom = get_object_or_404(ClassStream, id=class_id)
            year_obj = get_object_or_404(AcademicYear, id=year_id)
            term_obj = get_object_or_404(ExamTerm, id=term_id)
            policy = GlobalAllocationPolicy.load()

            class_subjects = []
            # Subjects in this grade already routed through virtual elective split groups —
            # a physical stream never gets its own direct contract for these (the group IS the
            # teaching unit), but hiding them from the matrix entirely used to read as "nothing
            # was allocated" when really they just need to be staffed from the Elective Groups
            # view instead. Surfacing them here with their own group-staffing status closes that
            # gap directly.
            split_subject_ids = set()

            if classroom.is_virtual:
                subject_name = classroom.name.split(' - ')[0].strip()
                target_subject = Subject.objects.filter(name__iexact=subject_name).first()
                if target_subject:
                    class_subjects.append(target_subject)
            else:
                split_subject_ids = get_subjects_with_active_virtual_groups(classroom.grade_id)
                quotas = SubjectQuota.objects.filter(grade=classroom.grade).select_related('subject') \
                    .order_by('subject__display_order', 'subject__name')

                if quotas.exists():
                    for quota in quotas:
                        class_subjects.append(quota.subject)
                else:
                    class_subjects = list(Subject.objects.all().order_by('display_order', 'name'))

            # For every split subject on this physical stream, look up its live groups in this
            # grade and how many already have a real teacher contract for this term/year, so the
            # matrix can show "1 of 2 groups staffed" instead of a bare unassigned dropdown.
            group_status_by_subject = {}
            if not classroom.is_virtual and split_subject_ids:
                grade_virtual_streams = list(
                    ClassStream.live.filter(grade_id=classroom.grade_id, is_virtual=True)
                )
                staffed_group_ids = set(SubjectAllocation.objects.filter(
                    classroom__in=grade_virtual_streams, term=term_obj, academic_year=year_obj, is_active=True
                ).values_list('classroom_id', flat=True))
                subject_names_by_id = {
                    s.id: s.name.lower() for s in Subject.objects.filter(id__in=split_subject_ids)
                }
                groups_by_subject_name = {}
                for s in grade_virtual_streams:
                    groups_by_subject_name.setdefault(s.name.split(' - Group')[0].strip().lower(), []).append(s)
                for subject_id, subject_name_lower in subject_names_by_id.items():
                    subject_groups = groups_by_subject_name.get(subject_name_lower, [])
                    staffed = sum(1 for s in subject_groups if s.id in staffed_group_ids)
                    group_status_by_subject[subject_id] = f"{staffed} of {len(subject_groups)} group{'s' if len(subject_groups) != 1 else ''} staffed"

            block_map = build_grade_subject_block_map(grade_ids=[classroom.grade_id])
            block_names = get_subject_block_names(block_map.values())

            existing_allocations = SubjectAllocation.objects.filter(
                classroom=classroom, term=term_obj, academic_year=year_obj, is_active=True
            ).values('subject_id', 'teacher_id')
            allocation_map = {alloc['subject_id']: alloc['teacher_id'] for alloc in existing_allocations}

            all_active_allocations = SubjectAllocation.objects.filter(
                term=term_obj, academic_year=year_obj, is_active=True
            ).select_related('subject', 'classroom__grade')

            load_map = {}
            visual_shared_blocks = {}

            # ✅ ADDED: A tracker specifically for how many streams a teacher has PER SUBJECT
            teacher_subject_stream_counts = {}

            # All-grades block map (this loop spans every grade's allocations, not just the
            # current classroom's) — the real, authoritative signal for "does teaching this
            # subject to a second stream cost nothing extra", matching AllocationValidator.
            # is_tech_subject() alone flags every Technical-department subject as "shared"
            # regardless of whether that grade has a block configured, which understates a
            # teacher's real displayed load for any unblocked Technical assignment.
            all_grades_block_map = build_grade_subject_block_map()

            for alloc in all_active_allocations:
                t_id = alloc.teacher_id
                s_id = alloc.subject_id
                g_id = alloc.classroom.grade_id

                # ✅ ADDED: Increment the specific subject footprint for this teacher
                teacher_subject_stream_counts[(t_id, s_id)] = teacher_subject_stream_counts.get((t_id, s_id), 0) + 1

                sub_name_lower = alloc.subject.name.lower() if alloc.subject else ""
                is_pe = 'physical education' in sub_name_lower or sub_name_lower == 'pe' or sub_name_lower == 'p.e.'
                is_shared_block = (
                    all_grades_block_map.get((g_id, s_id)) is not None
                    or getattr(alloc.subject, 'allows_multiclass', False)
                    or is_pe
                )

                if is_shared_block:
                    block_key = (g_id, s_id)
                    t_memory = visual_shared_blocks.setdefault(t_id, set())
                    if block_key not in t_memory:
                        load_map[t_id] = load_map.get(t_id, 0) + 1
                        t_memory.add(block_key)
                else:
                    load_map[t_id] = load_map.get(t_id, 0) + 1

            active_teachers = TeacherExtra.objects.filter(status=True).select_related('user')

            # Single source of truth for eligibility (see TeacherExtra.qualified_subjects) —
            # one bulk query instead of per-subject/per-teacher string matching.
            class_subject_ids = [s.id for s in class_subjects]
            teacher_qualified_map = {}
            for row in TeacherExtra.objects.filter(
                    status=True, qualified_subjects__id__in=class_subject_ids
            ).values('id', 'qualified_subjects__id'):
                teacher_qualified_map.setdefault(row['id'], set()).add(row['qualified_subjects__id'])

            matrix_data = []
            for subject in class_subjects:
                eligible_teachers = []
                for teacher in active_teachers:
                    if subject.id in teacher_qualified_map.get(teacher.id, set()):
                        eligible_teachers.append({
                            "id": teacher.id,
                            "name": teacher.get_name,
                            "current_load": load_map.get(teacher.id, 0),
                            "max_weekly_lessons": policy.max_weekly_lessons,

                            # ✅ ADDED: Pass the current streams for THIS subject to the frontend
                            "subject_stream_count": teacher_subject_stream_counts.get((teacher.id, subject.id), 0)
                        })

                block_id = block_map.get((classroom.grade_id, subject.id))
                routed_to_groups = subject.id in split_subject_ids
                matrix_data.append({
                    "subject_id": subject.id,
                    "subject_name": subject.name,
                    "subject_code": subject.code,
                    "block_name": block_names.get(block_id, "Core Subject") if block_id else "Core Subject",
                    "eligible_teachers": [] if routed_to_groups else eligible_teachers,
                    "assigned_teacher_id": "" if routed_to_groups else allocation_map.get(subject.id, ""),
                    "routed_to_groups": routed_to_groups,
                    "group_status": group_status_by_subject.get(subject.id) if routed_to_groups else None,
                })

            is_published = classroom.id in get_published_classroom_ids([classroom.id], term_id, year_id)

            return Response({
                "class_name": classroom.name,
                "grade_id": classroom.grade_id,
                "grade_name": classroom.grade.name,
                "is_virtual": classroom.is_virtual,
                "is_published": is_published,
                "matrix": matrix_data
            }, status=status.HTTP_200_OK)

        except Exception as e:
            return Response({"error": f"Backend Error: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    def post(self, request):
        """
        Validates assignment boundaries against workload policies and commits choices.
        """
        class_id = request.data.get('class_id')
        term_id = request.data.get('term_id')
        year_id = request.data.get('year_id')
        allocations = request.data.get('allocations', [])
        # 'class' (default) only publishes/locks this one class, same as before this option
        # existed. 'grade'/'all' additionally sweep up and publish every OTHER already-saved,
        # still-draft class in that wider scope in the same request — for an admin who edited
        # each class individually but wants to finalize a whole grade/school in one click instead
        # of re-opening and re-saving every class just to lock it.
        publish_scope = request.data.get('publish_scope', 'class')

        if not all([class_id, term_id, year_id]):
            return Response({"error": "Missing ID parameters."}, status=status.HTTP_400_BAD_REQUEST)

        if get_published_classroom_ids([class_id], term_id, year_id):
            return Response(
                {"error": "This class's allocation has been published and is locked. Unpublish it first to make changes."},
                status=status.HTTP_409_CONFLICT,
            )

        try:
            target_class = get_object_or_404(ClassStream, id=class_id)
            target_grade_id = target_class.grade_id
            block_map = build_grade_subject_block_map(grade_ids=[target_grade_id])
            block_names = get_subject_block_names(block_map.values())

            policy = GlobalAllocationPolicy.load()
            warning_flags = []

            designated_class_teacher = target_class.class_teacher
            class_teacher_is_allocated = False

            quota_map = {(q.grade_id, q.subject_id): q.total_lessons for q in SubjectQuota.objects.all()}

            # Bulk-fetch instead of a .get() per row inside the loop below.
            incoming_subject_ids = {int(a['subject_id']) for a in allocations if a.get('subject_id') and a.get('teacher_id')}
            incoming_teacher_ids = {int(a['teacher_id']) for a in allocations if a.get('subject_id') and a.get('teacher_id')}
            subjects_by_id = {s.id: s for s in Subject.objects.filter(id__in=incoming_subject_ids)}
            teachers_by_id = {t.id: t for t in TeacherExtra.objects.filter(id__in=incoming_teacher_ids)}

            baseline_allocations = SubjectAllocation.objects.filter(
                term_id=term_id, academic_year_id=year_id, is_active=True
            ).exclude(classroom_id=class_id).select_related('classroom', 'subject', 'classroom__grade')

            validator = AllocationValidator(policy, block_map, block_names, quota_map)
            validator.seed_from_existing(baseline_allocations)

            with transaction.atomic():
                # ✅ FIXED: Track the incoming allocation state to isolate dropped rows
                incoming_teacher_subjects = set()
                prior_allocations = list(SubjectAllocation.objects.filter(
                    classroom_id=class_id, term_id=term_id, academic_year_id=year_id, is_active=True
                ).select_related('teacher', 'subject'))

                for alloc in allocations:
                    t_id = int(alloc.get('teacher_id')) if alloc.get('teacher_id') else None
                    s_id = int(alloc.get('subject_id')) if alloc.get('subject_id') else None

                    if not t_id or not s_id:
                        continue

                    # Log active combinations being saved
                    incoming_teacher_subjects.add((t_id, s_id))

                    if designated_class_teacher and t_id == designated_class_teacher.id:
                        class_teacher_is_allocated = True

                    subject = subjects_by_id[s_id]
                    teacher = teachers_by_id[t_id]

                    hard_error, row_warnings = validator.validate_and_record(
                        teacher=teacher, subject=subject, target_class=target_class,
                        term_id=term_id, year_id=year_id
                    )
                    if hard_error:
                        return Response({"error": hard_error}, status=status.HTTP_400_BAD_REQUEST)
                    warning_flags.extend(row_warnings)

                if designated_class_teacher and not class_teacher_is_allocated:
                    class_teacher_name = designated_class_teacher.get_name
                    violation_msg = f"Class Teacher Violation: {class_teacher_name} is the designated class teacher for {target_class.name} and must be assigned to at least one subject in this class."

                    if policy.enforcement_mode == 'STRICT':
                        return Response({"error": violation_msg}, status=status.HTTP_400_BAD_REQUEST)
                    warning_flags.append(violation_msg)

                # ✅ FIXED: Identify teachers who were dropped during this save and now fall below boundaries
                if getattr(policy, 'enforce_prep_consolidation', True):
                    for pa in prior_allocations:
                        if (pa.teacher_id, pa.subject_id) not in incoming_teacher_subjects:
                            remaining_count = SubjectAllocation.objects.filter(
                                term_id=term_id, academic_year_id=year_id, teacher_id=pa.teacher_id,
                                subject_id=pa.subject_id, is_active=True
                            ).exclude(classroom_id=class_id).count()

                            target_min = getattr(policy, 'min_classes_per_subject', 2)
                            if 0 < remaining_count < target_min:
                                warning_flags.append(
                                    f"Consolidation Notice: Removing {pa.teacher.get_name} leaves them handling only {remaining_count} stream(s) of {pa.subject.name} across the remaining classes."
                                )

                SubjectAllocation.objects.filter(classroom_id=class_id, term_id=term_id,
                                                 academic_year_id=year_id).delete()

                new_records = [
                    SubjectAllocation(
                        classroom_id=class_id, academic_year_id=year_id, term_id=term_id,
                        subject_id=alloc['subject_id'], teacher_id=alloc['teacher_id'], is_active=True
                    ) for alloc in allocations if alloc.get('teacher_id')
                ]
                SubjectAllocation.objects.bulk_create(new_records)

                # --- TIMETABLE SYNC ---
                # SubjectAllocation has no FK back to LessonAllocation and this codebase has no
                # signals, so without this a dropped contract would keep appearing on an
                # already-generated/published timetable indefinitely ("ghost contract"), and a
                # swapped-in teacher would never show up on the live grid until someone remembered
                # to manually regenerate. sync_timetable_with_allocation_changes ejects drops,
                # moves swaps onto the same slots in place where the new teacher is free, and falls
                # back to a targeted regeneration (only for the affected subjects) otherwise.
                prior_triples = {(class_id, pa.teacher_id, pa.subject_id) for pa in prior_allocations}
                new_triples = {(class_id, t_id, s_id) for (t_id, s_id) in incoming_teacher_subjects}
                active_timetable = Timetable.objects.filter(is_active=True).first()
                sync_result = sync_timetable_with_allocation_changes(
                    active_timetable=active_timetable, prior_triples=prior_triples, new_triples=new_triples
                )

                if (sync_result["ejected_count"] or sync_result["swapped_count"]
                        or sync_result["needs_regeneration"] or sync_result["locked_skipped_count"]):
                    SystemAuditLog.objects.create(
                        operator=request.user if request.user.is_authenticated else None,
                        action_type='UPDATE',
                        module='LessonAllocation',
                        description=(
                            f"Timetable sync for {target_class.name} after Allocation Matrix save: "
                            f"{sync_result['ejected_count']} lesson(s) ejected, "
                            f"{sync_result['swapped_count']} lesson(s) swapped to their new teacher in place, "
                            f"{sum(len(v) for v in sync_result['needs_regeneration'].values())} subject(s) "
                            f"sent to targeted regeneration, "
                            f"{sync_result['locked_skipped_count']} locked lesson(s) left untouched."
                        )
                    )
                    if sync_result["ejected_count"]:
                        warning_flags.append(
                            f"{sync_result['ejected_count']} timetabled lesson(s) were removed from the live grid "
                            f"because their teacher-subject contract was dropped."
                        )
                    if sync_result["swapped_count"]:
                        warning_flags.append(
                            f"{sync_result['swapped_count']} timetabled lesson(s) were updated to their new "
                            f"teacher in place on the live grid."
                        )
                    if sync_result["needs_regeneration"]:
                        warning_flags.append(
                            f"{sum(len(v) for v in sync_result['needs_regeneration'].values())} subject(s) "
                            f"couldn't be moved in place and were automatically regenerated on the live grid."
                        )
                    if sync_result["locked_skipped_count"]:
                        warning_flags.append(
                            f"{sync_result['locked_skipped_count']} locked lesson(s) were left untouched on the "
                            f"live grid despite this contract change — unlock them manually if they need updating."
                        )

                # Surface any lingering scheduling failures for this class from the last
                # (re)generation run, so a Matrix edit that just fixed a contract also shows
                # whether the grid is still short on that fix.
                if active_timetable:
                    warning_flags.extend(get_cached_unscheduled_errors(active_timetable.id, [target_class.name]))

                # Saving IS publishing — a class's allocation moves from draft to published the
                # moment it's saved here, and stays locked until explicitly unpublished.
                publish_allocation(class_id, term_id, year_id, request.user)

                bulk_published_count = 0
                if publish_scope in ('grade', 'all'):
                    if publish_scope == 'grade':
                        sibling_ids = list(
                            ClassStream.objects.filter(grade_id=target_grade_id)
                            .exclude(id=class_id).values_list('id', flat=True)
                        )
                    else:
                        sibling_ids = list(
                            ClassStream.objects.exclude(id=class_id).values_list('id', flat=True)
                        )

                    # Only classes that actually have something saved are worth publishing —
                    # an empty, never-touched class has no draft to finalize.
                    already_published = get_published_classroom_ids(sibling_ids, term_id, year_id)
                    drafted_ids = set(SubjectAllocation.objects.filter(
                        classroom_id__in=sibling_ids, term_id=term_id, academic_year_id=year_id, is_active=True
                    ).values_list('classroom_id', flat=True).distinct()) - already_published

                    for cid in drafted_ids:
                        publish_allocation(cid, term_id, year_id, request.user)
                    bulk_published_count = len(drafted_ids)

                    scope_label = "grade" if publish_scope == 'grade' else "school"
                    SystemAuditLog.objects.create(
                        operator=request.user if request.user.is_authenticated else None,
                        action_type='UPDATE',
                        module='AllocationPublishState',
                        description=(
                            f"Saved {target_class.name} and published {bulk_published_count} other "
                            f"already-drafted class(es) across the {scope_label} in the same action."
                        )
                    )

            message = "Teachers successfully allocated to class!"
            if bulk_published_count:
                message += f" Also published {bulk_published_count} other drafted class(es) in the {'grade' if publish_scope == 'grade' else 'school'}."

            return Response({
                "message": message,
                "warnings": list(set(warning_flags)),
                "ejected_lesson_count": sync_result["ejected_count"],
                "swapped_lesson_count": sync_result["swapped_count"],
                "bulk_published_count": bulk_published_count,
            }, status=status.HTTP_201_CREATED)

        except Exception as e:
            return Response({"error": f"Backend Error: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class UnpublishAllocationAPIView(APIView):
    """
    Re-opens published allocation(s) for editing — scoped to one class, a whole grade
    (streams + elective groups together), or every published class in the term, mirroring
    ClearAllocationsAPIView's class/grade/school scope choice. Publishing is automatic (see
    AllocationMatrixAPIView.post) — this is the one explicit, deliberate action required to
    undo it, so a finalized schedule can't be nudged back into "editable" by accident.
    """
    authentication_classes = [CsrfExemptSessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_edit_permission = 'allocations.edit'

    def post(self, request):
        from school.models.classSubjects_models import AllocationPublishState

        term_id = request.data.get('term_id')
        year_id = request.data.get('year_id')
        class_id = request.data.get('class_id')
        grade_id = request.data.get('grade_id')

        if not all([term_id, year_id]):
            return Response({"error": "term_id and year_id are required."}, status=status.HTTP_400_BAD_REQUEST)

        if class_id:
            classroom = get_object_or_404(ClassStream, id=class_id)
            unpublish_allocation(class_id, term_id, year_id)
            msg = f"{classroom.grade.name} {classroom.name} reverted to draft — it can be edited again."
        elif grade_id:
            # Whole-grade unpublish: streams AND their virtual elective split groups together,
            # same unit Bulk Allocate Grade / the grade-scoped Clear Grid already treat as one.
            grade = get_object_or_404(GradeLevel, id=grade_id)
            grade_classroom_ids = list(
                ClassStream.objects.filter(grade_id=grade_id).values_list('id', flat=True)
            )
            updated = AllocationPublishState.objects.filter(
                classroom_id__in=grade_classroom_ids, term_id=term_id, academic_year_id=year_id, is_published=True
            ).update(is_published=False, published_at=None, published_by=None)
            msg = f"Reverted {updated} published class(es) across {grade.name} (streams and elective groups) to draft."
        else:
            updated = AllocationPublishState.objects.filter(
                term_id=term_id, academic_year_id=year_id, is_published=True
            ).update(is_published=False, published_at=None, published_by=None)
            msg = f"Reverted {updated} published class(es) across every class in the term to draft."

        SystemAuditLog.objects.create(
            operator=request.user if request.user.is_authenticated else None,
            action_type='UPDATE',
            module='AllocationPublishState',
            description=msg
        )

        return Response({"message": msg}, status=status.HTTP_200_OK)


class _RolloverValidationError(Exception):
    """Raised to force-abort the rollover transaction on a hard policy violation."""
    pass


class RolloverAllocationsAPIView(APIView):
    """
    Purpose: A bulk utility that copies all active subject allocations — and the SubjectBlock
    groupings they depend on — from one term to the next, preventing hours of manual data
    entry at the start of a new term. Every copied contract is re-validated through the same
    AllocationValidator the manual Allocation Matrix uses (workload caps, grade-wide block
    clash, cross-grade rules), not just the prep-consolidation check this used to be limited to.

    Accepts an optional `class_id` to scope the copy to a single class stream instead of every
    class in the term — mirrors the Timetable's "just this stream vs. the whole school" choice,
    so a single class's assignments can be re-rolled without touching everyone else's.

    Also ejects any now-orphaned LessonAllocation rows on the active timetable for contracts
    that existed before the rollover but didn't survive it (teacher/subject pair dropped) — the
    same ghost-contract cleanup every other allocation-saving path (Matrix save, Bulk Allocate)
    already does, which this endpoint was previously missing.
    """
    authentication_classes = [CsrfExemptSessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    # allocations.bulk is the narrower alternative for this and the other school/term-wide
    # bulk operations below — lets a Staff role run rollover/auto-allocate/clear/global-policy
    # without also granting allocations.edit's day-to-day manual matrix editing.
    rbac_edit_permission = ('allocations.edit', 'allocations.bulk')
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'bulk_ops'

    def post(self, request):
        source_term_id = request.data.get('source_term_id')
        target_term_id = request.data.get('target_term_id')
        year_id = request.data.get('year_id')
        class_id = request.data.get('class_id')
        # A term belongs to exactly one AcademicYear (ExamTerm.academic_year is a required FK) —
        # the source term is not necessarily in the same year as the target, so this must be
        # resolved independently rather than assumed to equal `year_id`. Falls back to `year_id`
        # if the caller doesn't send it, to stay compatible with older frontend builds.
        source_year_id = request.data.get('source_year_id') or year_id

        if not all([source_term_id, target_term_id, year_id]):
            return Response({"error": "Missing parameters for rollover."}, status=status.HTTP_400_BAD_REQUEST)

        if class_id:
            get_object_or_404(ClassStream, id=class_id)

        # Scoped per target TERM (not per class) — even a single-class rollover shares this
        # lock with a whole-term rollover into the same target term, since both can rewrite
        # SubjectBlock rows for that term. The task itself acquires this (with retry) once
        # it starts running — a second submission while one is in progress gets queued and
        # auto-processed the moment the lock frees, instead of being rejected outright.
        lock_key = f"rollover_lock_term_{target_term_id}"
        operator = request.user if request.user.is_authenticated else None

        # The actual clone/validate/timetable-sync work (potentially whole-school in scope)
        # runs in a Celery worker — see school/tasks.py:rollover_allocations_task. This view
        # only validates fast enough to keep an instant response, then hands off.
        job, error_response = dispatch_background_job(
            job_type='rollover_allocations',
            task=rollover_allocations_task,
            task_args=(source_term_id, target_term_id, year_id, class_id, source_year_id,
                       operator.id if operator else None, lock_key),
            operator=operator,
        )
        if error_response is not None:
            return error_response

        payload = {"status": "queued", "job_id": str(job.id)}
        if cache.get(lock_key):
            payload["note"] = "A rollover into this term is already running — yours has been queued " \
                               "and will start automatically once it finishes."
        return Response(payload, status=status.HTTP_202_ACCEPTED)


class AutoAllocateDraftAPIView(APIView):
    """
    Greedy Constraint-Satisfaction Engine. Builds a zero-clash draft schedule for a target
    class stream based on teacher qualifications and workload controls.

    Runs every candidate through the SAME AllocationValidator the manual Allocation Matrix
    save and Rollover use (dry_run=True to score without committing, then a real call to
    commit the winner) — previously this view re-implemented its own parallel, slightly
    different set of workload/block-clash checks, so a draft the algorithm considered valid
    could still get rejected (or silently diverge) when actually saved via the Matrix. That
    can no longer happen: both paths now share one rule engine.

    Candidates are still ranked with the same tiered priority as before (designated class
    teacher first, then the prep-consolidation magnet, then load-based tiebreakers) — but the
    dry-run's warning count is now part of that ranking too, so a pick that would trip zero
    soft-policy warnings is preferred over one that would trip several, even when both are
    otherwise equally valid.
    """
    authentication_classes = [CsrfExemptSessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'allocations.view'

    def get(self, request):
        class_id = request.query_params.get('class_id')
        term_id = request.query_params.get('term_id')
        year_id = request.query_params.get('year_id')

        if not all([class_id, term_id, year_id]):
            return Response({"error": "Missing context parameters."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            year_obj = AcademicYear.objects.filter(id=year_id).first()
            term_obj = ExamTerm.objects.filter(id=term_id).first()
            target_class = ClassStream.objects.filter(id=class_id).select_related('grade').first()

            if not target_class or not year_obj or not term_obj:
                return Response({"error": "Context parameters not found inside the active database registries."},
                                status=status.HTTP_404_NOT_FOUND)

            target_grade_id = target_class.grade_id
            real_class_id = target_class.id
            real_term_id = term_obj.id
            real_year_id = year_obj.id
            block_map = build_grade_subject_block_map(grade_ids=[target_grade_id])
            block_names = get_subject_block_names(block_map.values())

            if target_class.is_virtual:
                # A virtual elective group only ever needs its own one subject (see the same
                # branch in AllocationMatrixAPIView) — not the whole grade's SubjectQuota list.
                subject_name = target_class.name.split(' - ')[0].strip()
                target_subject = Subject.objects.filter(name__iexact=subject_name).first()
                required_subjects = [target_subject] if target_subject else []
            else:
                quotas = SubjectQuota.objects.filter(grade=target_class.grade).select_related('subject') \
                    .order_by('subject__display_order', 'subject__name')
                # Subjects already routed through live virtual split groups are fulfilled entirely
                # by those groups' own contracts — a physical stream must not also demand its own
                # separate teacher slot for the same subject (see get_subjects_with_active_virtual_groups).
                split_subject_ids = get_subjects_with_active_virtual_groups(target_class.grade_id)
                required_subjects = [quota.subject for quota in quotas if quota.subject_id not in split_subject_ids]
            active_teachers = list(TeacherExtra.objects.filter(status=True))

            # Single source of truth for eligibility (see TeacherExtra.qualified_subjects).
            required_subject_ids = [s.id for s in required_subjects]
            teacher_qualified_map = {}
            for row in TeacherExtra.objects.filter(
                    status=True, qualified_subjects__id__in=required_subject_ids
            ).values('id', 'qualified_subjects__id'):
                teacher_qualified_map.setdefault(row['id'], set()).add(row['qualified_subjects__id'])

            all_term_allocations = SubjectAllocation.objects.filter(
                term_id=real_term_id, academic_year_id=real_year_id, is_active=True
            ).exclude(classroom_id=real_class_id).select_related('classroom', 'subject', 'classroom__grade')
            all_term_allocations = list(all_term_allocations)

            policy = GlobalAllocationPolicy.load()
            quota_map = {(q.grade_id, q.subject_id): q.total_lessons for q in SubjectQuota.objects.all()}

            validator = AllocationValidator(policy, block_map, block_names, quota_map)
            validator.seed_from_existing(all_term_allocations)

            # Lightweight bookkeeping used only for candidate RANKING (not validation — the
            # validator above is the sole source of truth for whether a pick is even allowed).
            teacher_subject_classes = {}  # teacher_id -> {subject_id: [classroom, ...]}
            for alloc in all_term_allocations:
                teacher_subject_classes.setdefault(alloc.teacher_id, {}).setdefault(
                    alloc.subject_id, []).append(alloc.classroom)

            draft_allocations = []
            reserved_subject_id, reserved_entry = reserve_class_teacher_slot(
                validator=validator, target_class=target_class, required_subjects=required_subjects,
                teacher_qualified_map=teacher_qualified_map, teacher_subject_classes=teacher_subject_classes,
                term_id=real_term_id, year_id=real_year_id
            )
            if reserved_entry:
                draft_allocations.append(reserved_entry)

            draft_allocations.extend(fill_remaining_subjects(
                validator=validator, target_class=target_class, required_subjects=required_subjects,
                reserved_subject_id=reserved_subject_id, teacher_qualified_map=teacher_qualified_map,
                active_teachers=active_teachers, teacher_subject_classes=teacher_subject_classes,
                policy=policy, term_id=real_term_id, year_id=real_year_id
            ))

            # Surface any scheduling failures the live timetable already has for this class, so an
            # admin previewing a draft can see "this one's had trouble fitting on the grid before"
            # before they even decide to save it.
            timetable_warnings = []
            active_timetable = Timetable.objects.filter(is_active=True).first()
            if active_timetable:
                timetable_warnings = get_cached_unscheduled_errors(active_timetable.id, [target_class.name])

            return Response({"draft": draft_allocations, "timetable_warnings": timetable_warnings},
                             status=status.HTTP_200_OK)

        except Exception as e:
            return Response({"error": f"Algorithm Error: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class BulkAutoAllocateAPIView(APIView):
    """
    Coordinated multi-class auto-allocation: runs the same engine as AutoAllocateDraftAPIView,
    but across every class stream in a grade (or an explicit class_ids list) in ONE pass,
    sharing a single AllocationValidator so a teacher's cumulative load is tracked correctly
    across classes.

    Critically, it reserves EVERY target class's designated class teacher BEFORE any general
    subject-filling runs for ANY of them (two full phases across the whole batch, not
    interleaved per class) — this is the fix for a real failure mode found in testing: running
    Auto-Allocate one class at a time lets an early class's ordinary subject need ("we need
    someone for English") consume a teacher's weekly-lesson capacity before their OWN homeroom
    class gets processed, leaving them with nothing left to reserve and the whole class
    unsavable. Reserving every class teacher first, school-wide, prevents that starvation.

    Commits directly in one atomic transaction — a genuine failure rolls back everything rather
    than leaving some classes updated and others not. This is the "clear the recent allocation
    and apply new allocation" bulk action: it always wipes and rebuilds every target class's
    contracts for the given term/year, and — via AllocationValidator — guarantees no teacher
    exceeds their weekly-lesson cap or any other policy in the process.
    """
    authentication_classes = [CsrfExemptSessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_edit_permission = ('allocations.edit', 'allocations.bulk')
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'bulk_ops'

    def post(self, request):
        grade_id = request.data.get('grade_id')
        term_id = request.data.get('term_id')
        year_id = request.data.get('year_id')
        explicit_class_ids = request.data.get('class_ids')

        if not all([term_id, year_id]) or not (grade_id or explicit_class_ids):
            return Response(
                {"error": "Missing context parameters (grade_id or class_ids, plus term_id and year_id)."},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Cheap existence check kept synchronous so an obviously-empty scope still fails
        # fast — the actual reservation/fill/commit work (school-wide in the worst case)
        # runs in a Celery worker, see school/tasks.py:bulk_auto_allocate_task.
        if explicit_class_ids:
            scope_exists = ClassStream.live.filter(id__in=explicit_class_ids).exists()
        else:
            scope_exists = ClassStream.live.filter(grade_id=grade_id, is_virtual=False).exists()
        if not scope_exists:
            return Response({"error": "No class streams found for the given scope."},
                            status=status.HTTP_404_NOT_FOUND)

        # Scoped per (term, year) rather than per grade/class_ids — two overlapping-but-not-
        # identical scopes (e.g. "Grade 9" and "class 9B" individually) would otherwise both
        # touch the same teacher-load validator state for that term and race each other. The
        # task itself acquires this (with retry) once it starts running, so a second
        # submission gets queued and auto-processed rather than rejected.
        lock_key = f"bulk_allocate_lock_term_{term_id}_year_{year_id}"
        operator = request.user if request.user.is_authenticated else None

        job, error_response = dispatch_background_job(
            job_type='bulk_auto_allocate',
            task=bulk_auto_allocate_task,
            task_args=(grade_id, term_id, year_id, explicit_class_ids,
                       operator.id if operator else None, lock_key),
            operator=operator,
        )
        if error_response is not None:
            return error_response

        payload = {"status": "queued", "job_id": str(job.id)}
        if cache.get(lock_key):
            payload["note"] = "A bulk auto-allocate for this term is already running — yours has been " \
                               "queued and will start automatically once it finishes."
        return Response(payload, status=status.HTTP_202_ACCEPTED)


class ClearAllocationsAPIView(APIView):
    """
    Deletes saved SubjectAllocation contracts for a term/year — either scoped to one class
    stream or across every class in the school — mirroring the Timetable's "just this stream
    vs. the whole school" Clear Grid choice. The Allocation Dashboard's "Clear Grid" button only
    wipes the on-screen draft (see AllocationMatrixAPIView); this is the real, backend-hitting
    delete for when the admin actually wants saved contracts gone, not just the screen reset.

    Also ejects the matching LessonAllocation rows on the active timetable for whatever scope
    was cleared — deleting a class's contracts but leaving its timetable lessons pointing at
    now-nonexistent teacher assignments would be a ghost-contract regression.
    """
    authentication_classes = [CsrfExemptSessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_edit_permission = ('allocations.edit', 'allocations.bulk')

    def delete(self, request):
        term_id = request.query_params.get('term_id')
        year_id = request.query_params.get('year_id')
        class_id = request.query_params.get('class_id')
        grade_id = request.query_params.get('grade_id')

        if not all([term_id, year_id]):
            return Response({"error": "term_id and year_id are required."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            with transaction.atomic():
                query = SubjectAllocation.objects.filter(term_id=term_id, academic_year_id=year_id)
                active_timetable = Timetable.objects.filter(
                    is_active=True, term_id=term_id, academic_year_id=year_id
                ).first()
                ejected_count = 0

                if class_id:
                    classroom = get_object_or_404(ClassStream, id=class_id)
                    if get_published_classroom_ids([class_id], term_id, year_id):
                        return Response(
                            {"error": "This class's allocation has been published and is locked. "
                                      "Unpublish it first to clear it."},
                            status=status.HTTP_409_CONFLICT,
                        )
                    query = query.filter(classroom_id=class_id)
                    deleted_count, _ = query.delete()
                    if active_timetable:
                        stale = LessonAllocation.objects.filter(timetable=active_timetable, class_stream_id=class_id)
                        ejected_count = stale.count()
                        stale.delete()
                    label = f"{classroom.grade.name} {classroom.name}"
                    msg = f"Cleared {deleted_count} allocation(s) for {label}."
                elif grade_id:
                    # Whole-grade clear: streams AND their virtual elective split groups
                    # together — a single physical stream's own class_id clear (above)
                    # deliberately does NOT touch a grade's elective groups, since those pool
                    # students from every stream in the grade and clearing one stream shouldn't
                    # silently wipe a teacher shared with streams the admin isn't even looking
                    # at. This scope is for when the admin explicitly wants the whole grade
                    # (both) reset together, matching how Bulk Allocate Grade already treats
                    # streams + elective groups as one unit.
                    grade = get_object_or_404(GradeLevel, id=grade_id)
                    grade_classroom_ids = set(
                        ClassStream.objects.filter(grade_id=grade_id).values_list('id', flat=True)
                    )
                    query = query.filter(classroom_id__in=grade_classroom_ids)
                    published_ids = get_published_classroom_ids(grade_classroom_ids, term_id, year_id)
                    if published_ids:
                        query = query.exclude(classroom_id__in=published_ids)
                    deleted_count, _ = query.delete()
                    if active_timetable:
                        stale = LessonAllocation.objects.filter(
                            timetable=active_timetable, class_stream_id__in=grade_classroom_ids
                        )
                        if published_ids:
                            stale = stale.exclude(class_stream_id__in=published_ids)
                        ejected_count = stale.count()
                        stale.delete()
                    msg = f"Cleared {deleted_count} allocation(s) across {grade.name} (streams and elective groups)."
                    if published_ids:
                        msg += f" {len(published_ids)} published class(es) were skipped — unpublish them first to clear."
                else:
                    # Whole-school clear: published classes are skipped rather than aborting the
                    # entire operation — one finalized class shouldn't block clearing every other
                    # draft class in the term.
                    all_classroom_ids = set(query.values_list('classroom_id', flat=True))
                    published_ids = get_published_classroom_ids(all_classroom_ids, term_id, year_id)
                    if published_ids:
                        query = query.exclude(classroom_id__in=published_ids)
                    deleted_count, _ = query.delete()
                    if active_timetable:
                        stale = LessonAllocation.objects.filter(timetable=active_timetable)
                        if published_ids:
                            stale = stale.exclude(class_stream_id__in=published_ids)
                        ejected_count = stale.count()
                        stale.delete()
                    msg = f"Cleared {deleted_count} allocation(s) across every class in the term."
                    if published_ids:
                        msg += f" {len(published_ids)} published class(es) were skipped — unpublish them first to clear."

                if ejected_count:
                    msg += f" {ejected_count} stale timetable lesson(s) ejected."

                SystemAuditLog.objects.create(
                    operator=request.user if request.user.is_authenticated else None,
                    action_type='DELETE',
                    module='SubjectAllocation',
                    description=msg
                )

            return Response({
                "message": msg,
                "deleted_count": deleted_count,
                "ejected_lesson_count": ejected_count,
            }, status=status.HTTP_200_OK)

        except ClassStream.DoesNotExist:
            return Response({"error": "Target class not found."}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({"error": f"Failed to clear allocations: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@csrf_exempt
@require_permission('allocations.view', edit_permission='allocations.edit')
def api_manage_splitting_rules(request, grade_id):
    """
    Fetches or updates the thresholds for how large an elective class can be before splitting.
    Automatically self-populates with default fallbacks if no database override row exists yet.
    """
    try:
        grade = GradeLevel.objects.get(id=grade_id)
    except GradeLevel.DoesNotExist:
        return JsonResponse({'status': 'error', 'message': 'Grade level not found.'})

    if request.method == 'GET':
        # 1. Fetch any custom configurations that have been saved by an administrator
        existing_rules = SubjectSplittingRule.objects.filter(grade=grade).select_related('subject')
        rules_map = {r.subject_id: r for r in existing_rules}

        # 2. Discover all elective (non-core) subjects currently assigned to this grade level via
        # quotas — resolved per this grade's curriculum/tier since a SubjectCurriculumProfile
        # override can make a subject elective here even if its flat Subject.is_core is True.
        elective_quotas = [
            q for q in SubjectQuota.objects.filter(grade=grade).select_related('subject')
            if not get_effective_is_core(q.subject, grade.curriculum, grade.tier)
        ]

        data = []
        for quota in elective_quotas:
            subject_item = quota.subject

            # --- SCOPE ISOLATION: Exclude subjects that do not use a shared lecture room layout ---
            if not is_tech_subject(subject_item, grade):
                continue

            # 3. If a custom override exists, deliver it. Otherwise, populate with factory baselines.
            if subject_item.id in rules_map:
                saved_rule = rules_map[subject_item.id]
                data.append({
                    'id': saved_rule.id,
                    'subject_id': subject_item.id,
                    'subject_name': subject_item.name,
                    'max_class_size': saved_rule.max_class_size,
                    'allocation_mode': saved_rule.allocation_mode,
                })
            else:
                data.append({
                    'id': None,  # Alerts the frontend it is a brand-new uncommitted row template
                    'subject_id': subject_item.id,
                    'subject_name': subject_item.name,
                    'max_class_size': 45,  # Standard baseline room capacity threshold
                    'allocation_mode': 'Split_Balance',  # Standard baseline balancing mode
                })

        return JsonResponse({'status': 'success', 'data': data})

    elif request.method == 'POST':
        try:
            payload = json.loads(request.body)
            subject_id = payload.get('subject_id')
            max_size = int(payload.get('max_class_size', 45))
            mode = payload.get('allocation_mode', 'Split_Balance')

            rule, created = SubjectSplittingRule.objects.update_or_create(
                grade=grade,
                subject_id=subject_id,
                defaults={
                    'max_class_size': max_size,
                    'allocation_mode': mode,
                    'last_modified_by': request.user if request.user.is_authenticated else None
                }
            )

            # Re-run the splitting engine immediately so the new threshold/mode is reflected in
            # real virtual-group sizing right away, instead of leaving existing groups on their
            # old sizing until someone separately opens "Manage Elective Splits" and re-runs it.
            operator_user = request.user if request.user.is_authenticated else None
            split_result = None
            split_warning = None
            try:
                split_result = _run_splitting_reconciliation(grade, operator_user, is_simulation=False)
            except ValueError as e:
                split_warning = str(e)

            return JsonResponse({
                'status': 'success',
                'message': 'Threshold limits updated.',
                'split_result': split_result,
                'split_warning': split_warning,
            })
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)})


def _run_splitting_reconciliation(grade, operator_user, is_simulation=False):
    """
    THE MASTER SPLITTING ENGINE — core reconciliation, shared by api_execute_allocation_splits
    (the manual "Manage Elective Splits" run) and api_manage_splitting_rules (auto re-run right
    after a SubjectSplittingRule change is saved, so a new threshold/mode takes effect immediately
    instead of waiting for someone to separately open the splits modal). Raises ValueError for a
    caller-facing error (no active academic year); returns the same dict shape either caller can
    hand straight back as JSON.
    """
    current_year = AcademicYear.objects.filter(is_active=True).first()
    if not current_year:
        raise ValueError('Active academic year required.')

    # Atomic transaction allows us to rollback if it's just a simulation. We always run the
    # REAL reconciliation writes below (create/update/soft-delete) — for a preview, the
    # forced rollback at the end discards them, but running the real logic (instead of a
    # separate parallel "simulate" code path) means the preview numbers are guaranteed to
    # match what a live run would actually do.
    with transaction.atomic():

        # RECONCILE INSTEAD OF WIPE-AND-RECREATE: matching by name lets a continuing group
        # (e.g. "Computer Studies - Group 1") keep its existing row — and therefore its ID —
        # across re-runs. SubjectAllocation, LessonAllocation, and AttendanceSession all
        # CASCADE-delete off ClassStream, so previously every re-run silently destroyed
        # already-generated timetable lessons and attendance history for every elective
        # group in the grade. Only groups that genuinely no longer exist get removed now,
        # and removal goes through soft_delete() (audited, recoverable) instead of a hard
        # DB delete.
        existing_virtual_streams = {
            s.name: s for s in ClassStream.live.filter(grade=grade, is_virtual=True)
        }
        desired_names = set()
        stream_impacts = []  # [{name, action: created|updated|unchanged, capacity}]

        elective_subjects = [
            s for s in Subject.objects.all()
            if not get_effective_is_core(s, grade.curriculum, grade.tier)
        ]

        # Bulk-fetch instead of a StudentSubjectEnrollment.count() and a
        # SubjectSplittingRule.first() per elective subject inside the loop below.
        elective_subject_ids = [s.id for s in elective_subjects]
        enrollment_counts = dict(
            StudentSubjectEnrollment.objects.filter(
                student__cl__grade=grade, subject_id__in=elective_subject_ids,
                academic_year=current_year, status='Approved', student__status=True
            ).values('subject_id').annotate(c=Count('id')).values_list('subject_id', 'c')
        )
        splitting_rules_by_subject = {
            r.subject_id: r for r in SubjectSplittingRule.objects.filter(
                grade=grade, subject_id__in=elective_subject_ids
            )
        }
        projected_changes = []

        def _reconcile_group(group_title, assigned_capacity):
            desired_names.add(group_title)
            existing = existing_virtual_streams.get(group_title)
            if existing:
                if existing.capacity != assigned_capacity:
                    existing.capacity = assigned_capacity
                    existing.save(update_fields=['capacity'])
                    stream_impacts.append({'name': group_title, 'action': 'updated', 'capacity': assigned_capacity})
                else:
                    stream_impacts.append({'name': group_title, 'action': 'unchanged', 'capacity': assigned_capacity})
            else:
                ClassStream.objects.create(
                    name=group_title, grade=grade, capacity=assigned_capacity, is_virtual=True
                )
                stream_impacts.append({'name': group_title, 'action': 'created', 'capacity': assigned_capacity})

        for subject in elective_subjects:

            # --- SCOPE ISOLATION: Ensure the engine does not generate virtual rows for standard courses ---
            if not is_tech_subject(subject, grade):
                continue

            # 1. Count actual approved students
            student_count = enrollment_counts.get(subject.id, 0)

            if student_count == 0:
                continue

            # 2. Get the rule or default to 45
            rule = splitting_rules_by_subject.get(subject.id)
            threshold = rule.max_class_size if rule else 45
            mode = rule.allocation_mode if rule else 'Split_Balance'

            subject_groupings = []
            groups_spawned = 1

            # 3. Determine grouping strategy based on mode
            if student_count <= threshold or mode == 'Co_Teaching':
                # ONE MASSIVE GROUP: Handles under-cap subjects or Co-Teaching
                group_title = f"{subject.name} - Group 1"
                subject_groupings.append({'name': group_title, 'capacity': student_count})
                _reconcile_group(group_title, student_count)
            else:
                # WE NEED TO SPLIT: Calculate groups needed
                groups_needed = math.ceil(student_count / threshold)
                groups_spawned = groups_needed

                if mode == 'Split_Balance':
                    # EVEN DISTRIBUTION: e.g., 100 kids, cap 45 -> 34, 33, 33
                    base_size = student_count // groups_needed
                    remainder = student_count % groups_needed

                    for i in range(groups_needed):
                        assigned_capacity = base_size + (1 if i < remainder else 0)
                        group_title = f"{subject.name} - Group {i + 1}"
                        subject_groupings.append({'name': group_title, 'capacity': assigned_capacity})
                        _reconcile_group(group_title, assigned_capacity)

                elif mode == 'Strict_Cap':
                    # FILL TO BRIM: e.g., 100 kids, cap 45 -> 45, 45, 10
                    students_remaining = student_count
                    group_index = 1

                    while students_remaining > 0:
                        assigned_capacity = min(threshold, students_remaining)
                        group_title = f"{subject.name} - Group {group_index}"
                        subject_groupings.append({'name': group_title, 'capacity': assigned_capacity})
                        _reconcile_group(group_title, assigned_capacity)

                        students_remaining -= assigned_capacity
                        group_index += 1

            projected_changes.append({
                'subject_name': subject.name,
                'total_enrolled': student_count,
                'threshold_limit': threshold,
                'spawned_groups_count': groups_spawned,
                'group_distribution': subject_groupings
            })

        # --- ORPHAN CLEANUP: groups that no longer correspond to any current subject/
        # enrollment (subject dropped, enrollment hit zero, group count shrank) ---
        removed_impacts = []
        for name, stream in existing_virtual_streams.items():
            if name in desired_names:
                continue
            allocation_count = SubjectAllocation.objects.filter(classroom=stream).count()
            lesson_count = LessonAllocation.objects.filter(class_stream=stream).count()
            attendance_count = AttendanceSession.objects.filter(class_stream=stream).count()
            removed_impacts.append({
                'name': stream.name,
                'had_allocations': allocation_count,
                'had_lessons': lesson_count,
                'had_attendance_sessions': attendance_count,
            })
            # Hard-delete the contract and grid rows — soft-deleting the stream alone leaves
            # them as invisible orphans (ClassStream.live excludes it, but nothing filters
            # SubjectAllocation/LessonAllocation by classroom__is_deleted), so a retired
            # group's teacher permanently keeps the workload and grid slots. AttendanceSession
            # is deliberately left alone; soft_delete() exists specifically to preserve it.
            SubjectAllocation.objects.filter(classroom=stream).delete()
            LessonAllocation.objects.filter(class_stream=stream).delete()
            stream.soft_delete(operator_user=operator_user)

        # --- THE SAFETY TRIGGER ---
        if is_simulation:
            # Force rollback to ensure absolutely nothing is saved to the database — the
            # reconciliation above ran for real so the impact numbers reported back are
            # exactly what a live run would do, but none of it is kept.
            transaction.set_rollback(True)

    # Logged OUTSIDE the atomic block above: a simulation rolls that transaction back
    # entirely, so a log row written inside it would vanish along with everything else.
    total_groups = sum(c['spawned_groups_count'] for c in projected_changes)
    created_count = sum(1 for s in stream_impacts if s['action'] == 'created')
    updated_count = sum(1 for s in stream_impacts if s['action'] == 'updated')
    removed_count = len(removed_impacts)
    SystemAuditLog.objects.create(
        operator=operator_user,
        action_type='SIMULATION' if is_simulation else 'EXECUTION',
        module='SplittingEngine',
        description=f"{'Simulated' if is_simulation else 'Committed'} allocation splits for {grade.name}: "
                    f"{len(projected_changes)} elective subject(s), {total_groups} group(s) targeted "
                    f"({created_count} created, {updated_count} capacity-updated, {removed_count} removed)."
    )

    return {
        'status': 'success',
        'is_simulation': is_simulation,
        'message': "Simulation complete." if is_simulation else "Virtual Streams successfully reconciled.",
        'projected_data': projected_changes,
        'stream_impacts': stream_impacts,
        'removed_streams': removed_impacts,
    }


@csrf_exempt
@require_permission(('allocations.edit', 'allocations.bulk'))
def api_execute_allocation_splits(request, grade_id):
    """
    THE MASTER SPLITTING ENGINE (HTTP entrypoint for the manual "Manage Elective Splits" run).
    Accepts 'is_simulation': True to preview the splits without saving to the DB. See
    _run_splitting_reconciliation for the actual engine.
    """
    if request.method != 'POST':
        return JsonResponse({'status': 'error', 'message': 'Invalid method type.'})

    try:
        payload = json.loads(request.body)
        is_simulation = payload.get('is_simulation', False)
        grade = GradeLevel.objects.get(id=grade_id)
        operator_user = request.user if request.user.is_authenticated else None

        result = _run_splitting_reconciliation(grade, operator_user, is_simulation)
        return JsonResponse(result)

    except ValueError as e:
        return JsonResponse({'status': 'error', 'message': str(e)})
    except Exception as e:
        return JsonResponse({'status': 'error', 'message': str(e)})


class GlobalAllocationPolicyAPIView(APIView):
    """
    Manages the global configuration parameters from the Frontend Tab 2 workspace.
    """
    authentication_classes = [CsrfExemptSessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'allocations.view'
    rbac_edit_permission = ('allocations.edit', 'allocations.bulk')

    def get(self, request):
        policy = GlobalAllocationPolicy.load()
        return Response({
            "max_subjects_per_class": policy.max_subjects_per_class,
            "max_classes_per_subject": policy.max_classes_per_subject,

            # ✅ ADDED: Exposing the new prep consolidation targets to the frontend
            "min_classes_per_subject": getattr(policy, 'min_classes_per_subject', 2),
            "enforce_prep_consolidation": getattr(policy, 'enforce_prep_consolidation', True),

            "allow_cross_grade_teaching": policy.allow_cross_grade_teaching,
            "max_weekly_lessons": policy.max_weekly_lessons,
            "max_total_class_groups": policy.max_total_class_groups,
            "enforcement_mode": policy.enforcement_mode
        }, status=status.HTTP_200_OK)

    def post(self, request):
        policy = GlobalAllocationPolicy.load()

        valid_modes = {choice for choice, _ in GlobalAllocationPolicy.ENFORCEMENT_CHOICES}
        requested_mode = request.data.get('enforcement_mode', policy.enforcement_mode)
        if requested_mode not in valid_modes:
            return Response(
                {"error": f"Invalid enforcement_mode '{requested_mode}'. Must be one of {sorted(valid_modes)}."},
                status=status.HTTP_400_BAD_REQUEST
            )

        policy.max_subjects_per_class = request.data.get('max_subjects_per_class', policy.max_subjects_per_class)
        policy.max_classes_per_subject = request.data.get('max_classes_per_subject', policy.max_classes_per_subject)

        # ✅ ADDED: Safely catching and saving the new optimization fields
        if hasattr(policy, 'min_classes_per_subject'):
            policy.min_classes_per_subject = int(
                request.data.get('min_classes_per_subject', policy.min_classes_per_subject))
        if hasattr(policy, 'enforce_prep_consolidation'):
            policy.enforce_prep_consolidation = request.data.get('enforce_prep_consolidation',
                                                                 policy.enforce_prep_consolidation)

        policy.allow_cross_grade_teaching = request.data.get('allow_cross_grade_teaching',
                                                             policy.allow_cross_grade_teaching)
        policy.max_weekly_lessons = request.data.get('max_weekly_lessons', policy.max_weekly_lessons)
        policy.max_total_class_groups = request.data.get('max_total_class_groups', policy.max_total_class_groups)
        policy.enforcement_mode = requested_mode

        # PositiveIntegerField only rejects NEGATIVE values, not zero — a cap of 0 for any of
        # these would make the corresponding workload check either always-fail or always-pass
        # nonsensically (e.g. max_weekly_lessons=0 means no teacher could ever be assigned
        # anything), so these need at least 1 explicitly.
        must_be_at_least_one = {
            'max_subjects_per_class': policy.max_subjects_per_class,
            'max_classes_per_subject': policy.max_classes_per_subject,
            'min_classes_per_subject': policy.min_classes_per_subject,
            'max_weekly_lessons': policy.max_weekly_lessons,
            'max_total_class_groups': policy.max_total_class_groups,
        }
        bad_fields = [name for name, value in must_be_at_least_one.items() if not value or value < 1]
        if bad_fields:
            return Response(
                {"error": f"These fields must be at least 1: {', '.join(bad_fields)}."},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Belt-and-braces: catches anything else the model's own field constraints define
        # (e.g. a truly invalid type slipping through DRF's loose dict-based assignment above).
        try:
            policy.full_clean()
        except ValidationError as e:
            return Response({"error": "; ".join(f"{f}: {', '.join(m)}" for f, m in e.message_dict.items())},
                            status=status.HTTP_400_BAD_REQUEST)

        policy.save()

        return Response({"message": "Global teacher workload limits updated successfully."}, status=status.HTTP_200_OK)


@csrf_exempt
@require_permission('allocations.view')
def api_get_stream_teachers(request, stream_id):
    """
    API: STREAM TEACHERS
    Fetches the active subject allocations (Subject + Teacher) for a specific class stream.
    Used to populate the 'Class Profile & Analytics' modal dynamically.
    """
    if request.method == 'GET':
        try:
            # Query active allocations and optimize with select_related to avoid N+1 query bloat
            allocations = SubjectAllocation.objects.filter(
                classroom_id=stream_id,
                is_active=True
            ).select_related('subject', 'teacher__user')

            data = []
            for alloc in allocations:
                data.append({
                    'subject': alloc.subject.name,
                    'teacher': alloc.teacher.get_name
                })

            return JsonResponse({'status': 'success', 'data': data})

        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)})

    return JsonResponse({'status': 'error', 'message': 'Invalid request method.'})


@csrf_exempt
@require_permission('allocations.view')
def api_get_teacher_allocations(request, teacher_id):
    """
    Purpose: Specialized endpoint to fetch all active subject allocations
    (ClassStream + Subject) managed by a specific teacher profile ID.
    Use: Invoked standalone by the teacher dashboard or profile inspection view.
    """
    if request.method != 'GET':
        return JsonResponse({'status': 'error', 'message': 'Method not allowed'}, status=405)

    try:
        # Retrieve the profile wrapper for the teacher
        teacher_profile = TeacherExtra.objects.get(id=teacher_id)

        # Scope to the active term/year — `is_active` on SubjectAllocation itself is never
        # flipped to False (rows from past terms/years pile up as "active" forever), so without
        # this filter a teacher who has taught the same subject/stream-name combo in a prior
        # term shows up twice here even though only one of those rows is current.
        current_year = AcademicYear.objects.filter(is_active=True).first()
        current_term = ExamTerm.objects.filter(is_active=True).first()

        allocations = SubjectAllocation.objects.filter(
            teacher=teacher_profile,
            is_active=True,
            academic_year=current_year,
            term=current_term,
        ).select_related('classroom', 'classroom__grade', 'subject')

        allocations_list = [
            {
                'class_id': alloc.classroom.id,
                # Stream names ("North"/"South") repeat across grades, so the grade must be
                # included here — otherwise two entirely different classes that happen to share
                # a stream name render as an indistinguishable "duplicate" row in the UI.
                'class_name': f"{alloc.classroom.grade.name} {alloc.classroom.name}",
                'subject_name': alloc.subject.name,
                'subject_code': alloc.subject.code if hasattr(alloc.subject, 'code') else ""
            }
            # Iterate and convert the QuerySet results into a serialization-friendly list
            for alloc in allocations
        ]

        return JsonResponse({'status': 'success', 'data': allocations_list})

    except TeacherExtra.DoesNotExist:
        return JsonResponse({'status': 'error', 'message': 'Teacher profile not found'}, status=404)
    except Exception as e:
        return JsonResponse({'status': 'error', 'message': str(e)}, status=500)