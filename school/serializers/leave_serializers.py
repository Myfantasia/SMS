from rest_framework import serializers

from apps.identity.models import TeacherExtra
from apps.staff.models import TeacherLeave


class TeacherLeaveSerializer(serializers.ModelSerializer):
    """
    Serializes teacher leave applications for both the "apply" flow (teachers,
    who never send 'teacher' or 'status' - the view fills those in) and the
    admin directory/approval flow (which reads teacher_name, relief info etc).
    """
    teacher = serializers.PrimaryKeyRelatedField(queryset=TeacherExtra.objects.all(), required=False)
    teacher_name = serializers.CharField(source='teacher.get_name', read_only=True)
    leave_type_display = serializers.CharField(source='get_leave_type_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    duration_days = serializers.SerializerMethodField()
    is_long_term = serializers.BooleanField(read_only=True)
    relief_teacher_name = serializers.SerializerMethodField()
    relief_teacher_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)

    class Meta:
        model = TeacherLeave
        fields = [
            'id', 'teacher', 'teacher_name', 'leave_type', 'leave_type_display',
            'start_date', 'end_date', 'status', 'status_display', 'reason',
            'created_at', 'duration_days', 'is_long_term',
            'relief_teacher_name', 'relief_teacher_id',
        ]
        read_only_fields = ['created_at']

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
