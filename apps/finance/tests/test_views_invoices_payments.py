from django.contrib.auth.models import User
from django.contrib.contenttypes.models import ContentType
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.academics.models import AcademicYear, ExamTerm, GradeLevel, Curriculum, Tier
from apps.identity.models import Permission, Role, UserRole, StudentExtra, ParentExtra
from apps.finance.models_fees import (
    FeeCategory, FeeStructure, FeeStructureItem, Invoice, InvoiceCreditApplication,
    Payment, StudentFeeAdjustment, StudentFeeLedgerEntry,
)
from apps.finance.serializers_fees import PaymentSerializer
from apps.finance.services_fees import (
    generate_invoice_for_student, record_payment, update_fee_clearance_policy, grant_clearance_override,
)
from apps.finance.views import (
    InvoiceListAPIView, InvoiceDetailAPIView, PaymentListCreateAPIView, VoidInvoiceAPIView,
    VoidPaymentAPIView, StudentFeeAdjustmentCreateAPIView, StudentFeeLedgerStatementAPIView,
    FeeClearanceStatusAPIView, MyFeeClearanceStatusAPIView,
)

FINANCE_CODES = ['finance.view', 'finance.edit', 'finance.record_payment', 'finance.void', 'finance.approve_adjustment']


def setUpModule():
    """`finance` has no real migrations yet, so post_migrate never creates its
    ContentType rows; pre-warm them before any test transaction opens (see
    test_adjustments.setUpModule for the full rationale)."""
    for model in (Invoice, Payment, StudentFeeAdjustment, InvoiceCreditApplication):
        ContentType.objects.get_for_model(model)


