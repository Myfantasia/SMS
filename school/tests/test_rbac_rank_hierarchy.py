from django.core.cache import cache
from django.test import TestCase

from apps.identity.models import Role


class RoleRankFieldTests(TestCase):
    def setUp(self):
        cache.clear()

    def test_role_can_be_created_without_a_rank(self):
        role = Role.objects.create(name='Unranked Custom Role')
        self.assertIsNone(role.rank)

    def test_role_can_be_created_with_a_rank(self):
        role = Role.objects.create(name='Principal', rank=1)
        self.assertEqual(role.rank, 1)
