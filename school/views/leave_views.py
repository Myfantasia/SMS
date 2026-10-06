from django.contrib.auth.models import User
from django.db.models import Q
from rest_framework import viewsets, status
from rest_framework.authentication import SessionAuthentication
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response

from apps.identity.models import TeacherExtra, StaffExtra
from apps.staff.models import TeacherLeave, LongTermReliefAssignment
from apps.staff.services import can_decide_leave
from apps.messaging.models import Notification
from apps.core.services import write_audit_log
from school.serializers.leave_serializers import TeacherLeaveSerializer
from school.views.attendance_views import _is_admin
from school.rbac import HasModulePermission, user_has_permission


def _has_applicant_profile(user):
    """True for teachers and non-teaching staff -- the two kinds of account that can apply for
    leave. Applying for your own leave is a baseline right (like editing your own profile), so it
    needs no permission; everything about OTHER people's requests is permission-gated below."""
    return hasattr(user, 'teacherextra') or hasattr(user, 'staffextra')


def _dashboard_leave_url(user):
    """Where a user should land to see leave: their own dashboard's leave page."""
    if hasattr(user, 'teacherextra'):
        return "/teacher-dashboard/leave-requests"
    if hasattr(user, 'staffextra'):
        return "/staff-dashboard/leave-requests"
    return "/admin-dashboard/approvals/leave"


class LeavePermission(BasePermission):
    """Admins and anyone with a teacher/staff profile may reach the leave API (so every teacher
    and staff member can apply for their own leave with no permission); every other account
    needs the leave module permission, exactly as before. What each caller may then DO to a given
    request is decided per-action in TeacherLeaveViewSet."""

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        if _is_admin(user) or _has_applicant_profile(user):
            return True
        return HasModulePermission().has_permission(request, view)


