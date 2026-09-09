from django.contrib.auth.models import User
from django.contrib.contenttypes.models import ContentType
from django.core.exceptions import ValidationError
from django.test import TestCase

from apps.identity.models import StudentExtra
from apps.finance.models_fees import StudentFeeLedgerEntry, StudentFeeAdjustment
from apps.finance.services_fees import create_adjustment


def setUpModule():
    """`finance` has no real migrations yet (migrations are applied manually by
    the user for this project), so Django's post_migrate signal never creates a
    ContentType row for StudentFeeAdjustment the way it would for a normally-migrated
    app. Left alone, the first GenericForeignKey access happens lazily inside
    whichever test runs first, inside that TestCase's per-test savepoint — the
    row then gets rolled back at that test's teardown while ContentType's
    process-wide get_for_model() cache keeps the now-dangling id, breaking every
    later test in this module. Pre-warm it once here, before any test's
    transaction opens, so the row is committed for real."""
    ContentType.objects.get_for_model(StudentFeeAdjustment)


class AdjustmentTests(TestCase):
    def setUp(self):
        student_user = User.objects.create_user(username='adj_student', password='x')
        self.student = StudentExtra.objects.create(user=student_user)
        self.requester = User.objects.create_user(username='adj_requester', password='x')
        self.approver = User.objects.create_user(username='adj_approver', password='x')

    def test_positive_correction_does_not_require_approval(self):
        adjustment = create_adjustment(
            student=self.student, adjustment_type='correction', amount=500,
            reason='Data entry fix', requested_by=self.requester,
        )
        self.assertIsNone(adjustment.approved_by)
        entry = StudentFeeLedgerEntry.objects.get()
        self.assertEqual(entry.amount, 500)

    def test_negative_scholarship_requires_approval(self):
        with self.assertRaises(ValidationError):
            create_adjustment(
                student=self.student, adjustment_type='scholarship', amount=-3000,
                reason='Merit scholarship', requested_by=self.requester,
            )

    def test_negative_scholarship_with_approval_succeeds_and_posts_negative_ledger_entry(self):
        adjustment = create_adjustment(
            student=self.student, adjustment_type='scholarship', amount=-3000,
            reason='Merit scholarship', requested_by=self.requester, approved_by=self.approver,
        )
        self.assertEqual(adjustment.approved_by, self.approver)
        entry = StudentFeeLedgerEntry.objects.get()
        self.assertEqual(entry.amount, -3000)
        self.assertEqual(entry.running_balance, -3000)
