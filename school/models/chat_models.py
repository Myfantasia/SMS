import uuid
from django.db import models
from django.contrib.auth.models import User
from school.models.models import StudentExtra


# ==========================================
# 1. USER CHAT PREFERENCES (New - Office Hours)
# ==========================================
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

    def __str__(self):
        return f"Chat Prefs - {self.user.username}"


# ==========================================
# 2. THE ROOM (Chat Thread)
# ==========================================
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
    related_student = models.ForeignKey(StudentExtra, on_delete=models.SET_NULL, null=True, blank=True,
                                        related_name='chat_threads')

    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.thread_type} Thread - {self.id}"


# ==========================================
# 3. THE ACCESS LIST & FALLBACK TRACKER
# ==========================================
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
        unique_together = ('thread', 'user')

    def __str__(self):
        return f"{self.user.username} in Thread {self.thread.id}"


# ==========================================
# 4. THE IMMUTABLE AUDIT TRAIL
# ==========================================
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
        ordering = ['sent_at']

    def __str__(self):
        sender_name = self.sender.username if self.sender else "Deleted User"
        return f"Msg from {sender_name} at {self.sent_at}"


# ==========================================
# 5. OFFICIAL APPROVALS & ACTIONS
# ==========================================
class ChatActionResponse(models.Model):
    """
    The digital signature for 'I Agree' buttons and Polls.
    """
    message = models.ForeignKey(MessageAudit, on_delete=models.CASCADE, related_name='responses')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='chat_actions')

    response_type = models.CharField(max_length=50)
    responded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('message', 'user')

    def __str__(self):
        return f"{self.user.username} - {self.response_type}"