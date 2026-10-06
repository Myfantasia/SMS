"""Spec section 4.12 (second bullet): term-start discount rules. Preview is read-only;
apply creates one pending StudentFeeAdjustment per targeted student through
create_adjustment(), resolves percentages at apply time, and is idempotent.

These tests need the finance migrations the user runs by hand after Task 35/36
(`makemigrations finance` + `migrate`), so they fail until then."""
from django.contrib.auth.models import User
from django.contrib.contenttypes.models import ContentType
from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.academics.models import AcademicYear, ClassStream, Curriculum, ExamTerm, GradeLevel, Tier
from apps.finance.models_fees import (
    DiscountRule, DiscountType, FeeCategory, FeeStructure, FeeStructureItem, Invoice, StudentFeeAdjustment,
    StudentFeeLedgerEntry,
)
from apps.finance.services_fees import generate_invoices_for_structure, void_invoice
from apps.finance.views import (
    DiscountRuleApplyAPIView, DiscountRuleDetailAPIView, DiscountRuleListCreateAPIView, DiscountRulePreviewAPIView,
)
from apps.identity.models import Permission, Role, StudentExtra, UserRole


def setUpModule():
    """Pre-warm the ContentType rows the GenericForeignKeys on ledger entries use, before
    any test transaction opens (same rationale as test_bulk_invoice_generation.setUpModule)."""
    ContentType.objects.get_for_model(Invoice)
    ContentType.objects.get_for_model(StudentFeeAdjustment)


