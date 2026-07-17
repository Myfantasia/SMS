from django.contrib.auth.models import User
from django.db.models import Q
from rest_framework import viewsets, status
from rest_framework.authentication import SessionAuthentication
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from school.models.models import Notification, TeacherExtra
from school.models.teachers_model import TeacherLeave, LongTermReliefAssignment
from school.models.classSubjects_models import SystemAuditLog
from school.serializers.leave_serializers import TeacherLeaveSerializer
from school.views.attendance_views import _is_admin
from school.rbac import HasModulePermission, user_has_permission

class CsrfExemptSessionAuthentication(SessionAuthentication):
    def enforce_csrf(self, request):
        return


class TeacherLeaveViewSet(viewsets.ModelViewSet):
    """
    LEAVE LOGISTICS GATEWAY (v2):
    - Teachers: see and manage only their own applications, always land as 'Pending',
      and may only edit/cancel while still undecided.
    - Admins: see every application across the school, decide (Approve/Reject) and,
      for long-term leaves, optionally attach a relief teacher in the same action.
    Replaces the legacy csrf_exempt `api_manage_leaves` function view.
    """
    serializer_class = TeacherLeaveSerializer
    authentication_classes = [CsrfExemptSessionAuthentication]
    # Base module gate only — the existing _is_admin-driven self-vs-all scoping and
    # approve/reject logic below (get_queryset/perform_create/perform_update/perform_destroy)
    # is untouched; this just requires the module be granted at all.
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'leave.view'
    # leave.approve is the narrower alternative: it lets someone see every request and
    # decide (approve/reject + relief-teacher assignment) in perform_update, but
    # perform_create/perform_destroy's broader "act on behalf of / delete any request"
    # capability below is still gated on leave.edit specifically (see _can_edit_broadly).
    rbac_edit_permission = ('leave.edit', 'leave.approve')

    def get_queryset(self):
        user = self.request.user
        qs = TeacherLeave.objects.select_related(
            'teacher__user', 'longtermreliefassignment__relief_teacher__user'
        ).order_by('-created_at')

        if not (_is_admin(user) or not hasattr(user, 'teacherextra')):
            try:
                teacher_profile = TeacherExtra.objects.get(user=user)
            except TeacherExtra.DoesNotExist:
                return TeacherLeave.objects.none()
            qs = qs.filter(teacher=teacher_profile)

        status_param = self.request.query_params.get('status')
        if status_param:
            qs = qs.filter(status=status_param)

        teacher_param = self.request.query_params.get('teacher')
        if teacher_param:
            qs = qs.filter(teacher_id=teacher_param)

        return qs

    def _can_edit_broadly(self, user):
        """Full leave.edit-tier capability: backfill-create for anyone, delete any request.
        Deliberately stricter than the "any non-teacher" check used for viewing/deciding —
        a leave.approve-only holder (e.g. a Staff account granted just decision-making
        rights) should not also gain the ability to fabricate or erase records."""
        return _is_admin(user) or (not hasattr(user, 'teacherextra') and user_has_permission(user, 'leave.edit'))

    def perform_create(self, serializer):
        user = self.request.user

        if self._can_edit_broadly(user):
            # Admins (or a Staff account holding full leave.edit) may log/backfill a leave
            # record on behalf of any teacher.
            if not serializer.validated_data.get('teacher'):
                raise ValidationError({"teacher": "This field is required when logging leave as an admin."})
            serializer.save(status=self.request.data.get('status', 'Pending'))
            return

        try:
            teacher_profile = TeacherExtra.objects.get(user=user, status=True)
        except TeacherExtra.DoesNotExist:
            raise PermissionDenied("Active teacher profile not found.")

        leave = serializer.save(teacher=teacher_profile, status='Pending')

        admins = User.objects.filter(
            Q(is_superuser=True) | Q(is_staff=True) | Q(groups__name='ADMIN')
        ).distinct()
        Notification.objects.bulk_create([
            Notification(
                recipient=admin_user,
                title="New Leave Request",
                message=f"{teacher_profile.get_name} applied for {leave.get_leave_type_display()} "
                        f"({leave.start_date} to {leave.end_date}).",
                action_url="/admin-dashboard/approvals/leave",
            ) for admin_user in admins
        ])

    def perform_update(self, serializer):
        user = self.request.user
        instance = self.get_object()

        if _is_admin(user) or not hasattr(user, 'teacherextra'):
            relief_teacher_id = self.request.data.get('relief_teacher_id')
            previous_status = instance.status
            leave = serializer.save()

            if previous_status != leave.status and leave.status in ('Approved', 'Rejected'):
                SystemAuditLog.objects.create(
                    operator=user if user.is_authenticated else None,
                    action_type='UPDATE',
                    module='TeacherLeave',
                    description=f"{leave.status} {leave.teacher.get_name}'s {leave.get_leave_type_display()} "
                                f"request ({leave.start_date} to {leave.end_date})."
                )

            if leave.status == 'Approved' and relief_teacher_id:
                relief, relief_created = LongTermReliefAssignment.objects.update_or_create(
                    associated_leave=leave,
                    defaults={
                        'absent_teacher': leave.teacher,
                        'relief_teacher_id': relief_teacher_id,
                        'start_date': leave.start_date,
                        'end_date': leave.end_date,
                    }
                )
                SystemAuditLog.objects.create(
                    operator=user if user.is_authenticated else None,
                    action_type='CREATE' if relief_created else 'UPDATE',
                    module='LongTermReliefAssignment',
                    description=f"{'Assigned' if relief_created else 'Updated'} {relief.relief_teacher.get_name} as "
                                f"long-term relief for {leave.teacher.get_name} ({leave.start_date} to {leave.end_date})."
                )

            if previous_status != leave.status and leave.status in ('Approved', 'Rejected'):
                Notification.objects.create(
                    recipient=leave.teacher.user,
                    title=f"Leave {leave.status}",
                    message=f"Your {leave.get_leave_type_display()} request "
                            f"({leave.start_date} to {leave.end_date}) was {leave.status.lower()}.",
                    action_url="/teacher-dashboard/leave-requests",
                )
            return

        if instance.teacher.user_id != user.id:
            raise PermissionDenied("You may only edit your own leave requests.")
        if instance.status != 'Pending':
            raise PermissionDenied("This request has already been decided and can no longer be edited.")

        serializer.validated_data.pop('status', None)
        serializer.validated_data.pop('teacher', None)
        serializer.save(status='Pending', teacher=instance.teacher)

    def perform_destroy(self, instance):
        user = self.request.user
        if self._can_edit_broadly(user):
            SystemAuditLog.objects.create(
                operator=user if user.is_authenticated else None,
                action_type='DELETE',
                module='TeacherLeave',
                description=f"Deleted {instance.teacher.get_name}'s {instance.get_leave_type_display()} "
                            f"request ({instance.start_date} to {instance.end_date}), status was {instance.status}."
            )
            instance.delete()
            return

        if instance.teacher.user_id != user.id:
            raise PermissionDenied("You may only cancel your own leave requests.")
        if instance.status != 'Pending':
            raise PermissionDenied("Only pending requests can be cancelled.")
        instance.delete()

    @action(detail=False, methods=['get'])
    def stats(self, request):
        qs = self.get_queryset()
        return Response({
            'pending': qs.filter(status='Pending').count(),
            'approved': qs.filter(status='Approved').count(),
            'rejected': qs.filter(status='Rejected').count(),
            'total': qs.count(),
        }, status=status.HTTP_200_OK)
