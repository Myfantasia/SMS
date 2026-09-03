from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse

from apps.messaging.models import ChatThread, ThreadParticipant, MessageAudit


class LeaveConversationAPITests(TestCase):
    def setUp(self):
        self.alice = User.objects.create_user(username='alice_rest', password='x')
        self.bob = User.objects.create_user(username='bob_rest', password='x')
        self.mallory = User.objects.create_user(username='mallory_rest', password='x')

        self.thread = ChatThread.objects.create(thread_type='Direct')
        ThreadParticipant.objects.create(thread=self.thread, user=self.alice)
        ThreadParticipant.objects.create(thread=self.thread, user=self.bob)

    def test_non_participant_gets_403(self):
        self.client.force_login(self.mallory)
        response = self.client.post(reverse('chat-leave', args=[self.thread.id]))
        self.assertEqual(response.status_code, 403)

    def test_leave_removes_participant_but_keeps_thread_active(self):
        self.client.force_login(self.alice)
        response = self.client.post(reverse('chat-leave', args=[self.thread.id]))
        self.assertEqual(response.status_code, 200)

        self.assertFalse(ThreadParticipant.objects.filter(thread=self.thread, user=self.alice).exists())
        self.thread.refresh_from_db()
        self.assertTrue(self.thread.is_active)  # bob is still in it

    def test_last_participant_leaving_soft_archives_thread(self):
        self.client.force_login(self.alice)
        self.client.post(reverse('chat-leave', args=[self.thread.id]))

        self.client.force_login(self.bob)
        response = self.client.post(reverse('chat-leave', args=[self.thread.id]))
        self.assertEqual(response.status_code, 200)

        self.thread.refresh_from_db()
        self.assertFalse(self.thread.is_active)
        # audit trail is untouched by leaving/archiving
        MessageAudit.objects.create(thread=self.thread, sender=self.alice, message_body='kept forever')
        self.assertEqual(MessageAudit.objects.filter(thread=self.thread).count(), 1)


class ThreadParticipantsAPITests(TestCase):
    def setUp(self):
        self.alice = User.objects.create_user(
            username='alice_roster', password='x', first_name='Alice', last_name='A')
        self.bob = User.objects.create_user(
            username='bob_roster', password='x', first_name='Bob', last_name='B', is_staff=True)
        self.mallory = User.objects.create_user(username='mallory_roster', password='x')

        self.thread = ChatThread.objects.create(thread_type='Group')
        ThreadParticipant.objects.create(thread=self.thread, user=self.alice)
        ThreadParticipant.objects.create(thread=self.thread, user=self.bob)

    def test_non_participant_gets_403(self):
        self.client.force_login(self.mallory)
        response = self.client.get(reverse('chat-participants', args=[self.thread.id]))
        self.assertEqual(response.status_code, 403)

    def test_participant_sees_roster_with_roles(self):
        self.client.force_login(self.alice)
        response = self.client.get(reverse('chat-participants', args=[self.thread.id]))
        self.assertEqual(response.status_code, 200)

        participants = {p['name']: p['role'] for p in response.json()['participants']}
        self.assertEqual(participants['Alice A'], 'User')
        self.assertEqual(participants['Bob B'], 'Admin')


class InboxLastMessagePreviewTests(TestCase):
    def setUp(self):
        self.alice = User.objects.create_user(
            username='alice_preview', password='x', first_name='Alice')
        self.bob = User.objects.create_user(
            username='bob_preview', password='x', first_name='Bob')

        self.thread = ChatThread.objects.create(thread_type='Direct')
        ThreadParticipant.objects.create(thread=self.thread, user=self.alice)
        ThreadParticipant.objects.create(thread=self.thread, user=self.bob)

    def test_last_message_preview_prefixed_you_for_own_message(self):
        MessageAudit.objects.create(thread=self.thread, sender=self.alice, message_body='hey bob')

        self.client.force_login(self.alice)
        response = self.client.get(reverse('chat-user-inbox'))
        self.assertEqual(response.status_code, 200)

        row = next(r for r in response.json()['inbox'] if r['thread_id'] == str(self.thread.id))
        self.assertEqual(row['last_message'], 'You: hey bob')

    def test_last_message_preview_no_prefix_for_direct_recipient(self):
        MessageAudit.objects.create(thread=self.thread, sender=self.alice, message_body='hey bob')

        self.client.force_login(self.bob)
        response = self.client.get(reverse('chat-user-inbox'))
        row = next(r for r in response.json()['inbox'] if r['thread_id'] == str(self.thread.id))
        self.assertEqual(row['last_message'], 'hey bob')

    def test_last_message_preview_truncated_past_60_chars(self):
        long_body = 'x' * 100
        MessageAudit.objects.create(thread=self.thread, sender=self.alice, message_body=long_body)

        self.client.force_login(self.bob)
        response = self.client.get(reverse('chat-user-inbox'))
        row = next(r for r in response.json()['inbox'] if r['thread_id'] == str(self.thread.id))
        self.assertEqual(row['last_message'], 'x' * 57 + '...')

    def test_no_messages_yields_null_preview(self):
        self.client.force_login(self.alice)
        response = self.client.get(reverse('chat-user-inbox'))
        row = next(r for r in response.json()['inbox'] if r['thread_id'] == str(self.thread.id))
        self.assertIsNone(row['last_message'])
