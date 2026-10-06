"""
`promotion.manage` lets a non-admin (e.g. a Registrar on the staff dashboard) run school-wide
promotion. Before it existed, every promotion endpoint required results.edit AND then checked
"is this user an admin" inside the code, so a staff member could never promote students even when
granted results.edit. These tests pin down both halves: the permission unlocks the admin-only
actions, and results.edit alone still does not.
"""
from datetime import timedelta
from unittest import mock

from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import TestCase, RequestFactory
from django.utils import timezone

from apps.academics.models import AcademicYear, ClassStream, Curriculum, ExamTerm, GradeLevel, Tier
from apps.identity.models import Permission, Role, StudentExtra, UserRole
from apps.students.models import PromotionEvent
from school.tests.base import ExamTestDataMixin
from school.views.promotion_views import (
    FinalizeTermAPIView, PromoteStudentsAPIView, PromotionEventsAPIView, PromotionRevertAPIView,
    _promote_student,
)


class PromotionPermissionTests(ExamTestDataMixin, TestCase):
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        results_edit, _ = Permission.objects.get_or_create(
            code='results.edit', defaults={'label': 'results.edit', 'module': 'results'})
        results_view, _ = Permission.objects.get_or_create(
            code='results.view', defaults={'label': 'results.view', 'module': 'results'})
        promo, _ = Permission.objects.get_or_create(
            code='promotion.manage', defaults={'label': 'promotion.manage', 'module': 'Promotion'})

        # A staff member who can only edit results...
        editor_role = Role.objects.create(name='Promo Results Editor')
        editor_role.permissions.set([results_view, results_edit])
        cls.editor = User.objects.create_user(username='promo_editor', password='x')
        UserRole.objects.create(user=cls.editor, role=editor_role)

        # ...and a Registrar who was also granted promotion.manage.
        registrar_role = Role.objects.create(name='Promo Registrar')
        registrar_role.permissions.set([results_view, results_edit, promo])
        cls.registrar = User.objects.create_user(username='promo_registrar', password='x')
        UserRole.objects.create(user=cls.registrar, role=registrar_role)

        cls.curriculum = Curriculum.objects.create(code='PPERM', name='Promotion Permission Curriculum')
        cls.tier = Tier.objects.create(curriculum=cls.curriculum, name='Lower Primary', code='LPPPERM')
        cls.g1 = GradeLevel.objects.create(name='Grade 1PP', numeric_order=1, curriculum=cls.curriculum, tier=cls.tier)
        cls.g2 = GradeLevel.objects.create(name='Grade 2PP', numeric_order=2, curriculum=cls.curriculum, tier=cls.tier)
        cls.stream = ClassStream.objects.create(name='Central', grade=cls.g1)
        cls.py_year = AcademicYear.objects.create(year='2106')
        cls.py_term = ExamTerm.objects.create(
            name='Term 1', academic_year=cls.py_year, start_date='2106-01-01', end_date='2106-04-01',
            results_finalized=True, results_finalized_at=timezone.now(),
        )

    def setUp(self):
        cache.delete('rbac_perms:0')
        self.factory = RequestFactory()

    def _call(self, view, user, method='post', path='/x/', data=None, **kwargs):
        request = getattr(self.factory, method)(path, data=data or {}, content_type='application/json')
        request.user = user
        request._dont_enforce_csrf_checks = True
        return view.as_view()(request, **kwargs)

    def _student_and_event(self, username, performed_by_id):
        user = User.objects.create_user(username=username, password='x')
        student = StudentExtra.objects.create(user=user, roll=username[:5].upper(), cl=self.stream, status=True)
        _promote_student(student, self.py_year, performed_by_id=performed_by_id)
        return student, PromotionEvent.objects.get(student=student)

    # --- un-finalizing a term ---------------------------------------------------------
    def test_results_edit_alone_cannot_unfinalize(self):
        resp = self._call(FinalizeTermAPIView, self.editor, data={'finalized': False}, term_id=self.py_term.id)
        self.assertEqual(resp.status_code, 403)

    def test_promotion_manage_can_unfinalize_within_window(self):
        resp = self._call(FinalizeTermAPIView, self.registrar, data={'finalized': False}, term_id=self.py_term.id)
        self.assertEqual(resp.status_code, 200, resp.data)
        self.py_term.refresh_from_db()
        self.assertFalse(self.py_term.results_finalized)

    def test_promotion_manage_cannot_unfinalize_past_the_window(self):
        ExamTerm.objects.filter(pk=self.py_term.pk).update(results_finalized_at=timezone.now() - timedelta(hours=13))
        resp = self._call(FinalizeTermAPIView, self.registrar, data={'finalized': False}, term_id=self.py_term.id)
        self.assertEqual(resp.status_code, 403)

    # --- whole-grade / whole-school promotion -----------------------------------------
    def test_results_edit_alone_cannot_run_a_whole_grade_promotion(self):
        resp = self._call(PromoteStudentsAPIView, self.editor,
                          data={'academic_year_id': self.py_year.id, 'grade_id': self.g1.id})
        self.assertEqual(resp.status_code, 403)

    def test_promotion_manage_can_run_a_whole_grade_promotion(self):
        user = User.objects.create_user(username='pp_bulk_student', password='x')
        StudentExtra.objects.create(user=user, roll='PPBLK', cl=self.stream, status=True)
        job = mock.Mock(id='11111111-1111-1111-1111-111111111111')
        with mock.patch('school.views.promotion_views.dispatch_background_job', return_value=(job, None)):
            resp = self._call(PromoteStudentsAPIView, self.registrar,
                              data={'academic_year_id': self.py_year.id, 'grade_id': self.g1.id})
        self.assertEqual(resp.status_code, 202, resp.data)

    def test_a_user_with_neither_permission_is_rejected_at_the_permission_gate(self):
        nobody = User.objects.create_user(username='pp_nobody', password='x')
        resp = self._call(PromoteStudentsAPIView, nobody,
                          data={'academic_year_id': self.py_year.id, 'grade_id': self.g1.id})
        self.assertEqual(resp.status_code, 403)

    # --- reverting -------------------------------------------------------------------
    def test_results_edit_alone_cannot_revert(self):
        _, event = self._student_and_event('pp_rev_a', self.admin_user.id)
        resp = self._call(PromotionRevertAPIView, self.editor, event_id=event.id)
        self.assertEqual(resp.status_code, 403)

    def test_promotion_manage_can_revert_within_the_window(self):
        _, event = self._student_and_event('pp_rev_b', self.admin_user.id)
        resp = self._call(PromotionRevertAPIView, self.registrar, event_id=event.id)
        self.assertEqual(resp.status_code, 200, resp.data)
        event.refresh_from_db()
        self.assertIsNotNone(event.reverted_at)

    def test_promotion_manage_cannot_revert_past_the_window(self):
        _, event = self._student_and_event('pp_rev_c', self.admin_user.id)
        event.performed_at = timezone.now() - timedelta(hours=13)
        event.save(update_fields=['performed_at'])
        resp = self._call(PromotionRevertAPIView, self.registrar, event_id=event.id)
        self.assertEqual(resp.status_code, 403)

    def test_events_list_offers_revert_to_promotion_manage_but_not_to_results_edit_alone(self):
        student, _ = self._student_and_event('pp_rev_d', self.admin_user.id)
        path = f'/api/promotion/events/?student_id={student.id}'

        as_registrar = self._call(PromotionEventsAPIView, self.registrar, method='get', path=path)
        as_editor = self._call(PromotionEventsAPIView, self.editor, method='get', path=path)

        self.assertEqual(as_registrar.status_code, 200)
        self.assertTrue(all(row['can_revert'] for row in as_registrar.data['events']))
        self.assertTrue(as_registrar.data['events'])
        self.assertFalse(any(row['can_revert'] for row in as_editor.data['events']))
