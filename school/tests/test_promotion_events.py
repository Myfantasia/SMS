import json
from datetime import timedelta

from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import TestCase, RequestFactory
from django.utils import timezone

from apps.academics.models import AcademicYear, ClassStream, Curriculum, ExamTerm, GradeLevel, Tier
from apps.identity.models import Permission, Role, StudentExtra, UserRole
from apps.students.models import PromotionEvent
from school.tests.base import ExamTestDataMixin
from school.views.promotion_views import PromotionRevertAPIView, _promote_student


class PromotionRevertAPIViewTests(ExamTestDataMixin, TestCase):
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        Permission.objects.get_or_create(code='results.edit', defaults={'label': 'results.edit', 'module': 'results'})
        role = Role.objects.create(name='Revert Manager')
        role.permissions.set(Permission.objects.filter(code='results.edit'))
        UserRole.objects.create(user=cls.admin_user, role=role)
        UserRole.objects.create(user=cls.teacher_user, role=role)

        # Create a non-superuser admin for testing the 12-hour window restriction
        cls.non_superuser_admin = User.objects.create_user(username='non_super_admin', password='x')
        cls.non_superuser_admin.groups.add(cls.admin_group)
        UserRole.objects.create(user=cls.non_superuser_admin, role=role)

        cls.curriculum = Curriculum.objects.create(code='PREV1', name='Revert Test Curriculum')
        cls.tier = Tier.objects.create(curriculum=cls.curriculum, name='Lower Primary', code='LPPREV1')
        cls.g1 = GradeLevel.objects.create(name='Grade 1PREV', numeric_order=1, curriculum=cls.curriculum, tier=cls.tier)
        cls.g2 = GradeLevel.objects.create(name='Grade 2PREV', numeric_order=2, curriculum=cls.curriculum, tier=cls.tier)
        cls.stream = ClassStream.objects.create(name='Central', grade=cls.g1)

        cls.year = AcademicYear.objects.create(year='2105')
        ExamTerm.objects.create(
            name='Term 1', academic_year=cls.year, start_date='2105-01-01', end_date='2105-04-01',
            results_finalized=True,
        )

    def setUp(self):
        cache.clear()
        self.factory = RequestFactory()

    def _promote_a_student(self, username, performed_by_id):
        user = User.objects.create_user(username=username, password='x')
        student = StudentExtra.objects.create(user=user, roll=username[:5].upper(), cl=self.stream, status=True)
        _promote_student(student, self.year, performed_by_id=performed_by_id)
        student.refresh_from_db()
        return student, PromotionEvent.objects.get(student=student)

    def _post(self, user, event_id):
        request = self.factory.post(f'/api/promotion/revert/{event_id}/')
        request.user = user
        request._dont_enforce_csrf_checks = True
        return PromotionRevertAPIView.as_view()(request, event_id=event_id)

    def test_admin_can_revert_within_window(self):
        student, event = self._promote_a_student('revert_admin_student', self.admin_user.id)
        self.assertNotEqual(student.cl_id, self.stream.id)  # promotion already moved them off stream

        response = self._post(self.admin_user, event.id)

        self.assertEqual(response.status_code, 200)
        student.refresh_from_db()
        self.assertEqual(student.cl_id, self.stream.id)
        self.assertEqual(student.enrollment_state, 'Active')
        event.refresh_from_db()
        self.assertIsNotNone(event.reverted_at)
        self.assertEqual(event.reverted_by_id, self.admin_user.id)

    def test_non_admin_cannot_revert(self):
        _, event = self._promote_a_student('revert_nonadmin_student', self.admin_user.id)
        no_role_user = User.objects.create_user(username='revert_no_role', password='x')

        response = self._post(no_role_user, event.id)

        self.assertEqual(response.status_code, 403)

    def test_admin_cannot_revert_past_the_window(self):
        _, event = self._promote_a_student('revert_expired_student', self.admin_user.id)
        event.performed_at = timezone.now() - timedelta(hours=13)
        event.save(update_fields=['performed_at'])

        response = self._post(self.non_superuser_admin, event.id)

        self.assertEqual(response.status_code, 403)

    def test_superuser_can_revert_past_the_window(self):
        _, event = self._promote_a_student('revert_superuser_student', self.admin_user.id)
        event.performed_at = timezone.now() - timedelta(hours=48)
        event.save(update_fields=['performed_at'])
        # ExamTestDataMixin's admin_user is created with is_superuser=True.

        response = self._post(self.admin_user, event.id)

        self.assertEqual(response.status_code, 200)

    def test_cannot_revert_twice(self):
        _, event = self._promote_a_student('revert_twice_student', self.admin_user.id)
        self._post(self.admin_user, event.id)

        response = self._post(self.admin_user, event.id)

        self.assertEqual(response.status_code, 400)

    def test_unknown_event_returns_404(self):
        response = self._post(self.admin_user, 999999)
        self.assertEqual(response.status_code, 404)
