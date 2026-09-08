import json
from datetime import timedelta

from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import TestCase, RequestFactory
from django.utils import timezone

from apps.academics.models import (
    AcademicYear, ClassStream, Curriculum, ExamTerm, GradeLevel, Pathway, PresetCombination, Tier, Track,
)
from apps.core.models import SystemAuditLog
from apps.identity.models import Permission, Role, StudentExtra, UserRole
from apps.students.models import PromotionEvent, StudentPathwaySelection
from school.tests.base import ExamTestDataMixin
from school.views.promotion_views import PromotionRevertAPIView, PromotionEventsAPIView, _promote_student


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

    def test_second_revert_call_does_not_re_mutate_or_double_log(self):
        # Guards the select_for_update fix in PromotionRevertAPIView.post: the reverted_at
        # re-check now happens under a row lock immediately before the mutation, so a second
        # call that loses the race must be a true no-op -- not just a 400, but no further
        # student mutation and no second audit-log entry.
        student, event = self._promote_a_student('revert_norepeat_student', self.admin_user.id)

        first = self._post(self.admin_user, event.id)
        self.assertEqual(first.status_code, 200)
        student.refresh_from_db()
        cl_after_first = student.cl_id
        enrollment_state_after_first = student.enrollment_state
        event.refresh_from_db()
        reverted_at_after_first = event.reverted_at
        reverted_by_after_first = event.reverted_by_id
        audit_count_after_first = SystemAuditLog.objects.filter(module='PromotionRevert').count()

        second = self._post(self.admin_user, event.id)
        self.assertEqual(second.status_code, 400)

        student.refresh_from_db()
        self.assertEqual(student.cl_id, cl_after_first)
        self.assertEqual(student.enrollment_state, enrollment_state_after_first)
        event.refresh_from_db()
        self.assertEqual(event.reverted_at, reverted_at_after_first)
        self.assertEqual(event.reverted_by_id, reverted_by_after_first)
        self.assertEqual(
            SystemAuditLog.objects.filter(module='PromotionRevert').count(), audit_count_after_first,
        )

    def test_unknown_event_returns_404(self):
        response = self._post(self.admin_user, 999999)
        self.assertEqual(response.status_code, 404)

    def test_revert_deletes_created_pathway_selection_end_to_end(self):
        # Mirrors PromoteStudentSSSPathwayCarryForwardTests' setup (school/tests/test_promotion.py):
        # two grades in a 'Senior Secondary' tier (tier_requires_pathway_choice == True), a
        # Pathway/Track/PresetCombination, and a student with an Approved StudentPathwaySelection
        # for the prior year. This exercises the revert path's
        # `event.created_pathway_selection.delete()` branch end-to-end through the actual
        # PromotionRevertAPIView, which no existing test did (Task 1's tests only checked that
        # _promote_student attributes created_pathway_selection correctly, not that reverting it
        # actually deletes the row while leaving the original selection alone).
        sss_tier = Tier.objects.create(curriculum=self.curriculum, name='Senior Secondary', code='SSSREV1')
        grade10 = GradeLevel.objects.create(
            name='Grade 10REV', numeric_order=10, curriculum=self.curriculum, tier=sss_tier,
        )
        GradeLevel.objects.create(
            name='Grade 11REV', numeric_order=11, curriculum=self.curriculum, tier=sss_tier,
        )
        stream10 = ClassStream.objects.create(name='Gold', grade=grade10)

        pathway = Pathway.objects.create(curriculum=self.curriculum, name='STEM REV')
        track = Track.objects.create(pathway=pathway, name='Pure Sciences REV')
        combo = PresetCombination.objects.create(track=track, name='Sciences Combo REV', code='SCREV1')

        prior_year = AcademicYear.objects.create(year='2107')
        new_year = AcademicYear.objects.create(year='2108')
        ExamTerm.objects.create(
            name='Term 1', academic_year=new_year, start_date='2108-01-01', end_date='2108-04-01',
            results_finalized=True,
        )

        student_user = User.objects.create_user(username='revert_sss_student', password='x')
        student = StudentExtra.objects.create(user=student_user, roll='REV01', cl=stream10, status=True)
        original_selection = StudentPathwaySelection.objects.create(
            student=student, pathway=pathway, track=track, preset_combination=combo,
            academic_year=prior_year, status='Approved',
        )

        result = _promote_student(student, new_year, performed_by_id=self.admin_user.id)
        self.assertEqual(result['outcome'], 'promoted')
        student.refresh_from_db()
        self.assertNotEqual(student.cl_id, stream10.id)  # promoted off Grade 10 onto Grade 11's stream
        event = PromotionEvent.objects.get(student=student)
        new_selection = StudentPathwaySelection.objects.get(student=student, academic_year=new_year)
        self.assertEqual(event.created_pathway_selection_id, new_selection.id)

        response = self._post(self.admin_user, event.id)

        self.assertEqual(response.status_code, 200)
        student.refresh_from_db()
        self.assertEqual(student.cl_id, stream10.id)
        self.assertFalse(
            StudentPathwaySelection.objects.filter(id=new_selection.id).exists()
        )
        original_selection.refresh_from_db()
        self.assertEqual(original_selection.status, 'Approved')
        self.assertEqual(original_selection.academic_year_id, prior_year.id)

    # No separate "revert without created_pathway_selection" test is added here: every plain
    # (non-SSS) revert test above (e.g. test_admin_can_revert_within_window) promotes a student
    # whose PromotionEvent has created_pathway_selection_id == None and asserts a clean 200 with
    # the student's state restored -- already proving the `if event.created_pathway_selection_id:`
    # guard in PromotionRevertAPIView.post correctly no-ops (no delete attempted, no error) when
    # nothing was created.