class InvoicePaymentAPITestData(TestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        curriculum = Curriculum.objects.create(name='CBC')
        tier = Tier.objects.create(name='Junior School', curriculum=curriculum)
        grade = GradeLevel.objects.create(name='Grade 7', numeric_order=7, curriculum_type='CBC', curriculum=curriculum, tier=tier)
        year = AcademicYear.objects.create(year='2026', is_active=True)
        self.term = ExamTerm.objects.create(name='Term 2', academic_year=year, start_date='2026-05-01', end_date='2026-08-01')
        self.structure = FeeStructure.objects.create(grade_level=grade, term=self.term, name='Grade 7 - Term 2 2026')
        FeeStructureItem.objects.create(fee_structure=self.structure, category=FeeCategory.objects.create(name='Tuition'), amount=15000)
        self.category = FeeCategory.objects.get(name='Tuition')

        # Full finance role: every code. Used as the "admin-like" user.
        self.finance_user = self.make_user('finance_officer_test_2', FINANCE_CODES)
        self.student = self.make_student(1)
        self.invoice = generate_invoice_for_student(student=self.student, fee_structure=self.structure, operator=self.finance_user)

    def make_user(self, username, codes):
        for code in codes:
            Permission.objects.get_or_create(code=code, defaults={'label': code, 'module': 'Finance'})
        user = User.objects.create_user(username=username, password='x')
        if codes:
            role = Role.objects.create(name=f'Role for {username}')
            role.permissions.set(Permission.objects.filter(code__in=codes))
            UserRole.objects.create(user=user, role=role)
        return user

    def make_student(self, n):
        user = User.objects.create_user(username=f'invoice_payment_student_{n}', password='x')
        return StudentExtra.objects.create(user=user, roll=f'INVPAY-{n}')

    def call(self, view, method, path, user, data=None, **kwargs):
        request = getattr(self.factory, method)(path, data, format='json') if data is not None else getattr(self.factory, method)(path)
        if user is not None:
            force_authenticate(request, user=user)
        return view.as_view()(request, **kwargs)

    def pay(self, amount=5000, invoice=None, student=None):
        payment, _receipt = record_payment(
            student=student or self.student, amount=amount, method='cash',
            recorded_by=self.finance_user, invoice=invoice if invoice is not None else self.invoice,
        )
        return payment


class InvoiceListAPITests(InvoicePaymentAPITestData):
    def test_can_list_invoices_for_a_student(self):
        response = self.call(InvoiceListAPIView, 'get', f'/api/finance/invoices/?student_id={self.student.id}', self.finance_user)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]['line_items'][0]['category_name'], 'Tuition')

    def test_garbage_student_id_is_a_400(self):
        response = self.call(InvoiceListAPIView, 'get', '/api/finance/invoices/?student_id=abc', self.finance_user)
        self.assertEqual(response.status_code, 400)

    def test_garbage_fee_structure_id_and_status_are_400s(self):
        self.assertEqual(self.call(InvoiceListAPIView, 'get', '/api/finance/invoices/?fee_structure_id=x', self.finance_user).status_code, 400)
        self.assertEqual(self.call(InvoiceListAPIView, 'get', '/api/finance/invoices/?status=bogus', self.finance_user).status_code, 400)

    def test_limit_and_offset_are_validated(self):
        for query in ('limit=0', 'limit=501', 'limit=abc', 'offset=-1', 'offset=abc'):
            response = self.call(InvoiceListAPIView, 'get', f'/api/finance/invoices/?{query}', self.finance_user)
            self.assertEqual(response.status_code, 400, query)

    def test_status_and_structure_filters(self):
        other_student = self.make_student(2)
        other_invoice = generate_invoice_for_student(student=other_student, fee_structure=self.structure, operator=self.finance_user)
        self.pay(15000, invoice=other_invoice, student=other_student)
        paid = self.call(InvoiceListAPIView, 'get', '/api/finance/invoices/?status=paid', self.finance_user)
        self.assertEqual([row['id'] for row in paid.data], [other_invoice.id])
        by_structure = self.call(InvoiceListAPIView, 'get', f'/api/finance/invoices/?fee_structure_id={self.structure.id}', self.finance_user)
        self.assertEqual(len(by_structure.data), 2)
        none = self.call(InvoiceListAPIView, 'get', '/api/finance/invoices/?fee_structure_id=99999999', self.finance_user)
        self.assertEqual(none.data, [])

    def test_limit_and_offset_page_the_list(self):
        for n in (2, 3):
            generate_invoice_for_student(student=self.make_student(n), fee_structure=self.structure, operator=self.finance_user)
        page1 = self.call(InvoiceListAPIView, 'get', '/api/finance/invoices/?limit=2', self.finance_user)
        page2 = self.call(InvoiceListAPIView, 'get', '/api/finance/invoices/?limit=2&offset=2', self.finance_user)
        self.assertEqual(len(page1.data), 2)
        self.assertEqual(len(page2.data), 1)
        self.assertFalse({r['id'] for r in page1.data} & {r['id'] for r in page2.data})

    def test_query_count_does_not_grow_with_invoice_count(self):
        self.call(InvoiceListAPIView, 'get', '/api/finance/invoices/', self.finance_user)  # warm caches
        with CaptureQueriesContext(connection) as one:
            self.call(InvoiceListAPIView, 'get', '/api/finance/invoices/', self.finance_user)
        for n in (2, 3, 4):
            generate_invoice_for_student(student=self.make_student(n), fee_structure=self.structure, operator=self.finance_user)
        with CaptureQueriesContext(connection) as four:
            response = self.call(InvoiceListAPIView, 'get', '/api/finance/invoices/', self.finance_user)
        self.assertEqual(len(response.data), 4)
        self.assertEqual(len(four), len(one))

    def test_user_without_finance_view_is_forbidden(self):
        plain = self.make_user('plain_inv_user', [])
        self.assertEqual(self.call(InvoiceListAPIView, 'get', '/api/finance/invoices/', plain).status_code, 403)

    def test_credit_applied_defaults_to_zero(self):
        response = self.call(InvoiceListAPIView, 'get', f'/api/finance/invoices/?student_id={self.student.id}', self.finance_user)
        self.assertEqual(response.data[0]['credit_applied'], 0)

    def test_credit_applied_is_included_when_present(self):
        InvoiceCreditApplication.objects.create(student=self.student, invoice=self.invoice, amount=300)
        response = self.call(InvoiceListAPIView, 'get', f'/api/finance/invoices/?student_id={self.student.id}', self.finance_user)
        self.assertEqual(response.data[0]['credit_applied'], 300)

    def test_credit_applications_prefetch_does_not_grow_query_count(self):
        InvoiceCreditApplication.objects.create(student=self.student, invoice=self.invoice, amount=300)
        self.call(InvoiceListAPIView, 'get', '/api/finance/invoices/', self.finance_user)  # warm caches
        with CaptureQueriesContext(connection) as one:
            self.call(InvoiceListAPIView, 'get', '/api/finance/invoices/', self.finance_user)
        for n in (2, 3, 4):
            invoice = generate_invoice_for_student(student=self.make_student(n), fee_structure=self.structure, operator=self.finance_user)
            InvoiceCreditApplication.objects.create(student=invoice.student, invoice=invoice, amount=100)
        with CaptureQueriesContext(connection) as four:
            response = self.call(InvoiceListAPIView, 'get', '/api/finance/invoices/', self.finance_user)
        self.assertEqual(len(response.data), 4)
        self.assertEqual(len(four), len(one))


