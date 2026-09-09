from django.apps import AppConfig


class StudentsConfig(AppConfig):
    """Student-specific business data: personal tasks, pathway selection, subject enrollment workflows.

    Depends on: identity, academics
    Public surface: apps.students.services -- other apps must never import
    apps.students.models directly (enforced by the import-linter contract).
    """
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.students"
    label = "students"

    def ready(self):
        # Import receivers here (not at module top) so Django's app registry
        # is fully populated before any @bus.subscribe(...) decorator runs.
        try:
            from . import receivers  # noqa: F401
        except ImportError:
            pass
