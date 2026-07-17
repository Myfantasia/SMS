from rest_framework import serializers

from school.models.students_model import StudentTask


class StudentTaskSerializer(serializers.ModelSerializer):
    class Meta:
        model = StudentTask
        fields = ['id', 'title', 'due_date', 'is_done', 'created_at']
        read_only_fields = ['created_at']
