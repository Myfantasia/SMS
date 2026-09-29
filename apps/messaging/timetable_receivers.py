from shared.events.timetable_events import TimetablePublishedEvent
from shared.events.bus import bus

from . import services

_TIMETABLE_URL = None  # teachers have no single timetable page; the notice text is self-contained


@bus.subscribe(TimetablePublishedEvent)
def handle_timetable_published(event: TimetablePublishedEvent) -> None:
    """Tell every affected teacher the timetable is live, and give the publishing operator a summary."""
    notified = set()
    for user_id in event.teacher_user_ids:
        if user_id in notified:
            continue
        notified.add(user_id)
        services.create_notification(
            recipient_id=user_id,
            title="Timetable published",
            message=f"The timetable '{event.timetable_name}' is now live. Check your schedule for any changes.",
            action_url=_TIMETABLE_URL,
        )

    if event.published_by_id is not None:
        services.create_notification(
            recipient_id=event.published_by_id,
            title="Timetable published",
            message=f"'{event.timetable_name}' is now live and visible to teachers.",
            action_url=_TIMETABLE_URL,
        )
