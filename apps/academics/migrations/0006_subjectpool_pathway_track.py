# Hand-written (migrations are run by the project owner, not this session; see Hard Rule #1
# in .claude/skills/sms-orient/SKILL.md). Verify against
# `python manage.py makemigrations academics --check --dry-run` before applying.
#
# Lets a single CurriculumPreset hold one PATHWAY_CORE SubjectPool per pathway/track, instead
# of needing a whole separate preset per pathway. Both fields stay permanently nullable (NULL
# = "not pathway-specific") -- no backfill needed, existing pools keep their current meaning.

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('academics', '0005_curriculumpreset_school_required'),
    ]

    operations = [
        migrations.AddField(
            model_name='subjectpool',
            name='pathway',
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                related_name='+', to='academics.pathway',
            ),
        ),
        migrations.AddField(
            model_name='subjectpool',
            name='track',
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                related_name='+', to='academics.track',
            ),
        ),
        migrations.AlterUniqueTogether(
            name='subjectpool',
            unique_together={('preset', 'pool_type', 'pathway', 'track')},
        ),
    ]
