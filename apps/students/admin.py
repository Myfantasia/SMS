"""Admin registrations for the `students` app."""
from django.contrib import admin
from unfold.admin import ModelAdmin

from apps.students.models import StudentTask, NationalExamRecord


@admin.register(StudentTask)
class StudentTaskAdmin(ModelAdmin):
    list_display = ('title', 'student', 'due_date', 'is_done')
    list_filter = ('is_done', 'due_date')
    search_fields = ('title',)


@admin.register(NationalExamRecord)
class NationalExamRecordAdmin(ModelAdmin):
    list_display = ('student', 'exam_code', 'academic_year', 'score', 'destination', 'recorded_at')
    list_filter = ('exam_code', 'academic_year')
    search_fields = ('destination', 'score')
