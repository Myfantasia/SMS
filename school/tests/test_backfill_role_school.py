from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase

from apps.identity.models import Role, School


class BackfillRoleSchoolTests(TestCase):
    def setUp(self):
        cache.clear()
        self.school = School.objects.create(name='Default School', level='COMBINED')

    def test_assigns_the_existing_school_to_unassigned_roles(self):
        role = Role.objects.create(name='Bursar')
        self.assertIsNone(role.school)

        call_command('backfill_role_school')

        role.refresh_from_db()
        self.assertEqual(role.school_id, self.school.id)

    def test_is_idempotent(self):
        Role.objects.create(name='Bursar')
        call_command('backfill_role_school')
        call_command('backfill_role_school')  # should not error on a second run
        self.assertEqual(Role.objects.filter(school__isnull=True).count(), 0)

    def test_dry_run_makes_no_changes(self):
        role = Role.objects.create(name='Bursar')
        call_command('backfill_role_school', '--dry-run')
        role.refresh_from_db()
        self.assertIsNone(role.school)

    def test_errors_without_a_school_row(self):
        self.school.delete()
        Role.objects.create(name='Bursar')
        call_command('backfill_role_school')  # writes to stderr, doesn't raise
        self.assertEqual(Role.objects.filter(school__isnull=True).count(), 1)
