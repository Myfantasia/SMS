from datetime import timedelta

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.conf import settings
from django.core.cache import cache
from django.utils import timezone

from school.models.chat_models import ChatThread, ThreadParticipant, MessageAudit
from school.views.chat_views import check_is_admin, serialize_message_audit

EDIT_WINDOW = timedelta(hours=2)

# Per-message-type (max, window_seconds) — only 'send' was ever limited before; edit/delete/
# typing had no cap at all. 'typing' gets the most headroom since a debounced keystroke
# indicator fires far more often than an actual message under normal use.
RATE_LIMITS = {
    'send': (15, 10),
    'edit': (10, 10),
    'delete': (10, 10),
    'typing': (30, 10),
}

# A single user opening unlimited concurrent sockets (multiple tabs/devices, or a scripted
# client) had no cap at all before this. Generous enough for a real user's legitimate
# multi-tab/multi-device use, low enough to bound worst-case fan-out per user.
MAX_CONCURRENT_CONNECTIONS_PER_USER = 5
# Safety-net expiry only — disconnect() always decrements first; this just guards against
# an abnormally killed worker leaving a stale count behind forever.
CONNECTION_COUNT_TTL_SECONDS = 60 * 60 * 6


class ChatConsumer(AsyncJsonWebsocketConsumer):
    """
    One socket per open chat window. Authenticated via the Django session cookie
    (see AuthMiddlewareStack in schoolmanagement/asgi.py) — same login as the rest
    of the app, no Firebase involved. Authorization reuses the existing
    ThreadParticipant ACL that GetOrCreateDirectThreadAPI/CreateAdminGroupThreadAPI
    already populate.
    """

    async def connect(self):
        self.user = self.scope['user']
        self.thread_id = str(self.scope['url_route']['kwargs']['thread_id'])
        self.group_name = f"chat_{self.thread_id}"

        if not self.user or not self.user.is_authenticated:
            await self.close(code=4001)
            return

        is_participant = await self._is_participant(self.thread_id, self.user.id)
        if not is_participant:
            await self.close(code=4003)
            return

        if not await self._reserve_connection_slot(self.user.id):
            await self.close(code=4008)
            return
        self._connection_slot_reserved = True

        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        if getattr(self, 'group_name', None):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)
        if getattr(self, '_connection_slot_reserved', False):
            await self._release_connection_slot(self.user.id)

    async def receive_json(self, content, **kwargs):
        msg_type = content.get('type')

        if msg_type == 'send':
            await self._handle_send(content)
        elif msg_type == 'edit':
            await self._handle_edit(content)
        elif msg_type == 'delete':
            await self._handle_delete(content)
        elif msg_type == 'typing':
            await self._handle_typing()
        else:
            await self.send_json({'type': 'error', 'message': 'Unknown message type.'})

    # ------------------------------------------------------------------
    # Client -> server handlers
    # ------------------------------------------------------------------

    async def _handle_send(self, content):
        if not await self._check_rate_limit(self.user.id, 'send'):
            await self.send_json({'type': 'error', 'message': 'You are sending messages too quickly. Slow down.'})
            return

        message_body = (content.get('message_body') or '').strip()
        attachment_url = content.get('attachment_url') or None
        attachment_name = content.get('attachment_name') or None

        if not message_body and not attachment_url:
            await self.send_json({'type': 'error', 'message': 'Message cannot be empty.'})
            return

        if attachment_url and not self._is_valid_attachment_url(attachment_url):
            await self.send_json({'type': 'error', 'message': 'Invalid attachment reference.'})
            return

        thread_type = await self._get_thread_type(self.thread_id)
        if thread_type is None:
            await self.send_json({'type': 'error', 'message': 'Thread no longer exists.'})
            return

        if thread_type == 'Broadcast':
            is_admin = await database_sync_to_async(check_is_admin)(self.user)
            if not is_admin:
                await self.send_json({
                    'type': 'error',
                    'message': 'This is a broadcast channel — only administrators may post.',
                })
                return

        message = await self._create_message(
            thread_id=self.thread_id,
            sender=self.user,
            message_body=message_body,
            attachment_url=attachment_url,
            attachment_name=attachment_name,
            is_actionable=bool(content.get('is_actionable')),
            is_urgent=bool(content.get('is_urgent')),
        )

        await self.channel_layer.group_send(self.group_name, {
            'type': 'chat.message',
            'message': message,
        })
        await self._broadcast_inbox_update(self.thread_id, message)

    async def _handle_edit(self, content):
        if not await self._check_rate_limit(self.user.id, 'edit'):
            await self.send_json({'type': 'error', 'message': 'You are editing messages too quickly. Slow down.'})
            return

        message_id = self._parse_message_id(content.get('message_id'))
        new_body = (content.get('message_body') or '').strip()

        if message_id is None or not new_body:
            await self.send_json({'type': 'error', 'message': 'A valid message_id and message_body are required.'})
            return

        result = await self._edit_message(message_id, self.user, new_body)
        if result is None:
            await self.send_json({
                'type': 'error',
                'message': 'Message not found, not yours, or past the 2-hour edit window.',
            })
            return

        await self.channel_layer.group_send(self.group_name, {
            'type': 'chat.message',
            'message': result,
        })
        await self._broadcast_inbox_update(self.thread_id, result)

    async def _handle_delete(self, content):
        if not await self._check_rate_limit(self.user.id, 'delete'):
            await self.send_json({'type': 'error', 'message': 'You are deleting messages too quickly. Slow down.'})
            return

        message_id = self._parse_message_id(content.get('message_id'))
        if message_id is None:
            await self.send_json({'type': 'error', 'message': 'A valid message_id is required.'})
            return

        result = await self._delete_message(message_id, self.user)
        if result is None:
            await self.send_json({'type': 'error', 'message': 'Message not found or not yours.'})
            return

        await self.channel_layer.group_send(self.group_name, {
            'type': 'chat.message',
            'message': result,
        })
        await self._broadcast_inbox_update(self.thread_id, result)

    async def _handle_typing(self):
        if not await self._check_rate_limit(self.user.id, 'typing'):
            return  # silent drop — a typing indicator isn't worth surfacing an error for

        await self.channel_layer.group_send(self.group_name, {
            'type': 'chat.typing',
            'user_id': self.user.id,
            'user_name': self.user.get_full_name() or self.user.username,
        })

    # ------------------------------------------------------------------
    # Group event handlers (dispatched by channel_layer.group_send)
    # ------------------------------------------------------------------

    async def chat_message(self, event):
        await self.send_json({'type': 'message', 'message': event['message']})

    async def chat_typing(self, event):
        if event['user_id'] == self.user.id:
            return
        await self.send_json({'type': 'typing', 'user_id': event['user_id'], 'user_name': event['user_name']})

    # ------------------------------------------------------------------
    # Live inbox pings — reaches sidebars for threads not currently open
    # ------------------------------------------------------------------

    async def _broadcast_inbox_update(self, thread_id, message):
        participant_ids = await self._get_participant_ids(thread_id)
        for user_id in participant_ids:
            await self.channel_layer.group_send(f"inbox_{user_id}", {
                'type': 'inbox.update',
                'thread_id': thread_id,
                'message_body': message['message_body'],
                'sender_id': message['sender_id'],
                'sender_name': message['sender_name'],
                'updated_at': message['updated_at'],
            })

    # ------------------------------------------------------------------
    # DB helpers
    # ------------------------------------------------------------------

    @database_sync_to_async
    def _get_participant_ids(self, thread_id):
        return list(ThreadParticipant.objects.filter(thread_id=thread_id).values_list('user_id', flat=True))

    @database_sync_to_async
    def _is_participant(self, thread_id, user_id):
        return ThreadParticipant.objects.filter(thread_id=thread_id, user_id=user_id).exists()

    @database_sync_to_async
    def _get_thread_type(self, thread_id):
        return ChatThread.objects.filter(id=thread_id).values_list('thread_type', flat=True).first()

    @database_sync_to_async
    def _create_message(self, thread_id, sender, message_body, attachment_url, attachment_name,
                         is_actionable, is_urgent):
        thread = ChatThread.objects.get(id=thread_id)
        msg = MessageAudit.objects.create(
            thread=thread,
            sender=sender,
            message_body=message_body,
            attachment_url=attachment_url,
            attachment_name=attachment_name,
            is_actionable=is_actionable,
            is_urgent=is_urgent,
        )
        thread.save()  # bumps updated_at, which UserInboxAPI's unread logic relies on
        return serialize_message_audit(msg)

    @database_sync_to_async
    def _edit_message(self, message_id, user, new_body):
        try:
            msg = MessageAudit.objects.select_related('sender').get(id=message_id, sender=user)
        except MessageAudit.DoesNotExist:
            return None

        if msg.is_deleted or timezone.now() - msg.sent_at > EDIT_WINDOW:
            return None

        msg.message_body = new_body
        msg.is_edited = True
        msg.save()
        return serialize_message_audit(msg)

    @database_sync_to_async
    def _delete_message(self, message_id, user):
        try:
            msg = MessageAudit.objects.select_related('sender').get(id=message_id, sender=user)
        except MessageAudit.DoesNotExist:
            return None

        msg.message_body = "This message was deleted."
        msg.attachment_url = None
        msg.attachment_name = None
        msg.is_deleted = True
        msg.save()
        return serialize_message_audit(msg)

    # ------------------------------------------------------------------
    # Non-DB helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_message_id(raw):
        try:
            return int(raw)
        except (TypeError, ValueError):
            return None

    def _is_valid_attachment_url(self, url):
        # ChatAttachmentUploadAPI returns an absolute URL (request.build_absolute_uri,
        # matching the convention elsewhere in this app), so we check for the expected
        # path segment anywhere in the string rather than requiring an exact prefix.
        marker = f"{settings.MEDIA_URL}chat_attachments/{self.thread_id}/"
        return marker in url

    @database_sync_to_async
    def _check_rate_limit(self, user_id, message_type):
        # CACHES['default'] is Redis (see settings.py) — still routed through
        # database_sync_to_async like every other blocking I/O call in this consumer, so a
        # slow cache round trip can't stall the event loop out from under other connections.
        max_count, window_seconds = RATE_LIMITS[message_type]
        key = f"chat_rate_{message_type}_{user_id}"
        count = cache.get(key, 0)
        if count >= max_count:
            return False
        cache.set(key, count + 1, timeout=window_seconds)
        return True

    @database_sync_to_async
    def _reserve_connection_slot(self, user_id):
        key = f"chat_conn_count_{user_id}"
        cache.add(key, 0, timeout=CONNECTION_COUNT_TTL_SECONDS)
        count = cache.incr(key)
        if count > MAX_CONCURRENT_CONNECTIONS_PER_USER:
            cache.decr(key)
            return False
        return True

    @database_sync_to_async
    def _release_connection_slot(self, user_id):
        key = f"chat_conn_count_{user_id}"
        try:
            if cache.get(key, 0) > 0:
                cache.decr(key)
        except ValueError:
            pass  # key already expired/missing — nothing to release
