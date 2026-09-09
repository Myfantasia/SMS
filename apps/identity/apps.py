from django.apps import AppConfig


class IdentityConfig(AppConfig):
    """Users, role profiles (Teacher/Student/Parent/Admin/Staff Extra), RBAC, admin invites, School/tenant anchor.

    Depends on: core
    Public surface: apps.identity.services -- other apps must never import
    apps.identity.models directly (enforced by the import-linter contract).
    """
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.identity"
    label = "identity"

    def ready(self):
        # Import receivers here (not at module top) so Django's app registry
        # is fully populated before any @bus.subscribe(...) decorator runs.
        try:
            from . import receivers  # noqa: F401
        except ImportError:
            pass
