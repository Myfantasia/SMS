from django.core.management.base import BaseCommand
from apps.identity.models import TeacherExtra
from apps.academics.models import Subject


class Command(BaseCommand):
    """
    One-time (or re-runnable) backfill: parses TeacherExtra.subjects (free-text,
    comma-separated) and populates the new TeacherExtra.qualified_subjects M2M relation by
    matching each token against Subject.name case-insensitively. Safe to re-run — it always
    rebuilds qualified_subjects from the current text field, so it stays in sync if the text
    field is edited via the legacy UI path.

    Usage:
        python manage.py backfill_teacher_subjects            # apply
        python manage.py backfill_teacher_subjects --dry-run   # preview only, no writes
    """
    help = "Backfill TeacherExtra.qualified_subjects from the legacy free-text subjects field."

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true', help="Preview without saving changes.")

    def handle(self, *args, **options):
        dry_run = options['dry_run']

        subject_by_name = {s.name.strip().lower(): s for s in Subject.objects.all()}

        teachers_updated = 0
        unmatched_tokens = {}  # token -> [teacher names that had it]

        for teacher in TeacherExtra.objects.all():
            if not teacher.subjects:
                continue

            tokens = [t.strip() for t in teacher.subjects.split(',') if t.strip()]
            matched_subjects = []
            for token in tokens:
                subj = subject_by_name.get(token.lower())
                if subj:
                    matched_subjects.append(subj)
                else:
                    unmatched_tokens.setdefault(token, []).append(teacher.get_name)

            if not matched_subjects:
                continue

            self.stdout.write(
                f"  {teacher.get_name}: {teacher.subjects!r} -> "
                f"[{', '.join(s.name for s in matched_subjects)}]"
            )
            if not dry_run:
                teacher.qualified_subjects.set(matched_subjects)
            teachers_updated += 1

        self.stdout.write(self.style.SUCCESS(
            f"\n{'[DRY RUN] Would update' if dry_run else 'Updated'} {teachers_updated} teacher(s)."
        ))

        if unmatched_tokens:
            self.stdout.write(self.style.WARNING(
                f"\n{len(unmatched_tokens)} subject name token(s) didn't match any Subject "
                f"(likely typos or renamed subjects) — these teachers will NOT show as eligible "
                f"for these subjects until fixed:"
            ))
            for token, teacher_names in unmatched_tokens.items():
                self.stdout.write(f"  {token!r}: {', '.join(teacher_names)}")
