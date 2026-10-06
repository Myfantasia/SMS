from django.contrib.auth.models import User
import datetime

from django.contrib.contenttypes.models import ContentType
from django.core.exceptions import ValidationError
from django.test import TestCase

from apps.academics.models import AcademicYear, ExamTerm, GradeLevel, Curriculum, Tier
from apps.identity.models import StudentExtra
from apps.finance.models_fees import (
    FeeCategory, FeeStructure, FeeStructureItem, Invoice, Payment, Receipt, StudentFeeLedgerEntry,
)
from apps.finance.services_fees import (
    _recalculate_invoice_status, generate_invoice_for_student, record_payment,
)


def setUpModule():
    """generate_invoice_for_student() and record_payment() post ledger entries
    referencing an Invoice / Payment (a GenericForeignKey). `finance` has no
    real migrations, so post_migrate never pre-creates those ContentType rows;
    left to happen lazily inside a test's savepoint, they get rolled back at
    teardown while ContentType's process-wide get_for_model() cache keeps the
    dangling ids, breaking every later test. Pre-warm them here, before any
    test's transaction opens."""
    ContentType.objects.get_for_model(Invoice)
    ContentType.objects.get_for_model(Payment)


class PaymentTestData(TestCase):
    def setUp(self):
        curriculum = Curriculum.objects.create(name='CBC')
        tier = Tier.objects.create(name='Junior School', curriculum=curriculum)
        grade = GradeLevel.objects.create(name='Grade 7', numeric_order=7, curriculum_type='CBC', curriculum=curriculum, tier=tier)
        year = AcademicYear.objects.create(year='2026', is_active=True)
        term = ExamTerm.objects.create(name='Term 2', academic_year=year, start_date='2026-05-01', end_date='2026-08-01')
        structure = FeeStructure.objects.create(grade_level=grade, term=term, name='Grade 7 - Term 2 2026')
        FeeStructureItem.objects.create(
            fee_structure=structure, category=FeeCategory.objects.create(name='Tuition'), amount=15000,
        )
        self.operator = User.objects.create_user(username='payment_test_operator', password='x')
        student_user = User.objects.create_user(username='payment_test_student', password='x')
        self.student = StudentExtra.objects.create(user=student_user, roll='PAY-1')
        self.invoice = generate_invoice_for_student(student=self.student, fee_structure=structure, operator=self.operator)


class RecordPaymentTests(PaymentTestData):
    def test_full_payment_marks_invoice_paid(self):
        payment, receipt = record_payment(
            student=self.student, amount=15000, method='cash',
            recorded_by=self.operator, invoice=self.invoice, date='2026-09-09',
        )
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.status, 'paid')
        self.assertIsNotNone(receipt.receipt_number)

    def test_partial_payment_marks_invoice_partially_paid(self):
        record_payment(
            student=self.student, amount=5000, method='cash',
            recorded_by=self.operator, invoice=self.invoice, date='2026-09-09',
        )
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.status, 'partially_paid')

    def test_payment_reduces_ledger_running_balance(self):
        record_payment(
            student=self.student, amount=5000, method='cash',
            recorded_by=self.operator, invoice=self.invoice, date='2026-09-09',
        )
        latest_entry = StudentFeeLedgerEntry.objects.filter(student=self.student).order_by('-id').first()
        self.assertEqual(latest_entry.running_balance, 10000)

    def test_receipt_is_generated_synchronously(self):
        payment, receipt = record_payment(
            student=self.student, amount=15000, method='cash',
            recorded_by=self.operator, invoice=self.invoice, date='2026-09-09',
        )
        self.assertEqual(receipt.payment, payment)
        self.assertTrue(receipt.receipt_number.startswith('RCPT-'))

    def test_payment_without_invoice_applies_to_overall_balance(self):
        payment, receipt = record_payment(
            student=self.student, amount=1000, method='cash',
            recorded_by=self.operator, invoice=None, date='2026-09-09',
        )
        self.assertIsNone(payment.invoice)
        latest_entry = StudentFeeLedgerEntry.objects.filter(student=self.student).order_by('-id').first()
        self.assertEqual(latest_entry.running_balance, 14000)


class RecordPaymentGuardTests(PaymentTestData):
    def _counts(self):
        return (Payment.objects.count(), Receipt.objects.count(), StudentFeeLedgerEntry.objects.count())

    def test_payment_against_voided_invoice_raises_and_writes_nothing(self):
        Invoice.objects.filter(pk=self.invoice.pk).update(status='voided')
        before = self._counts()
        # self.invoice in memory is stale (still 'unpaid'); the guard must re-read the DB.
        with self.assertRaises(ValidationError):
            record_payment(
                student=self.student, amount=1000, method='cash',
                recorded_by=self.operator, invoice=self.invoice, date='2026-09-09',
            )
        self.assertEqual(self._counts(), before)

    def test_recalculate_invoice_status_leaves_voided_invoice_voided(self):
        Invoice.objects.filter(pk=self.invoice.pk).update(status='voided')
        stale = Invoice.objects.get(pk=self.invoice.pk)
        stale.status = 'unpaid'  # stale in-memory copy
        _recalculate_invoice_status(stale)
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.status, 'voided')

    def test_payment_for_other_students_invoice_raises_and_writes_nothing(self):
        other_user = User.objects.create_user(username='payment_test_student_b', password='x')
        student_b = StudentExtra.objects.create(user=other_user, roll='PAY-2')
        before = self._counts()
        with self.assertRaises(ValidationError):
            record_payment(
                student=student_b, amount=1000, method='cash',
                recorded_by=self.operator, invoice=self.invoice, date='2026-09-09',
            )
        self.assertEqual(self._counts(), before)

    def test_zero_amount_raises_and_writes_nothing(self):
        before = self._counts()
        with self.assertRaises(ValidationError):
            record_payment(
                student=self.student, amount=0, method='cash',
                recorded_by=self.operator, invoice=self.invoice, date='2026-09-09',
            )
        self.assertEqual(self._counts(), before)

    def test_negative_amount_raises_and_writes_nothing(self):
        before = self._counts()
        with self.assertRaises(ValidationError):
            record_payment(
                student=self.student, amount=-500, method='cash',
                recorded_by=self.operator, invoice=self.invoice, date='2026-09-09',
            )
        self.assertEqual(self._counts(), before)

    def test_backdated_payment_posts_ledger_entry_on_payment_date(self):
        payment, _ = record_payment(
            student=self.student, amount=1000, method='cash',
            recorded_by=self.operator, invoice=self.invoice, date='2026-09-09',
        )
        entry = StudentFeeLedgerEntry.objects.filter(student=self.student, entry_type='payment').get()
        self.assertEqual(entry.date, datetime.date(2026, 9, 9))
        payment.refresh_from_db()
        self.assertEqual(payment.date, datetime.date(2026, 9, 9))

    def test_date_object_is_accepted(self):
        record_payment(
            student=self.student, amount=1000, method='cash',
            recorded_by=self.operator, invoice=self.invoice, date=datetime.date(2026, 8, 15),
        )
        entry = StudentFeeLedgerEntry.objects.filter(student=self.student, entry_type='payment').get()
        self.assertEqual(entry.date, datetime.date(2026, 8, 15))
