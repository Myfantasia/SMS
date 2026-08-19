"""Models for the `academics` app.

Curriculum, pathways, tracks, grade levels, class streams, subjects,
departments, academic calendar (AcademicYear/ExamTerm), and the timetable
grid's static structure (TimeSlot).

Track B step 8: every class below physically relocated here from
school/models/classSubjects_models.py (deleted -- its only remaining content
was a dead, unreferenced SUBJECT_CHOICES constant), school/models/models.py
(AcademicYear/ExamTerm), and school/models/timetable_models.py (TimeSlot,
deleted -- it had nothing else in it). Every Meta.db_table below pins the
original `school_<lowercase modelname>` table name so the physical tables
never moved; PresetCombination.subjects/SubjectPool.subjects pin their
join-table names the same way for the same reason.

This is the single most-depended-on domain app -- nearly every other app's
models.py has a real FK into a class in this file. Per the plan's
`.importlinter` design (see the contract file's comments), those FKs use
app-label-qualified string references (e.g. 'academics.ClassStream') instead
of a Python import, exactly like ClassStream.class_teacher below already
does for 'identity.TeacherExtra' -- Django resolves these through its app
registry, not an import, so no cross-app model import ever needs to exist in
another app's models.py for this.
"""
from django.db import models


class Curriculum(models.Model):
    """
    First-class curriculum entity, replacing the duplicated CURRICULUM_CHOICES that used
    to live independently on GradeLevel and GradingRule. Never deleted — retiring one is a
    two-phase lifecycle: is_active_for_new_grades=False stops new GradeLevels from selecting
    it, is_archived=True later freezes all its presets/pathways/pools against ordinary edits.
    Historical data stays fully readable either way.
    """
    code = models.CharField(max_length=10, unique=True, help_text="e.g. 'CBC', '8-4-4'")
    name = models.CharField(max_length=100, help_text="e.g. 'Competency Based Curriculum'")
    is_active_for_new_grades = models.BooleanField(default=True)
    is_archived = models.BooleanField(default=False)

    class Meta:
        db_table = 'school_curriculum'
        ordering = ['name']

    def __str__(self):
        return self.name


class Pathway(models.Model):
    """
    A Senior Secondary specialization track (e.g. STEM, Social Sciences, Arts & Sports
    Science). Only meaningful for a CBC curriculum's SSS tier — that's enforced in the
    serializer, matching this codebase's existing convention of business validation in
    the API layer rather than the DB.
    """
    curriculum = models.ForeignKey(Curriculum, on_delete=models.CASCADE, related_name='pathways')
    name = models.CharField(max_length=100)
    description = models.CharField(max_length=255, blank=True)

    class Meta:
        db_table = 'school_pathway'
        unique_together = ('curriculum', 'name')

    def __str__(self):
        return f"{self.name} ({self.curriculum.code})"


class Track(models.Model):
    """
    A Pathway-scoped specialization (e.g. STEM's Pure Sciences, Applied Sciences, Technical
    Studies) — same shape as Tier, but scoped to a Pathway instead of a Curriculum, since
    tracks only exist to subdivide a single pathway's own subject offering. A student who
    has an approved Pathway with Tracks configured must also pick one of them (enforced in
    the API layer, matching this codebase's convention of business validation there rather
    than the DB) — that's what actually determines which CurriculumPreset governs their
    subject pools, not the Pathway alone.
    """
    pathway = models.ForeignKey(Pathway, on_delete=models.CASCADE, related_name='tracks')
    name = models.CharField(max_length=100)
    description = models.CharField(max_length=255, blank=True)
    display_order = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = 'school_track'
        unique_together = ('pathway', 'name')
        ordering = ['display_order', 'name']

    def __str__(self):
        return f"{self.name} ({self.pathway.name})"


