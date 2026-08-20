from django.contrib.auth.models import User, Group
from django.test import TestCase

from apps.identity.models import Permission
from apps.messaging.models import Notice


class NoticeTrashTests(TestCase):
    def setUp(self):
        # HasModulePermission's superuser bypass only grants codes that exist as
        # Permission rows in the DB, so notices.edit must be seeded for the
        # DELETE test to pass RBAC even for a superuser admin.
        Permission.objects.get_or_create(code='notices.edit', defaults={'label': 'Edit Notices', 'module': 'notices'})
        admin_group, _ = Group.objects.get_or_create(name='ADMIN')
        self.admin_user = User.objects.create_user(username='admin8', password='x', is_superuser=True)
        self.admin_user.groups.add(admin_group)
        self.notice = Notice.objects.create(title='Fee Reminder', message='Pay fees by Friday.')

    def test_delete_soft_deletes(self):
        self.client.force_login(self.admin_user)
        self.client.delete(f'/api/core/notices/{self.notice.id}/')
        self.notice.refresh_from_db()
        self.assertTrue(self.notice.is_deleted)
        self.assertIsNotNone(self.notice.deleted_at)

    def test_trashed_notice_excluded_from_list(self):
        self.notice.is_deleted = True
        self.notice.save()
        self.client.force_login(self.admin_user)
        response = self.client.get('/api/core/notices/')
        body = response.json()
        rows = body['results'] if 'results' in body else body
        self.assertNotIn(self.notice.id, [row['id'] for row in rows])
