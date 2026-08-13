"""Models for the `students` app.

Student-specific business data: personal tasks, pathway selection, subject enrollment workflows.

Track B step 5: physically relocated here from
school/models/{students_model.py (file deleted entirely),classSubjects_models.py}.
Meta.db_table is pinned to each model's original table name below so the
underlying tables never physically move -- only Django's bookkeeping of
which app owns the model.

Track B step 8: Pathway/Track/PresetCombination/Subject/AcademicYear
physically relocated to apps/academics/models.py. Their FK fields below use
app-label-qualified string references ('academics.X') instead of a Python
import -- Django resolves these through its app registry, so `students`
never needs to import `apps.academics.models` directly.

Track B step 9 (final): StudentExtra physically relocated to
apps/identity/models.py. Every `student` field below uses the same
app-label-qualified string pattern ('identity.StudentExtra').
"""
from django.db import models
from django.contrib.auth.models import User


class StudentTask(models.Model):
    """Personal to-do items a student manages for themselves (not tied to assignments)."""
    student = models.ForeignKey('identity.StudentExtra', on_delete=models.CASCADE, related_name='tasks')
    title = models.CharField(max_length=255)
    due_date = models.DateField(blank=True, null=True)
    is_done = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'school_studenttask'
        ordering = ['is_done', 'due_date', '-created_at']

    def __str__(self):
        return f"{self.title} ({self.student.get_name})"


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

    student = models.ForeignKey('identity.StudentExtra', on_delete=models.CASCADE, related_name='pathway_selections')
    pathway = models.ForeignKey('academics.Pathway', on_delete=models.CASCADE, related_name='student_selections')
    track = models.ForeignKey(
        'academics.Track', on_delete=models.SET_NULL, null=True, blank=True, related_name='student_selections',
        help_text="Required whenever the chosen Pathway has Tracks configured — see api_student_pathway_request."
    )
    preset_combination = models.ForeignKey(
        'academics.PresetCombination', on_delete=models.SET_NULL, null=True, blank=True, related_name='student_selections',
        help_text="The student's chosen pre-approved 3-subject combination for `track`, if any. "
                   "Approving a selection with this set also approves the combination's 3 subjects "
                   "as the student's elective StudentSubjectEnrollment rows — see api_decide_pathway_request."
    )
    academic_year = models.ForeignKey('academics.AcademicYear', on_delete=models.CASCADE)

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='Pending')
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'school_studentpathwayselection'
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

    student = models.ForeignKey('identity.StudentExtra', on_delete=models.CASCADE, related_name='subject_enrollments')
    subject = models.ForeignKey('academics.Subject', on_delete=models.CASCADE)
    academic_year = models.ForeignKey('academics.AcademicYear', on_delete=models.CASCADE)

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='Pending')
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'school_studentsubjectenrollment'
        # A student can only have ONE status for a specific subject in a specific year
        unique_together = ('student', 'subject', 'academic_year')

    def __str__(self):
        return f"{self.student.get_name} - {self.subject.name} ({self.status})"


NATIONAL_EXAM_CHOICES = [
    ('KPSEA', 'KPSEA'),
    ('KJSEA', 'KJSEA'),
    ('KCSE', 'KCSE'),
]
# Duplicated (not imported) from apps.academics.models.NATIONAL_EXAM_CHOICES -- .importlinter's
# no-model-import-students contract forbids `students` from importing apps.academics.models
# directly, and Django needs a real list at class-definition time for `choices=`, not a lazy
# app-label string reference like the FK fields below use. Three exam codes, unlikely to drift.


class NationalExamRecord(models.Model):
    """
    Records that a student sat one of Kenya's national exit exams (KPSEA/KJSEA/KCSE), gating
    the tier transitions Tier.exit_exam_code marks as exam-gated (apps/academics/models.py).
    `destination` is free text today (the placement school for KJSEA, or the
    university/institution for KCSE) -- see sms-orient's multi-tenancy roadmap for why this
    isn't yet a real FK to another school.
    """
    student = models.ForeignKey('identity.StudentExtra', on_delete=models.CASCADE, related_name='national_exam_records')
    exam_code = models.CharField(max_length=10, choices=NATIONAL_EXAM_CHOICES)
    academic_year = models.ForeignKey('academics.AcademicYear', on_delete=models.CASCADE)
    recorded_at = models.DateTimeField(auto_now_add=True)
    score = models.CharField(max_length=20, blank=True, help_text="Informational only — not used by any gating logic.")
    destination = models.CharField(
        max_length=255, blank=True,
        help_text="Placement school (KJSEA) or university/institution (KCSE). Blank for KPSEA."
    )
    recorded_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)

    class Meta:
        db_table = 'school_nationalexamrecord'
        unique_together = ('student', 'exam_code', 'academic_year')

    def __str__(self):
        return f"{self.student.get_name} - {self.exam_code} ({self.academic_year.year})"
