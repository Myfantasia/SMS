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


class Notification(models.Model):
    """
    The permanent ledger of alerts. This will feed the bell icon on the Parent Dashboard.
    """
    # Links directly to the base User model so it can be used for Parents, Teachers, or Students later
    recipient = models.ForeignKey(User, on_delete=models.CASCADE, related_name='notifications')
    title = models.CharField(max_length=100)
    message = models.TextField()

    # Crucial for the UI "Unread" badge
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    # Optional: A URL path to redirect the user when they click the notification
    action_url = models.CharField(max_length=255, null=True, blank=True)

    class Meta:
        db_table = 'school_notification'
        ordering = ['-created_at']  # Ensures the newest notifications appear at the top

    def __str__(self):
        return f"To: {self.recipient.username} - {self.title} (Read: {self.is_read})"


class ChatUserProfile(models.Model):
    """
    Stores individual settings for chat, particularly the 'Office Hours'
    we discussed to prevent teacher burnout.
    """
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='chat_profile')

    # E.g., 08:00:00
    working_hours_start = models.TimeField(null=True, blank=True)
    # E.g., 17:00:00 (5 PM)
    working_hours_end = models.TimeField(null=True, blank=True)

    # If True, the system auto-replies to parents outside working hours
    auto_reply_enabled = models.BooleanField(default=True)
    auto_reply_message = models.CharField(
        max_length=255,
        default="I am currently offline. I will respond during standard school working hours."
    )

    class Meta:
        db_table = 'school_chatuserprofile'

    def __str__(self):
        return f"Chat Prefs - {self.user.username}"


class ChatThread(models.Model):
    """
    The master container for a conversation.
    """
    THREAD_TYPES = [
        ('Direct', '1-on-1 Direct Message'),
        ('Broadcast', 'One-way Broadcast (Admin to Many)'),
        ('Group', 'Group Chat')
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    thread_type = models.CharField(max_length=20, choices=THREAD_TYPES, default='Direct')

    # THE SIBLING FIX: Optionally link this chat to a specific student.
    # If a parent has twins, the teacher can have two separate threads with the same parent.
    related_student = models.ForeignKey('identity.StudentExtra', on_delete=models.SET_NULL, null=True, blank=True,
                                        related_name='chat_threads')

    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'school_chatthread'

    def __str__(self):
        return f"{self.thread_type} Thread - {self.id}"


class ThreadParticipant(models.Model):
    """
    Acts as the bouncer for the ChatThread.
    Powers the Smart Email Fallback system.
    """
    thread = models.ForeignKey(ChatThread, on_delete=models.CASCADE, related_name='participants')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='chat_participations')

    last_read_timestamp = models.DateTimeField(null=True, blank=True)
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'school_threadparticipant'
        unique_together = ('thread', 'user')

    def __str__(self):
        return f"{self.user.username} in Thread {self.thread.id}"


class MessageAudit(models.Model):
    """
    The permanent, legal record of every message sent. Written directly by
    ChatConsumer (Django Channels) at send time — server-authoritative, no
    external sync involved.
    """
    thread = models.ForeignKey(ChatThread, on_delete=models.CASCADE, related_name='messages')
    sender = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='sent_messages')

    message_body = models.TextField()

    # Attachments are uploaded via ChatAttachmentUploadAPI to MEDIA_ROOT/chat_attachments/<thread_id>/
    attachment_url = models.URLField(max_length=1000, null=True, blank=True)
    attachment_name = models.CharField(max_length=255, null=True, blank=True)

    # Actionable flag (for polls/approvals)
    is_actionable = models.BooleanField(default=False)

    # THE RED ALERT FIX: Marks a message as highly critical, bypassing Do Not Disturb
    is_urgent = models.BooleanField(default=False)

    is_edited = models.BooleanField(default=False)
    is_deleted = models.BooleanField(default=False)

    sent_at = models.DateTimeField(auto_now_add=True)
    synced_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'school_messageaudit'
        ordering = ['sent_at']

    def __str__(self):
        sender_name = self.sender.username if self.sender else "Deleted User"
        return f"Msg from {sender_name} at {self.sent_at}"


class ChatActionResponse(models.Model):
    """
    The digital signature for 'I Agree' buttons and Polls.
    """
    message = models.ForeignKey(MessageAudit, on_delete=models.CASCADE, related_name='responses')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='chat_actions')

    response_type = models.CharField(max_length=50)
    responded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'school_chatactionresponse'
        unique_together = ('message', 'user')

    def __str__(self):
        return f"{self.user.username} - {self.response_type}"
