from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from unfold.admin import ModelAdmin, StackedInline, TabularInline
from unfold.forms import AdminPasswordChangeForm, UserChangeForm, UserCreationForm
from school.models.timetable_models import TimeSlot, Timetable, LessonAllocation
from school.models.models import (
    AdminExtra, StudentExtra, TeacherExtra, ParentExtra, StaffExtra,
    Notice, AttendanceSession, AttendanceRecord,
    Event, Notification, AcademicYear, ExamTerm, ExamEvent,
    GradingRule, ExamResult, StudentReportSummary, ClassExamStatus
)
# UPDATED: Appended StudentSubjectEnrollment to the end of your exact imports group
from school.models.classSubjects_models import ( ClassStream, Subject, SubjectQuota, Department,
                                SubjectAllocation, SubjectSelectionRule, SubjectBlock, GradeLevel, SubjectExclusionRule, CurriculumPreset, StudentSubjectEnrollment, SubjectCurriculumProfile, QuotaDefaultRule, PresetCombination )

from school.models.assignments_models import (
    Assignment, Question, QuestionOption, StudentSubmission, StudentAnswer
)
from school.models.teachers_model import TeacherLeave, LongTermReliefAssignment

# --- 1. ADMIN INLINE SETUP ---
# This links the AdminExtra details to the User page in the admin panel
# Updated to inherit from Unfold's StackedInline
class AdminExtraInline(StackedInline):
    model = AdminExtra
    can_delete = False
    verbose_name_plural = 'Admin Profile Details'
    extra = 0  # ✅ prevents blank duplicate rows being created
    max_num = 1


# Updated to inherit from Unfold's customized UserAdmin
class UserAdmin(BaseUserAdmin, ModelAdmin):
    inlines = (AdminExtraInline,)

    # Unfold's specific forms for the User model to ensure the UI doesn't break
    form = UserChangeForm
    add_form = UserCreationForm
    change_password_form = AdminPasswordChangeForm


from django.contrib.auth.models import User, Group
admin.site.unregister(User)
admin.site.register(User, UserAdmin)


# --- ADMIN APPROVAL QUEUE ---
# Signups via /adminsignup land here with status=False and are NOT in the ADMIN group
# yet (group membership alone is what is_admin() checks). An existing superuser
# reviews and approves/revokes them from this list.
@admin.register(AdminExtra)
class AdminExtraAdmin(ModelAdmin):
    list_display = ('user', 'status', 'mobile')
    list_filter = ('status',)
    actions = ['approve_admins', 'revoke_admins']

    @admin.action(description='Approve selected admins (grants ADMIN group access)')
    def approve_admins(self, request, queryset):
        admin_group, _ = Group.objects.get_or_create(name='ADMIN')
        for admin_extra in queryset:
            admin_extra.status = True
            admin_extra.save()
            admin_group.user_set.add(admin_extra.user)

    @admin.action(description='Revoke admin access for selected')
    def revoke_admins(self, request, queryset):
        admin_group, _ = Group.objects.get_or_create(name='ADMIN')
        for admin_extra in queryset:
            admin_extra.status = False
            admin_extra.save()
            admin_group.user_set.remove(admin_extra.user)

# --- NEW: STUDENT SUBJECT PROFILE INLINE LAYOUT ---
class StudentSubjectEnrollmentInline(TabularInline):
    """Allows superusers to manage individual student subject matches within the student profile view"""
    model = StudentSubjectEnrollment
    extra = 0
    fields = ('subject', 'academic_year', 'status')


# --- 2. OTHER MODELS REGISTRATION ---
# All classes below are updated to inherit from unfold.admin.ModelAdmin

@admin.register(StudentExtra)
class StudentExtraAdmin(ModelAdmin):
    list_display = ('get_name', 'roll', 'cl', 'mobile', 'status')
    search_fields = ('user__first_name', 'user__last_name', 'roll')
    # UPDATED: Seamlessly appended the new subject manager inline to your existing student card
    inlines = [StudentSubjectEnrollmentInline]

    def get_name(self, obj):
        return obj.get_name

    get_name.short_description = 'Student Name'


