from django.core.management.base import BaseCommand

from apps.academics.models import Curriculum, Department, Subject, SubjectCategoryLimit

# Canonical department taxonomy per the "Subjects grouped by department" section of
# /home/jordan/Documents/CBC-Kenya-Curriculum-Research.html — the school's own practical
# staffing/HOD grouping (explicitly NOT an official KICD taxonomy, but the one this SMS is
# built around). This replaces the old flat, ad-hoc 6-choice CharField, which had lumped
# Agriculture, Business Studies, Computer Studies, Home Science, Drawing and Design AND
# French all under a single "Technical" bucket (French under "Technical" was simply wrong —
# exactly the kind of hardcoded mis-categorization this Department model exists to fix).
# An admin can rename/add/retire departments freely from the Academics Hub after this runs.
#
# NOTE: the "Auto-Fill Subject Quotas" generic ladder (views_timetable.py) has hardcoded
# weekly-lesson defaults keyed off department name. It matches 'Sciences', 'Languages',
# 'Mathematics' unchanged, and treats 'Technical, Applied & Computer Studies' AND 'Business &
# Agricultural Studies' the same way the old undifferentiated 'Technical' bucket used to (no
# regression for Agriculture/Business Studies/Home Science). 'Creative Arts' and 'Pastoral /
# Life Skills' have no dedicated ladder branch yet (those subjects had no department before
# either, so this is not a regression) — add a QuotaDefaultRule row (Django admin) if you want
# non-zero auto-filled quotas for them.
CANONICAL_DEPARTMENTS = [
    ('Languages', ''),
    ('Mathematics', ''),
    ('Sciences', ''),
    ('Humanities & Religious Education', ''),
    ('Business & Agricultural Studies', ''),
    ('Technical, Applied & Computer Studies', ''),
    ('Creative Arts', ''),
    ('Physical Education & Sports Science', ''),
    ('Pastoral / Life Skills', ''),
]

# Every subject in this school's catalog, mapped onto the dossier's department grouping —
# NOT just a replay of the old (partly wrong) CharField values, since the old data was mostly
# blank/'None' anyway (only 17 of 47 subjects had ever been categorized) and where it wasn't
# blank it was sometimes simply incorrect (French tagged "Technical"). Keyed by Subject.code.
#
# 'DDS 449' (Drawing and Design) is a judgment call, not an explicit dossier entry — grouped
# with Creative Arts as the closest real-world fit (paired with Fine Arts in most Kenyan
# schools). Re-categorize it from the Academics Hub if that's wrong for this school.
SUBJECT_DEPARTMENT_SNAPSHOT = {
    'AMAT': 'Mathematics',                              # Advanced Mathematics
    'A&N': 'Business & Agricultural Studies',           # Agriculture and Nutrition
    'ARB': 'Languages',                                 # Arabic
    'AVI': 'Technical, Applied & Computer Studies',     # Aviation
    'BUI': 'Technical, Applied & Computer Studies',     # Building Construction
    'COM': 'Pastoral / Life Skills',                    # Community Service Learning
    'CMAT': 'Mathematics',                              # Core Mathematics
    'ART': 'Creative Arts',                             # Creative Arts
    'CREATIVE': 'Creative Arts',                        # Creative Arts and Sports
    'ECT': 'Technical, Applied & Computer Studies',     # Electricity
    'ENV': 'Sciences',                                  # Environmental Activities
    'EMAT': 'Mathematics',                              # Essentail Mathematics
    'FAS': 'Languages',                                 # Fasihi Ya Kiswahili
    'FAT': 'Creative Arts',                             # Fine Arts
    'GEN': 'Sciences',                                  # General Science
    'GER': 'Languages',                                 # Germany [German]
    'HRE': 'Humanities & Religious Education',          # Hindu Religious Education
    'HST': 'Humanities & Religious Education',          # History & Citizenship
    'SCI': 'Sciences',                                  # Integration Science
    'LIT': 'Languages',                                 # Literature In English
    'MET': 'Technical, Applied & Computer Studies',     # Metal Work
    'MUS': 'Creative Arts',                             # Music & Dance
    'POW': 'Technical, Applied & Computer Studies',     # Power Mechanics
    'TECH': 'Technical, Applied & Computer Studies',    # Pre-Technical Studies
    'REL': 'Humanities & Religious Education',          # Religious Education
    'SCI/TECH': 'Sciences',                             # Science and Technology
    'S/ST': 'Humanities & Religious Education',         # Social Studies
    'SPO': 'Physical Education & Sports Science',       # Sports & Recreation
    'THR': 'Creative Arts',                             # Theatre & Film
    'WOO': 'Technical, Applied & Computer Studies',     # Wood Work
    'P.E': 'Physical Education & Sports Science',       # Physical Education
    'BIO 231': 'Sciences',                              # Biology
    'CHEM 233': 'Sciences',                             # Chemistry
    'PHY 234': 'Sciences',                              # Physics
    'AGR 443': 'Business & Agricultural Studies',       # Agriculture
    'BST 565': 'Business & Agricultural Studies',       # Business Studies
    'COM 451': 'Technical, Applied & Computer Studies', # Computer Studies
    'DDS 449': 'Creative Arts',                         # Drawing and Design (judgment call — see docstring)
    'HSI 441': 'Business & Agricultural Studies',       # Home Science
    'FRE 501': 'Languages',                             # French
    'GEO 312': 'Humanities & Religious Education',      # Geography
    'IRE 314': 'Humanities & Religious Education',      # Islam Religious Education
    'CRE': 'Humanities & Religious Education',          # Christian Religious Education
    'ENG 101': 'Languages',                             # English
    'KIS 102': 'Languages',                             # Kiswahili
    'MAT 121': 'Mathematics',                           # Mathematics
    'HIS 311': 'Humanities & Religious Education',      # History
}

