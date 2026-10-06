from rest_framework import serializers

from apps.identity.models import StaffExtra, TeacherExtra
from apps.staff.models import TeacherLeave
from school.rbac import user_has_permission


class TeacherLeaveSerializer(serializers.ModelSerializer):
    """
    Serializes leave applications for both the "apply" flow (teachers and staff,
    who never send 'teacher', 'staff' or 'status' - the view fills those in) and the
    review/approval flow (which reads applicant_name, relief info etc). A request belongs to
    exactly one applicant: a teacher OR a staff member.
    """
    teacher = serializers.PrimaryKeyRelatedField(queryset=TeacherExtra.objects.all(), required=False, allow_null=True)
    staff = serializers.PrimaryKeyRelatedField(queryset=StaffExtra.objects.all(), required=False, allow_null=True)
    applicant_name = serializers.SerializerMethodField()
    applicant_type = serializers.CharField(read_only=True)
    # Let the screens hide the decision buttons instead of offering something the server refuses:
    # your own request can't be decided by you, and an approver's request needs an administrator.
    applicant_user_id = serializers.SerializerMethodField()
    applicant_is_approver = serializers.SerializerMethodField()
    # Kept for existing clients that still read `teacher_name`; for staff requests it's the staff
    # member's name too, so nothing that displays it breaks.
    teacher_name = serializers.SerializerMethodField()
    leave_type_display = serializers.CharField(source='get_leave_type_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    duration_days = serializers.SerializerMethodField()
    is_long_term = serializers.BooleanField(read_only=True)
    relief_teacher_name = serializers.SerializerMethodField()
    relief_teacher_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)

    class Meta:
        model = TeacherLeave
        fields = [
            'id', 'teacher', 'staff', 'teacher_name', 'applicant_name', 'applicant_type', 'applicant_user_id', 'applicant_is_approver', 'leave_type', 'leave_type_display',
            'start_date', 'end_date', 'status', 'status_display', 'reason',
            'created_at', 'duration_days', 'is_long_term',
            'relief_teacher_name', 'relief_teacher_id',
        ]
        read_only_fields = ['created_at']

    def get_applicant_name(self, obj):
        applicant = obj.applicant
        return applicant.get_name if applicant else None

    def get_applicant_user_id(self, obj):
        user = obj.applicant_user
        return user.id if user else None

    def get_applicant_is_approver(self, obj):
        user = obj.applicant_user
        return bool(user) and user_has_permission(user, 'leave.approve')

    def get_teacher_name(self, obj):
        return self.get_applicant_name(obj)

    def get_duration_days(self, obj):
        if obj.start_date and obj.end_date:
            return (obj.end_date - obj.start_date).days + 1
        return None

    def get_relief_teacher_name(self, obj):
        relief = getattr(obj, 'longtermreliefassignment', None)
        return relief.relief_teacher.get_name if relief else None

    def validate(self, attrs):
        start_date = attrs.get('start_date', getattr(self.instance, 'start_date', None))
        end_date = attrs.get('end_date', getattr(self.instance, 'end_date', None))
        if start_date and end_date and start_date > end_date:
            raise serializers.ValidationError("Start date cannot be after the end date.")
        return attrs
