"""Admin registrations for the `results` app."""
from django.contrib import admin
from unfold.admin import ModelAdmin

from apps.results.models import SubjectTermResult, StudentTermResult, ClassPerformanceAnalytics


@admin.register(SubjectTermResult)
class SubjectTermResultAdmin(ModelAdmin):
    list_display = ('student', 'subject', 'term', 'total_score', 'grade')
    list_filter = ('subject', 'term', 'grade')
    search_fields = ('grade', 'subject_teacher_remark')


@admin.register(StudentTermResult)
class StudentTermResultAdmin(ModelAdmin):
    list_display = ('student', 'term', 'class_stream', 'mean_marks', 'mean_grade', 'is_published')
    list_filter = ('term', 'class_stream', 'is_published', 'results_withheld', 'mean_grade')


@admin.register(ClassPerformanceAnalytics)
class ClassPerformanceAnalyticsAdmin(ModelAdmin):
    list_display = ('term', 'class_stream', 'total_students_assessed', 'stream_mean_marks', 'stream_mean_grade')
    list_filter = ('term', 'class_stream')
