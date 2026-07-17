from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from django.db import transaction
from django.db.models import Count
from django.core.exceptions import ValidationError
from school.models.classSubjects_models import SubjectQuota, SubjectAllocation, ClassStream, Subject, GradeLevel, \
    SubjectSplittingRule, StudentSubjectEnrollment, GlobalAllocationPolicy, SystemAuditLog, SubjectBlock
from school.models.models import (
    TeacherExtra, ExamTerm, AcademicYear, AttendanceSession
)
from school.models.timetable_models import LessonAllocation, Timetable
from school.utils import build_grade_subject_block_map, get_subject_block_names, is_tech_subject, \
    AllocationValidator, reserve_class_teacher_slot, fill_remaining_subjects, get_cached_unscheduled_errors
from school.views.views_timetable import sync_timetable_with_allocation_changes
from django.views.decorators.csrf import csrf_exempt
from django.shortcuts import get_object_or_404
from django.http import JsonResponse
import json
import math
import random
from school.decorators import require_permission
from school.rbac import HasModulePermission


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

            if classroom.is_virtual:
                subject_name = classroom.name.split(' - ')[0].strip()
                target_subject = Subject.objects.filter(name__iexact=subject_name).first()
                if target_subject:
                    class_subjects.append(target_subject)
            else:
                quotas = SubjectQuota.objects.filter(grade=classroom.grade).select_related('subject') \
                    .order_by('subject__display_order', 'subject__name')

                if quotas.exists():
                    for quota in quotas:
                        class_subjects.append(quota.subject)
                else:
                    class_subjects = list(Subject.objects.all().order_by('display_order', 'name'))

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
                matrix_data.append({
                    "subject_id": subject.id,
                    "subject_name": subject.name,
                    "subject_code": subject.code,
                    "block_name": block_names.get(block_id, "Core Subject") if block_id else "Core Subject",
                    "eligible_teachers": eligible_teachers,
                    "assigned_teacher_id": allocation_map.get(subject.id, "")
                })

            return Response({
                "class_name": classroom.name,
                "grade_id": classroom.grade_id,
                "grade_name": classroom.grade.name,
                "is_virtual": classroom.is_virtual,
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

        if not all([class_id, term_id, year_id]):
            return Response({"error": "Missing ID parameters."}, status=status.HTTP_400_BAD_REQUEST)

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

                if sync_result["ejected_count"] or sync_result["swapped_count"] or sync_result["needs_regeneration"]:
                    SystemAuditLog.objects.create(
                        operator=request.user if request.user.is_authenticated else None,
                        action_type='UPDATE',
                        module='LessonAllocation',
                        description=(
                            f"Timetable sync for {target_class.name} after Allocation Matrix save: "
                            f"{sync_result['ejected_count']} lesson(s) ejected, "
                            f"{sync_result['swapped_count']} lesson(s) swapped to their new teacher in place, "
                            f"{sum(len(v) for v in sync_result['needs_regeneration'].values())} subject(s) "
                            f"sent to targeted regeneration."
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

                # Surface any lingering scheduling failures for this class from the last
                # (re)generation run, so a Matrix edit that just fixed a contract also shows
                # whether the grid is still short on that fix.
                if active_timetable:
                    warning_flags.extend(get_cached_unscheduled_errors(active_timetable.id, [target_class.name]))

            return Response({
                "message": "Teachers successfully allocated to class!",
                "warnings": list(set(warning_flags)),
                "ejected_lesson_count": sync_result["ejected_count"],
                "swapped_lesson_count": sync_result["swapped_count"],
            }, status=status.HTTP_201_CREATED)

        except Exception as e:
            return Response({"error": f"Backend Error: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


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

        try:
            with transaction.atomic():
                scoped_classroom = None
                if class_id:
                    scoped_classroom = get_object_or_404(ClassStream, id=class_id)

                # 1. Clone SubjectBlock groupings so the target term isn't left with none of
                # the elective-synchronization structure the source term had (previously only
                # the dead, unregistered api_rollover_term_data did this). Scoped to the target
                # class's own grade when a single class is selected.
                source_blocks = SubjectBlock.objects.filter(
                    term_id=source_term_id, academic_year_id=source_year_id
                ).select_related('grade_level')
                if scoped_classroom:
                    source_blocks = source_blocks.filter(grade_level=scoped_classroom.grade)
                blocks_cloned = 0
                for old_block in source_blocks:
                    new_block, created = SubjectBlock.objects.get_or_create(
                        name=old_block.name, grade_level=old_block.grade_level,
                        academic_year_id=year_id, term_id=target_term_id,
                        defaults={'period_structure': old_block.period_structure}
                    )
                    if not created and new_block.period_structure != old_block.period_structure:
                        new_block.period_structure = old_block.period_structure
                        new_block.save(update_fields=['period_structure'])
                    new_block.subjects.set(old_block.subjects.all())
                    if created:
                        blocks_cloned += 1

                # 2. Snapshot the target term's existing contracts (for ghost-lesson cleanup
                # below) before wiping them. Scoped to the one class when class_id is given.
                target_query = SubjectAllocation.objects.filter(term_id=target_term_id, academic_year_id=year_id)
                if scoped_classroom:
                    target_query = target_query.filter(classroom_id=class_id)
                prior_pairs = set(target_query.values_list('classroom_id', 'teacher_id', 'subject_id'))
                target_query.delete()

                # 3. Validate + clone allocations through the shared validator
                old_allocations = SubjectAllocation.objects.filter(
                    term_id=source_term_id, academic_year_id=source_year_id, is_active=True
                )
                if scoped_classroom:
                    old_allocations = old_allocations.filter(classroom_id=class_id)
                old_allocations = old_allocations.select_related('classroom__grade', 'subject', 'teacher')

                block_map = build_grade_subject_block_map()
                block_names = get_subject_block_names(block_map.values())
                quota_map = {(q.grade_id, q.subject_id): q.total_lessons for q in SubjectQuota.objects.all()}
                policy = GlobalAllocationPolicy.load()
                validator = AllocationValidator(policy, block_map, block_names, quota_map)

                new_allocations = []
                rollover_warnings = []
                for alloc in old_allocations:
                    hard_error, row_warnings = validator.validate_and_record(
                        teacher=alloc.teacher, subject=alloc.subject, target_class=alloc.classroom,
                        term_id=target_term_id, year_id=year_id
                    )
                    if hard_error:
                        raise _RolloverValidationError(hard_error)
                    rollover_warnings.extend(row_warnings)
                    new_allocations.append(SubjectAllocation(
                        classroom_id=alloc.classroom_id,
                        subject_id=alloc.subject_id,
                        teacher_id=alloc.teacher_id,
                        academic_year_id=year_id,
                        term_id=target_term_id,
                        is_active=True
                    ))

                SubjectAllocation.objects.bulk_create(new_allocations)

                # 4. Sync the live timetable to whatever the rollover produced — for the WHOLE
                # batch at once (every class in scope), so an earlier class's swap in this same
                # rollover can't steal a slot a later class's swap also needs. Ejects contracts
                # that didn't survive, moves swapped contracts onto their existing slots in place
                # where the new teacher is free, and falls back to targeted regeneration otherwise.
                new_pairs = {(a.classroom_id, a.teacher_id, a.subject_id) for a in new_allocations}
                active_timetable = Timetable.objects.filter(
                    is_active=True, term_id=target_term_id, academic_year_id=year_id
                ).first()
                sync_result = sync_timetable_with_allocation_changes(
                    active_timetable=active_timetable, prior_triples=prior_pairs, new_triples=new_pairs
                )

                scope_label = f"class {scoped_classroom.grade.name} {scoped_classroom.name}" if scoped_classroom else "the whole term"
                SystemAuditLog.objects.create(
                    operator=request.user if request.user.is_authenticated else None,
                    action_type='UPDATE',
                    module='RolloverEngine',
                    description=f"Rolled over term {source_term_id} -> {target_term_id} ({scope_label}): "
                                f"{blocks_cloned} block(s) cloned, {len(new_allocations)} allocation(s) carried over, "
                                f"{sync_result['ejected_count']} stale lesson(s) ejected, "
                                f"{sync_result['swapped_count']} lesson(s) swapped in place, "
                                f"{sum(len(v) for v in sync_result['needs_regeneration'].values())} subject(s) "
                                f"regenerated."
                )

            timetable_warnings = []
            if active_timetable and scoped_classroom:
                timetable_warnings = get_cached_unscheduled_errors(active_timetable.id, [scoped_classroom.name])

            return Response({
                "message": f"Successfully rolled over {len(new_allocations)} allocation(s) and "
                           f"{blocks_cloned} subject block(s)"
                           + (f" for {scoped_classroom.grade.name} {scoped_classroom.name}." if scoped_classroom else " to the new term."),
                "warnings": list(set(rollover_warnings)),
                "ejected_lesson_count": sync_result["ejected_count"],
                "swapped_lesson_count": sync_result["swapped_count"],
                "timetable_warnings": timetable_warnings,
            }, status=status.HTTP_201_CREATED)

        except _RolloverValidationError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


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

            quotas = SubjectQuota.objects.filter(grade=target_class.grade).select_related('subject') \
                .order_by('subject__display_order', 'subject__name')
            required_subjects = [quota.subject for quota in quotas]
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

        try:
            with transaction.atomic():
                if explicit_class_ids:
                    target_classes = list(
                        ClassStream.live.filter(id__in=explicit_class_ids).select_related('grade', 'class_teacher')
                    )
                else:
                    target_classes = list(
                        ClassStream.live.filter(grade_id=grade_id, is_virtual=False)
                        .select_related('grade', 'class_teacher')
                    )

                if not target_classes:
                    return Response({"error": "No class streams found for the given scope."},
                                    status=status.HTTP_404_NOT_FOUND)

                target_class_ids = [c.id for c in target_classes]

                policy = GlobalAllocationPolicy.load()
                quota_map = {(q.grade_id, q.subject_id): q.total_lessons for q in SubjectQuota.objects.all()}

                required_subjects_by_class = {}
                all_subject_ids = set()
                for c in target_classes:
                    quotas = SubjectQuota.objects.filter(grade=c.grade).select_related('subject') \
                        .order_by('subject__display_order', 'subject__name')
                    subs = [q.subject for q in quotas]
                    required_subjects_by_class[c.id] = subs
                    all_subject_ids.update(s.id for s in subs)

                active_teachers = list(TeacherExtra.objects.filter(status=True))
                teacher_qualified_map = {}
                for row in TeacherExtra.objects.filter(
                        status=True, qualified_subjects__id__in=all_subject_ids
                ).values('id', 'qualified_subjects__id'):
                    teacher_qualified_map.setdefault(row['id'], set()).add(row['qualified_subjects__id'])

                grade_ids = list({c.grade_id for c in target_classes})
                block_map = build_grade_subject_block_map(grade_ids=grade_ids)
                block_names = get_subject_block_names(block_map.values())

                # Seed from everything OUTSIDE the target set — teachers' commitments elsewhere
                # in the school still count against their cap, exactly like the single-class view.
                baseline_allocations = list(SubjectAllocation.objects.filter(
                    term_id=term_id, academic_year_id=year_id, is_active=True
                ).exclude(classroom_id__in=target_class_ids).select_related('classroom', 'subject', 'classroom__grade'))

                validator = AllocationValidator(policy, block_map, block_names, quota_map)
                validator.seed_from_existing(baseline_allocations)

                teacher_subject_classes = {}
                for alloc in baseline_allocations:
                    teacher_subject_classes.setdefault(alloc.teacher_id, {}).setdefault(
                        alloc.subject_id, []).append(alloc.classroom)

                # PHASE 1: reserve every class's designated class teacher, across the WHOLE batch.
                reserved_by_class = {}
                for c in target_classes:
                    reserved_subject_id, entry = reserve_class_teacher_slot(
                        validator=validator, target_class=c, required_subjects=required_subjects_by_class[c.id],
                        teacher_qualified_map=teacher_qualified_map, teacher_subject_classes=teacher_subject_classes,
                        term_id=term_id, year_id=year_id
                    )
                    reserved_by_class[c.id] = (reserved_subject_id, entry)

                # PHASE 2: fill everything else, for every class.
                class_drafts = {}
                for c in target_classes:
                    reserved_subject_id, entry = reserved_by_class[c.id]
                    entries = ([entry] if entry else []) + fill_remaining_subjects(
                        validator=validator, target_class=c, required_subjects=required_subjects_by_class[c.id],
                        reserved_subject_id=reserved_subject_id, teacher_qualified_map=teacher_qualified_map,
                        active_teachers=active_teachers, teacher_subject_classes=teacher_subject_classes,
                        policy=policy, term_id=term_id, year_id=year_id
                    )
                    class_drafts[c.id] = entries

                # COMMIT: wipe + rebuild each class's contracts. Timetable sync (eject/swap/
                # regenerate) happens ONCE, after every class's contracts are finalized — not per
                # class — since a whole-grade batch can touch dozens of classes at once, and
                # processing them one at a time against the live DB would let an earlier class's
                # swap in this same batch silently steal a slot a later class's swap also needed.
                active_timetable = Timetable.objects.filter(is_active=True).first()
                per_class_summary = []
                total_saved = 0
                batch_prior_triples = set()
                batch_new_triples = set()
                for c in target_classes:
                    entries = class_drafts[c.id]
                    new_pairs = [(e['subject_id'], e['teacher_id']) for e in entries if e.get('teacher_id')]
                    unresolved_count = sum(1 for e in entries if not e.get('teacher_id'))

                    prior_pairs = set(SubjectAllocation.objects.filter(
                        classroom=c, term_id=term_id, academic_year_id=year_id, is_active=True
                    ).values_list('teacher_id', 'subject_id'))
                    batch_prior_triples.update((c.id, t_id, s_id) for t_id, s_id in prior_pairs)
                    batch_new_triples.update((c.id, t_id, s_id) for s_id, t_id in new_pairs)

                    SubjectAllocation.objects.filter(
                        classroom=c, term_id=term_id, academic_year_id=year_id
                    ).delete()
                    SubjectAllocation.objects.bulk_create([
                        SubjectAllocation(classroom=c, subject_id=s_id, teacher_id=t_id,
                                          academic_year_id=year_id, term_id=term_id, is_active=True)
                        for s_id, t_id in new_pairs
                    ])

                    total_saved += len(new_pairs)
                    per_class_summary.append({
                        "class_id": c.id,
                        "class_name": f"{c.grade.name} {c.name}",
                        "assigned": len(new_pairs),
                        "unresolved": unresolved_count,
                        "class_teacher_assigned": (
                            reserved_by_class[c.id][0] is not None or not c.class_teacher_id
                        ),
                    })

                sync_result = sync_timetable_with_allocation_changes(
                    active_timetable=active_timetable,
                    prior_triples=batch_prior_triples, new_triples=batch_new_triples
                )
                total_ejected = sync_result["ejected_count"]
                total_swapped = sync_result["swapped_count"]
                total_regenerated_subjects = sum(len(v) for v in sync_result["needs_regeneration"].values())

                # Teacher-load transparency report, straight from the validator's own running
                # state — the exact numbers that were actually enforced during this run.
                teacher_by_id = {t.id: t for t in active_teachers}
                load_report = []
                for t_id, load in validator.teacher_weekly_lessons.items():
                    if policy.max_weekly_lessons and load >= policy.max_weekly_lessons * 0.8:
                        teacher = teacher_by_id.get(t_id)
                        load_report.append({
                            "teacher_name": teacher.get_name if teacher else f"Teacher {t_id}",
                            "weekly_lessons": load,
                            "cap": policy.max_weekly_lessons,
                        })
                load_report.sort(key=lambda x: -x['weekly_lessons'])

                classes_with_gaps = [c for c in per_class_summary if c['unresolved'] or not c['class_teacher_assigned']]

                SystemAuditLog.objects.create(
                    operator=request.user if request.user.is_authenticated else None,
                    action_type='EXECUTION',
                    module='BulkAutoAllocate',
                    description=f"Bulk auto-allocated {len(target_classes)} class(es): "
                                f"{total_saved} contract(s) saved, {total_ejected} stale lesson(s) ejected, "
                                f"{total_swapped} lesson(s) swapped to their new teacher in place, "
                                f"{total_regenerated_subjects} subject(s) targeted-regenerated, "
                                f"{len(classes_with_gaps)} class(es) with gaps."
                )

                timetable_warnings = []
                if active_timetable:
                    timetable_warnings = get_cached_unscheduled_errors(
                        active_timetable.id, [c.name for c in target_classes]
                    )

            return Response({
                "message": f"Bulk allocation complete: {total_saved} contract(s) across "
                           f"{len(target_classes)} class(es).",
                "per_class": per_class_summary,
                "classes_with_gaps": classes_with_gaps,
                "teachers_near_cap": load_report,
                "ejected_lesson_count": total_ejected,
                "swapped_lesson_count": total_swapped,
                "regenerated_subject_count": total_regenerated_subjects,
                "timetable_warnings": timetable_warnings,
            }, status=status.HTTP_200_OK)

        except Exception as e:
            return Response({"error": f"Bulk Allocation Error: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


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
                    query = query.filter(classroom_id=class_id)
                    deleted_count, _ = query.delete()
                    if active_timetable:
                        stale = LessonAllocation.objects.filter(timetable=active_timetable, class_stream_id=class_id)
                        ejected_count = stale.count()
                        stale.delete()
                    label = f"{classroom.grade.name} {classroom.name}"
                    msg = f"Cleared {deleted_count} allocation(s) for {label}."
                else:
                    deleted_count, _ = query.delete()
                    if active_timetable:
                        stale = LessonAllocation.objects.filter(timetable=active_timetable)
                        ejected_count = stale.count()
                        stale.delete()
                    msg = f"Cleared {deleted_count} allocation(s) across every class in the term."

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

        # 2. Discover all elective (non-core) subjects currently assigned to this grade level via quotas
        elective_quotas = SubjectQuota.objects.filter(
            grade=grade,
            subject__is_core=False
        ).select_related('subject')

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
            return JsonResponse({'status': 'success', 'message': 'Threshold limits updated.'})
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)})


@csrf_exempt
@require_permission(('allocations.edit', 'allocations.bulk'))
def api_execute_allocation_splits(request, grade_id):
    """
    THE MASTER SPLITTING ENGINE
    Accepts 'is_simulation': True to preview the splits without saving to the DB.
    """
    if request.method != 'POST':
        return JsonResponse({'status': 'error', 'message': 'Invalid method type.'})

    try:
        payload = json.loads(request.body)
        is_simulation = payload.get('is_simulation', False)

        grade = GradeLevel.objects.get(id=grade_id)
        current_year = AcademicYear.objects.filter(is_active=True).first()

        if not current_year:
            return JsonResponse({'status': 'error', 'message': 'Active academic year required.'})

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

            elective_subjects = list(Subject.objects.filter(is_core=False))

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
                stream.soft_delete(operator_user=request.user if request.user.is_authenticated else None)

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
            operator=request.user if request.user.is_authenticated else None,
            action_type='SIMULATION' if is_simulation else 'EXECUTION',
            module='SplittingEngine',
            description=f"{'Simulated' if is_simulation else 'Committed'} allocation splits for {grade.name}: "
                        f"{len(projected_changes)} elective subject(s), {total_groups} group(s) targeted "
                        f"({created_count} created, {updated_count} capacity-updated, {removed_count} removed)."
        )

        return JsonResponse({
            'status': 'success',
            'is_simulation': is_simulation,
            'message': "Simulation complete." if is_simulation else "Virtual Streams successfully reconciled.",
            'projected_data': projected_changes,
            'stream_impacts': stream_impacts,
            'removed_streams': removed_impacts,
        })

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