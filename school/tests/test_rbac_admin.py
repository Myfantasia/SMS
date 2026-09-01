from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import TestCase
from django.urls import reverse

from apps.core.models import SystemAuditLog
from apps.identity.models import Permission, Role, UserRole
from apps.identity.services import get_user_permission_codes


class RoleAdminTests(TestCase):
    def setUp(self):
        cache.clear()
        self.superuser = User.objects.create_superuser(
            username='root_admin', password='x', email='root@test.com')
        self.client.force_login(self.superuser)
        self.finance_view = Permission.objects.create(
            code='finance.view', label='View finance', module='Finance')

    def test_create_role_writes_audit_log(self):
        response = self.client.post(reverse('admin:identity_role_add'), {
            'name': 'Bursar', 'description': '', 'rank': 6,
            'permissions': [self.finance_view.id],
        })
        self.assertEqual(response.status_code, 302, response.content)
        role = Role.objects.get(name='Bursar')
        self.assertTrue(role.permissions.filter(code='finance.view').exists())
        self.assertTrue(SystemAuditLog.objects.filter(
            module='RBAC', action_type='CREATE', description__icontains='Bursar').exists())

    def test_editing_a_roles_permissions_invalidates_holders_cache(self):
        role = Role.objects.create(name='Custom Role', rank=6)
        user = User.objects.create_user(username='holder', password='x')
        UserRole.objects.create(user=user, role=role)
        # Prime the cache with the pre-edit (empty) permission set.
        self.assertEqual(get_user_permission_codes(user.id), frozenset())

        response = self.client.post(
            reverse('admin:identity_role_change', args=[role.id]),
            {'name': 'Custom Role', 'description': '', 'rank': 6,
             'permissions': [self.finance_view.id]},
        )
        self.assertEqual(response.status_code, 302, response.content)
        self.assertIn('finance.view', get_user_permission_codes(user.id))

    def test_admin_role_cannot_be_renamed(self):
        admin_role = Role.objects.create(name='Admin', rank=1, is_system_role=True)
        response = self.client.get(reverse('admin:identity_role_change', args=[admin_role.id]))
        self.assertEqual(response.status_code, 200)
        # A system role's name must not render as an editable text input -- don't assert
        # on Django's exact readonly-field markup, just that the editable input is gone.
        self.assertNotContains(response, '<input type="text" name="name"')

    def test_admin_role_cannot_be_deleted(self):
        admin_role = Role.objects.create(name='Admin', rank=1, is_system_role=True)
        response = self.client.post(reverse('admin:identity_role_delete', args=[admin_role.id]), {'post': 'yes'})
        admin_role.refresh_from_db()
        self.assertFalse(admin_role.is_deleted)

    def test_deleting_a_custom_role_soft_deletes_and_invalidates_cache(self):
        role = Role.objects.create(name='Temp Role', rank=6)
        user = User.objects.create_user(username='temp_holder', password='x')
        UserRole.objects.create(user=user, role=role)
        role.permissions.add(self.finance_view)
        self.assertIn('finance.view', get_user_permission_codes(user.id))

        response = self.client.post(reverse('admin:identity_role_delete', args=[role.id]), {'post': 'yes'})
        self.assertEqual(response.status_code, 302, response.content)
        role.refresh_from_db()
        self.assertTrue(role.is_deleted)
        self.assertNotIn('finance.view', get_user_permission_codes(user.id))
