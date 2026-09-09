"""Models for the `exams` app.

Exam events, results entry, grading rules, publish workflow.

Track B step 7: ExamEvent/GradingRule/ExamResult/StudentReportSummary/
ClassExamStatus physically relocated here from school/models/models.py via a
state-only SeparateDatabaseAndState migration -- every Meta.db_table below
pins the original `school_<lowercase modelname>` table name so the physical
tables never moved.

Track B step 8: ExamTerm/Subject/ClassStream physically relocated to
apps/academics/models.py. Their FK fields below use app-label-qualified
string references ('academics.X') instead of a Python import -- Django
resolves these through its app registry, so `exams` never needs to import
`apps.academics.models` directly.

Track B step 9 (final): StudentExtra/TeacherExtra physically relocated to
apps/identity/models.py. Their FK fields below use the same app-label-
qualified string pattern ('identity.X').
"""
from django.db import models
from django.contrib.auth.models import User
from django.core.validators import MinValueValidator


class ExamEvent(models.Model):
    """The actual assessment (e.g., CAT 1, End of Term)"""
    EXAM_TYPES = (
        ('CAT', 'Continuous Assessment Test'),
        ('MAIN', 'Main/End of Term Exam'),
    )
    name = models.CharField(max_length=100, help_text="e.g., Term 1 CAT 1")
    exam_type = models.CharField(max_length=10, choices=EXAM_TYPES, default='CAT', db_index=True)
    term = models.ForeignKey('academics.ExamTerm', on_delete=models.CASCADE, related_name='exams')

    # Weighting: e.g., if CAT 1 is out of 30, total_marks = 30.
    total_marks = models.IntegerField(default=100)

    # The Publishing Pipeline Status
    PUBLISH_STATUS = [
        ('Draft', 'Draft - Teachers entering marks'),
        ('Submitted', 'Submitted - Waiting Admin Approval'),
        ('Published', 'Published - Visible to Students/Parents')
    ]
    status = models.CharField(max_length=20, choices=PUBLISH_STATUS, default='Draft', db_index=True)

    published_at = models.DateTimeField(null=True, blank=True, help_text="Timestamp of when the exam was published.")

    class Meta:
        db_table = 'school_examevent'

    def __str__(self):
        return f"{self.name} ({self.term.name})"


class GradingRule(models.Model):
    """
    Admin-configurable grading scale.
    Can be configured for 8-4-4 (A, B, C) or CBC (4, 3, 2, 1).
    """

    CURRICULUM_CHOICES = [
        ('CBC', 'Competency Based Curriculum (CBC)'),
        ('8-4-4', 'Standard 8-4-4 Curriculum'),
    ]

    curriculum = models.CharField(max_length=10, choices=CURRICULUM_CHOICES, default='8-4-4')
    grade_label = models.CharField(max_length=5, help_text="e.g., 'A' or 'EE'")
    min_score = models.DecimalField(max_digits=5, decimal_places=2, help_text="Minimum percentage/score")
    max_score = models.DecimalField(max_digits=5, decimal_places=2, help_text="Maximum percentage/score")
    remarks = models.CharField(max_length=100, blank=True, help_text="e.g., 'Excellent', 'Exceeding Expectation'")

    class Meta:
        db_table = 'school_gradingrule'
        ordering = ['-min_score']

    def __str__(self):
        return f"{self.grade_label} ({self.min_score} - {self.max_score} | {self.curriculum})"


class ExamResult(models.Model):
    """The individual score a student gets in a specific subject for a specific exam."""
    exam = models.ForeignKey(ExamEvent, on_delete=models.CASCADE, related_name='results')
    student = models.ForeignKey('identity.StudentExtra', on_delete=models.CASCADE, related_name='exam_results')
    subject = models.ForeignKey('academics.Subject', on_delete=models.CASCADE)

    # NEW: Tracks exactly who entered this mark and remark
    teacher = models.ForeignKey('identity.TeacherExtra', on_delete=models.SET_NULL, null=True, blank=True)

    # The actual score. For CBC, a teacher might enter 1, 2, 3, or 4. For 8-4-4, up to 100.
    marks_obtained = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        validators=[MinValueValidator(0)]
    )

    # Overrides or specific remarks for this student's performance
    teacher_remarks = models.CharField(max_length=255, null=True, blank=True)

    class Meta:
        db_table = 'school_examresult'
        # Prevent double-entry: A student can only have ONE score per subject per exam
        unique_together = ('exam', 'student', 'subject')
        indexes = [models.Index(fields=['exam', 'subject'], name='examresult_exam_subject_idx')]

    def __str__(self):
        return f"{self.student.get_name} - {self.subject.name} - {self.marks_obtained}"


class StudentReportSummary(models.Model):
    """
    Stores the manual overall remarks for a student's specific exam.
    """
    student = models.ForeignKey('identity.StudentExtra', on_delete=models.CASCADE, related_name='report_summaries')
    exam = models.ForeignKey(ExamEvent, on_delete=models.CASCADE, related_name='student_summaries')

    class_teacher_remark = models.TextField(blank=True, null=True, help_text="Manual remark from the class teacher")
    principal_remark = models.TextField(blank=True, null=True, help_text="Manual remark from the principal")

    class Meta:
        db_table = 'school_studentreportsummary'
        # A student can only have ONE overall summary per exam event
        unique_together = ('student', 'exam')

    def __str__(self):
        return f"Summary for {self.student.get_name} - {self.exam.name}"


class ClassExamStatus(models.Model):
    """
    Tracks whether a specific class stream has had its results published for a specific exam.
    This allows staggered, class-by-class publishing.
    """
    exam = models.ForeignKey(ExamEvent, on_delete=models.CASCADE, related_name='class_publish_statuses')
    class_stream = models.ForeignKey('academics.ClassStream', on_delete=models.CASCADE, related_name='exam_publish_statuses')

    # Same choices as ExamEvent
    status = models.CharField(max_length=20, choices=ExamEvent.PUBLISH_STATUS, default='Draft', db_index=True)

    published_at = models.DateTimeField(null=True, blank=True)
    published_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)

    class Meta:
        db_table = 'school_classexamstatus'
        # A class can only have ONE publish status per exam
        unique_together = ('exam', 'class_stream')

    def __str__(self):
        return f"{self.class_stream} - {self.exam.name} ({self.status})"
