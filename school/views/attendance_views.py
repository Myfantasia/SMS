from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status, viewsets
from django.db import transaction
from django.db.models import Count
from django.utils import timezone
from apps.identity.models import ( StudentExtra,
                                  ParentExtra)
from apps.messaging.models import Notification, Event, Notice
from apps.attendance.models import AttendanceSession, AttendanceRecord
from school.serializers.serializers import EventSerializer, NotificationSerializer, NoticeSerializer
from apps.academics.models import ClassStream
from school.pagination import StandardResultsPagination
from school.rbac import HasModulePermission, user_has_permission



def _is_admin(user):
    """
    Canonical admin check, matching the convention already used elsewhere in the
    codebase (see api_manage_classes in class_views.py) — broader than just
    is_superuser/AdminExtra, since real admin accounts here are more commonly
    flagged via is_staff or the 'ADMIN' group.
    """
    return (
        user.is_superuser or user.is_staff or
        user.groups.filter(name='ADMIN').exists() or
        hasattr(user, 'adminextra')
    )


def _enforce_class_teacher_or_admin(request, class_stream):
    """
    Shared RBAC gate for attendance endpoints: the officially assigned Class Teacher
    for this stream, or an admin, may proceed. Returns a Response to short-circuit
    with, or None if the request is authorized.
    """
    if hasattr(request.user, 'teacherextra'):
        if class_stream.class_teacher != request.user.teacherextra:
            return Response(
                {"error": "Unauthorized. Only the officially assigned Class Teacher can access this register."},
                status=status.HTTP_403_FORBIDDEN
            )
    elif not _is_admin(request.user):
        return Response({"error": "Unauthorized user role."}, status=status.HTTP_403_FORBIDDEN)
    return None


