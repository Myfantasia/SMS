from datetime import date, time
from unittest import mock

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from apps.academics.models import AcademicYear, ExamTerm, GradeLevel, ClassStream, Subject, TimeSlot
from apps.allocations.models import AllocationPublishState, GlobalAllocationPolicy, SubjectAllocation
from apps.identity.models import Permission, TeacherExtra
from apps.timetable.models import LessonAllocation, Timetable


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

    def _auto_draft(self):
        return self.client.get('/api/allocations/auto-draft/', {
            'class_id': self.stream.id, 'term_id': self.term.id, 'year_id': self.year.id,
        })

    def test_auto_draft_response_includes_blockers_for_review(self):
        # Nothing is saved for this class yet, so review_scope reports NOTHING_TO_PUBLISH.
        response = self._auto_draft()
        self.assertEqual(response.status_code, 200)
        self.assertIn('blockers', response.data)
        self.assertIsInstance(response.data['blockers'], list)
        codes = [b['code'] for b in response.data['blockers']]
        self.assertIn('NOTHING_TO_PUBLISH', codes)
        self.assertEqual(response.data['blockers'][codes.index('NOTHING_TO_PUBLISH')]['classroom_id'],
                         self.stream.id)

    def test_auto_draft_blockers_clear_once_a_row_is_saved(self):
        # Saving a row for this class clears NOTHING_TO_PUBLISH. This does not prove the unsaved
        # draft is excluded from blockers; it only shows blockers track saved rows.
        SubjectAllocation.objects.create(
            classroom=self.stream, subject=self.maths, teacher=self.teacher,
            academic_year=self.year, term=self.term, is_active=True,
        )
        response = self._auto_draft()
        self.assertEqual(response.status_code, 200)
        codes = [b['code'] for b in response.data['blockers']]
        self.assertNotIn('NOTHING_TO_PUBLISH', codes)

    def test_auto_draft_survives_review_scope_failure(self):
        # The blockers review is display-only: if it raises, the draft must still be returned.
        with mock.patch('school.views.teacherAllocation_view.review_scope',
                        side_effect=RuntimeError('boom')):
            response = self._auto_draft()
        self.assertEqual(response.status_code, 200)
        self.assertIn('draft', response.data)
        self.assertEqual(response.data['blockers'], [])

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
        AllocationPublishState.objects.create(
            classroom=self.stream, term=self.term, academic_year=self.year, is_published=True)
        response = self._post([{'subject_id': self.english.id, 'teacher_id': self.teacher.id}])
        self.assertEqual(response.status_code, 409)
        self.assertIn('published', response.data['error'].lower())

    def test_saving_is_a_draft_and_does_not_publish(self):
        response = self._post([{'subject_id': self.maths.id, 'teacher_id': self.teacher.id}])
        self.assertEqual(response.status_code, 201)
        self.assertFalse(AllocationPublishState.objects.filter(classroom=self.stream, is_published=True).exists())
        self.assertIn('draft', response.data['message'].lower())

    def test_saving_does_not_touch_the_timetable(self):
        other_user = User.objects.create_user(username='teacher_other', password='x')
        other_teacher = TeacherExtra.objects.create(user=other_user, mobile='0722222222', status=True)
        slot = TimeSlot.objects.create(day='Monday', start_time=time(8, 0), end_time=time(8, 40))
        timetable = Timetable.objects.create(
            name='T1', academic_year=self.year, term=self.term, status='Draft', is_active=True)
        lesson = LessonAllocation.objects.create(
            timetable=timetable, time_slot=slot, class_stream=self.stream, subject=self.maths, teacher=other_teacher)
        SubjectAllocation.objects.create(
            classroom=self.stream, subject=self.maths, teacher=other_teacher,
            academic_year=self.year, term=self.term, is_active=True)

        response = self._post([{'subject_id': self.maths.id, 'teacher_id': self.teacher.id}])

        self.assertEqual(response.status_code, 201)
        lesson.refresh_from_db()
        self.assertEqual(lesson.teacher_id, other_teacher.id)  # grid unchanged until Publish

    def test_publish_scope_field_is_ignored_and_never_publishes_other_classes(self):
        sibling = ClassStream.objects.create(name='South', grade=self.grade)
        SubjectAllocation.objects.create(
            classroom=sibling, subject=self.maths, teacher=self.teacher,
            academic_year=self.year, term=self.term, is_active=True)
        response = self.client.post('/api/allocations/matrix/', {
            'class_id': self.stream.id, 'term_id': self.term.id, 'year_id': self.year.id,
            'allocations': [{'subject_id': self.maths.id, 'teacher_id': self.teacher.id}],
            'publish_scope': 'all',
        }, format='json')
        self.assertEqual(response.status_code, 201)
        self.assertEqual(AllocationPublishState.objects.filter(is_published=True).count(), 0)

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
