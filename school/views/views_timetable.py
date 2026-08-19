import json
import traceback
from django.http import JsonResponse
from django.db import transaction
from django.db.models import Count, F
from apps.timetable.models import LessonAllocation, Timetable, TimetablePedagogyPolicy, DailyCover
from apps.identity.models import (
    TeacherExtra,
)
import random
from apps.academics.models import (ClassStream, Subject, GradeLevel, TimeSlot, AcademicYear, ExamTerm,
                         get_effective_department)
from apps.allocations.models import SubjectQuota, SubjectBlock, SubjectAllocation, GlobalAllocationPolicy, QuotaDefaultRule
from apps.core.models import SystemAuditLog
from datetime import datetime
from django.core.cache import cache
from apps.staff.models import TeacherStructuralAvailability, TeacherLeave, LongTermReliefAssignment
from school.utils import cache_unscheduled_basket_errors, build_grade_subject_block_map, get_subject_block_names, \
    max_consecutive_run, get_block_period_structures, compute_school_allocation_gaps, \
    get_subjects_with_active_virtual_groups
from django.db.models import Q
from school.decorators import require_permission
from school.jobs import dispatch_background_job
from orchestration.tasks import generate_timetable_task
from school.views.class_views import _eligible_subjects_for

@require_permission('timetable.view', edit_permission='timetable.edit')
def api_manage_quotas(request):
    """
    API for React Config: Fetches grades, subjects, and handles saving/deleting quotas.
    """
    if request.method == 'GET':
        try:
            grades = list(GradeLevel.objects.all().values('id', 'name'))
            subjects = list(Subject.live.all().values('id', 'name'))

            quotas = list(SubjectQuota.objects.all().select_related('grade', 'subject').values(
                'id', 'grade_id', 'grade__name', 'subject_id', 'subject__name',
                'total_lessons', 'double_lessons_required', 'remedial_lessons_required'
            ))

            # Block membership is grade-scoped (a subject can sit in a different
            # block per grade), so attach it per quota row instead of on the
            # flat global subjects list.
            block_map = build_grade_subject_block_map()
            for quota in quotas:
                quota['subject_block_id'] = block_map.get((quota['grade_id'], quota['subject_id']))

            # So the manual-edit UI can show admins how many of the week's real periods a
            # grade's quotas are using, instead of letting them enter numbers blind.
            daytime_capacity = TimeSlot.objects.filter(is_global=False, is_remedial=False).count()

            return JsonResponse({
                'status': 'success',
                'data': {
                    'grades': grades, 'subjects': subjects, 'quotas': quotas,
                    'daytime_capacity': daytime_capacity
                }
            })
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)})

    elif request.method == 'POST':
        try:
            data = json.loads(request.body)
            quota, created = SubjectQuota.objects.update_or_create(
                grade_id=data.get('grade_id'),
                subject_id=data.get('subject_id'),
                defaults={
                    'total_lessons': data.get('total_lessons'),
                    'double_lessons_required': data.get('double_lessons_required', 0),
                    'remedial_lessons_required': data.get('remedial_lessons_required', 0)
                }
            )
            write_audit_log(
                operator_id=request.user.id if request.user.is_authenticated else None,
                action_type='CREATE' if created else 'UPDATE',
                module='SubjectQuota',
                description=f"{'Created' if created else 'Updated'} quota for {quota.subject.name} "
                            f"({quota.grade.name}): {quota.total_lessons} lessons, "
                            f"{quota.double_lessons_required} double, {quota.remedial_lessons_required} remedial."
            )
            msg = "Quota created successfully!" if created else "Quota updated successfully!"
            return JsonResponse({'status': 'success', 'message': msg})
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)})

    elif request.method == 'DELETE':
        try:
            data = json.loads(request.body)
            quota = SubjectQuota.objects.select_related('grade', 'subject').get(id=data.get('id'))
            desc = f"Removed quota for {quota.subject.name} ({quota.grade.name})."
            quota.delete()
            write_audit_log(
                operator_id=request.user.id if request.user.is_authenticated else None,
                action_type='DELETE',
                module='SubjectQuota',
                description=desc
            )
            return JsonResponse({'status': 'success', 'message': 'Quota removed.'})
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)})


@require_permission('timetable.view')
def api_get_global_grid(request):
    """
    API 1: THE BLANK CANVAS
    Sends the physical grid of the week to React.
    """
    if request.method == 'GET':
        try:
            slots = TimeSlot.objects.all().order_by('day', 'start_time')

            data = []
            for slot in slots:
                data.append({
                    'id': slot.id,
                    'day': slot.day,
                    'start_time': slot.start_time.strftime('%H:%M'),
                    'end_time': slot.end_time.strftime('%H:%M'),
                    'is_global': slot.is_global,
                    'global_label': slot.global_label,
                    'is_remedial': slot.is_remedial
                })

            return JsonResponse({'status': 'success', 'data': data})
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)})


@require_permission('timetable.view')
def api_get_dynamic_buckets(request, stream_id, timetable_id):
    """
    API 2: THE DYNAMIC REFILL SYSTEM (UPGRADED)
    Calculates remaining lesson targets for the React sidebar inventory panel.
    Strictly uses database relationships (SubjectBlock) instead of hardcoded strings.
    """
    if request.method != 'GET':
        return JsonResponse({'status': 'error', 'message': 'Method not allowed.'}, status=405)

    try:
        # 1. Fetch class stream and its associated grade level
        stream = ClassStream.objects.get(id=stream_id)
        grade = stream.grade

        # 2. Fetch the current quotas defined for this grade level
        quotas = SubjectQuota.objects.filter(grade=grade).select_related('subject')
        block_map = build_grade_subject_block_map(grade_ids=[grade.id])

        bucket_data = []
        for quota in quotas:
            subject = quota.subject

            # 3. Smart Counting Lens: Check if the admin grouped this subject into a block container
            if block_map.get((grade.id, subject.id)) is not None:
                # Block subjects share time slots across the entire grade level concurrently
                scheduled_count = LessonAllocation.objects.filter(
                    timetable_id=timetable_id,
                    class_stream__grade=grade,
                    subject=subject
                ).count()
            else:
                # Standalone core subjects are isolated strictly to this unique classroom stream
                scheduled_count = LessonAllocation.objects.filter(
                    timetable_id=timetable_id,
                    class_stream=stream,
                    subject=subject
                ).count()

            # 4. Calculate the real-world remaining inventory balance
            remaining = max(0, quota.total_lessons - scheduled_count)

            # 5. Build serialization payload preserving your active React contract properties
            bucket_data.append({
                'subject_id': subject.id,
                'subject_name': subject.name,
                'total_required': quota.total_lessons,
                'already_scheduled': scheduled_count,
                'remaining': remaining,
                'double_required': quota.double_lessons_required
            })

        return JsonResponse({'status': 'success', 'data': bucket_data})

    except ClassStream.DoesNotExist:
        return JsonResponse({'status': 'error', 'message': 'Class stream not found.'}, status=404)
    except Exception as e:
        return JsonResponse({'status': 'error', 'message': f"Bucket Engine Error: {str(e)}"}, status=500)


@require_permission('timetable.edit')
def api_save_lesson(request):
    """
    API 3: THE COLLISION ENGINE (HARD & SOFT CONSTRAINT FIREWALL)
    Validates manual drag-and-drop allocations against physical grid limitations,
    administrative availability, and cognitive fatigue policies.
    """
    if request.method not in ['POST', 'PUT']:
        return JsonResponse({'status': 'error', 'message': 'Method not allowed.'}, status=405)

    try:
        data = json.loads(request.body)
        timetable_id = data.get('timetable_id')
        time_slot_id = data.get('time_slot_id')
        class_stream_id = data.get('class_stream_id')
        subject_id = data.get('subject_id')
        teacher_id = data.get('teacher_id')
        is_double = data.get('is_double_period', False)

        # 1. Instantiate Core Models & Singletons
        timetable = Timetable.objects.get(id=timetable_id)
        time_slot = TimeSlot.objects.get(id=time_slot_id)
        teacher = TeacherExtra.objects.get(id=teacher_id)
        class_stream = ClassStream.objects.get(id=class_stream_id)
        subject = Subject.objects.get(id=subject_id)

        pedagogy_policy = TimetablePedagogyPolicy.load()
        block_map = build_grade_subject_block_map(grade_ids=[class_stream.grade_id])

        # ==========================================
        # PHASE 1: HARD CONSTRAINTS (ABSOLUTE BLOCKS)
        # ==========================================

        if time_slot.is_global:
            return JsonResponse({'status': 'error',
                                 'message': f"Constraint Violation: Cannot schedule over global blocks ({time_slot.global_label})."})

        # H-1: Contract Verification
        contract_exists = SubjectAllocation.objects.filter(
            classroom=class_stream, subject=subject, teacher=teacher,
            academic_year=timetable.academic_year, term=timetable.term, is_active=True
        ).exists()
        if not contract_exists:
            return JsonResponse({'status': 'error',
                                 'message': f"Unauthorized: {teacher.get_name} is not assigned to this class in the Admin Panel."})

        # H-2: Subject Level Overrides (No more string matching)
        if is_double and not getattr(subject, 'allow_double_periods', True):
            return JsonResponse(
                {'status': 'error', 'message': f"Policy Restriction: {subject.name} does not permit double periods."})

        if is_double and time_slot.is_remedial and not pedagogy_policy.allow_remedial_double_periods:
            return JsonResponse({'status': 'error',
                                 'message': "Policy Restriction: Remedial double periods are disabled in Timetable Settings → Policies."})

        if subject.earliest_allowed_time and time_slot.start_time < subject.earliest_allowed_time:
            return JsonResponse({'status': 'error',
                                 'message': f"Time Restriction: {subject.name} cannot be scheduled before {subject.earliest_allowed_time.strftime('%H:%M')}."})

        # Resolve Double Period Layout
        target_slots = [time_slot]
        if is_double:
            next_slot = TimeSlot.objects.filter(day=time_slot.day, start_time=time_slot.end_time).first()
            if not next_slot or next_slot.is_global:
                return JsonResponse(
                    {'status': 'error', 'message': 'Layout Error: No consecutive slot available for a double period.'})
            target_slots.append(next_slot)

        for slot in target_slots:
            # H-3: Teacher Administrative Matrix Availability (Future-Proofed)
            is_unavailable = TeacherStructuralAvailability.objects.filter(teacher=teacher, time_slot=slot).exists()
            if is_unavailable:
                return JsonResponse({'status': 'error',
                                     'message': f"Availability Matrix: {teacher.get_name} is permanently blocked from teaching during this period."})

            # H-4: Physical Multi-Class Teacher Clash
            teacher_conflict = LessonAllocation.objects.filter(timetable=timetable, time_slot=slot,
                                                               teacher=teacher).first()
            if teacher_conflict:
                return JsonResponse({'status': 'error',
                                     'message': f"Teacher Clash: {teacher.get_name} is already teaching room {teacher_conflict.class_stream.name}."})

            # H-5: Smart Option-Block Sharing
            existing_lessons = LessonAllocation.objects.filter(timetable=timetable, time_slot=slot,
                                                               class_stream=class_stream).select_related('subject')
            for existing in existing_lessons:
                if existing.subject_id == subject.id:
                    return JsonResponse(
                        {'status': 'error', 'message': f"Duplication: {subject.name} is already in this slot."})

                subject_block_id = block_map.get((class_stream.grade_id, subject.id))
                existing_block_id = block_map.get((class_stream.grade_id, existing.subject_id))
                both_in_same_block = (
                        subject_block_id is not None and
                        existing_block_id is not None and
                        subject_block_id == existing_block_id
                )
                if not both_in_same_block:
                    return JsonResponse({'status': 'error',
                                         'message': f"Grid Collision: Room already occupied by {existing.subject.name}."})

        # ==========================================
        # PHASE 2: SOFT CONSTRAINTS (FATIGUE & WORKLOAD AUDIT)
        # ==========================================

        warning_messages = []

        # Calculate Teacher's total daily load (including this new prospective drop)
        current_daily_load = LessonAllocation.objects.filter(
            timetable=timetable, teacher=teacher, time_slot__day=time_slot.day
        ).count()
        prospective_load = current_daily_load + len(target_slots)

        # S-1: Heavy Workload Day Check
        if prospective_load >= pedagogy_policy.heavy_day_threshold:
            warning_messages.append(
                f"Fatigue Warning: This drop pushes {teacher.get_name} to {prospective_load} lessons on {time_slot.day}, hitting the Heavy Day threshold.")

            # S-2: Consecutive Heavy Days Check (If enabled)
            if pedagogy_policy.prevent_consecutive_heavy_days:
                # Basic check for adjacent days (Simplified logic: checks total weekly distribution)
                # In a robust system, you would check yesterday and tomorrow explicitly.
                heavy_days_count = LessonAllocation.objects.filter(
                    timetable=timetable, teacher=teacher
                ).values('time_slot__day').annotate(daily_count=Count('id')).filter(
                    daily_count__gte=pedagogy_policy.heavy_day_threshold).count()

                if heavy_days_count >= 1:  # They already have a heavy day elsewhere
                    msg = f"Workload Violation: {teacher.get_name} already has a Heavy Day this week. Adding another violates the Consecutive/Multiple Heavy Days policy."
                    if pedagogy_policy.enforcement_mode == 'STRICT':
                        return JsonResponse({'status': 'error', 'message': msg})
                    warning_messages.append(msg)

        # S-3: Daily Subject Frequency (Student Cognitive Load)
        subject_daily_count = LessonAllocation.objects.filter(
            timetable=timetable, class_stream=class_stream, subject=subject, time_slot__day=time_slot.day
        ).count()

        if (subject_daily_count + len(target_slots)) > pedagogy_policy.max_daily_subject_frequency:
            msg = f"Cognitive Load: This class exceeds the {pedagogy_policy.max_daily_subject_frequency} daily frequency limit for {subject.name}."
            if pedagogy_policy.enforcement_mode == 'STRICT':
                return JsonResponse({'status': 'error', 'message': msg})
            warning_messages.append(msg)

        # Positional index of each daytime (non-remedial) slot within its day — shared by S-4
        # and S-5 below. Remedial slots simply won't appear in this map, which naturally
        # exempts them from both daytime-only checks.
        day_daytime_slot_ids = list(TimeSlot.objects.filter(
            day=time_slot.day, is_global=False, is_remedial=False
        ).order_by('start_time').values_list('id', flat=True))
        slot_pos = {slot_id: idx for idx, slot_id in enumerate(day_daytime_slot_ids)}

        # S-4: Max Consecutive Periods (Teacher Fatigue) — daytime periods only, positional
        # adjacency within the day (same convention the auto-generator uses for double periods).
        if not time_slot.is_remedial:
            teacher_day_slot_ids = LessonAllocation.objects.filter(
                timetable=timetable, teacher=teacher, time_slot__day=time_slot.day, time_slot__is_remedial=False
            ).values_list('time_slot_id', flat=True)
            occupied_positions = {slot_pos[sid] for sid in teacher_day_slot_ids if sid in slot_pos}
            candidate_positions = {slot_pos[s.id] for s in target_slots if s.id in slot_pos}

            run_length = max_consecutive_run(occupied_positions, candidate_positions)
            if run_length > pedagogy_policy.max_consecutive_periods:
                msg = (f"Fatigue Warning: This drop gives {teacher.get_name} a run of {run_length} consecutive "
                       f"periods on {time_slot.day}, exceeding the {pedagogy_policy.max_consecutive_periods}-period cap.")
                if pedagogy_policy.enforcement_mode == 'STRICT':
                    return JsonResponse({'status': 'error', 'message': msg})
                warning_messages.append(msg)

        # S-5: Minimum Subject Spacing — keep two single lessons of the same subject, same
        # class, same day from landing too close together. Doubles are exempt (they're
        # meant to be back-to-back by design). Remedial slots aren't in slot_pos, so a
        # remedial single naturally skips this daytime-only check.
        if not is_double:
            new_pos = slot_pos.get(time_slot.id)
            if new_pos is not None:
                other_single_slot_ids = LessonAllocation.objects.filter(
                    timetable=timetable, class_stream=class_stream, subject=subject,
                    time_slot__day=time_slot.day, is_double_period=False
                ).exclude(time_slot_id=time_slot.id).values_list('time_slot_id', flat=True)
                too_close = any(
                    sid in slot_pos and abs(new_pos - slot_pos[sid]) < pedagogy_policy.min_subject_spacing_periods
                    for sid in other_single_slot_ids
                )
                if too_close:
                    msg = (f"Spacing Violation: Another single {subject.name} lesson for {class_stream.name} on "
                           f"{time_slot.day} is closer than the required {pedagogy_policy.min_subject_spacing_periods}-period gap.")
                    if pedagogy_policy.enforcement_mode == 'STRICT':
                        return JsonResponse({'status': 'error', 'message': msg})
                    warning_messages.append(msg)

        # ==========================================
        # EXECUTION & LOGGING
        # ==========================================
        with transaction.atomic():
            for slot in target_slots:
                LessonAllocation.objects.create(
                    timetable=timetable, time_slot=slot, class_stream=class_stream,
                    subject=subject, teacher=teacher, is_double_period=is_double
                )

            # --- NEW: AUDIT LOG ---
            write_audit_log(
                operator_id=request.user.id if request.user.is_authenticated else None,
                action_type='EXECUTION',
                module='ManualGridAllocation',
                description=f"Manually assigned {teacher.get_name} to teach {subject.name} in {class_stream.name}."
            )

        response_data = {'status': 'success', 'message': 'Lesson secured on the grid.'}
        if warning_messages:
            response_data['warnings'] = warning_messages

        return JsonResponse(response_data)

    except Timetable.DoesNotExist:
        return JsonResponse({'status': 'error', 'message': 'Timetable record not found.'}, status=404)
    except TimeSlot.DoesNotExist:
        return JsonResponse({'status': 'error', 'message': 'Time slot record not found.'}, status=404)
    except Exception as e:
        return JsonResponse({'status': 'error', 'message': f"System Error: {str(e)}"}, status=500)


