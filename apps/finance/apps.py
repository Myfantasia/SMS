from django.apps import AppConfig


class FinanceConfig(AppConfig):
    """Fee/finance tracking (currently a thin stub -- no models yet).

    Depends on: identity, students
    Public surface: apps.finance.services -- other apps must never import
    apps.finance.models directly (enforced by the import-linter contract).
    """
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.finance"
    label = "finance"

    def ready(self):
        # Import receivers here (not at module top) so Django's app registry
        # is fully populated before any @bus.subscribe(...) decorator runs.
        try:
            from . import receivers  # noqa: F401
        except ImportError:
            pass
