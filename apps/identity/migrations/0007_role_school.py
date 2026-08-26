# Hand-written -- see Hard Rule #1 in .claude/skills/sms-orient/SKILL.md. Mirrors
# apps/academics/migrations/0004_curriculumpreset_school.py's shape, stopping at nullable --
# see the "Deviation from the CurriculumPreset precedent" note in
# docs/superpowers/specs/2026-08-25-rbac-rank-hierarchy-design.md. Verify with
# `python manage.py makemigrations identity --check --dry-run` before applying.

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('identity', '0006_role_rank'),
    ]

    operations = [
        migrations.AddField(
            model_name='role',
            name='school',
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.PROTECT,
                related_name='roles', to='identity.school',
                help_text="Server-derived, never client-supplied -- see get_current_school_id(). "
                          "Nullable: this system runs one school today, see the RBAC design spec's "
                          "'Deviation from the CurriculumPreset precedent' note for why this field "
                          "isn't required yet.",
            ),
        ),
        migrations.AlterField(
            model_name='role',
            name='name',
            field=models.CharField(max_length=100),
        ),
        migrations.AlterUniqueTogether(
            name='role',
            unique_together={('school', 'name')},
        ),
    ]