@require_permission('timetable.edit')
def api_remove_lesson(request, allocation_id):
    """
    Safely removes a lesson from the grid. If the subject is part of a block,
    it removes the block allocation across the entire grade level simultaneously.
    Includes mandatory audit logging for manual administrative actions.
    """
    if request.method in ['DELETE', 'POST']:
        try:
            lesson = LessonAllocation.objects.get(id=allocation_id)

            # Locking is an explicit admin pin against automatic sync/regeneration — removal is
            # still a deliberate manual action, but requiring an unlock first (mirrors the
            # AllocationPublishState publish/unpublish gate) prevents an accidental drag-off.
            if lesson.is_locked:
                return JsonResponse({
                    'status': 'error',
                    'message': 'This lesson is locked. Unlock it first before removing.'
                }, status=400)

            grade = lesson.class_stream.grade

            # --- NEW: AUDIT LOG PREP ---
            operator = request.user if request.user.is_authenticated else None
            desc = f"Manually removed {lesson.subject.name} for {grade.name} from the grid."

            # Simply check the database relationship instead of string matching
            block_map = build_grade_subject_block_map(grade_ids=[grade.id])
            if block_map.get((grade.id, lesson.subject_id)) is not None:
                LessonAllocation.objects.filter(
                    timetable_id=lesson.timetable_id,
                    time_slot_id=lesson.time_slot_id,
                    subject=lesson.subject,
                    class_stream__grade=grade,
                    is_locked=False
                ).delete()
                msg = f'{lesson.subject.name} removed across the grade. Buckets refilled.'
            else:
                lesson.delete()
                msg = 'Standalone lesson removed from grid. Bucket refilled.'

            # --- NEW: COMMIT AUDIT LOG ---
            write_audit_log(
                operator_id=operator.id if operator else None,
                action_type='DELETE',
                module='ManualGridAllocation',
                description=desc
            )

            return JsonResponse({'status': 'success', 'message': msg})
        except LessonAllocation.DoesNotExist:
            return JsonResponse({'status': 'error', 'message': 'Allocation not found.'}, status=404)
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)}, status=500)
    return JsonResponse({'status': 'error', 'message': 'Invalid request method.'}, status=405)


@require_permission('timetable.edit')
def api_toggle_lesson_lock(request, allocation_id):
    """
    Pins/unpins a single manually-placed lesson (LessonAllocation.is_locked). A locked lesson
    is skipped by both the auto-generator's clear/regenerate step and the allocation-change
    sync engine (see generate_lessons_for_scope and sync_timetable_with_allocation_changes),
    so a manual correction stays exactly where the admin put it until they explicitly unlock it.
    """
    if request.method != 'POST':
        return JsonResponse({'status': 'error', 'message': 'Method not allowed.'}, status=405)
    try:
        lesson = LessonAllocation.objects.get(id=allocation_id)
        lesson.is_locked = not lesson.is_locked
        lesson.save(update_fields=['is_locked'])

        write_audit_log(
            operator_id=request.user.id if request.user.is_authenticated else None,
            action_type='UPDATE',
            module='ManualGridAllocation',
            description=f"{'Locked' if lesson.is_locked else 'Unlocked'} {lesson.subject.name} "
                        f"for {lesson.class_stream.name} on the grid."
        )

        return JsonResponse({'status': 'success', 'is_locked': lesson.is_locked})
    except LessonAllocation.DoesNotExist:
        return JsonResponse({'status': 'error', 'message': 'Allocation not found.'}, status=404)
    except Exception as e:
        return JsonResponse({'status': 'error', 'message': str(e)}, status=500)


@require_permission('timetable.view')
def api_get_class_lessons(request, stream_id, timetable_id):
    """
    Fetches the visual grid for a specific class.
    Intelligently pulls in shared block subjects without duplicating data.
    """
    if request.method == 'GET':
        try:
            stream = ClassStream.objects.get(id=stream_id)
            grade = stream.grade

            # Pull all lessons for the entire grade to catch shared blocks
            grade_lessons = LessonAllocation.objects.filter(
                timetable_id=timetable_id, class_stream__grade=grade
            ).select_related('time_slot', 'subject', 'teacher')

            block_map = build_grade_subject_block_map(grade_ids=[grade.id])
            block_names = get_subject_block_names(block_map.values())

            data = []
            seen = set()

            for l in grade_lessons:
                block_id = block_map.get((grade.id, l.subject_id))
                # If it's a block subject, or if it explicitly belongs to this stream
                if block_id is not None or l.class_stream_id == stream.id:
                    key = f"{l.time_slot.id}_{l.subject.id}"
                    if key not in seen:
                        teacher_name = l.teacher.get_name() if callable(
                            getattr(l.teacher, 'get_name', None)) else getattr(l.teacher, 'get_name',
                                                                               f"Teacher {l.teacher.id}")

                        data.append({
                            'id': l.id,
                            'time_slot_id': l.time_slot.id,
                            'subject_name': l.subject.name,
                            'teacher_name': teacher_name,
                            'is_double': l.is_double_period,
                            'subject_block_id': block_id,
                            'subject_block_name': block_names.get(block_id) if block_id else None,
                            'is_locked': l.is_locked
                        })
                        seen.add(key)

            return JsonResponse({'status': 'success', 'data': data})
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)}, status=500)
    return JsonResponse({'status': 'error', 'message': 'Invalid request method'}, status=405)


@require_permission('timetable.view')
def api_get_master_timetable(request, timetable_id):
    """
    THE MASTER TIMETABLE: a read-only, whole-school view of every live class stream's
    schedule for a given timetable, fetched in a single query rather than one
    request per stream — the editing grid (api_get_class_lessons) is one-stream-at-a-time
    by design, but reviewing/printing the full school's schedule needs all of them at once.
    Each stream keeps its own rows here (no cross-stream block-dedup) since the frontend
    renders one column per stream — a shared option block just shows as synchronized,
    identically-timed rows across the streams that take it, exactly as they're stored.
    """
    if request.method != 'GET':
        return JsonResponse({'status': 'error', 'message': 'Method not allowed.'}, status=405)

    try:
        streams_qs = ClassStream.live.select_related('grade').order_by('grade__numeric_order', 'name')
        streams_data = [{
            'id': s.id,
            'name': s.name,
            'grade_id': s.grade_id,
            'grade_name': s.grade.name,
        } for s in streams_qs]

        # teacher__user is required, not just teacher — TeacherExtra.get_name reads
        # self.user.first_name/last_name, so without it every row re-queries the user table.
        lessons_qs = LessonAllocation.objects.filter(timetable_id=timetable_id).select_related(
            'time_slot', 'subject', 'teacher__user', 'class_stream'
        )

        lessons_data = [{
            'id': l.id,
            'time_slot_id': l.time_slot_id,
            'class_stream_id': l.class_stream_id,
            'subject_name': l.subject.name,
            'teacher_name': l.teacher.get_name,
            'is_double': l.is_double_period,
        } for l in lessons_qs]

        return JsonResponse({'status': 'success', 'data': {'streams': streams_data, 'lessons': lessons_data}})
    except Exception as e:
        return JsonResponse({'status': 'error', 'message': str(e)}, status=500)


@require_permission('timetable.view', edit_permission='timetable.edit')
def api_manage_timetables(request):
    """Fetches all timetable containers, or creates a new one."""
    if request.method == 'GET':
        timetables = Timetable.objects.all().order_by('-created_at')
        data = [{'id': t.id, 'name': t.name, 'status': t.status, 'is_active': t.is_active} for t in timetables]
        return JsonResponse({'status': 'success', 'data': data})

    elif request.method == 'POST':
        try:
            data = json.loads(request.body)
            if data.get('is_active'):
                Timetable.objects.update(is_active=False)

            Timetable.objects.create(
                name=data.get('name'),
                status=data.get('status', 'Draft'),
                is_active=data.get('is_active', False)
            )
            return JsonResponse({'status': 'success', 'message': 'Timetable container created.'})
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)})

    elif request.method == 'DELETE':
        try:
            data = json.loads(request.body)
            Timetable.objects.get(id=data.get('id')).delete()
            return JsonResponse({'status': 'success', 'message': 'Term permanently deleted.'})
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)})


@require_permission('timetable.edit')
def api_manage_timeslots(request):
    """Allows the React Admin dashboard to create and edit the Bell Schedule."""
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            slot_id = data.get('id')

            if slot_id:
                slot = TimeSlot.objects.get(id=slot_id)
                slot.day = data.get('day', slot.day)
                slot.start_time = data.get('start_time', slot.start_time)
                slot.end_time = data.get('end_time', slot.end_time)
                slot.is_global = data.get('is_global', slot.is_global)
                slot.global_label = data.get('global_label', slot.global_label)
                slot.is_remedial = data.get('is_remedial', slot.is_remedial)
                slot.save()
                msg = 'Time slot updated successfully.'
            else:
                TimeSlot.objects.create(
                    day=data.get('day'),
                    start_time=data.get('start_time'),
                    end_time=data.get('end_time'),
                    is_global=data.get('is_global', False),
                    global_label=data.get('global_label', ''),
                    is_remedial=data.get('is_remedial', False)
                )
                msg = 'New time slot created.'

            return JsonResponse({'status': 'success', 'message': msg})
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)})

    elif request.method == 'DELETE':
        try:
            data = json.loads(request.body)
            TimeSlot.objects.get(id=data.get('id')).delete()
            return JsonResponse({'status': 'success', 'message': 'Time slot permanently deleted.'})
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)})


