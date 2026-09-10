from django.contrib.auth.models import User
from django.contrib.contenttypes.models import ContentType
from django.test import TestCase

from apps.academics.models import AcademicYear, ExamTerm, GradeLevel, Curriculum, Tier
from apps.identity.models import StudentExtra
from apps.finance.models_fees import (
    FeeCategory, FeeStructure, FeeStructureItem, StudentFeeItemEnrollment,
    StudentFeeLedgerEntry, Invoice,
)
from apps.finance.services_fees import generate_invoice_for_student


def setUpModule():
    """generate_invoice_for_student() posts a ledger charge referencing the
    Invoice it just created (a GenericForeignKey). As in test_ledger.py,
    `finance` has no real migrations, so post_migrate never pre-creates the
    ContentType row for Invoice — left to happen lazily inside a test's
    savepoint, it gets rolled back at teardown while ContentType's
    process-wide get_for_model() cache keeps the dangling id, breaking every
    later test. Pre-warm it here, before any test's transaction opens."""
    ContentType.objects.get_for_model(Invoice)


class InvoicingTestData(TestCase):
    def setUp(self):
        curriculum = Curriculum.objects.create(name='CBC')
        tier = Tier.objects.create(name='Junior School', curriculum=curriculum)
        self.grade = GradeLevel.objects.create(name='Grade 7', numeric_order=7, curriculum_type='CBC', curriculum=curriculum, tier=tier)
        year = AcademicYear.objects.create(year='2026', is_active=True)
        term = ExamTerm.objects.create(name='Term 2', academic_year=year, start_date='2026-05-01', end_date='2026-08-01')
        self.structure = FeeStructure.objects.create(grade_level=self.grade, term=term, name='Grade 7 - Term 2 2026')
        self.tuition_category = FeeCategory.objects.create(name='Tuition')
        self.transport_category = FeeCategory.objects.create(name='Transport')
        self.tuition_item = FeeStructureItem.objects.create(
            fee_structure=self.structure, category=self.tuition_category, amount=15000, is_optional=False,
        )
        self.transport_item = FeeStructureItem.objects.create(
            fee_structure=self.structure, category=self.transport_category, amount=3000, is_optional=True,
        )
        self.operator = User.objects.create_user(username='invoicing_operator', password='x')
        student_user = User.objects.create_user(username='invoicing_student', password='x')
        self.student = StudentExtra.objects.create(user=student_user)


class GenerateInvoiceForStudentTests(InvoicingTestData):
    def test_mandatory_item_always_included(self):
        invoice = generate_invoice_for_student(student=self.student, fee_structure=self.structure, operator=self.operator)
        self.assertEqual(invoice.total, 15000)
        self.assertEqual(invoice.line_items.count(), 1)

    def test_optional_item_excluded_unless_enrolled(self):
        invoice = generate_invoice_for_student(student=self.student, fee_structure=self.structure, operator=self.operator)
        categories = set(invoice.line_items.values_list('category__name', flat=True))
        self.assertNotIn('Transport', categories)

    def test_optional_item_included_when_enrolled(self):
        StudentFeeItemEnrollment.objects.create(student=self.student, fee_structure_item=self.transport_item)
        invoice = generate_invoice_for_student(student=self.student, fee_structure=self.structure, operator=self.operator)
        self.assertEqual(invoice.total, 18000)
        categories = set(invoice.line_items.values_list('category__name', flat=True))
        self.assertIn('Transport', categories)

    def test_invoice_number_is_generated(self):
        invoice = generate_invoice_for_student(student=self.student, fee_structure=self.structure, operator=self.operator)
        self.assertTrue(invoice.invoice_number.startswith('INV-'))

    def test_generation_posts_exactly_one_charge_to_the_ledger(self):
        generate_invoice_for_student(student=self.student, fee_structure=self.structure, operator=self.operator)
        entries = StudentFeeLedgerEntry.objects.filter(student=self.student, entry_type='charge')
        self.assertEqual(entries.count(), 1)
        self.assertEqual(entries.first().amount, 15000)