class InvoiceDetailAPITests(InvoicePaymentAPITestData):
    def test_detail_shows_line_items_payments_and_credit_applied(self):
        live = self.pay(5000)
        voided = self.pay(1000)
        self.call(VoidPaymentAPIView, 'post', f'/api/finance/payments/{voided.id}/void/', self.finance_user,
                  {'reason': 'wrong amount'}, payment_id=voided.id)
        InvoiceCreditApplication.objects.create(student=self.student, invoice=self.invoice, amount=300)
        response = self.call(InvoiceDetailAPIView, 'get', f'/api/finance/invoices/{self.invoice.id}/', self.finance_user,
                             invoice_id=self.invoice.id)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['id'], self.invoice.id)
        self.assertEqual(len(response.data['line_items']), 1)
        self.assertEqual(response.data['credit_applied'], 300)
        by_id = {p['id']: p for p in response.data['payments']}
        self.assertEqual(set(by_id), {live.id, voided.id})
        self.assertFalse(by_id[live.id]['is_voided'])
        self.assertTrue(by_id[voided.id]['is_voided'])
        self.assertIsNotNone(by_id[voided.id]['voided_at'])
        self.assertTrue(by_id[live.id]['receipt_number'].startswith('RCPT'))

    def test_detail_credit_applied_defaults_to_zero(self):
        response = self.call(InvoiceDetailAPIView, 'get', '/x/', self.finance_user, invoice_id=self.invoice.id)
        self.assertEqual(response.data['credit_applied'], 0)
        self.assertEqual(response.data['payments'], [])

    def test_missing_invoice_is_404(self):
        response = self.call(InvoiceDetailAPIView, 'get', '/x/', self.finance_user, invoice_id=99999999)
        self.assertEqual(response.status_code, 404)

    def test_detail_needs_finance_view(self):
        plain = self.make_user('plain_detail_user', [])
        self.assertEqual(self.call(InvoiceDetailAPIView, 'get', '/x/', plain, invoice_id=self.invoice.id).status_code, 403)


class PaymentCreateAPITests(InvoicePaymentAPITestData):
    def post(self, data, user=None):
        return self.call(PaymentListCreateAPIView, 'post', '/api/finance/payments/', user or self.finance_user, data)

    def test_can_record_a_payment(self):
        response = self.post({
            'student': self.student.id, 'invoice': self.invoice.id, 'amount': 5000,
            'method': 'cash', 'date': '2026-09-09',
        })
        self.assertEqual(response.status_code, 201)
        self.assertIn('receipt_number', response.data)
        self.assertTrue(response.data['receipt_number'])
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.status, 'partially_paid')

    def test_payment_without_invoice_and_date_is_allowed(self):
        response = self.post({'student': self.student.id, 'amount': 100, 'method': 'mpesa', 'reference': 'QWE123'})
        self.assertEqual(response.status_code, 201)
        self.assertIsNone(response.data['invoice'])

    def test_bad_input_is_a_400_not_a_500(self):
        base = {'student': self.student.id, 'amount': 5000, 'method': 'cash'}
        bad_payloads = [
            {**base, 'amount': 0},
            {**base, 'amount': -5},
            {**base, 'amount': 'abc'},
            {**base, 'amount': 10.5},
            {**base, 'amount': None},
            {**base, 'method': 'bitcoin'},
            {**base, 'date': 'not-a-date'},
            {**base, 'student': 99999999},
            {**base, 'invoice': 99999999},
            {k: v for k, v in base.items() if k != 'student'},
            {k: v for k, v in base.items() if k != 'method'},
        ]
        for payload in bad_payloads:
            self.assertEqual(self.post(payload).status_code, 400, payload)
        self.assertFalse(Payment.objects.exists())

    def test_payment_against_a_voided_invoice_is_a_clean_400(self):
        self.call(VoidInvoiceAPIView, 'post', '/x/', self.finance_user, {'reason': 'Duplicate'}, invoice_id=self.invoice.id)
        response = self.post({'student': self.student.id, 'invoice': self.invoice.id, 'amount': 100, 'method': 'cash'})
        self.assertEqual(response.status_code, 400)
        self.assertIn('voided', response.data['error'])
        self.assertNotIn("['", response.data['error'])

    def test_payment_for_a_student_that_does_not_own_the_invoice_is_400(self):
        other = self.make_student(2)
        response = self.post({'student': other.id, 'invoice': self.invoice.id, 'amount': 100, 'method': 'cash'})
        self.assertEqual(response.status_code, 400)
        self.assertIn('does not belong', response.data['error'])
        self.assertFalse(Payment.objects.exists())

    def test_overpayment_is_allowed_and_shows_as_credit_in_the_statement(self):
        response = self.post({'student': self.student.id, 'invoice': self.invoice.id, 'amount': 20000, 'method': 'cash'})
        self.assertEqual(response.status_code, 201)
        statement = self.call(StudentFeeLedgerStatementAPIView, 'get', '/x/', self.finance_user, student_id=self.student.id)
        self.assertEqual(statement.data['balance'], -5000)
        self.assertEqual(statement.data['credit_balance'], 5000)

    def test_payment_list_filters_and_validation(self):
        self.pay(5000)
        ok = self.call(PaymentListCreateAPIView, 'get', f'/api/finance/payments/?student_id={self.student.id}', self.finance_user)
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(len(ok.data), 1)
        self.assertEqual(ok.data[0]['receipt_number'][:4], 'RCPT')
        self.assertEqual(self.call(PaymentListCreateAPIView, 'get', '/x/?student_id=abc', self.finance_user).status_code, 400)
        self.assertEqual(self.call(PaymentListCreateAPIView, 'get', '/x/?limit=9999', self.finance_user).status_code, 400)
        empty = self.call(PaymentListCreateAPIView, 'get', '/x/?student_id=99999999', self.finance_user)
        self.assertEqual(empty.data, [])

    def test_payment_list_query_count_does_not_grow(self):
        self.pay(100)
        self.call(PaymentListCreateAPIView, 'get', '/x/', self.finance_user)
        with CaptureQueriesContext(connection) as one:
            self.call(PaymentListCreateAPIView, 'get', '/x/', self.finance_user)
        for _ in range(3):
            self.pay(100)
        with CaptureQueriesContext(connection) as four:
            response = self.call(PaymentListCreateAPIView, 'get', '/x/', self.finance_user)
        self.assertEqual(len(response.data), 4)
        self.assertEqual(len(four), len(one))


