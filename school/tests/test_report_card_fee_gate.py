from django.contrib.auth.models import User
from django.contrib.contenttypes.models import ContentType
from django.test import TestCase
from rest_framework.test import APIRequestFactory

from apps.finance.models_fees import FeeCategory, FeeClearancePolicy
from apps.finance.services_fees import grant_clearance_override, post_ledger_entry
from apps.identity.models import Permission, Role, UserRole
from apps.results.models import StudentTermResult
from school.tests.base import ExamTestDataMixin
from school.views.results_views import StudentReportCardAPIView


def setUpModule():
    """Ledger entries used to simulate a student balance reference a FeeCategory
    through a GenericForeignKey -- `finance` has no real migrations, so the
    ContentType row is not pre-created by post_migrate. Pre-warm it here,
    before any test's transaction opens, same convention as
    apps/finance/tests/test_fee_clearance.py and test_clearance_policy.py."""
    ContentType.objects.get_for_model(FeeCategory)


class ReportCardFeeGateTests(ExamTestDataMixin, TestCase):
    """Covers Task 19 (spec section 4.9 amendment): StudentReportCardAPIView.get()
    calls apps.finance.services.is_gate_blocked(gate='report_card') -- not
    is_fees_clear directly -- so the block is real only when the school has
    turned FeeClearancePolicy.block_report_cards on. The policy defaults OFF
    (Task 28), so every test here that expects a 403/withhold turns it on
    first via _enable_policy(); tests proving the OFF-by-default and
    at-or-below-grace-threshold cases deliberately leave/set it accordingly.
    """

    def setUp(self):
        self.factory = APIRequestFactory()
        self.view = StudentReportCardAPIView.as_view()
        self.term_summary = StudentTermResult.objects.create(
            student=self.student, term=self.term, class_stream=self.stream_cbc,
            total_marks=805.67, mean_marks=72.73, mean_grade='EE',
            stream_position=1, is_published=True,
        )
        self.category = FeeCategory.objects.create(name='Tuition')

    def _get(self, user, search=''):
        request = self.factory.get('/api/results/report-card/', {'search': search})
        request.user = user
        return self.view(request)

    def _enable_policy(self, grace_threshold=0):
        policy = FeeClearancePolicy.get_solo()
        policy.block_report_cards = True
        policy.grace_threshold = grace_threshold
        policy.save()

    def _make_override_granter(self):
        """A user holding finance.override_clearance, the permission
        grant_clearance_override requires of its `granted_by` argument (see
        apps/finance/tests/test_clearance_policy.py's ClearancePolicyTestData.make_user
        for the same pattern)."""
        Permission.objects.get_or_create(
            code='finance.override_clearance',
            defaults={'label': 'finance.override_clearance', 'module': 'Finance'},
        )
        granter = User.objects.create_user(username='gate_granter', password='x')
        role = Role.objects.create(name='Gate granter role')
        role.permissions.set(Permission.objects.filter(code='finance.override_clearance'))
        UserRole.objects.create(user=granter, role=role)
        return granter

    def test_policy_off_by_default_never_blocks_even_with_large_balance(self):
        # FeeClearancePolicy.block_report_cards defaults False (Task 28) --
        # the gate must be a complete no-op until a school opts in.
        post_ledger_entry(
            student=self.student, entry_type='charge', amount=15000,
            reference=self.category, description='Term fee',
        )
        response = self._get(self.student_user, search=self.student.roll)
        self.assertEqual(response.status_code, 200)
        self.term_summary.refresh_from_db()
        self.assertFalse(self.term_summary.results_withheld)

    def test_student_with_outstanding_balance_is_blocked(self):
        self._enable_policy()
        post_ledger_entry(
            student=self.student, entry_type='charge', amount=15000,
            reference=self.category, description='Term fee',
        )
        response = self._get(self.student_user, search=self.student.roll)
        self.assertEqual(response.status_code, 403)
        self.term_summary.refresh_from_db()
        self.assertTrue(self.term_summary.results_withheld)

    def test_student_with_zero_balance_can_view(self):
        self._enable_policy()
        response = self._get(self.student_user, search=self.student.roll)
        self.assertEqual(response.status_code, 200)

    def test_admin_can_view_regardless_of_balance(self):
        self._enable_policy()
        post_ledger_entry(
            student=self.student, entry_type='charge', amount=15000,
            reference=self.category, description='Term fee',
        )
        response = self._get(self.admin_user, search=self.student.roll)
        self.assertEqual(response.status_code, 200)

    def test_results_withheld_clears_once_balance_is_settled(self):
        self._enable_policy()
        post_ledger_entry(
            student=self.student, entry_type='charge', amount=15000,
            reference=self.category, description='Term fee',
        )
        self._get(self.student_user, search=self.student.roll)
        self.term_summary.refresh_from_db()
        self.assertTrue(self.term_summary.results_withheld)

        post_ledger_entry(
            student=self.student, entry_type='payment', amount=-15000,
            reference=self.category, description='Payment',
        )
        response = self._get(self.student_user, search=self.student.roll)
        self.assertEqual(response.status_code, 200)
        self.term_summary.refresh_from_db()
        self.assertFalse(self.term_summary.results_withheld)

    def test_granted_override_lets_student_through_despite_balance(self):
        self._enable_policy()
        post_ledger_entry(
            student=self.student, entry_type='charge', amount=15000,
            reference=self.category, description='Term fee',
        )
        granter = self._make_override_granter()
        grant_clearance_override(
            student=self.student, gate='report_card', granted_by=granter,
            reason='hardship', term=self.term,
        )
        response = self._get(self.student_user, search=self.student.roll)
        self.assertEqual(response.status_code, 200)
        self.term_summary.refresh_from_db()
        self.assertFalse(self.term_summary.results_withheld)

    def test_balance_at_grace_threshold_is_not_blocked(self):
        self._enable_policy(grace_threshold=500)
        post_ledger_entry(
            student=self.student, entry_type='charge', amount=500,
            reference=self.category, description='Term fee',
        )
        response = self._get(self.student_user, search=self.student.roll)
        self.assertEqual(response.status_code, 200)
        self.term_summary.refresh_from_db()
        self.assertFalse(self.term_summary.results_withheld)
