from django.apps import AppConfig


class AttendanceConfig(AppConfig):
    """Attendance sessions and records.

    Depends on: identity, academics
    Public surface: apps.attendance.services -- other apps must never import
    apps.attendance.models directly (enforced by the import-linter contract).
    """
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.attendance"
    label = "attendance"

    def ready(self):
        # Import receivers here (not at module top) so Django's app registry
        # is fully populated before any @bus.subscribe(...) decorator runs.
        try:
            from . import receivers  # noqa: F401
        except ImportError:
            pass