class PaymentSerializerTests(InvoicePaymentAPITestData):
    def test_payment_without_a_receipt_serializes_receipt_number_as_none(self):
        payment = Payment.objects.create(
            student=self.student, invoice=self.invoice, amount=1000, method='cash',
            recorded_by=self.finance_user, date='2026-09-09',
        )
        data = PaymentSerializer(payment).data
        self.assertIn('receipt_number', data)
        self.assertIsNone(data['receipt_number'])

    def test_payment_without_a_receipt_serializes_receipt_id_as_none(self):
        """Task 22a: same reverse-OneToOne-can-404 concern as receipt_number
        above — a receiptless payment must serialize receipt_id: null, not error."""
        payment = Payment.objects.create(
            student=self.student, invoice=self.invoice, amount=1000, method='cash',
            recorded_by=self.finance_user, date='2026-09-09',
        )
        data = PaymentSerializer(payment).data
        self.assertIn('receipt_id', data)
        self.assertIsNone(data['receipt_id'])

    def test_payment_with_a_receipt_serializes_the_receipts_own_pk(self):
        """receipt_id must be the Receipt's own pk (what ReceiptPDFAPIView's
        receipt_id URL kwarg expects), not the payment's id."""
        payment = self.pay(5000)
        data = PaymentSerializer(payment).data
        self.assertEqual(data['receipt_id'], payment.receipt.id)


class VoidInvoiceAPITests(InvoicePaymentAPITestData):
    def void(self, reason, invoice_id=None):
        invoice_id = invoice_id or self.invoice.id
        return self.call(VoidInvoiceAPIView, 'post', f'/api/finance/invoices/{invoice_id}/void/', self.finance_user,
                         {'reason': reason}, invoice_id=invoice_id)

    def test_can_void_an_invoice_with_a_reason(self):
        response = self.void('Duplicate')
        self.assertEqual(response.status_code, 200)
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.status, 'voided')

    def test_response_body_is_the_fresh_voided_row(self):
        response = self.void('Duplicate')
        self.assertEqual(response.data['status'], 'voided')
        self.assertIsNotNone(response.data['voided_at'])
        self.assertEqual(response.data['void_reason'], 'Duplicate')

    def test_void_without_reason_returns_400(self):
        self.assertEqual(self.void('').status_code, 400)
        self.assertEqual(self.void('   ').status_code, 400)
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.status, 'unpaid')

    def test_missing_reason_key_returns_400(self):
        response = self.call(VoidInvoiceAPIView, 'post', '/x/', self.finance_user, {}, invoice_id=self.invoice.id)
        self.assertEqual(response.status_code, 400)

    def test_missing_invoice_is_404(self):
        self.assertEqual(self.void('x', invoice_id=99999999).status_code, 404)

    def test_voiding_twice_is_a_clean_400(self):
        self.void('first')
        response = self.void('second')
        self.assertEqual(response.status_code, 400)
        self.assertIn('already voided', response.data['error'])


class VoidPaymentAPITests(InvoicePaymentAPITestData):
    def test_response_body_is_the_fresh_voided_row(self):
        payment = self.pay(5000)
        response = self.call(VoidPaymentAPIView, 'post', '/x/', self.finance_user, {'reason': 'Bounced'}, payment_id=payment.id)
        self.assertEqual(response.status_code, 200)
        self.assertIsNotNone(response.data['voided_at'])
        self.assertTrue(response.data['is_voided'])
        self.assertEqual(response.data['void_reason'], 'Bounced')
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.status, 'unpaid')

    def test_blank_reason_is_400_and_missing_payment_is_404_and_double_void_is_400(self):
        payment = self.pay(5000)
        self.assertEqual(self.call(VoidPaymentAPIView, 'post', '/x/', self.finance_user, {'reason': ''}, payment_id=payment.id).status_code, 400)
        self.assertEqual(self.call(VoidPaymentAPIView, 'post', '/x/', self.finance_user, {'reason': 'x'}, payment_id=99999999).status_code, 404)
        self.call(VoidPaymentAPIView, 'post', '/x/', self.finance_user, {'reason': 'x'}, payment_id=payment.id)
        again = self.call(VoidPaymentAPIView, 'post', '/x/', self.finance_user, {'reason': 'y'}, payment_id=payment.id)
        self.assertEqual(again.status_code, 400)
        self.assertNotIn("['", again.data['error'])