@require_permission('timetable.view')
def api_get_teachers_by_subject(request, subject_id):
    """
    API: Teacher Roster & Subject Filter
    - If subject_id is 'all', retrieves all active teachers across the school.
    - If subject_id is numeric, filters teachers who teach that specific subject.
    """
    if request.method != 'GET':
        return JsonResponse({'status': 'error', 'message': 'Method not allowed.'}, status=405)

    try:
        # Check if caller wants the complete teacher roster (e.g., for Availability Matrix)
        if str(subject_id).lower() == 'all':
            teachers = TeacherExtra.objects.filter(status=True)
        else:
            # Parse numeric ID and fetch target subject
            subject = Subject.objects.get(id=int(subject_id))
            # Single source of truth for eligibility (see TeacherExtra.qualified_subjects)
            teachers = TeacherExtra.objects.filter(
                qualified_subjects=subject,
                status=True
            )

        # Real current weekly load (scheduled periods on the active timetable) so the
        # Availability screen's "Current Assigned Load" card shows an actual number instead
        # of always falling back to 0 — the endpoint previously never populated this at all.
        active_timetable = Timetable.objects.filter(is_active=True).first()
        load_map = {}
        if active_timetable:
            load_map = dict(
                LessonAllocation.objects.filter(timetable=active_timetable, teacher_id__in=[t.id for t in teachers])
                .values('teacher_id').annotate(c=Count('id')).values_list('teacher_id', 'c')
            )
        max_weekly_lessons = GlobalAllocationPolicy.load().max_weekly_lessons

        data = []
        for t in teachers:
            name = t.get_name() if callable(getattr(t, 'get_name', None)) else getattr(t, 'get_name', f"Teacher {t.id}")
            data.append({
                'id': t.id,
                'name': name,
                'department': getattr(t, 'department', 'General'),
                'current_load': load_map.get(t.id, 0),
                'max_weekly_lessons': max_weekly_lessons,
            })

        return JsonResponse({'status': 'success', 'data': data})

    except Subject.DoesNotExist:
        return JsonResponse({'status': 'error', 'message': 'Subject not found.'}, status=404)
    except ValueError:
        return JsonResponse({'status': 'error', 'message': 'Invalid subject identifier provided.'}, status=400)
    except Exception as e:
        return JsonResponse({'status': 'error', 'message': f"Server error: {str(e)}"}, status=500)


