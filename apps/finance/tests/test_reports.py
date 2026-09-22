import json
from datetime import timedelta

from django.contrib.auth.models import User
from django.contrib.contenttypes.models import ContentType
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.academics.models import AcademicYear, ExamTerm, GradeLevel, Curriculum, Tier
from apps.identity.models import Permission, Role, UserRole, StudentExtra
from apps.finance.models_fees import (
    FeeCategory, FeeStructure, FeeStructureItem, Invoice, InvoiceCreditApplication, Payment, StudentFeeAdjustment,
)
from apps.finance.services_fees import (
    create_adjustment, generate_invoice_for_student, record_payment, void_invoice, void_payment,
)
from apps.finance.services_reports import (
    fee_kpi_tiles, collections_trend, fee_category_breakdown, student_balance_aging,
)
from apps.finance.views import (
    FeeKPITilesAPIView, CollectionsTrendAPIView, FeeCategoryBreakdownAPIView, StudentBalanceAgingAPIView,
)


def setUpModule():
    """`finance` has no real migrations yet, so post_migrate never creates its
    ContentType rows; pre-warm them before any test transaction opens (see
    test_adjustments.setUpModule for the full rationale)."""
    for model in (Invoice, Payment, StudentFeeAdjustment, InvoiceCreditApplication):
        ContentType.objects.get_for_model(model)


class ReportsTestData(TestCase):
    """One student with a 15000 invoice against a CURRENT term (ends in the
    future), of which 5000 has been paid today."""

    def setUp(self):
        self.today = timezone.localdate()
        curriculum = Curriculum.objects.create(name='CBC')
        tier = Tier.objects.create(name='Junior School', curriculum=curriculum)
        self.grade = GradeLevel.objects.create(
            name='Grade 7', numeric_order=7, curriculum_type='CBC', curriculum=curriculum, tier=tier,
        )
        self.year = AcademicYear.objects.create(year='2026', is_active=True)
        self.structure = self.make_structure('Term 2', self.today - timedelta(days=30), self.today + timedelta(days=60))
        self.category = FeeCategory.objects.create(name='Tuition')
        FeeStructureItem.objects.create(fee_structure=self.structure, category=self.category, amount=15000)
        self.operator = User.objects.create_user(username='reports_operator', password='x')
        self.student = self.make_student(1)
        self.invoice = generate_invoice_for_student(student=self.student, fee_structure=self.structure, operator=self.operator)
        self.payment, _ = record_payment(
            student=self.student, amount=5000, method='cash', recorded_by=self.operator,
            invoice=self.invoice, date=self.today,
        )

    def make_structure(self, term_name, start, end, amount=None):
        term = ExamTerm.objects.create(name=term_name, academic_year=self.year, start_date=start, end_date=end)
        structure = FeeStructure.objects.create(grade_level=self.grade, term=term, name=f'Grade 7 - {term_name}')
        if amount:
            FeeStructureItem.objects.create(
                fee_structure=structure, category=FeeCategory.objects.get_or_create(name='Tuition')[0], amount=amount,
            )
        return structure

    def make_student(self, n):
        user = User.objects.create_user(username=f'reports_student_{n}', password='x')
        return StudentExtra.objects.create(user=user, roll=f'REPORTS-{n}')

    def backdate_invoice(self, invoice, days):
        """issued_at is auto_now_add, so only a queryset update can move it."""
        Invoice.objects.filter(pk=invoice.pk).update(issued_at=timezone.now() - timedelta(days=days))


