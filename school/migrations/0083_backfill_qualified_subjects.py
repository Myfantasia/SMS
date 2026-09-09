from django.db import migrations


def backfill_qualified_subjects(apps, schema_editor):
    """Signup always let a teacher pick real Subject records, but only ever saved the
    result as free text on TeacherExtra.subjects — the actual qualified_subjects M2M
    (what Teacher Allocation and the Edit Profile checklist both read) was never
    populated. For any teacher where it's still empty, match their free-text subject
    names back onto real Subject rows and link them, one time, for existing accounts."""
    TeacherExtra = apps.get_model('school', 'TeacherExtra')
    Subject = apps.get_model('school', 'Subject')

    subject_by_name = {s.name: s for s in Subject.objects.all()}

    for teacher in TeacherExtra.objects.exclude(subjects__isnull=True).exclude(subjects=''):
        if teacher.qualified_subjects.exists():
            continue
        names = [n.strip() for n in teacher.subjects.split(',') if n.strip()]
        matched = [subject_by_name[n] for n in names if n in subject_by_name]
        if matched:
            teacher.qualified_subjects.set(matched)


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('school', '0082_alter_adminextra_verification_code_admininvitecode_and_more'),
    ]

    operations = [
        migrations.RunPython(backfill_qualified_subjects, noop_reverse),
    ]
