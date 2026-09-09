"""Admin registrations for the `core` app."""
from django.contrib import admin
from unfold.admin import ModelAdmin

from apps.core.models import BackgroundJob, SystemAuditLog


@admin.register(BackgroundJob)
class BackgroundJobAdmin(ModelAdmin):
    list_display = ('job_type', 'operator', 'status', 'created_at', 'completed_at')
    list_filter = ('status', 'job_type')
    search_fields = ('job_type', 'operator__username')


@admin.register(SystemAuditLog)
class SystemAuditLogAdmin(ModelAdmin):
    """Read-only: the audit log must stay tamper-evident, even for the Super Admin."""
    list_display = ('timestamp', 'operator', 'action_type', 'module')
    list_filter = ('action_type', 'module')
    search_fields = ('module', 'description', 'operator__username', 'ip_address')
    date_hierarchy = 'timestamp'

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
