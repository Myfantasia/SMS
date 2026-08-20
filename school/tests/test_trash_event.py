from django.contrib.auth.models import User, Group
from django.test import TestCase
from django.utils import timezone

from apps.identity.models import Permission
from apps.messaging.models import Event


class EventTrashTests(TestCase):
    def setUp(self):
        # HasModulePermission's superuser bypass only grants codes that exist as
        # Permission rows in the DB, so events.edit must be seeded for the
        # DELETE test to pass RBAC even for a superuser admin.
        Permission.objects.get_or_create(code='events.edit', defaults={'label': 'Edit Events', 'module': 'events'})
        admin_group, _ = Group.objects.get_or_create(name='ADMIN')
        self.admin_user = User.objects.create_user(username='admin7', password='x', is_superuser=True)
        self.admin_user.groups.add(admin_group)
        self.event = Event.objects.create(
            title='Sports Day', start_time=timezone.now(), end_time=timezone.now(),
        )

    def test_delete_soft_deletes_via_is_active(self):
        self.client.force_login(self.admin_user)
        self.client.delete(f'/api/core/events/{self.event.id}/')
        self.event.refresh_from_db()
        self.assertFalse(self.event.is_active)
        self.assertIsNotNone(self.event.deleted_at)

    def test_trashed_event_excluded_from_list(self):
        self.event.is_active = False
        self.event.save()
        self.client.force_login(self.admin_user)
        response = self.client.get('/api/core/events/')
        body = response.json()
        rows = body['results'] if 'results' in body else body
        self.assertNotIn(self.event.id, [row['id'] for row in rows])

    def test_serializer_does_not_leak_deleted_by(self):
        self.client.force_login(self.admin_user)
        response = self.client.get(f'/api/core/events/{self.event.id}/')
        self.assertNotIn('deleted_by', response.json())
        self.assertNotIn('deleted_at', response.json())