def generate_lessons_for_scope(timetable, streams, subject_filter=None):
    """
    THE MASTER AUTO-GENERATOR CORE:
    Fully decoupled from hardcoded strings. Uses dynamic SubjectBlocks, Teacher Contracts,
    and Administrative Policies to safely generate timetables at scale.

    Extracted from api_auto_generate_timetable so the same placement engine can be invoked two
    ways: the full "Auto-Generate" endpoint below (subject_filter=None — every stream regenerated
    in full, exactly as before), and school/utils.py's sync_timetable_with_allocation_changes,
    which calls this with a narrow subject_filter so only the specific (stream, subject) pairs
    whose SubjectAllocation contract just changed get touched — every other lesson already on the
    grid, for these same streams or any other, is left completely alone.

    subject_filter: optional {stream_id: set(subject_id)}. A stream present in `streams` but absent
    from subject_filter (or subject_filter is None entirely) is regenerated in FULL — every subject
    in its grade's quota list, matching today's whole-stream behavior. A stream present in
    subject_filter is scoped to just those subject ids: only their existing lessons get cleared
    first, and only their quotas get attempted.

    Returns (lessons_created_count, unscheduled_basket_errors).
    """
    streams = list(streams)

    # 1. Load Administrative Policies & Matrices into memory
    pedagogy_policy = TimetablePedagogyPolicy.load()
    global_policy = GlobalAllocationPolicy.load()

    # Pre-load Structural Availability (The Hard Constraint Matrix)
    unavailable_slots = set(
        TeacherStructuralAvailability.objects.values_list('teacher_id', 'time_slot_id')
    )

    # Build clean baseline sequence grids
    remedial_slots_base = list(
        TimeSlot.objects.filter(is_global=False, is_remedial=True).order_by('day', 'start_time'))
    daytime_slots_base = list(
        TimeSlot.objects.filter(is_global=False, is_remedial=False).order_by('day', 'start_time'))

    slots_by_day_base = {}
    for s in daytime_slots_base:
        slots_by_day_base.setdefault(s.day, []).append(s)

    remedial_slots_by_day_base = {}
    for s in remedial_slots_base:
        remedial_slots_by_day_base.setdefault(s.day, []).append(s)

    # Position of each daytime slot within its day's ordered sequence — lets us reason about
    # "back-to-back" and "spacing" purely in period-count terms, matching how the double-period
    # pairing logic below already treats adjacency (by list position, not by literal end/start time).
    slot_position_map = {}
    for day, day_slots in slots_by_day_base.items():
        for idx, s in enumerate(day_slots):
            slot_position_map[s.id] = (day, idx)

    # Clear whatever this call is responsible for regenerating — a full stream (subject_filter has
    # no entry for it, or is None), or just the specific subjects that changed (scoped resync).
    # is_locked=False: a manually pinned lesson is never wiped by this, whether this is a
    # targeted resync or a full Auto-Generate re-run of the whole stream.
    for stream in streams:
        clear_query = LessonAllocation.objects.filter(
            timetable=timetable, class_stream_id=stream.id, is_locked=False
        )
        scoped_subject_ids = subject_filter.get(stream.id) if subject_filter else None
        if scoped_subject_ids is not None:
            clear_query = clear_query.filter(subject_id__in=scoped_subject_ids)
        clear_query.delete()

    # Load active allocation contracts: (stream_id, subject_id) -> teacher_instance
    active_allocations = SubjectAllocation.objects.filter(
        academic_year=timetable.academic_year, term=timetable.term, is_active=True
    ).select_related('classroom', 'subject', 'teacher')
    contract_map = {(alloc.classroom.id, alloc.subject.id): alloc.teacher for alloc in active_allocations}

    allocations_created = 0
    unscheduled_basket_errors = []

    # Remedial lessons need dedicated is_remedial TimeSlots to land in — if none exist yet,
    # every remedial requirement will fail silently. Surface it once, up front, actionably.
    if not remedial_slots_base and SubjectQuota.objects.filter(remedial_lessons_required__gt=0).exists():
        unscheduled_basket_errors.append(
            "No remedial time slots are configured. Remedial lessons cannot be scheduled until "
            "at least one Remedial/Prep slot is added in Timetable Settings → Bells."
        )

    # --- IN-MEMORY OCCUPANCY STATE ---
    # Collision checks used to hit the DB for every candidate slot. Tracking occupancy in
    # memory instead lets us cheaply try several randomized layouts per stream and keep
    # whichever one schedules the most lessons.
    class GenState:
        __slots__ = ('teacher_slot_busy', 'teacher_weekly_count', 'teacher_daily_count',
                     'stream_slot_entries', 'subject_progress', 'teacher_day_positions',
                     'stream_subject_day_positions', 'stream_subject_day_count')

        def __init__(self):
            self.teacher_slot_busy = set()       # {(teacher_id, slot_id)}
            self.teacher_weekly_count = {}        # {teacher_id: count}
            self.teacher_daily_count = {}         # {(teacher_id, day): count}
            self.stream_slot_entries = {}         # {(stream_id, slot_id): [(subject_id, block_id), ...]}
            self.subject_progress = {}            # {(scope_id, subject_id): {'total','rem','dbl_rows'}}
            self.teacher_day_positions = {}       # {(teacher_id, day): {period_position, ...}}
            self.stream_subject_day_positions = {}  # {(stream_id, subject_id, day): [period_position, ...]} (singles only)
            self.stream_subject_day_count = {}    # {(stream_id, subject_id, day): count} (any kind)

        def clone(self):
            dup = GenState()
            dup.teacher_slot_busy = set(self.teacher_slot_busy)
            dup.teacher_weekly_count = dict(self.teacher_weekly_count)
            dup.teacher_daily_count = dict(self.teacher_daily_count)
            dup.stream_slot_entries = {k: list(v) for k, v in self.stream_slot_entries.items()}
            dup.subject_progress = {k: dict(v) for k, v in self.subject_progress.items()}
            dup.teacher_day_positions = {k: set(v) for k, v in self.teacher_day_positions.items()}
            dup.stream_subject_day_positions = {k: list(v) for k, v in self.stream_subject_day_positions.items()}
            dup.stream_subject_day_count = dict(self.stream_subject_day_count)
            return dup

    def can_place(state, slot, subject, teacher, s_id, b_id, also_placing=()):
        if slot.is_global:
            return True
        if pedagogy_policy.enforcement_mode == 'STRICT' and \
                state.teacher_weekly_count.get(teacher.id, 0) >= global_policy.max_weekly_lessons:
            return False
        if (teacher.id, slot.id) in unavailable_slots:
            return False
        if subject.earliest_allowed_time and slot.start_time < subject.earliest_allowed_time:
            return False
        if (teacher.id, slot.id) in state.teacher_slot_busy:
            return False
        for existing_subject_id, existing_block_id in state.stream_slot_entries.get((s_id, slot.id), ()):
            if existing_subject_id == subject.id:
                return False  # Exact duplicate
            if not b_id or existing_block_id != b_id:
                return False  # Occupied by something outside this subject's block

        # Max Consecutive Periods: teacher fatigue cap on back-to-back daytime lessons.
        # `also_placing` lets a double-period check count both halves together, since
        # neither slot is committed to state yet when the pair is evaluated.
        if pedagogy_policy.enforcement_mode == 'STRICT' and not slot.is_remedial:
            pos_info = slot_position_map.get(slot.id)
            if pos_info:
                day, pos = pos_info
                occupied = state.teacher_day_positions.get((teacher.id, day), set())
                candidate = {pos, *also_placing}
                if max_consecutive_run(occupied, candidate) > pedagogy_policy.max_consecutive_periods:
                    return False

        if pedagogy_policy.enforcement_mode == 'STRICT':
            daily_load = state.teacher_daily_count.get((teacher.id, slot.day), 0)

            # Heavy Workload Day cap — once a teacher's day is already at the threshold, no
            # more lessons of any kind (single/double/remedial) land on it. Previously this
            # only guarded single placements, so doubles/remedials could bypass it entirely.
            if daily_load >= pedagogy_policy.heavy_day_threshold:
                return False

            # Consecutive Heavy Days — once the teacher already has ANY other day at the
            # threshold this week, block this day from reaching the threshold too.
            if pedagogy_policy.prevent_consecutive_heavy_days and \
                    daily_load + 1 >= pedagogy_policy.heavy_day_threshold:
                other_heavy_day = any(
                    d != slot.day and c >= pedagogy_policy.heavy_day_threshold
                    for (t, d), c in state.teacher_daily_count.items() if t == teacher.id
                )
                if other_heavy_day:
                    return False

            # Max Daily Subject Frequency — cognitive load cap on how many times the same
            # subject can repeat for the same class on the same day.
            day_subject_count = state.stream_subject_day_count.get((s_id, subject.id, slot.day), 0)
            if day_subject_count + 1 + len(also_placing) > pedagogy_policy.max_daily_subject_frequency:
                return False

        return True

    def place(state, slot, subject, teacher, s_id, b_id, scope_id, kind):
        state.teacher_slot_busy.add((teacher.id, slot.id))
        state.teacher_weekly_count[teacher.id] = state.teacher_weekly_count.get(teacher.id, 0) + 1
        day_key = (teacher.id, slot.day)
        state.teacher_daily_count[day_key] = state.teacher_daily_count.get(day_key, 0) + 1
        state.stream_slot_entries.setdefault((s_id, slot.id), []).append((subject.id, b_id))
        prog = state.subject_progress.setdefault((scope_id, subject.id), {'total': 0, 'rem': 0, 'dbl_rows': 0})
        prog['total'] += 1
        day_subject_key = (s_id, subject.id, slot.day)
        state.stream_subject_day_count[day_subject_key] = state.stream_subject_day_count.get(day_subject_key, 0) + 1
        pos_info = slot_position_map.get(slot.id)
        if pos_info:
            pos_day, pos = pos_info
            state.teacher_day_positions.setdefault((teacher.id, pos_day), set()).add(pos)
            if kind == 'single':
                state.stream_subject_day_positions.setdefault((s_id, subject.id, pos_day), []).append(pos)
        if kind == 'rem':
            prog['rem'] += 1
        elif kind == 'double':
            prog['dbl_rows'] += 1

    committed_state = GenState()

    # Grade-scoped block lookup: a subject's block membership now depends on
    # which grade it's being scheduled for, not just the subject itself.
    block_map = build_grade_subject_block_map()
    block_structures = get_block_period_structures(block_map.values())

    # Seed state from anything left in the DB (e.g. other streams, when regenerating just one)
    # so in-memory placement doesn't clash with schedules we didn't touch this run. Only rows
    # whose (class_stream, subject) still has a live SubjectAllocation contract behind them are
    # trusted — a LessonAllocation row can outlive its contract (e.g. a Clear Grid call scoped to
    # a term/year that didn't match the active timetable, or any other path that deletes
    # SubjectAllocation without a matching lesson eject) and a stale row like that would falsely
    # mark a real teacher busy in a slot/weekly-budget they don't actually occupy anymore,
    # starving whichever subjects have the thinnest teacher coverage first.
    remaining_rows = LessonAllocation.objects.filter(timetable=timetable).values(
        'id', 'teacher_id', 'time_slot_id', 'time_slot__day', 'time_slot__is_remedial',
        'class_stream_id', 'class_stream__grade_id', 'subject_id', 'is_double_period', 'is_locked'
    )
    orphaned_lesson_ids = []
    for row in remaining_rows:
        contract_teacher = contract_map.get((row['class_stream_id'], row['subject_id']))
        contract_matches = contract_teacher is not None and contract_teacher.id == row['teacher_id']
        if not contract_matches and not row['is_locked']:
            # Not just untrusted for busy-tracking — actively delete it. Leaving it in place
            # (the old behavior) meant it stayed a physical row occupying its own
            # (timetable, slot, teacher) combination, so a fresh placement that considered that
            # slot "free" (correctly, since nothing trusted this row) could still collide with it
            # at the database's unique-constraint level the moment it tried to write there.
            orphaned_lesson_ids.append(row['id'])
            continue
        if not contract_matches and row['is_locked']:
            # A locked row is an explicit admin decision — never silently delete it just
            # because its allocation contract drifted. Surface the drift instead so an admin
            # can decide whether to unlock/fix it, and still trust it as busy below so the
            # generator doesn't double-book its teacher/slot.
            unscheduled_basket_errors.append(
                f"Locked lesson (id={row['id']}) for stream {row['class_stream_id']} no longer "
                f"matches its allocation contract — review manually."
            )
        committed_state.teacher_slot_busy.add((row['teacher_id'], row['time_slot_id']))
        committed_state.teacher_weekly_count[row['teacher_id']] = \
            committed_state.teacher_weekly_count.get(row['teacher_id'], 0) + 1
        day_key = (row['teacher_id'], row['time_slot__day'])
        committed_state.teacher_daily_count[day_key] = committed_state.teacher_daily_count.get(day_key, 0) + 1

        b_id = block_map.get((row['class_stream__grade_id'], row['subject_id']))
        committed_state.stream_slot_entries.setdefault(
            (row['class_stream_id'], row['time_slot_id']), []
        ).append((row['subject_id'], b_id))

        # Progress/quota fulfillment is always tracked per stream, never per grade — even for a
        # block subject, each stream (real or virtual split group) has its own independent weekly
        # quota to fill. Grade-scoping this let one split group's lessons satisfy the quota for
        # every other group of the same subject, silently leaving them at zero (see the matching
        # note at the scope_id assignment in the main placement loop below).
        prog = committed_state.subject_progress.setdefault(
            (row['class_stream_id'], row['subject_id']), {'total': 0, 'rem': 0, 'dbl_rows': 0})
        prog['total'] += 1
        if row['time_slot__is_remedial']:
            prog['rem'] += 1
        if row['is_double_period']:
            prog['dbl_rows'] += 1

        day_subject_key = (row['class_stream_id'], row['subject_id'], row['time_slot__day'])
        committed_state.stream_subject_day_count[day_subject_key] = \
            committed_state.stream_subject_day_count.get(day_subject_key, 0) + 1

        pos_info = slot_position_map.get(row['time_slot_id'])
        if pos_info:
            pos_day, pos = pos_info
            committed_state.teacher_day_positions.setdefault((row['teacher_id'], pos_day), set()).add(pos)
            if not row['is_double_period']:
                committed_state.stream_subject_day_positions.setdefault(
                    (row['class_stream_id'], row['subject_id'], pos_day), []
                ).append(pos)

    if orphaned_lesson_ids:
        LessonAllocation.objects.filter(id__in=orphaned_lesson_ids).delete()

    N_SHUFFLE_ATTEMPTS = 6
    run_salt = random.random()
    split_subject_ids_by_grade = {}

    with transaction.atomic():
        for stream in streams:
            grade = stream.grade
            quotas = list(SubjectQuota.objects.filter(grade=grade).select_related('subject'))
            if not stream.is_virtual:
                # A subject routed through virtual split groups is no longer this physical
                # stream's to schedule — it has no contract for it by design (see
                # get_subjects_with_active_virtual_groups), and leaving it in `quotas` here just
                # produces a false "no teacher assigned" warning below for every such subject on
                # every physical stream, even though nothing is actually missing.
                split_subject_ids = split_subject_ids_by_grade.setdefault(
                    grade.id, get_subjects_with_active_virtual_groups(grade.id))
                quotas = [q for q in quotas if q.subject_id not in split_subject_ids]
            scoped_subject_ids = subject_filter.get(stream.id) if subject_filter else None
            if scoped_subject_ids is not None:
                quotas = [q for q in quotas if q.subject_id in scoped_subject_ids]

            # Resolve teacher contracts once. No priority sorting of any kind here or below —
            # every subject gets a fresh, fully randomized shot at the available slots.
            schedulable = []
            for quota in quotas:
                subject = quota.subject
                allocated_teacher = contract_map.get((stream.id, subject.id))
                if not allocated_teacher:
                    # A virtual split-group stream (e.g. "Computer Studies - Group 2") only ever
                    # legitimately holds the one subject it was split for — its grade's full quota
                    # list otherwise floods this with false-positive noise ("no English teacher for
                    # Group 2", which was never meant to have one). Silence that noise specifically
                    # for virtual streams; a real stream missing a contract is still worth flagging.
                    if not stream.is_virtual:
                        unscheduled_basket_errors.append(
                            f"Skipped {stream.name} - {subject.name}: No teacher assigned in Allocation Panel.")
                    continue
                schedulable.append((quota, subject, allocated_teacher, block_map.get((grade.id, subject.id))))

            best_state = None
            best_lessons = None
            best_shortfall = None
            best_rem_shortfall = None
            best_lesson_shortfall = None

            for attempt in range(N_SHUFFLE_ATTEMPTS):
                state = committed_state.clone()
                lessons_this_attempt = []
                rem_shortfall = 0
                lesson_shortfall = 0

                ordered = list(schedulable)
                random.shuffle(ordered)

                for quota, subject, allocated_teacher, block_id in ordered:
                    # Always stream-scoped, never grade-scoped — a block only synchronizes WHICH
                    # slot different streams land their (possibly different) block subjects in
                    # (see block_seed below); it must not merge their quota progress. Grade-scoping
                    # this used to let one virtual split group's placements (e.g. "French - Group
                    # 1") satisfy the shared (grade, subject) counter and leave every other group
                    # of the same subject (e.g. "French - Group 2") silently scheduled at zero,
                    # since each group is really a separate class with its own students and its
                    # own quota to fill, not a shared session across groups.
                    scope_id = stream.id
                    prog = state.subject_progress.setdefault(
                        (scope_id, subject.id), {'total': 0, 'rem': 0, 'dbl_rows': 0})

                    # --- DYNAMIC SYNCHRONIZATION SEED ---
                    # Same seed for every subject sharing a block (within this attempt) so their
                    # candidate slot order lines up and they gravitate to the same shared slot.
                    block_seed = f"Block_{block_id}" if block_id else f"Solo_{subject.id}_{stream.id}"
                    rng = random.Random(f"{grade.id}_{block_seed}_{attempt}_{run_salt}")

                    rem_slots = list(remedial_slots_base)
                    rng.shuffle(rem_slots)
                    single_slots = list(daytime_slots_base)
                    rng.shuffle(single_slots)
                    days = list(slots_by_day_base.keys())
                    rng.shuffle(days)

                    # --- REMEDIAL PLACEMENT ---
                    rem_needed = max(0, quota.remedial_lessons_required - prog['rem'])
                    if pedagogy_policy.allow_remedial_double_periods:
                        rem_tasks = ['double'] * (rem_needed // 2) + ['single'] * (rem_needed % 2)
                    else:
                        rem_tasks = ['single'] * rem_needed
                    rng.shuffle(rem_tasks)

                    for rem_task in rem_tasks:
                        if rem_task == 'double':
                            placed = False
                            day_order = list(remedial_slots_by_day_base.keys())
                            rng.shuffle(day_order)
                            for day in day_order:
                                day_rem_slots = remedial_slots_by_day_base[day]
                                pair_order = list(range(len(day_rem_slots) - 1))
                                rng.shuffle(pair_order)
                                for i in pair_order:
                                    r1, r2 = day_rem_slots[i], day_rem_slots[i + 1]
                                    if can_place(state, r1, subject, allocated_teacher, stream.id, block_id) and \
                                            can_place(state, r2, subject, allocated_teacher, stream.id, block_id):
                                        place(state, r1, subject, allocated_teacher, stream.id, block_id,
                                              scope_id, 'rem')
                                        place(state, r2, subject, allocated_teacher, stream.id, block_id,
                                              scope_id, 'rem')
                                        lessons_this_attempt.append(dict(
                                            time_slot=r1, class_stream=stream, subject=subject,
                                            teacher=allocated_teacher, is_double_period=True))
                                        lessons_this_attempt.append(dict(
                                            time_slot=r2, class_stream=stream, subject=subject,
                                            teacher=allocated_teacher, is_double_period=True))
                                        placed = True
                                        break
                                if placed:
                                    break
                            if not placed:
                                # No adjacent remedial pair available — fold both periods back into
                                # singles instead of dropping the requirement, same pattern as daytime doubles.
                                rem_tasks.append('single')
                                rem_tasks.append('single')
                        else:
                            for slot in rem_slots:
                                if can_place(state, slot, subject, allocated_teacher, stream.id, block_id):
                                    place(state, slot, subject, allocated_teacher, stream.id, block_id,
                                          scope_id, 'rem')
                                    lessons_this_attempt.append(dict(
                                        time_slot=slot, class_stream=stream, subject=subject,
                                        teacher=allocated_teacher, is_double_period=False))
                                    break
                            else:
                                rem_shortfall += 1

                    # --- DOUBLE + SINGLE PERIODS, SHUFFLED TOGETHER ---
                    # Instead of placing every double period before any single (which tends to
                    # pile doubles onto a handful of days and leave others single-only), queue
                    # both kinds of lesson together and shuffle the order they're attempted in.
                    #
                    # A block's period_structure (Subject Block Builder) overrides the stored
                    # quota split at placement time — a safety net so a manually-edited quota
                    # that drifted from the block's setting still gets scheduled correctly.
                    block_structure = block_structures.get(block_id, 'MIXED') if block_id else 'MIXED'
                    if block_structure == 'ALL_DOUBLE':
                        dbl_target = quota.total_lessons // 2
                    elif block_structure == 'ALL_SINGLE':
                        dbl_target = 0
                    else:
                        dbl_target = quota.double_lessons_required
                    if not getattr(subject, 'allow_double_periods', True):
                        dbl_target = 0
                    dbl_needed = max(0, dbl_target - (prog['dbl_rows'] // 2))
                    single_budget = max(0, quota.total_lessons - prog['total'] - 2 * dbl_needed)

                    tasks = ['double'] * dbl_needed + ['single'] * single_budget
                    rng.shuffle(tasks)

                    for task in tasks:
                        if task == 'double':
                            placed = False
                            day_order = list(days)
                            rng.shuffle(day_order)
                            for day in day_order:
                                day_slots = slots_by_day_base[day]
                                pair_order = list(range(len(day_slots) - 1))
                                rng.shuffle(pair_order)
                                for i in pair_order:
                                    s1, s2 = day_slots[i], day_slots[i + 1]
                                    # Evaluate the pair together so the consecutive-periods cap sees
                                    # both halves at once, not just whichever slot is checked first.
                                    if can_place(state, s1, subject, allocated_teacher, stream.id, block_id,
                                                 also_placing={i + 1}) and \
                                            can_place(state, s2, subject, allocated_teacher, stream.id, block_id,
                                                      also_placing={i}):
                                        place(state, s1, subject, allocated_teacher, stream.id, block_id,
                                              scope_id, 'double')
                                        place(state, s2, subject, allocated_teacher, stream.id, block_id,
                                              scope_id, 'double')
                                        lessons_this_attempt.append(dict(
                                            time_slot=s1, class_stream=stream, subject=subject,
                                            teacher=allocated_teacher, is_double_period=True))
                                        lessons_this_attempt.append(dict(
                                            time_slot=s2, class_stream=stream, subject=subject,
                                            teacher=allocated_teacher, is_double_period=True))
                                        placed = True
                                        break
                                if placed:
                                    break
                            if not placed:
                                # Couldn't fit as a double — fold the two periods back in as
                                # singles instead of just dropping them.
                                tasks.append('single')
                                tasks.append('single')
                        else:
                            placed = False
                            for slot in single_slots:
                                if not can_place(state, slot, subject, allocated_teacher, stream.id, block_id):
                                    continue
                                # Minimum Subject Spacing — keep two single lessons of the same
                                # subject, same class, same day from landing too close together.
                                if pedagogy_policy.enforcement_mode == 'STRICT':
                                    pos_info = slot_position_map.get(slot.id)
                                    if pos_info:
                                        day, pos = pos_info
                                        existing_positions = state.stream_subject_day_positions.get(
                                            (stream.id, subject.id, day), [])
                                        if any(abs(pos - p) < pedagogy_policy.min_subject_spacing_periods
                                               for p in existing_positions):
                                            continue
                                place(state, slot, subject, allocated_teacher, stream.id, block_id,
                                      scope_id, 'single')
                                lessons_this_attempt.append(dict(
                                    time_slot=slot, class_stream=stream, subject=subject,
                                    teacher=allocated_teacher, is_double_period=False))
                                placed = True
                                break
                            if not placed:
                                lesson_shortfall += 1

                total_shortfall = rem_shortfall + lesson_shortfall
                if best_shortfall is None or total_shortfall < best_shortfall:
                    best_shortfall = total_shortfall
                    best_rem_shortfall = rem_shortfall
                    best_lesson_shortfall = lesson_shortfall
                    best_state = state
                    best_lessons = lessons_this_attempt
                if best_shortfall == 0:
                    break  # a fully-scheduled layout was found, no need to keep exploring

            if best_lessons:
                LessonAllocation.objects.bulk_create(
                    [LessonAllocation(timetable=timetable, **kwargs) for kwargs in best_lessons]
                )
                allocations_created += len(best_lessons)
            if best_state is not None:
                committed_state = best_state
            if best_lesson_shortfall:
                unscheduled_basket_errors.append(
                    f"{stream.name}: {best_lesson_shortfall} lesson period(s) could not be scheduled after "
                    f"{N_SHUFFLE_ATTEMPTS} randomized attempts — check teacher availability or slot capacity."
                )
            if best_rem_shortfall:
                unscheduled_basket_errors.append(
                    f"{stream.name}: {best_rem_shortfall} remedial period(s) could not be scheduled — "
                    f"check that enough Remedial/Prep slots exist and the teacher is free during them."
                )

    return allocations_created, unscheduled_basket_errors


@require_permission('timetable.edit')
def api_auto_generate_timetable(request, timetable_id):
    """
    THE MASTER AUTO-GENERATOR ENDPOINT: validates synchronously (fast enough to keep as an
    instant response), then hands the actual scheduling run — the expensive part, a
    constraint-satisfaction loop across every class/stream — to a Celery worker via
    generate_timetable_task, returning 202 + a BackgroundJob id immediately instead of
    blocking this request for the whole computation. Poll GET /api/jobs/<job_id>/ for
    the result, shaped exactly like the old synchronous success/error JSON below.
    """
    if request.method != 'POST':
        return JsonResponse({'status': 'error', 'message': 'Method not allowed.'}, status=405)

    stream_id = request.GET.get('stream_id')
    grade_id = request.GET.get('grade_id')
    scope_all = request.GET.get('scope') == 'all'
    # Scope must be explicit — one of a single class, a whole grade, or a confirmed
    # whole-school run — instead of silently defaulting to "every stream in the school"
    # when nothing is passed, mirroring the explicit scope contract Bulk Allocation and
    # this same screen's Clear Grid feature already use.
    if not stream_id and not grade_id and not scope_all:
        return JsonResponse({
            'status': 'error',
            'message': 'Scope required: pass stream_id, grade_id, or scope=all.'
        }, status=400)

    # Scoped per timetable — the task itself acquires this (with retry) once it actually
    # starts running, not here, so a second submission while one is already generating
    # gets queued and auto-processed instead of rejected. See orchestration/tasks.py.
    lock_key = f"generate_lock_timetable_{timetable_id}"

    try:
        timetable = Timetable.objects.get(id=timetable_id)
        year_ctx = timetable.academic_year or AcademicYear.objects.filter(is_active=True).first()
        term_ctx = timetable.term or ExamTerm.objects.filter(is_active=True).first()

        if not year_ctx or not term_ctx:
            return JsonResponse(
                {'status': 'error', 'message': 'No active Academic Year or Term found in system settings.'},
                status=400
            )

        # Automatically link them back to the timetable record so it doesn't stay unassigned
        if not timetable.academic_year or not timetable.term:
            timetable.academic_year = year_ctx
            timetable.term = term_ctx
            timetable.save()

        # --- WHOLE-SCHOOL ALLOCATION COMPLETENESS GATE ---
        # A schedule built on an incomplete allocation is guaranteed to have holes — refuse to
        # generate until every class (real and virtual) in this term/year has a teacher for
        # every required subject.
        gaps = compute_school_allocation_gaps(term_ctx.id, year_ctx.id)
        if gaps:
            gap_summary = "; ".join(
                f"{g['class_name']}: {', '.join(g['missing_subjects'])}" for g in gaps[:10]
            )
            more = f" (+{len(gaps) - 10} more class(es))" if len(gaps) > 10 else ""
            return JsonResponse({
                'status': 'error',
                'message': f"Timetable cannot be generated — {len(gaps)} class(es) have incomplete "
                           f"teacher allocations: {gap_summary}{more}. Finish allocating every class "
                           f"before generating the timetable.",
                'allocation_gaps': gaps,
            }, status=400)

        operator = request.user if request.user.is_authenticated else None
        job, error_response = dispatch_background_job(
            job_type='generate_timetable',
            task=generate_timetable_task,
            task_args=(timetable_id, stream_id, grade_id, lock_key, operator.id if operator else None),
            operator=operator,
        )
        if error_response is not None:
            return JsonResponse(error_response.data, status=error_response.status_code)

        payload = {'status': 'queued', 'job_id': str(job.id)}
        if cache.get(lock_key):
            payload['note'] = "Another generation run for this timetable is currently in progress — " \
                               "yours has been queued and will start automatically once it finishes."
        return JsonResponse(payload, status=202)

    except Timetable.DoesNotExist:
        return JsonResponse({'status': 'error', 'message': 'Timetable not found.'})
    except Exception as e:
        return JsonResponse({'status': 'error', 'message': f"Engine Abort: {str(e)}"}, status=500)


def sync_timetable_with_allocation_changes(*, active_timetable, prior_triples, new_triples):
    """
    Keeps an already-generated Timetable in step with a SubjectAllocation change, instead of only
    ejecting orphaned lessons and leaving a gap for an admin to remember to manually regenerate.
    Called by school/views/teacherAllocation_view.py's Matrix/Bulk/Rollover save paths, ONCE per
    request with the FULL set of that request's contract changes — never once per class — since a
    single save (especially a whole-grade Bulk Allocate) can touch dozens of classes at once, and
    processing them one at a time against the live DB would let an earlier swap in the request
    silently steal a slot a later swap in the SAME request also needed. This function computes
    everything in memory first and only writes once it knows the whole batch's outcome, which is
    what makes it safe to call as one unit for an arbitrarily large batch.

    Lives here (not school/utils.py) because it must call generate_lessons_for_scope above, and
    views_timetable.py already imports from school.utils — the reverse import would be circular.

    prior_triples / new_triples: sets of (classroom_id, teacher_id, subject_id) — "before" and
    "after" for every contract in the request's scope (e.g. every SubjectAllocation row for one
    class's Matrix save, or every row across a whole grade's Bulk Allocate).

    Returns {"ejected_count": int, "swapped_count": int, "locked_skipped_count": int,
    "needs_regeneration": {stream_id: {subject_id, ...}}}.
    A non-empty needs_regeneration means those (stream, subject) pairs couldn't be moved in place
    (brand-new contract with nothing on the grid yet, or the new teacher is busy/blacked-out in the
    old slots) and were instead cleared and handed to generate_lessons_for_scope for a targeted,
    surgical regeneration — every other lesson on the timetable, for these streams or any other,
    is left untouched. locked_skipped_count is how many manually-pinned lessons (is_locked=True)
    were left exactly as-is despite their contract changing/dropping — an explicit admin decision
    always wins over this automatic sync.
    """
    result = {"ejected_count": 0, "swapped_count": 0, "locked_skipped_count": 0, "needs_regeneration": {}}
    if not active_timetable:
        return result

    prior_by_cs = {(c_id, s_id): t_id for c_id, t_id, s_id in prior_triples}
    new_by_cs = {(c_id, s_id): t_id for c_id, t_id, s_id in new_triples}

    # Pairs dropped entirely (no longer in the new set at all) — identical to the old ejection-only
    # behavior these call sites already had ("ghost contract" cleanup). Locked lessons are excluded
    # from the deletion — an admin's manual pin survives even a dropped contract.
    dropped_pairs = set(prior_by_cs) - set(new_by_cs)
    for c_id, s_id in dropped_pairs:
        stale = LessonAllocation.objects.filter(
            timetable=active_timetable, class_stream_id=c_id, subject_id=s_id
        )
        result["locked_skipped_count"] += stale.filter(is_locked=True).count()
        stale = stale.filter(is_locked=False)
        result["ejected_count"] += stale.count()
        stale.delete()

    # Pairs that are brand new or changed teacher — candidates for an in-place slot swap.
    changed_pairs = [
        (c_id, s_id, new_t_id) for (c_id, s_id), new_t_id in new_by_cs.items()
        if prior_by_cs.get((c_id, s_id)) != new_t_id
    ]
    if not changed_pairs:
        return result

    touched_pairs = {(c_id, s_id) for c_id, s_id, _ in changed_pairs}

    existing_lessons_by_pair = {}
    claimed_slots = set()
    locked_pairs_covered = set()
    for lesson in LessonAllocation.objects.filter(timetable=active_timetable).only(
        'id', 'teacher_id', 'time_slot_id', 'class_stream_id', 'subject_id', 'is_locked'
    ):
        key = (lesson.class_stream_id, lesson.subject_id)
        if lesson.is_locked:
            # A locked lesson is never a swap/regen candidate — but it still physically
            # occupies its teacher+slot, so every other pair's conflict check must keep
            # treating that combination as claimed, whether or not this locked lesson's own
            # pair is one of this batch's touched_pairs.
            claimed_slots.add((lesson.teacher_id, lesson.time_slot_id))
            if key in touched_pairs:
                locked_pairs_covered.add(key)
                result["locked_skipped_count"] += 1
            continue
        if key in touched_pairs:
            existing_lessons_by_pair.setdefault(key, []).append(lesson)
        else:
            # Seeds claimed_slots from every lesson NOT being touched by this batch, so a swap
            # can't silently double-book a teacher who's busy elsewhere on the grid.
            claimed_slots.add((lesson.teacher_id, lesson.time_slot_id))

    blackout_slots = set(TeacherStructuralAvailability.objects.values_list('teacher_id', 'time_slot_id'))

    accepted_swaps = []  # [(c_id, s_id, new_t_id, [lesson, ...])]
    needs_regeneration = {}

    for c_id, s_id, new_t_id in changed_pairs:
        if (c_id, s_id) in locked_pairs_covered:
            # This pair's placement is pinned by a locked lesson — leave it exactly as the
            # admin set it, even though the contract behind it just changed teacher. Don't
            # send it to needs_regeneration, which would otherwise place a second lesson for
            # the same (stream, subject) alongside the locked one.
            continue
        existing = existing_lessons_by_pair.get((c_id, s_id), [])
        if not existing:
            # Brand-new contract — nothing on the grid to move, so it just needs a slot found.
            needs_regeneration.setdefault(c_id, set()).add(s_id)
            continue

        conflict = any(
            (new_t_id, lesson.time_slot_id) in blackout_slots
            or (new_t_id, lesson.time_slot_id) in claimed_slots
            for lesson in existing
        )
        if conflict:
            LessonAllocation.objects.filter(id__in=[l.id for l in existing]).delete()
            needs_regeneration.setdefault(c_id, set()).add(s_id)
        else:
            # Reserve these slots against the REST of this same batch before moving on, so a
            # later swap in this request can't also claim them out from under this one.
            for lesson in existing:
                claimed_slots.add((new_t_id, lesson.time_slot_id))
            accepted_swaps.append((c_id, s_id, new_t_id, existing))

    for c_id, s_id, new_t_id, existing in accepted_swaps:
        updated = LessonAllocation.objects.filter(id__in=[l.id for l in existing]).update(teacher_id=new_t_id)
        result["swapped_count"] += updated

    if needs_regeneration:
        streams = list(ClassStream.objects.filter(id__in=needs_regeneration.keys()).select_related('grade'))
        generate_lessons_for_scope(active_timetable, streams, subject_filter=needs_regeneration)

    result["needs_regeneration"] = needs_regeneration
    return result


@require_permission('timetable.edit')
def api_auto_generate_quotas(request):
    """
    Intelligently generates default Subject Quotas matching Kenyan MoE and CBC structural frameworks.
    Fully decoupled from string-matching code; relies strictly on database attributes, categories,
    and block definitions.
    """
    if request.method != 'POST':
        return JsonResponse({'status': 'error', 'message': 'Method not allowed.'}, status=405)

    try:
        grades = GradeLevel.objects.all()
        subjects = Subject.live.select_related('department').all()
        block_map = build_grade_subject_block_map()
        block_structures = get_block_period_structures(block_map.values())
        quotas_created_or_updated = 0
        scaling_notes = []

        # Every class stream only has this many real weekly periods to work with — quotas
        # that add up to more than this can never be fully scheduled, no matter how the
        # generator shuffles things. Leave a slice of headroom so the scheduler has room to
        # route around teacher clashes instead of needing a perfectly packed grid.
        daytime_capacity = TimeSlot.objects.filter(is_global=False, is_remedial=False).count()
        remedial_capacity = TimeSlot.objects.filter(is_global=False, is_remedial=True).count()
        SAFETY_MARGIN = 0.9

        # Config-driven override for the generic department/grade-band ladder below (see
        # QuotaDefaultRule docstring) — an admin can add/edit rows here (Django admin) to
        # adjust or extend those defaults without a code change. Fetched once, not per
        # subject/grade: an empty table (the default, on every existing install) means every
        # lookup below returns None and the hardcoded ladder behaves exactly as before.
        quota_rules = {
            (r.department_id, r.grade_band, r.applies_when_blocked): r
            for r in QuotaDefaultRule.objects.all()
        }

        # 'Technical, Applied & Computer Studies' and 'Business & Agricultural Studies' both
        # inherit the old undifferentiated 'Technical' bucket's ladder treatment below — see
        # backfill_departments for why that single old bucket split into these two real
        # departments. Renaming/removing these three names changes the ladder's behavior for
        # that department; add a QuotaDefaultRule row instead of relying on the name match.
        TECHNICAL_LIKE_DEPARTMENTS = {'Technical, Applied & Computer Studies', 'Business & Agricultural Studies'}
        HUMANITIES_DEPARTMENT = 'Humanities & Religious Education'
        PE_DEPARTMENT = 'Physical Education & Sports Science'

        def _quota_grade_band(grade_num):
            if grade_num <= 3:
                return 'LOWER_PRIMARY'
            if grade_num <= 6:
                return 'UPPER_PRIMARY'
            if grade_num <= 9:
                return 'JUNIOR_SECONDARY'
            return 'SENIOR_SCHOOL'

        def _quota_rule_override(dept_id, grade_band, is_blocked):
            rule = quota_rules.get((dept_id, grade_band, is_blocked))
            if rule is None and is_blocked:
                rule = quota_rules.get((None, grade_band, True))  # wildcard blocked-elective default
            return rule

        with transaction.atomic():
            for grade in grades:
                grade_num = grade.numeric_order
                grade_plan = []  # [subject, total, double, remedial]

                # Respect SubjectCurriculumProfile tagging: a subject assigned to a specific
                # curriculum/tier (e.g. Integrated Science -> CBC Junior only) must not get a
                # quota generated for grades outside that scope. Grades that predate curriculum
                # assignment (curriculum_id is None) keep the old unfiltered behavior. Also pull
                # each subject's profile overrides here — when an admin has set exact numbers on
                # Curriculum Hub, those are authoritative and the generic department/grade-band
                # table below never runs for that subject.
                eligible_ids = None
                profile_overrides = {}
                if grade.curriculum_id:
                    resolved = _eligible_subjects_for(grade.curriculum, grade.tier)
                    eligible_ids = {s.id for s, *_ in resolved}
                    for s, _is_core, total_override, double_override, remedial_override in resolved:
                        if total_override is not None:
                            profile_overrides[s.id] = (
                                total_override,
                                double_override or 0,
                                remedial_override if remedial_override is not None else 1,
                            )

                for sub in subjects:
                    if eligible_ids is not None and sub.id not in eligible_ids:
                        continue

                    # Fetch database properties safely (block membership is grade-scoped)
                    is_blocked = block_map.get((grade.id, sub.id)) is not None
                    # Curriculum-aware: CBC and 8-4-4 group subjects into different departments
                    # (see Department model docstring), so this grade's own curriculum decides
                    # which department applies, not a single flat Subject.department.
                    effective_dept = get_effective_department(sub, grade.curriculum, grade.tier)
                    dept = effective_dept.name if effective_dept else ''

                    if sub.id in profile_overrides:
                        # An admin has explicitly configured this subject's quota on Curriculum
                        # Hub (SubjectCurriculumProfile) — use it verbatim. Department/grade-band
                        # is irrelevant on this path, so adding new departments or grade bands
                        # later never requires touching this function again.
                        total, double, remedial = profile_overrides[sub.id]
                    else:
                        total, double, remedial = 0, 0, 1  # Default baseline policy requirement

                        # Generic fallback for subjects with no Curriculum Hub override yet.
                        # Figures are grounded in real KICD/CBC weekly time-allocation guidance
                        # (Junior Secondary ~5 lessons/week per core learning area; Senior School
                        # core/elective subjects at 5, ICT at 2, PE at 3) rather than the inflated
                        # placeholder numbers this table used to carry.

                        # 1. PHYSICAL EDUCATION POLICY
                        if dept == PE_DEPARTMENT or getattr(sub, 'is_pe_only', False):
                            total = 3 if grade_num >= 10 else 2
                            double, remedial = 0, 0

                        # 2. LOWER PRIMARY (Grades 1 - 3)
                        elif grade_num <= 3:
                            if dept in ('Languages', 'Mathematics'):
                                total, double = 6, 1
                            elif dept in ('Sciences', HUMANITIES_DEPARTMENT):
                                total, double = 4, 0

                        # 3. UPPER PRIMARY (Grades 4 - 6)
                        elif 4 <= grade_num <= 6:
                            if dept in ('Languages', 'Mathematics'):
                                total, double = 6, 1
                            elif dept == 'Sciences':
                                total, double = 5, 1
                            elif dept in TECHNICAL_LIKE_DEPARTMENTS:
                                total, double = 4, 1  # e.g. Agriculture, tagged Technical
                            elif dept == HUMANITIES_DEPARTMENT:
                                total, double = 4, 0

                        # 4. JUNIOR SECONDARY SCHOOL (Grades 7 - 9)
                        elif 7 <= grade_num <= 9:
                            if dept in ('Languages', 'Mathematics'):
                                total, double = 5, 1
                            elif dept == 'Sciences':
                                total, double = 5, 1
                            elif dept == HUMANITIES_DEPARTMENT:
                                total, double = 4, 0
                            elif is_blocked or dept in TECHNICAL_LIKE_DEPARTMENTS:
                                total, double = 5, 2  # Blocked optionals / Pre-Technical structure
                            else:
                                total, double = 4, 0  # Standalone minor options

                        # 5. SENIOR SCHOOL (Grades 10 - 12 / Form 1 - 4)
                        elif grade_num >= 10:
                            if is_blocked:
                                total, double = 5, 2  # Pathway option blocks (real elective figure)
                            elif dept in TECHNICAL_LIKE_DEPARTMENTS:
                                total, double = 2, 0  # Standalone ICT-type subject
                            elif dept in ('Languages', 'Mathematics'):
                                total, double = 5, 0  # Core academic tracking
                            elif dept == 'Sciences':
                                total, double = 5, 1  # Keeps a double for labs
                            elif dept == HUMANITIES_DEPARTMENT:
                                total, double = 1, 0  # Pastoral/RE-style support subject

                        # QuotaDefaultRule override: an admin-configured row for this exact
                        # (department, grade-band, blocked) combination wins over whichever
                        # hardcoded figure the ladder above just computed. No-op while the
                        # table is empty, so this never changes behavior until an admin
                        # opts in by adding a row.
                        override_rule = _quota_rule_override(sub.department_id, _quota_grade_band(grade_num), is_blocked)
                        if override_rule:
                            total = override_rule.total_lessons
                            double = override_rule.double_lessons_required
                            remedial = override_rule.remedial_lessons_required

                    # Block period structure override: once a subject sits in a block, the
                    # block's own ALL_DOUBLE/ALL_SINGLE choice (Subject Block Builder) takes
                    # precedence over the curriculum-tier default above — e.g. a Technical
                    # option block that's practical-only should never generate single periods.
                    if is_blocked and total > 0:
                        structure = block_structures.get(block_map[(grade.id, sub.id)], 'MIXED')
                        if structure == 'ALL_DOUBLE':
                            double = total // 2
                        elif structure == 'ALL_SINGLE':
                            double = 0

                    if total > 0:
                        grade_plan.append([sub, total, double, remedial])

                # --- CAPACITY CHECK: PRIORITY-TIERED TRIMMING ---
                # Subjects sharing a block occupy the SAME slot across the grade, so they only
                # cost the week's capacity once, not once each.
                def _effective_demand(plan):
                    seen, demand = set(), 0
                    for entry in plan:
                        bid = block_map.get((grade.id, entry[0].id))
                        if bid:
                            if bid in seen:
                                continue
                            seen.add(bid)
                        demand += entry[1]
                    return demand

                if daytime_capacity > 0:
                    budget = daytime_capacity * SAFETY_MARGIN
                    effective_demand = _effective_demand(grade_plan)

                    if effective_demand > budget > 0:
                        original_totals = {entry[0].id: entry[1] for entry in grade_plan}
                        block_groups = {}
                        for entry in grade_plan:
                            bid = block_map.get((grade.id, entry[0].id))
                            if bid:
                                block_groups.setdefault(bid, []).append(entry)

                        # Priority tiers: 0 = protected longest (cut last), 3 = cut first.
                        # Core, examinable Kenyan-curriculum subjects (Languages, Mathematics,
                        # then Sciences) are trimmed last; standalone electives absorb the cut
                        # first. Order within a tier is shuffled each run so it's not always the
                        # same subjects taking the hit.
                        #
                        # Blocked subjects are the ONE exception: cutting a block by 1 lesson only
                        # saves the same single effective-demand unit as cutting a standalone
                        # subject by 1 (blocks are already deduped to cost the week once), but that
                        # one cut lands on every member subject simultaneously — so trimming a
                        # block is strictly less budget-efficient per subject harmed than trimming
                        # a standalone elective. Blocks are protected (tier 0) instead of
                        # sacrificed first purely for being "Technical".
                        def _priority_tier(sub):
                            effective_dept = get_effective_department(sub, grade.curriculum, grade.tier)
                            dept = effective_dept.name if effective_dept else ''
                            if block_map.get((grade.id, sub.id)) is not None:
                                return 0
                            if dept in TECHNICAL_LIKE_DEPARTMENTS:
                                return 3
                            if dept == HUMANITIES_DEPARTMENT:
                                return 2
                            if dept == 'Sciences':
                                return 1
                            if dept in ('Languages', 'Mathematics'):
                                return 0
                            return 3

                        tiers = {0: [], 1: [], 2: [], 3: []}
                        for entry in grade_plan:
                            tiers[_priority_tier(entry[0])].append(entry)

                        for tier_num in (3, 2, 1, 0):
                            if effective_demand <= budget:
                                break
                            tier_entries = tiers[tier_num]
                            random.shuffle(tier_entries)

                            # De-duplicate into groups: subjects sharing a block move together
                            # as one group (they only cost the week once anyway); subjects with
                            # no block stay independent, one group each.
                            groups = []
                            seen_block_ids = set()
                            for entry in tier_entries:
                                subj_bid = block_map.get((grade.id, entry[0].id))
                                if subj_bid:
                                    if subj_bid in seen_block_ids:
                                        continue
                                    seen_block_ids.add(subj_bid)
                                    groups.append(block_groups[subj_bid])
                                else:
                                    groups.append([entry])

                            # Round-robin: shave 1 lesson off every still-eligible group per pass
                            # instead of fully draining one subject to its floor before moving to
                            # the next — spreads the cut evenly across the tier so two subjects in
                            # the same tier (e.g. two Languages) don't end up wildly uneven.
                            progress = True
                            while effective_demand > budget and progress:
                                progress = False
                                for group in groups:
                                    if effective_demand <= budget:
                                        break
                                    if all(g[1] > min(2, original_totals[g[0].id]) for g in group):
                                        for g in group:
                                            g[1] -= 1
                                            g[2] = min(g[2], g[1] // 2)
                                        effective_demand = _effective_demand(grade_plan)
                                        progress = True

                        if effective_demand > budget:
                            # Tiers exhausted at their floors and still over — flat scale as a
                            # last-resort safety net so the grade always fits.
                            scale = budget / effective_demand
                            for entry in grade_plan:
                                new_total = max(1, round(entry[1] * scale))
                                new_double = min(round(entry[2] * scale), new_total // 2)
                                entry[1], entry[2] = new_total, new_double
                            effective_demand = _effective_demand(grade_plan)

                        scaling_notes.append(
                            f"{grade.name} priority-trimmed to fit weekly capacity "
                            f"({effective_demand}/{daytime_capacity} periods)"
                        )

                # --- REMEDIAL CAPACITY CHECK: FAIR SHUFFLE ---
                # Remedial slots are a separate, much smaller pool (early/late prep periods)
                # than daytime capacity — flatly giving every subject remedial=1 regardless of
                # how many subjects exist would overcommit that pool and leave the timetable
                # generator unable to place them all. Trim the same way daytime demand does:
                # dedupe blocked subjects (they share one remedial slot too), then randomly drop
                # entries to 0 until it fits — reshuffled every run so it's not always the same
                # subjects losing their remedial slot.
                if remedial_capacity > 0:
                    remedial_budget = remedial_capacity * SAFETY_MARGIN

                    def _effective_remedial_demand(plan):
                        seen, demand = set(), 0
                        for entry in plan:
                            if entry[3] <= 0:
                                continue
                            bid = block_map.get((grade.id, entry[0].id))
                            if bid:
                                if bid in seen:
                                    continue
                                seen.add(bid)
                            demand += 1
                        return demand

                    remedial_demand = _effective_remedial_demand(grade_plan)
                    if remedial_demand > remedial_budget:
                        remedial_block_groups = {}
                        for entry in grade_plan:
                            if entry[3] <= 0:
                                continue
                            bid = block_map.get((grade.id, entry[0].id))
                            if bid:
                                remedial_block_groups.setdefault(bid, []).append(entry)

                        remedial_groups = []
                        seen_blocks = set()
                        for entry in grade_plan:
                            if entry[3] <= 0:
                                continue
                            bid = block_map.get((grade.id, entry[0].id))
                            if bid:
                                if bid in seen_blocks:
                                    continue
                                seen_blocks.add(bid)
                                remedial_groups.append(remedial_block_groups[bid])
                            else:
                                remedial_groups.append([entry])

                        random.shuffle(remedial_groups)
                        for group in remedial_groups:
                            if remedial_demand <= remedial_budget:
                                break
                            for entry in group:
                                entry[3] = 0
                            remedial_demand = _effective_remedial_demand(grade_plan)

                        scaling_notes.append(
                            f"{grade.name} remedial slots shuffled to fit capacity "
                            f"({remedial_demand}/{remedial_capacity})"
                        )

                # Save rules execution safely if target parameters resolved
                for sub, total, double, remedial in grade_plan:
                    SubjectQuota.objects.update_or_create(
                        grade=grade,
                        subject=sub,
                        defaults={
                            'total_lessons': total,
                            'double_lessons_required': double,
                            'remedial_lessons_required': remedial
                        }
                    )
                    quotas_created_or_updated += 1

        message = f'Engine Complete: Updated {quotas_created_or_updated} quotas using database-driven classifications.'
        if scaling_notes:
            message += ' ' + '; '.join(scaling_notes) + '.'

        return JsonResponse({
            'status': 'success',
            'message': message
        })
    except Exception as e:
        return JsonResponse({'status': 'error', 'message': f"Quota Engine Aborted: {str(e)}"}, status=500)


# ==========================================
# RESET APIs
# ==========================================
@require_permission('timetable.edit')
def api_clear_grid(request, timetable_id):
    """
    API: Clear Timetable Allocations

    Query Parameters:
    - stream_id (optional): If passed, deletes allocations ONLY for that specific ClassStream.
                            If omitted, clears all allocations across the entire timetable.
    """
    if request.method != 'DELETE':
        return JsonResponse({'status': 'error', 'message': 'Method not allowed.'}, status=405)

    try:
        stream_id = request.GET.get('stream_id')
        query = LessonAllocation.objects.filter(timetable_id=timetable_id)

        if stream_id:
            # 1. Verify stream exists and is not soft-deleted using .live manager
            stream_obj = ClassStream.live.get(id=stream_id)

            # 2. Filter allocations specifically for this class stream
            query = query.filter(class_stream_id=stream_id)
            deleted_count, _ = query.delete()

            stream_display = f"{stream_obj.grade.name} {stream_obj.name}" if hasattr(stream_obj,
                                                                                     'grade') else stream_obj.name
            msg = f"Successfully cleared {deleted_count} lesson allocation(s) for {stream_display}."
        else:
            # Global wipe across all streams in this timetable
            deleted_count, _ = query.delete()
            msg = f"Entire timetable grid cleared ({deleted_count} total lessons removed across all streams)."

        write_audit_log(
            operator_id=request.user.id if request.user.is_authenticated else None,
            action_type='DELETE',
            module='LessonAllocation',
            description=msg
        )
        return JsonResponse({'status': 'success', 'message': msg})

    except ClassStream.DoesNotExist:
        return JsonResponse({'status': 'error', 'message': 'Target class stream not found or has been deleted.'},
                            status=404)
    except Exception as e:
        return JsonResponse({'status': 'error', 'message': f"Failed to clear grid: {str(e)}"}, status=500)


@require_permission('timetable.edit')
def api_clear_quotas(request):
    """
    Wipes all Subject Quotas.
    """
    if request.method == 'DELETE':
        try:
            deleted_count, _ = SubjectQuota.objects.all().delete()
            write_audit_log(
                operator_id=request.user.id if request.user.is_authenticated else None,
                action_type='DELETE',
                module='SubjectQuota',
                description=f"Reset all Subject Quotas ({deleted_count} row(s) removed)."
            )
            return JsonResponse({'status': 'success', 'message': 'All Subject Quotas have been reset.'})
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)})
    return JsonResponse({'status': 'error', 'message': 'Invalid request method'})

@require_permission('timetable.view', edit_permission='timetable.edit')
def api_manage_subject_blocks(request):
    """
    API Workspace: Handles CRUD interactions for structural SubjectBlocks.
    Exploits atomic transactions and automatic alignment overrides to eliminate hardcoding.
    """
    if request.method == 'GET':
        try:
            # Admins view blocks filtered by active term/year context
            year_id = request.GET.get('year_id')
            term_id = request.GET.get('term_id')
            grade_id = request.GET.get('grade_id')

            queryset = SubjectBlock.objects.all()
            if year_id: queryset = queryset.filter(academic_year_id=year_id)
            if term_id: queryset = queryset.filter(term_id=term_id)
            if grade_id: queryset = queryset.filter(grade_level_id=grade_id)

            blocks_data = []
            for block in queryset.select_related('grade_level', 'academic_year', 'term'):
                # Extract the nested subjects dynamically assigned to this container
                packed_subjects = list(block.subjects.all().values('id', 'name', 'code', department_name=F('department__name')))

                blocks_data.append({
                    'id': block.id,
                    'name': block.name,
                    'grade_level_id': block.grade_level.id,
                    'grade_level_name': block.grade_level.name,
                    'academic_year': block.academic_year.year if block.academic_year else None,
                    'term': block.term.name if block.term else None,
                    'subjects': packed_subjects,
                    'period_structure': block.period_structure,
                })

            return JsonResponse({
                'status': 'success',
                'data': blocks_data,
                'period_structure_choices': [
                    {'value': choice, 'label': label} for choice, label in SubjectBlock.PERIOD_STRUCTURE_CHOICES
                ],
            })
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': f"Fetch Failure: {str(e)}"}, status=500)

    elif request.method == 'POST':
        try:
            data = json.loads(request.body)
            block_id = data.get('id')
            name = data.get('name')
            grade_id = data.get('grade_level_id')
            subject_ids = data.get('subject_ids', [])  # Array of subject primary keys to bundle
            period_structure = data.get('period_structure', 'MIXED')
            valid_structures = {choice for choice, _ in SubjectBlock.PERIOD_STRUCTURE_CHOICES}
            if period_structure not in valid_structures:
                return JsonResponse({
                    'status': 'error',
                    'message': f"Invalid period_structure '{period_structure}'. Must be one of {sorted(valid_structures)}."
                }, status=400)

            # Extract temporal anchors from current active states if not explicitly sent
            year_id = data.get('academic_year_id') or getattr(AcademicYear.objects.filter(is_active=True).first(), 'id',
                                                              None)
            term_id = data.get('term_id') or getattr(ExamTerm.objects.filter(is_active=True).first(), 'id', None)

            if not all([name, grade_id, year_id, term_id]):
                return JsonResponse(
                    {'status': 'error', 'message': 'Validation Error: Missing required context parameters.'},
                    status=400)

            # Block membership is an M2M now (a subject can sit in independent
            # blocks per grade/term), but a subject still can't sensibly belong
            # to TWO DIFFERENT blocks that share the exact same grade+term —
            # that would mean scheduling it in two concurrent groups at once.
            if subject_ids:
                conflicting = (
                    SubjectBlock.objects
                    .filter(grade_level_id=grade_id, academic_year_id=year_id, term_id=term_id,
                            subjects__id__in=subject_ids)
                    .exclude(id=block_id)
                    .values('name', 'subjects__id', 'subjects__name')
                    .distinct()
                )
                if conflicting.exists():
                    conflicts = ", ".join(
                        f"{row['subjects__name']} (already in '{row['name']}')" for row in conflicting
                    )
                    return JsonResponse({
                        'status': 'error',
                        'message': f"Conflict: {conflicts} for this grade/term. Remove it from the other block first."
                    }, status=400)

            # Safeguard data mutations using atomic execution boundaries
            with transaction.atomic():
                block, created = SubjectBlock.objects.update_or_create(
                    id=block_id,
                    defaults={
                        'name': name,
                        'grade_level_id': grade_id,
                        'academic_year_id': year_id,
                        'term_id': term_id,
                        'period_structure': period_structure,
                    }
                )

                # Replace this block's membership wholesale — safe under M2M
                # since .set() only ever touches THIS block's own join rows,
                # never another block's (that's what caused the cross-grade bug).
                block.subjects.set(Subject.objects.filter(id__in=subject_ids))

                # Audit phase: Log operations automatically
                action = 'CREATE' if created else 'UPDATE'
                desc = (f"{'Created new' if created else 'Modified'} subject block structure: '{name}' "
                        f"(ID: {block.id}) containing {len(subject_ids)} subjects, period_structure={period_structure}.")
                write_audit_log(
                    operator_id=request.user.id if request.user.is_authenticated else None,
                    action_type=action,
                    module='SubjectBlock',
                    description=desc
                )

            return JsonResponse(
                {'status': 'success', 'message': f"Subject block successfully saved.", 'block_id': block.id})
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': f"Mutation Aborted: {str(e)}"}, status=500)

    elif request.method == 'DELETE':
        try:
            data = json.loads(request.body)
            target_id = data.get('id')

            if not target_id:
                return JsonResponse({'status': 'error', 'message': 'Missing block identifier.'}, status=400)

            with transaction.atomic():
                block = SubjectBlock.objects.get(id=target_id)
                block_name = block.name

                # Subjects are linked via M2M, so deleting the block just drops
                # its own join rows — member subjects are untouched and simply
                # revert to block-free for this grade/term.
                block.delete()

                write_audit_log(
                    operator_id=request.user.id if request.user.is_authenticated else None,
                    action_type='DELETE',
                    module='SubjectBlock',
                    description=f"Destroyed subject block container: '{block_name}' (ID: {target_id}). Assigned subjects reverted to independent tracking slots."
                )

            return JsonResponse({'status': 'success', 'message': 'Subject block split up and removed successfully.'})
        except SubjectBlock.DoesNotExist:
            return JsonResponse({'status': 'error', 'message': 'Subject block not found inside current data records.'},
                                status=404)
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)}, status=500)

    return JsonResponse({'status': 'error', 'message': 'Method not allowed.'}, status=405)

