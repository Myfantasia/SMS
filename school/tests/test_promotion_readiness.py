from django.test import TestCase

from apps.academics.models import Curriculum, Tier
from school.serializers.curriculum_serializers import TierSerializer


class TierSerializerExitFieldsTests(TestCase):
    def test_serializer_exposes_exit_exam_fields(self):
        curriculum = Curriculum.objects.create(code='TSER1', name='Serializer Test Curriculum')
        tier = Tier.objects.create(
            curriculum=curriculum, name='Senior Secondary', code='SSTS1',
            exit_exam_code='KCSE', exit_is_terminal=True,
        )
        data = TierSerializer(tier).data
        self.assertEqual(data['exit_exam_code'], 'KCSE')
        self.assertTrue(data['exit_is_terminal'])

    def test_serializer_accepts_exit_fields_on_write(self):
        curriculum = Curriculum.objects.create(code='TSER2', name='Serializer Test Curriculum 2')
        serializer = TierSerializer(data={
            'curriculum': curriculum.id, 'name': 'Upper Primary', 'code': 'UPTS2',
            'exit_exam_code': 'KPSEA', 'exit_is_terminal': False,
        })
        self.assertTrue(serializer.is_valid(), serializer.errors)
        tier = serializer.save()
        self.assertEqual(tier.exit_exam_code, 'KPSEA')
        self.assertFalse(tier.exit_is_terminal)


from django.contrib.auth.models import User

from apps.academics.models import AcademicYear, ClassStream, ExamTerm, GradeLevel
from apps.identity.models import StudentExtra
from apps.students.models import NationalExamRecord
from school.views.promotion_views import _readiness_for_student


