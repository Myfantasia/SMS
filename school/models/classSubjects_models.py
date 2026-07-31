from django.db import models
from django.contrib.auth.models import User
from django.core.exceptions import ValidationError

# --- KENYAN HIGH SCHOOL SUBJECTS (CBC & 8-4-4) ---
SUBJECT_CHOICES = [
    ('Mathematics', 'Mathematics'), ('English', 'English'), ('Kiswahili', 'Kiswahili'),
    ('Biology', 'Biology'), ('Chemistry', 'Chemistry'), ('Physics', 'Physics'),
    ('History & Government', 'History & Government'), ('Geography', 'Geography'),
    ('CRE', 'CRE'), ('IRE', 'IRE'), ('HRE', 'HRE'),
    ('Agriculture', 'Agriculture'), ('Business Studies', 'Business Studies'),
    ('Computer Studies', 'Computer Studies'), ('Home Science', 'Home Science'),
    ('Art & Design', 'Art & Design'), ('French', 'French'), ('German', 'German'),
    ('Music', 'Music'), ('Physical Education', 'Physical Education')
]

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
    subjects = models.ManyToManyField('Subject', related_name='preset_combinations')
    is_active = models.BooleanField(
        default=True,
        help_text="Uncheck to retire a combination (e.g. the school stopped offering it) without "
                   "deleting historical student selections that reference it."
    )

    class Meta:
        ordering = ['track', 'name']

    def display_name(self):
        if self.name:
            return self.name
        return " / ".join(self.subjects.order_by('name').values_list('name', flat=True))

    def __str__(self):
        return f"{self.display_name()} ({self.track.name})"


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

    class Meta:
        unique_together = ('curriculum', 'code')
        ordering = ['display_order', 'name']

    def __str__(self):
        return f"{self.name} ({self.curriculum.code})"


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

    def save(self, *args, **kwargs):
        if self.curriculum_id:
            self.curriculum_type = self.curriculum.code
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.name} ({self.curriculum_type})"



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


# ==========================================
# GLOBAL AUDIT LOG MODEL
# ==========================================

class SystemAuditLog(models.Model):
    """
    The immutable operational ledger.
    Tracks critical automated actions, rule changes, and deletions.
    """
    ACTION_CHOICES = [
        ('CREATE', 'Created Resource'),
        ('UPDATE', 'Modified Settings / Rules'),
        ('DELETE', 'Soft Deleted Resource'),
        ('RESTORE', 'Restored Soft Deleted Resource'),
        ('SIMULATION', 'Executed Allocation Simulation'),
        ('EXECUTION', 'Committed Live Allocation Splits'),
        ('APPROVE', 'Approved Pending Account'),
        ('REJECT', 'Rejected Pending Account'),
        ('AUTH_SUCCESS', 'Authentication Succeeded'),
        ('AUTH_FAILURE', 'Authentication Failed'),
    ]

    operator = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='audit_actions')
    action_type = models.CharField(max_length=20, choices=ACTION_CHOICES)
    module = models.CharField(max_length=100, help_text="e.g., 'SplittingEngine', 'ClassStream'")
    description = models.TextField(help_text="Detailed summary of the operational event.")
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-timestamp']

    def __str__(self):
        operator_name = self.operator.username if self.operator else "System Engine"
        return f"{self.timestamp.strftime('%Y-%m-%d %H:%M')} | {operator_name} -> {self.action_type}"


class ClassStream(models.Model):
    """
    The actual physical or logical classroom.
    Now equipped with Option B Virtual support and Soft Deletion.
    """
    name = models.CharField(max_length=50)
    grade = models.ForeignKey('GradeLevel', on_delete=models.CASCADE, related_name='streams')
    capacity = models.PositiveIntegerField(default=40)
    class_teacher = models.ForeignKey('school.TeacherExtra', on_delete=models.SET_NULL, null=True, blank=True,
                                      related_name='assigned_classes')

    # --- NEW: OPTION B VIRTUAL SWITCH ---
    is_virtual = models.BooleanField(default=False,
                                     help_text="True if this is a temporary block grouping for electives.")

    # --- NEW: SOFT DELETION FIELD ---
    is_deleted = models.BooleanField(default=False, db_index=True)

    # --- ATTACH MANAGERS ---
    objects = models.Manager()  # .all() returns everything (including ghosts)
    live = NonDeletedManager()  # .all() returns physical + virtual (excludes deleted)
    physical = PhysicalStreamManager()  # .all() returns ONLY physical classrooms (The UI Shield)

    class Meta:
        # Changed to include is_deleted, allowing you to create a new "Grade 7A" if the old one was soft-deleted
        unique_together = ('name', 'grade', 'is_deleted')

    def __str__(self):
        suffix = " (Virtual)" if self.is_virtual else (" (Deleted)" if self.is_deleted else "")
        return f"{self.grade.name} {self.name}{suffix}"

    def soft_delete(self, operator_user=None):
        """Safely removes resource from active streams without breaking database constraints."""
        self.is_deleted = True
        self.save()
        # Automatically log who deleted this classroom
        SystemAuditLog.objects.create(
            operator=operator_user,
            action_type='DELETE',
            module='ClassStream',
            description=f"Soft deleted stream: {self.grade.name} {self.name} (ID: {self.id})"
        )


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
        ordering = ['curriculum', 'name']
        unique_together = [('name', 'curriculum'), ('code', 'curriculum')]

    def __str__(self):
        return f"{self.name} ({self.curriculum.code})"


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

    def __str__(self):
        return f"{self.code} - {self.name}"


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


