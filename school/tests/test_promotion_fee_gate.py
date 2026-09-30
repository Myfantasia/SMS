"""Covers Task 20 (spec section 4.9 amendment): _promote_student calls
apps.finance.services.is_gate_blocked(gate='promotion') -- not is_fees_clear
directly -- so a promotion is only held when the school has turned
FeeClearancePolicy.block_promotion on. The policy defaults OFF (Task 28), so
every test here that expects a 'held' outcome from fees turns it on first via
_enable_policy(), same idiom as school/tests/test_report_card_fee_gate.py's
Task 19 tests. Also covers the bulk promote_students_task Celery path, which
calls the exact same _promote_student function per student (see
orchestration/tasks.py) and must therefore inherit the gate automatically.
"""
import json
from unittest import mock

from django.contrib.auth.models import User
from django.contrib.contenttypes.models import ContentType
from django.test import TestCase, RequestFactory, override_settings

from apps.academics.models import AcademicYear, ClassStream, Curriculum, ExamTerm, GradeLevel, Tier
from apps.core.models import BackgroundJob
from apps.identity.models import StudentExtra, Permission, Role, UserRole
from apps.finance.models_fees import FeeCategory, FeeClearancePolicy
from apps.finance.services_fees import post_ledger_entry, grant_clearance_override
from school.views.promotion_views import _promote_student, PromoteStudentsAPIView


def setUpModule():
    """Ledger entries used to simulate a student balance reference a FeeCategory
    through a GenericForeignKey -- `finance` has no real migrations, so the
    ContentType row is not pre-created by post_migrate. Pre-warm it here,
    before any test's transaction opens, same convention as
    apps/finance/tests/test_fee_clearance.py and
    school/tests/test_report_card_fee_gate.py."""
    ContentType.objects.get_for_model(FeeCategory)


