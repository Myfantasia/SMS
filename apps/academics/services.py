"""Public service surface for the `academics` app.

Curriculum, pathways, tracks, grade levels, class streams, subjects,
departments, academic calendar (AcademicYear/ExamTerm).

This is the single most-depended-on domain app (nearly every other app
reads ClassStream/Subject/GradeLevel/AcademicYear/ExamTerm) -- these
functions are the ones every other app's Track A sweep should be pointed
at instead of importing school.models.classSubjects_models/models directly.

RULE: every function here takes and returns plain dataclasses -- never a
Django model instance or QuerySet.

This app may import services from:
    - apps.identity.services

Track B step 8: Curriculum/Pathway/Track/PresetCombination/Tier/GradeLevel/
ClassStream/Department/Subject/SubjectCurriculumProfile/
SubjectSelectionRule/SubjectCategoryLimit/SubjectExclusionRule/
CurriculumPreset/SubjectPool/AcademicYear/ExamTerm/TimeSlot physically
relocated to apps/academics/models.py -- function bodies below now import
from there directly, promoted to a top-level import (same-app imports carry
no import-linter risk, matching the precedent set in apps/core/services.py
back in Track B step 2).
"""
from dataclasses import dataclass
from typing import Optional, Sequence

from django.db.models import Q

from apps.academics.models import (
    ClassStream, Subject, GradeLevel, Department, AcademicYear, ExamTerm, TimeSlot,
    SubjectCurriculumProfile,
)


@dataclass(frozen=True)
class ClassStreamDTO:
    id: int
    name: str
    grade_id: int
    grade_name: str
    capacity: int
    class_teacher_id: Optional[int]
    is_virtual: bool


@dataclass(frozen=True)
class SubjectDTO:
    id: int
    code: str
    name: str
    department_id: Optional[int]
    is_core: bool
    display_order: int


@dataclass(frozen=True)
class GradeLevelDTO:
    id: int
    name: str
    numeric_order: int
    curriculum_id: Optional[int]
    curriculum_type: str
    tier_id: Optional[int]


@dataclass(frozen=True)
class DepartmentDTO:
    id: int
    name: str
    code: Optional[str]
    curriculum_id: int


@dataclass(frozen=True)
class AcademicYearDTO:
    id: int
    year: str
    is_active: bool
    is_archived: bool


@dataclass(frozen=True)
class ExamTermDTO:
    id: int
    name: str
    academic_year_id: int
    is_active: bool


@dataclass(frozen=True)
class TimeSlotDTO:
    id: int
    day: str
    start_time: str
    end_time: str
    is_global: bool
    is_remedial: bool


def get_class_stream(class_stream_id: int) -> Optional[ClassStreamDTO]:

    cs = ClassStream.objects.filter(id=class_stream_id).select_related('grade').first()
    return _stream_to_dto(cs) if cs else None


def list_class_streams(*, grade_id: Optional[int] = None, live_only: bool = True) -> Sequence[ClassStreamDTO]:

    qs = (ClassStream.live if live_only else ClassStream.objects).all().select_related('grade')
    if grade_id is not None:
        qs = qs.filter(grade_id=grade_id)
    return tuple(_stream_to_dto(cs) for cs in qs)


def _stream_to_dto(cs) -> ClassStreamDTO:
    return ClassStreamDTO(
        id=cs.id, name=cs.name, grade_id=cs.grade_id, grade_name=cs.grade.name if cs.grade_id else "",
        capacity=cs.capacity, class_teacher_id=cs.class_teacher_id, is_virtual=cs.is_virtual,
    )


def get_subject(subject_id: int) -> Optional[SubjectDTO]:

    s = Subject.objects.filter(id=subject_id).first()
    return _subject_to_dto(s) if s else None


def list_subjects(*, department_id: Optional[int] = None) -> Sequence[SubjectDTO]:

    qs = Subject.objects.all().order_by('display_order', 'name')
    if department_id is not None:
        qs = qs.filter(department_id=department_id)
    return tuple(_subject_to_dto(s) for s in qs)


