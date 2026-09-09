from django.core.management.base import BaseCommand

from apps.academics.models import Curriculum, Department, SubjectCurriculumProfile

# 8-4-4's departments are the ORIGINAL flat 6-choice scheme this school used before Department
# became a real model — confirmed to be an exact match for the 17 subjects that actually carry
# an 8-4-4 SubjectCurriculumProfile row today (see the department-scoping discussion this
# session). CBC gets the richer 9-department grouping from the CBC-Kenya-Curriculum-Research
# dossier (already created by `backfill_departments`), since CBC and 8-4-4 categorize subjects
# differently in practice.
DEPARTMENTS_844 = [
    ('Languages', ''),
    ('Mathematics', ''),
    ('Sciences', ''),
    ('Humanities', ''),
    ('Technical', ''),
    ('PE', 'Physical Education'),
]

# The exact 17 subjects that carry an 8-4-4 SubjectCurriculumProfile — this is the department
# each one had under the old flat scheme, before Department existed as a real model.
SUBJECT_DEPARTMENT_844 = {
    'CRE': 'Humanities',
    'GEO 312': 'Humanities',
    'HIS 311': 'Humanities',
    'IRE 314': 'Humanities',
    'ENG 101': 'Languages',
    'KIS 102': 'Languages',
    'MAT 121': 'Mathematics',
    'P.E': 'PE',
    'BIO 231': 'Sciences',
    'CHEM 233': 'Sciences',
    'PHY 234': 'Sciences',
    'AGR 443': 'Technical',
    'BST 565': 'Technical',
    'COM 451': 'Technical',
    'DDS 449': 'Technical',
    'FRE 501': 'Technical',
    'HSI 441': 'Technical',
}

# Same CBC mapping `backfill_departments` used, duplicated here so this command is
# self-contained — see that file for the "why" behind each choice (dossier-derived; 'DDS 449'
# is a judgment call).
SUBJECT_DEPARTMENT_CBC = {
    'AMAT': 'Mathematics', 'A&N': 'Business & Agricultural Studies', 'ARB': 'Languages',
    'AVI': 'Technical, Applied & Computer Studies', 'BUI': 'Technical, Applied & Computer Studies',
    'COM': 'Pastoral / Life Skills', 'CMAT': 'Mathematics', 'ART': 'Creative Arts',
    'CREATIVE': 'Creative Arts', 'ECT': 'Technical, Applied & Computer Studies', 'ENV': 'Sciences',
    'EMAT': 'Mathematics', 'FAS': 'Languages', 'FAT': 'Creative Arts', 'GEN': 'Sciences',
    'GER': 'Languages', 'HRE': 'Humanities & Religious Education', 'HST': 'Humanities & Religious Education',
    'SCI': 'Sciences', 'LIT': 'Languages', 'MET': 'Technical, Applied & Computer Studies',
    'MUS': 'Creative Arts', 'POW': 'Technical, Applied & Computer Studies',
    'TECH': 'Technical, Applied & Computer Studies', 'REL': 'Humanities & Religious Education',
    'SCI/TECH': 'Sciences', 'S/ST': 'Humanities & Religious Education',
    'SPO': 'Physical Education & Sports Science', 'THR': 'Creative Arts',
    'WOO': 'Technical, Applied & Computer Studies', 'P.E': 'Physical Education & Sports Science',
    'BIO 231': 'Sciences', 'CHEM 233': 'Sciences', 'PHY 234': 'Sciences',
    'AGR 443': 'Business & Agricultural Studies', 'BST 565': 'Business & Agricultural Studies',
    'COM 451': 'Technical, Applied & Computer Studies', 'DDS 449': 'Creative Arts',
    'HSI 441': 'Business & Agricultural Studies', 'FRE 501': 'Languages',
    'GEO 312': 'Humanities & Religious Education', 'IRE 314': 'Humanities & Religious Education',
    'CRE': 'Humanities & Religious Education', 'ENG 101': 'Languages', 'KIS 102': 'Languages',
    'MAT 121': 'Mathematics', 'HIS 311': 'Humanities & Religious Education',
}


