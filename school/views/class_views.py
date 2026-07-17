import json
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import IsAuthenticated
from django.shortcuts import get_object_or_404
from school.models.models import (TeacherExtra, StudentExtra,
                                  ParentExtra, Notification, AcademicYear)
from school.models.classSubjects_models import ClassStream, Subject, GradeLevel, StudentSubjectEnrollment, SubjectQuota, \
    SystemAuditLog, Curriculum, StudentPathwaySelection, Tier
from django.db import transaction
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from django.db.models import Q
from school.decorators import require_permission
from school.rbac import HasModulePermission, assert_curriculum_editable


class CsrfExemptSessionAuthentication(SessionAuthentication):
    def enforce_csrf(self, request):
        return

@csrf_exempt
@require_permission('classes.view')
def api_academic_hub_data(request):
    """
    Fetches the full academic structure.
    SHIELDED: Now filters out virtual streams and uses the enrollment ledger for electives.
    """
    if request.method == 'GET':
        try:
            grades = GradeLevel.objects.all().order_by('numeric_order')
            grades_data = []
            for grade in grades:
                # SHIELD: Exclude soft-deleted and virtual streams
                streams = grade.streams.filter(is_deleted=False, is_virtual=False).select_related('class_teacher__user')
                stream_list = [{
                    'id': s.id,
                    'name': s.name,
                    'capacity': s.capacity,
                    'enrolled_count': s.studentextra_set.filter(status=True).count(),
                    'class_teacher': s.class_teacher.get_name if s.class_teacher else None,
                } for s in streams]

                grades_data.append({
                    'id': grade.id,
                    'grade_name': grade.name,
                    'streams': stream_list,
                    'total_streams': len(stream_list),
                    'curriculum_type': grade.curriculum_type if hasattr(grade, 'curriculum_type') else 'CBC',
                    'curriculum_id': grade.curriculum_id,
                    'tier_id': grade.tier_id,
                })

            subjects = Subject.objects.all().order_by('name')
            subjects_data = []

            # Fetch the active academic year to count real enrollments
            current_year = AcademicYear.objects.filter(is_active=True).first()

            for sub in subjects:
                # THE DATA FIX: Count live approved students from the ledger, bypassing the old ManyToMany field
                live_enrollment = 0
                if current_year:
                    live_enrollment = StudentSubjectEnrollment.objects.filter(
                        subject=sub,
                        academic_year=current_year,
                        status='Approved',
                        student__status=True
                    ).count()

                # Single source of truth for eligibility (see TeacherExtra.qualified_subjects)
                assigned_teachers = list(
                    TeacherExtra.objects.filter(qualified_subjects=sub, status=True).values_list('user__first_name', 'user__last_name')
                )
                assigned_teacher_names = [f"{first} {last}".strip() for first, last in assigned_teachers]

                subjects_data.append({
                    'id': sub.id,
                    'code': sub.code,
                    'name': sub.name,
                    'department': sub.department,
                    'is_core': sub.is_core,
                    'live_enrollment': live_enrollment,
                    'assigned_teachers': assigned_teacher_names,
                })

            return JsonResponse({
                'status': 'success',
                'data': {
                    'classes': grades_data,
                    'subjects': subjects_data
                }
            })

        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)})

    return JsonResponse({'status': 'error', 'message': 'Invalid request method'})