@admin.register(TeacherExtra)
class TeacherExtraAdmin(ModelAdmin):
    list_display = ('get_name', 'subjects', 'mobile', 'status')

    def get_name(self, obj):
        return obj.get_name

    get_name.short_description = 'Teacher Name'


@admin.register(StaffExtra)
class StaffExtraAdmin(ModelAdmin):
    list_display = ('get_name', 'job_title', 'mobile', 'status')
    search_fields = ('user__first_name', 'user__last_name', 'job_title')

    def get_name(self, obj):
        return obj.get_name

    get_name.short_description = 'Staff Name'


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

@admin.register(ParentExtra)
class ParentExtraAdmin(ModelAdmin):
    list_display = ('get_name', 'get_children', 'relationship', 'mobile', 'status')
    search_fields = ('user__first_name', 'user__last_name', 'mobile')

    def get_name(self, obj):
        return obj.get_name

    get_name.short_description = 'Parent Name'

    def get_children(self, obj):
        # Grabs all students linked to this parent and joins their names with a comma
        return ", ".join([child.get_name for child in obj.students.all()])

    get_children.short_description = 'Linked Children'


@admin.register(GradeLevel)
class GradeLevelAdmin(ModelAdmin):
    """
    Manages the overarching grades (e.g., Grade 6, Grade 7).
    We use list_display to easily see the numeric order used for sorting.
    """
    list_display = ('name', 'curriculum_type', 'numeric_order') # Added curriculum_type here for easy viewing
    list_filter = ('curriculum_type',)
    ordering = ('numeric_order',)
    search_fields = ('name',)

@admin.register(ClassStream)
class ClassStreamAdmin(ModelAdmin):
    """
    Manages the physical classrooms (e.g., 6A, 6B).
    We include a list_filter so you can easily filter streams by their parent Grade.
    """
    list_display = ('name', 'grade', 'capacity')
    list_filter = ('grade',)
    search_fields = ('name', 'grade__name')

@admin.register(Department)
class DepartmentAdmin(ModelAdmin):
    """Admin-managed subject departments — see Department model docstring for how these
    interact with the Auto-Fill Subject Quotas ladder."""
    list_display = ('name', 'code', 'is_active')
    list_filter = ('is_active',)
    search_fields = ('name', 'code')


@admin.register(Subject)
class SubjectAdmin(ModelAdmin):
    """
    Manages the curriculum.
    The list_filter is incredibly useful here for sorting by department.
    """
    list_display = ('code', 'name', 'department', 'is_core')
    list_filter = ('department', 'is_core')
    search_fields = ('code', 'name')


@admin.register(SubjectCurriculumProfile)
class SubjectCurriculumProfileAdmin(ModelAdmin):
    list_display = ('subject', 'curriculum', 'tier', 'is_core', 'total_lessons', 'double_lessons_required', 'remedial_lessons_required')
    list_filter = ('curriculum', 'tier')
    search_fields = ('subject__code', 'subject__name')


@admin.register(QuotaDefaultRule)
class QuotaDefaultRuleAdmin(ModelAdmin):
    """Config-driven fallback 'Auto-Fill Subject Quotas' uses for a subject with no
    SubjectCurriculumProfile override — see the model docstring."""
    list_display = ('department', 'grade_band', 'applies_when_blocked', 'total_lessons', 'double_lessons_required', 'remedial_lessons_required')
    list_filter = ('department', 'grade_band', 'applies_when_blocked')


