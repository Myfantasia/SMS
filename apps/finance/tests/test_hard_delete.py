import datetime
from unittest import mock

from django.contrib import admin as django_admin
from django.contrib.admin.helpers import ACTION_CHECKBOX_NAME
from django.contrib.auth.models import Permission, User
from django.contrib.contenttypes.models import ContentType
from django.contrib.messages import constants as message_levels
from django.core.exceptions import ObjectDoesNotExist, PermissionDenied, ValidationError
from django.test import RequestFactory, TestCase
from django.urls import reverse

from apps.academics.models import AcademicYear, ExamTerm, GradeLevel, Curriculum, Tier
from apps.core.models import SystemAuditLog
from apps.finance.admin import InvoiceAdmin, PaymentAdmin, hard_delete_selected
from apps.finance.models_fees import (
    FeeCategory, FeeStructure, FeeStructureItem, Invoice, InvoiceLineItem, Payment, Receipt, StudentFeeLedgerEntry,
)
from apps.finance.services_fees import (
    generate_invoice_for_student, hard_delete_financial_record, record_payment, void_invoice, void_payment,
)
from apps.identity.models import StudentExtra


def setUpModule():
    """Pre-warm the ContentType cache for the ledger's GenericForeignKey targets
    before any test transaction opens (see test_payments.setUpModule)."""
    ContentType.objects.get_for_model(Invoice)
    ContentType.objects.get_for_model(Payment)


class HardDeleteTestData(TestCase):
    def setUp(self):
        curriculum = Curriculum.objects.create(name='CBC')
        tier = Tier.objects.create(name='Junior School', curriculum=curriculum)
        grade = GradeLevel.objects.create(name='Grade 7', numeric_order=7, curriculum_type='CBC', curriculum=curriculum, tier=tier)
        year = AcademicYear.objects.create(year='2026', is_active=True)
        term = ExamTerm.objects.create(name='Term 2', academic_year=year, start_date='2026-05-01', end_date='2026-08-01')
        self.structure = FeeStructure.objects.create(grade_level=grade, term=term, name='Grade 7 - Term 2 2026')
        FeeStructureItem.objects.create(fee_structure=self.structure, category=FeeCategory.objects.create(name='Tuition'), amount=15000)
        self.superuser = User.objects.create_user(username='hard_delete_superuser', password='x', is_superuser=True)
        self.regular_admin = User.objects.create_user(username='hard_delete_regular_admin', password='x', is_staff=True)
        student_user = User.objects.create_user(username='hard_delete_student', password='x')
        self.student = StudentExtra.objects.create(user=student_user, roll='HD-1')
        self.invoice = generate_invoice_for_student(student=self.student, fee_structure=self.structure, operator=self.superuser)

    def hard_delete_audit_rows(self):
        return SystemAuditLog.objects.filter(action_type='HARD_DELETE')


