# Hand-written (migrations are run by the project owner, not this session; see Hard Rule #1
# in .claude/skills/sms-orient/SKILL.md). Verify against
# `python manage.py makemigrations academics --check --dry-run` before applying.
#
# Lets a single PATHWAY_CORE SubjectPool hold KNEC combinations from every pathway/track at
# once, instead of one pool per (pathway, track) pair. No backfill needed -- new M2M starts
# empty for every existing pool, which is exactly the current "no combinations tagged" state.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('academics', '0006_subjectpool_pathway_track'),
    ]

    operations = [
        migrations.AddField(
            model_name='subjectpool',
            name='combinations',
            field=models.ManyToManyField(
                blank=True, related_name='pools', to='academics.presetcombination',
                db_table='school_subjectpool_combinations',
            ),
        ),
    ]