@admin.register(PresetCombination)
class PresetCombinationAdmin(ModelAdmin):
    """The official KNEC 3-subject combination catalog — see model docstring for why this
    is deliberately independent of CurriculumPreset/SubjectPool."""
    list_display = ('display_name', 'track', 'pathway_name', 'code', 'is_active')
    list_filter = ('track__pathway', 'track', 'is_active')
    search_fields = ('name', 'code', 'subjects__name')
    filter_horizontal = ('subjects',)

    @admin.display(description='Pathway')
    def pathway_name(self, obj):
        return obj.track.pathway.name


# ==========================================
# TIMETABLE & SCHEDULING ENGINE ADMIN
# ==========================================

@admin.register(TimeSlot)
class TimeSlotAdmin(ModelAdmin):
    """
    Manages the Global Grid (e.g., periods, breaks, preps).
    """
    list_display = ('day', 'start_time', 'end_time', 'is_global', 'global_label')
    list_filter = ('day', 'is_global')
    ordering = ('day', 'start_time')


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

@admin.register(AcademicYear)
class AcademicYearAdmin(ModelAdmin):
    list_display = ('year', 'is_active', 'is_archived')
    list_filter = ('is_active', 'is_archived')
    search_fields = ('year',)

@admin.register(ExamTerm)
class ExamTermAdmin(ModelAdmin):
    list_display = ('name', 'academic_year', 'start_date', 'end_date')
    list_filter = ('academic_year',)
    search_fields = ('name',)

@admin.register(ExamEvent)
class ExamEventAdmin(ModelAdmin):
    list_display = ('name', 'term', 'exam_type', 'total_marks', 'status')
    list_filter = ('exam_type', 'status', 'term__academic_year')
    search_fields = ('name', 'term__name')

@admin.register(GradingRule)
class GradingRuleAdmin(ModelAdmin):
    list_display = ('grade_label', 'curriculum', 'min_score', 'max_score', 'remarks')
    list_filter = ('curriculum',)
    ordering = ('curriculum', '-min_score')

@admin.register(ExamResult)
class ExamResultAdmin(ModelAdmin):
    list_display = ('student', 'exam', 'subject', 'marks_obtained')
    # Extremely helpful filters for the admin to audit specific class performance
    list_filter = ('exam', 'subject', 'student__cl__grade')
    search_fields = ('student__user__first_name', 'student__user__last_name', 'student__roll')

@admin.register(StudentReportSummary)
class StudentReportSummaryAdmin(ModelAdmin):
    list_display = ('student', 'exam')
    search_fields = ('student__user__first_name', 'student__user__last_name')
    list_filter = ('exam',)


@admin.register(ClassExamStatus)
class ClassExamStatusAdmin(ModelAdmin):
    list_display = ('class_stream', 'exam', 'status', 'published_at', 'published_by')
    list_filter = ('status', 'exam')
    search_fields = ('class_stream__name', 'exam__name')


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


@admin.register(SubjectSelectionRule)
class SubjectSelectionRuleAdmin(ModelAdmin):
    list_display = ('grade', 'min_subjects', 'max_subjects')
    list_editable = ('min_subjects', 'max_subjects')


@admin.register(SubjectExclusionRule)
class SubjectExclusionRuleAdmin(ModelAdmin):
    list_display = ('grade', 'subject_a', 'subject_b')
    list_filter = ('grade',)


@admin.register(CurriculumPreset)
class CurriculumPresetAdmin(admin.ModelAdmin):
    """
    Admin layout for managing global curriculum structures.
    Enables quick modifications to standard base requirements.
    """
    list_display = ('name', 'min_subjects', 'max_subjects', 'display_order')
    list_editable = ('min_subjects', 'max_subjects', 'display_order')
    #list_filter = ('curriculum_type',)
    search_fields = ('name',)
    fieldsets = (
        ('Template Profile', {
            'fields': ('name', 'display_order')
        }),
        ('Academic Constraints', {
            'fields': ('min_subjects', 'max_subjects'),
            'description': 'Define standard curriculum baseline and ceiling boundaries.'
        }),
    )


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