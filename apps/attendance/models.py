"""Models for the `attendance` app.

Attendance sessions and records.

Track B step 4: physically relocated here from school/models/models.py.
Meta.db_table is pinned to each model's original table name below so the
underlying tables (school_attendancesession, school_attendancerecord) never
physically move -- only Django's bookkeeping of which app owns the model.

Track B step 8: ClassStream physically relocated to
apps/academics/models.py. Its FK field below uses an app-label-qualified
string reference ('academics.ClassStream') instead of a Python import --
Django resolves this through its app registry, so `attendance` never needs
to import `apps.academics.models` directly.

Track B step 9 (final): StudentExtra physically relocated to
apps/identity/models.py. `AttendanceRecord.student` below uses the same
app-label-qualified string pattern ('identity.StudentExtra').
"""
from django.contrib.auth.models import User
from django.db import models


class AttendanceSession(models.Model):
    """
    Records the event of a teacher submitting a daily register for a specific class.
    """
    class_stream = models.ForeignKey('academics.ClassStream', on_delete=models.CASCADE, related_name='attendance_sessions')
    date = models.DateField(db_index=True)

    # We link to User instead of TeacherExtra so Admin can also submit on their behalf right now
    submitted_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'school_attendancesession'
        # Prevents a teacher from accidentally submitting two registers for the same class on the same day
        unique_together = ('class_stream', 'date')

    def __str__(self):
        return f"{self.class_stream} - {self.date}"


class AttendanceRecord(models.Model):
    """
    Replaces your old Attendance model.
    This now links directly to your StudentExtra model for accurate reporting.
    """
    STATUS_CHOICES = [
        ('Present', 'Present'),
        ('Absent', 'Absent'),
        ('Late', 'Late'),
        ('Excused', 'Excused')
    ]

    session = models.ForeignKey(AttendanceSession, on_delete=models.CASCADE, related_name='records')
    student = models.ForeignKey('identity.StudentExtra', on_delete=models.CASCADE, related_name='attendance_records')
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='Present', db_index=True)
    remarks = models.CharField(max_length=255, null=True, blank=True, help_text="e.g., 'Sick leave', 'Arrived at 9 AM'")

    class Meta:
        db_table = 'school_attendancerecord'
        unique_together = ('session', 'student')

    def __str__(self):
        return f"{self.student.get_name} - {self.status} ({self.session.date})"
