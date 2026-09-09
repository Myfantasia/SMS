from django.core.management.base import BaseCommand

from apps.academics.models import CurriculumPreset
from apps.identity.models import School

DEFAULT_SCHOOL_NAME = "Default School"


class Command(BaseCommand):
    """
    One-time backfill run after migrating in CurriculumPreset.school (nullable, from
    apps.academics.migrations.0004_curriculumpreset_school). Ensures exactly one School row
    exists (creating a "Default School" placeholder if none does -- this system is genuinely
    single-tenant today, so every existing CurriculumPreset unambiguously belongs to it) and
    assigns it to every preset that doesn't have a school yet.

    Must run before apps.academics.migrations.0005_curriculumpreset_school_required, which
    makes the field non-nullable -- see /home/jordan/.claude/plans/floofy-churning-mango.md.

    Safe to re-run (idempotent): a second run finds the same School row and zero unassigned
    presets left to update.

    Usage:
        python manage.py backfill_curriculum_preset_school             # apply
        python manage.py backfill_curriculum_preset_school --dry-run   # preview only
    """
    help = "Create the default School (if needed) and assign it to every unscoped CurriculumPreset."

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true', help="Preview without saving changes.")

    def handle(self, *args, **options):
        dry_run = options['dry_run']

        existing_count = School.objects.count()
        if existing_count > 1:
            self.stderr.write(self.style.ERROR(
                f"Found {existing_count} School rows already -- this command assumes single-tenant "
                "and won't guess which one owns the unassigned presets. Assign them manually."
            ))
            return

        school = School.objects.first()
        if school is None:
            self.stdout.write(f"  School: {DEFAULT_SCHOOL_NAME} (new)")
            if not dry_run:
                school = School.objects.create(name=DEFAULT_SCHOOL_NAME, level='COMBINED')
        else:
            self.stdout.write(f"  School: {school.name} (existing)")

        unassigned = CurriculumPreset.objects.filter(school__isnull=True)
        count = unassigned.count()
        if not dry_run and school is not None:
            unassigned.update(school=school)

        self.stdout.write(self.style.SUCCESS(
            f"\n{'[DRY RUN] Would assign' if dry_run else 'Assigned'} school to {count} "
            f"curriculum preset(s)."
        ))
