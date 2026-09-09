from django.apps import AppConfig


class ContentConfig(AppConfig):
    """Public marketing content: blog/article posts and alumni review quotes.

    Depends on: nothing (author is a plain django.contrib.auth.User FK, not
    another app's model). No other app currently needs to read blog/alumni
    data, so there's no services.py yet -- models.py stays off-limits to
    other apps regardless (enforced by the import-linter contract), add a
    services.py the day a second app actually needs to reach in.
    """
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.content"
    label = "content"