class AdjustmentAPITests(InvoicePaymentAPITestData):
    def setUp(self):
        super().setUp()
        self.requester = self.make_user('adj_requester_edit_only', ['finance.edit'])
        self.approver = self.make_user('adj_approver_holder', ['finance.approve_adjustment'])

    def post(self, data, user=None):
        return self.call(StudentFeeAdjustmentCreateAPIView, 'post', '/api/finance/adjustments/', user or self.requester, data)

    def negative(self, **overrides):
        payload = {'student': self.student.id, 'adjustment_type': 'scholarship', 'amount': -1000, 'reason': 'merit',
                   'approved_by': self.approver.id}
        payload.update(overrides)
        return payload

    def test_long_reason_is_truncated_only_in_the_ledger_description(self):
        reason = 'r' * 600
        response = self.post({'student': self.student.id, 'adjustment_type': 'correction', 'amount': 500, 'reason': reason})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(StudentFeeAdjustment.objects.get().reason, reason)
        entry = StudentFeeLedgerEntry.objects.filter(entry_type='adjustment').get()
        self.assertLessEqual(len(entry.description), 255)

    def test_absurdly_long_reason_is_a_400_not_a_500(self):
        response = self.post({'student': self.student.id, 'adjustment_type': 'correction', 'amount': 500, 'reason': 'r' * 2500})
        self.assertEqual(response.status_code, 400)
        self.assertFalse(StudentFeeAdjustment.objects.exists())

    def test_positive_adjustment_needs_no_approver(self):
        response = self.post({'student': self.student.id, 'adjustment_type': 'correction', 'amount': 500, 'reason': 'fix'})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['amount'], 500)

    def test_edit_only_user_can_request_and_approve_adjustment_permission_is_not_the_gate(self):
        # finance.edit is the gate for *requesting*; approve_adjustment alone is not enough.
        approver_only = self.approver
        response = self.post({'student': self.student.id, 'adjustment_type': 'correction', 'amount': 500, 'reason': 'fix'}, user=approver_only)
        self.assertEqual(response.status_code, 403)

    def test_negative_adjustment_without_approver_returns_400(self):
        response = self.post({'student': self.student.id, 'adjustment_type': 'scholarship', 'amount': -1000, 'reason': 'merit'})
        self.assertEqual(response.status_code, 400)
        self.assertIn('approver', response.data['error'])
        self.assertFalse(StudentFeeAdjustment.objects.exists())

    def test_negative_adjustment_with_a_valid_approver_is_created_with_category(self):
        response = self.post(self.negative(category=self.category.id))
        self.assertEqual(response.status_code, 201)
        adjustment = StudentFeeAdjustment.objects.get()
        self.assertEqual(adjustment.approved_by, self.approver)
        self.assertEqual(adjustment.requested_by, self.requester)
        self.assertEqual(adjustment.category, self.category)

    def test_approver_who_lacks_the_permission_is_400(self):
        no_perm = self.make_user('adj_not_an_approver', ['finance.view'])
        response = self.post(self.negative(approved_by=no_perm.id))
        self.assertEqual(response.status_code, 400)
        self.assertIn('approved_by', response.data)
        self.assertFalse(StudentFeeAdjustment.objects.exists())

    def test_inactive_or_unknown_approver_is_400(self):
        self.approver.is_active = False
        self.approver.save()
        self.assertEqual(self.post(self.negative()).status_code, 400)
        self.assertEqual(self.post(self.negative(approved_by=99999999)).status_code, 400)

    def test_self_approval_is_a_400(self):
        response = self.post(self.negative(approved_by=self.finance_user.id), user=self.finance_user)
        self.assertEqual(response.status_code, 400)
        self.assertIn('cannot be the same user', response.data['error'])
        self.assertFalse(StudentFeeAdjustment.objects.exists())

    def test_bad_input_is_a_400_not_a_500(self):
        base = {'student': self.student.id, 'adjustment_type': 'correction', 'amount': 500, 'reason': 'fix'}
        bad_payloads = [
            {**base, 'adjustment_type': 'freebie'},
            {**base, 'amount': 'abc'},
            {**base, 'amount': 1.5},
            {**base, 'amount': 0},
            {**base, 'amount': None},
            {**base, 'reason': ''},
            {**base, 'student': 99999999},
            {**base, 'category': 99999999},
            {k: v for k, v in base.items() if k != 'student'},
            {k: v for k, v in base.items() if k != 'reason'},
        ]
        for payload in bad_payloads:
            self.assertEqual(self.post(payload).status_code, 400, payload)
        self.assertFalse(StudentFeeAdjustment.objects.exists())


