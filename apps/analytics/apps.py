from django.apps import AppConfig


class AnalyticsConfig(AppConfig):
    """Read-mostly aggregate analytics (school/student/term/subject-matrix) -- first candidate for future extraction.

    Depends on: results, academics, identity
    Public surface: apps.analytics.services -- other apps must never import
    apps.analytics.models directly (enforced by the import-linter contract).
    """
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.analytics"
    label = "analytics"

    def ready(self):
        # Import receivers here (not at module top) so Django's app registry
        # is fully populated before any @bus.subscribe(...) decorator runs.
        try:
            from . import receivers  # noqa: F401
        except ImportError:
            pass
