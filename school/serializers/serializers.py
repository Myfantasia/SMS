from rest_framework import serializers
from school.models.models import AttendanceSession, AttendanceRecord, Event, Notification, Notice


class AttendanceRecordSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source='student.get_name', read_only=True)

    class Meta:
        model = AttendanceRecord
        fields = ['id', 'student', 'student_name', 'status', 'remarks']


class AttendanceSessionSerializer(serializers.ModelSerializer):
    # This automatically nests the records inside the session JSON
    records = AttendanceRecordSerializer(many=True, read_only=True)
    class_stream_name = serializers.CharField(source='class_stream.__str__', read_only=True)

    class Meta:
        model = AttendanceSession
        fields = ['id', 'class_stream', 'class_stream_name', 'date', 'submitted_by', 'created_at', 'records']


class EventSerializer(serializers.ModelSerializer):
    class Meta:
        model = Event
        fields = '__all__'


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = '__all__'


class NoticeSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notice
        fields = '__all__'