class FeeKPITilesTests(ReportsTestData):
    def test_outstanding_ar_reflects_unpaid_balance(self):
        self.assertEqual(fee_kpi_tiles()['outstanding_ar'], 10000)

    def test_unpaid_invoice_count_includes_partially_paid(self):
        self.assertEqual(fee_kpi_tiles()['unpaid_invoice_count'], 1)

    def test_collections_30d_includes_recent_payment(self):
        self.assertEqual(fee_kpi_tiles()['collections_30d'], 5000)

    def test_collections_30d_excludes_old_payments(self):
        record_payment(
            student=self.student, amount=1000, method='cash', recorded_by=self.operator,
            invoice=self.invoice, date=self.today - timedelta(days=45),
        )
        self.assertEqual(fee_kpi_tiles()['collections_30d'], 5000)

    def test_voided_payment_is_excluded_from_collections(self):
        void_payment(payment=self.payment, voided_by=self.operator, reason='bounced')
        self.assertEqual(fee_kpi_tiles()['collections_30d'], 0)

    def test_voided_invoice_is_excluded_from_unpaid_count_and_receivables(self):
        void_invoice(invoice=self.invoice, voided_by=self.operator, reason='duplicate')
        kpis = fee_kpi_tiles()
        self.assertEqual(kpis['unpaid_invoice_count'], 0)
        # Voiding leaves the 5000 payment standing as a credit: nothing is owed.
        self.assertEqual(kpis['outstanding_ar'], 0)
        self.assertEqual(kpis['total_credit'], 5000)

    def test_overpaying_student_shows_in_total_credit_not_outstanding_ar(self):
        other = self.make_student(2)
        other_invoice = generate_invoice_for_student(student=other, fee_structure=self.structure, operator=self.operator)
        record_payment(student=other, amount=16000, method='cash', recorded_by=self.operator, invoice=other_invoice)
        kpis = fee_kpi_tiles()
        self.assertEqual(kpis['outstanding_ar'], 10000)  # only the first student's positive balance
        self.assertEqual(kpis['total_credit'], 1000)

    def test_void_reversals_do_not_distort_balances(self):
        """A voided-then-reissued payment leaves reversal rows in the ledger;
        balances come from the latest running_balance, not row counts."""
        void_payment(payment=self.payment, voided_by=self.operator, reason='typo')
        record_payment(student=self.student, amount=5000, method='cash', recorded_by=self.operator, invoice=self.invoice)
        kpis = fee_kpi_tiles()
        self.assertEqual(kpis['outstanding_ar'], 10000)
        self.assertEqual(kpis['collections_30d'], 5000)
        self.assertEqual(kpis['unpaid_invoice_count'], 1)


class OverdueCountTests(ReportsTestData):
    """overdue_count = non-voided invoices that are unpaid/partially paid whose
    fee structure's term has already ended."""

    def test_invoice_on_current_term_is_not_overdue(self):
        self.assertEqual(fee_kpi_tiles()['overdue_count'], 0)

    def test_unpaid_invoice_on_ended_term_is_overdue(self):
        past = self.make_structure('Term 1', self.today - timedelta(days=120), self.today - timedelta(days=10), amount=8000)
        generate_invoice_for_student(student=self.make_student(2), fee_structure=past, operator=self.operator)
        self.assertEqual(fee_kpi_tiles()['overdue_count'], 1)

    def test_partially_paid_invoice_on_ended_term_is_overdue(self):
        past = self.make_structure('Term 1', self.today - timedelta(days=120), self.today - timedelta(days=10), amount=8000)
        student = self.make_student(2)
        invoice = generate_invoice_for_student(student=student, fee_structure=past, operator=self.operator)
        record_payment(student=student, amount=1000, method='cash', recorded_by=self.operator, invoice=invoice)
        self.assertEqual(fee_kpi_tiles()['overdue_count'], 1)

    def test_paid_invoice_on_ended_term_is_not_overdue(self):
        past = self.make_structure('Term 1', self.today - timedelta(days=120), self.today - timedelta(days=10), amount=8000)
        student = self.make_student(2)
        invoice = generate_invoice_for_student(student=student, fee_structure=past, operator=self.operator)
        record_payment(student=student, amount=8000, method='cash', recorded_by=self.operator, invoice=invoice)
        self.assertEqual(fee_kpi_tiles()['overdue_count'], 0)

    def test_voided_invoice_on_ended_term_is_not_overdue(self):
        past = self.make_structure('Term 1', self.today - timedelta(days=120), self.today - timedelta(days=10), amount=8000)
        invoice = generate_invoice_for_student(student=self.make_student(2), fee_structure=past, operator=self.operator)
        void_invoice(invoice=invoice, voided_by=self.operator, reason='mistake')
        self.assertEqual(fee_kpi_tiles()['overdue_count'], 0)

    def test_term_ending_today_is_not_yet_ended(self):
        ending_today = self.make_structure('Term 1', self.today - timedelta(days=90), self.today, amount=8000)
        generate_invoice_for_student(student=self.make_student(2), fee_structure=ending_today, operator=self.operator)
        self.assertEqual(fee_kpi_tiles()['overdue_count'], 0)


