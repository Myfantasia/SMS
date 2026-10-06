from django.contrib.auth.models import User
from django.contrib.contenttypes.models import ContentType
from django.core.exceptions import ValidationError
from django.test import TestCase

from apps.academics.models import AcademicYear, ExamTerm, GradeLevel, Curriculum, Tier
from apps.identity.models import StudentExtra
from apps.finance.models_fees import (
    FeeCategory, FeeStructure, FeeStructureItem, Invoice, InvoiceCreditApplication, Payment,
    StudentFeeLedgerEntry,
)
from apps.finance.models_shared import FinancialRecordImmutableError
from apps.finance.services import get_credit_balance as reexported_get_credit_balance
from apps.finance.services_fees import (
    generate_invoice_for_student, get_credit_balance, record_payment, void_invoice, void_payment,
)


def setUpModule():
    """Pre-warm the ContentType cache for the ledger's GenericForeignKey targets
    (and the credit-application model) before any test transaction opens — see
    test_payments.setUpModule."""
    ContentType.objects.get_for_model(Invoice)
    ContentType.objects.get_for_model(Payment)
    ContentType.objects.get_for_model(InvoiceCreditApplication)


def latest_balance(student):
    return StudentFeeLedgerEntry.objects.filter(student=student).order_by('-id').first().running_balance


class CreditTestData(TestCase):
    """Two consecutive terms for one grade (term 1 total 15000, term 2 total
    `term2_total`), one student, nothing invoiced yet."""
    term2_total = 20000

    def setUp(self):
        curriculum = Curriculum.objects.create(name='CBC')
        tier = Tier.objects.create(name='Junior School', curriculum=curriculum)
        grade = GradeLevel.objects.create(name='Grade 7', numeric_order=7, curriculum_type='CBC', curriculum=curriculum, tier=tier)
        year = AcademicYear.objects.create(year='2026', is_active=True)
        term1 = ExamTerm.objects.create(name='Term 1', academic_year=year, start_date='2026-01-05', end_date='2026-04-01')
        term2 = ExamTerm.objects.create(name='Term 2', academic_year=year, start_date='2026-05-01', end_date='2026-08-01')
        tuition = FeeCategory.objects.create(name='Tuition')
        self.structure1 = FeeStructure.objects.create(grade_level=grade, term=term1, name='Grade 7 - Term 1 2026')
        FeeStructureItem.objects.create(fee_structure=self.structure1, category=tuition, amount=15000)
        self.structure2 = FeeStructure.objects.create(grade_level=grade, term=term2, name='Grade 7 - Term 2 2026')
        FeeStructureItem.objects.create(fee_structure=self.structure2, category=tuition, amount=self.term2_total)
        self.operator = User.objects.create_user(username='credit_test_operator', password='x')
        student_user = User.objects.create_user(username='credit_test_student', password='x')
        self.student = StudentExtra.objects.create(user=student_user, roll='CREDIT-1')
        self.invoice1 = generate_invoice_for_student(student=self.student, fee_structure=self.structure1, operator=self.operator)

    def overpay_term1(self, excess=5000):
        return record_payment(
            student=self.student, amount=15000 + excess, method='cash',
            recorded_by=self.operator, invoice=self.invoice1, date='2026-09-09',
        )

    def generate_term2(self):
        return generate_invoice_for_student(student=self.student, fee_structure=self.structure2, operator=self.operator)


class GetCreditBalanceTests(CreditTestData):
    def test_no_ledger_entries_means_no_credit(self):
        other_user = User.objects.create_user(username='credit_test_other', password='x')
        other = StudentExtra.objects.create(user=other_user, roll='CREDIT-2')
        self.assertEqual(get_credit_balance(other), 0)

    def test_positive_balance_means_no_credit(self):
        self.assertEqual(latest_balance(self.student), 15000)
        self.assertEqual(get_credit_balance(self.student), 0)

    def test_negative_balance_is_the_credit(self):
        self.overpay_term1(excess=5000)
        self.assertEqual(latest_balance(self.student), -5000)
        self.assertEqual(get_credit_balance(self.student), 5000)

    def test_is_re_exported_from_the_public_services_module(self):
        self.assertIs(reexported_get_credit_balance, get_credit_balance)