def _get_substitution_busy_teacher_ids(target_lesson, target_slot, date_obj, exclude_cover_id=None):
    """
    Shared 5-Layer Substitution Exclusion Matrix: returns the set of teacher IDs who are NOT
    free to cover `target_lesson`'s slot on `date_obj`. Used both to SUGGEST candidates
    (api_get_available_substitutes) and to RE-VALIDATE at commit time
    (api_assign_daily_cover) so the two can never drift apart into a TOCTOU gap.
    """
    # LAYER 1: Scheduled on Master Grid during this slot
    busy_master = list(LessonAllocation.objects.filter(
        timetable=target_lesson.timetable,
        time_slot=target_slot
    ).values_list('teacher_id', flat=True))

    # LAYER 2: Structurally unavailable / blocked out
    busy_struct = list(TeacherStructuralAvailability.objects.filter(
        time_slot=target_slot
    ).values_list('teacher_id', flat=True))

    # LAYER 3: Already assigned as daily cover on this date and slot
    cover_qs = DailyCover.objects.filter(date=date_obj, target_lesson__time_slot=target_slot)
    if exclude_cover_id:
        # When re-validating an update to an EXISTING cover, don't let that cover's own
        # previous row count as a conflict against itself.
        cover_qs = cover_qs.exclude(id=exclude_cover_id)
    busy_covers = list(cover_qs.values_list('covering_teacher_id', flat=True))

    # LAYER 4: On approved leave spanning this date
    teachers_on_leave = list(TeacherLeave.objects.filter(
        status='Approved',
        start_date__lte=date_obj,
        end_date__gte=date_obj
    ).values_list('teacher_id', flat=True))

    # LAYER 5: Deployed as long-term relief covering a scheduled lesson
    active_reliefs = LongTermReliefAssignment.objects.filter(
        start_date__lte=date_obj,
        end_date__gte=date_obj
    )
    relief_map = {r.absent_teacher_id: r.relief_teacher_id for r in active_reliefs}

    busy_reliefs = []
    if relief_map:
        # Check if any absent teacher replaced by a relief surrogate has a lesson in this slot
        absent_with_lessons = LessonAllocation.objects.filter(
            timetable=target_lesson.timetable,
            time_slot=target_slot,
            teacher_id__in=list(relief_map.keys())
        ).values_list('teacher_id', flat=True)

        # Map back to the relief teachers who are covering those lessons
        busy_reliefs = [relief_map[aid] for aid in absent_with_lessons if aid in relief_map]

    # SANITIZATION: Merge all 5 workload layers and strip None values
    raw_busy_ids = busy_master + busy_struct + busy_covers + teachers_on_leave + busy_reliefs
    return {uid for uid in raw_busy_ids if uid is not None}