# Snapshot of the 2 pre-existing SubjectCategoryLimit rows (grade_id=4, i.e. Grade 8 / Junior
# Secondary), keyed by (grade_id, old department string) -> max_subjects. The old flat
# "Technical" limit is re-pointed at Business & Agricultural Studies as the more specific
# real-world fit (capping Agriculture-type subject picks) — re-check this from the Academics
# Hub if this grade's policy was actually meant to also cover Computer/Pre-Technical subjects.
CATEGORY_LIMIT_SNAPSHOT = {
    (4, 'Business & Agricultural Studies'): 1,
    (4, 'Humanities & Religious Education'): 3,
}


class Command(BaseCommand):
    """
    One-time backfill run after migrating in the Department model + Subject/QuotaDefaultRule/
    SubjectCategoryLimit FK fields. Creates the 9 canonical Department rows from the CBC-Kenya
    curriculum dossier's department grouping, categorizes every existing subject accordingly,
    and re-applies the 2 pre-existing category-limit rows under their new department names.

    Safe to re-run (idempotent).

    Usage:
        python manage.py backfill_departments             # apply
        python manage.py backfill_departments --dry-run   # preview only
    """
    help = "Create the dossier's 9 canonical Department rows and categorize every subject accordingly."

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true', help="Preview without saving changes.")

    def handle(self, *args, **options):
        dry_run = options['dry_run']

        # Department.curriculum is now required (added after this command was first written —
        # see backfill_department_curriculum_scoping) — these 9 are always the CBC set.
        try:
            cbc = Curriculum.objects.get(code='CBC')
        except Curriculum.DoesNotExist:
            self.stderr.write(self.style.ERROR("Expected a Curriculum row with code='CBC' to exist."))
            return

        departments = {}
        created_depts = 0
        for name, description in CANONICAL_DEPARTMENTS:
            dept = Department.objects.filter(name=name, curriculum=cbc).first()
            if dept:
                departments[name] = dept
                continue
            self.stdout.write(f"  Department: {name}")
            if not dry_run:
                dept = Department.objects.create(name=name, description=description, curriculum=cbc)
                departments[name] = dept
            created_depts += 1

        unmapped = []
        updated_subjects = 0
        for subject in Subject.objects.all():
            dept_name = SUBJECT_DEPARTMENT_SNAPSHOT.get(subject.code)
            if not dept_name:
                unmapped.append(f"{subject.code} - {subject.name}")
                continue
            dept = departments.get(dept_name)
            if subject.department_id == getattr(dept, 'id', None):
                continue
            self.stdout.write(f"  {subject.code} - {subject.name}: department={dept_name}")
            if not dry_run:
                subject.department = dept
                subject.save(update_fields=['department'])
            updated_subjects += 1

        updated_limits = 0
        for (grade_id, dept_name), max_subjects in CATEGORY_LIMIT_SNAPSHOT.items():
            dept = departments.get(dept_name)
            if SubjectCategoryLimit.objects.filter(grade_id=grade_id, department=dept).exists():
                continue

            # The migration that added the Department FK necessarily nulled out this row's
            # old department string (it couldn't survive the schema change) — re-point the
            # matching orphaned row instead of creating a duplicate. max_subjects is the only
            # surviving signal of which old string it used to be, since two rows for the same
            # grade both now just read department=NULL.
            orphan = SubjectCategoryLimit.objects.filter(
                grade_id=grade_id, department__isnull=True, max_subjects=max_subjects
            ).first()
            if orphan:
                self.stdout.write(f"  Grade {grade_id}: re-pointing orphaned category limit (max={max_subjects}) -> {dept_name}")
                if not dry_run:
                    orphan.department = dept
                    orphan.save(update_fields=['department'])
                updated_limits += 1
                continue

            self.stdout.write(f"  Grade {grade_id}: category limit department={dept_name}, max={max_subjects}")
            if not dry_run:
                SubjectCategoryLimit.objects.create(grade_id=grade_id, department=dept, max_subjects=max_subjects)
            updated_limits += 1

        self.stdout.write(self.style.SUCCESS(
            f"\n{'[DRY RUN] Would create' if dry_run else 'Created'} {created_depts} department(s), "
            f"{'would set' if dry_run else 'set'} department on {updated_subjects} subject(s), "
            f"{'would create' if dry_run else 'created'} {updated_limits} category limit(s)."
        ))
        if unmapped:
            self.stdout.write(self.style.WARNING(
                f"\n{len(unmapped)} subject(s) added since this snapshot was taken — left uncategorized:"
            ))
            for s in unmapped:
                self.stdout.write(f"  {s}")
