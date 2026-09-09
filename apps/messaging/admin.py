"""Admin registrations for the `messaging` app."""
from django.contrib import admin
from unfold.admin import ModelAdmin

from apps.messaging.models import (
    ChatUserProfile, ChatThread, ThreadParticipant, MessageAudit, ChatActionResponse,
)


@admin.register(ChatUserProfile)
class ChatUserProfileAdmin(ModelAdmin):
    list_display = ('user', 'auto_reply_enabled')
    list_filter = ('auto_reply_enabled',)
    search_fields = ('user__username',)


@admin.register(ChatThread)
class ChatThreadAdmin(ModelAdmin):
    list_display = ('id', 'thread_type', 'related_student', 'is_active')
    list_filter = ('thread_type', 'is_active')


@admin.register(ThreadParticipant)
class ThreadParticipantAdmin(ModelAdmin):
    list_display = ('thread', 'user', 'joined_at')
    list_filter = ('thread',)
    search_fields = ('user__username',)


@admin.register(MessageAudit)
class MessageAuditAdmin(ModelAdmin):
    list_display = ('thread', 'sender', 'sent_at', 'is_urgent', 'is_deleted')
    list_filter = ('is_urgent', 'is_deleted', 'is_edited', 'is_actionable', 'thread')
    search_fields = ('message_body', 'sender__username')


@admin.register(ChatActionResponse)
class ChatActionResponseAdmin(ModelAdmin):
    list_display = ('message', 'user', 'response_type', 'responded_at')
    list_filter = ('response_type',)
    search_fields = ('response_type', 'user__username')
