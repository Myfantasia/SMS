"""Task 30 (spec section 4.10): two-step adjustment approval. A waiving
(negative) StudentFeeAdjustment is created `pending` by create_adjustment()
and posts nothing to the ledger until a SEPARATE user holding
finance.approve_adjustment -- never the requester -- calls decide_adjustment()
(directly, or via AdjustmentDecisionAPIView) to approve or reject it. A
positive amount still self-approves immediately, exactly as before this
feature existed.

NOTE: this model gained new fields (status, decided_by, decided_at,
decision_note) that have NOT been migrated yet -- migrations are run by the
user only, never by this code (see AGENTS/CLAUDE project rules). Every test
in this file is EXPECTED to fail against the current schema with a
missing-column OperationalError/ProgrammingError until the user runs
`makemigrations finance` + `migrate`. That failure mode is the expected,
correct state of this dispatch, not a sign the code is wrong."""
from django.contrib.auth.models import User
from django.contrib.contenttypes.models import ContentType
from django.core.exceptions import PermissionDenied, ValidationError
from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.identity.models import Permission, Role, StudentExtra, UserRole
from apps.finance.models_fees import StudentFeeAdjustment, StudentFeeLedgerEntry
from apps.finance.services_fees import create_adjustment, decide_adjustment, get_credit_balance
from apps.finance.views import AdjustmentDecisionAPIView, AdjustmentListAPIView


def setUpModule():
    """`finance` has no real migrations yet, so post_migrate never creates the
    ContentType row for StudentFeeAdjustment's ledger-entry GenericForeignKey.
    Pre-warm it before any test transaction opens -- see
    test_adjustments.setUpModule for the full rationale."""
    ContentType.objects.get_for_model(StudentFeeAdjustment)


