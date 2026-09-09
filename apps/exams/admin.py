"""Admin registrations for the `exams` app.

Track B step 7: model classes and their admin registrations physically
relocated here together from school/models/models.py and school/admin.py.
"""
from unfold.admin import ModelAdmin
from django.contrib import admin

from apps.exams.models import ExamEvent, GradingRule, ExamResult, StudentReportSummary, ClassExamStatus


@admin.register(ExamEvent)
class ExamEventAdmin(ModelAdmin):
    list_display = ('name', 'term', 'exam_type', 'total_marks', 'status')
    list_filter = ('exam_type', 'status', 'term__academic_year')
    search_fields = ('name', 'term__name')


@admin.register(GradingRule)
class GradingRuleAdmin(ModelAdmin):
    list_display = ('grade_label', 'curriculum', 'min_score', 'max_score', 'remarks')
    list_filter = ('curriculum',)
    ordering = ('curriculum', '-min_score')


@admin.register(ExamResult)
class ExamResultAdmin(ModelAdmin):
    list_display = ('student', 'exam', 'subject', 'marks_obtained')
    # Extremely helpful filters for the admin to audit specific class performance
    list_filter = ('exam', 'subject', 'student__cl__grade')
    search_fields = ('student__user__first_name', 'student__user__last_name', 'student__roll')


@admin.register(StudentReportSummary)
class StudentReportSummaryAdmin(ModelAdmin):
    list_display = ('student', 'exam')
    search_fields = ('student__user__first_name', 'student__user__last_name')
    list_filter = ('exam',)


@admin.register(ClassExamStatus)
class ClassExamStatusAdmin(ModelAdmin):
    list_display = ('class_stream', 'exam', 'status', 'published_at', 'published_by')
    list_filter = ('status', 'exam')
    search_fields = ('class_stream__name', 'exam__name')
