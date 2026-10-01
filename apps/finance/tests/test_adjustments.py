from django.contrib.auth.models import User
from django.contrib.contenttypes.models import ContentType
from django.core.exceptions import ValidationError
from django.test import TestCase

from apps.identity.models import Permission, Role, UserRole, StudentExtra
from apps.finance.models_fees import StudentFeeLedgerEntry, StudentFeeAdjustment
from apps.finance.services_fees import create_adjustment, decide_adjustment


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
        self.approver = self._make_approver('adj_approver')

    def _make_approver(self, username):
        """A user holding finance.approve_adjustment, following the
        Permission/Role/UserRole convention test_views_invoices_payments.py's
        make_user() already uses."""
        Permission.objects.get_or_create(code='finance.approve_adjustment', defaults={'label': 'finance.approve_adjustment', 'module': 'Finance'})
        user = User.objects.create_user(username=username, password='x')
        role = Role.objects.create(name=f'Role for {username}')
        role.permissions.set(Permission.objects.filter(code='finance.approve_adjustment'))
        UserRole.objects.create(user=user, role=role)
        return user

    def test_positive_correction_does_not_require_approval(self):
        adjustment = create_adjustment(
            student=self.student, adjustment_type='correction', amount=500,
            reason='Data entry fix', requested_by=self.requester,
        )
        self.assertIsNone(adjustment.approved_by)
        entry = StudentFeeLedgerEntry.objects.get()
        self.assertEqual(entry.amount, 500)

    def test_long_reason_is_truncated_in_the_ledger_description_but_kept_in_full_on_the_adjustment(self):
        reason = 'r' * 600
        adjustment = create_adjustment(
            student=self.student, adjustment_type='correction', amount=500,
            reason=reason, requested_by=self.requester,
        )
        adjustment.refresh_from_db()
        self.assertEqual(adjustment.reason, reason)
        entry = StudentFeeLedgerEntry.objects.get()
        self.assertEqual(len(entry.description), 255)

    def test_negative_scholarship_creates_a_pending_row_and_posts_nothing(self):
        """Task 30: create_adjustment() no longer requires (or accepts) an
        approver -- a negative amount is created `pending` and waits for a
        separate decide_adjustment() call (see test_adjustment_approval.py)."""
        adjustment = create_adjustment(
            student=self.student, adjustment_type='scholarship', amount=-3000,
            reason='Merit scholarship', requested_by=self.requester,
        )
        self.assertEqual(adjustment.status, 'pending')
        self.assertIsNone(adjustment.approved_by)
        self.assertIsNone(adjustment.decided_by)
        self.assertFalse(StudentFeeLedgerEntry.objects.exists())

    def test_negative_scholarship_is_posted_only_after_a_separate_approval(self):
        adjustment = create_adjustment(
            student=self.student, adjustment_type='scholarship', amount=-3000,
            reason='Merit scholarship', requested_by=self.requester,
        )
        decided = decide_adjustment(adjustment=adjustment, decided_by=self.approver, approve=True)
        self.assertEqual(decided.status, 'approved')
        self.assertEqual(decided.approved_by, self.approver)
        self.assertEqual(decided.decided_by, self.approver)
        entry = StudentFeeLedgerEntry.objects.get()
        self.assertEqual(entry.amount, -3000)
        self.assertEqual(entry.running_balance, -3000)

    def test_requester_cannot_decide_their_own_request(self):
        """Task 30: self-decision used to be checked at create_adjustment() time
        (when an approver was passed alongside the request); it now only makes
        sense at decide_adjustment() time, since create_adjustment() no longer
        takes an approver at all."""
        adjustment = create_adjustment(
            student=self.student, adjustment_type='scholarship', amount=-3000,
            reason='Merit scholarship', requested_by=self.requester,
        )
        with self.assertRaises(ValidationError):
            decide_adjustment(adjustment=adjustment, decided_by=self.requester, approve=True)