class AdjustmentApprovalTestData(TestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        student_user = User.objects.create_user(username='appr_student', password='x')
        self.student = StudentExtra.objects.create(user=student_user, roll='APPR-1')
        self.requester = self.make_user('appr_requester', ['finance.edit'])
        self.approver = self.make_user('appr_approver', ['finance.approve_adjustment'])
        self.viewer = self.make_user('appr_viewer', ['finance.view'])
        self.edit_only = self.make_user('appr_edit_only', ['finance.edit'])

    def make_user(self, username, codes):
        """Matches InvoicePaymentAPITestData.make_user's Permission/Role/UserRole
        convention (test_views_invoices_payments.py)."""
        for code in codes:
            Permission.objects.get_or_create(code=code, defaults={'label': code, 'module': 'Finance'})
        user = User.objects.create_user(username=username, password='x')
        if codes:
            role = Role.objects.create(name=f'Role for {username}')
            role.permissions.set(Permission.objects.filter(code__in=codes))
            UserRole.objects.create(user=user, role=role)
        return user

    def call(self, view, method, path, user, data=None, **kwargs):
        request = getattr(self.factory, method)(path, data, format='json') if data is not None else getattr(self.factory, method)(path)
        if user is not None:
            force_authenticate(request, user=user)
        return view.as_view()(request, **kwargs)

    def create_pending(self, requested_by=None, amount=-1000, reason='merit'):
        return create_adjustment(
            student=self.student, adjustment_type='scholarship', amount=amount,
            reason=reason, requested_by=requested_by or self.requester,
        )


class CreateAdjustmentApprovalWorkflowTests(AdjustmentApprovalTestData):
    """Service-level: the create_adjustment() half of the two-step workflow."""

    def test_waiving_adjustment_creates_a_pending_row_and_posts_no_ledger_entry(self):
        adjustment = self.create_pending()
        self.assertEqual(adjustment.status, 'pending')
        self.assertIsNone(adjustment.decided_by)
        self.assertIsNone(adjustment.approved_by)
        self.assertIsNone(adjustment.decided_at)
        self.assertFalse(StudentFeeLedgerEntry.objects.exists())

    def test_positive_adjustment_is_approved_immediately_and_posts_as_before(self):
        adjustment = create_adjustment(
            student=self.student, adjustment_type='correction', amount=500,
            reason='fix', requested_by=self.requester,
        )
        self.assertEqual(adjustment.status, 'approved')
        self.assertEqual(adjustment.decided_by, self.requester)
        self.assertIsNotNone(adjustment.decided_at)
        # Self-approval (no real decision was made): approved_by stays None,
        # distinct from a genuine decide_adjustment() approval -- see the
        # model docstring.
        self.assertIsNone(adjustment.approved_by)
        entry = StudentFeeLedgerEntry.objects.get()
        self.assertEqual(entry.amount, 500)
        self.assertEqual(entry.running_balance, 500)


class DecideAdjustmentServiceTests(AdjustmentApprovalTestData):
    """Service-level: the decide_adjustment() half of the two-step workflow."""

    def test_approving_a_pending_adjustment_posts_exactly_one_ledger_entry_and_updates_balance(self):
        adjustment = self.create_pending(amount=-3000)
        decided = decide_adjustment(adjustment=adjustment, decided_by=self.approver, approve=True, note='Approved per policy')
        self.assertEqual(decided.status, 'approved')
        self.assertEqual(decided.decided_by, self.approver)
        self.assertEqual(decided.approved_by, self.approver)
        self.assertIsNotNone(decided.decided_at)
        self.assertEqual(decided.decision_note, 'Approved per policy')
        entries = StudentFeeLedgerEntry.objects.filter(entry_type='adjustment')
        self.assertEqual(entries.count(), 1)
        entry = entries.get()
        self.assertEqual(entry.amount, -3000)
        self.assertEqual(entry.running_balance, -3000)

    def test_rejecting_a_pending_adjustment_posts_nothing(self):
        adjustment = self.create_pending(amount=-3000)
        decided = decide_adjustment(adjustment=adjustment, decided_by=self.approver, approve=False, note='Not eligible')
        self.assertEqual(decided.status, 'rejected')
        self.assertEqual(decided.decided_by, self.approver)
        self.assertIsNone(decided.approved_by)
        self.assertIsNotNone(decided.decided_at)
        self.assertEqual(decided.decision_note, 'Not eligible')
        self.assertFalse(StudentFeeLedgerEntry.objects.exists())

    def test_deciding_an_already_approved_adjustment_is_refused_for_either_outcome(self):
        adjustment = self.create_pending(amount=-3000)
        decide_adjustment(adjustment=adjustment, decided_by=self.approver, approve=True)
        with self.assertRaises(ValidationError):
            decide_adjustment(adjustment=adjustment, decided_by=self.approver, approve=True)
        with self.assertRaises(ValidationError):
            decide_adjustment(adjustment=adjustment, decided_by=self.approver, approve=False)
        # Still exactly one ledger entry from the original approval.
        self.assertEqual(StudentFeeLedgerEntry.objects.filter(entry_type='adjustment').count(), 1)

    def test_deciding_an_already_rejected_adjustment_is_refused_for_either_outcome(self):
        adjustment = self.create_pending(amount=-3000)
        decide_adjustment(adjustment=adjustment, decided_by=self.approver, approve=False)
        with self.assertRaises(ValidationError):
            decide_adjustment(adjustment=adjustment, decided_by=self.approver, approve=False)
        with self.assertRaises(ValidationError):
            decide_adjustment(adjustment=adjustment, decided_by=self.approver, approve=True)
        self.assertFalse(StudentFeeLedgerEntry.objects.exists())

    def test_requester_cannot_decide_their_own_request_even_holding_the_approve_permission(self):
        """A second role hypothetically grants the requester
        finance.approve_adjustment too -- self-decision must still be refused,
        and refused as a ValidationError (not a PermissionDenied), since the
        self-check runs unconditionally before the permission check."""
        dual_role_user = self.make_user('appr_dual_role', ['finance.edit', 'finance.approve_adjustment'])
        adjustment = self.create_pending(requested_by=dual_role_user)
        with self.assertRaises(ValidationError):
            decide_adjustment(adjustment=adjustment, decided_by=dual_role_user, approve=True)
        adjustment.refresh_from_db()
        self.assertEqual(adjustment.status, 'pending')
        self.assertFalse(StudentFeeLedgerEntry.objects.exists())

    def test_self_check_runs_before_the_permission_check_not_just_after(self):
        """Discriminates check ORDER specifically: self.requester holds only
        finance.edit, never finance.approve_adjustment. If decide_adjustment
        checked permission first, this would raise PermissionDenied (the
        requester never holds the approve permission at all); it must instead
        raise ValidationError, because the self-decision check runs first and
        unconditionally -- the requester never even reaches the permission
        check. (The sibling test above uses a dual-permission user, which
        can't distinguish check order: either order ends in ValidationError
        for that user. This test can, and does.)"""
        adjustment = self.create_pending(requested_by=self.requester)
        with self.assertRaises(ValidationError):
            decide_adjustment(adjustment=adjustment, decided_by=self.requester, approve=True)
        adjustment.refresh_from_db()
        self.assertEqual(adjustment.status, 'pending')

    def test_decider_without_the_approve_permission_is_refused(self):
        adjustment = self.create_pending()
        with self.assertRaises(PermissionDenied):
            decide_adjustment(adjustment=adjustment, decided_by=self.edit_only, approve=True)
        adjustment.refresh_from_db()
        self.assertEqual(adjustment.status, 'pending')

    def test_pending_waiver_gives_no_credit_until_approved(self):
        """Credit carry-forward interaction (spec section 4.8):
        get_credit_balance() only reads the latest ledger entry, and a pending
        adjustment posts none -- so the student has zero credit until the
        waiver is actually approved."""
        adjustment = self.create_pending(amount=-3000)
        self.assertEqual(get_credit_balance(self.student), 0)
        decide_adjustment(adjustment=adjustment, decided_by=self.approver, approve=True)
        self.assertEqual(get_credit_balance(self.student), 3000)


class AdjustmentListAPIViewTests(AdjustmentApprovalTestData):
    def list(self, user, query=''):
        return self.call(AdjustmentListAPIView, 'get', f'/api/finance/adjustments/list/{query}', user)

    def test_filters_by_status(self):
        pending = self.create_pending(amount=-1000)
        create_adjustment(student=self.student, adjustment_type='correction', amount=500, reason='fix', requested_by=self.requester)
        response = self.list(self.viewer, '?status=pending')
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row['id'] for row in response.data], [pending.id])

    def test_filters_by_student_id(self):
        other_user = User.objects.create_user(username='appr_other_student', password='x')
        other_student = StudentExtra.objects.create(user=other_user, roll='APPR-2')
        mine = self.create_pending(amount=-1000)
        create_adjustment(student=other_student, adjustment_type='scholarship', amount=-500, reason='x', requested_by=self.requester)
        response = self.list(self.viewer, f'?student_id={self.student.id}')
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row['id'] for row in response.data], [mine.id])

    def test_orders_newest_first(self):
        first = self.create_pending(amount=-1000, reason='first')
        second = self.create_pending(amount=-500, reason='second')
        response = self.list(self.viewer)
        self.assertEqual([row['id'] for row in response.data], [second.id, first.id])

    def test_requires_finance_view(self):
        self.create_pending()
        response = self.list(self.edit_only)
        self.assertEqual(response.status_code, 403)

    def test_bad_query_params_are_400(self):
        self.assertEqual(self.list(self.viewer, '?status=bogus').status_code, 400)
        self.assertEqual(self.list(self.viewer, '?student_id=abc').status_code, 400)


