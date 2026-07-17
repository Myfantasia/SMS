from django.db import models
from school.models.classSubjects_models import ClassStream, Subject
from school.models.models import (
    TeacherExtra,
    StudentExtra,
    ExamTerm
)
from school.validators import safe_document_validator


# ==========================================
# 2. THE ASSIGNMENT & QUIZ CONTAINER
# ==========================================

class Assignment(models.Model):
    STATUS_CHOICES = [
        ('Draft', 'Draft - Hidden from students'),
        ('Published', 'Published - Visible and Active'),
        ('Closed', 'Closed - Past due date, no new submissions')
    ]

    TYPE_CHOICES = [
        ('Holiday', 'Holiday Assignment'),
        ('In-Term', 'In-Term / Weekend Project')
    ]

    title = models.CharField(max_length=255)
    assignment_type = models.CharField(max_length=20, choices=TYPE_CHOICES, default='Holiday')

    # Core Relationships
    teacher = models.ForeignKey(TeacherExtra, on_delete=models.CASCADE, related_name='assignments_created')
    subject = models.ForeignKey(Subject, on_delete=models.CASCADE)
    class_stream = models.ForeignKey(ClassStream, on_delete=models.CASCADE, related_name='assignments')
    term = models.ForeignKey(ExamTerm, on_delete=models.CASCADE, null=True, blank=True)

    # Curriculum Context
    curriculum_type = models.CharField(max_length=10, default='CBC')
    strand_name = models.CharField(max_length=255, null=True, blank=True, help_text="e.g., 'Numbers', 'Measurement'")

    # --- NEW: File Upload Feature ---
    teacher_attachment = models.FileField(
        upload_to='assignments/teacher_files/',
        null=True,
        blank=True,
        validators=[safe_document_validator],
        help_text="Optional master PDF/Doc for the assignment"
    )

    # --- OPTION 1: THE THREE-STAGE LIFECYCLE ---
    publish_date = models.DateTimeField(null=True, blank=True, help_text="When students can first see and open this.")
    due_date = models.DateTimeField(null=True, blank=True, help_text="The official deadline. Submissions after this are marked LATE.")
    cutoff_date = models.DateTimeField(null=True, blank=True, help_text="The absolute lockout. No submissions accepted after this minute.")

    # --- OPTION 2: TIMED QUIZ MODE ---
    is_quiz = models.BooleanField(default=False, help_text="If True, turns this into a strictly timed assessment.")
    duration_minutes = models.PositiveIntegerField(null=True, blank=True, help_text="Time limit in minutes (e.g., 45)")

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='Draft')
    total_max_score = models.DecimalField(max_digits=5, decimal_places=2, default=0.00, help_text="Auto-tallied from questions")
    created_at = models.DateTimeField(auto_now_add=True)

    # --- SUBMISSION RULES ---
    allow_resubmission = models.BooleanField(default=False, help_text="If True, students may resubmit after their first submission.")
    max_attempts = models.PositiveIntegerField(default=1, help_text="Maximum number of submit attempts allowed per student.")
    late_penalty_percent = models.DecimalField(max_digits=5, decimal_places=2, default=0.00, help_text="Flat percentage deducted from the awarded score when a submission is late.")
    is_group_assignment = models.BooleanField(default=False, help_text="If True, one member's submission is shared across the whole group.")

    # --- TARGETING & VISIBILITY ---
    assigned_students = models.ManyToManyField(
        StudentExtra, blank=True, related_name='specific_assignments',
        help_text="If set, only these students are assigned this work. If empty, the whole class_stream (and additional_class_streams) is targeted."
    )
    additional_class_streams = models.ManyToManyField(
        ClassStream, blank=True, related_name='shared_assignments',
        help_text="Extra class streams (beyond the primary class_stream) that also receive this assignment."
    )

    # --- RICHER CONTENT ---
    reference_links = models.JSONField(default=list, blank=True, help_text="List of {label, url} reference links for students.")
    reference_notes = models.TextField(null=True, blank=True, help_text="Free-text reference material / instructions.")

    def __str__(self):
        return f"{self.title} - {self.class_stream}"


class AssignmentGroup(models.Model):
    """A named group of students sharing one submission for a group assignment."""
    assignment = models.ForeignKey(Assignment, on_delete=models.CASCADE, related_name='groups')
    name = models.CharField(max_length=255)
    members = models.ManyToManyField(StudentExtra, blank=True, related_name='assignment_groups')

    def __str__(self):
        return f"{self.name} ({self.assignment.title})"


