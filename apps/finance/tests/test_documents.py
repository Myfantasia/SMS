import importlib.util
import unittest
from unittest import mock

from django.contrib.auth.models import User
from django.contrib.contenttypes.models import ContentType
from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.academics.models import AcademicYear, ExamTerm, GradeLevel, Curriculum, Tier
from apps.identity.models import Permission, Role, UserRole, StudentExtra, ParentExtra
from apps.finance.models_fees import (
    FeeCategory, FeeStructure, FeeStructureItem, Invoice, InvoiceCreditApplication,
    Payment, StudentFeeAdjustment,
)
from apps.finance.services_fees import generate_invoice_for_student, record_payment, void_invoice, void_payment
from apps.finance.services_documents import (
    build_invoice_html, build_receipt_html, render_invoice_pdf, render_receipt_pdf,
)
from apps.finance.views import InvoicePDFAPIView, ReceiptPDFAPIView

WEASYPRINT_AVAILABLE = importlib.util.find_spec('weasyprint') is not None


def setUpModule():
    """`finance` has no real migrations yet, so post_migrate never creates its
    ContentType rows; pre-warm them before any test transaction opens (see
    test_adjustments.setUpModule for the full rationale)."""
    for model in (Invoice, Payment, StudentFeeAdjustment, InvoiceCreditApplication):
        ContentType.objects.get_for_model(model)


