from rest_framework import serializers
from apps.identity.models import StudentExtra
from apps.exams.models import ExamResult


class StudentGridSerializer(serializers.ModelSerializer):
    """Packages student data specifically for the marks entry grid"""
    student_name = serializers.CharField(source='get_name', read_only=True)
    class_name = serializers.CharField(source='cl.name', read_only=True)

    class Meta:
        model = StudentExtra
        # We only send what the React table absolutely needs to render
        fields = ['id', 'roll', 'student_name', 'class_name']


class ExamResultSerializer(serializers.ModelSerializer):

    entered_by = serializers.CharField(source='teacher.get_name', read_only=True, default="Admin")

    class Meta:
        model = ExamResult
        fields = ['student', 'marks_obtained', 'teacher_remarks', 'entered_by']