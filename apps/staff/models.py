"""Models for the `staff` app.

Staff-specific business data: teacher leave, long-term relief assignment, structural availability.

Track B step 5: physically relocated here from
school/models/teachers_model.py (file deleted entirely -- it had nothing
else in it). Meta.db_table is pinned to each model's original table name
below so the underlying tables never physically move -- only Django's
bookkeeping of which app owns the model.

Track B step 8: TimeSlot physically relocated to apps/academics/models.py.
`TeacherStructuralAvailability.time_slot` below uses an app-label-qualified
string reference ('academics.TimeSlot') instead of a Python import -- Django
resolves this through its app registry, so `staff` never needs to import
`apps.academics.models` directly.

Track B step 9 (final): TeacherExtra physically relocated to
apps/identity/models.py. Every `teacher`/`absent_teacher`/`relief_teacher`
field below uses the same app-label-qualified string pattern
('identity.TeacherExtra').
"""
from django.core.exceptions import ValidationError
from django.db import models


class TeacherLeave(models.Model):
    """
    LEAVE SYSTEM PIPELINE:
    Tracks future and current teacher absences across explicit date ranges.
    Serves as the data feed for both teacher self-requests and admin approvals.
    """
    LEAVE_TYPE_CHOICES = [
        ('Casual', 'Casual Leave'),
        ('Sick', 'Medical/Sick Leave'),
        ('Maternity', 'Maternity/Paternity Leave'),
        ('Seminar', 'Official Duty / Seminar'),
        ('Compassionate', 'Compassionate Leave')
    ]

    STATUS_CHOICES = [
        ('Pending', 'Pending Approval'),
        ('Approved', 'Approved'),
        ('Rejected', 'Rejected')
    ]

    teacher = models.ForeignKey('identity.TeacherExtra', on_delete=models.CASCADE, related_name='leaves')
    leave_type = models.CharField(max_length=20, choices=LEAVE_TYPE_CHOICES)
    start_date = models.DateField(help_text="First day of leave.")
    end_date = models.DateField(help_text="Last day of leave (inclusive).")
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default='Pending')

    reason = models.TextField(blank=True, null=True, help_text="Optional context notes.")
    created_at = models.DateTimeField(auto_now_add=True)
    is_deleted = models.BooleanField(default=False, db_index=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    deleted_by = models.ForeignKey('auth.User', on_delete=models.SET_NULL, null=True, blank=True, related_name='+')

    class Meta:
        db_table = 'school_teacherleave'
        ordering = ['-start_date']

    def clean(self):
        # Validation Guard: Prevent chronologically backwards dates
        if self.start_date and self.end_date and self.start_date > self.end_date:
            raise ValidationError("Configuration Error: Start date cannot be after the end date.")

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)

    @property
    def is_long_term(self):
        """Helper tool to gauge if a leave requires structural workload inheritance (> 7 calendar days)"""
        if self.start_date and self.end_date:
            return (self.end_date - self.start_date).days > 7
        return False

    def __str__(self):
        return f"{self.teacher.get_name} - {self.leave_type} ({self.start_date} to {self.end_date}) [{self.status}]"


def _register_leave_trash():
    from apps.core.trash import register_trash_entity, TrashEntityConfig
    register_trash_entity('leave-requests', TrashEntityConfig(
        model=TeacherLeave, flag_field='is_deleted', flag_true=True, flag_false=False,
        auto_purge=True,
        label_fn=lambda lv: f"{lv.teacher.get_name} — {lv.get_leave_type_display()} ({lv.start_date} to {lv.end_date})",
    ))


_register_leave_trash()

