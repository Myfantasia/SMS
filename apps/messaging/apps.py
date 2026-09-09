from django.apps import AppConfig


class MessagingConfig(AppConfig):
    """Notices, events, notifications, chat (threads/participants/audit).

    Depends on: identity, academics
    Public surface: apps.messaging.services -- other apps must never import
    apps.messaging.models directly (enforced by the import-linter contract).
    """
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.messaging"
    label = "messaging"

    def ready(self):
        # Import receivers here (not at module top) so Django's app registry
        # is fully populated before any @bus.subscribe(...) decorator runs.
        try:
            from . import receivers  # noqa: F401
        except ImportError:
            pass