class AssignmentAttachment(models.Model):
    """Supplementary files beyond the single master teacher_attachment on Assignment."""
    assignment = models.ForeignKey(Assignment, on_delete=models.CASCADE, related_name='attachments')
    file = models.FileField(upload_to='assignments/teacher_files/extra/', validators=[safe_document_validator])
    label = models.CharField(max_length=255, blank=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.label or self.file.name


# ==========================================
# 3. HYBRID QUESTION ENGINE
# ==========================================

class Question(models.Model):
    QUESTION_TYPES = [
        ('MCQ', 'Multiple Choice - Auto Graded'),
        ('CHECKBOX', 'Checkbox - Multi-Select Auto Graded'),
        ('SHORT_ANSWER', 'Short Answer - Exact Match Auto Graded'),
        ('ESSAY', 'Essay/Long Text - Manual Grade'),
        ('FILE_UPLOAD', 'File/Image Upload - Manual Grade')
    ]

    assignment = models.ForeignKey(Assignment, on_delete=models.CASCADE, related_name='questions')
    question_text = models.TextField()
    question_type = models.CharField(max_length=20, choices=QUESTION_TYPES)

    is_auto_graded = models.BooleanField(default=False)
    max_score = models.DecimalField(max_digits=5, decimal_places=2, default=1.00)

    required_answers = models.PositiveIntegerField(default=1, null=True, blank=True,
                                                   help_text="Used for CHECKBOX questions")
    exact_match_answer = models.CharField(max_length=255, null=True, blank=True)

    def __str__(self):
        return f"{self.assignment.title} - Q: {self.question_text[:30]}..."


class QuestionOption(models.Model):
    question = models.ForeignKey(Question, on_delete=models.CASCADE, related_name='options')
    option_text = models.CharField(max_length=255)
    is_correct = models.BooleanField(default=False)

    def __str__(self):
        return f"{self.option_text} (Correct: {self.is_correct})"


class RubricCriterion(models.Model):
    """Optional per-question grading rubric. When present, a question's awarded_score is the sum of its criterion scores."""
    question = models.ForeignKey(Question, on_delete=models.CASCADE, related_name='rubric_criteria')
    criterion_text = models.CharField(max_length=255)
    max_points = models.DecimalField(max_digits=5, decimal_places=2, default=1.00)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['order', 'id']

    def __str__(self):
        return f"{self.criterion_text} ({self.max_points} pts)"


# ==========================================
# 4. STUDENT SUBMISSIONS & ANSWERS
# ==========================================

class StudentSubmission(models.Model):
    GRADING_STATUS = [
        ('Pending', 'Pending - Auto-marked, waiting for manual review'),
        ('Graded', 'Graded (Draft) - Hidden from student'),  # <-- Updated label for clarity
        ('Published', 'Published - Grades Released to Student'),
        ('Returned', 'Returned for Revision')
    ]

    assignment = models.ForeignKey(Assignment, on_delete=models.CASCADE, related_name='submissions')
    student = models.ForeignKey(StudentExtra, on_delete=models.CASCADE, related_name='assignment_submissions')

    # --- TRACKING TIME EXPLICITLY ---
    started_at = models.DateTimeField(null=True, blank=True, help_text="Crucial for calculating Quiz duration.")
    submitted_at = models.DateTimeField(null=True, blank=True)

    # Automatically flags if submitted between due_date and cutoff_date
    is_late = models.BooleanField(default=False)
    attempt_number = models.PositiveIntegerField(default=1, help_text="Which submit attempt this is, for max_attempts enforcement.")

    # --- NEW: File Upload Feature ---
    student_attachment = models.FileField(
        upload_to='assignments/student_files/',
        null=True,
        blank=True,
        validators=[safe_document_validator],
        help_text="Optional PDF/Image uploaded by the student"
    )

    teacher_returned_file = models.FileField(
        upload_to='assignments/returned_files/',
        null=True,
        blank=True,
        validators=[safe_document_validator],
        help_text="Optional annotated file sent back to the student"
    )

    grading_status = models.CharField(max_length=20, choices=GRADING_STATUS, default='Pending')
    total_awarded_score = models.DecimalField(max_digits=5, decimal_places=2, default=0.00)
    overall_feedback = models.TextField(null=True, blank=True)

    class Meta:
        unique_together = ('assignment', 'student')

    def __str__(self):
        return f"{self.student.get_name} -> {self.assignment.title}"


class StudentAnswer(models.Model):
    submission = models.ForeignKey(StudentSubmission, on_delete=models.CASCADE, related_name='answers')
    question = models.ForeignKey(Question, on_delete=models.CASCADE)

    text_answer = models.TextField(null=True, blank=True)
    selected_options = models.ManyToManyField(QuestionOption, blank=True)
    uploaded_file = models.FileField(
        upload_to='assignment_submissions/',
        null=True,
        blank=True,
        validators=[safe_document_validator]
    )

    awarded_score = models.DecimalField(max_digits=5, decimal_places=2, default=0.00)
    teacher_comment = models.CharField(max_length=255, null=True, blank=True)

    teacher_corrected_text = models.TextField(null=True, blank=True)

    def __str__(self):
        return f"Answer by {self.submission.student.get_name} for Q: {self.question.id}"


class CriterionScore(models.Model):
    """Per-criterion score for a graded answer, when the question has a rubric."""
    answer = models.ForeignKey(StudentAnswer, on_delete=models.CASCADE, related_name='criterion_scores')
    criterion = models.ForeignKey(RubricCriterion, on_delete=models.CASCADE, related_name='scores')
    score = models.DecimalField(max_digits=5, decimal_places=2, default=0.00)

    class Meta:
        unique_together = ('answer', 'criterion')

    def __str__(self):
        return f"{self.criterion.criterion_text}: {self.score}"
