from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase

from apps.identity.models import Role


class PopulateDemoStaffRankTests(TestCase):
    """
    Every occupation Role populate_demo_staff seeds must get a real rank so
    validate_rank_authority (school/rbac.py) lets a non-superuser Admin manage
    it -- a role with rank=None is unmanageable except by a superuser.
    """

    def setUp(self):
        cache.clear()
        call_command('seed_rbac')

    def test_every_seeded_role_has_a_rank(self):
        call_command('populate_demo_staff')
        occupation_roles = Role.objects.exclude(name__in=['Admin', 'Teacher'])
        self.assertGreater(occupation_roles.count(), 0)
        for role in occupation_roles:
            self.assertIsNotNone(role.rank, f"{role.name} has no rank set")

    def test_deputy_principal_ranks_above_teacher_authority(self):
        call_command('populate_demo_staff')
        deputy = Role.objects.get(name='Deputy Principal')
        teacher = Role.objects.get(name='Teacher')
        # Lower rank number = more authority; Deputy Principal must outrank Teacher.
        self.assertLess(deputy.rank, teacher.rank)

    def test_rerunning_is_idempotent_and_keeps_rank(self):
        call_command('populate_demo_staff')
        call_command('populate_demo_staff')
        secretary_roles = Role.objects.filter(name='Secretary')
        self.assertEqual(secretary_roles.count(), 1)
        self.assertEqual(secretary_roles.first().rank, 6)

    def test_rank_change_in_source_data_is_applied_on_rerun(self):
        call_command('populate_demo_staff')
        role = Role.objects.get(name='Secretary')
        role.rank = 99
        role.save(update_fields=['rank'])
        call_command('populate_demo_staff')
        role.refresh_from_db()
        self.assertEqual(role.rank, 6)
