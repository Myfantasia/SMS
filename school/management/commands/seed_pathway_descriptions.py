from django.core.management.base import BaseCommand

from apps.academics.models import Pathway, Track

# (current shallow description, richer replacement) -- keyed by exact current text so a
# re-run never clobbers an admin's own edit: only overwrite a description that still reads
# exactly like the original one-liner this command is meant to replace, or is blank.
PATHWAY_DESCRIPTIONS = {
    'STEM': (
        'Science, Technology, Engineering, and Mathematics',
        "Science, Technology, Engineering and Mathematics — the largest Senior School pathway, "
        "chosen by roughly 60% of learners nationally. Electives span Biology, Chemistry, Physics, "
        "Advanced Mathematics, Agriculture, Computer Studies, Home Science, and the hands-on "
        "technical subjects (Aviation, Building & Construction, Electricity, Metal Work, Power "
        "Mechanics, Wood Work, Media Technology, Marine & Fisheries Technology). STEM learners take "
        "Core Mathematics as their compulsory maths — a heavier syllabus than the Essential "
        "Mathematics every other pathway takes. Suits learners aiming at engineering, medicine, "
        "applied sciences, technical trades, or any university/TVET route built on the sciences.",
    ),
    'Social Sciences': (
        'Aimed at learners interested in human behavior, governance, economics, and humanities.',
        "Covers the humanities, business, and languages — for learners drawn to how societies, "
        "economies, and governance work, or to literature and language study. Electives include "
        "Literature in English, Fasihi ya Kiswahili, Indigenous Languages, Sign Language, Arabic, "
        "French, German, Mandarin Chinese, Christian/Islamic/Hindu Religious Education, Business "
        "Studies, History and Citizenship, and Geography. Leads toward university programmes and "
        "careers in law, business, public administration, journalism, translation, and the social "
        "sciences.",
    ),
    'Arts and Sports Science': (
        'This pathway offers formal academic routes for creative and athletic talents, preparing '
        'learners for degrees in creative industries or sports management.',
        "The creative and athletic specialization — Music and Dance, Theatre and Film, Fine Arts, "
        "and Sports and Recreation. Prepares learners for degrees and careers in the creative "
        "industries (performance, design, media production) or sports science, coaching, and "
        "recreation management. The smallest of the three pathways nationally, so schools typically "
        "offer a narrower set of preset combinations — check what your school actually has staffed "
        "before committing.",
    ),
}

# (pathway_name, track_name): (current shallow description, richer replacement)
TRACK_DESCRIPTIONS = {
    ('STEM', 'Pure Sciences'): (
        'Heavily focused on Biology, Chemistry, Physics, and Mathematics.',
        "The classic sciences track — Biology, Chemistry, Physics, and Advanced Mathematics, in "
        "combinations like Advanced Maths/Chemistry/Physics or Biology/Chemistry/Agriculture. The "
        "most direct route into medicine, pure/applied science degrees, and engineering.",
    ),
    ('STEM', 'Applied Sciences'): (
        'Integrates subjects like Agriculture, Computer Science, and Home Science.',
        "Blends sciences with practical subjects — Agriculture, Business Studies, Aviation, "
        "Computer Studies, Home Science — in combinations like Computer Studies/Geography/Physics. "
        "Suits learners aiming at applied technical careers or business-adjacent science fields "
        "rather than pure research.",
    ),
    ('STEM', 'Technical & Engineering'): (
        'Hands-on subjects including Woodwork, Metalwork, Building & Construction, Power Mechanics, '
        'and Aviation.',
        "Hands-on, workshop-based subjects — Building & Construction, Electricity, Metal Work, Power "
        "Mechanics, Wood Work — paired with Geography, Chemistry, Physics, or Business Studies. "
        "Feeds directly into engineering diplomas, TVET certification, and skilled trades; needs a "
        "school with workshop/lab infrastructure to offer it well.",
    ),
    ('Social Sciences', 'Humanities & Business Studies'): (
        'Covers History, Geography, Business Studies, and advanced Religious Education.',
        "Business Studies, History and Citizenship, Geography, and Religious Education (CRE/IRE/"
        "HRE), always paired with Arabic. Suits learners heading toward business, public "
        "administration, law, or the social sciences at university.",
    ),
    ('Social Sciences', 'Languages & Literature'): (
        'Focuses on Literature in English, Fasihi (Swahili literature), and Foreign or Indigenous '
        'Languages.',
        "Literature in English, Fasihi ya Kiswahili, and a foreign or indigenous language (Arabic, "
        "French, German, or an Indigenous Language). For learners drawn to language, literature, "
        "translation, or communications careers.",
    ),
    ('Arts and Sports Science', 'Arts'): (
        'Encompasses Visual Arts (Fine Art, Design) and Performing Arts (Music, Theatre & Film).',
        "Visual and performing arts — Fine Arts, Theatre & Film, Music & Dance — combined with "
        "Business Studies, Arabic, or Computer Studies. Leads toward creative-industry degrees and "
        "careers in design, performance, or media production.",
    ),
    ('Arts and Sports Science', 'Sports'): (
        'Focuses on Sports Science, Physical Education, and Recreation.',
        "Sports and Recreation paired with Biology/Business Studies or General Science/French. "
        "Suits learners aiming at sports science, coaching, physiotherapy, or recreation and events "
        "management.",
    ),
}


class Command(BaseCommand):
    """
    Replaces the original one-line Pathway/Track descriptions with substantive paragraphs
    grounded in the CBC curriculum dossier (what each pathway/track covers, who it suits,
    where it leads) -- the shallow originals were placeholder-quality, not real content.

    Safe to re-run: only overwrites a description that's still blank or still reads exactly
    like the known original one-liner. An admin's own edit (via CurriculumHub) is left alone.

    Usage:
        python manage.py seed_pathway_descriptions
        python manage.py seed_pathway_descriptions --dry-run
    """
    help = "Backfill richer Pathway/Track descriptions, grounded in the CBC curriculum dossier."

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true', help="Preview without saving changes.")

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        updated = 0
        skipped = []

        for pathway in Pathway.objects.all():
            entry = PATHWAY_DESCRIPTIONS.get(pathway.name)
            if not entry:
                continue
            old_text, new_text = entry
            if pathway.description not in ('', old_text):
                skipped.append(f"Pathway '{pathway.name}' — already customized, left alone.")
                continue
            self.stdout.write(f"  Pathway: {pathway.name}")
            if not dry_run:
                pathway.description = new_text
                pathway.save(update_fields=['description'])
            updated += 1

        for track in Track.objects.select_related('pathway').all():
            entry = TRACK_DESCRIPTIONS.get((track.pathway.name, track.name))
            if not entry:
                continue
            old_text, new_text = entry
            if track.description not in ('', old_text):
                skipped.append(f"Track '{track.pathway.name} / {track.name}' — already customized, left alone.")
                continue
            self.stdout.write(f"  Track: {track.pathway.name} / {track.name}")
            if not dry_run:
                track.description = new_text
                track.save(update_fields=['description'])
            updated += 1

        self.stdout.write(self.style.SUCCESS(
            f"\n{'[DRY RUN] Would update' if dry_run else 'Updated'} {updated} description(s), "
            f"{len(skipped)} skipped."
        ))
        if skipped:
            self.stdout.write(self.style.WARNING(f"\n{len(skipped)} skipped:"))
            for reason in skipped:
                self.stdout.write(f"  {reason}")
