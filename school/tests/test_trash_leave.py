from django.contrib.auth.models import User, Group
from django.test import TestCase

from apps.identity.models import TeacherExtra, Permission
from apps.staff.models import TeacherLeave


class LeaveTrashTests(TestCase):
    def setUp(self):
        # Ensure the leave permissions exist
        Permission.objects.get_or_create(code='leave.view', defaults={'label': 'View Leave', 'module': 'leave'})
        Permission.objects.get_or_create(code='leave.edit', defaults={'label': 'Edit Leave', 'module': 'leave'})
        admin_group, _ = Group.objects.get_or_create(name='ADMIN')
        self.admin_user = User.objects.create_user(username='admin5', password='x', is_superuser=True)
        self.admin_user.groups.add(admin_group)
        teacher_user = User.objects.create_user(username='teach1', password='x', first_name='Tee', last_name='Cher')
        self.teacher = TeacherExtra.objects.create(user=teacher_user, status=True)
        self.leave = TeacherLeave.objects.create(
            teacher=self.teacher, leave_type='Sick', start_date='2026-08-01', end_date='2026-08-03',
        )

    def test_admin_delete_soft_deletes(self):
        self.client.force_login(self.admin_user)
        response = self.client.delete(f'/api/core/leaves/{self.leave.id}/')
        self.leave.refresh_from_db()
        self.assertTrue(self.leave.is_deleted, f"Response status: {response.status_code}, leave.is_deleted: {self.leave.is_deleted}")
        self.assertIsNotNone(self.leave.deleted_at)

    def test_trashed_leave_excluded_from_listing(self):
        self.leave.is_deleted = True
        self.leave.save()
        self.client.force_login(self.admin_user)
        response = self.client.get('/api/core/leaves/')
        self.assertEqual(response.status_code, 200, f"GET failed with {response.status_code}: {response.content}")
        data = response.json()
        ids = [row['id'] for row in data['results']] if 'results' in data else [row['id'] for row in data]
        self.assertNotIn(self.leave.id, ids)
