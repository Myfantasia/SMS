"""Models for the `results` app.

Aggregated per-subject/per-student/per-class term results.

Track B step 7: SubjectTermResult/StudentTermResult/ClassPerformanceAnalytics
physically relocated here from school/models/resultsModels.py (that file had
nothing else in it and has been deleted) via a state-only
SeparateDatabaseAndState migration -- every Meta.db_table below pins the
original `school_<lowercase modelname>` table name so the physical tables
never moved.

Track B step 8: ExamTerm/ClassStream/Subject physically relocated to
apps/academics/models.py. Their FK fields below use app-label-qualified
string references ('academics.X') instead of a Python import -- Django
resolves these through its app registry, so `results` never needs to import
`apps.academics.models` directly.

Track B step 9 (final): StudentExtra physically relocated to
apps/identity/models.py. Its FK fields below use the same app-label-
qualified string pattern ('identity.StudentExtra').

Note: StudentTermResult.days_present/.days_absent (attendance data) and
.results_withheld (a fee gate) are defined but never read or written
anywhere in the codebase today (see the modular-monolith plan's event-bus
section) -- inert columns, not a sign a finance/attendance services call is
missing here.
"""
from django.db import models


class SubjectTermResult(models.Model):
    student = models.ForeignKey('identity.StudentExtra', on_delete=models.CASCADE, related_name='subject_results')
    subject = models.ForeignKey('academics.Subject', on_delete=models.CASCADE)
    term = models.ForeignKey('academics.ExamTerm', on_delete=models.CASCADE)

    total_score = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    grade = models.CharField(max_length=5, null=True, blank=True, db_index=True)
    subject_teacher_remark = models.CharField(max_length=150, blank=True, null=True)

    # --- FUTURE PROOFING: CBC SUPPORT ---
    # A JSONField allows storing flexible rubric data without breaking the database.
    # Example: {"strand_1": "Exceeding", "strand_2": "Meeting"}
    cbc_rubric_data = models.JSONField(null=True, blank=True, help_text="Stores CBC competency rubrics")

    class Meta:
        db_table = 'school_subjecttermresult'
        unique_together = ('student', 'subject', 'term')

    def __str__(self):
        return f"{self.student.get_name} - {self.subject.name}"


class StudentTermResult(models.Model):
    student = models.ForeignKey('identity.StudentExtra', on_delete=models.CASCADE, related_name='term_results')
    term = models.ForeignKey('academics.ExamTerm', on_delete=models.CASCADE)
    class_stream = models.ForeignKey('academics.ClassStream', on_delete=models.SET_NULL, null=True)

    total_marks = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    mean_marks = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    mean_grade = models.CharField(max_length=5, null=True, blank=True, db_index=True)

    stream_position = models.PositiveIntegerField(null=True, blank=True)
    class_position = models.PositiveIntegerField(null=True, blank=True)

    class_teacher_remark = models.TextField(blank=True, null=True)
    principal_remark = models.TextField(blank=True, null=True)

    # --- FUTURE PROOFING: PARENT DASHBOARD FEATURES ---
    days_present = models.PositiveIntegerField(default=0, help_text="Total days attended this term")
    days_absent = models.PositiveIntegerField(default=0, help_text="Total days missed this term")

    # Financial blocker: If True, the Parent/Student dashboard will show "Please clear fees to view results"
    results_withheld = models.BooleanField(default=False, db_index=True)

    is_published = models.BooleanField(default=False, db_index=True)
    published_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'school_studenttermresult'
        unique_together = ('student', 'term')

    def __str__(self):
        return f"{self.student.get_name} - {self.term.name}"


class ClassPerformanceAnalytics(models.Model):
    term = models.ForeignKey('academics.ExamTerm', on_delete=models.CASCADE)
    class_stream = models.ForeignKey('academics.ClassStream', on_delete=models.CASCADE)

    total_students_assessed = models.PositiveIntegerField(default=0)
    stream_mean_marks = models.DecimalField(max_digits=5, decimal_places=2, default=0.00)
    stream_mean_grade = models.CharField(max_length=5, blank=True, null=True)
    deviation_from_last_term = models.DecimalField(max_digits=5, decimal_places=2, default=0.00)

    class Meta:
        db_table = 'school_classperformanceanalytics'
        unique_together = ('term', 'class_stream')

    def __str__(self):
        return f"{self.class_stream.name} Analytics - {self.term.name}"