class SubmitBatchAttendanceView(APIView):
    """
    Handles the 'Exception-Based' rapid entry from the Admin/Teacher dashboard.
    Now includes strict Role-Based Access Control (RBAC) to ensure only
    Admins or the assigned Class Teacher can submit the register.
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_edit_permission = 'attendance.edit'

    @transaction.atomic
    def post(self, request):
        class_id = request.data.get('class_stream_id')
        date = request.data.get('date')
        # Exceptions format: [{'student_id': 5, 'status': 'Absent', 'remarks': 'Sick'}, ...]
        exceptions = request.data.get('exceptions', [])

        # 1. Fetch the actual ClassStream object to verify permissions
        try:
            class_stream = ClassStream.objects.get(id=class_id)
        except ClassStream.DoesNotExist:
            return Response({"error": "Class not found."}, status=status.HTTP_404_NOT_FOUND)

        # ==========================================
        # 2. SECURITY CHECK: Enforce "Class Teacher Only" Rule
        # ==========================================
        denied = _enforce_class_teacher_or_admin(request, class_stream)
        if denied:
            return denied
        # ==========================================

        # 3. Create the Master Session using the verified class_stream
        session, created = AttendanceSession.objects.get_or_create(
            class_stream=class_stream,
            date=date,
            defaults={'submitted_by': request.user}
        )

        if not created:
            return Response(
                {"error": "Attendance has already been submitted for this class on this date."},
                status=status.HTTP_400_BAD_REQUEST
            )

        # 4. Fetch all active (approved) students in this specific class
        students = StudentExtra.objects.filter(cl=class_stream, status=True)

        # Convert exceptions list to a dictionary for ultra-fast lookups (O(1) time complexity)
        exception_dict = {ex['student_id']: ex for ex in exceptions}

        records_to_create = []
        notifications_to_create = []

        # 5. Loop through EVERY student in the class
        for student in students:
            # Default to Present (The core of our fast-entry philosophy)
            status_val = 'Present'
            remarks = ''

            # If the student is in the exceptions list, update their status
            if student.id in exception_dict:
                status_val = exception_dict[student.id]['status']
                remarks = exception_dict[student.id].get('remarks', '')

                # Trigger Parent Notifications for Absences or Lateness
                if status_val in ['Absent', 'Late']:
                    # Find any Parent associated with this student
                    parents = ParentExtra.objects.filter(students=student)
                    for parent in parents:
                        notifications_to_create.append(
                            Notification(
                                recipient=parent.user,
                                title="Attendance Alert",
                                message=f"{student.get_name} was marked {status_val} on {date}. Remarks: {remarks}"
                            )
                        )

            # Stage the attendance record
            records_to_create.append(
                AttendanceRecord(session=session, student=student, status=status_val, remarks=remarks)
            )

        # 6. Execute Bulk Database Inserts
        AttendanceRecord.objects.bulk_create(records_to_create)

        if notifications_to_create:
            Notification.objects.bulk_create(notifications_to_create)

        return Response({"message": "Attendance submitted and parents notified successfully!"},
                        status=status.HTTP_201_CREATED)


class AttendanceRosterView(APIView):
    """
    Fetches the class roster for a given date, along with each student's current
    attendance status — defaulting to 'Present' if no register has been submitted
    yet, or reflecting the already-submitted session's records otherwise.
    """
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'attendance.view'

    def get(self, request, class_stream_id, date):
        try:
            class_stream = ClassStream.objects.select_related('grade', 'class_teacher__user').get(id=class_stream_id)
        except ClassStream.DoesNotExist:
            return Response({"error": "Class not found."}, status=status.HTTP_404_NOT_FOUND)

        denied = _enforce_class_teacher_or_admin(request, class_stream)
        if denied:
            return denied

        session = AttendanceSession.objects.filter(class_stream=class_stream, date=date).first()
        records_map = {}
        if session:
            records_map = {r.student_id: r for r in session.records.all()}

        students = StudentExtra.objects.filter(cl=class_stream, status=True).select_related('user').order_by('user__first_name')
        student_data = [{
            "id": s.id,
            "name": s.get_name,
            "roll": s.roll,
            "status": records_map[s.id].status if s.id in records_map else "Present",
            "remarks": records_map[s.id].remarks if s.id in records_map else "",
        } for s in students]

        return Response({
            "class_stream": {"id": class_stream.id, "name": str(class_stream)},
            "date": date,
            "already_submitted": session is not None,
            "submitted_by": session.submitted_by.get_full_name() if session and session.submitted_by else None,
            "submitted_at": session.created_at.isoformat() if session else None,
            "students": student_data,
        })


class AdminAttendanceOverviewView(APIView):
    """
    Admin dashboard aggregates: today's (or a chosen date's) present/absent/late/
    excused counts, which classes have submitted their register vs which are still
    pending, and a recent feed of exception (non-Present) records.
    """
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'attendance.view'

    def get(self, request):
        # This is deliberately narrower than plain attendance.view: ordinary teachers hold
        # that code too (for their own roster), but this admin-wide aggregate across every
        # class stream is not meant for them. A non-teacher who holds attendance.view (an
        # admin, or a Staff account with an Attendance-granting Role) has no "own roster"
        # notion and should get the same broad view an admin does.
        if not (_is_admin(request.user) or not hasattr(request.user, 'teacherextra')):
            return Response({"error": "Unauthorized. Admins only."}, status=status.HTTP_403_FORBIDDEN)

        date = request.query_params.get('date') or timezone.localdate().isoformat()

        streams = list(ClassStream.physical.select_related('grade', 'class_teacher__user').all())
        sessions = {
            s.class_stream_id: s
            for s in AttendanceSession.objects.filter(date=date, class_stream_id__in=[s.id for s in streams])
        }

        pending, submitted = [], []
        for stream in streams:
            teacher_name = stream.class_teacher.get_name if stream.class_teacher else "Not Assigned"
            entry = {"id": stream.id, "name": str(stream), "teacher": teacher_name}
            session = sessions.get(stream.id)
            if session:
                submitted.append({**entry, "time": session.created_at.strftime('%I:%M %p')})
            else:
                pending.append(entry)

        status_counts = AttendanceRecord.objects.filter(
            session__date=date, session__class_stream_id__in=[s.id for s in streams]
        ).values('status').annotate(count=Count('id'))
        counts = {row['status']: row['count'] for row in status_counts}
        present, absent, late, excused = (
            counts.get('Present', 0), counts.get('Absent', 0),
            counts.get('Late', 0), counts.get('Excused', 0)
        )

        exceptions_qs = AttendanceRecord.objects.filter(
            session__date=date, session__class_stream_id__in=[s.id for s in streams]
        ).exclude(status='Present').select_related(
            'student__user', 'session__class_stream__grade'
        ).order_by('-session__created_at')[:50]
        exceptions = [{
            "id": r.id,
            "student": r.student.get_name,
            "class": str(r.session.class_stream),
            "status": r.status,
            "remarks": r.remarks or "",
            "time": r.session.created_at.strftime('%I:%M %p'),
        } for r in exceptions_qs]

        return Response({
            "date": date,
            "kpis": {
                "total_students": present + absent + late + excused,
                "present": present, "absent": absent, "late": late, "excused": excused,
                "total_classes": len(streams),
                "submitted_classes": len(submitted),
            },
            "pending_registers": pending,
            "submitted_registers": submitted,
            "exceptions": exceptions,
        })


class IsAdminForWrite(IsAuthenticated):
    """
    Read access for any authenticated user (admin, teacher, student, parent);
    create/update/delete restricted to admins, or to anyone else holding the view's
    rbac_edit_permission (e.g. a Staff account whose assigned Role grants notices.edit) —
    matching the dashboard UI which shows those controls to admin, and now to Staff whose
    permissions unlock them (see ManageCurriculum-style RBAC delegation elsewhere).
    """

    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        if view.action in ('create', 'update', 'partial_update', 'destroy'):
            edit_code = getattr(view, 'rbac_edit_permission', None)
            return _is_admin(request.user) or (edit_code and user_has_permission(request.user, edit_code))
        return True


# Standard ViewSets for data that just needs basic CRUD (Create, Read, Update, Delete) operations
class EventViewSet(viewsets.ModelViewSet):
    queryset = Event.objects.all()
    serializer_class = EventSerializer
    # Read stays open to any authenticated user (students/parents view events too);
    # only create/update/delete gets the extra RBAC layer, on top of IsAdminForWrite.
    permission_classes = [IsAdminForWrite, HasModulePermission]
    rbac_edit_permission = 'events.edit'

    def get_queryset(self):
        return Event.objects.filter(is_active=True).order_by('-start_time')

    def perform_destroy(self, instance):
        from apps.core.trash import soft_delete
        soft_delete(
            instance, operator=self.request.user, module='Events',
            flag_field='is_active', flag_true=False,
            description=f"Deleted event '{instance.title}'.",
        )


class NoticeViewSet(viewsets.ModelViewSet):
    serializer_class = NoticeSerializer
    # Same as EventViewSet: read stays open, only writes get the extra RBAC layer.
    permission_classes = [IsAdminForWrite, HasModulePermission]
    rbac_edit_permission = 'notices.edit'
    # The board only grows over time — paginated (unlike most list endpoints in this
    # app) so it doesn't become an ever-larger single response. See NoticesHub.tsx /
    # AdminDashboard.tsx, updated to read response.data.results instead of response.data.
    pagination_class = StandardResultsPagination

    def get_queryset(self):
        # Admins see every notice; everyone else only sees notices actually
        # addressed to them ('All' plus their own audience bucket) instead of
        # the whole board regardless of the audience field.
        queryset = Notice.objects.filter(is_deleted=False).order_by('-date')
        user = self.request.user
        if _is_admin(user) or user_has_permission(user, 'notices.edit'):
            return queryset
        if hasattr(user, 'teacherextra'):
            return queryset.filter(audience__in=['All', 'Teachers'])
        if hasattr(user, 'studentextra'):
            return queryset.filter(audience__in=['All', 'Students'])
        if hasattr(user, 'parentextra'):
            return queryset.filter(audience__in=['All', 'Parents'])
        return queryset.filter(audience='All')

    def perform_destroy(self, instance):
        from apps.core.trash import soft_delete
        soft_delete(
            instance, operator=self.request.user, module='Notices',
            description=f"Deleted notice '{instance.title}'.",
        )


class NotificationViewSet(viewsets.ModelViewSet):
    serializer_class = NotificationSerializer
    # Self-service (each user's own notification feed) — no RBAC module gate,
    # every authenticated user needs access to their own notifications.
    permission_classes = [IsAuthenticated]
    # Unbounded per-user history over time. See Notifications.tsx, updated to read
    # response.data.results instead of response.data.
    pagination_class = StandardResultsPagination
    # Every real notification is created server-side (orchestration/tasks.py, class_views.py,
    # leave_views.py — direct Notification.objects.create(...) calls) and Notifications.tsx
    # only ever GETs (list) and PATCHes (mark read). NotificationSerializer uses fields =
    # '__all__', which includes `recipient` — leaving POST/PUT/DELETE open let any
    # authenticated user forge a notification into an arbitrary recipient's feed. Restricting
    # to what's actually used removes that surface entirely.
    http_method_names = ['get', 'patch', 'head', 'options']

    def get_queryset(self):
        # Security: A user should ONLY be able to fetch their own notifications
        return Notification.objects.filter(recipient=self.request.user).order_by('-created_at')