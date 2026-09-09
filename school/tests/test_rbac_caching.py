"""
get_user_permission_codes() used to run a fresh Permission/Role/UserRole join on every
single call — and it's called on every request to any RBAC-gated view. This pins down
the Redis-backed caching layer added on top of it: a cache hit reflects a role change
only after invalidation (or TTL expiry), and per-user role assignment/removal
(UserRoleAssignmentAPIView) invalidates immediately rather than waiting out the TTL.
"""
from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import TestCase

from apps.identity.models import Permission, Role, UserRole
from school.rbac import get_user_permission_codes, invalidate_user_permission_cache


class RbacPermissionCachingTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(username='rbac_cache_user', password='x')
        self.perm_a = Permission.objects.create(code='widgets.view', label='View Widgets', module='Widgets')
        self.perm_b = Permission.objects.create(code='widgets.edit', label='Edit Widgets', module='Widgets')
        self.role = Role.objects.create(name='Widget Viewer')
        self.role.permissions.add(self.perm_a)
        UserRole.objects.create(user=self.user, role=self.role)

    def test_codes_are_cached_after_first_resolution(self):
        first = get_user_permission_codes(self.user)
        self.assertEqual(first, {'widgets.view'})

        # Grant a second permission directly on the DB — a cached call must NOT see it yet.
        self.role.permissions.add(self.perm_b)
        cached = get_user_permission_codes(self.user)
        self.assertEqual(cached, {'widgets.view'})

    def test_invalidation_makes_a_new_role_assignment_visible_immediately(self):
        get_user_permission_codes(self.user)  # populate the cache

        other_role = Role.objects.create(name='Widget Editor')
        other_role.permissions.add(self.perm_b)
        UserRole.objects.create(user=self.user, role=other_role)
        invalidate_user_permission_cache(self.user.id)

        refreshed = get_user_permission_codes(self.user)
        self.assertEqual(refreshed, {'widgets.view', 'widgets.edit'})

    def test_superuser_bypasses_cache_and_role_lookup_entirely(self):
        superuser = User.objects.create_superuser(username='rbac_super', password='x', email='s@x.test')
        codes = get_user_permission_codes(superuser)
        self.assertIn('widgets.view', codes)
        self.assertIn('widgets.edit', codes)
