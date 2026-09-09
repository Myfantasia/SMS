from django.apps import AppConfig


class StaffConfig(AppConfig):
    """Staff-specific business data: teacher leave, long-term relief assignment, structural availability.

    Depends on: identity
    Public surface: apps.staff.services -- other apps must never import
    apps.staff.models directly (enforced by the import-linter contract).
    """
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.staff"
    label = "staff"

    def ready(self):
        # Import receivers here (not at module top) so Django's app registry
        # is fully populated before any @bus.subscribe(...) decorator runs.
        try:
            from . import receivers  # noqa: F401
        except ImportError:
            pass
