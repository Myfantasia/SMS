from django.core.management.base import BaseCommand

from apps.academics.models import Tier

# (curriculum_code, name_substring_to_match): (exit_exam_code, exit_is_terminal)
#
# Matched by curriculum code + a case-insensitive name substring, mirroring the same
# name-substring convention tier_requires_pathway_choice already uses (apps/academics/models.py)
# -- robust against exact-spelling drift in admin-entered tier names (the real seeded data has
# a "Junior Srcondary" typo, which "junior" still matches).
#
# Values are dossier-accurate per the CBC national assessment sequence: KPSEA (end of Grade 6,
# same-institution) -> KJSEA (end of Grade 9, cross-institution) -> KCSE (end of Grade 12 /
# Form 4, terminal). Only Upper Primary's KPSEA transition keeps exit_is_terminal=False --
# Upper Primary -> JSS stays inside the same school, so the student's cl still reassigns
# normally; JSS/Senior Secondary/Form 3&4 exits do not (see _promote_student's 'exit' branch).
TIER_EXIT_EXAMS = [
    ('CBC', 'upper primary', 'KPSEA', False),
    ('CBC', 'junior', 'KJSEA', True),
    ('CBC', 'senior secondary', 'KCSE', True),
    ('8-4-4', 'form', 'KCSE', True),
]


class Command(BaseCommand):
    """
    Backfills Tier.exit_exam_code/exit_is_terminal with the dossier-accurate CBC/8-4-4 defaults,
    so exam-gated promotion actually works out of the box instead of every tier silently
    resolving to a 'plain' transition (see docs/superpowers/specs/2026-08-24-promotion-process-
    redesign-design.md).

    Safe to re-run: only touches a tier whose exit_exam_code is still blank, so an admin's own
    configuration (set via the Tiers UI) is never overwritten.

    Usage:
        python manage.py seed_tier_exit_exams
        python manage.py seed_tier_exit_exams --dry-run
    """
    help = "Backfill dossier-accurate exit_exam_code/exit_is_terminal defaults onto existing tiers."

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true', help="Preview without saving changes.")

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        updated = 0
        skipped = []

        for curriculum_code, name_substring, exam_code, is_terminal in TIER_EXIT_EXAMS:
            tiers = Tier.objects.filter(
                curriculum__code=curriculum_code, name__icontains=name_substring,
            )
            if not tiers.exists():
                skipped.append(f"No tier found for curriculum '{curriculum_code}' matching '{name_substring}'.")
                continue
            for tier in tiers:
                if tier.exit_exam_code:
                    skipped.append(f"Tier '{tier.name}' ({curriculum_code}) — already configured, left alone.")
                    continue
                self.stdout.write(f"  {tier.name} ({curriculum_code}): exit_exam_code={exam_code}, exit_is_terminal={is_terminal}")
                if not dry_run:
                    tier.exit_exam_code = exam_code
                    tier.exit_is_terminal = is_terminal
                    tier.save(update_fields=['exit_exam_code', 'exit_is_terminal'])
                updated += 1

        self.stdout.write(self.style.SUCCESS(
            f"\n{'[DRY RUN] Would update' if dry_run else 'Updated'} {updated} tier(s), {len(skipped)} skipped."
        ))
        if skipped:
            self.stdout.write(self.style.WARNING(f"\n{len(skipped)} skipped:"))
            for reason in skipped:
                self.stdout.write(f"  {reason}")
