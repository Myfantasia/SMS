"""
A user's open dashboard must adapt when an admin changes their permissions. The server side of
that: every place that changes what a user may do (assign/remove a role, edit a role's
permissions, delete a role) clears that user's cached permissions AND announces the change on
the event bus, and the messaging app relays it to the user's live inbox connection so the
dashboard can re-read its permissions without a reload.
"""
from unittest import mock

from channels.layers import get_channel_layer
from channels.testing import WebsocketCommunicator
from channels.routing import URLRouter
from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import TestCase, TransactionTestCase
from rest_framework.test import APIClient

from apps.identity.models import Permission, Role, School, UserRole
from school.rbac import announce_permissions_changed, get_user_permission_codes
from school.routing import websocket_urlpatterns
from shared.events.bus import bus
from shared.events.types import PermissionsChangedEvent


class _EventCollector:
    """Subscribes to PermissionsChangedEvent for the duration of a test."""

    def __init__(self):
        self.events = []

    def __enter__(self):
        def _receiver(sender, event, **kwargs):
            self.events.append(event)
        self._receiver = _receiver
        bus._signal.connect(_receiver, sender=PermissionsChangedEvent, weak=False)
        return self

    def __exit__(self, *exc):
        bus._signal.disconnect(self._receiver, sender=PermissionsChangedEvent)


class AnnouncePermissionsChangedTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='ppush_user', password='x')
        self.perm = Permission.objects.create(code='ppush.view', label='View', module='PPush')
        self.role = Role.objects.create(name='PPush Viewer')
        self.role.permissions.add(self.perm)

    def test_clears_cached_permissions_and_publishes_event_on_commit(self):
        UserRole.objects.create(user=self.user, role=self.role)
        self.assertEqual(get_user_permission_codes(self.user), {'ppush.view'})  # warm the cache

        other = Permission.objects.create(code='ppush.edit', label='Edit', module='PPush')
        self.role.permissions.add(other)
        self.assertEqual(get_user_permission_codes(self.user), {'ppush.view'})  # still cached

        with _EventCollector() as collector:
            with self.captureOnCommitCallbacks(execute=True):
                announce_permissions_changed([self.user.id])

        self.assertEqual(get_user_permission_codes(self.user), {'ppush.view', 'ppush.edit'})
        self.assertEqual(len(collector.events), 1)
        self.assertEqual(collector.events[0].user_ids, (self.user.id,))

    def test_no_event_when_nobody_is_affected(self):
        with _EventCollector() as collector:
            with self.captureOnCommitCallbacks(execute=True):
                announce_permissions_changed([])
        self.assertEqual(collector.events, [])

    def test_duplicate_ids_are_collapsed(self):
        with _EventCollector() as collector:
            with self.captureOnCommitCallbacks(execute=True):
                announce_permissions_changed([self.user.id, self.user.id])
        self.assertEqual(collector.events[0].user_ids, (self.user.id,))


class RoleApiAnnouncesTests(TestCase):
    """The admin-facing endpoints that change access must all announce it."""

    def setUp(self):
        self.admin = User.objects.create_superuser(username='ppush_admin', password='x', email='a@x.test')
        self.target = User.objects.create_user(username='ppush_target', password='x')
        self.perm = Permission.objects.create(code='ppush2.view', label='View', module='PPush2')
        self.perm2 = Permission.objects.create(code='ppush2.edit', label='Edit', module='PPush2')
        # The roles API scopes to the (single) School row; see get_current_school_id.
        self.school = School.objects.create(name='Push Test School', level='COMBINED')
        self.role = Role.objects.create(name='PPush2 Role', rank=5, school=self.school)
        self.role.permissions.add(self.perm)
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def _announced_ids(self, collector):
        return sorted({uid for e in collector.events for uid in e.user_ids})

    def test_assigning_a_role_announces_to_that_user(self):
        with _EventCollector() as collector, self.captureOnCommitCallbacks(execute=True):
            resp = self.client.post('/api/core/rbac/assignments/', {'user_id': self.target.id, 'role_id': self.role.id}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(self._announced_ids(collector), [self.target.id])

    def test_removing_a_role_announces_to_that_user(self):
        UserRole.objects.create(user=self.target, role=self.role)
        with _EventCollector() as collector, self.captureOnCommitCallbacks(execute=True):
            resp = self.client.delete('/api/core/rbac/assignments/', {'user_id': self.target.id, 'role_id': self.role.id}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(self._announced_ids(collector), [self.target.id])

    def test_editing_a_roles_permissions_announces_to_every_holder_and_refreshes_their_cache(self):
        other_holder = User.objects.create_user(username='ppush_other', password='x')
        UserRole.objects.create(user=self.target, role=self.role)
        UserRole.objects.create(user=other_holder, role=self.role)
        self.assertEqual(get_user_permission_codes(self.target), {'ppush2.view'})  # warm cache

        with _EventCollector() as collector, self.captureOnCommitCallbacks(execute=True):
            resp = self.client.patch(
                f'/api/core/rbac/roles/{self.role.id}/',
                {'permission_ids': [self.perm.id, self.perm2.id]}, format='json',
            )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(self._announced_ids(collector), sorted([self.target.id, other_holder.id]))
        # The stale 90s cache must not survive a role edit.
        self.assertEqual(get_user_permission_codes(self.target), {'ppush2.view', 'ppush2.edit'})


class InboxRelayTests(TransactionTestCase):
    """The messaging app forwards the event to the user's own inbox group only."""

    def test_event_reaches_the_users_inbox_socket_and_nobody_elses(self):
        import asyncio
        from channels.db import database_sync_to_async

        alice = User.objects.create_user(username='ppush_alice', password='x')
        bob = User.objects.create_user(username='ppush_bob', password='x')
        app = URLRouter(websocket_urlpatterns)

        async def scenario():
            comm_a = WebsocketCommunicator(app, '/ws/inbox/')
            comm_a.scope['user'] = alice
            comm_b = WebsocketCommunicator(app, '/ws/inbox/')
            comm_b.scope['user'] = bob
            self.assertTrue((await comm_a.connect())[0])
            self.assertTrue((await comm_b.connect())[0])

            await database_sync_to_async(
                lambda: bus.publish(PermissionsChangedEvent(user_ids=(alice.id,)))
            )()

            msg = await comm_a.receive_json_from(timeout=3)
            self.assertEqual(msg['type'], 'permissions.changed')
            self.assertTrue(await comm_b.receive_nothing(timeout=0.5))
            await comm_a.disconnect()
            await comm_b.disconnect()

        asyncio.run(scenario())

    def test_relay_failure_does_not_break_the_publisher(self):
        alice = User.objects.create_user(username='ppush_alice2', password='x')
        with mock.patch('apps.messaging.services.get_channel_layer', side_effect=RuntimeError('redis down')):
            # Must not raise: a dead channel layer only means the dashboard falls back to polling.
            bus.publish(PermissionsChangedEvent(user_ids=(alice.id,)))