@csrf_exempt
@require_permission('classes.view')
def api_manage_classes(request):
    """
    Returns all classes categorized by grade.
    RBAC ENABLED: Teachers only receive streams they manage or instruct.
    SHIELDED: Virtual classes and deleted classes are explicitly blocked.
    """
    if request.method == 'GET':
        try:
            user = request.user
            is_teacher = hasattr(user, 'teacherextra')
            # Reaching this line already required classes.view (see this view's
            # @require_permission decorator) — a non-teacher who got this far (an admin, or
            # now a Staff account with a Classes-granting Role) has no "only my streams"
            # notion, so they get the full list rather than an empty one.
            is_admin = user.is_superuser or user.is_staff or user.groups.filter(name='ADMIN').exists() or hasattr(user,
                                                                                                                  'adminextra') or not is_teacher

            grades = GradeLevel.objects.all().order_by('numeric_order')
            data = []
            for grade in grades:
                # Apply structural Role-Based Access Control filters
                if is_admin:
                    streams = grade.streams.filter(is_deleted=False, is_virtual=False)
                elif is_teacher:
                    teacher = user.teacherextra
                    # Discover streams where the teacher is the homeroom lead or holds an allocation
                    streams = grade.streams.filter(
                        Q(class_teacher=teacher) | Q(allocations__teacher=teacher),
                        is_deleted=False,
                        is_virtual=False
                    ).distinct()
                else:
                    streams = grade.streams.none()

                stream_data = []
                for s in streams:
                    teacher_name = "Not Assigned"
                    if s.class_teacher:
                        teacher_name = f"{s.class_teacher.user.first_name} {s.class_teacher.user.last_name}"

                    # Detect if the requesting teacher is the specific class teacher
                    is_current_user_class_teacher = False
                    if is_teacher and s.class_teacher == user.teacherextra:
                        is_current_user_class_teacher = True

                    enrolled_students = []
                    for student in s.studentextra_set.filter(status=True).select_related('user'):
                        enrolled_students.append({
                            'id': student.id,
                            'name': student.get_name,
                            'roll': student.roll,
                        })

                    # FIX: Prevent duplicate prefix naming (e.g., "Grade 7 Grade 7 North")
                    stream_display_name = s.name if s.name.startswith(grade.name) else f"{grade.name} {s.name}"

                    stream_data.append({
                        'id': s.id,
                        'name': stream_display_name,
                        'capacity': s.capacity,
                        'enrolled_count': len(enrolled_students),
                        'students': enrolled_students,
                        'class_teacher': teacher_name,
                        'class_teacher_id': s.class_teacher.id if s.class_teacher else None,
                        'is_current_user_class_teacher': is_current_user_class_teacher
                    })

                # Only include grades in the layout that contain authorized streams
                if stream_data or is_admin:
                    data.append({
                        'grade_id': grade.id,
                        'grade_name': grade.name,
                        'streams': stream_data
                    })
            return JsonResponse({'status': 'success', 'data': data})
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)})


@csrf_exempt
@require_permission('classes.edit')
def api_add_grade_with_streams(request):
    """
    Creates a new academic GradeLevel along with its baseline physical streams.
    UPGRADED: Automatically auto-seeds factory baseline SubjectQuota records
    for all core subjects so that the allocation matrix screen populates immediately.
    """
    if request.method == 'POST':
        try:
            data = json.loads(request.body)

            curriculum_id = data.get('curriculum_id')
            if not curriculum_id:
                return JsonResponse({'status': 'error', 'message': 'Curriculum is required.'})

            try:
                curriculum = Curriculum.objects.get(id=curriculum_id)
            except Curriculum.DoesNotExist:
                return JsonResponse({'status': 'error', 'message': 'The selected Curriculum does not exist.'})

            if not curriculum.is_active_for_new_grades:
                return JsonResponse({
                    'status': 'error',
                    'message': f"'{curriculum.name}' is no longer accepting new grades."
                })
            assert_curriculum_editable(curriculum, request.user)

            tier_id = data.get('tier_id') or None
            curriculum_tiers = Tier.objects.filter(curriculum=curriculum)
            tier = None
            if curriculum_tiers.exists():
                if not tier_id:
                    return JsonResponse({
                        'status': 'error',
                        'message': f"'{curriculum.name}' requires selecting a Tier."
                    })
                try:
                    tier = curriculum_tiers.get(id=tier_id)
                except Tier.DoesNotExist:
                    return JsonResponse({'status': 'error', 'message': 'Invalid tier for the selected curriculum.'})

            # 1. Open an atomic database transaction block to prevent partial saves
            with transaction.atomic():

                # 2. Build the master Grade shell
                grade = GradeLevel.objects.create(
                    name=data['grade_name'],
                    numeric_order=data['numeric_order'],
                    curriculum=curriculum,
                    tier=tier,
                )

                # 3. Parse and spin up the designated physical streams
                streams_string = data.get('streams', '')
                capacity = data.get('capacity', 40)

                if streams_string:
                    stream_names = [s.strip() for s in streams_string.split(',') if s.strip()]
                    for name in stream_names:
                        ClassStream.objects.create(name=name, grade=grade, capacity=capacity)

                # 4. AUTOMATED SEEDING CORES: Discover all globally registered Core Subjects
                # This guarantees the matrix engine immediately has quota rows to discover.
                core_subjects = Subject.objects.filter(is_core=True)

                if core_subjects.exists():
                    quota_records = [
                        SubjectQuota(
                            grade=grade,
                            subject=sub,
                            total_lessons=4,  # Factory baseline standard high school allotment
                            double_lessons_required=0,
                            remedial_lessons_required=0
                        ) for sub in core_subjects
                    ]
                    # Bulk create minimizes operational overhead to a single DB query hits
                    SubjectQuota.objects.bulk_create(quota_records)

            return JsonResponse({
                'status': 'success',
                'message': f'Grade "{grade.name}" successfully created and auto-populated with core curriculum quotas!'
            })

        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)})

    return JsonResponse({'status': 'error', 'message': 'Invalid request method'})


