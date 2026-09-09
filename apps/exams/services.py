"""Public service surface for the `exams` app.

Exam events, results entry, grading rules, publish workflow.

RULE: every function here takes and returns plain dataclasses -- never a
Django model instance or QuerySet.

This app may import services from:
    - apps.identity.services
    - apps.core.services
    - apps.academics.services

Verified during planning: `exams` does NOT depend on `staff` (grepped
exams_views.py for TeacherLeave/LongTermReliefAssignment/
TeacherStructuralAvailability -- zero hits).

Track B step 7: ExamEvent/GradingRule/ExamResult/StudentReportSummary/
ClassExamStatus physically relocated to apps/exams/models.py -- function
bodies below now import from there directly.
"""
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Optional, Sequence

from django.db import transaction

PublishStatus = Literal["Draft", "Submitted", "Published"]


@dataclass(frozen=True)
class ExamEventDTO:
    id: int
    name: str
    exam_type: str
    term_id: int
    total_marks: int
    status: str
    published_at: Optional[datetime]


@dataclass(frozen=True)
class GradingRuleDTO:
    grade_label: str
    min_score: float
    max_score: float
    remarks: str


def get_exam_event(exam_event_id: int) -> Optional[ExamEventDTO]:
    from apps.exams.models import ExamEvent

    e = ExamEvent.objects.filter(id=exam_event_id).first()
    return _event_to_dto(e) if e else None


def list_exam_events(*, term_id: Optional[int] = None) -> Sequence[ExamEventDTO]:
    from apps.exams.models import ExamEvent

    qs = ExamEvent.objects.all()
    if term_id is not None:
        qs = qs.filter(term_id=term_id)
    return tuple(_event_to_dto(e) for e in qs)


def _event_to_dto(e) -> ExamEventDTO:
    return ExamEventDTO(
        id=e.id, name=e.name, exam_type=e.exam_type, term_id=e.term_id,
        total_marks=e.total_marks, status=e.status, published_at=e.published_at,
    )


def get_grading_scale(*, curriculum: str) -> Sequence[GradingRuleDTO]:
    from apps.exams.models import GradingRule

    return tuple(
        GradingRuleDTO(grade_label=r.grade_label, min_score=float(r.min_score), max_score=float(r.max_score), remarks=r.remarks)
        for r in GradingRule.objects.filter(curriculum=curriculum)
    )


def publish_exam_results(
    *, exam_event_id: int, scope: Literal["ALL", "CLASS"], class_stream_id: Optional[int], published_by_id: Optional[int],
) -> ExamEventDTO:
    """Marks an exam event Published and fires ExamResultsPublishedEvent so
    `messaging` can notify the publisher, without `exams` importing
    anything from `messaging`. This is a narrower slice of what
    PublishExamEventView (exams_views.py) actually does today (which also
    tracks ClassExamStatus per class) -- that full logic moves here in
    Track B; this function is the event-publishing seam that can be wired
    in now without waiting for the full relocation.
    """
    from django.utils import timezone
    from apps.exams.models import ExamEvent
    from shared.events.bus import bus
    from shared.events.types import ExamResultsPublishedEvent

    event_row = ExamEvent.objects.get(id=exam_event_id)
    event_row.status = 'Published'
    event_row.published_at = timezone.now()
    event_row.save(update_fields=['status', 'published_at'])

    domain_event = ExamResultsPublishedEvent(
        exam_event_id=exam_event_id, scope=scope, class_stream_id=class_stream_id,
        term_id=event_row.term_id, published_by_id=published_by_id, reverted=False,
        occurred_at=timezone.now(),
    )
    transaction.on_commit(lambda: bus.publish(domain_event))
    return _event_to_dto(event_row)


def revert_exam_results(
    *, exam_event_id: int, scope: Literal["ALL", "CLASS"], class_stream_id: Optional[int], reverted_by_id: Optional[int],
) -> ExamEventDTO:
    from django.utils import timezone
    from apps.exams.models import ExamEvent
    from shared.events.bus import bus
    from shared.events.types import ExamResultsPublishedEvent

    event_row = ExamEvent.objects.get(id=exam_event_id)
    event_row.status = 'Submitted'
    event_row.save(update_fields=['status'])

    domain_event = ExamResultsPublishedEvent(
        exam_event_id=exam_event_id, scope=scope, class_stream_id=class_stream_id,
        term_id=event_row.term_id, published_by_id=reverted_by_id, reverted=True,
        occurred_at=timezone.now(),
    )
    transaction.on_commit(lambda: bus.publish(domain_event))
    return _event_to_dto(event_row)
