from django.contrib.auth.models import User, Group
from django.test import TestCase

from apps.identity.models import Permission, Role, UserRole
from apps.academics.models import Subject


class TrashAPITests(TestCase):
    def setUp(self):
        self.superuser = User.objects.create_user(username='super1', password='x', is_superuser=True)
        self.subject = Subject.objects.create(code='SCI101', name='Science')
        self.subject.soft_delete(operator_user=self.superuser)

    def test_superuser_can_list_trash(self):
        self.client.force_login(self.superuser)
        response = self.client.get('/api/trash/subjects/')
        self.assertEqual(response.status_code, 200)
        ids = [row['id'] for row in response.json()['data']]
        self.assertIn(self.subject.id, ids)

    def test_admin_without_permission_is_denied(self):
        admin_group, _ = Group.objects.get_or_create(name='ADMIN')
        plain_admin = User.objects.create_user(username='plainadmin', password='x')
        plain_admin.groups.add(admin_group)
        self.client.force_login(plain_admin)
        response = self.client.get('/api/trash/subjects/')
        self.assertEqual(response.status_code, 403)

    def test_admin_with_trash_permission_can_restore(self):
        admin_group, _ = Group.objects.get_or_create(name='ADMIN')
        granted_admin = User.objects.create_user(username='grantedadmin', password='x')
        granted_admin.groups.add(admin_group)
        role = Role.objects.create(name='TrashKeeper')
        role.permissions.add(
            Permission.objects.create(code='trash.view', label='View Trash', module='Trash'),
            Permission.objects.create(code='trash.manage', label='Manage Trash', module='Trash'),
        )
        UserRole.objects.create(user=granted_admin, role=role)

        self.client.force_login(granted_admin)
        response = self.client.post(f'/api/trash/subjects/{self.subject.id}/restore/')
        self.assertEqual(response.status_code, 200)
        self.subject.refresh_from_db()
        self.assertFalse(self.subject.is_deleted)

    def test_unknown_entity_type_404s(self):
        self.client.force_login(self.superuser)
        response = self.client.get('/api/trash/not-a-real-type/')
        self.assertEqual(response.status_code, 404)

    def test_cannot_restore_a_live_row(self):
        live_subject = Subject.objects.create(code='MAT202', name='Mathematics')
        self.client.force_login(self.superuser)
        response = self.client.post(f'/api/trash/subjects/{live_subject.id}/restore/')
        self.assertEqual(response.status_code, 400)

    def test_cannot_purge_a_live_row(self):
        live_subject = Subject.objects.create(code='MAT203', name='Mathematics II')
        self.client.force_login(self.superuser)
        response = self.client.post(f'/api/trash/subjects/{live_subject.id}/purge/')
        self.assertEqual(response.status_code, 400)
        self.assertTrue(Subject.objects.filter(id=live_subject.id).exists())
