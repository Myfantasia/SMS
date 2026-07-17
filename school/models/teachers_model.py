from django.db import models
from django.core.exceptions import ValidationError
from school.models import TeacherExtra


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

    teacher = models.ForeignKey(TeacherExtra, on_delete=models.CASCADE, related_name='leaves')
    leave_type = models.CharField(max_length=20, choices=LEAVE_TYPE_CHOICES)
    start_date = models.DateField(help_text="First day of leave.")
    end_date = models.DateField(help_text="Last day of leave (inclusive).")
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default='Pending')

    reason = models.TextField(blank=True, null=True, help_text="Optional context notes.")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
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


class LongTermReliefAssignment(models.Model):
    """
    WORKLOAD SURROGATE CONSOLE:
    Maps a relief teacher to take over all SubjectAllocation contracts
    of an absent teacher during a long-term leave window.
    """
    absent_teacher = models.ForeignKey(
        TeacherExtra, on_delete=models.CASCADE, related_name='relief_covers_needed'
    )
    relief_teacher = models.ForeignKey(
        TeacherExtra, on_delete=models.CASCADE, related_name='relief_covers_provided'
    )
    associated_leave = models.OneToOneField(
        TeacherLeave, on_delete=models.CASCADE, limit_choices_to={'status': 'Approved'},
        help_text="Links directly to an approved long-term leave instance."
    )
    start_date = models.DateField()
    end_date = models.DateField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('absent_teacher', 'start_date', 'end_date')

    def clean(self):
        if self.relief_teacher == self.absent_teacher:
            raise ValidationError("Collision Guard: A teacher cannot act as a relief replacement for themselves.")

        # Verify alignment with the linked leave window
        if self.start_date < self.associated_leave.start_date or self.end_date > self.associated_leave.end_date:
            raise ValidationError("Window Mismatch: Relief dates must fit within the approved leave duration.")

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"Relief: {self.relief_teacher.get_name()} taking over from {self.absent_teacher.get_name()}"


class TeacherStructuralAvailability(models.Model):
    """
    MASTER GENERATION MATRIX:
    Blocks out specific time slots where a teacher is permanently unavailable
    (e.g., Administrative duties, Part-time schedules).
    """
    teacher = models.ForeignKey('TeacherExtra', on_delete=models.CASCADE, related_name='unavailable_slots')
    time_slot = models.ForeignKey('TimeSlot', on_delete=models.CASCADE)

    # Allows the admin to label WHY the teacher is blocked on the dashboard
    reason = models.CharField(
        max_length=100,
        blank=True,
        null=True,
        help_text="e.g., 'HOD Meeting', 'Part-time off-day'"
    )

    class Meta:
        # A teacher cannot be marked "unavailable" twice for the exact same time slot
        unique_together = ('teacher', 'time_slot')

    def __str__(self):
        return f"{self.teacher.get_name} - Unavailable: {self.time_slot.day} {self.time_slot.start_time.strftime('%H:%M')}"