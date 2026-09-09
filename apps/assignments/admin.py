"""Admin registrations for the `assignments` app."""
from django.contrib import admin
from unfold.admin import ModelAdmin

from apps.assignments.models import (
    AssignmentGroup, AssignmentAttachment, RubricCriterion, CriterionScore,
)


@admin.register(AssignmentGroup)
class AssignmentGroupAdmin(ModelAdmin):
    list_display = ('name', 'assignment')
    list_filter = ('assignment',)
    search_fields = ('name', 'assignment__title')
    filter_horizontal = ('members',)


@admin.register(AssignmentAttachment)
class AssignmentAttachmentAdmin(ModelAdmin):
    list_display = ('label', 'assignment', 'uploaded_at')
    list_filter = ('assignment', 'uploaded_at')
    search_fields = ('label',)


@admin.register(RubricCriterion)
class RubricCriterionAdmin(ModelAdmin):
    list_display = ('criterion_text', 'question', 'max_points', 'order')
    list_filter = ('question',)
    search_fields = ('criterion_text',)


@admin.register(CriterionScore)
class CriterionScoreAdmin(ModelAdmin):
    list_display = ('answer', 'criterion', 'score')
    list_filter = ('criterion',)
