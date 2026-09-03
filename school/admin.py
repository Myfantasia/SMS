from django.contrib import admin
from unfold.admin import ModelAdmin, TabularInline, StackedInline
from apps.timetable.models import Timetable, LessonAllocation
from apps.messaging.models import Notice, Event, Notification
from apps.attendance.models import AttendanceSession, AttendanceRecord
from apps.allocations.models import SubjectQuota, SubjectAllocation, SubjectBlock, QuotaDefaultRule
from apps.students.models import StudentSubjectEnrollment, StudentPathwaySelection

from apps.assignments.models import (
    Assignment, Question, QuestionOption, StudentSubmission, StudentAnswer
)
from apps.staff.models import TeacherLeave, LongTermReliefAssignment

# ==========================================
# UPGRADED ATTENDANCE, NOTICE & EVENT ADMINS
# ==========================================

@admin.register(AttendanceSession)
class AttendanceSessionAdmin(ModelAdmin):
    list_display = ('class_stream', 'date', 'submitted_by', 'created_at')
    list_filter = ('date', 'class_stream')


@admin.register(AttendanceRecord)
class AttendanceRecordAdmin(ModelAdmin):
    list_display = ('student', 'session', 'status')
    list_filter = ('status', 'session__date')
    search_fields = ('student__user__first_name', 'student__user__last_name')


@admin.register(Notice)
class NoticeAdmin(ModelAdmin):
    # Updated to show the new Title and Audience fields
    list_display = ('title', 'audience', 'date', 'by')
    list_filter = ('audience', 'date')
    search_fields = ('title', 'message')


@admin.register(Event)
class EventAdmin(ModelAdmin):
    list_display = ('title', 'start_time', 'end_time', 'event_type', 'is_active')
    list_filter = ('event_type', 'is_active')
    search_fields = ('title',)


@admin.register(Notification)
class NotificationAdmin(ModelAdmin):
    list_display = ('recipient', 'title', 'is_read', 'created_at')
    list_filter = ('is_read', 'created_at')
    search_fields = ('recipient__username', 'title')


@admin.register(TeacherLeave)
class TeacherLeaveAdmin(ModelAdmin):
    list_display = ('teacher', 'leave_type', 'start_date', 'end_date', 'status', 'is_long_term')
    list_filter = ('status', 'leave_type')
    search_fields = ('teacher__user__first_name', 'teacher__user__last_name')

    def is_long_term(self, obj):
        return obj.is_long_term

    is_long_term.boolean = True
    is_long_term.short_description = 'Long-Term'


@admin.register(LongTermReliefAssignment)
class LongTermReliefAssignmentAdmin(ModelAdmin):
    list_display = ('absent_teacher', 'relief_teacher', 'start_date', 'end_date')
    search_fields = ('absent_teacher__user__first_name', 'relief_teacher__user__first_name')


# ==========================================
# REMAINING MODELS REGISTRATION
# ==========================================

@admin.register(QuotaDefaultRule)
class QuotaDefaultRuleAdmin(ModelAdmin):
    """Config-driven fallback 'Auto-Fill Subject Quotas' uses for a subject with no
    SubjectCurriculumProfile override — see the model docstring."""
    list_display = ('department', 'grade_band', 'applies_when_blocked', 'total_lessons', 'double_lessons_required', 'remedial_lessons_required')
    list_filter = ('department', 'grade_band', 'applies_when_blocked')



# ==========================================
# TIMETABLE & SCHEDULING ENGINE ADMIN
# ==========================================


@admin.register(SubjectQuota)
class SubjectQuotaAdmin(ModelAdmin):
    """
    Manages the Dynamic Refill Buckets.
    Filter by grade to quickly see if all subjects are allocated correctly.
    """
    list_display = ('grade', 'subject', 'total_lessons', 'double_lessons_required', 'remedial_lessons_required')
    list_filter = ('grade', 'subject')
    search_fields = ('grade__name', 'subject__name')


@admin.register(Timetable)
class TimetableAdmin(ModelAdmin):
    """
    Manages the Monthly Regenerate containers.
    """
    list_display = ('name', 'status', 'is_active', 'created_at')
    list_filter = ('status', 'is_active')
    search_fields = ('name',)


@admin.register(LessonAllocation)
class LessonAllocationAdmin(ModelAdmin):
    """
    The actual dropped puzzle pieces.
    Extensive filtering so the admin can search for clashes manually if needed.
    """
    list_display = ('timetable', 'time_slot', 'class_stream', 'subject', 'teacher', 'is_double_period')
    list_filter = ('timetable', 'class_stream', 'subject', 'time_slot__day')

    # Allows searching by the teacher's first name or the class name (e.g., 'East')
    search_fields = ('teacher__user__first_name', 'teacher__user__last_name', 'class_stream__name')


# ==========================================
# EXAMINATIONS & RESULTS ENGINE ADMIN (NEW)
# ==========================================

@admin.register(SubjectBlock)
class SubjectBlockAdmin(ModelAdmin):
    list_display = ('name', 'grade_level')
    list_filter = ('grade_level',)
    search_fields = ('name',)


