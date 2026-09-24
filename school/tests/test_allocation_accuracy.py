from datetime import date
from unittest import mock

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from apps.academics.models import AcademicYear, ExamTerm, GradeLevel, ClassStream, Subject
from apps.allocations.models import AllocationPublishState, GlobalAllocationPolicy, SubjectAllocation
from apps.identity.models import Permission, TeacherExtra


class AllocationMatrixBlockerTests(TestCase):
    def setUp(self):
        self.year = AcademicYear.objects.create(year='2026', is_active=True)
        self.term = ExamTerm.objects.create(
            name='Term 1', academic_year=self.year,
            start_date=date(2026, 1, 1), end_date=date(2026, 4, 1), is_active=True,
        )
        self.grade = GradeLevel.objects.create(name='Grade 8', numeric_order=8, curriculum_type='CBC')
        self.stream = ClassStream.objects.create(name='North', grade=self.grade)

        self.maths = Subject.objects.create(code='MAT101', name='Mathematics', is_core=True)
        self.english = Subject.objects.create(code='ENG101', name='English', is_core=True)
        self.kiswahili = Subject.objects.create(code='KIS101', name='Kiswahili', is_core=True)

        policy = GlobalAllocationPolicy.load()
        self.assertEqual(policy.max_subjects_per_class, 2)  # the default this test relies on

        for code in ('allocations.view', 'allocations.edit'):
            Permission.objects.get_or_create(code=code, defaults={'label': code, 'module': 'allocations'})

        self.admin_user = User.objects.create_user(username='admin_test', password='x', is_superuser=True, is_staff=True)

        teacher_user = User.objects.create_user(username='teacher_test', password='x')
        self.teacher = TeacherExtra.objects.create(user=teacher_user, mobile='0700000000', status=True)

        self.client = APIClient()
        self.client.force_authenticate(user=self.admin_user)

    def _post(self, allocations):
        return self.client.post('/api/allocations/matrix/', {
            'class_id': self.stream.id, 'term_id': self.term.id, 'year_id': self.year.id,
            'allocations': allocations,
        }, format='json')

    def test_hard_blocker_includes_structured_dto_alongside_existing_error_string(self):
        response = self._post([
            {'subject_id': self.maths.id, 'teacher_id': self.teacher.id},
            {'subject_id': self.english.id, 'teacher_id': self.teacher.id},
            {'subject_id': self.kiswahili.id, 'teacher_id': self.teacher.id},
        ])
        self.assertEqual(response.status_code, 400)
        self.assertIn('error', response.data)
        self.assertIn('exceeded max subjects', response.data['error'])
        self.assertIn('blocker', response.data)
        self.assertEqual(response.data['blocker']['code'], 'MAX_SUBJECTS_PER_CLASS')
        self.assertEqual(response.data['blocker']['severity'], 'HARD')
        self.assertEqual(response.data['blocker']['rule_ref'], 'policy.max_subjects_per_class')

    def test_success_response_includes_blockers_list_key(self):
        response = self._post([
            {'subject_id': self.maths.id, 'teacher_id': self.teacher.id},
        ])
        self.assertEqual(response.status_code, 201)
        self.assertIn('blockers', response.data)
        self.assertIsInstance(response.data['blockers'], list)

    def test_published_scope_is_still_rejected(self):
        # First save publishes the class (existing "saving IS publishing" behavior).
        first = self._post([{'subject_id': self.maths.id, 'teacher_id': self.teacher.id}])
        self.assertEqual(first.status_code, 201)

        second = self._post([{'subject_id': self.english.id, 'teacher_id': self.teacher.id}])
        self.assertEqual(second.status_code, 409)
        self.assertIn('published', second.data['error'].lower())

    def test_save_rejected_when_class_becomes_published_between_precheck_and_lock(self):
        # Simulates the race: the class is published in the DB, but the cheap pre-check missed it.
        existing = SubjectAllocation.objects.create(
            classroom=self.stream, subject=self.maths, teacher=self.teacher,
            academic_year=self.year, term=self.term,
        )
        AllocationPublishState.objects.create(
            classroom=self.stream, term=self.term, academic_year=self.year, is_published=True,
        )

        with mock.patch('school.views.teacherAllocation_view.get_published_classroom_ids', return_value=set()):
            response = self._post([{'subject_id': self.english.id, 'teacher_id': self.teacher.id}])

        self.assertEqual(response.status_code, 409)
        self.assertIn('published', response.data['error'].lower())
        allocations = SubjectAllocation.objects.filter(classroom=self.stream)
        self.assertEqual(allocations.count(), 1)
        self.assertEqual(allocations.get().pk, existing.pk)
        self.assertEqual(allocations.get().subject_id, self.maths.id)

    def test_rejected_save_leaves_no_placeholder_publish_state_row(self):
        before = SubjectAllocation.objects.filter(classroom=self.stream).count()

        response = self._post([
            {'subject_id': self.maths.id, 'teacher_id': self.teacher.id},
            {'subject_id': self.english.id, 'teacher_id': self.teacher.id},
            {'subject_id': self.kiswahili.id, 'teacher_id': self.teacher.id},
        ])
        self.assertEqual(response.status_code, 400)
        self.assertFalse(AllocationPublishState.objects.filter(classroom=self.stream).exists())
        self.assertEqual(SubjectAllocation.objects.filter(classroom=self.stream).count(), before)

        retry = self._post([{'subject_id': self.maths.id, 'teacher_id': self.teacher.id}])
        self.assertEqual(retry.status_code, 201)