class SubjectQuota(models.Model):
    """
    THE DYNAMIC REFILL SYSTEM: Defines how many lessons a grade needs per subject.
    This acts as the 'Bucket' that counts down in the React frontend.
    """
    grade = models.ForeignKey(GradeLevel, on_delete=models.CASCADE, related_name='subject_quotas')
    subject = models.ForeignKey(Subject, on_delete=models.CASCADE)

    total_lessons = models.PositiveIntegerField(default=5)

    # DOUBLE LESSONS: Tells the system how many of those total lessons must be double blocks
    double_lessons_required = models.PositiveIntegerField(default=0)

    # --- NEW: REMEDIAL LESSONS ---
    # Specifies how many of the total lessons are assigned to the 6:30am/7:00pm slots
    remedial_lessons_required = models.PositiveIntegerField(default=1)

    class Meta:
        unique_together = ('grade', 'subject')

    def __str__(self):
        return f"{self.grade.name} - {self.subject.name} ({self.total_lessons} lessons)"


class QuotaDefaultRule(models.Model):
    """
    Admin-configurable fallback used by 'Auto-Fill Subject Quotas' (api_auto_generate_quotas)
    whenever a subject has no SubjectCurriculumProfile override for the grade being seeded.
    Same "DB-first, hardcoded-ladder-as-last-resort" pattern GradingRule already uses for
    exam grading — a school with zero rows here gets identical behavior to before this model
    existed; adding/editing a row lets an admin adjust or extend the department/grade-band
    defaults (e.g. for a newly added department) without a code change.
    """
    GRADE_BAND_CHOICES = [
        ('LOWER_PRIMARY', 'Lower Primary (Grades 1-3)'),
        ('UPPER_PRIMARY', 'Upper Primary (Grades 4-6)'),
        ('JUNIOR_SECONDARY', 'Junior Secondary (Grades 7-9)'),
        ('SENIOR_SCHOOL', 'Senior School (Grade 10+)'),
    ]

    department = models.ForeignKey(
        Department, on_delete=models.CASCADE, null=True, blank=True, related_name='quota_default_rules',
        help_text="Leave blank to apply to any department — used for the blocked/synchronized-"
                   "elective defaults, which don't vary by department. Set a specific department "
                   "for a standalone-subject default."
    )
    grade_band = models.CharField(max_length=20, choices=GRADE_BAND_CHOICES)
    applies_when_blocked = models.BooleanField(
        default=False,
        help_text="Check for the figures that apply when the subject sits in a synchronized "
                   "SubjectBlock for this grade (e.g. Technical/elective option blocks) — leave "
                   "unchecked for the standalone-subject figures."
    )
    total_lessons = models.PositiveIntegerField(default=0)
    double_lessons_required = models.PositiveIntegerField(default=0)
    remedial_lessons_required = models.PositiveIntegerField(default=1)

    class Meta:
        unique_together = ('department', 'grade_band', 'applies_when_blocked')
        ordering = ['department', 'grade_band']

    def __str__(self):
        blocked = " (blocked)" if self.applies_when_blocked else ""
        dept = self.department.name if self.department else "Any Department"
        return f"{dept} / {self.get_grade_band_display()}{blocked} — {self.total_lessons} lessons"


# ==========================================
# NEW: SUBJECT ALLOCATION ENGINE
# ==========================================