class HardDeleteFinancialRecordTests(HardDeleteTestData):
    def test_non_superuser_is_rejected(self):
        void_invoice(invoice=self.invoice, voided_by=self.superuser, reason='test')
        with self.assertRaises(PermissionDenied):
            hard_delete_financial_record(model_class=Invoice, pk=self.invoice.pk, operator=self.regular_admin)
        self.assertTrue(Invoice.objects.filter(pk=self.invoice.pk).exists())
        self.assertEqual(self.hard_delete_audit_rows().count(), 0)

    def test_non_voided_record_is_rejected_even_for_superuser(self):
        with self.assertRaises(ValidationError):
            hard_delete_financial_record(model_class=Invoice, pk=self.invoice.pk, operator=self.superuser)
        self.assertTrue(Invoice.objects.filter(pk=self.invoice.pk).exists())
        self.assertEqual(self.hard_delete_audit_rows().count(), 0)

    def test_superuser_can_hard_delete_a_voided_invoice(self):
        void_invoice(invoice=self.invoice, voided_by=self.superuser, reason='test')
        hard_delete_financial_record(model_class=Invoice, pk=self.invoice.pk, operator=self.superuser)
        self.assertFalse(Invoice.objects.filter(pk=self.invoice.pk).exists())

    def test_permission_check_happens_before_any_database_access(self):
        with self.assertNumQueries(0):
            with self.assertRaises(PermissionDenied):
                hard_delete_financial_record(model_class=Invoice, pk=self.invoice.pk, operator=self.regular_admin)

    def test_hard_delete_writes_an_audit_log_entry_with_pk_and_void_reason(self):
        void_invoice(invoice=self.invoice, voided_by=self.superuser, reason='entered twice by mistake')
        invoice_pk = self.invoice.pk
        hard_delete_financial_record(model_class=Invoice, pk=invoice_pk, operator=self.superuser)
        row = SystemAuditLog.objects.get(action_type='HARD_DELETE', module='finance')
        self.assertIn(str(invoice_pk), row.description)
        self.assertIn('entered twice by mistake', row.description)
        self.assertEqual(row.operator_id, self.superuser.id)

    def test_invoice_line_items_are_removed_with_the_invoice(self):
        void_invoice(invoice=self.invoice, voided_by=self.superuser, reason='test')
        self.assertTrue(InvoiceLineItem.objects.filter(invoice_id=self.invoice.pk).exists())
        hard_delete_financial_record(model_class=Invoice, pk=self.invoice.pk, operator=self.superuser)
        self.assertFalse(InvoiceLineItem.objects.filter(invoice_id=self.invoice.pk).exists())

    def test_ledger_rows_for_the_deleted_invoice_are_kept(self):
        void_invoice(invoice=self.invoice, voided_by=self.superuser, reason='test')
        ledger_before = StudentFeeLedgerEntry.objects.filter(student=self.student).count()
        self.assertGreaterEqual(ledger_before, 2)  # the charge and its void reversal
        hard_delete_financial_record(model_class=Invoice, pk=self.invoice.pk, operator=self.superuser)
        self.assertEqual(StudentFeeLedgerEntry.objects.filter(student=self.student).count(), ledger_before)
        # The GenericForeignKey now dangles: the audit trail survives, its target does not.
        self.assertIsNone(StudentFeeLedgerEntry.objects.filter(student=self.student).first().reference)

    def test_invoice_with_a_payment_cannot_be_hard_deleted(self):
        record_payment(student=self.student, amount=5000, method='cash', recorded_by=self.superuser, invoice=self.invoice)
        void_invoice(invoice=self.invoice, voided_by=self.superuser, reason='test')
        with self.assertRaisesMessage(ValidationError, 'Payment'):
            hard_delete_financial_record(model_class=Invoice, pk=self.invoice.pk, operator=self.superuser)
        self.assertTrue(Invoice.objects.filter(pk=self.invoice.pk).exists())
        self.assertTrue(InvoiceLineItem.objects.filter(invoice_id=self.invoice.pk).exists())
        self.assertEqual(self.hard_delete_audit_rows().count(), 0)

    def test_voided_payment_with_a_receipt_is_hard_deleted_together_with_its_receipt(self):
        # record_payment() always issues a receipt; hard delete removes it explicitly, in the
        # same transaction, and records its number in the audit log.
        payment, receipt = record_payment(student=self.student, amount=5000, method='cash', recorded_by=self.superuser)
        void_payment(payment=payment, voided_by=self.superuser, reason='duplicate entry')
        ledger_before = StudentFeeLedgerEntry.objects.filter(student=self.student).count()
        hard_delete_financial_record(model_class=Payment, pk=payment.pk, operator=self.superuser)
        self.assertFalse(Payment.objects.filter(pk=payment.pk).exists())
        self.assertFalse(Receipt.objects.filter(pk=receipt.pk).exists())
        self.assertEqual(StudentFeeLedgerEntry.objects.filter(student=self.student).count(), ledger_before)
        row = self.hard_delete_audit_rows().get()
        self.assertIn(str(payment.pk), row.description)
        self.assertIn('duplicate entry', row.description)
        self.assertIn(receipt.receipt_number, row.description)

    def test_non_superuser_cannot_hard_delete_a_payment_and_its_receipt_is_kept(self):
        payment, receipt = record_payment(student=self.student, amount=5000, method='cash', recorded_by=self.superuser)
        void_payment(payment=payment, voided_by=self.superuser, reason='test')
        with self.assertRaises(PermissionDenied):
            hard_delete_financial_record(model_class=Payment, pk=payment.pk, operator=self.regular_admin)
        self.assertTrue(Payment.objects.filter(pk=payment.pk).exists())
        self.assertTrue(Receipt.objects.filter(pk=receipt.pk).exists())
        self.assertEqual(self.hard_delete_audit_rows().count(), 0)

    def test_unvoided_payment_is_refused_and_its_receipt_is_kept(self):
        payment, receipt = record_payment(student=self.student, amount=5000, method='cash', recorded_by=self.superuser)
        with self.assertRaises(ValidationError):
            hard_delete_financial_record(model_class=Payment, pk=payment.pk, operator=self.superuser)
        self.assertTrue(Payment.objects.filter(pk=payment.pk).exists())
        self.assertTrue(Receipt.objects.filter(pk=receipt.pk).exists())
        self.assertEqual(self.hard_delete_audit_rows().count(), 0)

    def test_voided_payment_without_a_receipt_can_be_hard_deleted_and_ledger_is_kept(self):
        payment = Payment.objects.create(
            student=self.student, amount=5000, method='cash', status='pending',
            recorded_by=self.superuser, date=datetime.date(2026, 6, 1),
        )
        void_payment(payment=payment, voided_by=self.superuser, reason='never cleared')
        ledger_before = StudentFeeLedgerEntry.objects.filter(student=self.student).count()
        hard_delete_financial_record(model_class=Payment, pk=payment.pk, operator=self.superuser)
        self.assertFalse(Payment.objects.filter(pk=payment.pk).exists())
        self.assertEqual(StudentFeeLedgerEntry.objects.filter(student=self.student).count(), ledger_before)
        row = self.hard_delete_audit_rows().get()
        self.assertIn(str(payment.pk), row.description)
        self.assertIn('never cleared', row.description)


