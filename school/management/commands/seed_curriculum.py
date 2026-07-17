from django.core.management.base import BaseCommand

from school.models.classSubjects_models import Curriculum, GradeLevel

# Matches GradeLevel.CURRICULUM_CHOICES exactly — this command's only job is to turn those
# two hardcoded string values into real Curriculum rows and backfill GradeLevel.curriculum
# to point at them. Safe to re-run — everything is get_or_create'd / only touches grades
# that don't already have a curriculum FK set.
CURRICULA = [
    ('CBC', 'Competency Based Curriculum (CBC)'),
    ('8-4-4', 'Standard 8-4-4 Curriculum'),
]


class Command(BaseCommand):
    """
    Creates the initial Curriculum rows and backfills GradeLevel.curriculum from the
    existing curriculum_type string field.

    Usage:
        python manage.py seed_curriculum              # apply
        python manage.py seed_curriculum --dry-run     # preview only, no writes
    """
    help = "Seed Curriculum rows and backfill GradeLevel.curriculum from curriculum_type."

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true', help="Preview without saving changes.")

    def handle(self, *args, **options):
        dry_run = options['dry_run']

        self.stdout.write("Curricula:")
        curricula_by_code = {}
        for code, name in CURRICULA:
            if dry_run:
                exists = Curriculum.objects.filter(code=code).exists()
                self.stdout.write(f"  {'exists' if exists else '[DRY RUN] would create'}: {code}")
                curricula_by_code[code] = Curriculum.objects.filter(code=code).first()
                continue
            curriculum, created = Curriculum.objects.get_or_create(code=code, defaults={'name': name})
            curricula_by_code[code] = curriculum
            self.stdout.write(f"  {'created' if created else 'exists'}: {code}")

        self.stdout.write("\nGrade backfill:")
        backfilled = 0
        for grade in GradeLevel.objects.filter(curriculum__isnull=True):
            curriculum = curricula_by_code.get(grade.curriculum_type)
            if not curriculum:
                self.stdout.write(f"  skipping {grade.name}: unrecognized curriculum_type '{grade.curriculum_type}'")
                continue
            if dry_run:
                self.stdout.write(f"  [DRY RUN] would link: {grade.name} -> {curriculum.code}")
                continue
            grade.curriculum = curriculum
            grade.save(update_fields=['curriculum', 'curriculum_type'])
            backfilled += 1
            self.stdout.write(f"  linked: {grade.name} -> {curriculum.code}")

        self.stdout.write(self.style.SUCCESS(
            f"\n{'[DRY RUN] Would backfill' if dry_run else 'Backfilled'} {backfilled} grade(s)."
        ))
