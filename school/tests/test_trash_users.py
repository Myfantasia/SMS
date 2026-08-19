import json
from django.contrib.auth.models import User
from django.test import TestCase

from apps.identity.models import StudentExtra, trash_user_account, restore_user_account, Permission


class UserAccountTrashTests(TestCase):
    def setUp(self):
        # Create the users.delete permission for the endpoint's @require_permission decorator
        Permission.objects.get_or_create(code='users.delete', defaults={'label': 'Delete Users', 'module': 'users'})

        self.operator = User.objects.create_user(username='admin3', password='x', is_superuser=True)
        student_user = User.objects.create_user(username='stu1', password='x', first_name='Stu', last_name='One')
        self.student = StudentExtra.objects.create(user=student_user, roll='stu1', status=True)

    def test_trash_blocks_login_and_stamps_fields(self):
        trash_user_account(self.student, operator=self.operator, module='Student', label='Stu One')
        self.student.refresh_from_db()
        self.student.user.refresh_from_db()
        self.assertFalse(self.student.user.is_active)
        self.assertIsNotNone(self.student.deleted_at)
        self.assertEqual(self.student.deleted_by_id, self.operator.id)
        self.assertFalse(self.client.login(username='stu1', password='x'))

    def test_restore_reallows_login(self):
        trash_user_account(self.student, operator=self.operator, module='Student', label='Stu One')
        restore_user_account(self.student, operator=self.operator, module='Student', label='Stu One')
        self.student.refresh_from_db()
        self.student.user.refresh_from_db()
        self.assertTrue(self.student.user.is_active)
        self.assertIsNone(self.student.deleted_at)
        self.assertTrue(self.client.login(username='stu1', password='x'))

    def test_delete_endpoint_soft_deletes_not_hard_deletes(self):
        self.client.force_login(self.operator)
        response = self.client.post('/api/delete-user/',
            json.dumps({'user_type': 'students', 'id': self.student.id}),
            content_type='application/json')
        response_data = json.loads(response.content)
        self.assertEqual(response_data['status'], 'success', f"API returned error: {response_data.get('message', 'unknown')}")
        self.assertTrue(StudentExtra.objects.filter(id=self.student.id).exists())
        self.student.refresh_from_db()
        self.student.user.refresh_from_db()
        self.assertFalse(self.student.user.is_active)