class SubjectBlock(models.Model):
    """
    Groups subjects together (e.g., 'Grade 10 Humanities: CRE, IRE, GEO')
    so the algorithm knows they are taught at the exact same time.

    UPGRADED: Linked to AcademicYear and ExamTerm so that elective group
    structures can change term-over-term without corrupting historical timetables.
    """
    name = models.CharField(
        max_length=100,
        help_text="e.g., G10-Humanities-Block or Form 3 Technical Electives"
    )

    grade_level = models.ForeignKey(
        'GradeLevel',
        on_delete=models.CASCADE,
        related_name='subject_blocks'
    )

    # --- NEW: TIMELINE CONTEXT ANCHORS ---
    # We allow null=True temporarily so existing database rows migrate smoothly
    # without requiring a default fallback value.
    academic_year = models.ForeignKey(
        'AcademicYear',
        on_delete=models.CASCADE,
        related_name='subject_blocks',
        null=True,
        blank=True
    )

    term = models.ForeignKey(
        'ExamTerm',
        on_delete=models.CASCADE,
        related_name='subject_blocks',
        null=True,
        blank=True
    )

    # Many-to-many: a subject can belong to a different block per grade, and
    # blocks are rebuilt every term (see api_rollover_term_data), so the same
    # subject legitimately needs independent, simultaneous block membership
    # across grade/term contexts instead of a single global slot.
    subjects = models.ManyToManyField('Subject', related_name='blocks', blank=True)

    PERIOD_STRUCTURE_CHOICES = [
        ('ALL_DOUBLE', 'All Double Periods'),
        ('ALL_SINGLE', 'All Single Periods'),
        ('MIXED', 'Mixed (Each Subject Uses Its Own Quota Split)'),
    ]
    period_structure = models.CharField(
        max_length=10,
        choices=PERIOD_STRUCTURE_CHOICES,
        default='MIXED',
        help_text="Governs how the quota/timetable engines split this block's lessons between "
                   "single and double periods — e.g. Technical option blocks are usually "
                   "ALL_DOUBLE (practical sessions), while a Humanities block is usually ALL_SINGLE."
    )

    # --- NEW: METADATA FOR AUDITING & THE REACT SIDEBAR ---
    created_at = models.DateTimeField(auto_now_add=True, null=True)
    updated_at = models.DateTimeField(auto_now=True, null=True)

    class Meta:
        # Prevents creating identical block names within the same term and grade
        unique_together = ('name', 'grade_level', 'academic_year', 'term')

    def __str__(self):
        term_label = f" - {self.term.name}" if self.term else ""
        return f"{self.name} ({self.grade_level.name}{term_label})"


class SubjectAllocation(models.Model):
    """
    The Master Link: Assigns a specific teacher to a specific subject in a specific class.
    """
    classroom = models.ForeignKey(ClassStream, on_delete=models.CASCADE, related_name='allocations')
    subject = models.ForeignKey(Subject, on_delete=models.CASCADE, related_name='class_allocations')
    teacher = models.ForeignKey('school.TeacherExtra', on_delete=models.CASCADE, related_name='subject_allocations')

    academic_year = models.ForeignKey('AcademicYear', on_delete=models.CASCADE)
    term = models.ForeignKey('ExamTerm', on_delete=models.CASCADE)

    is_active = models.BooleanField(default=True)

    class Meta:
        # Strict rule: You cannot assign two different active teachers
        # to the exact same subject in the exact same class for the same term.
        unique_together = ('classroom', 'subject', 'academic_year', 'term')

    def __str__(self):
        return f"{self.classroom.name} | {self.subject.name} - {self.teacher.get_name}"


class AllocationPublishState(models.Model):
    """
    Draft/Published status for one class stream's teacher allocations in one term/year. A row
    only exists once a class has been published at least once — its absence means the class is
    still in draft (freely editable), matching the school's existing behavior before this
    model was introduced.

    While published, every allocation-mutating path (manual Matrix save, Auto-Allocate,
    Bulk Allocate, Rollover, Clear Grid) must refuse to touch this (classroom, term, year) scope
    until it's explicitly unpublished — see school.utils.get_published_classroom_ids /
    publish_allocation. This is deliberately separate from the Timetable's own publish state:
    the user asked specifically for the allocation contracts (who teaches what) to lock
    independently of the generated lesson grid.
    """
    classroom = models.ForeignKey(ClassStream, on_delete=models.CASCADE, related_name='publish_states')
    term = models.ForeignKey('ExamTerm', on_delete=models.CASCADE)
    academic_year = models.ForeignKey('AcademicYear', on_delete=models.CASCADE)
    is_published = models.BooleanField(default=False)
    published_at = models.DateTimeField(null=True, blank=True)
    published_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True,
                                      related_name='published_allocations')

    class Meta:
        unique_together = ('classroom', 'term', 'academic_year')

    def __str__(self):
        state = 'Published' if self.is_published else 'Draft'
        return f"{self.classroom.name} | {self.term} {self.academic_year} - {state}"