class PermissionMatrixTests(InvoicePaymentAPITestData):
    def setUp(self):
        super().setUp()
        self.viewer = self.make_user('matrix_viewer', ['finance.view'])
        self.payer = self.make_user('matrix_payer', ['finance.view', 'finance.record_payment'])
        self.voider = self.make_user('matrix_voider', ['finance.void'])
        self.payment = self.pay(1000)

    def test_view_only_user_cannot_post_payment_void_or_adjustment(self):
        payment = self.call(PaymentListCreateAPIView, 'post', '/x/', self.viewer,
                            {'student': self.student.id, 'amount': 100, 'method': 'cash'})
        void_invoice = self.call(VoidInvoiceAPIView, 'post', '/x/', self.viewer, {'reason': 'x'}, invoice_id=self.invoice.id)
        void_payment = self.call(VoidPaymentAPIView, 'post', '/x/', self.viewer, {'reason': 'x'}, payment_id=self.payment.id)
        adjustment = self.call(StudentFeeAdjustmentCreateAPIView, 'post', '/x/', self.viewer,
                               {'student': self.student.id, 'adjustment_type': 'correction', 'amount': 5, 'reason': 'x'})
        self.assertEqual([payment.status_code, void_invoice.status_code, void_payment.status_code, adjustment.status_code], [403] * 4)
        self.assertEqual(Payment.objects.count(), 1)
        self.assertFalse(StudentFeeAdjustment.objects.exists())

    def test_record_payment_holder_can_pay_but_not_void_or_adjust(self):
        ok = self.call(PaymentListCreateAPIView, 'post', '/x/', self.payer, {'student': self.student.id, 'amount': 100, 'method': 'cash'})
        self.assertEqual(ok.status_code, 201)
        self.assertEqual(self.call(VoidInvoiceAPIView, 'post', '/x/', self.payer, {'reason': 'x'}, invoice_id=self.invoice.id).status_code, 403)
        self.assertEqual(self.call(VoidPaymentAPIView, 'post', '/x/', self.payer, {'reason': 'x'}, payment_id=self.payment.id).status_code, 403)
        self.assertEqual(self.call(StudentFeeAdjustmentCreateAPIView, 'post', '/x/', self.payer,
                                   {'student': self.student.id, 'adjustment_type': 'correction', 'amount': 5, 'reason': 'x'}).status_code, 403)
        self.invoice.refresh_from_db()
        self.assertNotEqual(self.invoice.status, 'voided')

    def test_void_only_user_can_void_invoice_and_payment(self):
        self.assertEqual(self.call(VoidPaymentAPIView, 'post', '/x/', self.voider, {'reason': 'x'}, payment_id=self.payment.id).status_code, 200)
        self.assertEqual(self.call(VoidInvoiceAPIView, 'post', '/x/', self.voider, {'reason': 'x'}, invoice_id=self.invoice.id).status_code, 200)

    def test_void_only_user_cannot_record_payments(self):
        response = self.call(PaymentListCreateAPIView, 'post', '/x/', self.voider, {'student': self.student.id, 'amount': 100, 'method': 'cash'})
        self.assertEqual(response.status_code, 403)

    def test_unauthenticated_is_rejected_everywhere(self):
        checks = [
            (InvoiceListAPIView, 'get', {}), (InvoiceDetailAPIView, 'get', {'invoice_id': self.invoice.id}),
            (PaymentListCreateAPIView, 'get', {}), (PaymentListCreateAPIView, 'post', {}),
            (VoidInvoiceAPIView, 'post', {'invoice_id': self.invoice.id}),
            (VoidPaymentAPIView, 'post', {'payment_id': self.payment.id}),
            (StudentFeeAdjustmentCreateAPIView, 'post', {}),
            (StudentFeeLedgerStatementAPIView, 'get', {'student_id': self.student.id}),
            (FeeClearanceStatusAPIView, 'get', {'student_id': self.student.id}),
        ]
        for view, method, kwargs in checks:
            response = self.call(view, method, '/x/', None, {} if method == 'post' else None, **kwargs)
            self.assertIn(response.status_code, (401, 403), view.__name__)

    def test_view_only_user_can_use_read_endpoints(self):
        self.assertEqual(self.call(InvoiceListAPIView, 'get', '/x/', self.viewer).status_code, 200)
        self.assertEqual(self.call(PaymentListCreateAPIView, 'get', '/x/', self.viewer).status_code, 200)
        self.assertEqual(self.call(StudentFeeLedgerStatementAPIView, 'get', '/x/', self.viewer, student_id=self.student.id).status_code, 200)
        self.assertEqual(self.call(FeeClearanceStatusAPIView, 'get', '/x/', self.viewer, student_id=self.student.id).status_code, 200)


