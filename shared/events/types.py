"""The event vocabulary for this codebase's modular monolith.

Each type here corresponds to a real, verified coupling point or gap found
during the pre-implementation audit -- not a speculative placeholder. Add a
new event type only when a concrete cross-app "and then notify X" need is
found; don't pre-invent events for domains that don't need them yet.

All event types are frozen dataclasses: immutable, plain data, no behavior,
no references to Django model instances (IDs only) -- so a subscriber never
accidentally holds a stale ORM object past the transaction that created it.
"""
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Optional


@dataclass(frozen=True)
class ExamResultsPublishedEvent:
    """Published when an admin publishes (or reverts) an exam event's results.

    Today, PublishExamEventView/RevertExamEventView (school/views/exams_views.py)
    create no Notification at all -- this event closes that real, verified
    gap by giving `messaging` a hook to notify affected students/parents,
    without `exams` ever importing anything from `messaging`.
    """
    exam_event_id: int
    scope: Literal["ALL", "CLASS"]
    class_stream_id: Optional[int]
    term_id: int
    published_by_id: Optional[int]
    reverted: bool
    occurred_at: datetime


@dataclass(frozen=True)
class PermissionsChangedEvent:
    """Published whenever what a user is allowed to do has changed (a role was assigned to
    or removed from them, or a role they hold had its permissions edited/deleted).

    `messaging` relays it to each affected user's live inbox connection so their open
    dashboard can re-read its permissions and redraw the sidebar, home cards and page
    controls without a reload. Carries IDs only, like every event here.
    """
    user_ids: tuple


@dataclass(frozen=True)
class BackgroundJobCompletedEvent:
    """Published when a long-running Celery job (timetable generation,
    allocation rollover, bulk auto-allocate, bulk term-result compilation)
    finishes, success or failure.

    Replaces orchestration/tasks.py's old `_notify_operator` helper, which
    previously imported Notification directly from what is now the
    `messaging` app's models -- a cross-app model import that becomes a
    boundary violation the moment `messaging` is its own app.
    """
    job_id: str
    job_type: str
    operator_id: Optional[int]
    succeeded: bool
    error_message: Optional[str]
    occurred_at: datetime


@dataclass(frozen=True)
class TermResultsCompiledEvent:
    """Published after bulk_generate_term_results_task finishes compiling
    results for a term across one or more class streams.

    Gives `analytics` (named in the original spec as "the first candidate
    for true microservice extraction") a hook to recompute/invalidate its
    aggregates without `results` ever needing to know `analytics` exists.
    """
    term_id: int
    class_stream_ids: tuple
    operator_id: Optional[int]
    occurred_at: datetime