class PresetCombination(models.Model):
    """
    One nationally pre-approved 3-subject Senior School elective combination (KNEC's official
    catalog — 571 combinations nationwide as of the 2026 Grade 10 rollout), scoped to a Track
    (and, via Track, to exactly one Pathway).

    Deliberately independent of CurriculumPreset/SubjectPool: those remain the school's own
    free-form preset-building tool (used for e.g. JSS core/elective structuring) and are not
    constrained by — or aware of — this catalog, so admins can keep creating/editing presets
    and pools without this model getting in the way. This is purely the reference list a
    student's combination choice (StudentPathwaySelection.preset_combination) is validated
    against: "is this one of the actual approved triples", not "is this subject in some pool".

    Exactly-3-subjects is validated in the serializer (see PresetCombinationSerializer),
    matching this codebase's convention of business validation at the API layer rather than
    a DB constraint, since M2M membership can't be enforced by the database at save() time.
    """
    track = models.ForeignKey(Track, on_delete=models.CASCADE, related_name='preset_combinations')
    name = models.CharField(
        max_length=150, blank=True,
        help_text="Optional display name (e.g. 'Pure Sciences Combo 1'). Auto-derived from the "
                   "subjects if left blank."
    )
    code = models.CharField(
        max_length=20, blank=True,
        help_text="Optional official KNEC combination code/number, if published."
    )
    subjects = models.ManyToManyField('Subject', related_name='preset_combinations', db_table='school_presetcombination_subjects')
    is_active = models.BooleanField(
        default=True,
        help_text="Uncheck to retire a combination (e.g. the school stopped offering it) without "
                   "deleting historical student selections that reference it."
    )

    class Meta:
        db_table = 'school_presetcombination'
        ordering = ['track', 'name']

    def display_name(self):
        if self.name:
            return self.name
        return " / ".join(self.subjects.order_by('name').values_list('name', flat=True))

    def __str__(self):
        return f"{self.display_name()} ({self.track.name})"


NATIONAL_EXAM_CHOICES = [
    ('KPSEA', 'KPSEA'),
    ('KJSEA', 'KJSEA'),
    ('KCSE', 'KCSE'),
]


class Tier(models.Model):
    """
    A curriculum-defined stage split (e.g. CBC's Junior/Senior Secondary). Deliberately not
    a hardcoded JSS/SSS choice list — every curriculum differs in how (or whether) it splits
    into stages, so admins define whatever tiers a given curriculum actually needs from
    Curriculum Hub, same shape as Pathway above.
    """
    curriculum = models.ForeignKey(Curriculum, on_delete=models.CASCADE, related_name='tiers')
    name = models.CharField(max_length=100, help_text="e.g. Junior Secondary")
    code = models.CharField(max_length=10, help_text="e.g. JSS")
    display_order = models.PositiveIntegerField(default=0)
    exit_exam_code = models.CharField(
        max_length=10, choices=NATIONAL_EXAM_CHOICES, blank=True,
        help_text="National exam gating promotion out of this tier, if any. Blank means no "
                   "national exam — promotion out of this tier is a plain, internal-results-gated "
                   "transition (see results_finalized_for_year in school/views/promotion_views.py)."
    )
    exit_is_terminal = models.BooleanField(
        default=False,
        help_text="True if this tier's exit exam also ends the student's journey at this school "
                   "(cross-institution placement, e.g. KJSEA into Senior School, or school-leaving, "
                   "e.g. KCSE) rather than continuing into another grade at this school. Only "
                   "meaningful when exit_exam_code is set."
    )

    class Meta:
        db_table = 'school_tier'
        unique_together = ('curriculum', 'code')
        ordering = ['display_order', 'name']

    def __str__(self):
        return f"{self.name} ({self.curriculum.code})"


def tier_requires_pathway_choice(tier) -> bool:
    """
    True for a pathway-choice stage (Senior Secondary under CBC) where students choose
    across Pathway -> Track -> PresetCombination, rather than being assigned a fixed
    compulsory set. Tier is admin-defined free text (see Tier docstring above -- no
    hardcoded JSS/SSS enum), so this is a name-substring convention, centralizing the
    heuristic CurriculumHub.tsx's `showPathway` already used ad hoc in one place.
    """
    if tier is None:
        return False
    return 'senior secondary' in (tier.name or '').lower()


class GradeLevel(models.Model):
    """
    The overarching academic level (e.g., Grade 6, Form 1).
    Keeps the system flexible for both CBC and older curriculums.
    """

    # --- Kept for backwards compatibility: several frontend components read this plain
    # string field directly. curriculum_type is now a denormalized mirror of `curriculum`,
    # kept in sync in save() below, so those consumers keep working unmodified. ---
    CURRICULUM_CHOICES = [
        ('CBC', 'Competency Based Curriculum (CBC)'),
        ('8-4-4', 'Standard 8-4-4 Curriculum'),
    ]

    name = models.CharField(max_length=50, unique=True)
    numeric_order = models.IntegerField(help_text="Used for sorting (e.g., 6 for Grade 6)")

    curriculum_type = models.CharField(max_length=10, choices=CURRICULUM_CHOICES, default='CBC')

    curriculum = models.ForeignKey(
        Curriculum, on_delete=models.PROTECT, null=True, blank=True, related_name='grades'
    )
    tier = models.ForeignKey(
        'Tier', on_delete=models.PROTECT, null=True, blank=True, related_name='grades',
        help_text="Only meaningful when the grade's curriculum has tiers configured."
    )

    class Meta:
        db_table = 'school_gradelevel'

    def save(self, *args, **kwargs):
        if self.curriculum_id:
            self.curriculum_type = self.curriculum.code
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.name} ({self.curriculum_type})"