class DiscountRuleTestData(TestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        curriculum = Curriculum.objects.create(name='CBC')
        tier = Tier.objects.create(name='Junior School', curriculum=curriculum)
        self.grade = GradeLevel.objects.create(
            name='Grade 7', numeric_order=7, curriculum_type='CBC', curriculum=curriculum, tier=tier,
        )
        self.stream = ClassStream.objects.create(name='7 Blue', grade=self.grade)
        self.year = AcademicYear.objects.create(year='2026', is_active=True)
        self.other_year = AcademicYear.objects.create(year='2025', is_active=False)
        self.term = ExamTerm.objects.create(
            name='Term 2', academic_year=self.year, start_date='2026-05-01', end_date='2026-08-01',
        )
        self.other_term = ExamTerm.objects.create(
            name='Term 2', academic_year=self.other_year, start_date='2025-05-01', end_date='2025-08-01',
        )
        self.tuition = FeeCategory.objects.create(name='Tuition')
        self.transport = FeeCategory.objects.create(name='Transport')
        self.structure = FeeStructure.objects.create(grade_level=self.grade, term=self.term, name='Grade 7 - Term 2 2026')
        FeeStructureItem.objects.create(fee_structure=self.structure, category=self.tuition, amount=15000)
        # 5005 (not a round hundred) so a 10% waiver of the all-category total lands on a .5
        # and exercises ROUND_HALF_UP: 20005 * 10% = 2000.5 -> 2001.
        FeeStructureItem.objects.create(fee_structure=self.structure, category=self.transport, amount=5005)

        self.operator = self.make_user('discount_operator', ['finance.view', 'finance.edit'])
        self.viewer = self.make_user('discount_viewer', ['finance.view'])

        self.students = []
        for i in range(3):
            user = User.objects.create_user(username=f'discount_student_{i}', password='x', first_name=f'Pupil{i}', last_name='Test')
            self.students.append(StudentExtra.objects.create(user=user, cl=self.stream, status=True, roll=f'DISC-{i}'))
        generate_invoices_for_structure(fee_structure=self.structure, operator=self.operator)

        self.fixed_type = DiscountType.objects.create(name='Sibling fixed', kind='fixed', value=500)
        self.percent_type = DiscountType.objects.create(name='Sibling 10%', kind='percentage', value=10)
        self.tuition_percent_type = DiscountType.objects.create(
            name='Tuition 10%', kind='percentage', value=10, category=self.tuition,
        )
        self.waiver_type = DiscountType.objects.create(name='Waiver (no value)', kind='fixed', value=0)

    def make_user(self, username, codes):
        for code in codes:
            Permission.objects.get_or_create(code=code, defaults={'label': code, 'module': 'Finance'})
        user = User.objects.create_user(username=username, password='x')
        role = Role.objects.create(name=f'Role for {username}')
        role.permissions.set(Permission.objects.filter(code__in=codes))
        UserRole.objects.create(user=user, role=role)
        return user

    def call(self, view, method, path, user, data=None, **kwargs):
        request = getattr(self.factory, method)(path, data, format='json') if data is not None else getattr(self.factory, method)(path)
        force_authenticate(request, user=user)
        return view.as_view()(request, **kwargs)

    def create_rule(self, discount_type, **target):
        payload = {
            'discount_type': discount_type.id, 'academic_year': self.year.id, 'term': self.term.id,
        }
        payload.update(target)
        response = self.call(DiscountRuleListCreateAPIView, 'post', '/api/finance/discount-rules/', self.operator, payload)
        self.assertEqual(response.status_code, 201, response.data)
        return DiscountRule.objects.get(pk=response.data['id'])

    def apply(self, rule, user=None, data=None):
        return self.call(
            DiscountRuleApplyAPIView, 'post', f'/api/finance/discount-rules/{rule.id}/apply/',
            user or self.operator, data or {}, rule_id=rule.id,
        )

    def preview(self, data, user=None):
        return self.call(DiscountRulePreviewAPIView, 'post', '/api/finance/discount-rules/preview/', user or self.operator, data)

    def ledger_count(self):
        return StudentFeeLedgerEntry.objects.count()


class DiscountRuleValidationTests(DiscountRuleTestData):
    def test_zero_targets_is_400(self):
        response = self.call(
            DiscountRuleListCreateAPIView, 'post', '/api/finance/discount-rules/', self.operator,
            {'discount_type': self.fixed_type.id, 'academic_year': self.year.id, 'term': self.term.id},
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(DiscountRule.objects.exists())

    def test_two_targets_is_400(self):
        response = self.call(
            DiscountRuleListCreateAPIView, 'post', '/api/finance/discount-rules/', self.operator,
            {
                'discount_type': self.fixed_type.id, 'academic_year': self.year.id, 'term': self.term.id,
                'grade_level': self.grade.id, 'student_ids': [self.students[0].id],
            },
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(DiscountRule.objects.exists())

    def test_preview_with_two_targets_is_400(self):
        response = self.preview({
            'discount_type': self.fixed_type.id, 'term': self.term.id,
            'grade_level': self.grade.id, 'class_stream': self.stream.id,
        })
        self.assertEqual(response.status_code, 400)

    def test_term_from_other_academic_year_is_400(self):
        response = self.call(
            DiscountRuleListCreateAPIView, 'post', '/api/finance/discount-rules/', self.operator,
            {
                'discount_type': self.fixed_type.id, 'academic_year': self.year.id, 'term': self.other_term.id,
                'grade_level': self.grade.id,
            },
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('academic year', ' '.join(response.data['error'].split()).lower())

    def test_explicit_students_must_be_eligible(self):
        response = self.call(
            DiscountRuleListCreateAPIView, 'post', '/api/finance/discount-rules/', self.operator,
            {
                'discount_type': self.fixed_type.id, 'academic_year': self.year.id, 'term': self.term.id,
                'student_ids': [self.students[0].id, 999999],
            },
        )
        self.assertEqual(response.status_code, 400)


class DiscountRulePreviewTests(DiscountRuleTestData):
    def test_fixed_preview_lists_students_and_total(self):
        response = self.preview({
            'discount_type': self.fixed_type.id, 'term': self.term.id, 'grade_level': self.grade.id,
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['count'], 3)
        self.assertEqual(
            sorted(row['id'] for row in response.data['students']),
            sorted(s.id for s in self.students),
        )
        self.assertEqual(response.data['students'][0]['name'], 'Pupil0 Test')
        self.assertTrue(all(row['amount'] == -500 for row in response.data['students']))
        self.assertEqual(response.data['total_amount'], -1500)

    def test_percentage_preview_uses_charged_total(self):
        response = self.preview({
            'discount_type': self.percent_type.id, 'term': self.term.id, 'class_stream': self.stream.id,
        })
        self.assertEqual(response.status_code, 200)
        # 20005 charged per student, 10% = 2000.5, rounded half-up to 2001.
        self.assertTrue(all(row['amount'] == -2001 for row in response.data['students']))
        self.assertEqual(response.data['total_amount'], -6003)

    def test_preview_writes_nothing(self):
        before = StudentFeeAdjustment.objects.count()
        self.preview({'discount_type': self.fixed_type.id, 'term': self.term.id, 'grade_level': self.grade.id})
        self.assertEqual(StudentFeeAdjustment.objects.count(), before)

    def test_preview_needs_only_finance_view(self):
        response = self.preview(
            {'discount_type': self.fixed_type.id, 'term': self.term.id, 'grade_level': self.grade.id},
            user=self.viewer,
        )
        self.assertEqual(response.status_code, 200)


class DiscountRuleApplyTests(DiscountRuleTestData):
    def test_apply_creates_pending_adjustments_and_no_ledger_rows(self):
        rule = self.create_rule(self.fixed_type, grade_level=self.grade.id)
        ledger_before = self.ledger_count()

        response = self.apply(rule)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['created_count'], 3)
        self.assertEqual(response.data['skipped_count'], 0)
        adjustments = StudentFeeAdjustment.objects.filter(discount_rule=rule)
        self.assertEqual(adjustments.count(), 3)
        for adjustment in adjustments:
            self.assertEqual(adjustment.status, 'pending')
            self.assertEqual(adjustment.amount, -500)
            self.assertEqual(adjustment.discount_type_id, self.fixed_type.id)
        self.assertEqual(self.ledger_count(), ledger_before)

    def test_apply_is_idempotent(self):
        rule = self.create_rule(self.fixed_type, grade_level=self.grade.id)
        self.apply(rule)

        second = self.apply(rule)

        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.data['created_count'], 0)
        self.assertEqual(second.data['skipped_count'], 3)
        self.assertTrue(all(row['reason'] == 'already_applied' for row in second.data['skipped']))
        self.assertEqual(StudentFeeAdjustment.objects.filter(discount_rule=rule).count(), 3)

    def test_percentage_amount_is_fixed_on_the_adjustment(self):
        rule = self.create_rule(self.tuition_percent_type, class_stream=self.stream.id)
        self.apply(rule)
        # Tuition only: 15000 x 10% = 1500 exactly, not the all-category total.
        self.assertTrue(
            all(adj.amount == -1500 for adj in StudentFeeAdjustment.objects.filter(discount_rule=rule)),
        )

    def test_all_category_percentage_rounds_half_up(self):
        rule = self.create_rule(self.percent_type, grade_level=self.grade.id)
        self.apply(rule)
        self.assertEqual(
            sorted(set(StudentFeeAdjustment.objects.filter(discount_rule=rule).values_list('amount', flat=True))),
            [-2001],
        )

    def test_voided_invoices_are_ignored_and_zero_amount_is_skipped(self):
        voided_student = self.students[2]
        void_invoice(
            invoice=Invoice.objects.get(student=voided_student, fee_structure=self.structure),
            voided_by=self.operator, reason='Duplicate invoice',
        )
        rule = self.create_rule(self.percent_type, grade_level=self.grade.id)

        response = self.apply(rule)

        self.assertEqual(response.data['created_count'], 2)
        self.assertEqual(response.data['skipped_count'], 1)
        self.assertEqual(response.data['skipped'], [{'student_id': voided_student.id, 'reason': 'no_invoice_for_term'}])
        self.assertFalse(StudentFeeAdjustment.objects.filter(discount_rule=rule, student=voided_student).exists())

    def test_fixed_zero_value_type_needs_an_amount(self):
        rule = self.create_rule(self.waiver_type, grade_level=self.grade.id)
        response = self.apply(rule)
        self.assertEqual(response.status_code, 400)
        self.assertFalse(StudentFeeAdjustment.objects.filter(discount_rule=rule).exists())

    def test_fixed_zero_value_type_uses_the_supplied_amount(self):
        rule = self.create_rule(self.waiver_type, grade_level=self.grade.id)
        response = self.apply(rule, data={'amount': 750})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['created_count'], 3)
        self.assertTrue(all(adj.amount == -750 for adj in StudentFeeAdjustment.objects.filter(discount_rule=rule)))

    def test_amount_is_rejected_for_percentage_types(self):
        rule = self.create_rule(self.percent_type, grade_level=self.grade.id)
        self.assertEqual(self.apply(rule, data={'amount': 100}).status_code, 400)

    def test_deactivated_rule_cannot_apply(self):
        rule = self.create_rule(self.fixed_type, grade_level=self.grade.id)
        patch = self.call(
            DiscountRuleDetailAPIView, 'patch', f'/api/finance/discount-rules/{rule.id}/', self.operator,
            {'active': False}, rule_id=rule.id,
        )
        self.assertEqual(patch.status_code, 200)
        self.assertFalse(patch.data['active'])
        self.assertEqual(self.apply(rule).status_code, 400)

    def test_view_only_user_cannot_apply(self):
        rule = self.create_rule(self.fixed_type, grade_level=self.grade.id)
        response = self.apply(rule, user=self.viewer)
        self.assertEqual(response.status_code, 403)
        self.assertFalse(StudentFeeAdjustment.objects.filter(discount_rule=rule).exists())