class CollectionsTrendTests(ReportsTestData):
    def test_trend_includes_todays_payment(self):
        trend = collections_trend(days=30)
        self.assertEqual(len(trend), 1)
        self.assertEqual(trend[0]['total'], 5000)
        self.assertEqual(trend[0]['date'], self.today)

    def test_trend_groups_by_day_oldest_first_and_respects_window(self):
        record_payment(
            student=self.student, amount=2000, method='cash', recorded_by=self.operator,
            invoice=self.invoice, date=self.today - timedelta(days=3),
        )
        record_payment(
            student=self.student, amount=700, method='cash', recorded_by=self.operator,
            invoice=self.invoice, date=self.today - timedelta(days=40),
        )
        trend = collections_trend(days=30)
        self.assertEqual([row['total'] for row in trend], [2000, 5000])
        self.assertEqual([row['total'] for row in collections_trend(days=60)], [700, 2000, 5000])

    def test_voided_payment_is_excluded_from_trend(self):
        void_payment(payment=self.payment, voided_by=self.operator, reason='bounced')
        self.assertEqual(collections_trend(days=30), [])


class FeeCategoryBreakdownTests(ReportsTestData):
    def test_breakdown_groups_by_category(self):
        breakdown = fee_category_breakdown()
        self.assertEqual(breakdown[0]['category__name'], 'Tuition')
        self.assertEqual(breakdown[0]['total'], 15000)

    def test_voided_invoice_is_excluded_from_breakdown(self):
        void_invoice(invoice=self.invoice, voided_by=self.operator, reason='duplicate')
        self.assertEqual(fee_category_breakdown(), [])