class StudentLedgerStatementAPITests(InvoicePaymentAPITestData):
    def statement(self, user, student_id=None, query=''):
        student_id = student_id or self.student.id
        return self.call(StudentFeeLedgerStatementAPIView, 'get', f'/x/{query}', user, student_id=student_id)

    def test_returns_ledger_history_and_balance(self):
        response = self.statement(self.finance_user)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['balance'], 15000)
        self.assertEqual(response.data['credit_balance'], 0)
        self.assertEqual(len(response.data['entries']), 1)

    def test_entries_are_newest_first_and_balance_ignores_paging(self):
        self.pay(5000)
        response = self.statement(self.finance_user, query='?limit=1')
        self.assertEqual(len(response.data['entries']), 1)
        self.assertEqual(response.data['entries'][0]['entry_type'], 'payment')
        self.assertEqual(response.data['balance'], 10000)
        older = self.statement(self.finance_user, query='?limit=1&offset=1')
        self.assertEqual(older.data['entries'][0]['entry_type'], 'charge')

    def test_garbage_paging_params_are_400(self):
        self.assertEqual(self.statement(self.finance_user, query='?limit=abc').status_code, 400)
        self.assertEqual(self.statement(self.finance_user, query='?limit=501').status_code, 400)
        self.assertEqual(self.statement(self.finance_user, query='?offset=-3').status_code, 400)

    def test_student_can_view_their_own_statement(self):
        self.assertEqual(self.statement(self.student.user).status_code, 200)

    def test_student_cannot_view_another_students_statement(self):
        other = self.make_student(2)
        self.assertEqual(self.statement(other.user).status_code, 403)

    def test_linked_approved_parent_can_view_but_unlinked_or_unapproved_cannot(self):
        def make_parent(name, status):
            parent = ParentExtra.objects.create(user=User.objects.create_user(username=name, password='x'), mobile='0700', status=status)
            return parent
        linked = make_parent('ledger_parent_linked', True)
        linked.students.add(self.student)
        unlinked = make_parent('ledger_parent_unlinked', True)
        unlinked.students.add(self.make_student(2))
        pending = make_parent('ledger_parent_pending', False)
        pending.students.add(self.student)
        self.assertEqual(self.statement(linked.user).status_code, 200)
        self.assertEqual(self.statement(unlinked.user).status_code, 403)
        self.assertEqual(self.statement(pending.user).status_code, 403)

    def test_user_with_no_relationship_is_forbidden(self):
        self.assertEqual(self.statement(self.make_user('ledger_stranger', [])).status_code, 403)

    def test_unknown_student_is_404_for_finance_and_403_for_others(self):
        self.assertEqual(self.statement(self.finance_user, student_id=99999999).status_code, 404)
        self.assertEqual(self.statement(self.make_user('ledger_stranger_2', []), student_id=99999999).status_code, 403)

    def test_entries_with_a_dangling_reference_still_serialize(self):
        StudentFeeLedgerEntry.objects.create(
            student=self.student, entry_type='charge', amount=0, running_balance=15000,
            content_type=ContentType.objects.get_for_model(Invoice), object_id=99999999,
            description='dangling', date='2026-09-09',
        )
        response = self.statement(self.finance_user)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data['entries']), 2)


