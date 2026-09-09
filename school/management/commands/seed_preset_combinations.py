from django.core.management.base import BaseCommand

from apps.academics.models import PresetCombination, Subject, Track

# Small SAMPLE of the real KNEC catalog (571 official combinations nationwide), for
# schema/testing purposes only — NOT the complete list. Load the full catalog once you have
# it via `import_preset_combinations` (CSV). Track names match this school's actual Track
# rows (see Track model) rather than the research dossier's generic naming — e.g. the
# dossier's "Technical Studies" is this school's "Technical & Engineering" track, and
# "Sports & Recreation" is this school's "Sports" track.
#
# (pathway, track): [ (subject_name, subject_name, subject_name), ... ]
SAMPLE_COMBINATIONS = {
    ('STEM', 'Pure Sciences'): [
        ('Advanced Mathematics', 'Chemistry', 'Physics'),
        ('Biology', 'Chemistry', 'Agriculture'),
        ('Biology', 'Physics', 'Computer Studies'),
        ('Chemistry', 'Physics', 'Geography'),
    ],
    ('STEM', 'Applied Sciences'): [
        ('Agriculture', 'Business Studies', 'Aviation'),
        ('Computer Studies', 'Geography', 'Physics'),
        ('Computer Studies', 'Home Science', 'Biology'),
    ],
    ('STEM', 'Technical & Engineering'): [
        ('Building Construction', 'Business Studies', 'Chemistry'),
        ('Electricity', 'Geography', 'Physics'),
        ('Metal Work', 'Geography', 'Chemistry'),
        ('Power Mechanics', 'Geography', 'Physics'),
        ('Wood Work', 'Geography', 'Biology'),
    ],
    ('Social Sciences', 'Humanities & Business Studies'): [
        ('Business Studies', 'History & Citizenship', 'Arabic'),
        ('Geography', 'Business Studies', 'Arabic'),
        ('History & Citizenship', 'Geography', 'Arabic'),
        # Dossier lists this as "CRE/IRE/HRE, Business Studies, Arabic" — one combo per
        # religious-education option, expanded into 3 real rows since a combination needs
        # actual Subject rows, not a slash-separated placeholder.
        ('Christian Religious Education', 'Business Studies', 'Arabic'),
        ('Islam Religious Education', 'Business Studies', 'Arabic'),
        ('Hindu Religious Education', 'Business Studies', 'Arabic'),
    ],
    ('Social Sciences', 'Languages & Literature'): [
        ('Literature In English', 'Fasihi Ya Kiswahili', 'Arabic'),
        ('French', 'Germany', 'Business Studies'),
        # Dossier also lists (Indigenous Language, Fasihi Ya Kiswahili, Arabic) — skipped,
        # 'Indigenous Language' isn't in this school's Subject catalog yet. Add it as a
        # Subject first, then load this one via import_preset_combinations.
    ],
    ('Arts and Sports Science', 'Arts'): [
        ('Fine Arts', 'Theatre & Film', 'Business Studies'),
        ('Music & Dance', 'Fine Arts', 'Arabic'),
        ('Theatre & Film', 'Music & Dance', 'Computer Studies'),
    ],
    ('Arts and Sports Science', 'Sports'): [
        ('Sports & Recreation', 'Biology', 'Business Studies'),
        ('Sports & Recreation', 'General Science', 'French'),
    ],
}


class Command(BaseCommand):
    """
    Seeds a small sample of real KNEC preset combinations, scoped to this school's actual
    Pathway/Track rows and Subject catalog — enough to exercise the feature end-to-end, not
    the complete 571-combination catalog (load that via `import_preset_combinations` once
    you have it from KICD/KNEC).

    Safe to re-run: skips a (track, subject-set) pair that already exists.

    Usage:
        python manage.py seed_preset_combinations
        python manage.py seed_preset_combinations --dry-run
    """
    help = "Seed a sample of real KNEC PresetCombination rows for testing."

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true', help="Preview without saving changes.")

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        subjects_by_name = {s.name.strip().lower(): s for s in Subject.objects.all()}

        created = 0
        already_existed = 0
        skipped = []

        for (pathway_name, track_name), combos in SAMPLE_COMBINATIONS.items():
            track = Track.objects.filter(
                pathway__name__iexact=pathway_name, name__iexact=track_name
            ).first()
            if not track:
                skipped.append(f"Track '{track_name}' under pathway '{pathway_name}' not found — skipping its combos.")
                continue

            existing_subject_sets = [
                frozenset(s.id for s in combo.subjects.all())
                for combo in PresetCombination.objects.filter(track=track).prefetch_related('subjects')
            ]

            for subject_names in combos:
                subjects = [subjects_by_name.get(n.strip().lower()) for n in subject_names]
                if any(s is None for s in subjects):
                    missing = [n for n, s in zip(subject_names, subjects) if s is None]
                    skipped.append(
                        f"{track}: {', '.join(subject_names)} — subject(s) not found: {', '.join(missing)}."
                    )
                    continue

                subject_id_set = frozenset(s.id for s in subjects)
                if subject_id_set in existing_subject_sets:
                    already_existed += 1
                    continue

                self.stdout.write(f"  {track}: {', '.join(subject_names)}")
                if not dry_run:
                    combo = PresetCombination.objects.create(track=track)
                    combo.subjects.set(subjects)
                existing_subject_sets.append(subject_id_set)
                created += 1

        self.stdout.write(self.style.SUCCESS(
            f"\n{'[DRY RUN] Would create' if dry_run else 'Created'} {created} combination(s), "
            f"{already_existed} already existed, {len(skipped)} skipped."
        ))
        if skipped:
            self.stdout.write(self.style.WARNING(f"\n{len(skipped)} skipped:"))
            for reason in skipped:
                self.stdout.write(f"  {reason}")