class StudentBalanceAgingTests(ReportsTestData):
    def test_student_with_positive_balance_is_listed(self):
        aging = student_balance_aging()
        self.assertEqual(len(aging), 1)
        self.assertEqual(aging[0]['balance'], 10000)
        self.assertEqual(aging[0]['student_id'], self.student.id)
        self.assertEqual(aging[0]['student_name'], 'reports_student_1')

    def test_student_with_zero_balance_is_not_listed(self):
        record_payment(student=self.student, amount=10000, method='cash', recorded_by=self.operator, invoice=self.invoice)
        self.assertEqual(student_balance_aging(), [])

    def test_overpaid_student_is_not_listed(self):
        record_payment(student=self.student, amount=11000, method='cash', recorded_by=self.operator, invoice=self.invoice)
        self.assertEqual(student_balance_aging(), [])

    def test_days_outstanding_counts_from_invoice_issue_not_last_ledger_activity(self):
        self.backdate_invoice(self.invoice, 45)
        # A fresh payment (recent ledger activity) must not reset the age.
        record_payment(student=self.student, amount=100, method='cash', recorded_by=self.operator, invoice=self.invoice)
        row = student_balance_aging()[0]
        self.assertEqual(row['days_outstanding'], 45)
        self.assertEqual(row['bucket'], '31-60')

    def test_backdated_payment_does_not_change_age(self):
        self.backdate_invoice(self.invoice, 10)
        record_payment(
            student=self.student, amount=100, method='cash', recorded_by=self.operator,
            invoice=self.invoice, date=self.today - timedelta(days=200),
        )
        self.assertEqual(student_balance_aging()[0]['days_outstanding'], 10)

    def test_age_uses_oldest_unpaid_invoice_and_ignores_paid_and_voided(self):
        oldest = self.make_structure('Term 0', self.today - timedelta(days=300), self.today - timedelta(days=200), amount=4000)
        paid = self.make_structure('Term -1', self.today - timedelta(days=500), self.today - timedelta(days=400), amount=1000)
        voided = self.make_structure('Term -2', self.today - timedelta(days=700), self.today - timedelta(days=600), amount=1000)
        oldest_invoice = generate_invoice_for_student(student=self.student, fee_structure=oldest, operator=self.operator)
        paid_invoice = generate_invoice_for_student(student=self.student, fee_structure=paid, operator=self.operator)
        voided_invoice = generate_invoice_for_student(student=self.student, fee_structure=voided, operator=self.operator)
        record_payment(student=self.student, amount=1000, method='cash', recorded_by=self.operator, invoice=paid_invoice)
        void_invoice(invoice=voided_invoice, voided_by=self.operator, reason='mistake')
        self.backdate_invoice(oldest_invoice, 100)
        self.backdate_invoice(paid_invoice, 400)
        self.backdate_invoice(voided_invoice, 500)
        self.backdate_invoice(self.invoice, 20)
        row = student_balance_aging()[0]
        # 15000 + 4000 + 1000 + 1000 charged, 5000 + 1000 paid, 1000 reversed by the void.
        self.assertEqual(row['balance'], 14000)
        self.assertEqual(row['days_outstanding'], 100)
        self.assertEqual(row['bucket'], '90+')

    def test_positive_balance_without_open_invoice_has_no_age(self):
        student = self.make_student(2)
        approver = User.objects.create_user(username='reports_approver', password='x')
        create_adjustment(
            student=student, adjustment_type='penalty', amount=700, reason='library fine', requested_by=approver,
        )
        rows = {row['student_id']: row for row in student_balance_aging()}
        self.assertIsNone(rows[student.id]['days_outstanding'])
        self.assertEqual(rows[student.id]['bucket'], 'no-invoice')

    def test_sorted_oldest_first_with_unknown_age_last(self):
        no_invoice = self.make_student(2)
        create_adjustment(
            student=no_invoice, adjustment_type='penalty', amount=700, reason='fine',
            requested_by=User.objects.create_user(username='reports_requester', password='x'),
        )
        newer = self.make_student(3)
        newer_invoice = generate_invoice_for_student(student=newer, fee_structure=self.structure, operator=self.operator)
        self.backdate_invoice(newer_invoice, 5)
        self.backdate_invoice(self.invoice, 70)
        rows = student_balance_aging()
        self.assertEqual([r['student_id'] for r in rows], [self.student.id, newer.id, no_invoice.id])
        self.assertEqual([r['bucket'] for r in rows], ['61-90', '0-30', 'no-invoice'])

    def test_bucket_boundaries(self):
        cases = [(0, '0-30'), (30, '0-30'), (31, '31-60'), (60, '31-60'), (61, '61-90'), (90, '61-90'), (91, '90+')]
        for days, bucket in cases:
            self.backdate_invoice(self.invoice, days)
            self.assertEqual(student_balance_aging()[0]['bucket'], bucket, days)

    def test_soft_deleted_student_does_not_break_the_report(self):
        StudentExtra.objects.filter(pk=self.student.pk).update(deleted_at=timezone.now())
        rows = student_balance_aging()
        # Still owes the money: the ledger is authoritative, so they stay listed.
        self.assertEqual([r['balance'] for r in rows], [10000])
        self.assertEqual(fee_kpi_tiles()['outstanding_ar'], 10000)


