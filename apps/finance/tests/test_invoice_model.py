from django.contrib.auth.models import User
from django.db import IntegrityError
from django.test import TestCase

from apps.academics.models import AcademicYear, ExamTerm, GradeLevel, Curriculum, Tier
from apps.identity.models import StudentExtra
from apps.finance.models_fees import FeeCategory, FeeStructure, Invoice, InvoiceLineItem
from apps.finance.models_shared import FinancialRecordImmutableError


class InvoiceTestData(TestCase):
    def setUp(self):
        curriculum = Curriculum.objects.create(name='CBC')
        tier = Tier.objects.create(name='Junior School', curriculum=curriculum)
        grade = GradeLevel.objects.create(name='Grade 7', numeric_order=7, curriculum_type='CBC', curriculum=curriculum, tier=tier)
        year = AcademicYear.objects.create(year='2026', is_active=True)
        term = ExamTerm.objects.create(name='Term 2', academic_year=year, start_date='2026-05-01', end_date='2026-08-01')
        self.structure = FeeStructure.objects.create(grade_level=grade, term=term, name='Grade 7 - Term 2 2026')
        self.category = FeeCategory.objects.create(name='Tuition')
        user = User.objects.create_user(username='invoice_student', password='x')
        self.student = StudentExtra.objects.create(user=user)


class InvoiceModelTests(InvoiceTestData):
    def test_can_create_invoice(self):
        invoice = Invoice.objects.create(
            student=self.student, fee_structure=self.structure, total=15000,
            invoice_number='INV-2026-000001',
        )
        self.assertEqual(invoice.status, 'unpaid')

    def test_total_cannot_be_changed_after_creation(self):
        invoice = Invoice.objects.create(
            student=self.student, fee_structure=self.structure, total=15000,
            invoice_number='INV-2026-000002',
        )
        invoice.total = 99999
        with self.assertRaises(FinancialRecordImmutableError):
            invoice.save()

    def test_status_can_be_changed_after_creation(self):
        invoice = Invoice.objects.create(
            student=self.student, fee_structure=self.structure, total=15000,
            invoice_number='INV-2026-000003',
        )
        invoice.status = 'paid'
        invoice.save()
        invoice.refresh_from_db()
        self.assertEqual(invoice.status, 'paid')

    def test_invoice_number_must_be_unique(self):
        Invoice.objects.create(student=self.student, fee_structure=self.structure, total=1000, invoice_number='INV-2026-000004')
        with self.assertRaises(IntegrityError):
            Invoice.objects.create(student=self.student, fee_structure=self.structure, total=2000, invoice_number='INV-2026-000004')

    def test_a_second_non_voided_invoice_for_same_student_and_structure_is_rejected(self):
        Invoice.objects.create(student=self.student, fee_structure=self.structure, total=1000, invoice_number='INV-2026-000005')
        with self.assertRaises(IntegrityError):
            Invoice.objects.create(student=self.student, fee_structure=self.structure, total=1000, invoice_number='INV-2026-000006')

    def test_a_replacement_invoice_is_allowed_once_the_first_is_voided(self):
        from django.utils import timezone
        first = Invoice.objects.create(student=self.student, fee_structure=self.structure, total=1000, invoice_number='INV-2026-000007')
        first.status = 'voided'
        first.voided_at = timezone.now()
        first.void_reason = 'test void'
        first.save()
        replacement = Invoice.objects.create(student=self.student, fee_structure=self.structure, total=1000, invoice_number='INV-2026-000008')
        self.assertIsNotNone(replacement.pk)


class InvoiceLineItemTests(InvoiceTestData):
    def test_can_add_line_item(self):
        invoice = Invoice.objects.create(student=self.student, fee_structure=self.structure, total=15000, invoice_number='INV-2026-000009')
        line = InvoiceLineItem.objects.create(invoice=invoice, category=self.category, description='Tuition', amount=15000)
        self.assertEqual(line.invoice, invoice)