class PromotionFeeGateTests(TestCase):
    def setUp(self):
        self.curriculum = Curriculum.objects.create(code='CBC7FG', name='CBC (fee gate test)')
        self.year = AcademicYear.objects.create(year='2093')
        tier = Tier.objects.create(curriculum=self.curriculum, name='Lower Primary', code='LP7FG')
        self.g1 = GradeLevel.objects.create(name='Grade 1FG', numeric_order=1, curriculum=self.curriculum, tier=tier)
        self.g2 = GradeLevel.objects.create(name='Grade 2FG', numeric_order=2, curriculum=self.curriculum, tier=tier)
        self.stream = ClassStream.objects.create(name='Central', grade=self.g1)
        user = User.objects.create_user(username='fee_gate_promo_student', password='x')
        self.student = StudentExtra.objects.create(user=user, roll='FG01', cl=self.stream, status=True)
        ExamTerm.objects.create(name='Term 1', academic_year=self.year, start_date='2093-01-01', end_date='2093-04-01', results_finalized=True)
        self.category = FeeCategory.objects.create(name='Tuition')

    def _enable_policy(self, grace_threshold=0):
        policy = FeeClearancePolicy.get_solo()
        policy.block_promotion = True
        policy.grace_threshold = grace_threshold
        policy.save()

    def _make_override_granter(self):
        """A user holding finance.override_clearance, the permission
        grant_clearance_override requires of its `granted_by` argument -- same
        pattern as school/tests/test_report_card_fee_gate.py's
        _make_override_granter."""
        Permission.objects.get_or_create(
            code='finance.override_clearance',
            defaults={'label': 'finance.override_clearance', 'module': 'Finance'},
        )
        granter = User.objects.create_user(username='promo_gate_granter', password='x')
        role = Role.objects.create(name='Promo gate granter role')
        role.permissions.set(Permission.objects.filter(code='finance.override_clearance'))
        UserRole.objects.create(user=granter, role=role)
        return granter

    def test_policy_off_by_default_student_with_balance_still_promoted(self):
        # FeeClearancePolicy.block_promotion defaults False (Task 28) -- the gate
        # must be a complete no-op until a school opts in, even with a large balance.
        post_ledger_entry(student=self.student, entry_type='charge', amount=15000, reference=self.category, description='Term fee')
        result = _promote_student(self.student, self.year)
        self.assertEqual(result['outcome'], 'promoted')
        self.student.refresh_from_db()
        self.assertEqual(self.student.cl.grade_id, self.g2.id)

    def test_promotion_held_when_fees_outstanding_and_policy_on(self):
        self._enable_policy()
        post_ledger_entry(student=self.student, entry_type='charge', amount=15000, reference=self.category, description='Term fee')
        result = _promote_student(self.student, self.year)
        self.assertEqual(result['outcome'], 'held')
        self.assertIn('fee', result['detail'].lower())
        self.student.refresh_from_db()
        self.assertEqual(self.student.cl_id, self.stream.id)

    def test_promotion_succeeds_once_fees_are_cleared(self):
        self._enable_policy()
        post_ledger_entry(student=self.student, entry_type='charge', amount=15000, reference=self.category, description='Term fee')
        post_ledger_entry(student=self.student, entry_type='payment', amount=-15000, reference=self.category, description='Payment')
        result = _promote_student(self.student, self.year)
        self.assertEqual(result['outcome'], 'promoted')
        self.student.refresh_from_db()
        self.assertEqual(self.student.cl.grade_id, self.g2.id)

    def test_promotion_succeeds_when_student_has_no_finance_history_at_all(self):
        self._enable_policy()
        result = _promote_student(self.student, self.year)
        self.assertEqual(result['outcome'], 'promoted')

    def test_granted_override_lets_promotion_through_despite_balance(self):
        self._enable_policy()
        post_ledger_entry(student=self.student, entry_type='charge', amount=15000, reference=self.category, description='Term fee')
        granter = self._make_override_granter()
        grant_clearance_override(
            student=self.student, gate='promotion', granted_by=granter,
            reason='hardship', academic_year=self.year,
        )
        result = _promote_student(self.student, self.year)
        self.assertEqual(result['outcome'], 'promoted')
        self.student.refresh_from_db()
        self.assertEqual(self.student.cl.grade_id, self.g2.id)

    def test_balance_at_grace_threshold_is_not_blocked(self):
        self._enable_policy(grace_threshold=500)
        post_ledger_entry(student=self.student, entry_type='charge', amount=500, reference=self.category, description='Term fee')
        result = _promote_student(self.student, self.year)
        self.assertEqual(result['outcome'], 'promoted')

    def test_a_db_error_from_is_gate_blocked_holds_the_promotion_not_lets_it_through(self):
        # A DB-level failure evaluating the gate must never silently mean "not
        # blocked" -- it must degrade to the same conservative held outcome as a
        # real block, not raise and not promote the student.
        self._enable_policy()
        with mock.patch('school.views.promotion_views.is_gate_blocked', side_effect=Exception('db exploded')):
            result = _promote_student(self.student, self.year)
        self.assertEqual(result['outcome'], 'held')
        self.assertIn('fee', result['detail'].lower())
        self.student.refresh_from_db()
        self.assertEqual(self.student.cl_id, self.stream.id)


