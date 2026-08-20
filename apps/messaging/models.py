"""Models for the `messaging` app.

Notices, events, notifications, chat (threads/participants/audit).

Track B step 3: physically relocated here from
school/models/{models.py (Notice/Event/Notification),chat_models.py (deleted
entirely)} via a hand-written SeparateDatabaseAndState migration pair.
Meta.db_table is pinned to each model's original table name below so the
underlying tables never physically move -- only Django's bookkeeping of
which app owns the model.

Track B step 9 (final): StudentExtra physically relocated to
apps/identity/models.py. `ChatThread.related_student` below uses an
app-label-qualified string reference ('identity.StudentExtra') instead of
a Python import -- Django resolves this through its app registry, so
`messaging` never needs to import `apps.identity.models` directly.
"""
import uuid

from django.contrib.auth.models import User
from django.db import models

from school.validators import safe_document_validator


class Notice(models.Model):
    """
    Upgraded from your original model. Added a title, target audience, and file uploads.
    """
    AUDIENCE_CHOICES = [
        ('All', 'All'),
        ('Teachers', 'Teachers Only'),
        ('Parents', 'Parents Only'),
        ('Students', 'Students Only'),
    ]

    title = models.CharField(max_length=200, default="General Notice")
    message = models.TextField()  # Upgraded to TextField for longer announcements
    date = models.DateField(auto_now_add=True)
    by = models.CharField(max_length=50, default='School Admin')

    # New fields for better UI filtering
    audience = models.CharField(max_length=20, choices=AUDIENCE_CHOICES, default='All')
    attachment = models.FileField(
        upload_to='notices/',
        null=True,
        blank=True,
        validators=[safe_document_validator]
    )

    # --- ADDED: Urgency Flag ---
    is_urgent = models.BooleanField(default=False)

    is_deleted = models.BooleanField(default=False, db_index=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    deleted_by = models.ForeignKey('auth.User', on_delete=models.SET_NULL, null=True, blank=True, related_name='+')

    class Meta:
        db_table = 'school_notice'

    def __str__(self):
        return self.title


def _purge_notice(notice):
    if notice.attachment:
        notice.attachment.delete(save=False)
    notice.delete()


def _register_notice_trash():
    from apps.core.trash import register_trash_entity, TrashEntityConfig
    register_trash_entity('notices', TrashEntityConfig(
        model=Notice, flag_field='is_deleted', flag_true=True, flag_false=False,
        auto_purge=True,
        label_fn=lambda n: n.title,
        purge_fn=_purge_notice,
    ))


_register_notice_trash()


class Event(models.Model):
    """
    Powers the School Calendar (e.g., Sports Day, Mid-Term Breaks, KCSE Start Date).
    """
    title = models.CharField(max_length=200)
    description = models.TextField(null=True, blank=True)
    start_time = models.DateTimeField()
    end_time = models.DateTimeField()

    # e.g., 'Holiday', 'Exam', 'Meeting' - helps color-code the React Calendar
    event_type = models.CharField(max_length=50, default='General')
    is_active = models.BooleanField(default=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    deleted_by = models.ForeignKey('auth.User', on_delete=models.SET_NULL, null=True, blank=True, related_name='+')

    class Meta:
        db_table = 'school_event'

    def __str__(self):
        return f"{self.title} ({self.start_time.date()})"


def _register_event_trash():
    from apps.core.trash import register_trash_entity, TrashEntityConfig
    register_trash_entity('events', TrashEntityConfig(
        model=Event, flag_field='is_active', flag_true=False, flag_false=True,
        auto_purge=True,
        label_fn=lambda e: e.title,
    ))


_register_event_trash()


