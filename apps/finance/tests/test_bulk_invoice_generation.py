from unittest import mock

from django.contrib.auth.models import User
from django.contrib.contenttypes.models import ContentType
from django.test import TestCase, RequestFactory

from apps.academics.models import AcademicYear, ExamTerm, GradeLevel, ClassStream, Curriculum, Tier
from apps.identity.models import StudentExtra, Permission
from apps.finance.models_fees import FeeCategory, FeeStructure, FeeStructureItem, Invoice
from apps.finance.services_fees import generate_invoices_for_structure
from apps.finance.views import ActivateFeeStructureAPIView


def setUpModule():
    """Same rationale as test_invoicing.py's setUpModule: generate_invoice_for_student()
    (called per-student by generate_invoices_for_structure) posts a ledger charge
    referencing the Invoice it just created (a GenericForeignKey). `finance` has no real
    migrations, so post_migrate never pre-creates the ContentType row for Invoice — left
    to happen lazily inside a test's savepoint, it gets rolled back at teardown while
    ContentType's process-wide get_for_model() cache keeps the dangling id, breaking
    every later test. Pre-warm it here, before any test's transaction opens."""
    ContentType.objects.get_for_model(Invoice)


class BulkInvoiceGenerationTestData(TestCase):
    def setUp(self):
        curriculum = Curriculum.objects.create(name='CBC')
        tier = Tier.objects.create(name='Junior School', curriculum=curriculum)
        self.grade = GradeLevel.objects.create(name='Grade 7', numeric_order=7, curriculum_type='CBC', curriculum=curriculum, tier=tier)
        self.stream = ClassStream.objects.create(name='7 Blue', grade=self.grade)
        year = AcademicYear.objects.create(year='2026', is_active=True)
        term = ExamTerm.objects.create(name='Term 2', academic_year=year, start_date='2026-05-01', end_date='2026-08-01')
        self.structure = FeeStructure.objects.create(grade_level=self.grade, term=term, name='Grade 7 - Term 2 2026')
        FeeStructureItem.objects.create(fee_structure=self.structure, category=FeeCategory.objects.create(name='Tuition'), amount=15000)
        # is_superuser=True (not just is_staff) is required here: ActivateFeeStructureAPIView
        # gates on HasModulePermission/'finance.edit' like PromoteStudentsAPIView does, and
        # only a superuser bypasses real RBAC role/permission assignment (see
        # apps/identity/services.py get_user_permission_codes) — matches the convention used
        # elsewhere in this repo (e.g. ExamTestDataMixin.admin_user) for a test operator that
        # needs to pass HasModulePermission without setting up Role/Permission fixtures.
        self.operator = User.objects.create_user(username='bulk_operator', password='x', is_staff=True, is_superuser=True)

        self.students = []
        for i in range(3):
            user = User.objects.create_user(username=f'bulk_student_{i}', password='x')
            self.students.append(StudentExtra.objects.create(user=user, cl=self.stream, status=True, roll=f'BULK-{i}'))


class GenerateInvoicesForStructureTests(BulkInvoiceGenerationTestData):
    def test_generates_one_invoice_per_student_in_grade(self):
        invoices = generate_invoices_for_structure(fee_structure=self.structure, operator=self.operator)
        self.assertEqual(len(invoices), 3)
        self.assertEqual(Invoice.objects.filter(fee_structure=self.structure).count(), 3)

    def test_running_twice_does_not_duplicate_active_invoices(self):
        generate_invoices_for_structure(fee_structure=self.structure, operator=self.operator)
        second_run = generate_invoices_for_structure(fee_structure=self.structure, operator=self.operator)
        self.assertEqual(len(second_run), 0)
        self.assertEqual(Invoice.objects.filter(fee_structure=self.structure).count(), 3)

    def test_students_outside_the_grade_are_not_invoiced(self):
        other_grade = GradeLevel.objects.create(name='Grade 8', numeric_order=8, curriculum_type='CBC', curriculum=self.grade.curriculum, tier=self.grade.tier)
        other_stream = ClassStream.objects.create(name='8 Blue', grade=other_grade)
        other_user = User.objects.create_user(username='other_grade_student', password='x')
        StudentExtra.objects.create(user=other_user, cl=other_stream, status=True, roll='OTHER-GRADE-1')

        invoices = generate_invoices_for_structure(fee_structure=self.structure, operator=self.operator)
        self.assertEqual(len(invoices), 3)


class ActivateFeeStructureAPIViewTests(BulkInvoiceGenerationTestData):
    def setUp(self):
        super().setUp()
        # get_user_permission_codes' superuser bypass is "every Permission code that
        # currently exists as a row", not unconditional True (see apps/identity/services.py)
        # -- so even self.operator's is_superuser=True needs 'finance.edit' to actually exist
        # as a Permission row here. Task 14 seeds this for real; until then, tests need it too
        # -- same pattern as PromotionAdminEndpointTestMixin in school/tests/test_promotion.py.
        Permission.objects.get_or_create(code='finance.edit', defaults={'label': 'finance.edit', 'module': 'finance'})
        self.factory = RequestFactory()

    def _post(self, user):
        request = self.factory.post(f'/api/finance/fee-structures/{self.structure.id}/activate/')
        request.user = user
        # SessionAuthentication.authenticate() calls enforce_csrf() whenever request.user is
        # already set, which RequestFactory-built requests can't satisfy (no real CSRF cookie/
        # token round-trip) -- same convention as test_generate_results.py's RequestFactory
        # tests in this repo.
        request._dont_enforce_csrf_checks = True
        return ActivateFeeStructureAPIView.as_view()(request, structure_id=self.structure.id)

    @mock.patch('school.jobs.is_worker_available', return_value=True)
    def test_activation_queues_a_job_when_worker_available(self, mock_worker):
        response = self._post(self.operator)
        self.assertEqual(response.status_code, 202)
        self.assertIn('job_id', response.data)
        self.structure.refresh_from_db()
        self.assertEqual(self.structure.status, 'active')

    @mock.patch('school.jobs.is_worker_available', return_value=False)
    def test_activation_returns_503_when_no_worker_available(self, mock_worker):
        response = self._post(self.operator)
        self.assertEqual(response.status_code, 503)
        self.structure.refresh_from_db()
        self.assertEqual(self.structure.status, 'draft')
