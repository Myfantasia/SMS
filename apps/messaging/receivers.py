"""Event-bus subscribers for `messaging`.

Imported once from MessagingConfig.ready() (see apps.py) -- Django signal
receivers only fire if the module defining them has actually been imported,
which is the single most common first mistake when adding signals to a
codebase (this one) that has never used them before.
"""
from shared.events.bus import bus
from shared.events.types import BackgroundJobCompletedEvent, ExamResultsPublishedEvent

from . import services

_JOB_TYPE_LABELS = {
    'generate_timetable': ("Timetable generation", "/admin-dashboard/timetable"),
    'rollover_allocations': ("Allocation rollover", "/admin-dashboard/allocations"),
    'bulk_auto_allocate': ("Bulk auto-allocate", "/admin-dashboard/allocations"),
    'bulk_generate_term_results': ("Bulk results compilation", "/admin-dashboard/results"),
    'promote_students': ("Bulk student promotion", "/admin-dashboard/results"),
}


@bus.subscribe(BackgroundJobCompletedEvent)
def handle_background_job_completed(event: BackgroundJobCompletedEvent) -> None:
    """Direct relocation of orchestration/tasks.py's old `_notify_operator`
    helper -- same behavior (only the job's own operator is notified), just
    reached via the bus instead of a direct Notification import."""
    if event.operator_id is None:
        return
    label, url = _JOB_TYPE_LABELS.get(event.job_type, (event.job_type, None))
    if event.succeeded:
        title = f"{label} complete"
        message = "Your request finished successfully — open the page to see the result."
    else:
        title = f"{label} failed"
        message = f"Your request could not be completed: {event.error_message}"
    services.create_notification(recipient_id=event.operator_id, title=title, message=message, action_url=url)


@bus.subscribe(ExamResultsPublishedEvent)
def handle_exam_results_published(event: ExamResultsPublishedEvent) -> None:
    """New behavior enabled by this refactor -- today publishing/reverting an
    exam event creates no Notification at all (verified by reading
    PublishExamEventView/RevertExamEventView). Left as a narrow, single
    admin-facing notice for now; expanding this to notify affected
    students/parents individually is a real follow-on feature, not implied
    by this architecture change, so it's deliberately not done here.
    """
    if event.published_by_id is None:
        return
    action = "reverted" if event.reverted else "published"
    services.create_notification(
        recipient_id=event.published_by_id,
        title=f"Exam results {action}",
        message=f"Exam event {event.exam_event_id} results were {action} for term {event.term_id}.",
        action_url="/admin-dashboard/exams",
    )
