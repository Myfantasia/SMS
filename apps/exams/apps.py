from django.apps import AppConfig


class ExamsConfig(AppConfig):
    """Exam events, results entry, grading rules, publish workflow.

    Depends on: identity, core, academics
    Public surface: apps.exams.services -- other apps must never import
    apps.exams.models directly (enforced by the import-linter contract).
    """
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.exams"
    label = "exams"

    def ready(self):
        # Import receivers here (not at module top) so Django's app registry
        # is fully populated before any @bus.subscribe(...) decorator runs.
        try:
            from . import receivers  # noqa: F401
        except ImportError:
            pass