class DocumentTestData(TestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        curriculum = Curriculum.objects.create(name='CBC')
        tier = Tier.objects.create(name='Junior School', curriculum=curriculum)
        grade = GradeLevel.objects.create(name='Grade 7', numeric_order=7, curriculum_type='CBC', curriculum=curriculum, tier=tier)
        year = AcademicYear.objects.create(year='2026', is_active=True)
        term = ExamTerm.objects.create(name='Term 2', academic_year=year, start_date='2026-05-01', end_date='2026-08-01')
        self.structure = FeeStructure.objects.create(grade_level=grade, term=term, name='Grade 7 - Term 2 2026')
        FeeStructureItem.objects.create(fee_structure=self.structure, category=FeeCategory.objects.create(name='Tuition'), amount=15000)
        FeeStructureItem.objects.create(fee_structure=self.structure, category=FeeCategory.objects.create(name='Transport'), amount=4000)
        self.operator = self.make_user('pdf_test_operator', ['finance.view', 'finance.void', 'finance.record_payment'])
        self.student = self.make_student(1, first_name='Wanjiru', last_name='Kamau')
        self.invoice = generate_invoice_for_student(student=self.student, fee_structure=self.structure, operator=self.operator)
        self.payment, self.receipt = record_payment(
            student=self.student, amount=15000, method='cash', recorded_by=self.operator,
            invoice=self.invoice, date='2026-09-09',
        )

    def make_user(self, username, codes, **extra):
        for code in codes:
            Permission.objects.get_or_create(code=code, defaults={'label': code, 'module': 'Finance'})
        user = User.objects.create_user(username=username, password='x', **extra)
        if codes:
            role = Role.objects.create(name=f'Role for {username}')
            role.permissions.set(Permission.objects.filter(code__in=codes))
            UserRole.objects.create(user=user, role=role)
        return user

    def make_student(self, n, **extra):
        user = User.objects.create_user(username=f'pdf_test_student_{n}', password='x', **extra)
        return StudentExtra.objects.create(user=user, roll=f'PDF-{n}')

    def make_parent(self, name, students, status=True):
        parent = ParentExtra.objects.create(user=User.objects.create_user(username=name, password='x'), mobile='0700', status=status)
        parent.students.set(students)
        return parent

    def fetch(self, view, user, **kwargs):
        request = self.factory.get('/pdf/')
        if user is not None:
            force_authenticate(request, user=user)
        return view.as_view()(request, **kwargs)


class InvoiceHtmlTests(DocumentTestData):
    def test_html_contains_the_invoice_details(self):
        html = build_invoice_html(self.invoice)
        for expected in (
            self.invoice.invoice_number, 'Wanjiru Kamau', 'Tuition', 'Transport', '15000', '4000', '19000',
            'Grade 7 - Term 2 2026', 'Term 2', 'Partially Paid', 'KES',
        ):
            self.assertIn(expected, html)

    def test_student_name_is_html_escaped(self):
        self.student.user.first_name = '<b>Tom&Jerry</b>'
        self.student.user.save()
        invoice = Invoice.objects.get(pk=self.invoice.pk)
        html = build_invoice_html(invoice)
        self.assertNotIn('<b>Tom', html)
        self.assertIn('&lt;b&gt;Tom&amp;Jerry&lt;/b&gt;', html)

    def test_void_banner_only_on_voided_invoice(self):
        self.assertNotIn('VOID', build_invoice_html(self.invoice))
        voided = void_invoice(invoice=self.invoice, voided_by=self.operator, reason='secret internal reason')
        html = build_invoice_html(voided)
        self.assertIn('VOID', html)
        self.assertIn(voided.voided_at.strftime('%Y-%m-%d'), html)
        self.assertNotIn('secret internal reason', html)

    def test_credit_applied_line_omitted_when_no_credit(self):
        self.assertNotIn('Credit applied', build_invoice_html(self.invoice))

    def test_credit_applied_line_shown_when_credit_was_applied(self):
        InvoiceCreditApplication.objects.create(student=self.student, invoice=self.invoice, amount=300)
        html = build_invoice_html(Invoice.objects.get(pk=self.invoice.pk))
        self.assertIn('Credit applied: KES 300', html)


class ReceiptHtmlTests(DocumentTestData):
    def test_html_contains_the_receipt_details(self):
        html = build_receipt_html(self.receipt)
        for expected in (
            self.receipt.receipt_number, 'Wanjiru Kamau', '15000', 'Cash', '2026-09-09',
            self.invoice.invoice_number, 'KES',
        ):
            self.assertIn(expected, html)

    def test_student_name_is_html_escaped(self):
        self.student.user.first_name = '<script>x</script>'
        self.student.user.save()
        html = build_receipt_html(self.receipt.__class__.objects.get(pk=self.receipt.pk))
        self.assertNotIn('<script>x', html)
        self.assertIn('&lt;script&gt;x&lt;/script&gt;', html)

    def test_payment_without_invoice_omits_applied_to_line(self):
        _payment, receipt = record_payment(
            student=self.student, amount=100, method='mpesa', recorded_by=self.operator, date='2026-09-10',
        )
        self.assertNotIn('Applied to invoice', build_receipt_html(receipt))

    def test_void_banner_only_on_receipt_of_voided_payment(self):
        self.assertNotIn('VOID', build_receipt_html(self.receipt))
        void_payment(payment=self.payment, voided_by=self.operator, reason='secret internal reason')
        html = build_receipt_html(self.receipt.__class__.objects.get(pk=self.receipt.pk))
        self.assertIn('VOID', html)
        self.assertNotIn('secret internal reason', html)

    def test_credit_carried_forward_line_omitted_with_no_credit_left(self):
        # self.invoice totals 19000 (Tuition 15000 + Transport 4000); self.payment
        # of 15000 only partially settles it, leaving 4000 still owed -- no credit.
        self.assertNotIn('Credit carried forward', build_receipt_html(self.receipt))

    def test_credit_carried_forward_line_shown_after_an_overpayment(self):
        # 4000 is still owed after setUp's payment; this payment of 6000 clears
        # that and leaves a 2000 credit.
        _overpayment, overpay_receipt = record_payment(
            student=self.student, amount=6000, method='cash', recorded_by=self.operator, date='2026-09-11',
        )
        html = build_receipt_html(overpay_receipt)
        self.assertIn('Credit carried forward: KES 2000', html)

    def test_credit_carried_forward_reflects_balance_right_after_this_payment_not_the_current_one(self):
        # Payment A (6000) clears the 4000 still owed and leaves a 2000 credit;
        # payment B (500) then pushes the running credit to 2500. Payment A's own
        # receipt must still report 2000 -- the balance at ITS post time.
        _payment_a, receipt_a = record_payment(
            student=self.student, amount=6000, method='cash', recorded_by=self.operator, date='2026-09-11',
        )
        record_payment(
            student=self.student, amount=500, method='cash', recorded_by=self.operator, date='2026-09-12',
        )
        self.assertIn('Credit carried forward: KES 2000', build_receipt_html(receipt_a))

    def test_credit_carried_forward_survives_voiding_a_later_unrelated_payment(self):
        # Payment A (6000) leaves a 2000 credit, same as above. void_payment posts a
        # SECOND ledger entry for a *different* payment (self.payment) with the same
        # content_type/object_id/entry_type shape as any payment's own entry, just a
        # positive correcting amount -- proving build_receipt_html's `amount__lt=0`
        # filter picks payment A's own entry and not get confused by an unrelated
        # payment's void landing nearby in the ledger.
        _payment_a, receipt_a = record_payment(
            student=self.student, amount=6000, method='cash', recorded_by=self.operator, date='2026-09-11',
        )
        void_payment(payment=self.payment, voided_by=self.operator, reason='unrelated void')
        self.assertIn('Credit carried forward: KES 2000', build_receipt_html(receipt_a))

    def test_credit_carried_forward_line_is_the_historical_figure_even_once_voided(self):
        # Voiding payment A itself posts A's OWN correcting (positive) entry with the
        # same content_type/object_id/entry_type as A's original entry. The
        # amount__lt=0 filter must still pick the original (negative) entry, not the
        # correcting one -- proving the receipt keeps reporting what was true when the
        # payment was made, same as it already keeps the original amount/method/date
        # alongside the VOID banner rather than blanking them.
        payment_a, receipt_a = record_payment(
            student=self.student, amount=6000, method='cash', recorded_by=self.operator, date='2026-09-11',
        )
        void_payment(payment=payment_a, voided_by=self.operator, reason='reversed')
        html = build_receipt_html(receipt_a.__class__.objects.get(pk=receipt_a.pk))
        self.assertIn('VOID', html)
        self.assertIn('Credit carried forward: KES 2000', html)


@unittest.skipUnless(WEASYPRINT_AVAILABLE, 'weasyprint is not installed (pip install -r requirements.txt)')
class RealPdfTests(DocumentTestData):
    def test_render_invoice_pdf_returns_pdf_bytes(self):
        self.assertTrue(render_invoice_pdf(self.invoice).startswith(b'%PDF'))

    def test_render_receipt_pdf_returns_pdf_bytes(self):
        self.assertTrue(render_receipt_pdf(self.receipt).startswith(b'%PDF'))


class InvoicePDFViewTests(DocumentTestData):
    def get(self, user, invoice_id=None):
        return self.fetch(InvoicePDFAPIView, user, invoice_id=invoice_id or self.invoice.id)

    @mock.patch('apps.finance.views.render_invoice_pdf', return_value=b'%PDF-fake')
    def test_finance_viewer_gets_the_pdf(self, render):
        response = self.get(self.operator)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'application/pdf')
        self.assertEqual(response['Content-Disposition'], f'inline; filename="{self.invoice.invoice_number}.pdf"')
        self.assertEqual(response.content, b'%PDF-fake')
        render.assert_called_once()

    @mock.patch('apps.finance.views.render_invoice_pdf', return_value=b'%PDF-fake')
    def test_own_student_and_linked_parent_can_download(self, _render):
        self.assertEqual(self.get(self.student.user).status_code, 200)
        parent = self.make_parent('pdf_linked_parent', [self.student])
        self.assertEqual(self.get(parent.user).status_code, 200)

    @mock.patch('apps.finance.views.render_invoice_pdf', return_value=b'%PDF-fake')
    def test_others_are_forbidden(self, render):
        other = self.make_student(2)
        unlinked = self.make_parent('pdf_unlinked_parent', [other])
        pending = self.make_parent('pdf_pending_parent', [self.student], status=False)
        for user in (other.user, unlinked.user, pending.user, self.make_user('pdf_nobody', [])):
            self.assertEqual(self.get(user).status_code, 403, user.username)
        render.assert_not_called()

    def test_unauthenticated_is_rejected(self):
        self.assertIn(self.get(None).status_code, (401, 403))

    def test_unknown_id_is_404_for_finance_and_403_for_others(self):
        self.assertEqual(self.get(self.operator, invoice_id=99999999).status_code, 404)
        self.assertEqual(self.get(self.student.user, invoice_id=99999999).status_code, 403)

    @mock.patch('apps.finance.views.render_invoice_pdf', side_effect=ImportError('no weasyprint'))
    def test_missing_weasyprint_is_a_503(self, _render):
        response = self.get(self.operator)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.data, {"error": "PDF generation is not available on this server."})

    @mock.patch('apps.finance.views.render_invoice_pdf', side_effect=OSError('libpango missing'))
    def test_missing_native_libs_is_a_503(self, _render):
        self.assertEqual(self.get(self.operator).status_code, 503)