class Command(BaseCommand):
    """
    One-time backfill run after migrating in Department.curriculum + SubjectCurriculumProfile.
    department (school.migrations.0091_department_curriculum). Creates the 6 canonical 8-4-4
    departments (CBC's 9 already exist from `backfill_departments`, now tagged curriculum=CBC
    by that same migration's data step) and sets SubjectCurriculumProfile.department on every
    profile row so a subject taught under both curricula gets the right department for each
    (e.g. Agriculture: 'Technical' under 8-4-4, 'Business & Agricultural Studies' under CBC).

    Safe to re-run (idempotent).

    Usage:
        python manage.py backfill_department_curriculum_scoping             # apply
        python manage.py backfill_department_curriculum_scoping --dry-run   # preview only
    """
    help = "Create 8-4-4 departments and set SubjectCurriculumProfile.department per curriculum."

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true', help="Preview without saving changes.")

    def handle(self, *args, **options):
        dry_run = options['dry_run']

        try:
            cbc = Curriculum.objects.get(code='CBC')
            c844 = Curriculum.objects.get(code='8-4-4')
        except Curriculum.DoesNotExist as e:
            self.stderr.write(self.style.ERROR(f"Expected Curriculum rows 'CBC' and '8-4-4' to exist: {e}"))
            return

        # 1. Create the 6 canonical 8-4-4 departments.
        departments_844 = {}
        created_depts = 0
        for name, description in DEPARTMENTS_844:
            dept = Department.objects.filter(name=name, curriculum=c844).first()
            if dept:
                departments_844[name] = dept
                continue
            self.stdout.write(f"  Department (8-4-4): {name}")
            if not dry_run:
                dept = Department.objects.create(name=name, description=description, curriculum=c844)
                departments_844[name] = dept
            created_depts += 1

        # 2. CBC's 9 departments already exist (created by backfill_departments, tagged CBC by
        # migration 0091's data step) — just look them up.
        departments_cbc = {d.name: d for d in Department.objects.filter(curriculum=cbc)}

        # 3. Set SubjectCurriculumProfile.department per (subject, curriculum) pair — every
        # tier-scoped row for the same subject+curriculum gets the same department, since
        # department doesn't vary by tier, only by curriculum.
        updated_profiles = 0
        unmapped = []
        profiles = SubjectCurriculumProfile.objects.select_related('subject', 'curriculum')
        for profile in profiles:
            if profile.curriculum_id == c844.id:
                dept_name = SUBJECT_DEPARTMENT_844.get(profile.subject.code)
                dept = departments_844.get(dept_name) if dept_name else None
            elif profile.curriculum_id == cbc.id:
                dept_name = SUBJECT_DEPARTMENT_CBC.get(profile.subject.code)
                dept = departments_cbc.get(dept_name) if dept_name else None
            else:
                continue  # a curriculum beyond CBC/8-4-4 — nothing to map it to yet

            if not dept:
                unmapped.append(f"{profile.subject.code} - {profile.subject.name} ({profile.curriculum.code})")
                continue
            if profile.department_id == dept.id:
                continue

            self.stdout.write(f"  {profile.subject.code} @ {profile.curriculum.code}: department={dept_name}")
            if not dry_run:
                profile.department = dept
                profile.save(update_fields=['department'])
            updated_profiles += 1

        self.stdout.write(self.style.SUCCESS(
            f"\n{'[DRY RUN] Would create' if dry_run else 'Created'} {created_depts} 8-4-4 department(s), "
            f"{'would set' if dry_run else 'set'} department on {updated_profiles} curriculum profile(s)."
        ))
        if unmapped:
            self.stdout.write(self.style.WARNING(f"\n{len(unmapped)} profile(s) left unmapped:"))
            for s in unmapped:
                self.stdout.write(f"  {s}")
