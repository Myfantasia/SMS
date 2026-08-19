from django.contrib.auth.models import User, Group
from django.test import TestCase

from apps.identity.models import StudentExtra, trash_user_account


class DirectoryExcludesTrashedTests(TestCase):
    def setUp(self):
        admin_group, _ = Group.objects.get_or_create(name='ADMIN')
        self.admin_user = User.objects.create_user(username='admin4', password='x')
        self.admin_user.groups.add(admin_group)
        self.operator = self.admin_user

        live_user = User.objects.create_user(username='live_stu', password='x', first_name='Live', last_name='Student')
        self.live_student = StudentExtra.objects.create(user=live_user, roll='live_stu', status=True)

        trashed_user = User.objects.create_user(username='trashed_stu', password='x', first_name='Trashed', last_name='Student')
        self.trashed_student = StudentExtra.objects.create(user=trashed_user, roll='trashed_stu', status=True)
        trash_user_account(self.trashed_student, operator=self.operator, module='Student', label='Trashed Student')

    def test_trashed_student_excluded_from_directory(self):
        self.client.force_login(self.admin_user)
        response = self.client.get('/api/approved-users/students/')
        names = [row['name'] for row in response.json()['data']]
        self.assertIn(self.live_student.get_name, names)
        self.assertNotIn(self.trashed_student.get_name, names)
