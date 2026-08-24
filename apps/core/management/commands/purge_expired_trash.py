from django.core.management.base import BaseCommand

from apps.core.trash import purge_expired_trash


class Command(BaseCommand):
    """
    Permanently deletes any Trash item older than 20 days (Class Stream and
    Subject are excluded — they only leave Trash manually, see
    apps/core/trash.py's TrashEntityConfig.auto_purge). Safe to run repeatedly;
    intended to be wired up to an external cron by the operator, since this
    project has no Celery Beat schedule configured. The Trash page itself also
    runs this same sweep lazily whenever it's opened, so this command is a
    belt-and-suspenders guarantee, not the only way purging happens.

    Usage:
        python manage.py purge_expired_trash
    """
    help = "Permanently deletes Trash items past their 20-day auto-purge window."

    def handle(self, *args, **options):
        count = purge_expired_trash()
        self.stdout.write(self.style.SUCCESS(f"Purged {count} expired Trash item(s)."))
