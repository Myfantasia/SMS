"""Public service surface for the `assignments` app.

Assignments, quiz/question engine, submissions, rubric grading.

RULE: every function here takes and returns plain dataclasses -- never a
Django model instance or QuerySet.

This app may import services from:
    - apps.identity.services
    - apps.academics.services

Track B step 4: Assignment/StudentSubmission (and the rest of this app's
models) physically relocated to apps/assignments/models.py -- function
bodies below now import from there directly.
"""
from dataclasses import dataclass
from typing import Optional, Sequence

from apps.assignments.models import Assignment, StudentSubmission


@dataclass(frozen=True)
class AssignmentDTO:
    id: int
    title: str
    teacher_id: int
    subject_id: int
    class_stream_id: int
    term_id: Optional[int]
    status: str


@dataclass(frozen=True)
class SubmissionDTO:
    id: int
    assignment_id: int
    student_id: int
    status: str


def get_assignment(assignment_id: int) -> Optional[AssignmentDTO]:
    a = Assignment.objects.filter(id=assignment_id).first()
    return _assignment_to_dto(a) if a else None


def list_assignments(*, teacher_id: Optional[int] = None, class_stream_id: Optional[int] = None, status: Optional[str] = None) -> Sequence[AssignmentDTO]:
    qs = Assignment.objects.filter(is_deleted=False)
    if teacher_id is not None:
        qs = qs.filter(teacher_id=teacher_id)
    if class_stream_id is not None:
        qs = qs.filter(class_stream_id=class_stream_id)
    if status is not None:
        qs = qs.filter(status=status)
    return tuple(_assignment_to_dto(a) for a in qs)


def _assignment_to_dto(a) -> AssignmentDTO:
    return AssignmentDTO(
        id=a.id, title=a.title, teacher_id=a.teacher_id, subject_id=a.subject_id,
        class_stream_id=a.class_stream_id, term_id=a.term_id, status=a.status,
    )


def list_submissions_for_assignment(assignment_id: int) -> Sequence[SubmissionDTO]:
    return tuple(
        SubmissionDTO(id=s.id, assignment_id=s.assignment_id, student_id=s.student_id, status=s.status)
        for s in StudentSubmission.objects.filter(assignment_id=assignment_id)
    )


def get_student_submission(*, assignment_id: int, student_id: int) -> Optional[SubmissionDTO]:
    s = StudentSubmission.objects.filter(assignment_id=assignment_id, student_id=student_id).first()
    return SubmissionDTO(id=s.id, assignment_id=s.assignment_id, student_id=s.student_id, status=s.status) if s else None
