from django.contrib.auth.models import User, Group
from django.test import TestCase

from apps.identity.models import Permission, Role, School, UserRole
from apps.identity.services import get_user_permission_codes
from school.rbac import invalidate_user_permission_cache


class RoleTrashTests(TestCase):
    def setUp(self):
        # RoleViewSet.get_queryset() (RBAC rank-hierarchy work) requires a School row to
        # resolve get_current_school_id(), and perform_destroy now runs
        # validate_rank_authority() before deleting -- a plain ADMIN-group user with no
        # ranked Role of their own no longer clears that guard. This test is about the
        # trash/soft-delete mechanic, not rank semantics, so the actor is made a superuser
        # (bypasses both guards unconditionally) rather than given a synthetic rank.
        self.school = School.objects.create(name='Default School', level='COMBINED')
        admin_group, _ = Group.objects.get_or_create(name='ADMIN')
        self.admin_user = User.objects.create_superuser(username='admin6', password='x', email='admin6@test.com')
        self.admin_user.groups.add(admin_group)

        self.permission = Permission.objects.create(code='custom.thing', label='Custom thing', module='Custom')
        # school= required: get_queryset() filters Role by the current school, and a role
        # with school=None (the old default) is invisible to RoleViewSet's DELETE endpoint.
        self.role = Role.objects.create(name='CustomRole', school=self.school)
        self.role.permissions.add(self.permission)

        self.holder_user = User.objects.create_user(username='holder1', password='x')
        UserRole.objects.create(user=self.holder_user, role=self.role)

    def test_trashed_role_no_longer_grants_permissions(self):
        self.assertIn('custom.thing', get_user_permission_codes(self.holder_user.id))

        from apps.core.trash import soft_delete
        soft_delete(self.role, operator=self.admin_user, module='RBAC', description='Deleted role CustomRole.')
        invalidate_user_permission_cache(self.holder_user.id)

        self.assertNotIn('custom.thing', get_user_permission_codes(self.holder_user.id))

    def test_delete_endpoint_soft_deletes(self):
        # Verify holder_user has the permission before delete
        self.assertIn('custom.thing', get_user_permission_codes(self.holder_user.id))

        self.client.force_login(self.admin_user)
        self.client.delete(f'/api/core/rbac/roles/{self.role.id}/')
        self.role.refresh_from_db()
        self.assertTrue(self.role.is_deleted)

        # Verify the permission is immediately gone (cache invalidation happened in perform_destroy)
        self.assertNotIn('custom.thing', get_user_permission_codes(self.holder_user.id))
