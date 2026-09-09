import csv

from django.core.management.base import BaseCommand, CommandError

from apps.academics.models import PresetCombination, Subject, Track


class Command(BaseCommand):
    """
    Bulk-loads PresetCombination rows from a CSV — intended for the full official 571-
    combination KNEC catalog once you have it (this repo only ships a small sample via
    `seed_preset_combinations`, for schema/testing purposes).

    Expected CSV columns (header row required):
        pathway, track, subject_1, subject_2, subject_3, name (optional), code (optional)

    Subjects are matched by exact name first, then by code (case-insensitive either way).
    Track is matched by the (pathway, track) name pair. A row referencing a pathway/track/
    subject that doesn't exist yet is SKIPPED and reported at the end — nothing is
    auto-created, since guessing a new Subject/Pathway/Track from a CSV typo would be worse
    than a clear skip message; add the missing one yourself first, then re-run.

    Safe to re-run: a combination with the same track + exact subject set is left alone,
    not duplicated.

    Usage:
        python manage.py import_preset_combinations path/to/combinations.csv
        python manage.py import_preset_combinations path/to/combinations.csv --dry-run
    """
    help = "Import PresetCombination rows from a CSV file."

    def add_arguments(self, parser):
        parser.add_argument('csv_path', type=str)
        parser.add_argument('--dry-run', action='store_true', help="Preview without saving changes.")

    def handle(self, *args, **options):
        csv_path = options['csv_path']
        dry_run = options['dry_run']

        try:
            f = open(csv_path, newline='', encoding='utf-8-sig')
        except OSError as e:
            raise CommandError(f"Could not open {csv_path}: {e}")

        subjects_by_key = {}
        for s in Subject.objects.all():
            subjects_by_key[s.name.strip().lower()] = s
            subjects_by_key[s.code.strip().lower()] = s

        tracks_by_key = {}
        for t in Track.objects.select_related('pathway').all():
            tracks_by_key[(t.pathway.name.strip().lower(), t.name.strip().lower())] = t

        existing_subject_sets = {}  # track_id -> [set(subject_id), ...]
        for combo in PresetCombination.objects.prefetch_related('subjects'):
            existing_subject_sets.setdefault(combo.track_id, []).append(
                frozenset(s.id for s in combo.subjects.all())
            )

        created = 0
        already_existed = 0
        skip_reasons = []

        with f:
            reader = csv.DictReader(f)
            required_cols = {'pathway', 'track', 'subject_1', 'subject_2', 'subject_3'}
            present_cols = {c.strip() for c in (reader.fieldnames or [])}
            missing_cols = required_cols - present_cols
            if missing_cols:
                raise CommandError(f"CSV is missing required column(s): {', '.join(sorted(missing_cols))}")

            for i, row in enumerate(reader, start=2):  # header is row 1
                pathway_name = (row.get('pathway') or '').strip()
                track_name = (row.get('track') or '').strip()
                track = tracks_by_key.get((pathway_name.lower(), track_name.lower()))
                if not track:
                    skip_reasons.append(f"Row {i}: no track '{track_name}' under pathway '{pathway_name}'.")
                    continue

                subject_inputs = [(row.get(f'subject_{n}') or '').strip() for n in (1, 2, 3)]
                subjects = []
                missing_subject = None
                for name in subject_inputs:
                    subj = subjects_by_key.get(name.lower())
                    if not subj:
                        missing_subject = name
                        break
                    subjects.append(subj)
                if missing_subject:
                    skip_reasons.append(f"Row {i}: subject '{missing_subject}' not found — add it first.")
                    continue

                subject_id_set = frozenset(s.id for s in subjects)
                if len(subject_id_set) != 3:
                    skip_reasons.append(f"Row {i}: subjects must be 3 distinct entries ({', '.join(subject_inputs)}).")
                    continue

                if subject_id_set in existing_subject_sets.get(track.id, []):
                    already_existed += 1
                    continue

                name = (row.get('name') or '').strip()
                code = (row.get('code') or '').strip()
                self.stdout.write(f"  Row {i}: {track} -> {', '.join(subject_inputs)}")
                if not dry_run:
                    combo = PresetCombination.objects.create(track=track, name=name, code=code)
                    combo.subjects.set(subjects)
                existing_subject_sets.setdefault(track.id, []).append(subject_id_set)
                created += 1

        self.stdout.write(self.style.SUCCESS(
            f"\n{'[DRY RUN] Would create' if dry_run else 'Created'} {created} combination(s), "
            f"{already_existed} already existed, {len(skip_reasons)} row(s) skipped."
        ))
        if skip_reasons:
            self.stdout.write(self.style.WARNING(f"\n{len(skip_reasons)} row(s) skipped:"))
            for reason in skip_reasons:
                self.stdout.write(f"  {reason}")