@require_permission('timetable.view')
def api_get_available_substitutes(request, allocation_id, target_date):
    """
    API: Full 5-Layer Substitution Exclusion Matrix

    Identifies free, qualified substitute teachers for a given lesson and date by
    filtering out conflicts across Master Schedules, Structural Unavailability,
    Daily Cover assignments, Approved Leaves, and Active Long-Term Relief Duties.
    """
    if request.method != 'GET':
        return JsonResponse({'status': 'error', 'message': 'Method not allowed.'}, status=405)

    try:
        # 1. Retrieve context for the target lesson allocation and slot
        target_lesson = LessonAllocation.objects.get(id=allocation_id)
        target_slot = target_lesson.time_slot
        target_subject = target_lesson.subject
        date_obj = datetime.strptime(target_date, '%Y-%m-%d').date()

        clean_busy_ids = _get_substitution_busy_teacher_ids(target_lesson, target_slot, date_obj)

        # SUBJECT FILTERING:
        # A. Get teacher IDs assigned to teach this subject in the active term/year allocations
        allocated_teacher_ids = list(SubjectAllocation.objects.filter(
            subject=target_subject,
            is_active=True
        ).values_list('teacher_id', flat=True))

        # B. Query active teachers who teach target_subject via contract OR general qualification
        # (single source of truth for qualification: see TeacherExtra.qualified_subjects)
        qualified_teachers = TeacherExtra.objects.filter(
            status=True
        ).filter(
            Q(qualified_subjects=target_subject) | Q(id__in=allocated_teacher_ids)
        ).distinct()

        # C. Exclude busy/conflicted teachers
        available_teachers = qualified_teachers.exclude(
            id__in=clean_busy_ids
        )

        # D. Fatigue guard: flag (not exclude) teachers already at/over their heavy-day or
        # weekly cap, so the admin can still pick them in a pinch but sees the risk up front —
        # unlike the hard block used for normal grid placement, a substitute pool that's too
        # small to ever suggest anyone is worse than one that warns.
        pedagogy_policy = TimetablePedagogyPolicy.load()
        global_policy = GlobalAllocationPolicy.load()
        available_ids = [t.id for t in available_teachers]
        weekly_counts = dict(
            LessonAllocation.objects.filter(
                timetable=target_lesson.timetable, teacher_id__in=available_ids
            ).values('teacher_id').annotate(c=Count('id')).values_list('teacher_id', 'c')
        )
        daily_counts = dict(
            LessonAllocation.objects.filter(
                timetable=target_lesson.timetable, time_slot__day=target_slot.day,
                teacher_id__in=available_ids
            ).values('teacher_id').annotate(c=Count('id')).values_list('teacher_id', 'c')
        )

        data = []
        for t in available_teachers:
            # Safe property access matching updated TeacherExtra model
            try:
                name = t.get_name if t.get_name.strip() else t.user.username
            except Exception:
                name = f"Teacher {t.id}"

            fatigue_warning = None
            if daily_counts.get(t.id, 0) >= pedagogy_policy.heavy_day_threshold:
                fatigue_warning = f"Already has a Heavy Day ({daily_counts.get(t.id, 0)} lessons) on {target_slot.day}."
            elif weekly_counts.get(t.id, 0) >= global_policy.max_weekly_lessons:
                fatigue_warning = f"Already at the weekly lesson cap ({weekly_counts.get(t.id, 0)})."

            data.append({
                'id': t.id,
                'name': name,
                'department': getattr(t, 'department', 'General'),
                'fatigue_warning': fatigue_warning
            })

        return JsonResponse({'status': 'success', 'data': data})

    except LessonAllocation.DoesNotExist:
        return JsonResponse({'status': 'error', 'message': 'Target lesson not found.'}, status=404)
    except ValueError:
        return JsonResponse({'status': 'error', 'message': 'Invalid date format. Use YYYY-MM-DD.'}, status=400)
    except Exception as e:
        print("=== SUBSTITUTION SCAN ENGINE ERROR ===")
        traceback.print_exc()
        return JsonResponse({'status': 'error', 'message': f"Substitution Scan Failed: {str(e)}"}, status=500)

