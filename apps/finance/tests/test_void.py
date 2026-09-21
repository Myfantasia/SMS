from django.contrib.auth.models import User
from django.contrib.contenttypes.models import ContentType
from django.core.exceptions import ValidationError
from django.test import TestCase

from apps.academics.models import AcademicYear, ExamTerm, GradeLevel, Curriculum, Tier
from apps.identity.models import StudentExtra
from apps.finance.models_fees import (
    FeeCategory, FeeStructure, FeeStructureItem, Invoice, Payment, StudentFeeLedgerEntry,
)
from apps.finance.services_fees import generate_invoice_for_student, record_payment, void_invoice, void_payment


def setUpModule():
    """Pre-warm the ContentType cache for the ledger's GenericForeignKey targets
    before any test transaction opens (see test_payments.setUpModule)."""
    ContentType.objects.get_for_model(Invoice)
    ContentType.objects.get_for_model(Payment)


def latest_balance(student):
    return StudentFeeLedgerEntry.objects.filter(student=student).order_by('-id').first().running_balance


class VoidTestData(TestCase):
    def setUp(self):
        curriculum = Curriculum.objects.create(name='CBC')
        tier = Tier.objects.create(name='Junior School', curriculum=curriculum)
        grade = GradeLevel.objects.create(name='Grade 7', numeric_order=7, curriculum_type='CBC', curriculum=curriculum, tier=tier)
        year = AcademicYear.objects.create(year='2026', is_active=True)
        term = ExamTerm.objects.create(name='Term 2', academic_year=year, start_date='2026-05-01', end_date='2026-08-01')
        structure = FeeStructure.objects.create(grade_level=grade, term=term, name='Grade 7 - Term 2 2026')
        FeeStructureItem.objects.create(fee_structure=structure, category=FeeCategory.objects.create(name='Tuition'), amount=15000)
        self.operator = User.objects.create_user(username='void_test_operator', password='x')
        student_user = User.objects.create_user(username='void_test_student', password='x')
        self.student = StudentExtra.objects.create(user=student_user, roll='VOID-1')
        self.invoice = generate_invoice_for_student(student=self.student, fee_structure=structure, operator=self.operator)


class VoidInvoiceTests(VoidTestData):
    def test_void_sets_fields_and_reverses_ledger_charge(self):
        void_invoice(invoice=self.invoice, voided_by=self.operator, reason='Duplicate generation')
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.status, 'voided')
        self.assertIsNotNone(self.invoice.voided_at)
        self.assertEqual(self.invoice.voided_by, self.operator)
        self.assertEqual(latest_balance(self.student), 0)

    def test_void_without_reason_is_rejected(self):
        with self.assertRaises(ValidationError):
            void_invoice(invoice=self.invoice, voided_by=self.operator, reason='   ')

    def test_double_void_is_rejected(self):
        void_invoice(invoice=self.invoice, voided_by=self.operator, reason='First void')
        with self.assertRaises(ValidationError):
            void_invoice(invoice=self.invoice, voided_by=self.operator, reason='Second void')

    def test_stale_in_memory_invoice_cannot_double_void(self):
        stale = Invoice.objects.get(pk=self.invoice.pk)  # still 'unpaid' in memory
        void_invoice(invoice=self.invoice, voided_by=self.operator, reason='First void')
        entries_before = StudentFeeLedgerEntry.objects.filter(student=self.student).count()
        with self.assertRaises(ValidationError):
            void_invoice(invoice=stale, voided_by=self.operator, reason='Second void')
        self.assertEqual(StudentFeeLedgerEntry.objects.filter(student=self.student).count(), entries_before)
        self.assertEqual(latest_balance(self.student), 0)

    def test_original_voided_invoice_remains_in_the_database(self):
        void_invoice(invoice=self.invoice, voided_by=self.operator, reason='Duplicate generation')
        self.assertTrue(Invoice.objects.filter(pk=self.invoice.pk).exists())

    def test_long_reason_is_stored_in_full_but_truncated_in_ledger_description(self):
        reason = 'x' * 600
        void_invoice(invoice=self.invoice, voided_by=self.operator, reason=reason)
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.void_reason, reason)
        entry = StudentFeeLedgerEntry.objects.filter(student=self.student).order_by('-id').first()
        self.assertEqual(len(entry.description), 255)

    def test_voiding_a_paid_invoice_leaves_payments_and_credits_the_ledger(self):
        # Intended: a void never touches payments. The student's ledger goes to
        # a credit equal to what they paid -- the seed of the overpayment
        # carry-forward feature.
        payment, _ = record_payment(
            student=self.student, amount=15000, method='cash',
            recorded_by=self.operator, invoice=self.invoice, date='2026-09-09',
        )
        void_invoice(invoice=self.invoice, voided_by=self.operator, reason='Billed in error')
        payment.refresh_from_db()
        self.assertIsNone(payment.voided_at)
        self.assertEqual(latest_balance(self.student), -15000)

    def test_voiding_a_partly_paid_invoice_leaves_payments_and_credits_the_ledger(self):
        payment, _ = record_payment(
            student=self.student, amount=5000, method='cash',
            recorded_by=self.operator, invoice=self.invoice, date='2026-09-09',
        )
        void_invoice(invoice=self.invoice, voided_by=self.operator, reason='Billed in error')
        payment.refresh_from_db()
        self.assertIsNone(payment.voided_at)
        self.assertEqual(latest_balance(self.student), -5000)


