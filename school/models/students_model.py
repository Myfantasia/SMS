from django.db import models
from school.models import StudentExtra


class StudentTask(models.Model):
    """Personal to-do items a student manages for themselves (not tied to assignments)."""
    student = models.ForeignKey(StudentExtra, on_delete=models.CASCADE, related_name='tasks')
    title = models.CharField(max_length=255)
    due_date = models.DateField(blank=True, null=True)
    is_done = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['is_done', 'due_date', '-created_at']

    def __str__(self):
        return f"{self.title} ({self.student.get_name})"