class PromotionFeeGateBulkPathTests(TestCase):
    """Proves the bulk promote_students_task Celery path inherits the gate too --
    not just the single-student _promote_student call. orchestration/tasks.py's
    promote_students_task calls `_promote_student(s, academic_year,
    performed_by_id=operator_id)` per student inside its own loop -- the exact
    same function under test above, with no duplicated/divergent logic -- so
    this exercises that call through the real PromoteStudentsAPIView ->
    dispatch_background_job -> promote_students_task.delay() path, which runs
    synchronously in-process because CELERY_TASK_ALWAYS_EAGER is on for tests
    (schoolmanagement/settings.py: `'test' in sys.argv`), same idiom as
    school/tests/test_promotion.py's PromoteStudentsAPIViewTests."""

    def setUp(self):
        self.curriculum = Curriculum.objects.create(code='CBC7FGB', name='CBC (fee gate bulk test)')
        self.year = AcademicYear.objects.create(year='2094')
        tier = Tier.objects.create(curriculum=self.curriculum, name='Lower Primary', code='LP7FGB')
        self.g1 = GradeLevel.objects.create(name='Grade 1FGB', numeric_order=1, curriculum=self.curriculum, tier=tier)
        self.g2 = GradeLevel.objects.create(name='Grade 2FGB', numeric_order=2, curriculum=self.curriculum, tier=tier)
        self.stream = ClassStream.objects.create(name='Central', grade=self.g1)
        user = User.objects.create_user(username='fee_gate_bulk_student', password='x')
        self.student = StudentExtra.objects.create(user=user, roll='FGB01', cl=self.stream, status=True)
        ExamTerm.objects.create(name='Term 1', academic_year=self.year, start_date='2094-01-01', end_date='2094-04-01', results_finalized=True)
        self.category = FeeCategory.objects.create(name='Tuition Bulk')

        # HasModulePermission grants a superuser every Permission CODE THAT EXISTS in the
        # table -- it doesn't bypass the RBAC gate the way is_superuser does elsewhere, so
        # the rows still need to exist even for this admin-only test (see
        # school/tests/base.py's ExamTestDataMixin for the same convention).
        Permission.objects.get_or_create(code='results.edit', defaults={'label': 'results.edit', 'module': 'results'})
        Permission.objects.get_or_create(code='results.view', defaults={'label': 'results.view', 'module': 'results'})
        role = Role.objects.create(name='Bulk promo fee gate role')
        role.permissions.set(Permission.objects.filter(code__in=('results.edit', 'results.view')))
        self.admin_user = User.objects.create_user(
            username='fee_gate_bulk_admin', password='x', is_superuser=True, is_staff=True,
        )
        UserRole.objects.create(user=self.admin_user, role=role)

        self.factory = RequestFactory()

    def _post_bulk_promote(self):
        request = self.factory.post(
            '/api/promotion/promote-students/',
            data=json.dumps({'academic_year_id': self.year.id, 'grade_id': self.g1.id}),
            content_type='application/json',
        )
        request.user = self.admin_user
        request._dont_enforce_csrf_checks = True
        return PromoteStudentsAPIView.as_view()(request)

    @override_settings(CELERY_TASK_ALWAYS_EAGER=True)
    def test_bulk_promotion_inherits_the_fee_gate_when_policy_on(self):
        policy = FeeClearancePolicy.get_solo()
        policy.block_promotion = True
        policy.grace_threshold = 0
        policy.save()
        post_ledger_entry(
            student=self.student, entry_type='charge', amount=15000,
            reference=self.category, description='Term fee',
        )

        response = self._post_bulk_promote()
        self.assertEqual(response.status_code, 202)
        job = BackgroundJob.objects.get(id=response.data['job_id'])
        self.assertEqual(job.status, 'SUCCESS')
        self.assertEqual(job.result['outcomes'][0]['outcome'], 'held')
        self.student.refresh_from_db()
        self.assertEqual(self.student.cl_id, self.stream.id)

    @override_settings(CELERY_TASK_ALWAYS_EAGER=True)
    def test_bulk_promotion_still_promotes_when_policy_off(self):
        post_ledger_entry(
            student=self.student, entry_type='charge', amount=15000,
            reference=self.category, description='Term fee',
        )

        response = self._post_bulk_promote()
        self.assertEqual(response.status_code, 202)
        job = BackgroundJob.objects.get(id=response.data['job_id'])
        self.assertEqual(job.status, 'SUCCESS')
        self.assertEqual(job.result['outcomes'][0]['outcome'], 'promoted')
        self.student.refresh_from_db()
        self.assertEqual(self.student.cl.grade_id, self.g2.id)