@admin.register(SubjectAllocation)
class SubjectAllocationAdmin(ModelAdmin):
    list_display = ('classroom', 'subject', 'teacher', 'academic_year', 'term', 'is_active')
    list_filter = ('academic_year', 'term', 'is_active')
    search_fields = ('teacher__user__first_name', 'teacher__user__last_name', 'classroom__name', 'subject__name')


# --- INLINES FOR SEAMLESS ASSIGNMENT CREATION ---

class QuestionInline(StackedInline):
    """Allows adding questions directly from the Assignment page"""
    model = Question
    extra = 0  # No empty rows by default
    fields = ('question_text', 'question_type', 'is_auto_graded', 'max_score', 'exact_match_answer')


class QuestionOptionInline(TabularInline):
    """Allows adding A, B, C, D choices directly on the Question page"""
    model = QuestionOption
    extra = 0


class StudentAnswerInline(TabularInline):
    """Allows viewing individual answers directly inside a Student's Submission"""
    model = StudentAnswer
    extra = 0
    readonly_fields = ('question', 'text_answer', 'selected_options', 'uploaded_file')


# --- MAIN ASSIGNMENT ADMIN CLASSES ---

@admin.register(Assignment)
class AssignmentAdmin(ModelAdmin):
    list_display = ('title', 'assignment_type', 'class_stream', 'status', 'publish_date', 'due_date', 'is_quiz')
    list_filter = ('status', 'assignment_type', 'is_quiz', 'term', 'class_stream__grade')
    search_fields = ('title', 'teacher__user__first_name', 'class_stream__name')

    # Injects the questions into the assignment view
    inlines = [QuestionInline]

    # Organizes the form fields beautifully into sections
    fieldsets = (
        ('Core Details', {
            'fields': ('title', 'assignment_type', 'teacher', 'subject', 'class_stream', 'term')
        }),
        ('Curriculum Mapping', {
            'fields': ('curriculum_type', 'strand_name')
        }),
        ('Time Controls & Quiz Mode', {
            'fields': ('publish_date', 'due_date', 'cutoff_date', 'is_quiz', 'duration_minutes')
        }),
        ('Status', {
            'fields': ('status', 'total_max_score')
        }),
    )
    readonly_fields = ('total_max_score',)  # Protects the auto-tally logic


@admin.register(Question)
class QuestionAdmin(ModelAdmin):
    list_display = ('question_text', 'assignment', 'question_type', 'max_score', 'is_auto_graded')
    list_filter = ('question_type', 'is_auto_graded', 'assignment')
    search_fields = ('question_text',)

    # Injects the multiple-choice options into the question view
    inlines = [QuestionOptionInline]


@admin.register(StudentSubmission)
class StudentSubmissionAdmin(ModelAdmin):
    list_display = ('student', 'assignment', 'grading_status', 'is_late', 'total_awarded_score')
    list_filter = ('grading_status', 'is_late', 'assignment')
    search_fields = ('student__user__first_name', 'student__user__last_name', 'assignment__title')

    # Injects the actual answers the student gave
    inlines = [StudentAnswerInline]

    # Protect timestamps from manual tampering
    readonly_fields = ('started_at', 'submitted_at')


@admin.register(QuestionOption)
class QuestionOptionAdmin(ModelAdmin):
    # Registered separately just in case you need to bulk-edit options
    list_display = ('option_text', 'question', 'is_correct')
    list_filter = ('is_correct',)
    search_fields = ('option_text',)


@admin.register(StudentAnswer)
class StudentAnswerAdmin(ModelAdmin):
    # Allows a teacher to filter and mark all essays at once if they bypass the frontend UI
    list_display = ('submission', 'question', 'awarded_score')
    list_filter = ('question__question_type',)
    search_fields = ('submission__student__user__first_name',)


# ========================================================
# NEW: MASTER STUDENT SUBJECT SELECTION ENROLLMENT LEDGER
# ========================================================

@admin.register(StudentSubjectEnrollment)
class StudentSubjectEnrollmentAdmin(ModelAdmin):
    """
    Provides a master lookup ledger table for all student subject assignments.
    Superusers can query selection rules or bulk-approve profiles here.
    """
    list_display = ('student', 'subject', 'academic_year', 'status')
    list_filter = ('status', 'academic_year', 'subject__department', 'student__cl')
    search_fields = (
        'student__user__first_name', 'student__user__last_name',
        'student__roll', 'subject__name', 'subject__code'
    )
    list_editable = ('status',)
    ordering = ('academic_year', 'student', 'subject')


@admin.register(StudentPathwaySelection)
class StudentPathwaySelectionAdmin(ModelAdmin):
    """
    Mirrors StudentSubjectEnrollmentAdmin's lookup-ledger convention, but for the
    Senior Secondary pathway choice (one row per student per year, not per subject).
    """
    list_display = ('student', 'pathway', 'track', 'academic_year', 'status')
    list_filter = ('status', 'academic_year', 'pathway', 'track')
    search_fields = (
        'student__user__first_name', 'student__user__last_name',
        'student__roll', 'pathway__name'
    )
    list_editable = ('status',)
    ordering = ('academic_year', 'student')