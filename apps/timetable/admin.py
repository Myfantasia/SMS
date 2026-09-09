"""Admin registrations for the `timetable` app."""
from django.contrib import admin
from unfold.admin import ModelAdmin

from apps.timetable.models import TimetablePedagogyPolicy, DailyCover


@admin.register(TimetablePedagogyPolicy)
class TimetablePedagogyPolicyAdmin(ModelAdmin):
    """Singleton (always pk=1) -- disable add/delete so there's never a second row to
    accidentally create, matching the model's own save()-enforced singleton behavior."""
    list_display = ('enforcement_mode', 'max_consecutive_periods', 'max_daily_subject_frequency')
    list_filter = ('enforcement_mode',)

    def has_add_permission(self, request):
        return not TimetablePedagogyPolicy.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(DailyCover)
class DailyCoverAdmin(ModelAdmin):
    list_display = ('date', 'absent_teacher', 'covering_teacher', 'target_lesson')
    list_filter = ('date', 'absent_teacher', 'covering_teacher')
    search_fields = ('notes',)