@csrf_exempt
@require_permission('classes.edit')
def api_edit_grade(request, pk):
    """
    Edits an existing GradeLevel's name/numeric_order/curriculum/tier.
    Changing the curriculum is blocked if it would orphan an already-approved
    subject enrollment or pathway selection for a student in one of its streams —
    same spirit as the CHECK-style guards elsewhere in the allocation engine.
    """
    if request.method not in ('POST', 'PUT'):
        return JsonResponse({'status': 'error', 'message': 'Invalid request method'})

    try:
        grade = GradeLevel.objects.get(id=pk)
    except GradeLevel.DoesNotExist:
        return JsonResponse({'status': 'error', 'message': 'The selected Grade does not exist.'})

    try:
        data = json.loads(request.body)

        grade.name = data.get('name', grade.name)
        grade.numeric_order = data.get('numeric_order', grade.numeric_order)

        curriculum_id = data.get('curriculum_id')
        if curriculum_id is not None:
            try:
                new_curriculum = Curriculum.objects.get(id=curriculum_id)
            except Curriculum.DoesNotExist:
                return JsonResponse({'status': 'error', 'message': 'The selected Curriculum does not exist.'})

            assert_curriculum_editable(new_curriculum, request.user)

            if grade.curriculum_id != new_curriculum.id:
                blocked = (
                    StudentSubjectEnrollment.objects.filter(student__cl__grade=grade, status='Approved').exists()
                    or StudentPathwaySelection.objects.filter(student__cl__grade=grade, status='Approved').exists()
                )
                if blocked:
                    return JsonResponse({
                        'status': 'error',
                        'message': (
                            f"Cannot change '{grade.name}' to {new_curriculum.name} — students in this grade "
                            "already have approved subject/pathway selections. Resolve those first."
                        )
                    })

            tier_id = data.get('tier_id') or None
            curriculum_tiers = Tier.objects.filter(curriculum=new_curriculum)
            tier = None
            if curriculum_tiers.exists():
                if not tier_id:
                    return JsonResponse({
                        'status': 'error',
                        'message': f"'{new_curriculum.name}' requires selecting a Tier."
                    })
                try:
                    tier = curriculum_tiers.get(id=tier_id)
                except Tier.DoesNotExist:
                    return JsonResponse({'status': 'error', 'message': 'Invalid tier for the selected curriculum.'})

            curriculum_changed = grade.curriculum_id != new_curriculum.id or grade.tier_id != (tier.id if tier else None)
            old_curriculum_label = grade.curriculum.code if grade.curriculum else 'none'
            grade.curriculum = new_curriculum
            grade.tier = tier
            grade.save()

            if curriculum_changed:
                SystemAuditLog.objects.create(
                    operator=request.user, action_type='UPDATE', module='GradeLevel',
                    description=(
                        f"Changed '{grade.name}' curriculum from {old_curriculum_label} to "
                        f"{new_curriculum.code}."
                    )
                )
        else:
            grade.save()

        return JsonResponse({'status': 'success', 'message': f'Grade "{grade.name}" updated successfully.'})

    except Exception as e:
        return JsonResponse({'status': 'error', 'message': str(e)})


@csrf_exempt
@require_permission('classes.edit')
def api_add_single_stream(request):
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            grade_id = data.get('grade_id')
            stream_name = data.get('stream_name')
            capacity = data.get('capacity', 40)

            grade = GradeLevel.objects.get(id=grade_id)
            ClassStream.objects.create(name=stream_name.strip(), grade=grade, capacity=capacity)

            return JsonResponse({'status': 'success', 'message': f'Stream "{stream_name}" added to {grade.name} successfully.'})

        except GradeLevel.DoesNotExist:
            return JsonResponse({'status': 'error', 'message': 'The selected Grade does not exist.'})
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)})

    return JsonResponse({'status': 'error', 'message': 'Invalid request method'})

