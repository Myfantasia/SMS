"""Models for the `allocations` app.

Subject-to-teacher-to-class allocation engine: quotas, blocks, contracts, splitting rules, global policy.

Track B step 6: physically relocated here from
school/models/classSubjects_models.py (which keeps its other ~20 models).
Meta.db_table is pinned to each model's original table name below so the
underlying tables never physically move -- only Django's bookkeeping of
which app owns the model. `SubjectBlock.subjects`'s auto-generated M2M
join-table name is pinned via `db_table=` on the field itself for the same
reason (see the Track B step 4 note on `Assignment`'s M2M fields).

Track B step 8: GradeLevel/Subject/Department/ClassStream/AcademicYear/
ExamTerm physically relocated to apps/academics/models.py. Their FK/M2M
fields below use app-label-qualified string references ('academics.X')
instead of a Python import -- Django resolves these through its app
registry, so `allocations` never needs to import `apps.academics.models`
directly, keeping the "models.py is private, services.py is public"
import-linter contract intact without needing any exception for these.

Track B step 9 (final): TeacherExtra physically relocated to
apps/identity/models.py. `SubjectAllocation.teacher` below uses the same
app-label-qualified string pattern ('identity.TeacherExtra').
"""
from django.contrib.auth.models import User
from django.core.exceptions import ValidationError
from django.db import models


class SubjectQuota(models.Model):
    """
    THE DYNAMIC REFILL SYSTEM: Defines how many lessons a grade needs per subject.
    This acts as the 'Bucket' that counts down in the React frontend.
    """
    grade = models.ForeignKey('academics.GradeLevel', on_delete=models.CASCADE, related_name='subject_quotas')
    subject = models.ForeignKey('academics.Subject', on_delete=models.CASCADE)

    total_lessons = models.PositiveIntegerField(default=5)

    # DOUBLE LESSONS: Tells the system how many of those total lessons must be double blocks
    double_lessons_required = models.PositiveIntegerField(default=0)

    # --- NEW: REMEDIAL LESSONS ---
    # Specifies how many of the total lessons are assigned to the 6:30am/7:00pm slots
    remedial_lessons_required = models.PositiveIntegerField(default=1)

    class Meta:
        db_table = 'school_subjectquota'
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
        'academics.Department', on_delete=models.CASCADE, null=True, blank=True, related_name='quota_default_rules',
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
    tier = models.ForeignKey(
        'academics.Tier', on_delete=models.CASCADE, null=True, blank=True, related_name='quota_default_rules',
        help_text="Match this rule to a specific curriculum tier instead of the legacy grade_band "
                  "bucket below. Leave blank to fall back to grade_band matching (legacy behavior)."
    )
    total_lessons = models.PositiveIntegerField(default=0)
    double_lessons_required = models.PositiveIntegerField(default=0)
    remedial_lessons_required = models.PositiveIntegerField(default=1)
    trim_priority = models.PositiveSmallIntegerField(
        default=2,
        help_text="0 = protected longest (cut last) ... 3 = cut first, when Auto-Fill Subject "
                  "Quotas has to trim a grade's demand down to fit the week's available capacity."
    )

    class Meta:
        db_table = 'school_quotadefaultrule'
        unique_together = ('department', 'tier', 'grade_band', 'applies_when_blocked')
        ordering = ['department', 'grade_band']

    def __str__(self):
        blocked = " (blocked)" if self.applies_when_blocked else ""
        dept = self.department.name if self.department else "Any Department"
        return f"{dept} / {self.get_grade_band_display()}{blocked} — {self.total_lessons} lessons"


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
        'academics.GradeLevel',
        on_delete=models.CASCADE,
        related_name='subject_blocks'
    )

    # --- NEW: TIMELINE CONTEXT ANCHORS ---
    # We allow null=True temporarily so existing database rows migrate smoothly
    # without requiring a default fallback value.
    academic_year = models.ForeignKey(
        'academics.AcademicYear',
        on_delete=models.CASCADE,
        related_name='subject_blocks',
        null=True,
        blank=True
    )

    term = models.ForeignKey(
        'academics.ExamTerm',
        on_delete=models.CASCADE,
        related_name='subject_blocks',
        null=True,
        blank=True
    )

    # Many-to-many: a subject can belong to a different block per grade, and
    # blocks are rebuilt every term (see api_rollover_term_data), so the same
    # subject legitimately needs independent, simultaneous block membership
    # across grade/term contexts instead of a single global slot.
    subjects = models.ManyToManyField(
        'academics.Subject', related_name='blocks', blank=True,
        db_table='school_subjectblock_subjects',
    )

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
        db_table = 'school_subjectblock'
        # Prevents creating identical block names within the same term and grade
        unique_together = ('name', 'grade_level', 'academic_year', 'term')

    def __str__(self):
        term_label = f" - {self.term.name}" if self.term else ""
        return f"{self.name} ({self.grade_level.name}{term_label})"


class SubjectAllocation(models.Model):
    """
    The Master Link: Assigns a specific teacher to a specific subject in a specific class.
    """
    classroom = models.ForeignKey('academics.ClassStream', on_delete=models.CASCADE, related_name='allocations')
    subject = models.ForeignKey('academics.Subject', on_delete=models.CASCADE, related_name='class_allocations')
    teacher = models.ForeignKey('identity.TeacherExtra', on_delete=models.CASCADE, related_name='subject_allocations')

    academic_year = models.ForeignKey('academics.AcademicYear', on_delete=models.CASCADE)
    term = models.ForeignKey('academics.ExamTerm', on_delete=models.CASCADE)

    is_active = models.BooleanField(default=True, db_index=True)

    class Meta:
        db_table = 'school_subjectallocation'
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
    classroom = models.ForeignKey('academics.ClassStream', on_delete=models.CASCADE, related_name='publish_states')
    term = models.ForeignKey('academics.ExamTerm', on_delete=models.CASCADE)
    academic_year = models.ForeignKey('academics.AcademicYear', on_delete=models.CASCADE)
    is_published = models.BooleanField(default=False, db_index=True)
    published_at = models.DateTimeField(null=True, blank=True)
    published_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True,
                                      related_name='published_allocations')

    class Meta:
        db_table = 'school_allocationpublishstate'
        unique_together = ('classroom', 'term', 'academic_year')

    def __str__(self):
        state = 'Published' if self.is_published else 'Draft'
        return f"{self.classroom.name} | {self.term} {self.academic_year} - {state}"


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

    grade = models.ForeignKey('academics.GradeLevel', on_delete=models.CASCADE, related_name='splitting_rules')
    subject = models.ForeignKey('academics.Subject', on_delete=models.CASCADE, related_name='splitting_rules')

    max_class_size = models.PositiveIntegerField(default=45, help_text="Max students per teacher before a split.")
    allocation_mode = models.CharField(max_length=20, choices=ALLOCATION_MODES, default='Split_Balance')

    # Audit tracking for rule changes
    updated_at = models.DateTimeField(auto_now=True)
    last_modified_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)

    class Meta:
        db_table = 'school_subjectsplittingrule'
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

    class Meta:
        db_table = 'school_globalallocationpolicy'

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
