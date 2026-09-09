# Hand-written -- see the note at the top of 0004_curriculumpreset_school.py.
#
# Step 2 of 2. Run ONLY after `python manage.py backfill_curriculum_preset_school` has
# assigned a school to every existing CurriculumPreset row -- otherwise this fails with a
# NOT NULL constraint violation on any row still left unassigned.

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('academics', '0004_curriculumpreset_school'),
    ]

    operations = [
        migrations.AlterField(
            model_name='curriculumpreset',
            name='school',
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name='curriculum_presets', to='identity.school',
                help_text='Server-derived, never client-supplied — see get_current_school_id().',
            ),
        ),
    ]
