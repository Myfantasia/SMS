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
