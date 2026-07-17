from channels.db import database_sync_to_async
from channels.routing import URLRouter
from channels.testing import WebsocketCommunicator
from django.contrib.auth.models import User
from django.test import TransactionTestCase
from django.utils import timezone

from school.models.chat_models import ChatThread, ThreadParticipant, MessageAudit
from school.routing import websocket_urlpatterns

# Tested directly against the URLRouter, bypassing AuthMiddlewareStack (which reads a
# real session cookie) — the standard Channels testing pattern is to inject scope['user']
# manually instead of simulating a full session login for every test.
test_application = URLRouter(websocket_urlpatterns)


class ChatConsumerTests(TransactionTestCase):
    """
    Covers ChatConsumer's connect-time authorization and the send/edit security rules
    described in the messaging plan: participant-only access, one-way Broadcast threads,
    and the server-enforced 2-hour edit window.
    """

    def setUp(self):
        self.alice = User.objects.create_user(username='alice_chat', password='x')
        self.bob = User.objects.create_user(username='bob_chat', password='x')
        self.mallory = User.objects.create_user(username='mallory_chat', password='x')  # not a participant

        self.thread = ChatThread.objects.create(thread_type='Direct')
        ThreadParticipant.objects.create(thread=self.thread, user=self.alice)
        ThreadParticipant.objects.create(thread=self.thread, user=self.bob)

    async def _connect(self, user, thread_id):
        communicator = WebsocketCommunicator(test_application, f"/ws/chat/{thread_id}/")
        communicator.scope['user'] = user
        connected, _ = await communicator.connect()
        return communicator, connected

    async def test_two_participants_exchange_message(self):
        alice_comm, alice_connected = await self._connect(self.alice, self.thread.id)
        bob_comm, bob_connected = await self._connect(self.bob, self.thread.id)
        self.assertTrue(alice_connected)
        self.assertTrue(bob_connected)

        try:
            await alice_comm.send_json_to({'type': 'send', 'message_body': 'hello bob'})

            alice_echo = await alice_comm.receive_json_from()
            self.assertEqual(alice_echo['type'], 'message')
            self.assertEqual(alice_echo['message']['message_body'], 'hello bob')
            self.assertEqual(alice_echo['message']['sender_id'], self.alice.id)

            bob_echo = await bob_comm.receive_json_from()
            self.assertEqual(bob_echo['message']['message_body'], 'hello bob')
            self.assertEqual(bob_echo['message']['sender_id'], self.alice.id)
        finally:
            await alice_comm.disconnect()
            await bob_comm.disconnect()

    async def test_non_participant_rejected_on_connect(self):
        communicator, connected = await self._connect(self.mallory, self.thread.id)
        self.assertFalse(connected)

    async def test_anonymous_user_rejected_on_connect(self):
        from django.contrib.auth.models import AnonymousUser
        communicator, connected = await self._connect(AnonymousUser(), self.thread.id)
        self.assertFalse(connected)

    async def test_broadcast_send_restricted_to_admins(self):
        broadcast = await database_sync_to_async(ChatThread.objects.create)(thread_type='Broadcast')
        await database_sync_to_async(ThreadParticipant.objects.create)(thread=broadcast, user=self.alice)

        communicator, connected = await self._connect(self.alice, broadcast.id)
        self.assertTrue(connected)

        try:
            await communicator.send_json_to({'type': 'send', 'message_body': 'not allowed'})
            response = await communicator.receive_json_from()
            self.assertEqual(response['type'], 'error')

            exists = await database_sync_to_async(
                MessageAudit.objects.filter(thread=broadcast).exists
            )()
            self.assertFalse(exists)
        finally:
            await communicator.disconnect()

    async def test_edit_outside_window_rejected(self):
        communicator, connected = await self._connect(self.alice, self.thread.id)
        self.assertTrue(connected)

        try:
            old_message = await database_sync_to_async(MessageAudit.objects.create)(
                thread=self.thread, sender=self.alice, message_body='old message'
            )
            # sent_at is auto_now_add, so backdate it past the 2-hour window via .update()
            # (a plain .save() would stamp it back to "now").
            await database_sync_to_async(
                MessageAudit.objects.filter(id=old_message.id).update
            )(sent_at=timezone.now() - timezone.timedelta(hours=3))

            await communicator.send_json_to({
                'type': 'edit', 'message_id': old_message.id, 'message_body': 'edited!',
            })
            response = await communicator.receive_json_from()
            self.assertEqual(response['type'], 'error')

            refreshed = await database_sync_to_async(
                MessageAudit.objects.get
            )(id=old_message.id)
            self.assertEqual(refreshed.message_body, 'old message')
            self.assertFalse(refreshed.is_edited)
        finally:
            await communicator.disconnect()

    async def test_edit_within_window_succeeds(self):
        communicator, connected = await self._connect(self.alice, self.thread.id)
        self.assertTrue(connected)

        try:
            message = await database_sync_to_async(MessageAudit.objects.create)(
                thread=self.thread, sender=self.alice, message_body='original'
            )

            await communicator.send_json_to({
                'type': 'edit', 'message_id': message.id, 'message_body': 'updated',
            })
            response = await communicator.receive_json_from()
            self.assertEqual(response['type'], 'message')
            self.assertEqual(response['message']['message_body'], 'updated')
            self.assertTrue(response['message']['is_edited'])
        finally:
            await communicator.disconnect()

    async def _connect_inbox(self, user):
        communicator = WebsocketCommunicator(test_application, "/ws/inbox/")
        communicator.scope['user'] = user
        connected, _ = await communicator.connect()
        return communicator, connected

    async def test_inbox_ping_delivered_to_other_participant(self):
        alice_comm, alice_connected = await self._connect(self.alice, self.thread.id)
        bob_inbox, bob_inbox_connected = await self._connect_inbox(self.bob)
        self.assertTrue(alice_connected)
        self.assertTrue(bob_inbox_connected)

        try:
            await alice_comm.send_json_to({'type': 'send', 'message_body': 'ping the sidebar'})
            await alice_comm.receive_json_from()  # alice's own echo on chat_{thread_id}

            ping = await bob_inbox.receive_json_from()
            self.assertEqual(ping['type'], 'inbox.update')
            self.assertEqual(ping['thread_id'], str(self.thread.id))
            self.assertEqual(ping['message_body'], 'ping the sidebar')
            self.assertEqual(ping['sender_id'], self.alice.id)
        finally:
            await alice_comm.disconnect()
            await bob_inbox.disconnect()

    async def test_inbox_rejects_anonymous_user(self):
        from django.contrib.auth.models import AnonymousUser
        communicator, connected = await self._connect_inbox(AnonymousUser())
        self.assertFalse(connected)
