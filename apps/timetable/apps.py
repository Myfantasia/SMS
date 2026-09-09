from django.apps import AppConfig


class TimetableConfig(AppConfig):
    """Timetable grid, time slots, lesson allocation, substitution/daily cover.

    Depends on: identity, academics, allocations, staff
    Public surface: apps.timetable.services -- other apps must never import
    apps.timetable.models directly (enforced by the import-linter contract).
    """
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.timetable"
    label = "timetable"

    def ready(self):
        # Import receivers here (not at module top) so Django's app registry
        # is fully populated before any @bus.subscribe(...) decorator runs.
        try:
            from . import receivers  # noqa: F401
        except ImportError:
            pass