class ReadinessForStudentTests(TestCase):
    def setUp(self):
        self.curriculum = Curriculum.objects.create(code='RFS1', name='Readiness Test Curriculum')
        self.year = AcademicYear.objects.create(year='2094')

    def _make_student(self, grade, username):
        stream = ClassStream.objects.create(name='Central', grade=grade)
        user = User.objects.create_user(username=username, password='x')
        return StudentExtra.objects.create(user=user, roll=username[:5].upper(), cl=stream, status=True)

    def test_no_current_class_is_not_ready(self):
        user = User.objects.create_user(username='no_class_student', password='x')
        student = StudentExtra.objects.create(user=user, roll='NC001', status=True)

        result = _readiness_for_student(student, self.year)

        self.assertFalse(result['ready'])
        self.assertIsNone(result['transition_type'])
        self.assertEqual(result['reason'], 'No current class assigned.')

    def test_plain_blocked_when_results_not_finalized(self):
        tier = Tier.objects.create(curriculum=self.curriculum, name='Lower Primary', code='LPRFS1')
        g1 = GradeLevel.objects.create(name='Grade 1RFS', numeric_order=1, curriculum=self.curriculum, tier=tier)
        GradeLevel.objects.create(name='Grade 2RFS', numeric_order=2, curriculum=self.curriculum, tier=tier)
        student = self._make_student(g1, 'plain_blocked_student')
        ExamTerm.objects.create(
            name='Term 1', academic_year=self.year, start_date='2094-01-01', end_date='2094-04-01',
            results_finalized=False,
        )

        result = _readiness_for_student(student, self.year)

        self.assertFalse(result['ready'])
        self.assertEqual(result['transition_type'], 'plain')
        self.assertEqual(result['requirement'], 'Results finalized for the academic year')
        self.assertEqual(result['reason'], 'Results not yet finalized for this academic year.')

    def test_plain_ready_when_results_finalized(self):
        tier = Tier.objects.create(curriculum=self.curriculum, name='Lower Primary', code='LPRFS2')
        g1 = GradeLevel.objects.create(name='Grade 1RFS2', numeric_order=1, curriculum=self.curriculum, tier=tier)
        g2 = GradeLevel.objects.create(name='Grade 2RFS2', numeric_order=2, curriculum=self.curriculum, tier=tier)
        student = self._make_student(g1, 'plain_ready_student')
        ExamTerm.objects.create(
            name='Term 1', academic_year=self.year, start_date='2094-01-01', end_date='2094-04-01',
            results_finalized=True,
        )

        result = _readiness_for_student(student, self.year)

        self.assertTrue(result['ready'])
        self.assertEqual(result['transition_type'], 'plain')
        self.assertIsNone(result['reason'])
        self.assertEqual(result['next_grade_name'], 'Grade 2RFS2')

    def test_exam_gated_blocked_without_record(self):
        tier = Tier.objects.create(
            curriculum=self.curriculum, name='Upper Primary', code='UPRFS1',
            exit_exam_code='KPSEA', exit_is_terminal=False,
        )
        jss_tier = Tier.objects.create(curriculum=self.curriculum, name='Junior Secondary', code='JSSRFS1')
        g6 = GradeLevel.objects.create(name='Grade 6RFS', numeric_order=6, curriculum=self.curriculum, tier=tier)
        GradeLevel.objects.create(name='Grade 7RFS', numeric_order=7, curriculum=self.curriculum, tier=jss_tier)
        student = self._make_student(g6, 'kpsea_blocked_student')

        result = _readiness_for_student(student, self.year)

        self.assertFalse(result['ready'])
        self.assertEqual(result['transition_type'], 'exam_gated')
        self.assertEqual(result['requirement'], 'KPSEA recorded')
        self.assertEqual(result['reason'], 'KPSEA not yet recorded.')

    def test_exam_gated_ready_with_record(self):
        tier = Tier.objects.create(
            curriculum=self.curriculum, name='Upper Primary', code='UPRFS2',
            exit_exam_code='KPSEA', exit_is_terminal=False,
        )
        jss_tier = Tier.objects.create(curriculum=self.curriculum, name='Junior Secondary', code='JSSRFS2')
        g6 = GradeLevel.objects.create(name='Grade 6RFS2', numeric_order=6, curriculum=self.curriculum, tier=tier)
        GradeLevel.objects.create(name='Grade 7RFS2', numeric_order=7, curriculum=self.curriculum, tier=jss_tier)
        student = self._make_student(g6, 'kpsea_ready_student')
        NationalExamRecord.objects.create(student=student, exam_code='KPSEA', academic_year=self.year)

        result = _readiness_for_student(student, self.year)

        self.assertTrue(result['ready'])
        self.assertEqual(result['transition_type'], 'exam_gated')
        self.assertIsNone(result['reason'])

    def test_exit_blocked_without_record(self):
        tier = Tier.objects.create(
            curriculum=self.curriculum, name='Senior Secondary', code='SSRFS1',
            exit_exam_code='KCSE', exit_is_terminal=True,
        )
        g12 = GradeLevel.objects.create(name='Grade 12RFS', numeric_order=12, curriculum=self.curriculum, tier=tier)
        student = self._make_student(g12, 'kcse_blocked_student')

        result = _readiness_for_student(student, self.year)

        self.assertFalse(result['ready'])
        self.assertEqual(result['transition_type'], 'exit')
        self.assertEqual(result['requirement'], 'KCSE recorded')
        self.assertEqual(result['reason'], 'KCSE not yet recorded.')

    def test_exit_ready_with_record(self):
        tier = Tier.objects.create(
            curriculum=self.curriculum, name='Senior Secondary', code='SSRFS2',
            exit_exam_code='KCSE', exit_is_terminal=True,
        )
        g12 = GradeLevel.objects.create(name='Grade 12RFS2', numeric_order=12, curriculum=self.curriculum, tier=tier)
        student = self._make_student(g12, 'kcse_ready_student')
        NationalExamRecord.objects.create(student=student, exam_code='KCSE', academic_year=self.year)

        result = _readiness_for_student(student, self.year)

        self.assertTrue(result['ready'])
        self.assertEqual(result['transition_type'], 'exit')
        self.assertIsNone(result['reason'])
        self.assertIsNone(result['next_grade_name'])