@csrf_exempt
@require_permission('classes.edit')
def api_edit_stream(request, pk):
    if request.method == 'POST' or request.method == 'PUT':
        try:
            data = json.loads(request.body)
            stream = ClassStream.objects.get(id=pk)
            stream.name = data.get('name', stream.name)
            stream.capacity = data.get('capacity', stream.capacity)

            teacher_id = data.get('teacher_id')
            if teacher_id:
                teacher = TeacherExtra.objects.get(id=teacher_id)
                stream.class_teacher = teacher
            elif teacher_id == "":
                stream.class_teacher = None

            stream.save()
            return JsonResponse({'status': 'success', 'message': 'Class stream updated successfully.'})
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)})
    return JsonResponse({'status': 'error', 'message': 'Invalid request method'})

@csrf_exempt
@require_permission('classes.edit')
def api_delete_stream(request, pk):
    """
    UPGRADED: Replaces hard deletion with a protective soft delete.
    """
    if request.method == 'POST' or request.method == 'DELETE':
        try:
            stream = ClassStream.objects.get(id=pk)
            # We trigger the custom soft_delete method built into the model
            stream.soft_delete(operator_user=request.user if request.user.is_authenticated else None)

            return JsonResponse({'status': 'success', 'message': 'Class stream safely archived.'})
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)})
    return JsonResponse({'status': 'error', 'message': 'Invalid request method'})


@csrf_exempt
@require_permission('classes.view')
def api_class_enrollments(request, stream_id):
    """
    Fetches the full environment for a specific class's Enrollment Dashboard.
    Includes Active Roster, Exited History, Sibling Streams, and Unassigned pool.
    """
    if request.method == 'GET':
        try:
            stream = ClassStream.objects.get(id=stream_id)
            grade = stream.grade

            # 1. ACTIVE ROSTER (Includes Suspended students since they keep their seat)
            active_students = StudentExtra.objects.filter(
                cl=stream,
                enrollment_state__in=['Active', 'Suspended']
            ).select_related('user')

            active_data = []
            for s in active_students:
                active_data.append({
                    'id': s.id,
                    'name': s.get_name,
                    'roll': s.roll,
                    'enrollment_state': s.enrollment_state,
                    'last_changed': s.last_enrollment_change.strftime(
                        '%d %b %Y') if s.last_enrollment_change else "N/A",

                    # --- MOCK DATA FOR FUTURE INTEGRATION ---
                    'fee_balance': 15000 if s.id % 2 == 0 else 0,
                    'subjects_assigned': True if s.id % 3 != 0 else False
                })

            # 2. THE GHOST ROSTER (Students who exited this specific class)
            exited_students = StudentExtra.objects.filter(
                cl__isnull=True,
                enrollment_state__in=['Expelled', 'Transferred'],
                # This checks the notes we generate during expulsion/transfer
                # to see if they were removed from THIS specific class.
                enrollment_notes__icontains=stream.name
            ).select_related('user')

            exited_data = []
            for s in exited_students:
                exited_data.append({
                    'id': s.id,
                    'name': s.get_name,
                    'roll': s.roll,
                    'enrollment_state': s.enrollment_state,
                    'fee_balance': 0,  # Mock handling for exited users
                    'enrollment_notes': s.enrollment_notes
                })

            # 3. SIBLING STREAMS (Other classes in the same Grade)
            siblings = ClassStream.objects.filter(grade=grade).exclude(id=stream_id)
            sibling_data = [{'id': sib.id, 'name': sib.name, 'capacity': sib.capacity} for sib in siblings]

            # 4. UNASSIGNED POOL (Available to be "Pulled" in)
            unassigned_students = StudentExtra.objects.filter(cl__isnull=True).select_related('user')
            unassigned_data = []
            for s in unassigned_students:
                unassigned_data.append({
                    'id': s.id,
                    'name': s.get_name,
                    'roll': s.roll,
                    'enrollment_state': s.enrollment_state,
                    'enrollment_notes': s.enrollment_notes
                })

            return JsonResponse({
                'status': 'success',
                'data': {
                    'stream_name': stream.name,
                    'grade_name': grade.name,
                    'active_roster': active_data,
                    'exited_history': exited_data,
                    'sibling_streams': sibling_data,
                    'unassigned_pool': unassigned_data
                }
            })
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)})

    return JsonResponse({'status': 'error', 'message': 'Invalid request method'})


