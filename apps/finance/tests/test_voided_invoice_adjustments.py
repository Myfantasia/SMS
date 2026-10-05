"""Voiding an invoice must not leave its billing or its waivers behind (user decision).

An approved waiver tied to a voided invoice is reversed on the ledger; a pending one is
rejected so it can never be approved later. decide_adjustment refuses to approve a row
whose invoice is void, create_adjustment refuses a foreign or voided invoice, and
apply_discount_rule attaches each waiver to the student's term invoice.

These tests use StudentFeeAdjustment.invoice, the field the user adds with
`makemigrations finance` + `migrate`, so they fail until then."""
from django.contrib.auth.models import User
from django.contrib.contenttypes.models import ContentType
from django.core.exceptions import ValidationError
from django.test import TestCase
from django.utils import timezone

from apps.academics.models import AcademicYear, ClassStream, Curriculum, ExamTerm, GradeLevel, Tier
from apps.finance.models_fees import (
    DiscountRule, DiscountType, FeeCategory, FeeStructure, FeeStructureItem, Invoice, StudentFeeAdjustment,
    StudentFeeLedgerEntry,
)
from apps.finance.services_fees import (
    apply_discount_rule, create_adjustment, decide_adjustment, generate_invoice_for_student, void_invoice,
)
from apps.finance.services_reports import fee_kpi_tiles
from apps.identity.models import Permission, Role, StudentExtra, UserRole
from apps.core.models import SystemAuditLog


def setUpModule():
    ContentType.objects.get_for_model(Invoice)
    ContentType.objects.get_for_model(StudentFeeAdjustment)


def latest_balance(student):
    return StudentFeeLedgerEntry.objects.filter(student=student).order_by('-id').first().running_balance


class VoidedInvoiceTestData(TestCase):
    def setUp(self):
        curriculum = Curriculum.objects.create(name='CBC')
        tier = Tier.objects.create(name='Junior School', curriculum=curriculum)
        self.grade = GradeLevel.objects.create(
            name='Grade 7', numeric_order=7, curriculum_type='CBC', curriculum=curriculum, tier=tier,
        )
        self.stream = ClassStream.objects.create(name='7 Blue', grade=self.grade)
        self.year = AcademicYear.objects.create(year='2026', is_active=True)
        self.term = ExamTerm.objects.create(
            name='Term 2', academic_year=self.year, start_date='2026-05-01', end_date='2026-08-01',
        )
        self.tuition = FeeCategory.objects.create(name='Tuition')
        self.structure = FeeStructure.objects.create(grade_level=self.grade, term=self.term, name='Grade 7 - Term 2 2026')
        FeeStructureItem.objects.create(fee_structure=self.structure, category=self.tuition, amount=15000)

        self.requester = self.make_user('void_adj_requester', ['finance.edit'])
        self.approver = self.make_user('void_adj_approver', ['finance.approve_adjustment'])
        self.operator = self.make_user('void_adj_operator', ['finance.edit'])

        user = User.objects.create_user(username='void_adj_student', password='x')
        self.student = StudentExtra.objects.create(user=user, cl=self.stream, status=True, roll='VADJ-1')
        self.invoice = generate_invoice_for_student(
            student=self.student, fee_structure=self.structure, operator=self.operator,
        )
        self.waiver_type = DiscountType.objects.create(name='Waiver', kind='fixed', value=0)

    def make_user(self, username, codes):
        for code in codes:
            Permission.objects.get_or_create(code=code, defaults={'label': code, 'module': 'Finance'})
        user = User.objects.create_user(username=username, password='x')
        role = Role.objects.create(name=f'Role for {username}')
        role.permissions.set(Permission.objects.filter(code__in=codes))
        UserRole.objects.create(user=user, role=role)
        return user

    def waiver(self, amount=-2000, invoice=None):
        return create_adjustment(
            student=self.student, adjustment_type='discount', amount=amount, reason='Sibling waiver',
            requested_by=self.requester, invoice=invoice if invoice is not None else self.invoice,
        )


class VoidReversesWaiversTests(VoidedInvoiceTestData):
    def test_void_reverses_approved_waiver_and_leaves_nothing_billed_or_outstanding(self):
        waiver = self.waiver()
        decide_adjustment(adjustment=waiver, decided_by=self.approver, approve=True)
        self.assertEqual(latest_balance(self.student), 13000)  # 15000 charge - 2000 waiver

        void_invoice(invoice=self.invoice, voided_by=self.operator, reason='Duplicate')

        self.assertEqual(latest_balance(self.student), 0)
        reversal = StudentFeeLedgerEntry.objects.filter(
            student=self.student, entry_type='adjustment', amount=2000,
        )
        self.assertEqual(reversal.count(), 1)
        self.assertTrue(reversal.first().description.startswith('Reversal of waiver on voided invoice'))
        self.assertTrue(SystemAuditLog.objects.filter(
            module='finance', action_type='CREATE', description__contains='Reversed').exists())
        tiles = fee_kpi_tiles()
        self.assertEqual(tiles['outstanding_ar'], 0)
        self.assertEqual(tiles['total_credit'], 0)
        self.assertEqual(tiles['unpaid_invoice_count'], 0)

    def test_void_rejects_pending_waiver_and_it_cannot_be_approved_later(self):
        waiver = self.waiver()
        self.assertEqual(waiver.status, 'pending')

        void_invoice(invoice=self.invoice, voided_by=self.operator, reason='Duplicate')

        waiver.refresh_from_db()
        self.assertEqual(waiver.status, 'rejected')
        self.assertEqual(waiver.decided_by, self.operator)
        self.assertIsNotNone(waiver.decided_at)
        self.assertEqual(waiver.decision_note, 'Invoice voided')
        self.assertFalse(StudentFeeLedgerEntry.objects.filter(
            student=self.student, entry_type='adjustment').exists())
        self.assertTrue(SystemAuditLog.objects.filter(
            module='finance', action_type='REJECT', description__contains='was voided').exists())
        with self.assertRaises(ValidationError):
            decide_adjustment(adjustment=waiver, decided_by=self.approver, approve=True)

    def test_void_leaves_already_rejected_waiver_untouched(self):
        waiver = self.waiver()
        decide_adjustment(adjustment=waiver, decided_by=self.approver, approve=False, note='Not eligible')

        void_invoice(invoice=self.invoice, voided_by=self.operator, reason='Duplicate')

        waiver.refresh_from_db()
        self.assertEqual(waiver.status, 'rejected')
        self.assertEqual(waiver.decision_note, 'Not eligible')
        self.assertEqual(waiver.decided_by, self.approver)


