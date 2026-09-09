from django.apps import AppConfig


class AllocationsConfig(AppConfig):
    """Subject-to-teacher-to-class allocation engine: quotas, blocks, contracts, splitting rules, global policy.

    Depends on: identity, academics
    Public surface: apps.allocations.services -- other apps must never import
    apps.allocations.models directly (enforced by the import-linter contract).
    """
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.allocations"
    label = "allocations"

    def ready(self):
        # Import receivers here (not at module top) so Django's app registry
        # is fully populated before any @bus.subscribe(...) decorator runs.
        try:
            from . import receivers  # noqa: F401
        except ImportError:
            pass
