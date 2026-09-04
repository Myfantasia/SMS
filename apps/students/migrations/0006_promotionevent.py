import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('academics', '0008_classstream_deleted_at_classstream_deleted_by_and_more'),
        ('identity', '0008_auth_user_trigram_indexes'),
        ('students', '0005_alter_studentpathwayselection_status_and_more'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='PromotionEvent',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('outcome', models.CharField(choices=[('promoted', 'Promoted'), ('graduated', 'Graduated')], max_length=10)),
                ('previous_enrollment_state', models.CharField(max_length=20)),
                ('performed_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('reverted_at', models.DateTimeField(blank=True, null=True)),
                ('academic_year', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='academics.academicyear')),
                ('previous_cl', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to='academics.classstream')),
                ('created_pathway_selection', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to='students.studentpathwayselection')),
                ('performed_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to=settings.AUTH_USER_MODEL)),
                ('reverted_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to=settings.AUTH_USER_MODEL)),
                ('student', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='promotion_events', to='identity.studentextra')),
            ],
            options={
                'db_table': 'school_promotionevent',
            },
        ),
    ]
