from io import StringIO

from django.core.management import call_command
from django.test import TestCase

from apps.identity.models import Permission, Role
from school.management.commands.populate_demo_staff import ROLES

FINANCE_CODES = {
    'finance.view', 'finance.edit', 'finance.record_payment', 'finance.void', 'finance.approve_adjustment',
}


def seed():
    call_command('seed_rbac', stdout=StringIO(), stderr=StringIO())


class FinanceRBACSeedingTests(TestCase):
    def test_seed_rbac_creates_finance_permission_codes(self):
        seed()
        actual_codes = set(Permission.objects.filter(code__in=FINANCE_CODES).values_list('code', flat=True))
        self.assertEqual(actual_codes, FINANCE_CODES)

    def test_finance_officer_role_has_at_least_the_finance_permissions(self):
        seed()
        role = Role.objects.get(name='Finance Officer')
        codes = set(role.permissions.values_list('code', flat=True))
        self.assertTrue(FINANCE_CODES.issubset(codes))

    def test_seed_rbac_is_safe_to_run_twice(self):
        seed()
        seed()
        self.assertEqual(Permission.objects.filter(code='finance.edit').count(), 1)
        self.assertEqual(Role.objects.filter(name='Finance Officer').count(), 1)

    def test_existing_finance_officer_role_is_extended_not_overwritten(self):
        extra = Permission.objects.create(code='classes.view', label='View classes', module='Classes')
        role = Role.objects.create(name='Finance Officer', description='Owner-edited', rank=4, is_system_role=True)
        role.permissions.add(extra)

        seed()

        role.refresh_from_db()
        self.assertEqual(Role.objects.filter(name='Finance Officer').count(), 1)
        self.assertEqual((role.description, role.rank, role.is_system_role), ('Owner-edited', 4, True))
        codes = set(role.permissions.values_list('code', flat=True))
        self.assertIn('classes.view', codes)
        self.assertTrue(FINANCE_CODES.issubset(codes))

    def test_populate_demo_staff_finance_officer_has_all_finance_codes(self):
        finance_officer_entry = next((r for r in ROLES if r[0] == 'Finance Officer'), None)
        self.assertIsNotNone(finance_officer_entry, "Finance Officer role not found in ROLES")
        # Tuple shape: (name, description, codes, rank)
        codes = finance_officer_entry[2]
        self.assertTrue(FINANCE_CODES.issubset(set(codes)))
