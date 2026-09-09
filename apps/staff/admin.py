"""Admin registrations for the `staff` app."""
from django.contrib import admin
from unfold.admin import ModelAdmin

from apps.staff.models import TeacherStructuralAvailability


@admin.register(TeacherStructuralAvailability)
class TeacherStructuralAvailabilityAdmin(ModelAdmin):
    list_display = ('teacher', 'time_slot', 'reason')
    list_filter = ('teacher', 'time_slot')
    search_fields = ('reason',)