class CreditApplicationOnGenerationTests(CreditTestData):
    def test_credit_smaller_than_total_leaves_invoice_partially_paid(self):
        self.overpay_term1(excess=5000)
        invoice2 = self.generate_term2()
        self.assertEqual(invoice2.status, 'partially_paid')
        application = InvoiceCreditApplication.objects.get(invoice=invoice2)
        self.assertEqual(application.amount, 5000)
        self.assertEqual(application.student, self.student)
        self.assertEqual(latest_balance(self.student), 20000 - 5000)
        self.assertEqual(get_credit_balance(self.student), 0)

    def test_credit_larger_than_total_marks_invoice_paid_and_keeps_the_remainder(self):
        self.overpay_term1(excess=25000)
        invoice2 = self.generate_term2()
        self.assertEqual(invoice2.status, 'paid')
        self.assertEqual(InvoiceCreditApplication.objects.get(invoice=invoice2).amount, 20000)
        self.assertEqual(get_credit_balance(self.student), 5000)

    def test_no_credit_means_no_application_row(self):
        invoice2 = self.generate_term2()
        self.assertEqual(invoice2.status, 'unpaid')
        self.assertFalse(InvoiceCreditApplication.objects.exists())

    def test_the_application_posts_no_ledger_entry(self):
        self.overpay_term1(excess=5000)
        entries_before_generation = StudentFeeLedgerEntry.objects.filter(student=self.student).count()
        self.generate_term2()
        # Exactly one new row (the charge); the credit application adds none.
        self.assertEqual(StudentFeeLedgerEntry.objects.filter(student=self.student).count(), entries_before_generation + 1)
        self.assertEqual(latest_balance(self.student), 20000 - 5000)

    def test_a_later_payment_for_the_remainder_marks_the_invoice_paid(self):
        self.overpay_term1(excess=5000)
        invoice2 = self.generate_term2()
        record_payment(
            student=self.student, amount=15000, method='cash',
            recorded_by=self.operator, invoice=invoice2, date='2026-09-10',
        )
        invoice2.refresh_from_db()
        self.assertEqual(invoice2.status, 'paid')
        self.assertEqual(latest_balance(self.student), 0)


class ZeroTotalInvoiceCreditTests(CreditTestData):
    def test_a_zero_total_invoice_takes_no_credit(self):
        self.overpay_term1(excess=5000)
        empty_structure = FeeStructure.objects.create(
            grade_level=self.structure1.grade_level,
            term=ExamTerm.objects.create(
                name='Term 3', academic_year=self.structure1.term.academic_year,
                start_date='2026-09-01', end_date='2026-12-01',
            ),
            name='Grade 7 - Term 3 2026',
        )
        invoice = generate_invoice_for_student(student=self.student, fee_structure=empty_structure, operator=self.operator)
        self.assertEqual(invoice.total, 0)
        self.assertFalse(InvoiceCreditApplication.objects.exists())
        self.assertEqual(get_credit_balance(self.student), 5000)


class VoidWithCreditTests(CreditTestData):
    def test_voiding_the_consuming_invoice_restores_the_credit_for_the_next_one(self):
        self.overpay_term1(excess=5000)
        invoice2 = self.generate_term2()
        self.assertEqual(get_credit_balance(self.student), 0)

        void_invoice(invoice=invoice2, voided_by=self.operator, reason='Wrong structure')
        self.assertEqual(get_credit_balance(self.student), 5000)
        invoice2.refresh_from_db()
        self.assertEqual(invoice2.status, 'voided')

        # The next generated invoice for the same structure consumes the restored credit.
        invoice2b = self.generate_term2()
        self.assertEqual(invoice2b.status, 'partially_paid')
        self.assertEqual(InvoiceCreditApplication.objects.get(invoice=invoice2b).amount, 5000)
        self.assertEqual(get_credit_balance(self.student), 0)

    def test_void_payment_is_refused_while_a_later_invoice_holds_credit_from_it(self):
        payment, _ = self.overpay_term1(excess=5000)
        self.generate_term2()
        with self.assertRaises(ValidationError) as ctx:
            void_payment(payment=payment, voided_by=self.operator, reason='Bounced')
        self.assertIn('void', str(ctx.exception).lower())
        payment.refresh_from_db()
        self.assertIsNone(payment.voided_at)

    def test_void_payment_is_allowed_once_the_consuming_invoice_is_voided(self):
        payment, _ = self.overpay_term1(excess=5000)
        invoice2 = self.generate_term2()
        void_invoice(invoice=invoice2, voided_by=self.operator, reason='Wrong structure')
        void_payment(payment=payment, voided_by=self.operator, reason='Bounced')
        payment.refresh_from_db()
        self.assertIsNotNone(payment.voided_at)

    def test_void_payment_is_allowed_when_the_credit_application_predates_the_payment(self):
        # Credit from payment A is consumed by invoice 2; payment B is recorded
        # afterwards, so voiding B must not be blocked by that older application.
        self.overpay_term1(excess=5000)
        invoice2 = self.generate_term2()
        payment_b, _ = record_payment(
            student=self.student, amount=1000, method='cash',
            recorded_by=self.operator, invoice=invoice2, date='2026-09-10',
        )
        void_payment(payment=payment_b, voided_by=self.operator, reason='Mistake')
        payment_b.refresh_from_db()
        self.assertIsNotNone(payment_b.voided_at)


class InvoiceCreditApplicationModelTests(CreditTestData):
    def test_amount_cannot_be_changed_after_creation(self):
        self.overpay_term1(excess=5000)
        self.generate_term2()
        application = InvoiceCreditApplication.objects.get()
        application.amount = 1
        with self.assertRaises(FinancialRecordImmutableError):
            application.save()