class AdjustmentDecisionAPIViewTests(AdjustmentApprovalTestData):
    def decide(self, adjustment_id, user, data):
        return self.call(AdjustmentDecisionAPIView, 'post', '/x/', user, data, adjustment_id=adjustment_id)

    def test_404_on_unknown_adjustment(self):
        response = self.decide(99999999, self.approver, {'approve': True})
        self.assertEqual(response.status_code, 404)

    def test_400_on_malformed_body(self):
        adjustment = self.create_pending()
        response = self.decide(adjustment.id, self.approver, {'approve': 'not-a-bool'})
        self.assertEqual(response.status_code, 400)
        adjustment.refresh_from_db()
        self.assertEqual(adjustment.status, 'pending')

    def test_edit_only_user_without_approve_permission_is_403(self):
        """RBAC audit (Hard Rule #14): finance.edit alone must not be enough to
        decide an adjustment."""
        adjustment = self.create_pending()
        response = self.decide(adjustment.id, self.edit_only, {'approve': True})
        self.assertEqual(response.status_code, 403)
        adjustment.refresh_from_db()
        self.assertEqual(adjustment.status, 'pending')
        self.assertFalse(StudentFeeLedgerEntry.objects.exists())

    def test_requester_cannot_decide_their_own_request_via_the_api(self):
        dual_role_user = self.make_user('appr_dual_role_api', ['finance.edit', 'finance.approve_adjustment'])
        adjustment = self.create_pending(requested_by=dual_role_user)
        response = self.decide(adjustment.id, dual_role_user, {'approve': True})
        self.assertEqual(response.status_code, 400)
        adjustment.refresh_from_db()
        self.assertEqual(adjustment.status, 'pending')

    def test_full_round_trip_approve(self):
        adjustment = self.create_pending(amount=-2000)
        response = self.decide(adjustment.id, self.approver, {'approve': True, 'note': 'ok'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['status'], 'approved')
        self.assertEqual(response.data['approved_by'], self.approver.id)
        self.assertEqual(response.data['decided_by'], self.approver.id)
        self.assertIsNotNone(response.data['decided_at'])
        self.assertEqual(response.data['decision_note'], 'ok')
        entry = StudentFeeLedgerEntry.objects.get(entry_type='adjustment')
        self.assertEqual(entry.amount, -2000)
        self.assertEqual(entry.running_balance, -2000)

    def test_full_round_trip_reject(self):
        adjustment = self.create_pending(amount=-2000)
        response = self.decide(adjustment.id, self.approver, {'approve': False, 'note': 'denied'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['status'], 'rejected')
        self.assertIsNone(response.data['approved_by'])
        self.assertEqual(response.data['decided_by'], self.approver.id)
        self.assertEqual(response.data['decision_note'], 'denied')
        self.assertFalse(StudentFeeLedgerEntry.objects.exists())

    def test_deciding_an_already_decided_adjustment_is_400(self):
        adjustment = self.create_pending()
        first = self.decide(adjustment.id, self.approver, {'approve': True})
        self.assertEqual(first.status_code, 200)
        second = self.decide(adjustment.id, self.approver, {'approve': True})
        self.assertEqual(second.status_code, 400)
        self.assertEqual(StudentFeeLedgerEntry.objects.filter(entry_type='adjustment').count(), 1)
