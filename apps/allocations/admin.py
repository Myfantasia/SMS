"""Admin registrations for the `allocations` app."""
from django.contrib import admin
from unfold.admin import ModelAdmin

from apps.allocations.models import (
    AllocationPublishState, SubjectSplittingRule, GlobalAllocationPolicy,
)


@admin.register(AllocationPublishState)
class AllocationPublishStateAdmin(ModelAdmin):
    list_display = ('classroom', 'term', 'academic_year', 'is_published', 'published_at', 'published_by')
    list_filter = ('is_published', 'term', 'academic_year', 'classroom')
    search_fields = ('classroom__name',)


@admin.register(SubjectSplittingRule)
class SubjectSplittingRuleAdmin(ModelAdmin):
    list_display = ('grade', 'subject', 'max_class_size', 'allocation_mode', 'updated_at')
    list_filter = ('allocation_mode', 'grade', 'subject')
    search_fields = ('grade__name', 'subject__name')


@admin.register(GlobalAllocationPolicy)
class GlobalAllocationPolicyAdmin(ModelAdmin):
    """Singleton (always pk=1) -- disable add/delete so there's never a second row to
    accidentally create, matching the model's own save()-enforced singleton behavior."""
    list_display = ('enforcement_mode', 'max_subjects_per_class', 'max_classes_per_subject', 'max_weekly_lessons')
    list_filter = ('enforcement_mode',)

    def has_add_permission(self, request):
        return not GlobalAllocationPolicy.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False
