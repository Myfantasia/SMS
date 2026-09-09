"""Public service surface for the `students` app.

Student-specific business data: personal tasks, pathway selection, subject
enrollment workflows. (Not the StudentExtra profile itself -- that's
`identity`, see the plan's rationale for keeping the two most cross-
referenced profile models out of mid-stack apps.)

RULE: every function here takes and returns plain dataclasses -- never a
Django model instance or QuerySet.

This app may import services from:
    - apps.identity.services
    - apps.academics.services

Track B step 5: StudentTask/StudentPathwaySelection/StudentSubjectEnrollment
physically relocated to apps/students/models.py -- function bodies below now
import from there directly.
"""
from dataclasses import dataclass
from datetime import date
from typing import Optional, Sequence

from apps.students.models import StudentTask, StudentPathwaySelection, StudentSubjectEnrollment


@dataclass(frozen=True)
class StudentTaskDTO:
    id: int
    student_id: int
    title: str
    due_date: Optional[date]
    is_done: bool


@dataclass(frozen=True)
class PathwaySelectionDTO:
    id: int
    student_id: int
    pathway_id: int
    track_id: Optional[int]
    preset_combination_id: Optional[int]
    academic_year_id: int
    status: str


@dataclass(frozen=True)
class SubjectEnrollmentDTO:
    id: int
    student_id: int
    subject_id: int
    academic_year_id: int
    status: str


def list_student_tasks(*, student_id: int, include_done: bool = True) -> Sequence[StudentTaskDTO]:
    qs = StudentTask.objects.filter(student_id=student_id)
    if not include_done:
        qs = qs.exclude(is_done=True)
    return tuple(
        StudentTaskDTO(id=t.id, student_id=t.student_id, title=t.title, due_date=t.due_date, is_done=t.is_done)
        for t in qs
    )


def create_student_task(*, student_id: int, title: str, due_date: Optional[date] = None) -> StudentTaskDTO:
    t = StudentTask.objects.create(student_id=student_id, title=title, due_date=due_date)
    return StudentTaskDTO(id=t.id, student_id=t.student_id, title=t.title, due_date=t.due_date, is_done=t.is_done)


def get_approved_pathway_selection(*, student_id: int, academic_year_id: int) -> Optional[PathwaySelectionDTO]:
    sel = StudentPathwaySelection.objects.filter(
        student_id=student_id, academic_year_id=academic_year_id, status='Approved',
    ).first()
    return _pathway_selection_to_dto(sel) if sel else None


def list_pathway_selections(*, student_id: Optional[int] = None, status: Optional[str] = None) -> Sequence[PathwaySelectionDTO]:
    qs = StudentPathwaySelection.objects.all()
    if student_id is not None:
        qs = qs.filter(student_id=student_id)
    if status is not None:
        qs = qs.filter(status=status)
    return tuple(_pathway_selection_to_dto(s) for s in qs)


def _pathway_selection_to_dto(sel) -> PathwaySelectionDTO:
    return PathwaySelectionDTO(
        id=sel.id, student_id=sel.student_id, pathway_id=sel.pathway_id, track_id=sel.track_id,
        preset_combination_id=sel.preset_combination_id, academic_year_id=sel.academic_year_id,
        status=sel.status,
    )


def list_approved_subject_enrollments(*, student_id: int, academic_year_id: int) -> Sequence[SubjectEnrollmentDTO]:
    qs = StudentSubjectEnrollment.objects.filter(
        student_id=student_id, academic_year_id=academic_year_id, status='Approved',
    )
    return tuple(
        SubjectEnrollmentDTO(
            id=e.id, student_id=e.student_id, subject_id=e.subject_id,
            academic_year_id=e.academic_year_id, status=e.status,
        )
        for e in qs
    )