class EmptyDatabaseTests(TestCase):
    def test_everything_is_zero_or_empty(self):
        self.assertEqual(fee_kpi_tiles(), {
            'outstanding_ar': 0, 'total_credit': 0, 'unpaid_invoice_count': 0,
            'overdue_count': 0, 'collections_30d': 0,
        })
        self.assertEqual(collections_trend(), [])
        self.assertEqual(fee_category_breakdown(), [])
        self.assertEqual(student_balance_aging(), [])


class ReportAPITests(ReportsTestData):
    ENDPOINTS = [FeeKPITilesAPIView, CollectionsTrendAPIView, FeeCategoryBreakdownAPIView, StudentBalanceAgingAPIView]

    def setUp(self):
        super().setUp()
        self.factory = APIRequestFactory()
        self.viewer = self.make_user('reports_viewer', ['finance.view'])
        self.plain = self.make_user('reports_plain', [])

    def make_user(self, username, codes):
        for code in codes:
            Permission.objects.get_or_create(code=code, defaults={'label': code, 'module': 'Finance'})
        user = User.objects.create_user(username=username, password='x')
        if codes:
            role = Role.objects.create(name=f'Role for {username}')
            role.permissions.set(Permission.objects.filter(code__in=codes))
            UserRole.objects.create(user=user, role=role)
        return user

    def get(self, view, user, query=''):
        request = self.factory.get(f'/x/{query}')
        if user is not None:
            force_authenticate(request, user=user)
        return view.as_view()(request)

    def test_view_only_user_can_read_all_four(self):
        for view in self.ENDPOINTS:
            self.assertEqual(self.get(view, self.viewer).status_code, 200, view.__name__)

    def test_user_without_finance_view_is_forbidden(self):
        for view in self.ENDPOINTS:
            self.assertEqual(self.get(view, self.plain).status_code, 403, view.__name__)

    def test_unauthenticated_is_rejected(self):
        for view in self.ENDPOINTS:
            self.assertIn(self.get(view, None).status_code, (401, 403), view.__name__)

    def test_kpi_payload(self):
        response = self.get(FeeKPITilesAPIView, self.viewer)
        self.assertEqual(response.data['outstanding_ar'], 10000)
        self.assertEqual(response.data['total_credit'], 0)

    def test_trend_is_a_plain_list_with_iso_dates(self):
        response = self.get(CollectionsTrendAPIView, self.viewer)
        response.render()
        self.assertEqual(json.loads(response.content), [{'date': self.today.isoformat(), 'total': 5000}])

    def test_trend_days_param_is_applied(self):
        record_payment(
            student=self.student, amount=700, method='cash', recorded_by=self.operator,
            invoice=self.invoice, date=self.today - timedelta(days=40),
        )
        self.assertEqual(len(self.get(CollectionsTrendAPIView, self.viewer).data), 1)
        self.assertEqual(len(self.get(CollectionsTrendAPIView, self.viewer, '?days=60').data), 2)

    def test_bad_days_is_a_400_never_a_500(self):
        for query in ('?days=abc', '?days=0', '?days=-5', '?days=367', '?days=1.5'):
            self.assertEqual(self.get(CollectionsTrendAPIView, self.viewer, query).status_code, 400, query)

    def test_days_bounds_are_accepted(self):
        for query in ('?days=1', '?days=366'):
            self.assertEqual(self.get(CollectionsTrendAPIView, self.viewer, query).status_code, 200, query)

    def test_category_breakdown_payload(self):
        response = self.get(FeeCategoryBreakdownAPIView, self.viewer)
        self.assertEqual(list(response.data), [{'category__name': 'Tuition', 'total': 15000}])

    def test_aging_payload(self):
        response = self.get(StudentBalanceAgingAPIView, self.viewer)
        response.render()
        rows = json.loads(response.content)
        self.assertEqual(len(rows), 1)
        self.assertEqual(
            set(rows[0]), {'student_id', 'student_name', 'balance', 'days_outstanding', 'bucket'},
        )
