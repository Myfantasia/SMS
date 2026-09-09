"""Public service surface for the `results` app.

Aggregated per-subject/per-student/per-class term results.

RULE: every function here takes and returns plain dataclasses -- never a
Django model instance or QuerySet.

This app may import services from:
    - apps.identity.services
    - apps.academics.services
    - apps.exams.services

Note: StudentTermResult.results_withheld (a finance-fee gate) and
.days_present/.days_absent (attendance data) are defined on the model but
verified to be never read or written anywhere in the codebase today. Left
as inert columns here too -- don't invent a live apps.finance/apps.attendance
services call for logic that doesn't exist yet (see those apps' own notes).

Track B step 7: SubjectTermResult/StudentTermResult/ClassPerformanceAnalytics
physically relocated to apps/results/models.py -- function bodies below now
import from there directly.
"""
from dataclasses import dataclass
from typing import Optional, Sequence


@dataclass(frozen=True)
class StudentTermResultDTO:
    id: int
    student_id: int
    term_id: int
    class_stream_id: Optional[int]
    mean_marks: Optional[float]
    mean_grade: Optional[str]
    results_withheld: bool


@dataclass(frozen=True)
class SubjectTermResultDTO:
    id: int
    student_id: int
    subject_id: int
    term_id: int


@dataclass(frozen=True)
class ClassPerformanceDTO:
    id: int
    term_id: int
    class_stream_id: int


def get_student_term_result(*, student_id: int, term_id: int) -> Optional[StudentTermResultDTO]:
    from apps.results.models import StudentTermResult

    r = StudentTermResult.objects.filter(student_id=student_id, term_id=term_id).first()
    if not r:
        return None
    return StudentTermResultDTO(
        id=r.id, student_id=r.student_id, term_id=r.term_id, class_stream_id=r.class_stream_id,
        mean_marks=float(r.mean_marks) if r.mean_marks is not None else None,
        mean_grade=r.mean_grade, results_withheld=r.results_withheld,
    )


def list_subject_term_results(*, student_id: int, term_id: int) -> Sequence[SubjectTermResultDTO]:
    from apps.results.models import SubjectTermResult

    return tuple(
        SubjectTermResultDTO(id=r.id, student_id=r.student_id, subject_id=r.subject_id, term_id=r.term_id)
        for r in SubjectTermResult.objects.filter(student_id=student_id, term_id=term_id)
    )


def get_class_performance(*, term_id: int, class_stream_id: int) -> Optional[ClassPerformanceDTO]:
    from apps.results.models import ClassPerformanceAnalytics

    r = ClassPerformanceAnalytics.objects.filter(term_id=term_id, class_stream_id=class_stream_id).first()
    return ClassPerformanceDTO(id=r.id, term_id=r.term_id, class_stream_id=r.class_stream_id) if r else None


def generate_results_for_stream(*, class_stream_id: int, term_id: int) -> dict:
    """Wraps school/views/results_views.py's generate_results_for_stream
    (called today by orchestration's bulk_generate_term_results_task).
    Returns {"students_assessed": int, "error": str | None}.
    """
    from apps.academics.models import ClassStream, ExamTerm
    from school.views.results_views import generate_results_for_stream as _generate

    stream = ClassStream.objects.get(id=class_stream_id)
    term = ExamTerm.objects.get(id=term_id)
    return _generate(stream, term)