@require_permission('timetable.view', edit_permission='timetable.edit')
def api_assign_daily_cover(request):
    """
    Manages ad-hoc substitution assignments for a specific calendar day.
    GET: list existing covers (filter by date, and optionally by timetable/class_stream).
    POST: lock in (create or update) a substitution assignment, re-validated server-side
          against the same 5-layer exclusion matrix used to suggest candidates, so a stale
          suggestion or a race between two admins can never double-book a covering teacher.
    DELETE: cancel an existing cover, restoring the original teacher's lesson as-is.
    """
    if request.method == 'GET':
        try:
            target_date_str = request.GET.get('date')
            if not target_date_str:
                return JsonResponse({'status': 'error', 'message': 'date query parameter is required.'}, status=400)
            date_obj = datetime.strptime(target_date_str, '%Y-%m-%d').date()

            covers = DailyCover.objects.filter(date=date_obj).select_related(
                'target_lesson__time_slot', 'target_lesson__class_stream', 'target_lesson__subject',
                'absent_teacher', 'covering_teacher'
            )
            timetable_id = request.GET.get('timetable_id')
            if timetable_id:
                covers = covers.filter(target_lesson__timetable_id=timetable_id)
            class_stream_id = request.GET.get('class_stream_id')
            if class_stream_id:
                covers = covers.filter(target_lesson__class_stream_id=class_stream_id)

            data = [{
                'id': c.id,
                'date': c.date.isoformat(),
                'target_lesson_id': c.target_lesson_id,
                'time_slot_id': c.target_lesson.time_slot_id,
                'class_stream_id': c.target_lesson.class_stream_id,
                'class_stream_name': c.target_lesson.class_stream.name,
                'subject_name': c.target_lesson.subject.name,
                'absent_teacher_id': c.absent_teacher_id,
                'absent_teacher_name': c.absent_teacher.get_name,
                'covering_teacher_id': c.covering_teacher_id,
                'covering_teacher_name': c.covering_teacher.get_name,
                'notes': c.notes,
            } for c in covers]
            return JsonResponse({'status': 'success', 'data': data})
        except ValueError:
            return JsonResponse({'status': 'error', 'message': 'Invalid date format. Use YYYY-MM-DD.'}, status=400)
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)}, status=500)

    elif request.method == 'POST':
        try:
            data = json.loads(request.body)
            allocation_id = data.get('target_lesson_id')
            covering_teacher_id = data.get('covering_teacher_id')
            target_date_str = data.get('date')
            notes = data.get('notes', '')

            if not all([allocation_id, covering_teacher_id, target_date_str]):
                return JsonResponse({'status': 'error', 'message': 'Missing required parameters.'}, status=400)

            target_lesson = LessonAllocation.objects.get(id=allocation_id)
            absent_teacher = target_lesson.teacher
            covering_teacher = TeacherExtra.objects.get(id=covering_teacher_id)
            date_obj = datetime.strptime(target_date_str, '%Y-%m-%d').date()

            if covering_teacher_id == target_lesson.teacher_id:
                return JsonResponse(
                    {'status': 'error', 'message': 'The covering teacher cannot be the same as the absent teacher.'},
                    status=400
                )

            # Re-validate against the same exclusion matrix used to suggest candidates —
            # closes the TOCTOU gap where the teacher picked in the UI became busy (or was
            # double-assigned by another admin) between the lookup and this commit.
            existing_cover = DailyCover.objects.filter(date=date_obj, target_lesson=target_lesson).first()
            busy_ids = _get_substitution_busy_teacher_ids(
                target_lesson, target_lesson.time_slot, date_obj,
                exclude_cover_id=existing_cover.id if existing_cover else None
            )
            if covering_teacher.id in busy_ids:
                return JsonResponse({
                    'status': 'error',
                    'message': f"{covering_teacher.get_name} is no longer available for this slot on "
                               f"{target_date_str} (already scheduled, blocked out, covering elsewhere, or on leave)."
                }, status=409)

            # Create or update the cover log
            cover, created = DailyCover.objects.update_or_create(
                date=date_obj,
                target_lesson=target_lesson,
                defaults={
                    'absent_teacher': absent_teacher,
                    'covering_teacher': covering_teacher,
                    'notes': notes
                }
            )

            write_audit_log(
                operator_id=request.user.id if request.user.is_authenticated else None,
                action_type='CREATE' if created else 'UPDATE',
                module='DailyCover',
                description=f"{'Assigned' if created else 'Updated'} {covering_teacher.get_name} to cover "
                            f"{target_lesson.subject.name} for {absent_teacher.get_name} "
                            f"({target_lesson.class_stream.name}) on {target_date_str}."
            )

            msg = "Substitute assigned successfully." if created else "Substitute updated successfully."
            return JsonResponse({'status': 'success', 'message': msg, 'cover_id': cover.id})

        except LessonAllocation.DoesNotExist:
            return JsonResponse({'status': 'error', 'message': 'Target lesson not found.'}, status=404)
        except TeacherExtra.DoesNotExist:
            return JsonResponse({'status': 'error', 'message': 'Covering teacher not found.'}, status=404)
        except ValueError:
            return JsonResponse({'status': 'error', 'message': 'Invalid date format. Use YYYY-MM-DD.'}, status=400)
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)}, status=500)

    elif request.method == 'DELETE':
        try:
            data = json.loads(request.body)
            cover = DailyCover.objects.select_related(
                'target_lesson__subject', 'target_lesson__class_stream', 'absent_teacher', 'covering_teacher'
            ).get(id=data.get('id'))
            desc = (f"Cancelled {cover.covering_teacher.get_name}'s cover for "
                    f"{cover.target_lesson.subject.name} ({cover.target_lesson.class_stream.name}) on {cover.date}.")
            cover.delete()
            write_audit_log(
                operator_id=request.user.id if request.user.is_authenticated else None,
                action_type='DELETE',
                module='DailyCover',
                description=desc
            )
            return JsonResponse({'status': 'success', 'message': 'Cover cancelled.'})
        except DailyCover.DoesNotExist:
            return JsonResponse({'status': 'error', 'message': 'Cover not found.'}, status=404)
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)}, status=500)

    return JsonResponse({'status': 'error', 'message': 'Method not allowed.'}, status=405)