def _subject_to_dto(s) -> SubjectDTO:
    return SubjectDTO(
        id=s.id, code=s.code, name=s.name, department_id=s.department_id,
        is_core=s.is_core, display_order=s.display_order,
    )


def get_grade_level(grade_id: int) -> Optional[GradeLevelDTO]:

    g = GradeLevel.objects.filter(id=grade_id).first()
    return _grade_to_dto(g) if g else None


def list_grade_levels() -> Sequence[GradeLevelDTO]:

    return tuple(_grade_to_dto(g) for g in GradeLevel.objects.all().order_by('numeric_order'))


def _grade_to_dto(g) -> GradeLevelDTO:
    return GradeLevelDTO(
        id=g.id, name=g.name, numeric_order=g.numeric_order,
        curriculum_id=g.curriculum_id, curriculum_type=g.curriculum_type, tier_id=g.tier_id,
    )


def list_departments(*, curriculum_id: int, tier_id: Optional[int] = None) -> Sequence[DepartmentDTO]:
    """
    Active departments for one curriculum, optionally narrowed to only the departments actually
    used by subjects in one tier. "Used in a tier" is derived from SubjectCurriculumProfile rows
    scoped to that tier (or left tier-less, meaning "every tier"), plus the departments of any
    subject with NO profile row at all -- those fall back to Subject.department everywhere,
    matching get_effective_department's own fallback, so they stay visible in every tier.
    """
    qs = Department.objects.filter(curriculum_id=curriculum_id, is_active=True)
    if tier_id is not None:
        profile_dept_ids = set(
            SubjectCurriculumProfile.objects.filter(curriculum_id=curriculum_id, department_id__isnull=False)
            .filter(Q(tier_id=tier_id) | Q(tier_id__isnull=True))
            .values_list('department_id', flat=True)
        )
        unprofiled_dept_ids = set(
            Subject.live.filter(curriculum_profiles__isnull=True, department__curriculum_id=curriculum_id)
            .values_list('department_id', flat=True)
        )
        qs = qs.filter(id__in=(profile_dept_ids | unprofiled_dept_ids))
    return tuple(
        DepartmentDTO(id=d.id, name=d.name, code=d.code, curriculum_id=d.curriculum_id)
        for d in qs.order_by('name')
    )


def get_current_academic_year() -> Optional[AcademicYearDTO]:

    y = AcademicYear.objects.filter(is_active=True).first()
    return AcademicYearDTO(id=y.id, year=y.year, is_active=y.is_active, is_archived=y.is_archived) if y else None


def get_active_term() -> Optional[ExamTermDTO]:

    t = ExamTerm.objects.filter(is_active=True).select_related('academic_year').first()
    if not t:
        return None
    return ExamTermDTO(id=t.id, name=t.name, academic_year_id=t.academic_year_id, is_active=t.is_active)


def get_exam_term(term_id: int) -> Optional[ExamTermDTO]:

    t = ExamTerm.objects.filter(id=term_id).first()
    if not t:
        return None
    return ExamTermDTO(id=t.id, name=t.name, academic_year_id=t.academic_year_id, is_active=t.is_active)


def get_time_slot(time_slot_id: int) -> Optional[TimeSlotDTO]:
    t = TimeSlot.objects.filter(id=time_slot_id).first()
    return _time_slot_to_dto(t) if t else None


def list_time_slots(*, day: Optional[str] = None, include_global: bool = True) -> Sequence[TimeSlotDTO]:

    qs = TimeSlot.objects.all()
    if day is not None:
        qs = qs.filter(day=day)
    if not include_global:
        qs = qs.filter(is_global=False)
    return tuple(_time_slot_to_dto(t) for t in qs)


def _time_slot_to_dto(t) -> TimeSlotDTO:
    return TimeSlotDTO(
        id=t.id, day=t.day, start_time=t.start_time.isoformat(), end_time=t.end_time.isoformat(),
        is_global=t.is_global, is_remedial=t.is_remedial,
    )