class VoidPaymentTests(VoidTestData):
    def setUp(self):
        super().setUp()
        self.payment, self.receipt = record_payment(
            student=self.student, amount=5000, method='cash',
            recorded_by=self.operator, invoice=self.invoice, date='2026-09-09',
        )

    def test_void_reverses_ledger_and_invoice_status(self):
        void_payment(payment=self.payment, voided_by=self.operator, reason='Wrong student credited')
        self.payment.refresh_from_db()
        self.invoice.refresh_from_db()
        self.assertIsNotNone(self.payment.voided_at)
        self.assertEqual(self.payment.voided_by, self.operator)
        self.assertEqual(self.invoice.status, 'unpaid')
        self.assertEqual(latest_balance(self.student), 15000)

    def test_void_without_reason_is_rejected(self):
        with self.assertRaises(ValidationError):
            void_payment(payment=self.payment, voided_by=self.operator, reason='')

    def test_already_voided_payment_is_refused_even_via_stale_object(self):
        stale = Payment.objects.get(pk=self.payment.pk)  # voided_at still None in memory
        void_payment(payment=self.payment, voided_by=self.operator, reason='First void')
        entries_before = StudentFeeLedgerEntry.objects.filter(student=self.student).count()
        with self.assertRaises(ValidationError):
            void_payment(payment=stale, voided_by=self.operator, reason='Second void')
        self.assertEqual(StudentFeeLedgerEntry.objects.filter(student=self.student).count(), entries_before)
        self.assertEqual(latest_balance(self.student), 15000)

    def test_voiding_a_payment_does_not_resurrect_a_voided_invoice(self):
        void_invoice(invoice=self.invoice, voided_by=self.operator, reason='Billed in error')
        void_payment(payment=self.payment, voided_by=self.operator, reason='Refunded')
        self.assertEqual(Invoice.objects.get(pk=self.invoice.pk).status, 'voided')

    def test_long_reason_is_stored_in_full_but_truncated_in_ledger_description(self):
        reason = 'y' * 600
        void_payment(payment=self.payment, voided_by=self.operator, reason=reason)
        self.payment.refresh_from_db()
        self.assertEqual(self.payment.void_reason, reason)
        entry = StudentFeeLedgerEntry.objects.filter(student=self.student).order_by('-id').first()
        self.assertEqual(len(entry.description), 255)
