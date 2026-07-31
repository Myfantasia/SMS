from django.db import models

from school.models import TeacherExtra


class TimeSlot(models.Model):
    """
    The physical grid of the week.
    Handles both Academic lessons and Global events (Preps, Breaks, Assembly).
    """
    DAY_CHOICES = [
        ('Monday', 'Monday'), ('Tuesday', 'Tuesday'),
        ('Wednesday', 'Wednesday'), ('Thursday', 'Thursday'),
        ('Friday', 'Friday'), ('Saturday', 'Saturday'), ('Sunday', 'Sunday')
    ]

    day = models.CharField(max_length=15, choices=DAY_CHOICES)
    start_time = models.TimeField()
    end_time = models.TimeField()

    # THE KENYAN GRID: If True, this is a break, assembly, or prep. No teacher can be scheduled here.
    is_global = models.BooleanField(default=False)
    global_label = models.CharField(max_length=100, null=True, blank=True,
                                    help_text="e.g., 'Morning Prep', 'Lunch Break'")

    # --- NEW: REMEDIAL FLAG ---
    # Marks this as an early morning (6:30am) or evening (7:00pm) block
    is_remedial = models.BooleanField(default=False)

    class Meta:
        ordering = ['day', 'start_time']
        unique_together = ('day', 'start_time', 'end_time')

    def __str__(self):
        if self.is_global:
            return f"{self.day} {self.start_time.strftime('%H:%M')} - {self.global_label}"
        return f"{self.day} {self.start_time.strftime('%H:%M')} - {self.end_time.strftime('%H:%M')}"

class Timetable(models.Model):
    """
    MONTHLY REGENERATE: The Master Container for a generated schedule (e.g., 'November 2026').
    Allows for the Draft vs. Published workflow to prevent student confusion.
    """
    STATUS_CHOICES = [
        ('Draft', 'Draft'),
        ('Published', 'Published')
    ]

    name = models.CharField(max_length=100, help_text="e.g., Term 1 - November 2026")
    academic_year = models.ForeignKey('AcademicYear', on_delete=models.CASCADE, related_name='timetables', null=True)
    term = models.ForeignKey('ExamTerm', on_delete=models.CASCADE, related_name='timetables', null=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='Draft')
    is_active = models.BooleanField(default=False, help_text="Is this the currently running school timetable?")
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.name} ({self.status})"

class LessonAllocation(models.Model):
    """
    The actual puzzle piece dropped onto the grid.
    """
    timetable = models.ForeignKey(Timetable, on_delete=models.CASCADE, related_name='lessons')
    time_slot = models.ForeignKey(TimeSlot, on_delete=models.CASCADE)
    class_stream = models.ForeignKey('ClassStream', on_delete=models.CASCADE)
    subject = models.ForeignKey('Subject', on_delete=models.CASCADE)
    teacher = models.ForeignKey(TeacherExtra, on_delete=models.CASCADE)

    is_double_period = models.BooleanField(default=False)

    # Pins a manually-corrected placement so it survives both a scoped allocation-sync
    # regeneration and a full Auto-Generate re-run — see generate_lessons_for_scope and
    # sync_timetable_with_allocation_changes in school/views/views_timetable.py.
    is_locked = models.BooleanField(default=False)

    class Meta:
        # THE COLLISION ENGINE: Database-level strict clash prevention!
        unique_together = (
            # 1. A teacher cannot be in two places at the exact same time
            ('timetable', 'time_slot', 'teacher'),
            # 2. We ADD subject to this rule. This allows Grade 9 East to have
            # multiple DIFFERENT subjects at the same time (for the Technical block)
            ('timetable', 'time_slot', 'class_stream', 'subject'),
        )

    def __str__(self):
        return f"{self.class_stream} - {self.subject} ({self.teacher.get_name})"

class TimetablePedagogyPolicy(models.Model):
    """
    SINGLETON MODEL: Governs cognitive fatigue and instructional distribution rules.
    Allows admins to adjust scheduling boundaries directly from the dashboard.
    """
    ENFORCEMENT_CHOICES = [
        ('STRICT', 'Strict Hard Blocks (Prevent Saves)'),
        ('SOFT', 'Soft Enforcement (Allow Saves with Warnings)'),
    ]

    # Independent of GlobalAllocationPolicy.enforcement_mode (Allocations' own strictness
    # switch) — this one governs only whether the fatigue/spacing rules below hard-block
    # scheduling or just warn, so loosening one side never silently loosens the other.
    enforcement_mode = models.CharField(max_length=10, choices=ENFORCEMENT_CHOICES, default='STRICT')

    # --- EXISTING FATIGUE CONTROLS ---
    max_consecutive_periods = models.PositiveIntegerField(
        default=3,
        help_text="Maximum lessons a teacher can handle back-to-back before a mandatory break."
    )
    max_daily_subject_frequency = models.PositiveIntegerField(
        default=2,
        help_text="Maximum times a single subject can appear in a classroom's daily schedule."
    )
    min_subject_spacing_periods = models.PositiveIntegerField(
        default=2,
        help_text="Minimum period gap required between two single lessons of the same subject on the same day."
    )
    allow_remedial_double_periods = models.BooleanField(
        default=False,
        help_text="If True, early morning or late evening remedial blocks can be linked as double periods."
    )

    # --- NEW: ADVANCED LOAD RESHUFFLING (SOFT CONSTRAINTS) ---
    heavy_day_threshold = models.PositiveIntegerField(
        default=5,
        help_text="The number of lessons that defines a 'Heavy Workload Day' for a teacher."
    )
    prevent_consecutive_heavy_days = models.BooleanField(
        default=True,
        help_text="If True, the auto-generator will heavily penalize giving a teacher two 'Heavy Days' in a row."
    )

    def save(self, *args, **kwargs):
        self.pk = 1  # Enforces a single row entry (Singleton pattern)
        super(TimetablePedagogyPolicy, self).save(*args, **kwargs)

    @classmethod
    def load(cls):
        obj, created = cls.objects.get_or_create(pk=1)
        return obj

    def __str__(self):
        return "Global Timetable Pedagogy & Fatigue Policy"

class DailyCover(models.Model):
    """
    AD-HOC SUBSTITUTION TRACKER:
    Temporarily overrides the master timetable for a specific calendar date
    when a teacher is absent or sick.
    """
    date = models.DateField(help_text="The specific calendar day the cover is needed.")

    # The permanent lesson on the timetable that needs covering
    target_lesson = models.ForeignKey('LessonAllocation', on_delete=models.CASCADE, related_name='covers')

    # The teacher who called in sick/absent
    absent_teacher = models.ForeignKey('TeacherExtra', on_delete=models.CASCADE, related_name='absences')

    # The teacher the admin selected to take over the class for that single day
    covering_teacher = models.ForeignKey('TeacherExtra', on_delete=models.CASCADE, related_name='covers_provided')

    notes = models.TextField(blank=True, null=True, help_text="e.g., 'Sick leave', 'Attending seminar'")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        # A specific lesson can only have ONE cover teacher assigned per specific calendar date
        unique_together = ('date', 'target_lesson')

    def __str__(self):
        return f"{self.date}: {self.covering_teacher.get_name} covering {self.absent_teacher.get_name}"