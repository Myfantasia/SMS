from django.core.management.base import BaseCommand
from apps.academics.models import Subject


class Command(BaseCommand):
    """
    One-time backfill for Subject.requires_synchronized_grade_blocking, run once after
    migrating in the field. Reproduces exactly what the OLD is_tech_subject() keyword/
    department heuristic used to compute at runtime, so existing subjects keep behaving
    the same after is_tech_subject() switches to reading this flag instead — going forward,
    a NEW subject/department is configured here (Curriculum Hub or Django admin), not by
    editing is_tech_subject()'s code.

    'Business' also gets synchronized_blocking_min_grade=10, matching the old heuristic's
    "only shared-block from Grade 10 up" rule for that one subject.

    Safe to re-run (idempotent) and safe to run on a fresh install with no subjects yet.

    Usage:
        python manage.py backfill_synchronized_blocking_flag             # apply
        python manage.py backfill_synchronized_blocking_flag --dry-run   # preview only
    """
    help = "Backfill Subject.requires_synchronized_grade_blocking from the old is_tech_subject() heuristic."

    TECH_KEYWORDS = ['technical', 'pre-tech', 'home science', 'computer', 'agriculture', 'art', 'music']

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true', help="Preview without saving changes.")

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        updated = 0

        for subject in Subject.objects.all():
            name_lower = subject.name.lower()
            is_business = 'business' in name_lower
            matches_old_heuristic = (
                is_business
                or any(kw in name_lower for kw in self.TECH_KEYWORDS)
                or (subject.department_id and 'Technical' in subject.department.name)
            )
            if not matches_old_heuristic:
                continue

            min_grade = 10 if is_business else None
            if subject.requires_synchronized_grade_blocking and subject.synchronized_blocking_min_grade == min_grade:
                continue  # already matches, nothing to do

            self.stdout.write(
                f"  {subject.code} - {subject.name}: requires_synchronized_grade_blocking=True"
                + (f", synchronized_blocking_min_grade={min_grade}" if min_grade else "")
            )
            if not dry_run:
                subject.requires_synchronized_grade_blocking = True
                subject.synchronized_blocking_min_grade = min_grade
                subject.save(update_fields=['requires_synchronized_grade_blocking', 'synchronized_blocking_min_grade'])
            updated += 1

        self.stdout.write(self.style.SUCCESS(
            f"\n{'[DRY RUN] Would update' if dry_run else 'Updated'} {updated} subject(s)."
        ))
