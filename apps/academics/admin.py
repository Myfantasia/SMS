"""Admin registrations for the `academics` app.

Track B step 8: model classes and their admin registrations physically
relocated here together from school/models/classSubjects_models.py,
school/models/models.py, school/models/timetable_models.py, and
school/admin.py.
"""
from unfold.admin import ModelAdmin
from django.contrib import admin

from apps.academics.models import (
    GradeLevel, ClassStream, Department, Subject, SubjectCurriculumProfile,
    PresetCombination, TimeSlot, AcademicYear, ExamTerm, Tier,
    SubjectSelectionRule, SubjectExclusionRule, CurriculumPreset,
    Curriculum, Pathway, Track, SubjectCategoryLimit, SubjectPool,
)


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


@admin.register(Tier)
class TierAdmin(ModelAdmin):
    """
    Manages curriculum-defined stage splits (e.g. CBC's Junior/Senior Secondary). This is
    where an admin sets exit_exam_code/exit_is_terminal per tier (Upper Primary -> KPSEA,
    Junior Secondary -> KJSEA, Senior Secondary -> KCSE + terminal) — these default
    blank/False, and promotion.py's _determine_transition treats an unconfigured tier as a
    plain, ungated internal transition.
    """
    list_display = ('name', 'code', 'curriculum', 'display_order', 'exit_exam_code', 'exit_is_terminal')
    list_filter = ('curriculum', 'exit_exam_code', 'exit_is_terminal')
    list_editable = ('exit_exam_code', 'exit_is_terminal')
    search_fields = ('name', 'code')


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


@admin.register(TimeSlot)
class TimeSlotAdmin(ModelAdmin):
    """
    Manages the Global Grid (e.g., periods, breaks, preps).
    """
    list_display = ('day', 'start_time', 'end_time', 'is_global', 'global_label')
    list_filter = ('day', 'is_global')
    ordering = ('day', 'start_time')


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


@admin.register(SubjectSelectionRule)
class SubjectSelectionRuleAdmin(ModelAdmin):
    list_display = ('grade', 'min_subjects', 'max_subjects')
    list_editable = ('min_subjects', 'max_subjects')


@admin.register(SubjectExclusionRule)
class SubjectExclusionRuleAdmin(ModelAdmin):
    list_display = ('grade', 'subject_a', 'subject_b')
    list_filter = ('grade',)


@admin.register(CurriculumPreset)
class CurriculumPresetAdmin(ModelAdmin):
    """
    Admin layout for managing global curriculum structures.
    Enables quick modifications to standard base requirements.
    """
    list_display = ('name', 'min_subjects', 'max_subjects', 'display_order')
    list_editable = ('min_subjects', 'max_subjects', 'display_order')
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


@admin.register(Curriculum)
class CurriculumAdmin(ModelAdmin):
    list_display = ('code', 'name', 'is_active_for_new_grades', 'is_archived')
    list_filter = ('is_active_for_new_grades', 'is_archived')
    search_fields = ('code', 'name')


@admin.register(Pathway)
class PathwayAdmin(ModelAdmin):
    list_display = ('name', 'curriculum')
    list_filter = ('curriculum',)
    search_fields = ('name', 'curriculum__name')


@admin.register(Track)
class TrackAdmin(ModelAdmin):
    list_display = ('name', 'pathway', 'display_order')
    list_filter = ('pathway',)
    search_fields = ('name', 'pathway__name')


@admin.register(SubjectCategoryLimit)
class SubjectCategoryLimitAdmin(ModelAdmin):
    list_display = ('grade', 'department', 'max_subjects')
    list_filter = ('grade', 'department')


@admin.register(SubjectPool)
class SubjectPoolAdmin(ModelAdmin):
    list_display = ('preset', 'pool_type', 'min_subjects', 'max_subjects', 'pathway', 'track')
    list_filter = ('pool_type', 'preset', 'pathway', 'track')
    filter_horizontal = ('subjects', 'combinations')
