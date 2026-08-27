from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase

from apps.identity.models import Permission, Role, School


class SeedRbacRankAndSchoolTests(TestCase):
    def setUp(self):
        cache.clear()
        self.school = School.objects.create(name='Default School', level='COMBINED')

    def test_rbac_manage_permission_is_seeded(self):
        call_command('seed_rbac')
        self.assertTrue(Permission.objects.filter(code='rbac.manage').exists())

    def test_admin_role_gets_rank_one_and_rbac_manage(self):
        call_command('seed_rbac')
        admin = Role.objects.get(name='Admin')
        self.assertEqual(admin.rank, 1)
        self.assertTrue(admin.permissions.filter(code='rbac.manage').exists())

    def test_teacher_role_gets_rank_five(self):
        call_command('seed_rbac')
        teacher = Role.objects.get(name='Teacher')
        self.assertEqual(teacher.rank, 5)

    def test_admin_and_teacher_roles_get_the_school(self):
        call_command('seed_rbac')
        admin = Role.objects.get(name='Admin')
        teacher = Role.objects.get(name='Teacher')
        self.assertEqual(admin.school_id, self.school.id)
        self.assertEqual(teacher.school_id, self.school.id)

    def test_rerunning_stays_idempotent(self):
        call_command('seed_rbac')
        call_command('seed_rbac')
        self.assertEqual(Role.objects.filter(name='Admin').count(), 1)
        self.assertEqual(Role.objects.filter(name='Teacher').count(), 1)
