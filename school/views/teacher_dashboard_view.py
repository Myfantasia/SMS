from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.authentication import SessionAuthentication
from datetime import datetime
from django.db.models import F, Q
from school.models.timetable_models import LessonAllocation, Timetable
from school.models.models import (
    TeacherExtra,
    Notice,
    ExamEvent,
    StudentExtra,
    AttendanceSession,
)
from django.db import transaction
from school.models.assignments_models import StudentSubmission
from school.models.chat_models import ThreadParticipant
from school.serializers.teacher_serializers import TeacherProfileSerializer, TodayTimetableSerializer, NoticeSerializer
from django.contrib.auth import authenticate, login
from django.contrib.auth.models import User
from school.decorators import require_permission
from school.rbac import HasModulePermission
from django.shortcuts import render, redirect
from django.contrib import messages
from rest_framework import status
import json
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from school.models.teachers_model import TeacherStructuralAvailability, TeacherLeave
from school.models.classSubjects_models import SystemAuditLog

class TeacherDashboardOverviewAPI(APIView):
    """
    API Endpoint for the React Teacher Dashboard Home.
    Aggregates Profile stats, Notices, Today's Timetable, and cross-domain Pending Action items.
    """
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user

        # 1. IDENTITY VERIFICATION (ReBAC)
        try:
            teacher = TeacherExtra.objects.get(user=user, status=True)
        except TeacherExtra.DoesNotExist:
            return Response({"error": "Active Teacher profile not found."}, status=403)

        # 2. PROFILE DATA (Passed through Serializer)
        # Passing context={'request': request} ensures the image URL builds properly
        profile_data = TeacherProfileSerializer(teacher, context={'request': request}).data

        # 3. COMMUNICATION: NOTICES (Passed through Serializer)
        # Grabs the 5 most recent notices targeted at Teachers or Everyone
        notices = Notice.objects.filter(audience__in=['All', 'Teachers']).order_by('-date')[:5]
        notice_data = NoticeSerializer(notices, many=True).data

        # 4. LOGISTICS: TODAY'S TIMETABLE (Passed through Serializer)
        # Dynamically filters the Lesson allocations to only show what the teacher is teaching TODAY
        today_name = datetime.now().strftime('%A')
        allocations = LessonAllocation.objects.filter(
            teacher=teacher,
            time_slot__day=today_name,
            timetable__is_active=True
        ).select_related('time_slot', 'subject', 'class_stream__grade').order_by('time_slot__start_time')

        timetable_data = TodayTimetableSerializer(allocations, many=True).data

        # 5. PRODUCTIVITY: ACTION ITEMS (Cross-Domain Queries)

        # A. Ungraded Exams (Draft Status)
        pending_exams_count = ExamEvent.objects.filter(status='Draft').count()

        # B. Ungraded Assignments
        # Looks into the Assignment Engine to find submissions specifically submitted to THIS teacher that need marking
        pending_assignments_count = StudentSubmission.objects.filter(
            assignment__teacher=teacher,
            grading_status='Pending'
        ).count()

        # C. Unread Chat Messages
        # Uses Django's F() expression to compare two columns in the database:
        # "Is the thread's updated_at timestamp newer than the user's last_read_timestamp?"
        unread_chats_count = ThreadParticipant.objects.filter(
            user=user,
            thread__is_active=True
        ).filter(
            Q(last_read_timestamp__isnull=True) | Q(last_read_timestamp__lt=F('thread__updated_at'))
        ).count()

        # D. Own Leave Requests Still Awaiting an Admin Decision
        pending_leaves_count = TeacherLeave.objects.filter(teacher=teacher, status='Pending').count()

        # 6. HOMEROOM CONTEXT: ordinary subject teachers vs. class ("homeroom") teachers
        # get meaningfully different dashboards. A teacher is a class teacher for a
        # given stream when ClassStream.class_teacher points at them (related_name
        # 'assigned_classes'). This block stays a self-contained, nullable addition
        # so future teacher sub-roles (e.g. department heads) can bolt on the same way
        # without touching the fields above.
        homeroom_stream = teacher.assigned_classes.filter(is_deleted=False).select_related('grade').first()
        homeroom_data = None
        if homeroom_stream:
            today = datetime.now().date()
            homeroom_data = {
                "class_stream_id": homeroom_stream.id,
                "class_name": f"{homeroom_stream.grade.name} {homeroom_stream.name}",
                "student_count": StudentExtra.objects.filter(cl=homeroom_stream, status=True).count(),
                "attendance_submitted_today": AttendanceSession.objects.filter(
                    class_stream=homeroom_stream, date=today
                ).exists(),
            }

        # 7. MASTER PAYLOAD ASSEMBLY
        return Response({
            "status": "success",
            "data": {
                "profile": profile_data,
                "notices": notice_data,
                "today_timetable": timetable_data,
                "is_class_teacher": homeroom_data is not None,
                "homeroom": homeroom_data,
                "action_items": {
                    "pending_exams": pending_exams_count,
                    "pending_assignments": pending_assignments_count,
                    "unread_messages": unread_chats_count,
                    "pending_leaves": pending_leaves_count
                }
            }
        })


def teacher_login_view(request):
    # If already logged in, send them straight to the router
    if request.user.is_authenticated:
        return redirect('afterlogin')

    if request.method == 'POST':
        # Extract email instead of username from the POST request
        email = request.POST.get('email')
        password = request.POST.get('password')

        try:
            # 1. Find the User object linked to this email
            user = User.objects.get(email=email)

            # 2. Authenticate using the username tied to that email
            auth_user = authenticate(username=user.username, password=password)

            if auth_user is not None:
                # Log them into Django
                login(request, auth_user)
                return redirect('afterlogin')
            else:
                messages.error(request, 'Invalid email or password.')

        except User.DoesNotExist:
            messages.error(request, 'No account found with this email.')

    # GET request: just render the login page
    return render(request, 'school/teachers/teacherlogin.html')


