# Hand-written -- see Hard Rule #1 in .claude/skills/sms-orient/SKILL.md (migrations are
# manual). Verify with `python manage.py makemigrations identity --check --dry-run` before
# applying.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('identity', '0005_role_deleted_at_role_deleted_by_role_is_deleted'),
    ]

    operations = [
        migrations.AddField(
            model_name='role',
            name='rank',
            field=models.PositiveSmallIntegerField(
                null=True, blank=True,
                help_text="Delegation tier. Lower ranks outrank higher ones. Null means "
                          "unranked -- cannot be granted or managed by anyone except a superuser.",
            ),
        ),
    ]
