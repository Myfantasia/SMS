from django.apps import AppConfig


class AcademicsConfig(AppConfig):
    """Curriculum, pathways, tracks, grade levels, class streams, subjects, departments, academic calendar (AcademicYear/ExamTerm).

    Depends on: identity
    Public surface: apps.academics.services -- other apps must never import
    apps.academics.models directly (enforced by the import-linter contract).
    """
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.academics"
    label = "academics"

    def ready(self):
        # Import receivers here (not at module top) so Django's app registry
        # is fully populated before any @bus.subscribe(...) decorator runs.
        try:
            from . import receivers  # noqa: F401
        except ImportError:
            pass
