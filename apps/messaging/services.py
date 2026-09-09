"""Public service surface for the `messaging` app.

Notices, events, notifications, chat (threads/participants/audit).

RULE: every function here takes and returns plain dataclasses -- never a
Django model instance or QuerySet.

This app may import services from:
    - apps.identity.services
    - apps.academics.services

Per the import-linter contract in the plan, NO other app may import
apps.messaging (not even its services.py) directly -- reach this app only
via the event bus (shared/events). See apps/messaging/receivers.py for the
subscriber side of that.

Track B step 3: Notification (and the rest of this app's models) physically
relocated to apps/messaging/models.py -- function bodies below now import
from there directly.
"""
from dataclasses import dataclass
from datetime import datetime
from typing import Optional, Sequence

from apps.messaging.models import Notification


@dataclass(frozen=True)
class NotificationDTO:
    id: int
    recipient_id: int
    title: str
    message: str
    is_read: bool
    action_url: Optional[str]
    created_at: datetime


def create_notification(*, recipient_id: int, title: str, message: str, action_url: Optional[str] = None) -> NotificationDTO:
    n = Notification.objects.create(recipient_id=recipient_id, title=title, message=message, action_url=action_url)
    return NotificationDTO(
        id=n.id, recipient_id=n.recipient_id, title=n.title, message=n.message,
        is_read=n.is_read, action_url=n.action_url, created_at=n.created_at,
    )


def list_notifications(*, recipient_id: int, unread_only: bool = False) -> Sequence[NotificationDTO]:
    qs = Notification.objects.filter(recipient_id=recipient_id)
    if unread_only:
        qs = qs.filter(is_read=False)
    return tuple(
        NotificationDTO(
            id=n.id, recipient_id=n.recipient_id, title=n.title, message=n.message,
            is_read=n.is_read, action_url=n.action_url, created_at=n.created_at,
        )
        for n in qs
    )


def mark_notification_read(notification_id: int) -> None:
    Notification.objects.filter(id=notification_id).update(is_read=True)