# Add this to your models.py

class SubjectSelectionRule(models.Model):
    """
    DYNAMIC RULE CHECKER:
    Allows admins to change subject limits per grade without touching code.
    """
    grade = models.OneToOneField(GradeLevel, on_delete=models.CASCADE, related_name='selection_rule')
    min_subjects = models.PositiveIntegerField(default=7, help_text="Minimum subjects a student must take")
    max_subjects = models.PositiveIntegerField(default=8, help_text="Maximum subjects a student can take")

    def __str__(self):
        return f"{self.grade.name} Rules ({self.min_subjects}-{self.max_subjects} subjects)"


class StudentPathwaySelection(models.Model):
    """
    THE PATHWAY LIFECYCLE TRACKER: mirrors StudentSubjectEnrollment's Pending/Approved/
    Rejected shape, but for a student's one SSS Pathway choice rather than many subjects —
    hence unique_together on (student, academic_year) instead of also including the pathway.
    Approved by either an admin (curriculum-wide) or the student's assigned Class Teacher
    (see rbac.is_class_teacher_of_student), unlike subject approval which is admin-only.
    """
    STATUS_CHOICES = [
        ('Pending', 'Pending Approval'),
        ('Approved', 'Approved & Locked'),
        ('Rejected', 'Rejected'),
    ]

    student = models.ForeignKey('StudentExtra', on_delete=models.CASCADE, related_name='pathway_selections')
    pathway = models.ForeignKey(Pathway, on_delete=models.CASCADE, related_name='student_selections')
    track = models.ForeignKey(
        'Track', on_delete=models.SET_NULL, null=True, blank=True, related_name='student_selections',
        help_text="Required whenever the chosen Pathway has Tracks configured — see api_student_pathway_request."
    )
    preset_combination = models.ForeignKey(
        'PresetCombination', on_delete=models.SET_NULL, null=True, blank=True, related_name='student_selections',
        help_text="The student's chosen pre-approved 3-subject combination for `track`, if any. "
                   "Approving a selection with this set also approves the combination's 3 subjects "
                   "as the student's elective StudentSubjectEnrollment rows — see api_decide_pathway_request."
    )
    academic_year = models.ForeignKey('AcademicYear', on_delete=models.CASCADE)

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='Pending')
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('student', 'academic_year')

    def __str__(self):
        return f"{self.student.get_name} -> {self.pathway.name} ({self.status})"


class StudentSubjectEnrollment(models.Model):
    """
    THE LIFECYCLE TRACKER:
    Replaces the simple ManyToMany field to track the *status* and *year* of the subject choice.
    """
    STATUS_CHOICES = [
        ('Pending', 'Pending Admin Approval'),
        ('Approved', 'Approved & Locked'),
        ('Rejected', 'Rejected by Admin')
    ]

    student = models.ForeignKey('StudentExtra', on_delete=models.CASCADE, related_name='subject_enrollments')
    subject = models.ForeignKey(Subject, on_delete=models.CASCADE)
    academic_year = models.ForeignKey('AcademicYear', on_delete=models.CASCADE)

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='Pending')
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        # A student can only have ONE status for a specific subject in a specific year
        unique_together = ('student', 'subject', 'academic_year')

    def __str__(self):
        return f"{self.student.get_name} - {self.subject.name} ({self.status})"


# Add this to your models.py

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
        # Prevent duplicate exclusion rules
        unique_together = ('grade', 'subject_a', 'subject_b')

    def __str__(self):
        verb = 'requires' if self.rule_type == 'REQUIRES' else 'excludes'
        return f"{self.grade.name}: {self.subject_a.name} {verb} {self.subject_b.name}"


