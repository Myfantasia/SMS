from django.contrib.auth.models import User
from django.contrib.contenttypes.models import ContentType
from django.test import TestCase

from apps.identity.models import StudentExtra
from apps.finance.models_fees import FeeCategory
from apps.finance.services_fees import is_fees_clear, post_ledger_entry


def setUpModule():
    """Ledger entries reference a FeeCategory through a GenericForeignKey.
    `finance` has no real migrations, so the ContentType row is not pre-created
    by post_migrate; if it were first created inside a test's savepoint it would
    be rolled back while ContentType's process-wide cache kept the stale id.
    Pre-warm it here, before any test's transaction opens."""
    ContentType.objects.get_for_model(FeeCategory)


class FeeClearanceTests(TestCase):
    def setUp(self):
        student_user = User.objects.create_user(username='clearance_student', password='x')
        self.student = StudentExtra.objects.create(user=student_user, roll='CLR-1')
        self.category = FeeCategory.objects.create(name='Tuition')

    def _post(self, amount, entry_type='charge'):
        return post_ledger_entry(
            student=self.student, entry_type=entry_type, amount=amount,
            reference=self.category, description='Test entry',
        )

    def test_zero_balance_is_clear(self):
        self.assertTrue(is_fees_clear(student_id=self.student.id, term_id=1))

    def test_no_ledger_history_at_all_is_clear(self):
        # A student with no invoices/payments yet has an implicit balance of 0.
        other_user = User.objects.create_user(username='clearance_student_fresh', password='x')
        other_student = StudentExtra.objects.create(user=other_user, roll='CLR-2')
        self.assertTrue(is_fees_clear(student_id=other_student.id, term_id=1))

    def test_positive_balance_is_not_clear(self):
        self._post(15000)
        self.assertFalse(is_fees_clear(student_id=self.student.id, term_id=1))

    def test_balance_exactly_at_grace_threshold_is_clear(self):
        self._post(500)
        self.assertTrue(is_fees_clear(student_id=self.student.id, term_id=1, grace_threshold=500))

    def test_balance_one_above_grace_threshold_is_not_clear(self):
        self._post(501)
        self.assertFalse(is_fees_clear(student_id=self.student.id, term_id=1, grace_threshold=500))

    def test_unknown_student_returns_none(self):
        self.assertIsNone(is_fees_clear(student_id=999999, term_id=1))

    def test_reexported_from_services_module(self):
        from apps.finance.services import is_fees_clear as reexported
        self.assertTrue(reexported(student_id=self.student.id, term_id=1))

    def test_credit_balance_is_clear(self):
        # Negative running balance = the student is in credit, which is clear.
        self._post(-3000, entry_type='payment')
        self.assertTrue(is_fees_clear(student_id=self.student.id, term_id=1))

    def test_carried_balance_is_not_clear_regardless_of_term_id(self):
        # term_id is ignored by design: an unpaid balance from earlier blocks
        # clearance whichever term is asked about, and term_id is optional.
        self._post(4000)
        self.assertFalse(is_fees_clear(student_id=self.student.id, term_id=1))
        self.assertFalse(is_fees_clear(student_id=self.student.id, term_id=999))
        self.assertFalse(is_fees_clear(student_id=self.student.id))