@require_permission('timetable.view', edit_permission='timetable.edit')
def api_manage_policies(request):
    """
    MANAGES GLOBAL POLICY SINGLETONS:
    Allows admins to adjust constraint strictness, heavy day thresholds,
    and consecutive fatigue rules directly from the dashboard.
    """
    pedagogy = TimetablePedagogyPolicy.load()
    global_policy = GlobalAllocationPolicy.load()

    if request.method == 'GET':
        return JsonResponse({
            'status': 'success',
            'data': {
                'max_consecutive_periods': pedagogy.max_consecutive_periods,
                'max_daily_subject_frequency': pedagogy.max_daily_subject_frequency,
                'min_subject_spacing_periods': pedagogy.min_subject_spacing_periods,
                'allow_remedial_double_periods': pedagogy.allow_remedial_double_periods,
                'heavy_day_threshold': pedagogy.heavy_day_threshold,
                'prevent_consecutive_heavy_days': pedagogy.prevent_consecutive_heavy_days,
                # Timetable's OWN strictness switch — independent of Allocations'
                # GlobalAllocationPolicy.enforcement_mode (see api_manage_splitting_rules /
                # GlobalAllocationPolicyAPIView for that one). max_weekly_lessons stays on
                # GlobalAllocationPolicy: it's a real teacher-capacity fact both Allocations
                # and the Timetable generator must agree on, not a strictness toggle.
                'enforcement_mode': pedagogy.enforcement_mode,
                'max_weekly_lessons': global_policy.max_weekly_lessons
            }
        })

    elif request.method == 'POST':
        try:
            data = json.loads(request.body)
            before = {
                'max_consecutive_periods': pedagogy.max_consecutive_periods,
                'max_daily_subject_frequency': pedagogy.max_daily_subject_frequency,
                'min_subject_spacing_periods': pedagogy.min_subject_spacing_periods,
                'allow_remedial_double_periods': pedagogy.allow_remedial_double_periods,
                'heavy_day_threshold': pedagogy.heavy_day_threshold,
                'prevent_consecutive_heavy_days': pedagogy.prevent_consecutive_heavy_days,
                'enforcement_mode': pedagogy.enforcement_mode,
                'max_weekly_lessons': global_policy.max_weekly_lessons,
            }

            # Update Pedagogy Rules
            pedagogy.max_consecutive_periods = data.get('max_consecutive_periods', pedagogy.max_consecutive_periods)
            pedagogy.max_daily_subject_frequency = data.get('max_daily_subject_frequency',
                                                            pedagogy.max_daily_subject_frequency)
            pedagogy.min_subject_spacing_periods = data.get('min_subject_spacing_periods',
                                                            pedagogy.min_subject_spacing_periods)
            pedagogy.allow_remedial_double_periods = data.get('allow_remedial_double_periods',
                                                              pedagogy.allow_remedial_double_periods)
            pedagogy.heavy_day_threshold = data.get('heavy_day_threshold', pedagogy.heavy_day_threshold)
            pedagogy.prevent_consecutive_heavy_days = data.get('prevent_consecutive_heavy_days',
                                                               pedagogy.prevent_consecutive_heavy_days)

            # Timetable's own Compliance Mode — stored on TimetablePedagogyPolicy so flipping
            # it here never touches Allocations' GlobalAllocationPolicy.enforcement_mode.
            valid_modes = {choice for choice, _ in TimetablePedagogyPolicy.ENFORCEMENT_CHOICES}
            requested_mode = data.get('enforcement_mode', pedagogy.enforcement_mode)
            if requested_mode not in valid_modes:
                return JsonResponse(
                    {'status': 'error',
                     'message': f"Invalid enforcement_mode '{requested_mode}'. Must be one of {sorted(valid_modes)}."},
                    status=400
                )
            pedagogy.enforcement_mode = requested_mode
            pedagogy.save()

            global_policy.max_weekly_lessons = data.get('max_weekly_lessons', global_policy.max_weekly_lessons)
            global_policy.save()

            after = {
                'max_consecutive_periods': pedagogy.max_consecutive_periods,
                'max_daily_subject_frequency': pedagogy.max_daily_subject_frequency,
                'min_subject_spacing_periods': pedagogy.min_subject_spacing_periods,
                'allow_remedial_double_periods': pedagogy.allow_remedial_double_periods,
                'heavy_day_threshold': pedagogy.heavy_day_threshold,
                'prevent_consecutive_heavy_days': pedagogy.prevent_consecutive_heavy_days,
                'enforcement_mode': pedagogy.enforcement_mode,
                'max_weekly_lessons': global_policy.max_weekly_lessons,
            }
            changes = [f"{k}: {before[k]} → {after[k]}" for k in before if before[k] != after[k]]
            if changes:
                write_audit_log(
                    operator_id=request.user.id if request.user.is_authenticated else None,
                    action_type='UPDATE',
                    module='TimetablePolicy',
                    description="Updated timetable policies — " + "; ".join(changes)
                )

            return JsonResponse({'status': 'success', 'message': 'Institutional policies updated successfully.'})
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)}, status=500)

    return JsonResponse({'status': 'error', 'message': 'Method not allowed.'}, status=405)

@require_permission('timetable.edit')
def api_update_timetable_status(request, timetable_id):
    """
    LIFECYCLE TRANSITIONS CONTROL:
    Allows administrators to safely shift a timetable container between 'Draft'
    and 'Published' states or toggle its global running active status.
    """
    if request.method != 'POST':
        return JsonResponse({'status': 'error', 'message': 'Method not allowed.'}, status=405)

    try:
        data = json.loads(request.body)
        timetable = Timetable.objects.get(id=timetable_id)
        prior_status = timetable.status

        going_live = data.get('status') == 'Published' or data.get('is_active', False)
        if going_live and timetable.academic_year_id and timetable.term_id:
            gaps = compute_school_allocation_gaps(timetable.term_id, timetable.academic_year_id)
            if gaps:
                gap_summary = "; ".join(
                    f"{g['class_name']}: {', '.join(g['missing_subjects'])}" for g in gaps[:10]
                )
                more = f" (+{len(gaps) - 10} more class(es))" if len(gaps) > 10 else ""
                return JsonResponse({
                    'status': 'error',
                    'message': f"Timetable cannot go live — {len(gaps)} class(es) have incomplete "
                               f"teacher allocations: {gap_summary}{more}. Finish allocating every "
                               f"class before publishing.",
                    'allocation_gaps': gaps,
                }, status=400)

        if 'status' in data:
            timetable.status = data.get('status')  # 'Draft' or 'Published'

        if data.get('is_active', False):
            # Enforce singleton operation: only ONE timetable can be globally active at a time
            Timetable.objects.update(is_active=False)
            timetable.is_active = True

        timetable.save()

        if prior_status != timetable.status:
            write_audit_log(
                operator_id=request.user.id if request.user.is_authenticated else None,
                action_type='UPDATE',
                module='Timetable',
                description=f"Changed '{timetable.name}' lifecycle status: {prior_status} → {timetable.status}."
            )

        return JsonResponse(
            {'status': 'success', 'message': f"Timetable container '{timetable.name}' successfully modified."})
    except Timetable.DoesNotExist:
        return JsonResponse({'status': 'error', 'message': 'Timetable entry not found.'}, status=404)
    except Exception as e:
        return JsonResponse({'status': 'error', 'message': str(e)}, status=500)


@require_permission('audit.view')
def api_get_audit_logs(request):
    """
    API Workspace: Audit Log Telemetry Engine

    Query Parameters (Optional):
    - module: Filter by target system module (e.g., 'SubjectBlock', 'ClassStream', 'Timetable')
    - action: Filter by action type (e.g., 'CREATE', 'UPDATE', 'DELETE')
    - search: Keyword search in description or operator username
    - page: 1-based page number (default 1)
    - page_size: rows per page, capped at 200 (default 50)
    """
    if request.method != 'GET':
        return JsonResponse({'status': 'error', 'message': 'Method not allowed.'}, status=405)

    try:
        # Extract query filter parameters
        module_filter = request.GET.get('module')
        action_filter = request.GET.get('action')
        search_query = request.GET.get('search')

        try:
            page = max(1, int(request.GET.get('page', 1)))
        except (TypeError, ValueError):
            page = 1
        try:
            page_size = min(200, max(1, int(request.GET.get('page_size', 50))))
        except (TypeError, ValueError):
            page_size = 50

        # Base Query: Select related operator to avoid N+1 database queries
        queryset = SystemAuditLog.objects.all().select_related('operator').order_by('-timestamp')

        # Apply optional filters dynamically
        if module_filter:
            queryset = queryset.filter(module__iexact=module_filter)

        if action_filter:
            queryset = queryset.filter(action_type__iexact=action_filter)

        if search_query:
            queryset = queryset.filter(
                Q(description__icontains=search_query) |
                Q(operator__username__icontains=search_query) |
                Q(module__icontains=search_query)
            )

        total_count = queryset.count()
        start = (page - 1) * page_size
        logs = queryset[start:start + page_size]

        data = []
        for log in logs:
            # Safe operator name resolution (Handles system-automated vs logged-in user actions)
            if log.operator:
                full_name = f"{log.operator.first_name} {log.operator.last_name}".strip()
                operator_display = full_name if full_name else log.operator.username
            else:
                operator_display = 'System Administrator'

            data.append({
                'id': log.id,
                'user_name': operator_display,
                'action': getattr(log, 'action_type', 'UPDATE'),
                'target_type': getattr(log, 'module', 'General'),
                'details': getattr(log, 'description', ''),
                'timestamp': log.timestamp.strftime('%Y-%m-%d %H:%M:%S') if hasattr(log,
                                                                                    'timestamp') and log.timestamp else ''
            })

        # Real ACTION_CHOICES + the distinct modules actually in use, so the frontend filter
        # dropdowns can never offer a value that matches zero rows.
        action_choices = [choice[0] for choice in SystemAuditLog.ACTION_CHOICES]
        distinct_modules = list(
            SystemAuditLog.objects.order_by('module').values_list('module', flat=True).distinct()
        )

        return JsonResponse({
            'status': 'success',
            'data': data,
            'count': len(data),
            'total_count': total_count,
            'page': page,
            'page_size': page_size,
            'has_more': start + page_size < total_count,
            'action_choices': action_choices,
            'module_choices': distinct_modules,
        })

    except Exception as e:
        return JsonResponse({'status': 'error', 'message': f"Audit Log Fetch Failure: {str(e)}"}, status=500)

