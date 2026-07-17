from rest_framework import serializers

from school.models.timetable_models import LessonAllocation
from school.models.models import TeacherExtra, Notice


class TeacherProfileSerializer(serializers.ModelSerializer):
    """Translates the Teacher model into a clean profile object for the dashboard."""
    # We map 'get_name' from your model directly to 'name' in JSON
    name = serializers.CharField(source='get_name', read_only=True)
    # Format the date specifically for the frontend
    joined = serializers.DateField(source='joindate', format='%Y-%m-%d', read_only=True)
    # We use a custom method to ensure the image URL is absolute (includes http://domain...)
    profile_pic = serializers.SerializerMethodField()

    class Meta:
        model = TeacherExtra
        fields = ['name', 'mobile', 'subjects', 'profile_pic', 'salary', 'joined']

    def get_profile_pic(self, obj):
        request = self.context.get('request')
        if obj.profile_pic and request:
            return request.build_absolute_uri(obj.profile_pic.url)
        return None


class NoticeSerializer(serializers.ModelSerializer):
    """Formats school notices."""
    date = serializers.DateField(format='%Y-%m-%d', read_only=True)

    class Meta:
        model = Notice
        fields = ['id', 'title', 'message', 'date', 'by', 'is_urgent']


class TodayTimetableSerializer(serializers.ModelSerializer):
    """Flattens the complex LessonAllocation relationships into a simple class schedule."""
    # Reaching through the foreign key to get just the subject's text name
    subject = serializers.CharField(source='subject.name', read_only=True)

    # Custom method to combine Grade (e.g. Form 1) and Stream (e.g. East)
    class_name = serializers.SerializerMethodField()

    # Reaching into the time_slot foreign key
    start_time = serializers.TimeField(source='time_slot.start_time', format='%H:%M', read_only=True)
    end_time = serializers.TimeField(source='time_slot.end_time', format='%H:%M', read_only=True)
    is_remedial = serializers.BooleanField(source='time_slot.is_remedial', read_only=True)

    class Meta:
        model = LessonAllocation
        fields = ['id', 'subject', 'class_name', 'start_time', 'end_time', 'is_double_period', 'is_remedial']

    def get_class_name(self, obj):
        # Combines "Grade 9" + "East" into "Grade 9 East"
        return f"{obj.class_stream.grade.name} {obj.class_stream.name}"