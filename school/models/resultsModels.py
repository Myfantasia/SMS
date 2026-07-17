from django.db import models
from school.models.models import StudentExtra, ExamTerm
from school.models.classSubjects_models import ClassStream, Subject

class SubjectTermResult(models.Model):
    student = models.ForeignKey(StudentExtra, on_delete=models.CASCADE, related_name='subject_results')
    subject = models.ForeignKey(Subject, on_delete=models.CASCADE)
    term = models.ForeignKey(ExamTerm, on_delete=models.CASCADE)

    total_score = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    grade = models.CharField(max_length=5, null=True, blank=True)
    subject_teacher_remark = models.CharField(max_length=150, blank=True, null=True)

    # --- FUTURE PROOFING: CBC SUPPORT ---
    # A JSONField allows you to store flexible rubric data without breaking the database.
    # Example: {"strand_1": "Exceeding", "strand_2": "Meeting"}
    cbc_rubric_data = models.JSONField(null=True, blank=True, help_text="Stores CBC competency rubrics")

    class Meta:
        unique_together = ('student', 'subject', 'term')

    def __str__(self):
        return f"{self.student.get_name} - {self.subject.name}"


class StudentTermResult(models.Model):
    student = models.ForeignKey(StudentExtra, on_delete=models.CASCADE, related_name='term_results')
    term = models.ForeignKey(ExamTerm, on_delete=models.CASCADE)
    class_stream = models.ForeignKey(ClassStream, on_delete=models.SET_NULL, null=True)

    total_marks = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    mean_marks = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    mean_grade = models.CharField(max_length=5, null=True, blank=True)

    stream_position = models.PositiveIntegerField(null=True, blank=True)
    class_position = models.PositiveIntegerField(null=True, blank=True)

    class_teacher_remark = models.TextField(blank=True, null=True)
    principal_remark = models.TextField(blank=True, null=True)

    # --- FUTURE PROOFING: PARENT DASHBOARD FEATURES ---
    days_present = models.PositiveIntegerField(default=0, help_text="Total days attended this term")
    days_absent = models.PositiveIntegerField(default=0, help_text="Total days missed this term")

    # Financial blocker: If True, the Parent/Student dashboard will show "Please clear fees to view results"
    results_withheld = models.BooleanField(default=False)

    is_published = models.BooleanField(default=False)
    published_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        unique_together = ('student', 'term')

    def __str__(self):
        return f"{self.student.get_name} - {self.term.name}"


class ClassPerformanceAnalytics(models.Model):
    term = models.ForeignKey(ExamTerm, on_delete=models.CASCADE)
    class_stream = models.ForeignKey(ClassStream, on_delete=models.CASCADE)

    total_students_assessed = models.PositiveIntegerField(default=0)
    stream_mean_marks = models.DecimalField(max_digits=5, decimal_places=2, default=0.00)
    stream_mean_grade = models.CharField(max_length=5, blank=True, null=True)
    deviation_from_last_term = models.DecimalField(max_digits=5, decimal_places=2, default=0.00)

    class Meta:
        unique_together = ('term', 'class_stream')

    def __str__(self):
        return f"{self.class_stream.name} Analytics - {self.term.name}"