class HardDeleteAdminActionTests(HardDeleteTestData):
    def _request(self, user):
        request = RequestFactory().post('/admin/finance/invoice/')
        request.user = user
        return request

    def _run_action(self, user, queryset):
        model_admin = InvoiceAdmin(Invoice, django_admin.site)
        with mock.patch.object(model_admin, 'message_user') as message_user:
            hard_delete_selected(model_admin, self._request(user), queryset)
        return message_user

    def test_superuser_hard_deletes_a_voided_invoice_through_the_action(self):
        void_invoice(invoice=self.invoice, voided_by=self.superuser, reason='test')
        message_user = self._run_action(self.superuser, Invoice.objects.filter(pk=self.invoice.pk))
        self.assertFalse(Invoice.objects.filter(pk=self.invoice.pk).exists())
        self.assertIn('Hard-deleted 1 record(s).', message_user.call_args.args[1])
        self.assertEqual(message_user.call_args.kwargs['level'], message_levels.SUCCESS)

    def test_non_superuser_gets_an_error_and_nothing_is_deleted(self):
        void_invoice(invoice=self.invoice, voided_by=self.superuser, reason='test')
        message_user = self._run_action(self.regular_admin, Invoice.objects.filter(pk=self.invoice.pk))
        self.assertTrue(Invoice.objects.filter(pk=self.invoice.pk).exists())
        self.assertEqual(message_user.call_args.kwargs['level'], message_levels.ERROR)
        self.assertEqual(self.hard_delete_audit_rows().count(), 0)

    def test_action_reports_a_blocked_delete_as_an_error(self):
        message_user = self._run_action(self.superuser, Invoice.objects.filter(pk=self.invoice.pk))  # not voided
        self.assertTrue(Invoice.objects.filter(pk=self.invoice.pk).exists())
        self.assertEqual(message_user.call_args.kwargs['level'], message_levels.ERROR)

    def test_only_the_hard_delete_action_is_offered_on_invoice_and_payment_admins(self):
        for model, model_admin_class in ((Invoice, InvoiceAdmin), (Payment, PaymentAdmin)):
            model_admin = model_admin_class(model, django_admin.site)
            request = self._request(self.superuser)
            self.assertEqual(list(model_admin.get_actions(request)), ['hard_delete_selected'])

    def test_superuser_sees_hard_delete_action_in_invoice_admin_get_actions(self):
        model_admin = InvoiceAdmin(Invoice, django_admin.site)
        request = self._request(self.superuser)
        actions = model_admin.get_actions(request)
        self.assertIn('hard_delete_selected', actions)

    def test_superuser_sees_hard_delete_action_in_payment_admin_get_actions(self):
        model_admin = PaymentAdmin(Payment, django_admin.site)
        request = self._request(self.superuser)
        actions = model_admin.get_actions(request)
        self.assertIn('hard_delete_selected', actions)

    def test_non_superuser_staff_does_not_see_hard_delete_action_in_invoice_admin(self):
        model_admin = InvoiceAdmin(Invoice, django_admin.site)
        request = self._request(self.regular_admin)
        actions = model_admin.get_actions(request)
        self.assertNotIn('hard_delete_selected', actions)

    def test_non_superuser_staff_does_not_see_hard_delete_action_in_payment_admin(self):
        model_admin = PaymentAdmin(Payment, django_admin.site)
        request = self._request(self.regular_admin)
        actions = model_admin.get_actions(request)
        self.assertNotIn('hard_delete_selected', actions)

    def test_superuser_hard_deletes_a_voided_payment_with_a_receipt_through_the_payment_admin(self):
        payment, receipt = record_payment(student=self.student, amount=5000, method='cash', recorded_by=self.superuser)
        void_payment(payment=payment, voided_by=self.superuser, reason='duplicate entry')
        model_admin = PaymentAdmin(Payment, django_admin.site)
        with mock.patch.object(model_admin, 'message_user') as message_user:
            hard_delete_selected(model_admin, self._request(self.superuser), Payment.objects.filter(pk=payment.pk))
        self.assertFalse(Payment.objects.filter(pk=payment.pk).exists())
        self.assertFalse(Receipt.objects.filter(pk=receipt.pk).exists())
        self.assertEqual(message_user.call_args.kwargs['level'], message_levels.SUCCESS)
        self.assertIn(receipt.receipt_number, self.hard_delete_audit_rows().get().description)

    def test_object_does_not_exist_is_reported_as_a_clean_error(self):
        # A record that vanishes between selection and execution (e.g. deleted by another
        # operator in the meantime) must be reported the same clean way as PermissionDenied
        # and ValidationError, not surfaced as an unhandled 500.
        void_invoice(invoice=self.invoice, voided_by=self.superuser, reason='test')
        with mock.patch(
            'apps.finance.admin.hard_delete_financial_record',
            side_effect=ObjectDoesNotExist('Invoice matching query does not exist.'),
        ):
            message_user = self._run_action(self.superuser, Invoice.objects.filter(pk=self.invoice.pk))
        self.assertEqual(message_user.call_args.kwargs['level'], message_levels.ERROR)
        self.assertTrue(Invoice.objects.filter(pk=self.invoice.pk).exists())
        self.assertEqual(self.hard_delete_audit_rows().count(), 0)

    def test_forged_post_bypassing_the_action_dropdown_still_requires_superuser(self):
        # SuperuserOnlyActionsMixin only hides the action from the dropdown menu. A
        # forged POST naming the action directly (bypassing that menu) must still be
        # refused for a non-superuser, and must still work for a superuser. Note this
        # test exercises the FULL HTTP layer, where Django's own response_action()
        # validates the posted action name against get_action_choices() BEFORE ever
        # calling hard_delete_selected -- so for a non-superuser this is actually
        # blocked by that layer, not by hard_delete_selected's own is_superuser check
        # (admin.py's `if not request.user.is_superuser` early-return). That check is
        # exercised in isolation by test_own_superuser_check_refuses_before_calling_the_service
        # below, which calls the action function directly and bypasses get_actions().
        void_invoice(invoice=self.invoice, voided_by=self.superuser, reason='test')
        changelist_url = reverse('admin:finance_invoice_changelist')
        post_data = {
            'action': 'hard_delete_selected',
            ACTION_CHECKBOX_NAME: [str(self.invoice.pk)],
            'index': '0',
        }

        view_permission = Permission.objects.get(
            codename='view_invoice', content_type=ContentType.objects.get_for_model(Invoice),
        )
        self.regular_admin.user_permissions.add(view_permission)
        self.client.force_login(self.regular_admin)
        response = self.client.post(changelist_url, post_data, follow=True)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(Invoice.objects.filter(pk=self.invoice.pk).exists())
        self.assertEqual(self.hard_delete_audit_rows().count(), 0)

        # Django admin's own gate (AdminSite.has_permission) requires is_staff, separately
        # from is_superuser -- self.superuser (setUp) is deliberately is_staff=False to prove
        # the service-layer check elsewhere doesn't depend on it, so a second, admin-accessible
        # superuser is needed here to actually reach the changelist view over HTTP and confirm
        # a genuine superuser's forged POST still works.
        staff_superuser = User.objects.create_user(
            username='hard_delete_staff_superuser', password='x', is_superuser=True, is_staff=True,
        )
        self.client.force_login(staff_superuser)
        response = self.client.post(changelist_url, post_data, follow=True)
        self.assertEqual(response.status_code, 200)
        self.assertFalse(Invoice.objects.filter(pk=self.invoice.pk).exists())

    def test_own_superuser_check_refuses_before_calling_the_service(self):
        # Isolates hard_delete_selected's OWN `if not request.user.is_superuser` check
        # (admin.py) from the service layer's independent PermissionDenied check
        # (hard_delete_financial_record) and from Django's get_actions()-based dropdown
        # filtering (neither of which is invoked here). The mock never raising anything
        # proves the action's own early-return is what refuses this call -- if that
        # early-return were deleted, the mock WOULD get called and "succeed", flipping
        # this assertion.
        with mock.patch('apps.finance.admin.hard_delete_financial_record') as mocked_service:
            message_user = self._run_action(self.regular_admin, Invoice.objects.filter(pk=self.invoice.pk))
        mocked_service.assert_not_called()
        self.assertEqual(message_user.call_args.kwargs['level'], message_levels.ERROR)
        self.assertIn('superuser', message_user.call_args.args[1].lower())