def grade_requires_pathway_choice(grade) -> bool:
    """
    True only for the entry grade of a pathway-choice tier (Grade 10 under CBC's Senior
    Secondary) — a student picks their Pathway/Track/PresetCombination once, on arrival, and
    it carries forward through the rest of the tier (Grade 11, 12), which must not re-expose
    the picker. "Entry grade" is computed as the tier's own lowest-numeric_order GradeLevel,
    not a hardcoded "Grade 10" name string, matching Tier's own no-hardcoded-JSS/SSS
    convention (see tier_requires_pathway_choice above).
    """
    if grade is None or not tier_requires_pathway_choice(grade.tier):
        return False
    entry_grade = GradeLevel.objects.filter(tier=grade.tier).order_by('numeric_order').first()
    return entry_grade is not None and entry_grade.id == grade.id


def next_grade_level(grade):
    """
    The next GradeLevel in the same curriculum by numeric_order, regardless of tier — this
    naturally spans tier boundaries (e.g. Grade 6 Upper Primary -> Grade 7 Junior Secondary)
    since a promotion tier isn't a 1:1 mapping to a single grade. Returns None for a
    curriculum's highest-numeric_order grade (a terminal exit grade, e.g. Grade 12/Form 4).
    """
    if grade is None:
        return None
    return GradeLevel.objects.filter(
        curriculum_id=grade.curriculum_id, numeric_order__gt=grade.numeric_order
    ).order_by('numeric_order').first()


# ==========================================
# CORE SOFT-DELETION & SHIELDING MANAGERS
# ==========================================

class NonDeletedManager(models.Manager):
    """Safeguards queries by automatically filtering out soft-deleted records."""
    def get_queryset(self):
        return super().get_queryset().filter(is_deleted=False)


class PhysicalStreamManager(models.Manager):
    """
    OPTION B SHIELD: Filters out BOTH soft-deleted streams and
    virtual elective block groupings from standard UI lists.
    """
    def get_queryset(self):
        return super().get_queryset().filter(is_deleted=False, is_virtual=False)