class DecideAdjustmentOnVoidedInvoiceTests(VoidedInvoiceTestData):
    def test_approving_pending_waiver_whose_invoice_was_voided_under_a_race_is_refused(self):
        waiver = self.waiver()
        # Simulate the race the guard is for: the invoice is voided without the waiver being swept.
        Invoice.objects.filter(pk=self.invoice.pk).update(status='voided', voided_at=timezone.now())

        with self.assertRaises(ValidationError):
            decide_adjustment(adjustment=waiver, decided_by=self.approver, approve=True)
        waiver.refresh_from_db()
        self.assertEqual(waiver.status, 'pending')
        self.assertFalse(StudentFeeLedgerEntry.objects.filter(
            student=self.student, entry_type='adjustment').exists())


class CreateAdjustmentInvoiceValidationTests(VoidedInvoiceTestData):
    def test_invoice_of_another_student_is_refused(self):
        other = StudentExtra.objects.create(
            user=User.objects.create_user(username='void_adj_other', password='x'), cl=self.stream, status=True, roll='VADJ-2',
        )
        other_invoice = generate_invoice_for_student(student=other, fee_structure=self.structure, operator=self.operator)
        with self.assertRaises(ValidationError):
            self.waiver(invoice=other_invoice)
        self.assertFalse(StudentFeeAdjustment.objects.filter(student=self.student).exists())

    def test_voided_invoice_is_refused(self):
        void_invoice(invoice=self.invoice, voided_by=self.operator, reason='Duplicate')
        with self.assertRaises(ValidationError):
            self.waiver()

    def test_adjustment_without_invoice_still_works(self):
        adjustment = create_adjustment(
            student=self.student, adjustment_type='penalty', amount=500, reason='Late fee',
            requested_by=self.requester,
        )
        self.assertIsNone(adjustment.invoice)
        self.assertEqual(adjustment.status, 'approved')


class ApplyDiscountRuleInvoiceTests(VoidedInvoiceTestData):
    def make_rule(self, term=None, grade=None):
        return DiscountRule.objects.create(
            discount_type=self.waiver_type, academic_year=self.year, term=term or self.term,
            grade_level=grade or self.grade, active=True, created_by=self.operator,
        )

    def test_waiver_attaches_to_the_students_invoice_for_the_term(self):
        rule = self.make_rule()
        result = apply_discount_rule(rule=rule, operator=self.operator, amount=500)
        self.assertEqual(result['created_count'], 1)
        waiver = StudentFeeAdjustment.objects.get(discount_rule=rule, student=self.student)
        self.assertEqual(waiver.invoice_id, self.invoice.pk)

    def test_waiver_attaches_to_the_most_recent_invoice_when_there_are_two(self):
        other_grade = GradeLevel.objects.create(
            name='Grade 8', numeric_order=8, curriculum_type='CBC', curriculum=self.grade.curriculum, tier=self.grade.tier,
        )
        second_structure = FeeStructure.objects.create(grade_level=other_grade, term=self.term, name='Grade 8 - Term 2 2026')
        FeeStructureItem.objects.create(fee_structure=second_structure, category=self.tuition, amount=9000)
        newer = generate_invoice_for_student(student=self.student, fee_structure=second_structure, operator=self.operator)

        rule = self.make_rule()
        apply_discount_rule(rule=rule, operator=self.operator, amount=500)

        waiver = StudentFeeAdjustment.objects.get(discount_rule=rule, student=self.student)
        self.assertEqual(waiver.invoice_id, newer.pk)

    def test_student_without_an_invoice_for_the_term_is_skipped(self):
        other_term = ExamTerm.objects.create(
            name='Term 3', academic_year=self.year, start_date='2026-08-15', end_date='2026-11-30',
        )
        rule = self.make_rule(term=other_term)
        result = apply_discount_rule(rule=rule, operator=self.operator, amount=500)
        self.assertEqual(result['created_count'], 0)
        self.assertIn({'student_id': self.student.id, 'reason': 'no_invoice_for_term'}, result['skipped'])
        self.assertFalse(StudentFeeAdjustment.objects.filter(discount_rule=rule).exists())