class PromotionEventsAPIViewTests(ExamTestDataMixin, TestCase):
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        Permission.objects.get_or_create(code='results.view', defaults={'label': 'results.view', 'module': 'results'})
        role = Role.objects.create(name='Events Viewer')
        role.permissions.set(Permission.objects.filter(code='results.view'))
        UserRole.objects.create(user=cls.admin_user, role=role)
        UserRole.objects.create(user=cls.teacher_user, role=role)

        cls.curriculum = Curriculum.objects.create(code='PEVW1', name='Events View Test Curriculum')
        cls.tier = Tier.objects.create(curriculum=cls.curriculum, name='Lower Primary', code='LPPEVW1')
        cls.g1 = GradeLevel.objects.create(name='Grade 1PEVW', numeric_order=1, curriculum=cls.curriculum, tier=cls.tier)
        GradeLevel.objects.create(name='Grade 2PEVW', numeric_order=2, curriculum=cls.curriculum, tier=cls.tier)
        cls.stream = ClassStream.objects.create(name='Central', grade=cls.g1)
        cls.year = AcademicYear.objects.create(year='2106')
        ExamTerm.objects.create(
            name='Term 1', academic_year=cls.year, start_date='2106-01-01', end_date='2106-04-01',
            results_finalized=True,
        )

    def setUp(self):
        cache.clear()
        self.factory = RequestFactory()

    def _get(self, user, student_id):
        request = self.factory.get(f'/api/promotion/events/?student_id={student_id}')
        request.user = user
        return PromotionEventsAPIView.as_view()(request)

    def test_missing_student_id_is_rejected(self):
        request = self.factory.get('/api/promotion/events/')
        request.user = self.admin_user
        response = PromotionEventsAPIView.as_view()(request)
        self.assertEqual(response.status_code, 400)

    def test_unknown_student_returns_404(self):
        response = self._get(self.admin_user, 999999)
        self.assertEqual(response.status_code, 404)

    def test_admin_within_window_can_revert(self):
        student_user = User.objects.create_user(username='pev_view_student_a', password='x')
        student = StudentExtra.objects.create(user=student_user, roll='PVA1', cl=self.stream, status=True)
        _promote_student(student, self.year, performed_by_id=self.admin_user.id)

        response = self._get(self.admin_user, student.id)

        self.assertEqual(response.status_code, 200)
        events = response.data['events']
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]['outcome'], 'promoted')
        self.assertIsNone(events[0]['reverted_at'])
        self.assertTrue(events[0]['can_revert'])

    def test_non_admin_cannot_revert_even_within_window(self):
        student_user = User.objects.create_user(username='pev_view_student_b', password='x')
        student = StudentExtra.objects.create(user=student_user, roll='PVB1', cl=self.stream, status=True)
        _promote_student(student, self.year, performed_by_id=self.admin_user.id)

        response = self._get(self.teacher_user, student.id)

        self.assertFalse(response.data['events'][0]['can_revert'])

    def test_already_reverted_event_cannot_revert_again(self):
        student_user = User.objects.create_user(username='pev_view_student_c', password='x')
        student = StudentExtra.objects.create(user=student_user, roll='PVC1', cl=self.stream, status=True)
        _promote_student(student, self.year, performed_by_id=self.admin_user.id)
        event = PromotionEvent.objects.get(student=student)
        event.reverted_at = timezone.now()
        event.reverted_by = self.admin_user
        event.save(update_fields=['reverted_at', 'reverted_by'])

        response = self._get(self.admin_user, student.id)

        self.assertFalse(response.data['events'][0]['can_revert'])
        self.assertIsNotNone(response.data['events'][0]['reverted_at'])
