from django.core.cache import cache
from django.test import TestCase

from apps.identity.models import Role
from school.serializers.rbac_serializers import RoleSerializer


class RoleRankFieldTests(TestCase):
    def setUp(self):
        cache.clear()

    def test_role_can_be_created_without_a_rank(self):
        role = Role.objects.create(name='Unranked Custom Role')
        self.assertIsNone(role.rank)

    def test_role_can_be_created_with_a_rank(self):
        role = Role.objects.create(name='Principal', rank=1)
        self.assertEqual(role.rank, 1)


class RoleSerializerRankFieldTests(TestCase):
    def setUp(self):
        cache.clear()

    def test_rank_is_serialized(self):
        role = Role.objects.create(name='Principal', rank=1)
        data = RoleSerializer(role).data
        self.assertEqual(data['rank'], 1)

    def test_rank_is_writable_and_optional(self):
        serializer = RoleSerializer(data={'name': 'Bursar', 'rank': 3})
        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertEqual(serializer.validated_data['rank'], 3)

        serializer_no_rank = RoleSerializer(data={'name': 'Custom Role'})
        self.assertTrue(serializer_no_rank.is_valid(), serializer_no_rank.errors)
        self.assertNotIn('rank', serializer_no_rank.validated_data)


from django.contrib.auth.models import User

from apps.identity.models import Permission, UserRole, Role
from apps.identity.services import get_user_effective_rank


class GetUserEffectiveRankTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(username='ranked_user', password='x')

    def test_superuser_is_rank_negative_one(self):
        su = User.objects.create_superuser(username='root', password='x', email='root@test.com')
        self.assertEqual(get_user_effective_rank(su.id), -1)

    def test_user_with_no_roles_is_none(self):
        self.assertIsNone(get_user_effective_rank(self.user.id))

    def test_user_with_one_ranked_role(self):
        role = Role.objects.create(name='Class Teacher', rank=4)
        UserRole.objects.create(user=self.user, role=role)
        self.assertEqual(get_user_effective_rank(self.user.id), 4)

    def test_effective_rank_is_the_minimum_across_roles(self):
        UserRole.objects.create(user=self.user, role=Role.objects.create(name='Class Teacher', rank=4))
        UserRole.objects.create(user=self.user, role=Role.objects.create(name='Subject Teacher', rank=5))
        self.assertEqual(get_user_effective_rank(self.user.id), 4)

    def test_unranked_roles_are_ignored(self):
        UserRole.objects.create(user=self.user, role=Role.objects.create(name='Custom Unranked'))
        self.assertIsNone(get_user_effective_rank(self.user.id))

    def test_soft_deleted_roles_are_ignored(self):
        role = Role.objects.create(name='Deleted Role', rank=2, is_deleted=True)
        UserRole.objects.create(user=self.user, role=role)
        self.assertIsNone(get_user_effective_rank(self.user.id))


from apps.identity.services import get_undelegatable_permission_codes


class GetUndelegatablePermissionCodesTests(TestCase):
    def setUp(self):
        cache.clear()
        self.finance_view = Permission.objects.create(code='finance.view', label='View finance', module='Finance')
        self.exams_view = Permission.objects.create(code='exams.view', label='View exams', module='Exams')

    def test_superuser_can_delegate_anything(self):
        su = User.objects.create_superuser(username='root', password='x', email='root@test.com')
        result = get_undelegatable_permission_codes(su.id, ['finance.view', 'exams.view'])
        self.assertEqual(result, frozenset())

    def test_actor_holding_all_codes_has_nothing_undelegatable(self):
        user = User.objects.create_user(username='principal', password='x')
        role = Role.objects.create(name='Principal', rank=1)
        role.permissions.set([self.finance_view, self.exams_view])
        UserRole.objects.create(user=user, role=role)
        result = get_undelegatable_permission_codes(user.id, ['finance.view'])
        self.assertEqual(result, frozenset())

    def test_actor_missing_a_code_gets_it_back(self):
        user = User.objects.create_user(username='deputy', password='x')
        role = Role.objects.create(name='Deputy', rank=2)
        role.permissions.set([self.exams_view])  # no finance.view
        UserRole.objects.create(user=user, role=role)
        result = get_undelegatable_permission_codes(user.id, ['finance.view', 'exams.view'])
        self.assertEqual(result, frozenset({'finance.view'}))


from rest_framework.exceptions import PermissionDenied

from school.rbac import validate_rank_authority, validate_permission_delegation


class ValidateRankAuthorityTests(TestCase):
    def setUp(self):
        cache.clear()

    def _user_at_rank(self, username, rank):
        user = User.objects.create_user(username=username, password='x')
        role = Role.objects.create(name=f'{username}_role', rank=rank)
        UserRole.objects.create(user=user, role=role)
        return user

    def test_superuser_bypasses(self):
        su = User.objects.create_superuser(username='root', password='x', email='root@test.com')
        validate_rank_authority(su, 1)  # does not raise, even for rank 1

    def test_actor_cannot_manage_own_rank(self):
        principal = self._user_at_rank('principal', 1)
        with self.assertRaises(PermissionDenied):
            validate_rank_authority(principal, 1)

    def test_actor_cannot_manage_a_more_senior_rank(self):
        deputy = self._user_at_rank('deputy', 2)
        with self.assertRaises(PermissionDenied):
            validate_rank_authority(deputy, 1)

    def test_actor_can_manage_a_strictly_junior_rank(self):
        principal = self._user_at_rank('principal2', 1)
        validate_rank_authority(principal, 6)  # does not raise

    def test_peers_cannot_manage_each_other(self):
        senior_teacher = self._user_at_rank('senior_teacher', 3)
        with self.assertRaises(PermissionDenied):
            validate_rank_authority(senior_teacher, 3)

    def test_null_target_rank_is_blocked_for_non_superuser(self):
        principal = self._user_at_rank('principal3', 1)
        with self.assertRaises(PermissionDenied):
            validate_rank_authority(principal, None)

    def test_roleless_actor_cannot_manage_any_ranked_role(self):
        user = User.objects.create_user(username='no_roles', password='x')
        with self.assertRaises(PermissionDenied):
            validate_rank_authority(user, 6)


class ValidatePermissionDelegationTests(TestCase):
    def setUp(self):
        cache.clear()
        self.finance_view = Permission.objects.create(code='finance.view', label='View finance', module='Finance')

    def test_superuser_bypasses(self):
        su = User.objects.create_superuser(username='root2', password='x', email='root2@test.com')
        validate_permission_delegation(su, ['finance.view'])  # does not raise

    def test_actor_missing_a_code_raises(self):
        deputy = User.objects.create_user(username='deputy2', password='x')
        role = Role.objects.create(name='Deputy2', rank=2)  # no finance.view
        UserRole.objects.create(user=deputy, role=role)
        with self.assertRaises(PermissionDenied):
            validate_permission_delegation(deputy, ['finance.view'])

    def test_actor_holding_all_codes_does_not_raise(self):
        bursar = User.objects.create_user(username='bursar', password='x')
        role = Role.objects.create(name='Bursar Role', rank=3)
        role.permissions.set([self.finance_view])
        UserRole.objects.create(user=bursar, role=role)
        validate_permission_delegation(bursar, ['finance.view'])  # does not raise
