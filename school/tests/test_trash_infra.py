from django.contrib.auth.models import User
from django.test import TestCase

from apps.core.models import SystemAuditLog
from apps.core.trash import soft_delete, restore
from apps.identity.models import Permission, Role


class SoftDeleteRestoreHelperTests(TestCase):
    def setUp(self):
        self.operator = User.objects.create_user(username='op', password='x')

    def test_soft_delete_stamps_fields_and_logs(self):
        role = Role.objects.create(name='Throwaway')
        soft_delete(role, operator=self.operator, module='RBAC', description='Deleted role Throwaway.')
        role.refresh_from_db()
        self.assertTrue(role.is_deleted)
        self.assertIsNotNone(role.deleted_at)
        self.assertEqual(role.deleted_by_id, self.operator.id)
        self.assertTrue(SystemAuditLog.objects.filter(action_type='DELETE', module='RBAC').exists())

    def test_restore_clears_fields_and_logs(self):
        role = Role.objects.create(name='Throwaway2', is_deleted=True)
        restore(role, operator=self.operator, module='RBAC', description='Restored role Throwaway2.')
        role.refresh_from_db()
        self.assertFalse(role.is_deleted)
        self.assertIsNone(role.deleted_at)
        self.assertIsNone(role.deleted_by_id)
        self.assertTrue(SystemAuditLog.objects.filter(action_type='RESTORE', module='RBAC').exists())


class TrashPermissionSeedTests(TestCase):
    def test_seed_rbac_excludes_trash_from_admin(self):
        from django.core.management import call_command
        call_command('seed_rbac')
        admin = Role.objects.get(name='Admin')
        self.assertFalse(admin.permissions.filter(code__startswith='trash.').exists())
        self.assertTrue(Permission.objects.filter(code='trash.view').exists())
        self.assertTrue(Permission.objects.filter(code='trash.manage').exists())