class SubjectSplittingRule(models.Model):
    """
    THE SPLITTING ENGINE: Operational policies configured by the admin
    that govern teacher allocations and dynamic class pooling.
    """
    ALLOCATION_MODES = [
        ('Split_Balance', 'Auto-Split & Balance Streams'),
        ('Co_Teaching', 'Co-Teaching (Single Massive Group)'),
        ('Strict_Cap', 'Strict Enrollment Cap'),
    ]

    grade = models.ForeignKey('GradeLevel', on_delete=models.CASCADE, related_name='splitting_rules')
    subject = models.ForeignKey('Subject', on_delete=models.CASCADE, related_name='splitting_rules')

    max_class_size = models.PositiveIntegerField(default=45, help_text="Max students per teacher before a split.")
    allocation_mode = models.CharField(max_length=20, choices=ALLOCATION_MODES, default='Split_Balance')

    # Audit tracking for rule changes
    updated_at = models.DateTimeField(auto_now=True)
    last_modified_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)

    class Meta:
        unique_together = ('grade', 'subject')

    def clean(self):
        # Database-level validation to prevent system-breaking settings
        if self.max_class_size < 5:
            raise ValidationError("Operational error: Class size thresholds cannot drop below 5 students.")

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.grade.name} - {self.subject.name} Policy (Max: {self.max_class_size})"


class CurriculumPreset(models.Model):
    """
    GLOBAL CURRICULUM TEMPLATES:
    Stores dynamic quick-presets (e.g., 'Standard 8-4-4', 'CBC Junior Sec')
    so administrators can populate the frontend sidebar dynamically without code changes.
    """
    name = models.CharField(max_length=100, unique=True, help_text="e.g., Standard 8-4-4, CBC Junior Sec.")
    min_subjects = models.PositiveIntegerField(default=7, help_text="Default minimum subjects for this preset.")
    max_subjects = models.PositiveIntegerField(default=8, help_text="Default maximum subjects for this preset.")

    # Optional: helps sort them logically in the UI
    display_order = models.PositiveIntegerField(default=0)

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
        ordering = ['display_order', 'name']

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
    subjects = models.ManyToManyField(Subject, related_name='pools', blank=True)

    class Meta:
        unique_together = ('preset', 'pool_type')

    def __str__(self):
        return f"{self.preset.name} - {self.get_pool_type_display()}"


# ==========================================
# GLOBAL ALLOCATION POLICY ENGINE
# ==========================================

class GlobalAllocationPolicy(models.Model):
    """
    SINGLETON MODEL: Controls the mechanical boundaries for teacher assignment algorithms.
    Allows admins to change hardcoded limits without altering the backend python code.
    """
    ENFORCEMENT_CHOICES = [
        ('STRICT', 'Strict Hard Blocks (Prevent Saves)'),
        ('SOFT', 'Soft Enforcement (Allow Saves with Warnings)'),
    ]

    max_subjects_per_class = models.PositiveIntegerField(default=2)
    max_classes_per_subject = models.PositiveIntegerField(default=2)

    # --- NEW: THE CONSOLIDATION MAGNET CONTROL ---
    min_classes_per_subject = models.PositiveIntegerField(
        default=2,
        help_text="Target minimum streams a teacher should handle for a subject to optimize prep time."
    )
    enforce_prep_consolidation = models.BooleanField(
        default=True,
        help_text="If True, the auto-drafter will magnetically prioritize teachers sitting below the minimum stream count."
    )

    allow_cross_grade_teaching = models.BooleanField(default=False)

    # --- NEW: WORKLOAD & PREPARATION CAPS ---
    max_weekly_lessons = models.PositiveIntegerField(default=28, help_text="Total teaching periods allowed per week.")
    max_total_class_groups = models.PositiveIntegerField(default=6,
                                                         help_text="Max distinct physical/virtual groups a teacher can manage.")

    # --- NEW: TIMETABLE-AWARE CAPACITY ---
    timetable_capacity_buffer_percent = models.PositiveIntegerField(
        default=10,
        help_text="Safety margin subtracted from a teacher's real free-slot count (total time slots "
                   "minus their structural blackouts) before the allocation engine will assign them "
                   "more lessons. Fatigue rules (consecutive-period caps, heavy-day thresholds, subject "
                   "spacing) aren't modeled here, so this buffer accounts for the usable capacity they "
                   "eat into that a raw slot count alone wouldn't show."
    )

    enforcement_mode = models.CharField(max_length=10, choices=ENFORCEMENT_CHOICES, default='STRICT')

    def save(self, *args, **kwargs):
        self.pk = 1  # Forces this table to only ever have ONE row (a Singleton)
        super(GlobalAllocationPolicy, self).save(*args, **kwargs)

    @classmethod
    def load(cls):
        """Helper method to easily grab the active policy or create a default one"""
        obj, created = cls.objects.get_or_create(pk=1)
        return obj

    def __str__(self):
        return f"Global Allocation Policy ({self.enforcement_mode})"