class TeacherPersonalTimetableAPIView(APIView):
    """
    Secure RBAC Endpoint for the Teacher Dashboard workspace.
    Retrieves the complete personal weekly schedule matrix for the logged-in teacher.
    """
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'timetable.view'

    def get(self, request):
        user = request.user

        try:
            teacher_profile = TeacherExtra.objects.get(user=user)
        except TeacherExtra.DoesNotExist:
            return Response(
                {"error": "Profile Error: Logged-in user is not registered as an active school educator."},
                status=status.HTTP_403_FORBIDDEN
            )

        # 2. Grab the current globally active timetable context
        active_timetable = Timetable.objects.filter(is_active=True).first()
        if not active_timetable:
            return Response(
                {"message": "No active timetable framework published for this term yet.", "timetable_data": []},
                status=status.HTTP_200_OK
            )

        # 3. Pull all lessons explicitly assigned to this teacher across the grid
        allocations = LessonAllocation.objects.filter(
            timetable=active_timetable,
            teacher=teacher_profile
        ).select_related('time_slot', 'subject', 'class_stream', 'class_stream__grade')

        # 4. Serialize into a clean layout structure for the frontend UI grid matrix
        timetable_data = []
        for alloc in allocations:
            timetable_data.append({
                "allocation_id": alloc.id,
                "subject_id": alloc.subject.id,
                "subject_name": alloc.subject.name,
                "subject_code": getattr(alloc.subject, 'code', ''),
                "classroom_id": alloc.class_stream.id,
                "classroom_name": alloc.class_stream.name,
                "grade_level": alloc.class_stream.grade.name,
                "is_double": alloc.is_double_period,
                "time_slot": {
                    "id": alloc.time_slot.id,
                    "day": alloc.time_slot.day,
                    "start_time": alloc.time_slot.start_time.strftime('%H:%M'),
                    "end_time": alloc.time_slot.end_time.strftime('%H:%M'),
                    "is_remedial": alloc.time_slot.is_remedial
                }
            })

        return Response({
            "teacher_name": teacher_profile.get_name(),
            "timetable_name": active_timetable.name,
            "term": active_timetable.term.name if active_timetable.term else None,
            "academic_year": active_timetable.academic_year.year if active_timetable.academic_year else None,
            "lessons_count": len(timetable_data),
            "timetable_data": timetable_data
        }, status=status.HTTP_200_OK)


@csrf_exempt
@require_permission('timetable.view', edit_permission='timetable.edit')
def api_manage_teacher_availability(request, teacher_id):
    """
    MANAGES TEACHER BLOCKOUT MATRIX:
    Handles single-slot OR batch weekly unavailability rules for a teacher profile.
    Automatically ejects colliding lessons back to the unscheduled bucket.
    """
    if request.method == 'GET':
        blocks = TeacherStructuralAvailability.objects.filter(teacher_id=teacher_id)
        data = [{
            'id': b.id,
            'time_slot_id': b.time_slot_id,
            'reason': b.reason
        } for b in blocks]
        return JsonResponse({'status': 'success', 'data': data})

    elif request.method == 'POST':
        try:
            data = json.loads(request.body)

            # Accepts either a single slot ID or an array for batch operations
            time_slot_ids = data.get('time_slot_ids', [])
            if not time_slot_ids and data.get('time_slot_id'):
                time_slot_ids = [data.get('time_slot_id')]

            reason = data.get('reason', 'Structural Blockout')
            remove_block = data.get('remove', False)

            if not time_slot_ids:
                return JsonResponse({'status': 'error', 'message': 'No time slots provided.'}, status=400)

            ejected_count = 0

            with transaction.atomic():
                if remove_block:
                    # Bulk remove blockouts
                    TeacherStructuralAvailability.objects.filter(
                        teacher_id=teacher_id,
                        time_slot_id__in=time_slot_ids
                    ).delete()
                    msg = f"Removed blockouts across {len(time_slot_ids)} slot(s)."
                    SystemAuditLog.objects.create(
                        operator=request.user if request.user.is_authenticated else None,
                        action_type='DELETE',
                        module='TeacherStructuralAvailability',
                        description=f"{msg} (teacher_id={teacher_id})"
                    )
                else:
                    # 1. Eject any existing active lessons assigned to this teacher in these slots
                    # Deleting these rows automatically returns them to the Unscheduled Bucket
                    colliding_lessons = LessonAllocation.objects.filter(
                        teacher_id=teacher_id,
                        time_slot_id__in=time_slot_ids
                    )
                    ejected_count = colliding_lessons.count()
                    colliding_lessons.delete()

                    # 2. Bulk apply availability restrictions
                    for slot_id in time_slot_ids:
                        TeacherStructuralAvailability.objects.update_or_create(
                            teacher_id=teacher_id,
                            time_slot_id=slot_id,
                            defaults={'reason': reason}
                        )

                    msg = f"Availability restricted across {len(time_slot_ids)} slot(s)."
                    if ejected_count > 0:
                        msg += f" {ejected_count} existing lesson(s) returned to unscheduled buckets."

                    SystemAuditLog.objects.create(
                        operator=request.user if request.user.is_authenticated else None,
                        action_type='UPDATE',
                        module='TeacherStructuralAvailability',
                        description=f"{msg} (teacher_id={teacher_id}, reason='{reason}')"
                    )

            return JsonResponse({
                'status': 'success',
                'message': msg,
                'ejected_lessons_count': ejected_count
            })

        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)}, status=500)

    return JsonResponse({'status': 'error', 'message': 'Method not allowed.'}, status=405)