class FeeClearanceStatusAPITests(InvoicePaymentAPITestData):
    def setUp(self):
        super().setUp()
        # "Current" term/year resolution (blocked_report_card/blocked_promotion) reads the
        # is_active flag -- AcademicYear defaults True (set explicitly in the base setUp
        # already), but ExamTerm defaults False, so it needs activating here.
        self.term.is_active = True
        self.term.save(update_fields=['is_active'])
        self.year = self.term.academic_year

    def clearance(self, query='', student_id=None, user=None):
        return self.call(FeeClearanceStatusAPIView, 'get', f'/x/{query}', user or self.finance_user,
                         student_id=student_id or self.student.id)

    def test_returns_not_clear_when_balance_owed(self):
        response = self.clearance(f'?term_id={self.term.id}')
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data['is_clear'])

    def test_clear_when_paid_or_within_grace(self):
        self.assertTrue(self.clearance('?grace_threshold=15000').data['is_clear'])
        self.pay(15000)
        self.assertTrue(self.clearance().data['is_clear'])

    def test_garbage_params_are_400(self):
        for query in ('?term_id=abc', '?grace_threshold=abc', '?grace_threshold=-1'):
            self.assertEqual(self.clearance(query).status_code, 400, query)

    def test_unknown_student_is_404(self):
        self.assertEqual(self.clearance(student_id=99999999).status_code, 404)

    def test_needs_finance_view(self):
        self.assertEqual(self.clearance(user=self.make_user('clearance_plain', [])).status_code, 403)

    def test_credit_balance_is_zero_with_no_overpayment(self):
        response = self.clearance()
        self.assertEqual(response.data['credit_balance'], 0)

    def test_credit_balance_reflects_an_overpayment(self):
        self.pay(15000 + 4000)
        response = self.clearance()
        self.assertEqual(response.data['credit_balance'], 4000)

    def test_student_can_check_their_own_clearance_status(self):
        self.assertEqual(self.clearance(user=self.student.user).status_code, 200)

    def test_linked_approved_parent_can_check_clearance_status_but_unlinked_cannot(self):
        linked = ParentExtra.objects.create(
            user=User.objects.create_user(username='clearance_parent_linked', password='x'),
            mobile='0700', status=True,
        )
        linked.students.add(self.student)
        unlinked = ParentExtra.objects.create(
            user=User.objects.create_user(username='clearance_parent_unlinked', password='x'),
            mobile='0700', status=True,
        )
        unlinked.students.add(self.make_student(2))
        self.assertEqual(self.clearance(user=linked.user).status_code, 200)
        self.assertEqual(self.clearance(user=unlinked.user).status_code, 403)

    def test_blocked_fields_false_when_policy_flags_are_off_regardless_of_balance(self):
        # Base setUp already left an unpaid balance of 15000 on self.student.
        response = self.clearance()
        self.assertFalse(response.data['blocked_report_card'])
        self.assertFalse(response.data['blocked_promotion'])

    def test_blocked_fields_true_when_flags_on_and_no_override(self):
        update_fee_clearance_policy(updated_by=self.finance_user, block_report_cards=True, block_promotion=True)
        response = self.clearance()
        self.assertTrue(response.data['blocked_report_card'])
        self.assertTrue(response.data['blocked_promotion'])

    def test_blocked_fields_false_when_flags_on_and_active_override_covers_current_term_and_year(self):
        update_fee_clearance_policy(updated_by=self.finance_user, block_report_cards=True, block_promotion=True)
        override_holder = self.make_user('clearance_status_override_holder', ['finance.override_clearance'])
        grant_clearance_override(
            student=self.student, gate='report_card', granted_by=override_holder, reason='hardship', term=self.term,
        )
        grant_clearance_override(
            student=self.student, gate='promotion', granted_by=override_holder, reason='hardship', academic_year=self.year,
        )
        response = self.clearance()
        self.assertFalse(response.data['blocked_report_card'])
        self.assertFalse(response.data['blocked_promotion'])

    def test_is_clear_and_credit_balance_are_unchanged_by_the_new_fields(self):
        response = self.clearance(f'?term_id={self.term.id}')
        self.assertFalse(response.data['is_clear'])
        self.assertEqual(response.data['credit_balance'], 0)
        self.assertIn('blocked_report_card', response.data)
        self.assertIn('blocked_promotion', response.data)


class MyFeeClearanceStatusAPITests(InvoicePaymentAPITestData):
    """MyFeeClearanceStatusAPIView -- the self-service counterpart of
    FeeClearanceStatusAPIView added so StudentFeeStatementPage's own-statement
    view (no student_id to call the by-id endpoint with) can show the same
    blocked-gate badge a parent viewing a child already gets (Task 29 follow-up)."""
    def setUp(self):
        super().setUp()
        self.term.is_active = True
        self.term.save(update_fields=['is_active'])

    def my_clearance(self, user=None):
        return self.call(MyFeeClearanceStatusAPIView, 'get', '/x/', user or self.student.user)

    def test_student_can_check_their_own_clearance_status(self):
        response = self.my_clearance()
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data['is_clear'])

    def test_a_user_with_no_student_profile_is_forbidden(self):
        self.assertEqual(self.my_clearance(user=self.finance_user).status_code, 403)

    def test_blocked_fields_true_when_flags_on_and_no_override(self):
        update_fee_clearance_policy(updated_by=self.finance_user, block_report_cards=True, block_promotion=True)
        response = self.my_clearance()
        self.assertTrue(response.data['blocked_report_card'])
        self.assertTrue(response.data['blocked_promotion'])

    def test_blocked_fields_false_when_an_active_override_covers_the_current_term_and_year(self):
        update_fee_clearance_policy(updated_by=self.finance_user, block_report_cards=True, block_promotion=True)
        override_holder = self.make_user('my_clearance_override_holder', ['finance.override_clearance'])
        grant_clearance_override(
            student=self.student, gate='report_card', granted_by=override_holder, reason='hardship', term=self.term,
        )
        grant_clearance_override(
            student=self.student, gate='promotion', granted_by=override_holder, reason='hardship', academic_year=self.term.academic_year,
        )
        response = self.my_clearance()
        self.assertFalse(response.data['blocked_report_card'])
        self.assertFalse(response.data['blocked_promotion'])
