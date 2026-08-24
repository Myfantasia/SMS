"""Models for the `assignments` app.

Assignments, quiz/question engine, submissions, rubric grading.

Track B step 4: physically relocated here from
school/models/assignments_models.py (file deleted entirely -- it had nothing
else in it). Meta.db_table is pinned on every model, and db_table is pinned
on every ManyToManyField too (their auto-generated join-table names are
derived from the owning model's app_label, so without pinning them explicitly
they'd silently rename on relocation) -- all so the underlying tables never
physically move, only Django's bookkeeping of which app owns each model.

Track B step 8: ClassStream/Subject/ExamTerm physically relocated to
apps/academics/models.py. Their FK/M2M fields below use app-label-qualified
string references ('academics.X') instead of a Python import -- Django
resolves these through its app registry, so `assignments` never needs to
import `apps.academics.models` directly.

Track B step 9 (final): TeacherExtra/StudentExtra physically relocated to
apps/identity/models.py. `teacher`/`assigned_students`/`members`/`student`
below use the same app-label-qualified string pattern ('identity.X').
"""
from django.db import models

from school.validators import safe_document_validator


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
    teacher = models.ForeignKey('identity.TeacherExtra', on_delete=models.CASCADE, related_name='assignments_created')
    subject = models.ForeignKey('academics.Subject', on_delete=models.CASCADE)
    class_stream = models.ForeignKey('academics.ClassStream', on_delete=models.CASCADE, related_name='assignments')
    term = models.ForeignKey('academics.ExamTerm', on_delete=models.CASCADE, null=True, blank=True)

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
        'identity.StudentExtra', blank=True, related_name='specific_assignments',
        db_table='school_assignment_assigned_students',
        help_text="If set, only these students are assigned this work. If empty, the whole class_stream (and additional_class_streams) is targeted."
    )
    additional_class_streams = models.ManyToManyField(
        'academics.ClassStream', blank=True, related_name='shared_assignments',
        db_table='school_assignment_additional_class_streams',
        help_text="Extra class streams (beyond the primary class_stream) that also receive this assignment."
    )

    # --- RICHER CONTENT ---
    reference_links = models.JSONField(default=list, blank=True, help_text="List of {label, url} reference links for students.")
    reference_notes = models.TextField(null=True, blank=True, help_text="Free-text reference material / instructions.")

    is_deleted = models.BooleanField(default=False, db_index=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    deleted_by = models.ForeignKey('auth.User', on_delete=models.SET_NULL, null=True, blank=True, related_name='+')

    class Meta:
        db_table = 'school_assignment'

    def __str__(self):
        return f"{self.title} - {self.class_stream}"


def _purge_assignment(assignment):
    if assignment.teacher_attachment:
        assignment.teacher_attachment.delete(save=False)
    for attachment in assignment.attachments.all():
        if attachment.file:
            attachment.file.delete(save=False)
    for submission in assignment.submissions.all():
        if submission.student_attachment:
            submission.student_attachment.delete(save=False)
        if submission.teacher_returned_file:
            submission.teacher_returned_file.delete(save=False)
        for answer in submission.answers.all():
            if answer.uploaded_file:
                answer.uploaded_file.delete(save=False)
    assignment.delete()


def _register_assignment_trash():
    from apps.core.trash import register_trash_entity, TrashEntityConfig
    register_trash_entity('assignments', TrashEntityConfig(
        model=Assignment, flag_field='is_deleted', flag_true=True, flag_false=False,
        auto_purge=True,
        label_fn=lambda a: a.title,
        purge_fn=_purge_assignment,
    ))


_register_assignment_trash()


class AssignmentGroup(models.Model):
    """A named group of students sharing one submission for a group assignment."""
    assignment = models.ForeignKey(Assignment, on_delete=models.CASCADE, related_name='groups')
    name = models.CharField(max_length=255)
    members = models.ManyToManyField(
        'identity.StudentExtra', blank=True, related_name='assignment_groups',
        db_table='school_assignmentgroup_members',
    )

    class Meta:
        db_table = 'school_assignmentgroup'

    def __str__(self):
        return f"{self.name} ({self.assignment.title})"


class AssignmentAttachment(models.Model):
    """Supplementary files beyond the single master teacher_attachment on Assignment."""
    assignment = models.ForeignKey(Assignment, on_delete=models.CASCADE, related_name='attachments')
    file = models.FileField(upload_to='assignments/teacher_files/extra/', validators=[safe_document_validator])
    label = models.CharField(max_length=255, blank=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'school_assignmentattachment'

    def __str__(self):
        return self.label or self.file.name


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

    class Meta:
        db_table = 'school_question'

    def __str__(self):
        return f"{self.assignment.title} - Q: {self.question_text[:30]}..."


class QuestionOption(models.Model):
    question = models.ForeignKey(Question, on_delete=models.CASCADE, related_name='options')
    option_text = models.CharField(max_length=255)
    is_correct = models.BooleanField(default=False)

    class Meta:
        db_table = 'school_questionoption'

    def __str__(self):
        return f"{self.option_text} (Correct: {self.is_correct})"


class RubricCriterion(models.Model):
    """Optional per-question grading rubric. When present, a question's awarded_score is the sum of its criterion scores."""
    question = models.ForeignKey(Question, on_delete=models.CASCADE, related_name='rubric_criteria')
    criterion_text = models.CharField(max_length=255)
    max_points = models.DecimalField(max_digits=5, decimal_places=2, default=1.00)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = 'school_rubriccriterion'
        ordering = ['order', 'id']

    def __str__(self):
        return f"{self.criterion_text} ({self.max_points} pts)"


class StudentSubmission(models.Model):
    GRADING_STATUS = [
        ('Pending', 'Pending - Auto-marked, waiting for manual review'),
        ('Graded', 'Graded (Draft) - Hidden from student'),  # <-- Updated label for clarity
        ('Published', 'Published - Grades Released to Student'),
        ('Returned', 'Returned for Revision')
    ]

    assignment = models.ForeignKey(Assignment, on_delete=models.CASCADE, related_name='submissions')
    student = models.ForeignKey('identity.StudentExtra', on_delete=models.CASCADE, related_name='assignment_submissions')

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
        db_table = 'school_studentsubmission'
        unique_together = ('assignment', 'student')

    def __str__(self):
        return f"{self.student.get_name} -> {self.assignment.title}"


class StudentAnswer(models.Model):
    submission = models.ForeignKey(StudentSubmission, on_delete=models.CASCADE, related_name='answers')
    question = models.ForeignKey(Question, on_delete=models.CASCADE)

    text_answer = models.TextField(null=True, blank=True)
    selected_options = models.ManyToManyField(
        QuestionOption, blank=True,
        db_table='school_studentanswer_selected_options',
    )
    uploaded_file = models.FileField(
        upload_to='assignment_submissions/',
        null=True,
        blank=True,
        validators=[safe_document_validator]
    )

    awarded_score = models.DecimalField(max_digits=5, decimal_places=2, default=0.00)
    teacher_comment = models.CharField(max_length=255, null=True, blank=True)

    teacher_corrected_text = models.TextField(null=True, blank=True)

    class Meta:
        db_table = 'school_studentanswer'

    def __str__(self):
        return f"Answer by {self.submission.student.get_name} for Q: {self.question.id}"


class CriterionScore(models.Model):
    """Per-criterion score for a graded answer, when the question has a rubric."""
    answer = models.ForeignKey(StudentAnswer, on_delete=models.CASCADE, related_name='criterion_scores')
    criterion = models.ForeignKey(RubricCriterion, on_delete=models.CASCADE, related_name='scores')
    score = models.DecimalField(max_digits=5, decimal_places=2, default=0.00)

    class Meta:
        db_table = 'school_criterionscore'
        unique_together = ('answer', 'criterion')

    def __str__(self):
        return f"{self.criterion.criterion_text}: {self.score}"
