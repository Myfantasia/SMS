from django.apps import AppConfig


class CoreConfig(AppConfig):
    """Cross-cutting infrastructure: audit logging, background job tracking. Foundation layer -- no deps on any other app.

    Depends on: (none -- foundation app)
    Public surface: apps.core.services -- other apps must never import
    apps.core.models directly (enforced by the import-linter contract).
    """
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.core"
    label = "core"

    def ready(self):
        # Import receivers here (not at module top) so Django's app registry
        # is fully populated before any @bus.subscribe(...) decorator runs.
        try:
            from . import receivers  # noqa: F401
        except ImportError:
            pass
