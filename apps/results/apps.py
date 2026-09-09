from django.apps import AppConfig


class ResultsConfig(AppConfig):
    """Aggregated per-subject/per-student/per-class term results.

    Depends on: identity, academics, exams
    Public surface: apps.results.services -- other apps must never import
    apps.results.models directly (enforced by the import-linter contract).
    """
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.results"
    label = "results"

    def ready(self):
        # Import receivers here (not at module top) so Django's app registry
        # is fully populated before any @bus.subscribe(...) decorator runs.
        try:
            from . import receivers  # noqa: F401
        except ImportError:
            pass