class ClassStream(models.Model):
    """
    The actual physical or logical classroom.
    Now equipped with Option B Virtual support and Soft Deletion.
    """
    name = models.CharField(max_length=50)
    grade = models.ForeignKey('GradeLevel', on_delete=models.CASCADE, related_name='streams')
    capacity = models.PositiveIntegerField(default=40)
    class_teacher = models.ForeignKey('identity.TeacherExtra', on_delete=models.SET_NULL, null=True, blank=True,
                                      related_name='assigned_classes')

    # --- NEW: OPTION B VIRTUAL SWITCH ---
    is_virtual = models.BooleanField(default=False,
                                     help_text="True if this is a temporary block grouping for electives.")

    # --- NEW: SOFT DELETION FIELD ---
    is_deleted = models.BooleanField(default=False, db_index=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    deleted_by = models.ForeignKey('auth.User', on_delete=models.SET_NULL, null=True, blank=True, related_name='+')

    # --- ATTACH MANAGERS ---
    objects = models.Manager()  # .all() returns everything (including ghosts)
    live = NonDeletedManager()  # .all() returns physical + virtual (excludes deleted)
    physical = PhysicalStreamManager()  # .all() returns ONLY physical classrooms (The UI Shield)

    class Meta:
        db_table = 'school_classstream'
        # Changed to include is_deleted, allowing you to create a new "Grade 7A" if the old one was soft-deleted
        unique_together = ('name', 'grade', 'is_deleted')

    def __str__(self):
        suffix = " (Virtual)" if self.is_virtual else (" (Deleted)" if self.is_deleted else "")
        return f"{self.grade.name} {self.name}{suffix}"

    def soft_delete(self, operator_user=None):
        """Safely removes resource from active streams without breaking database constraints."""
        from apps.core.trash import soft_delete as _soft_delete
        _soft_delete(
            self, operator=operator_user, module='ClassStream',
            description=f"Soft deleted stream: {self.grade.name} {self.name} (ID: {self.id})",
        )

    def restore(self, operator_user=None):
        from apps.core.trash import restore as _restore
        _restore(
            self, operator=operator_user, module='ClassStream',
            description=f"Restored stream: {self.grade.name} {self.name} (ID: {self.id})",
        )


def get_or_create_class_stream(grade, name):
    """
    Finds the ClassStream named `name` within `grade`, creating it (default capacity, no
    assigned class teacher) if it doesn't exist yet. Used by promotion to move a student into
    "the same-named stream" in their next grade (e.g. Grade 10 Central -> Grade 11 Central),
    matching ClassStream's per-grade (not global) name uniqueness.
    """
    stream, _ = ClassStream.objects.get_or_create(
        grade=grade, name=name, is_deleted=False, defaults={'capacity': 40},
    )
    return stream


def _register_class_stream_trash():
    from apps.core.trash import register_trash_entity, TrashEntityConfig
    register_trash_entity('class-streams', TrashEntityConfig(
        model=ClassStream, flag_field='is_deleted', flag_true=True, flag_false=False,
        auto_purge=False,
        label_fn=lambda cs: f"{cs.grade.name} {cs.name}",
    ))


_register_class_stream_trash()


class Department(models.Model):
    """
    Admin-managed subject department (e.g. Languages, Sciences, Technical) — replaces the
    old hardcoded 6-choice Subject.department CharField so a school can add/rename its own
    departments without a code change.

    Curriculum-scoped: 8-4-4 and CBC group subjects differently in practice (e.g. 8-4-4's flat
    "Technical" bucket splits into CBC's "Technical, Applied & Computer Studies" vs "Business &
    Agricultural Studies" vs "Creative Arts" per the CBC-Kenya-Curriculum-Research dossier), so
    a department belongs to exactly one Curriculum — "Languages" under CBC and "Languages"
    under 8-4-4 are deliberately two different rows, not one shared row, even though they share
    a name (see unique_together below). A subject taught under both curricula picks its
    department per curriculum via SubjectCurriculumProfile.department, not on Subject itself
    (see get_effective_department()).

    NOTE: the "Auto-Fill Subject Quotas" generic ladder (api_auto_generate_quotas in
    views_timetable.py) still has hardcoded weekly-lesson defaults for CBC departments literally
    named Languages/Mathematics/Sciences/Humanities & Religious Education/Technical, Applied &
    Computer Studies/Business & Agricultural Studies/Physical Education & Sports Science, and
    for the 8-4-4 departments literally named Languages/Mathematics/Sciences/Humanities/
    Technical/PE — renaming one of those changes that department's subjects to fall back to the
    baseline (0 lessons, or the blocked-elective figure) until an admin adds a QuotaDefaultRule
    row for it.
    """
    name = models.CharField(max_length=50)
    # null=True (not just blank=True): Postgres treats repeated '' as a real duplicate under a
    # unique constraint (unlike NULL, where multiple rows can all be NULL) — every department
    # left without a code needs to store NULL, not '', or the 2nd such row fails to save.
    code = models.CharField(max_length=10, null=True, blank=True, help_text="Optional short code, e.g. 'SCI'.")
    description = models.CharField(max_length=255, blank=True)
    is_active = models.BooleanField(default=True, help_text="Inactive departments stay on existing subjects but drop out of pickers for new ones.")
    curriculum = models.ForeignKey(
        'Curriculum', on_delete=models.CASCADE, related_name='departments',
        help_text="Which curriculum this department belongs to — CBC and 8-4-4 group subjects differently, so departments aren't shared across them."
    )

    class Meta:
        db_table = 'school_department'
        ordering = ['curriculum', 'name']
        unique_together = [('name', 'curriculum'), ('code', 'curriculum')]

    def __str__(self):
        return f"{self.name} ({self.curriculum.code})"


class SubjectLiveManager(models.Manager):
    def get_queryset(self):
        return super().get_queryset().filter(is_deleted=False)


class Subject(models.Model):
    """
    Master curriculum catalog.
    """
    code = models.CharField(max_length=10, unique=True)  # e.g., MAT101
    name = models.CharField(max_length=100)
    department = models.ForeignKey(
        Department, on_delete=models.SET_NULL, null=True, blank=True, related_name='subjects',
        help_text="Leave blank for an uncategorized subject — set it from the Academics Hub."
    )
    is_core = models.BooleanField(default=True, help_text="Is this mandatory for all students?")
    display_order = models.PositiveIntegerField(
        default=0,
        help_text="Controls subject ordering in the Allocation Matrix and similar subject lists."
    )

    # --- NEW FIELDS FOR ALLOCATION & BLOCK SCHEDULING ---
    allows_multiclass = models.BooleanField(default=False, help_text="Bypass clash prevention for subjects like PE")

    # --- NEW ADDITIONS: DE-HARDCODING RULES ENGINE ---
    allow_double_periods = models.BooleanField(
        default=True,
        help_text="Uncheck for subjects like P.E. or Religious education that should never form double blocks."
    )
    earliest_allowed_time = models.TimeField(
        null=True,
        blank=True,
        help_text="Set to 09:30:00 for P.E. to prevent scheduling during cold early morning blocks."
    )
    requires_synchronized_grade_blocking = models.BooleanField(
        default=False,
        help_text="Check True for technical or elective blocks that must run concurrently across the entire grade level. "
                   "This is the single source of truth is_tech_subject() reads — set it here instead of relying on the "
                   "subject's name or department, so a newly added subject never needs a code change to be routed "
                   "through the shared-block / elective-splitting engine."
    )
    synchronized_blocking_min_grade = models.PositiveIntegerField(
        null=True, blank=True,
        help_text="Only treat this subject as a synchronized/shared block from this grade's numeric order upward "
                   "(e.g. a subject offered from Grade 8 down shouldn't force shared-block scheduling in Grade 7). "
                   "Leave blank to apply at every grade this subject is taught."
    )

    # --- SOFT DELETION FIELDS ---
    is_deleted = models.BooleanField(default=False, db_index=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    deleted_by = models.ForeignKey('auth.User', on_delete=models.SET_NULL, null=True, blank=True, related_name='+')

    # --- MANAGERS ---
    objects = models.Manager()
    live = SubjectLiveManager()

    class Meta:
        db_table = 'school_subject'

    def __str__(self):
        return f"{self.code} - {self.name}"

    def soft_delete(self, operator_user=None):
        from apps.core.trash import soft_delete as _soft_delete
        _soft_delete(
            self, operator=operator_user, module='Subject',
            description=f"Soft deleted subject: {self.name} ({self.code}).",
        )

    def restore(self, operator_user=None):
        from apps.core.trash import restore as _restore
        _restore(
            self, operator=operator_user, module='Subject',
            description=f"Restored subject: {self.name} ({self.code}).",
        )


def _register_subject_trash():
    from apps.core.trash import register_trash_entity, TrashEntityConfig
    register_trash_entity('subjects', TrashEntityConfig(
        model=Subject, flag_field='is_deleted', flag_true=True, flag_false=False,
        auto_purge=False,
        label_fn=lambda s: f"{s.name} ({s.code})",
    ))


_register_subject_trash()


class SubjectCurriculumProfile(models.Model):
    """
    Assigns a Subject into a Curriculum (optionally scoped to one of its Tiers) — same
    "assign, don't just list" pattern already used for Grade <-> Tier in TierDetailView.
    A Subject with zero profile rows is shared/legacy and stays visible everywhere,
    matching this codebase's "don't break old data" convention (e.g. CurriculumPreset.curriculum
    is nullable for the same reason).
    """
    subject = models.ForeignKey(Subject, on_delete=models.CASCADE, related_name='curriculum_profiles')
    curriculum = models.ForeignKey(Curriculum, on_delete=models.CASCADE, related_name='subject_profiles')
    tier = models.ForeignKey(
        Tier, on_delete=models.CASCADE, null=True, blank=True, related_name='subject_profiles',
        help_text="Leave blank to apply to the whole curriculum; set to scope to one tier only."
    )
    is_core = models.BooleanField(
        null=True, blank=True,
        help_text="Overrides Subject.is_core for this curriculum/tier. Leave blank to inherit the subject's default."
    )
    department = models.ForeignKey(
        Department, on_delete=models.SET_NULL, null=True, blank=True, related_name='subject_profiles',
        help_text="This subject's department under this curriculum specifically — CBC and 8-4-4 group "
                   "subjects differently, so a subject taught under both needs a department per curriculum, "
                   "not one flat Subject.department. Set on the tier=None (whole-curriculum) row; per-tier "
                   "rows for the same subject+curriculum should carry the same value, not a tier-specific one. "
                   "Leave blank to inherit Subject.department."
    )
    total_lessons = models.PositiveIntegerField(
        null=True, blank=True,
        help_text="Weekly lesson count for this subject under this curriculum/tier. Used both to "
                   "seed a brand-new grade's SubjectQuota and, when set, as the authoritative figure "
                   "'Auto-Fill Subject Quotas' reads instead of its generic department-based defaults."
    )
    double_lessons_required = models.PositiveIntegerField(
        null=True, blank=True,
        help_text="Overrides the default double-period count that goes with total_lessons above. "
                   "Leave blank to fall back to the generic default (0)."
    )
    remedial_lessons_required = models.PositiveIntegerField(
        null=True, blank=True,
        help_text="Overrides the default remedial-slot count that goes with total_lessons above. "
                   "Leave blank to fall back to the generic default (1)."
    )

    class Meta:
        db_table = 'school_subjectcurriculumprofile'
        unique_together = ('subject', 'curriculum', 'tier')

    def __str__(self):
        scope = self.curriculum.code + (f"/{self.tier.code}" if self.tier else "")
        return f"{self.subject.code} @ {scope}"


def get_effective_is_core(subject, curriculum, tier=None):
    """
    Resolves whether `subject` is core/mandatory for a specific curriculum+tier context,
    honoring any SubjectCurriculumProfile override (an exact tier match wins over a
    curriculum-wide, tier=None profile) and falling back to the subject's own flat is_core
    when there's no curriculum context or no profile applies. Shared helper for every place
    that gates behavior on core-vs-elective (exam rosters, student elective self-service,
    allocation splitting) so "core under CBC but elective under 8-4-4" actually takes effect
    everywhere, not just at new-grade quota seeding time.
    """
    if not curriculum:
        return subject.is_core
    profiles = list(subject.curriculum_profiles.filter(curriculum=curriculum))
    if not profiles:
        return subject.is_core
    match = (
        next((p for p in profiles if tier and p.tier_id == tier.id), None)
        or next((p for p in profiles if p.tier_id is None), None)
    )
    if match is None or match.is_core is None:
        return subject.is_core
    return match.is_core


def get_effective_department(subject, curriculum, tier=None):
    """
    Resolves which Department `subject` belongs to under a specific curriculum+tier context —
    same resolution order as get_effective_is_core(). Departments are curriculum-scoped (CBC
    and 8-4-4 group subjects differently), so a subject taught under both curricula can have a
    different department for each; this is what makes that work everywhere a grade's curriculum
    is known (quota auto-fill, the per-grade subject catalog), falling back to the subject's
    flat Subject.department when there's no curriculum context or no profile override.
    """
    if not curriculum:
        return subject.department
    profiles = list(subject.curriculum_profiles.filter(curriculum=curriculum))
    if not profiles:
        return subject.department
    match = (
        next((p for p in profiles if tier and p.tier_id == tier.id), None)
        or next((p for p in profiles if p.tier_id is None), None)
    )
    if match is None or match.department_id is None:
        return subject.department
    return match.department


class SubjectSelectionRule(models.Model):
    """
    DYNAMIC RULE CHECKER:
    Allows admins to change subject limits per grade without touching code.
    """
    grade = models.OneToOneField(GradeLevel, on_delete=models.CASCADE, related_name='selection_rule')
    min_subjects = models.PositiveIntegerField(default=7, help_text="Minimum subjects a student must take")
    max_subjects = models.PositiveIntegerField(default=8, help_text="Maximum subjects a student can take")

    class Meta:
        db_table = 'school_subjectselectionrule'

    def __str__(self):
        return f"{self.grade.name} Rules ({self.min_subjects}-{self.max_subjects} subjects)"


class SubjectCategoryLimit(models.Model):
    """
    POLICY: DEPARTMENT LIMITS
    e.g., Grade 8 can only pick a maximum of 1 'Technical' subject.
    """
    grade = models.ForeignKey('GradeLevel', on_delete=models.CASCADE, related_name='category_limits')
    # null=True so the CharField -> ForeignKey migration doesn't need a default for existing
    # rows (Department rows don't exist yet at migration time — see backfill_departments).
    # The admin API still requires a department to create a NEW limit; this is purely a
    # migration-safety allowance, not an intended steady-state value.
    department = models.ForeignKey(Department, on_delete=models.CASCADE, null=True, blank=True, related_name='category_limits')
    max_subjects = models.PositiveIntegerField(default=1)

    class Meta:
        db_table = 'school_subjectcategorylimit'
        # A grade can only have one specific rule per department
        unique_together = ('grade', 'department')

    def __str__(self):
        dept = self.department.name if self.department else "Unset"
        return f"{self.grade.name} - Max {self.max_subjects} {dept} Subjects"


class SubjectExclusionRule(models.Model):
    """
    POLICY: SUBJECT-PAIR RELATIONSHIPS
    e.g., Grade 8 students cannot select CRE and IRE at the same time (EXCLUDES),
    or Physics requires Pure Mathematics (REQUIRES).
    """
    RULE_TYPE_CHOICES = [
        ('EXCLUDES', 'Mutually Exclusive'),
        ('REQUIRES', 'Co-Requisite'),
    ]

    grade = models.ForeignKey('GradeLevel', on_delete=models.CASCADE, related_name='exclusion_rules')
    subject_a = models.ForeignKey('Subject', on_delete=models.CASCADE, related_name='excluded_by_a')
    subject_b = models.ForeignKey('Subject', on_delete=models.CASCADE, related_name='excluded_by_b')
    rule_type = models.CharField(max_length=10, choices=RULE_TYPE_CHOICES, default='EXCLUDES')

    class Meta:
        db_table = 'school_subjectexclusionrule'
        # Prevent duplicate exclusion rules
        unique_together = ('grade', 'subject_a', 'subject_b')

    def __str__(self):
        verb = 'requires' if self.rule_type == 'REQUIRES' else 'excludes'
        return f"{self.grade.name}: {self.subject_a.name} {verb} {self.subject_b.name}"


class CurriculumPreset(models.Model):
    """
    PER-SCHOOL CURRICULUM TEMPLATES:
    Stores dynamic quick-presets (e.g., 'Standard 8-4-4', 'CBC Junior Sec')
    so administrators can populate the frontend sidebar dynamically without code changes.

    Tenant-scoped (2026-08-13, first entity in the multi-tenancy rollout — see
    school/services/get_current_school_id equivalent in apps/identity/services.py for how
    `school` gets set today). Unlike curriculum/tier/pathway/track below, `name` uniqueness
    is per-school, not global — two schools can both have a preset called "Standard 8-4-4".
    """
    name = models.CharField(max_length=100, help_text="e.g., Standard 8-4-4, CBC Junior Sec.")
    min_subjects = models.PositiveIntegerField(default=7, help_text="Default minimum subjects for this preset.")
    max_subjects = models.PositiveIntegerField(default=8, help_text="Default maximum subjects for this preset.")

    # Optional: helps sort them logically in the UI
    display_order = models.PositiveIntegerField(default=0)

    # PROTECT, not CASCADE: deleting a School should never silently delete its curriculum
    # config as a side effect of an unrelated FK — that needs to be a deliberate, guarded
    # operation elsewhere once school deletion is a real supported flow.
    school = models.ForeignKey(
        'identity.School', on_delete=models.PROTECT,
        related_name='curriculum_presets',
        help_text="Server-derived, never client-supplied — see get_current_school_id().",
    )

    # --- Curriculum architecture: null=True because the presets that exist today predate
    # this link and can't be reliably auto-categorized — they show as "Uncategorized" in
    # the admin UI until assigned, rather than guessing. ---
    curriculum = models.ForeignKey(
        Curriculum, on_delete=models.CASCADE, null=True, blank=True, related_name='presets'
    )
    tier = models.ForeignKey(
        Tier, on_delete=models.SET_NULL, null=True, blank=True, related_name='presets'
    )
    pathway = models.ForeignKey(
        Pathway, on_delete=models.SET_NULL, null=True, blank=True, related_name='presets'
    )
    track = models.ForeignKey(
        Track, on_delete=models.SET_NULL, null=True, blank=True, related_name='presets',
        help_text="Only set when the preset's pathway has Tracks configured (e.g. STEM's Pure Sciences)."
    )

    class Meta:
        db_table = 'school_curriculumpreset'
        ordering = ['display_order', 'name']
        unique_together = ('school', 'name')
        indexes = [models.Index(fields=['school', 'display_order'], name='curr_preset_school_order_idx')]

    def __str__(self):
        return f"{self.name} ({self.min_subjects} - {self.max_subjects})"


class SubjectPool(models.Model):
    """
    A named bucket of subjects within a CurriculumPreset (Core Compulsory / Pathway Core /
    Guided Elective), each with its own min/max pick count. Whether a subject can belong to
    more than one pool is intentionally left unconstrained for now — deferred.
    """
    POOL_TYPE_CHOICES = [
        ('CORE_COMPULSORY', 'Core Compulsory'),
        ('PATHWAY_CORE', 'Pathway Core'),
        ('GUIDED_ELECTIVE', 'Guided Elective'),
    ]
    preset = models.ForeignKey(CurriculumPreset, on_delete=models.CASCADE, related_name='pools')
    pool_type = models.CharField(max_length=20, choices=POOL_TYPE_CHOICES)
    min_subjects = models.PositiveIntegerField(default=1)
    max_subjects = models.PositiveIntegerField(default=1)
    subjects = models.ManyToManyField(Subject, related_name='pools', blank=True, db_table='school_subjectpool_subjects')
    # Only meaningful (and only settable, see CurriculumPresetSerializer.validate()) on a
    # PATHWAY_CORE pool -- lets one preset hold a separate Pathway Core pool per pathway/track
    # instead of needing a whole separate preset per pathway. NULL means "not pathway-specific"
    # (every Core Compulsory/Guided Elective pool, and legacy single-pathway presets' pools).
    pathway = models.ForeignKey(Pathway, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    track = models.ForeignKey(Track, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    # Lets a single PATHWAY_CORE pool offer combinations from every pathway/track in the
    # curriculum at once, instead of needing one pool per (pathway, track) pair -- each
    # combination carries its own track, so per-student filtering keys off that (see
    # _pool_subjects_for_student in school/views/subject_views.py) rather than pathway/track
    # above, which stay unused (always NULL) for a pool built this way.
    combinations = models.ManyToManyField(
        PresetCombination, related_name='pools', blank=True, db_table='school_subjectpool_combinations',
    )

    class Meta:
        db_table = 'school_subjectpool'
        # NULL <> NULL under Postgres, so this alone doesn't stop two CORE_COMPULSORY pools
        # (both pathway=NULL, track=NULL) from coexisting -- CurriculumPresetSerializer.validate()
        # enforces that half of it.
        unique_together = ('preset', 'pool_type', 'pathway', 'track')

    def __str__(self):
        return f"{self.preset.name} - {self.get_pool_type_display()}"


class AcademicYear(models.Model):
    """
    Handles the transition between years (e.g., 2026 to 2027).
    When an admin archives a year, all results under it become read-only.
    """
    year = models.CharField(max_length=10, unique=True, help_text="e.g., 2026")
    is_active = models.BooleanField(default=True, help_text="Is this the current academic year?")
    is_archived = models.BooleanField(default=False)

    class Meta:
        db_table = 'school_academicyear'

    def __str__(self):
        return self.year


class ExamTerm(models.Model):
    """Groups exams into terms (e.g., Term 1, Term 2)"""
    name = models.CharField(max_length=50, help_text="e.g., Term 1")
    academic_year = models.ForeignKey(AcademicYear, on_delete=models.CASCADE, related_name='terms')
    start_date = models.DateField()
    end_date = models.DateField()

    is_active = models.BooleanField(default=False)
    results_finalized = models.BooleanField(
        default=False,
        help_text="Admin-confirmed: this term's results are done being recorded. Purely "
                   "informational — does not block result regeneration. Used as the promotion "
                   "gate for plain (non-nationally-exam-gated) grade transitions — see "
                   "results_finalized_for_year in school/views/promotion_views.py."
    )
    results_finalized_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'school_examterm'

    def __str__(self):
        return f"{self.name} - {self.academic_year.year}"


class TimeSlot(models.Model):
    """
    The physical grid of the week.
    Handles both Academic lessons and Global events (Preps, Breaks, Assembly).
    """
    DAY_CHOICES = [
        ('Monday', 'Monday'), ('Tuesday', 'Tuesday'),
        ('Wednesday', 'Wednesday'), ('Thursday', 'Thursday'),
        ('Friday', 'Friday'), ('Saturday', 'Saturday'), ('Sunday', 'Sunday')
    ]

    day = models.CharField(max_length=15, choices=DAY_CHOICES)
    start_time = models.TimeField()
    end_time = models.TimeField()

    # THE KENYAN GRID: If True, this is a break, assembly, or prep. No teacher can be scheduled here.
    is_global = models.BooleanField(default=False)
    global_label = models.CharField(max_length=100, null=True, blank=True,
                                    help_text="e.g., 'Morning Prep', 'Lunch Break'")

    # --- NEW: REMEDIAL FLAG ---
    # Marks this as an early morning (6:30am) or evening (7:00pm) block
    is_remedial = models.BooleanField(default=False)

    class Meta:
        db_table = 'school_timeslot'
        ordering = ['day', 'start_time']
        unique_together = ('day', 'start_time', 'end_time')

    def __str__(self):
        if self.is_global:
            return f"{self.day} {self.start_time.strftime('%H:%M')} - {self.global_label}"
        return f"{self.day} {self.start_time.strftime('%H:%M')} - {self.end_time.strftime('%H:%M')}"