class TeacherLeaveViewSet(viewsets.ModelViewSet):
    """
    LEAVE LOGISTICS GATEWAY (v3):
    - Teachers and staff: apply for their own leave (always lands 'Pending'), and may edit/cancel
      only their own requests while still undecided.
    - Approvers (admins, or anyone granted `leave.approve`): see every request and decide
      (Approve/Reject) both teacher and staff requests, and for long-term teacher leave an admin
      (or a `timetable.edit` holder) may attach a relief teacher in the same action.
    - Decision rules live in apps.staff.services.can_decide_leave: nobody decides their own
      request, and an approver's own leave is decided by an admin only.
    Replaces the legacy csrf_exempt `api_manage_leaves` function view.
    """
    serializer_class = TeacherLeaveSerializer
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, LeavePermission]
    rbac_view_permission = 'leave.view'
    # leave.approve is the narrower alternative to leave.edit for the module gate. Broad record
    # edits (backfill-create for anyone, delete any request) still need leave.edit specifically
    # (see _can_edit_broadly); deciding needs leave.approve (see can_decide_leave).
    rbac_edit_permission = ('leave.edit', 'leave.approve')

    # --- who is who ---------------------------------------------------------------------

    def _sees_all(self, user):
        """May see every request: admins, approvers, and (as before) non-teacher accounts holding
        leave.view. A teacher never sees others' requests unless they are an admin or an approver."""
        return (
            _is_admin(user)
            or user_has_permission(user, 'leave.approve')
            or (not hasattr(user, 'teacherextra') and user_has_permission(user, 'leave.view'))
        )

    def _can_edit_broadly(self, user):
        """Full leave.edit-tier capability: backfill-create for anyone, delete any request.
        Deliberately stricter than the "any non-teacher" check used for viewing -- a
        leave.approve-only holder should not also gain the ability to fabricate or erase records."""
        return _is_admin(user) or (not hasattr(user, 'teacherextra') and user_has_permission(user, 'leave.edit'))

    @staticmethod
    def _own_filter(user):
        q = Q(pk__in=[])
        if hasattr(user, 'teacherextra'):
            q |= Q(teacher=user.teacherextra)
        if hasattr(user, 'staffextra'):
            q |= Q(staff=user.staffextra)
        return q

    def get_queryset(self):
        user = self.request.user
        qs = TeacherLeave.objects.filter(is_deleted=False).select_related(
            'teacher__user', 'staff__user', 'longtermreliefassignment__relief_teacher__user'
        ).order_by('-created_at')

        # `?mine=1` is the "My leave" tab: your own requests, even if you can also review others'.
        if self.request.query_params.get('mine') or not self._sees_all(user):
            if not _has_applicant_profile(user):
                return TeacherLeave.objects.none()
            qs = qs.filter(self._own_filter(user))

        status_param = self.request.query_params.get('status')
        if status_param:
            qs = qs.filter(status=status_param)

        teacher_param = self.request.query_params.get('teacher')
        if teacher_param:
            qs = qs.filter(teacher_id=teacher_param)

        return qs

    # --- create -------------------------------------------------------------------------

    def _notify_reviewers_of_new_request(self, leave, applicant_user):
        """Admins always; plus every approver -- unless the applicant IS an approver, in which
        case only admins may decide it (so only admins are told)."""
        recipients = {u.id: u for u in User.objects.filter(
            Q(is_superuser=True) | Q(is_staff=True) | Q(groups__name='ADMIN')
        ).distinct()}
        applicant_is_approver = user_has_permission(applicant_user, 'leave.approve')
        if not applicant_is_approver:
            for u in User.objects.filter(
                rbac_roles__role__is_deleted=False,
                rbac_roles__role__permissions__code='leave.approve',
                is_active=True,
            ).distinct():
                recipients.setdefault(u.id, u)
        recipients.pop(applicant_user.id, None)  # never notify someone about their own request

        Notification.objects.bulk_create([
            Notification(
                recipient=recipient,
                title="New Leave Request",
                message=f"{leave.applicant.get_name} applied for {leave.get_leave_type_display()} "
                        f"({leave.start_date} to {leave.end_date}).",
                action_url=_dashboard_leave_url(recipient),
            ) for recipient in recipients.values()
        ])

    def perform_create(self, serializer):
        user = self.request.user
        data = serializer.validated_data
        named_teacher, named_staff = data.get('teacher'), data.get('staff')

        # Logging leave on someone's behalf: only with an explicit applicant, and only for admins
        # or a non-teacher holding full leave.edit.
        if (named_teacher or named_staff) and self._can_edit_broadly(user):
            if named_teacher and named_staff:
                raise ValidationError("A leave request belongs to one applicant: a teacher or a staff member, not both.")
            serializer.save(status=self.request.data.get('status', 'Pending'))
            return

        if _is_admin(user) and not _has_applicant_profile(user):
            raise ValidationError({"teacher": "Choose the teacher or staff member when logging leave as an admin."})

        # Self-service: apply for your own leave.
        if hasattr(user, 'teacherextra'):
            try:
                profile = TeacherExtra.objects.get(user=user, status=True)
            except TeacherExtra.DoesNotExist:
                raise PermissionDenied("Active teacher profile not found.")
            leave = serializer.save(teacher=profile, staff=None, status='Pending')
        elif hasattr(user, 'staffextra'):
            try:
                profile = StaffExtra.objects.get(user=user, status=True)
            except StaffExtra.DoesNotExist:
                raise PermissionDenied("Active staff profile not found.")
            leave = serializer.save(staff=profile, teacher=None, status='Pending')
        else:
            raise PermissionDenied("Only teachers and staff can apply for leave.")

        self._notify_reviewers_of_new_request(leave, user)

    # --- decide / edit ------------------------------------------------------------------

    def perform_update(self, serializer):
        user = self.request.user
        instance = self.get_object()
        applicant_user = instance.applicant_user
        is_owner = applicant_user is not None and applicant_user.id == user.id

        if is_owner:
            requested_status = serializer.validated_data.get('status')
            # An approver holding leave.approve is still never allowed to decide their own
            # request -- reject the attempt explicitly rather than silently treating it as a
            # no-op self-edit, which would return 200 and mislead the caller into thinking
            # their decision was recorded.
            if requested_status in ('Approved', 'Rejected') and requested_status != instance.status:
                raise PermissionDenied("You cannot approve or reject your own leave request.")
            # Otherwise: your own request, editable only while undecided; you can never change
            # who it belongs to.
            if instance.status != 'Pending':
                raise PermissionDenied("This request has already been decided and can no longer be edited.")
            serializer.validated_data.pop('status', None)
            serializer.validated_data.pop('teacher', None)
            serializer.validated_data.pop('staff', None)
            serializer.save(status='Pending', teacher=instance.teacher, staff=instance.staff)
            return

        new_status = serializer.validated_data.get('status')
        relief_teacher_id = self.request.data.get('relief_teacher_id')
        is_decision = (new_status in ('Approved', 'Rejected') and new_status != instance.status) or bool(relief_teacher_id)

        if is_decision:
            allowed, reason = can_decide_leave(
                decider_user_id=user.id,
                decider_is_admin=_is_admin(user),
                decider_can_approve=user_has_permission(user, 'leave.approve'),
                applicant_user_id=applicant_user.id if applicant_user else -1,
                applicant_can_approve=bool(applicant_user) and user_has_permission(applicant_user, 'leave.approve'),
            )
            if not allowed:
                raise PermissionDenied(reason)
        elif not self._can_edit_broadly(user):
            raise PermissionDenied("You may only edit your own leave requests.")

        # Attaching a relief teacher reshuffles the timetable, so it stays with admins (or someone
        # who may edit the timetable) -- an approver can approve or reject without it.
        if relief_teacher_id and not (_is_admin(user) or user_has_permission(user, 'timetable.edit')):
            raise PermissionDenied("Only an administrator or a timetable editor can assign a relief teacher.")

        # Security (review finding): the decision above was authorised against the
        # applicant on the stored request. Without this, an approver could reassign
        # `teacher`/`staff` in the same PATCH and approve their own leave. Only
        # leave.edit-tier users may reassign a request; everyone else keeps it pinned.
        if is_decision and not self._can_edit_broadly(user):
            for field in ('teacher', 'staff'):
                serializer.validated_data.pop(field, None)

        previous_status = instance.status
        leave = serializer.save()
        applicant = leave.applicant

        if previous_status != leave.status and leave.status in ('Approved', 'Rejected'):
            write_audit_log(
                operator_id=user.id if user.is_authenticated else None,
                action_type='UPDATE',
                module='TeacherLeave',
                description=f"{leave.status} {applicant.get_name}'s {leave.get_leave_type_display()} "
                            f"request ({leave.start_date} to {leave.end_date})."
            )

        # Relief teachers only make sense for teacher leave (staff don't teach lessons).
        if leave.status == 'Approved' and relief_teacher_id and leave.teacher_id:
            relief, relief_created = LongTermReliefAssignment.objects.update_or_create(
                associated_leave=leave,
                defaults={
                    'absent_teacher': leave.teacher,
                    'relief_teacher_id': relief_teacher_id,
                    'start_date': leave.start_date,
                    'end_date': leave.end_date,
                }
            )
            write_audit_log(
                operator_id=user.id if user.is_authenticated else None,
                action_type='CREATE' if relief_created else 'UPDATE',
                module='LongTermReliefAssignment',
                description=f"{'Assigned' if relief_created else 'Updated'} {relief.relief_teacher.get_name} as "
                            f"long-term relief for {leave.teacher.get_name} ({leave.start_date} to {leave.end_date})."
            )

        if previous_status != leave.status and leave.status in ('Approved', 'Rejected'):
            Notification.objects.create(
                recipient=applicant.user,
                title=f"Leave {leave.status}",
                message=f"Your {leave.get_leave_type_display()} request "
                        f"({leave.start_date} to {leave.end_date}) was {leave.status.lower()}.",
                action_url=_dashboard_leave_url(applicant.user),
            )

    def perform_destroy(self, instance):
        user = self.request.user
        applicant_user = instance.applicant_user
        is_owner = applicant_user is not None and applicant_user.id == user.id

        if is_owner:
            if instance.status != 'Pending':
                raise PermissionDenied("Only pending requests can be cancelled.")
            instance.delete()
            return

        if self._can_edit_broadly(user):
            from apps.core.trash import soft_delete
            soft_delete(
                instance, operator=user if user.is_authenticated else None,
                module='TeacherLeave',
                description=f"Deleted {instance.applicant.get_name}'s {instance.get_leave_type_display()} "
                            f"request ({instance.start_date} to {instance.end_date}), status was {instance.status}.",
            )
            return

        raise PermissionDenied("You may only cancel your own leave requests.")

    @action(detail=False, methods=['get'])
    def stats(self, request):
        qs = self.get_queryset()
        return Response({
            'pending': qs.filter(status='Pending').count(),
            'approved': qs.filter(status='Approved').count(),
            'rejected': qs.filter(status='Rejected').count(),
            'total': qs.count(),
        }, status=status.HTTP_200_OK)
