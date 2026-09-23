from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.academics.models import AcademicYear, ExamTerm, GradeLevel
from apps.identity.models import Permission, Role, UserRole
from apps.finance.views import GradeLevelLookupAPIView, ExamTermLookupAPIView


class FinanceLookupAPITestData(TestCase):
    """Mirrors the scaffolding in test_views_fee_structures.py's
    FinanceAPITestData: same factory/call helper and permission setup, kept
    local here since these lookups don't need the grade/term fixtures that
    class builds by default."""

    def setUp(self):
        self.factory = APIRequestFactory()

        view_perm, _ = Permission.objects.get_or_create(code='finance.view', defaults={'label': 'View', 'module': 'Finance'})
        role, _ = Role.objects.get_or_create(name='Finance Viewer Lookup Test Role')
        role.permissions.set([view_perm])
        self.viewer_user = User.objects.create_user(username='finance_lookup_viewer', password='x')
        UserRole.objects.create(user=self.viewer_user, role=role)

        self.plain_user = User.objects.create_user(username='finance_lookup_no_permission', password='x')

    def call(self, view, path, user=None, **kwargs):
        request = self.factory.get(path)
        if user is not None:
            force_authenticate(request, user=user)
        return view.as_view()(request, **kwargs)


class GradeLevelLookupAPITests(FinanceLookupAPITestData):
    def test_view_only_user_gets_200_with_id_name_shape_ordered_by_numeric_order(self):
        GradeLevel.objects.create(name='Grade 8', numeric_order=8)
        GradeLevel.objects.create(name='Grade 6', numeric_order=6)
        GradeLevel.objects.create(name='Grade 7', numeric_order=7)

        response = self.call(GradeLevelLookupAPIView, '/api/finance/lookups/grades/', self.viewer_user)

        self.assertEqual(response.status_code, 200)
        # Plain list — no DEFAULT_PAGINATION_CLASS configured in this app.
        self.assertEqual(
            response.data,
            [
                {'id': GradeLevel.objects.get(name='Grade 6').id, 'name': 'Grade 6'},
                {'id': GradeLevel.objects.get(name='Grade 7').id, 'name': 'Grade 7'},
                {'id': GradeLevel.objects.get(name='Grade 8').id, 'name': 'Grade 8'},
            ],
        )

    def test_permissionless_user_gets_403(self):
        response = self.call(GradeLevelLookupAPIView, '/api/finance/lookups/grades/', self.plain_user)
        self.assertEqual(response.status_code, 403)

    def test_unauthenticated_user_is_rejected(self):
        response = self.call(GradeLevelLookupAPIView, '/api/finance/lookups/grades/', user=None)
        self.assertIn(response.status_code, (401, 403))


class ExamTermLookupAPITests(FinanceLookupAPITestData):
    def setUp(self):
        super().setUp()
        self.year_2025 = AcademicYear.objects.create(year='2025', is_active=False)
        self.year_2026 = AcademicYear.objects.create(year='2026', is_active=True)
        self.term1_2026 = ExamTerm.objects.create(
            name='Term 1', academic_year=self.year_2026, start_date='2026-01-01', end_date='2026-04-01',
        )
        self.term2_2026 = ExamTerm.objects.create(
            name='Term 2', academic_year=self.year_2026, start_date='2026-05-01', end_date='2026-08-01',
        )
        self.term1_2025 = ExamTerm.objects.create(
            name='Term 1', academic_year=self.year_2025, start_date='2025-01-01', end_date='2025-04-01',
        )

    def test_view_only_user_gets_200_with_id_name_year_shape_most_recent_first(self):
        response = self.call(ExamTermLookupAPIView, '/api/finance/lookups/terms/', self.viewer_user)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.data,
            [
                {'id': self.term2_2026.id, 'name': 'Term 2', 'academic_year_id': self.year_2026.id},
                {'id': self.term1_2026.id, 'name': 'Term 1', 'academic_year_id': self.year_2026.id},
                {'id': self.term1_2025.id, 'name': 'Term 1', 'academic_year_id': self.year_2025.id},
            ],
        )

    def test_academic_year_filter_narrows_results(self):
        response = self.call(
            ExamTermLookupAPIView, f'/api/finance/lookups/terms/?academic_year_id={self.year_2025.id}', self.viewer_user,
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, [
            {'id': self.term1_2025.id, 'name': 'Term 1', 'academic_year_id': self.year_2025.id},
        ])

    def test_permissionless_user_gets_403(self):
        response = self.call(ExamTermLookupAPIView, '/api/finance/lookups/terms/', self.plain_user)
        self.assertEqual(response.status_code, 403)

    def test_unauthenticated_user_is_rejected(self):
        response = self.call(ExamTermLookupAPIView, '/api/finance/lookups/terms/', user=None)
        self.assertIn(response.status_code, (401, 403))

    def test_non_integer_academic_year_id_returns_400_not_500(self):
        response = self.call(
            ExamTermLookupAPIView, '/api/finance/lookups/terms/?academic_year_id=abc', self.viewer_user,
        )
        self.assertEqual(response.status_code, 400)

    def test_empty_academic_year_id_returns_400_not_500(self):
        response = self.call(
            ExamTermLookupAPIView, '/api/finance/lookups/terms/?academic_year_id=', self.viewer_user,
        )
        self.assertEqual(response.status_code, 400)