class ReceiptPDFViewTests(DocumentTestData):
    def get(self, user, receipt_id=None):
        return self.fetch(ReceiptPDFAPIView, user, receipt_id=receipt_id or self.receipt.id)

    @mock.patch('apps.finance.views.render_receipt_pdf', return_value=b'%PDF-fake')
    def test_finance_viewer_gets_the_pdf(self, render):
        response = self.get(self.operator)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'application/pdf')
        self.assertEqual(response['Content-Disposition'], f'inline; filename="{self.receipt.receipt_number}.pdf"')
        self.assertEqual(response.content, b'%PDF-fake')

    @mock.patch('apps.finance.views.render_receipt_pdf', return_value=b'%PDF-fake')
    def test_own_student_and_linked_parent_can_download(self, _render):
        self.assertEqual(self.get(self.student.user).status_code, 200)
        parent = self.make_parent('pdf_linked_parent', [self.student])
        self.assertEqual(self.get(parent.user).status_code, 200)

    @mock.patch('apps.finance.views.render_receipt_pdf', return_value=b'%PDF-fake')
    def test_others_are_forbidden(self, render):
        other = self.make_student(2)
        unlinked = self.make_parent('pdf_unlinked_parent', [other])
        for user in (other.user, unlinked.user, self.make_user('pdf_nobody', [])):
            self.assertEqual(self.get(user).status_code, 403, user.username)
        render.assert_not_called()

    def test_unknown_id_is_404_for_finance_and_403_for_others(self):
        self.assertEqual(self.get(self.operator, receipt_id=99999999).status_code, 404)
        self.assertEqual(self.get(self.student.user, receipt_id=99999999).status_code, 403)

    @mock.patch('apps.finance.views.render_receipt_pdf', side_effect=ImportError('no weasyprint'))
    def test_missing_weasyprint_is_a_503(self, _render):
        response = self.get(self.operator)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.data, {"error": "PDF generation is not available on this server."})
