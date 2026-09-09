from django.apps import AppConfig


class AssignmentsConfig(AppConfig):
    """Assignments, quiz/question engine, submissions, rubric grading.

    Depends on: identity, academics
    Public surface: apps.assignments.services -- other apps must never import
    apps.assignments.models directly (enforced by the import-linter contract).
    """
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.assignments"
    label = "assignments"

    def ready(self):
        # Import receivers here (not at module top) so Django's app registry
        # is fully populated before any @bus.subscribe(...) decorator runs.
        try:
            from . import receivers  # noqa: F401
        except ImportError:
            pass
