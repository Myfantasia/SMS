import json

from django.contrib.auth.models import User
from django.contrib.contenttypes.models import ContentType
from django.test import TestCase, RequestFactory

from apps.academics.models import ClassStream, Curriculum, GradeLevel, Tier
from apps.identity.models import Permission, Role, StudentExtra, UserRole
from apps.finance.models_fees import FeeCategory
from apps.finance.services_fees import post_ledger_entry
from school.views.class_views import api_class_enrollments


def setUpModule():
    """`finance` has no real migrations yet, so post_migrate never creates its
    ContentType rows; pre-warm them before any test transaction opens (see
    test_adjustments.setUpModule for the full rationale)."""
    ContentType.objects.get_for_model(FeeCategory)


class ClassEnrollmentDashboardFeeBalanceTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        curriculum = Curriculum.objects.create(name='CBC FB')
        tier = Tier.objects.create(name='Junior FB', curriculum=curriculum)
        grade = GradeLevel.objects.create(name='Grade 7FB', numeric_order=7, curriculum_type='CBC', curriculum=curriculum, tier=tier)
        self.stream = ClassStream.objects.create(name='7FB Blue', grade=grade)
        self.admin = User.objects.create_user(username='fee_balance_admin', password='x', is_superuser=True, is_staff=True)
        user = User.objects.create_user(username='fee_balance_student', password='x')
        self.student = StudentExtra.objects.create(user=user, cl=self.stream, enrollment_state='Active', roll='FB-1')
        self.category = FeeCategory.objects.create(name='Tuition')
        # Superuser bypass only covers Permission rows that exist, so create the ones the view checks.
        for code in ('classes.view', 'finance.view'):
            Permission.objects.get_or_create(code=code, defaults={'label': code, 'module': 'Finance'})

    def _get(self, user=None):
        request = self.factory.get(f'/api/enrollments/class/{self.stream.id}/')
        request.user = user or self.admin
        response = api_class_enrollments(request, self.stream.id)
        self.assertEqual(response.status_code, 200)
        payload = json.loads(response.content)
        self.assertEqual(payload['status'], 'success', payload)
        return payload['data']

    def _active_row(self, data, student):
        return next(r for r in data['active_roster'] if r['id'] == student.id)

    def test_active_student_with_no_finance_history_shows_zero_balance(self):
        row = self._active_row(self._get(), self.student)
        self.assertEqual(row['fee_balance'], 0)

    def test_active_student_with_outstanding_charge_shows_real_balance(self):
        post_ledger_entry(student=self.student, entry_type='charge', amount=12000, reference=self.category, description='Term fee')
        row = self._active_row(self._get(), self.student)
        self.assertEqual(row['fee_balance'], 12000)

    def test_balance_is_latest_running_balance_not_a_sum_of_entries(self):
        post_ledger_entry(student=self.student, entry_type='charge', amount=12000, reference=self.category, description='Term fee')
        post_ledger_entry(student=self.student, entry_type='payment', amount=-5000, reference=self.category, description='Part payment')
        row = self._active_row(self._get(), self.student)
        self.assertEqual(row['fee_balance'], 7000)

    def test_overpaid_student_shows_negative_balance_unclamped(self):
        post_ledger_entry(student=self.student, entry_type='charge', amount=1000, reference=self.category, description='Term fee')
        post_ledger_entry(student=self.student, entry_type='payment', amount=-1500, reference=self.category, description='Overpayment')
        row = self._active_row(self._get(), self.student)
        self.assertEqual(row['fee_balance'], -500)

    def test_exited_student_with_ledger_balance_shows_real_balance(self):
        exited_user = User.objects.create_user(username='fee_balance_exited', password='x')
        exited = StudentExtra.objects.create(
            user=exited_user, cl=None, enrollment_state='Transferred', roll='FB-2',
            enrollment_notes=f'Transferred out of {self.stream.name}',
        )
        post_ledger_entry(student=exited, entry_type='charge', amount=8000, reference=self.category, description='Term fee')

        data = self._get()
        row = next(r for r in data['exited_history'] if r['id'] == exited.id)
        self.assertEqual(row['fee_balance'], 8000)

    def test_exited_student_with_no_finance_history_shows_zero(self):
        exited_user = User.objects.create_user(username='fee_balance_exited0', password='x')
        exited = StudentExtra.objects.create(
            user=exited_user, cl=None, enrollment_state='Expelled', roll='FB-3',
            enrollment_notes=f'Expelled from {self.stream.name}',
        )
        row = next(r for r in self._get()['exited_history'] if r['id'] == exited.id)
        self.assertEqual(row['fee_balance'], 0)

    def _make_user_with(self, username, codes):
        user = User.objects.create_user(username=username, password='x')
        role = Role.objects.create(name=f'Role for {username}')
        role.permissions.set(Permission.objects.filter(code__in=codes))
        UserRole.objects.create(user=user, role=role)
        return user

    def test_caller_without_finance_view_gets_no_balance(self):
        post_ledger_entry(student=self.student, entry_type='charge', amount=12000, reference=self.category, description='Term fee')
        teacher = self._make_user_with('fee_balance_teacher', ['classes.view'])
        row = self._active_row(self._get(user=teacher), self.student)
        self.assertIsNone(row['fee_balance'])

    def test_caller_with_finance_view_gets_the_balance(self):
        post_ledger_entry(student=self.student, entry_type='charge', amount=12000, reference=self.category, description='Term fee')
        officer = self._make_user_with('fee_balance_officer', ['classes.view', 'finance.view'])
        row = self._active_row(self._get(user=officer), self.student)
        self.assertEqual(row['fee_balance'], 12000)

    def test_each_student_gets_their_own_latest_balance(self):
        other = StudentExtra.objects.create(
            user=User.objects.create_user(username='fee_balance_student_2', password='x'),
            cl=self.stream, enrollment_state='Suspended', roll='FB-2',
        )
        post_ledger_entry(student=self.student, entry_type='charge', amount=12000, reference=self.category, description='Term fee')
        post_ledger_entry(student=other, entry_type='charge', amount=9000, reference=self.category, description='Term fee')
        post_ledger_entry(student=other, entry_type='payment', amount=-4000, reference=self.category, description='Part payment')
        data = self._get()
        self.assertEqual(self._active_row(data, self.student)['fee_balance'], 12000)
        self.assertEqual(self._active_row(data, other)['fee_balance'], 5000)