import json

from django.test import RequestFactory
from django.core.cache import cache

from apps.identity.models import Permission, Role, UserRole
from school.views.promotion_views import PromotionReadinessAPIView
from school.tests.base import ExamTestDataMixin


class PromotionReadinessAPIViewTests(ExamTestDataMixin, TestCase):
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        Permission.objects.get_or_create(code='results.view', defaults={'label': 'results.view', 'module': 'results'})
        role = Role.objects.create(name='Readiness Viewer')
        role.permissions.set(Permission.objects.filter(code='results.view'))
        UserRole.objects.create(user=cls.admin_user, role=role)

        cls.curriculum = Curriculum.objects.create(code='PRAV1', name='Readiness Endpoint Curriculum')
        cls.tier = Tier.objects.create(curriculum=cls.curriculum, name='Lower Primary', code='LPPRAV1')
        cls.g1 = GradeLevel.objects.create(name='Grade 1PRAV', numeric_order=1, curriculum=cls.curriculum, tier=cls.tier)
        GradeLevel.objects.create(name='Grade 2PRAV', numeric_order=2, curriculum=cls.curriculum, tier=cls.tier)
        cls.stream = ClassStream.objects.create(name='Central', grade=cls.g1)

        cls.ready_year = AcademicYear.objects.create(year='2095')
        ExamTerm.objects.create(
            name='Term 1', academic_year=cls.ready_year, start_date='2095-01-01', end_date='2095-04-01',
            results_finalized=True,
        )
        ready_user = User.objects.create_user(username='readiness_ready_student', password='x')
        cls.ready_student = StudentExtra.objects.create(user=ready_user, roll='RR01', cl=cls.stream, status=True)

        blocked_user = User.objects.create_user(username='readiness_blocked_student', password='x')
        cls.blocked_student = StudentExtra.objects.create(user=blocked_user, roll='RB01', cl=cls.stream, status=True)

    def setUp(self):
        cache.clear()
        self.factory = RequestFactory()

    def _get(self, query):
        request = self.factory.get(f'/api/promotion/readiness/?{query}')
        request.user = self.admin_user
        return PromotionReadinessAPIView.as_view()(request)

    def test_returns_ready_and_blocked_summary_for_grade_scope(self):
        response = self._get(f'academic_year_id={self.ready_year.id}&grade_id={self.g1.id}')
        self.assertEqual(response.status_code, 200)
        data = response.data

        self.assertEqual(data['summary']['ready'], 2)
        self.assertEqual(data['summary']['blocked'], 0)

        student_ids = {row['student_id'] for row in data['students']}
        self.assertEqual(student_ids, {self.ready_student.id, self.blocked_student.id})
        self.assertTrue(all(row['ready'] for row in data['students']))

    def test_blocked_student_shows_reason_when_results_not_finalized(self):
        other_year = AcademicYear.objects.create(year='2096')
        response = self._get(f'academic_year_id={other_year.id}&grade_id={self.g1.id}')
        data = response.data

        self.assertEqual(data['summary']['blocked'], 2)
        self.assertIn('Results not yet finalized for this academic year.', data['summary']['by_reason'])

    def test_single_student_scope(self):
        response = self._get(f'academic_year_id={self.ready_year.id}&student_id={self.ready_student.id}')
        data = response.data

        self.assertEqual(len(data['students']), 1)
        self.assertEqual(data['students'][0]['student_id'], self.ready_student.id)

    def test_missing_academic_year_id_is_rejected(self):
        request = self.factory.get('/api/promotion/readiness/')
        request.user = self.admin_user
        response = PromotionReadinessAPIView.as_view()(request)
        self.assertEqual(response.status_code, 400)
