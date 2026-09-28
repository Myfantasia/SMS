from shared.events.allocation_events import AllocationsPublishedEvent
from shared.events.bus import bus

from . import services

_ALLOCATIONS_URL = None  # teachers have no single allocations page; the notice text is self-contained


@bus.subscribe(AllocationsPublishedEvent)
def handle_allocations_published(event: AllocationsPublishedEvent) -> None:
    """Tell every affected teacher their allocation changed, and give the publishing admin a summary."""
    notified = set()
    for user_id in event.teacher_user_ids:
        if user_id in notified:
            continue
        notified.add(user_id)
        services.create_notification(
            recipient_id=user_id,
            title="Teaching allocation published",
            message="Your class and subject allocations for the term were published. "
                    "Check your classes to see what changed.",
            action_url=_ALLOCATIONS_URL,
        )

    if event.published_by_id is not None:
        classes = len(event.class_ids)
        timetable_note = ("The draft timetable was updated to match." if event.timetable_synced
                          else "No draft timetable was updated - regenerate one to apply these changes.")
        services.create_notification(
            recipient_id=event.published_by_id,
            title="Allocations published",
            message=f"Published {classes} class(es). {timetable_note}",
            action_url=_ALLOCATIONS_URL,
        )