@csrf_exempt
@require_permission('classes.edit')
def api_bulk_transfer(request):
    """
    Moves multiple students to a sibling stream simultaneously to balance classes.
    """
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            student_ids = data.get('student_ids', [])
            target_stream_id = data.get('target_stream_id')

            if not student_ids or not target_stream_id:
                return JsonResponse({'status': 'error', 'message': 'Missing data'})

            new_stream = ClassStream.objects.get(id=target_stream_id)
            students = StudentExtra.objects.filter(id__in=student_ids)

            for student in students:
                student.cl = new_stream
                student.enrollment_state = 'Active'
                student.enrollment_notes = f"Bulk transferred to {new_stream.name}"
                student.save()

            return JsonResponse({
                'status': 'success',
                'message': f'Successfully moved {len(students)} students to {new_stream.name}.'
            })
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)})

    return JsonResponse({'status': 'error', 'message': 'Invalid request method'})


class ManageEnrollmentAPIView(APIView):
    """
    Handles Student Lifecycle Actions: Reactivate, Transfer, Suspend, Expel.
    Logs every change to SystemAuditLog and supports optional parent notifications.
    """
    authentication_classes = [CsrfExemptSessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    # classes.enrollment is the narrower alternative — lets a Registrar-type Staff role
    # transfer/reactivate/suspend/expel students without also granting classes.edit's
    # ability to restructure grades/streams/capacity/class-teacher assignment.
    rbac_edit_permission = ('classes.edit', 'classes.enrollment')

    def post(self, request, student_id):
        action = request.data.get('action')
        stream_id = request.data.get('stream_id')
        reason = request.data.get('reason', 'Administrative update.')
        notify_parent = request.data.get('notify_parent', False)

        if not action:
            return Response({"status": "error", "message": "Action parameter is required."},
                            status=status.HTTP_400_BAD_REQUEST)

        student = get_object_or_404(StudentExtra, id=student_id)

        try:
            with transaction.atomic():
                old_state = student.enrollment_state

                # --- 1. HANDLE THE ACTION ---
                if action in ['reactivate', 'transfer']:
                    if not stream_id:
                        return Response({"status": "error", "message": "Target Stream ID is required."},
                                        status=status.HTTP_400_BAD_REQUEST)

                    target_stream = get_object_or_404(ClassStream, id=stream_id)
                    student.cl = target_stream
                    student.enrollment_state = 'Active'
                    student.status = True

                    if student.user:
                        student.user.is_active = True
                        student.user.save()

                elif action == 'suspend':
                    student.enrollment_state = 'Suspended'

                elif action == 'transfer_out':
                    student.enrollment_state = 'Transferred'
                    student.cl = None
                    student.status = False

                elif action == 'expel':
                    student.enrollment_state = 'Expelled'
                    student.cl = None
                    student.status = False

                else:
                    return Response({"status": "error", "message": "Invalid action type."},
                                    status=status.HTTP_400_BAD_REQUEST)

                # Save the new status and notes
                student.enrollment_notes = reason
                student.save()

                # --- 2. LOG THE ACTION IMMUTABLY ---
                SystemAuditLog.objects.create(
                    operator=request.user,
                    action_type='UPDATE',
                    module='StudentExtra',
                    description=f"Changed {student.get_name} status from '{old_state}' to '{student.enrollment_state}'. Reason: {reason}"
                )

                # --- 3. OPTIONAL PARENT NOTIFICATION ---
                if notify_parent:
                    parents = ParentExtra.objects.filter(students=student)
                    for parent in parents:
                        Notification.objects.create(
                            recipient=parent.user,
                            title=f"Enrollment Update: {student.get_name}",
                            message=f"Status changed to {student.enrollment_state}. Remarks: {reason}"
                        )

            return Response({
                "status": "success",
                "message": f"Successfully updated student status to {student.enrollment_state}."
            }, status=status.HTTP_200_OK)

        except Exception as e:
            return Response({"status": "error", "message": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
