import django.db.models.deletion
from django.db import migrations, models


def set_existing_departments_to_cbc(apps, schema_editor):
    """
    All 9 Department rows created by `backfill_departments` before this migration are the
    CBC-Kenya-Curriculum-Research dossier's 9 departments — they were never curriculum-scoped
    before now, so this is a real backfill, not a placeholder default.
    """
    Department = apps.get_model('school', 'Department')
    Curriculum = apps.get_model('school', 'Curriculum')
    cbc = Curriculum.objects.filter(code='CBC').first()
    if cbc:
        Department.objects.filter(curriculum__isnull=True).update(curriculum=cbc)


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('school', '0090_department_alter_quotadefaultrule_department_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='department',
            name='curriculum',
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.CASCADE, related_name='departments', to='school.curriculum'),
        ),
        migrations.AddField(
            model_name='subjectcurriculumprofile',
            name='department',
            field=models.ForeignKey(blank=True, help_text="This subject's department under this curriculum specifically — CBC and 8-4-4 group subjects differently, so a subject taught under both needs a department per curriculum, not one flat Subject.department. Set on the tier=None (whole-curriculum) row; per-tier rows for the same subject+curriculum should carry the same value, not a tier-specific one. Leave blank to inherit Subject.department.", null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='subject_profiles', to='school.department'),
        ),
        migrations.RunPython(set_existing_departments_to_cbc, noop_reverse),
        migrations.AlterField(
            model_name='department',
            name='curriculum',
            field=models.ForeignKey(help_text="Which curriculum this department belongs to — CBC and 8-4-4 group subjects differently, so departments aren't shared across them.", on_delete=django.db.models.deletion.CASCADE, related_name='departments', to='school.curriculum'),
        ),
        migrations.AlterField(
            model_name='department',
            name='name',
            field=models.CharField(max_length=50),
        ),
        migrations.AlterField(
            model_name='department',
            name='code',
            field=models.CharField(blank=True, help_text="Optional short code, e.g. 'SCI'.", max_length=10, null=True),
        ),
        migrations.AlterUniqueTogether(
            name='department',
            unique_together={('name', 'curriculum'), ('code', 'curriculum')},
        ),
        migrations.AlterModelOptions(
            name='department',
            options={'ordering': ['curriculum', 'name']},
        ),
    ]
