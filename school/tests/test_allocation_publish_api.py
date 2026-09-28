from datetime import date

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from apps.academics.models import AcademicYear, ClassStream, ExamTerm, GradeLevel, Subject
from apps.allocations.models import AllocationPublishState, SubjectAllocation
from apps.identity.models import Permission, TeacherExtra


class AllocationPublishApiTests(TestCase):
    def setUp(self):
        self.year = AcademicYear.objects.create(year='2026', is_active=True)
        self.term = ExamTerm.objects.create(
            name='Term 1', academic_year=self.year,
            start_date=date(2026, 1, 1), end_date=date(2026, 4, 1), is_active=True,
        )
        self.grade = GradeLevel.objects.create(name='Grade 8', numeric_order=8, curriculum_type='CBC')
        self.stream = ClassStream.objects.create(name='North', grade=self.grade)
        self.maths = Subject.objects.create(code='MAT101', name='Mathematics', is_core=True)
        teacher_user = User.objects.create_user(username='teacher_x', password='x')
        self.teacher = TeacherExtra.objects.create(user=teacher_user, mobile='0700000000', status=True)
        self.allocation = SubjectAllocation.objects.create(
            classroom=self.stream, subject=self.maths, teacher=self.teacher,
            academic_year=self.year, term=self.term, is_active=True,
        )
        for code in ('allocations.view', 'allocations.edit'):
            Permission.objects.get_or_create(code=code, defaults={'label': code, 'module': 'allocations'})
        self.admin = User.objects.create_user(username='admin_x', password='x', is_superuser=True, is_staff=True)
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

    def body(self, **extra):
        data = {'term_id': self.term.id, 'year_id': self.year.id, 'class_id': self.stream.id,
                'grade_id': self.grade.id, 'scope': 'class'}
        data.update(extra)
        return data

    def preview(self):
        return self.client.post('/api/allocations/publish/preview/', self.body(), format='json')

    def is_published(self):
        return AllocationPublishState.objects.filter(classroom=self.stream, is_published=True).exists()

    def test_preview_returns_fingerprint_blockers_and_sync_summary(self):
        response = self.preview()
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data['fingerprint'])
        self.assertTrue(response.data['can_publish'])
        self.assertEqual(response.data['class_ids'], [self.stream.id])
        self.assertFalse(response.data['sync']['synced'])  # no active timetable in this fixture
        self.assertFalse(self.is_published())  # preview never publishes

    def test_publish_with_the_reviewed_fingerprint_publishes(self):
        fingerprint = self.preview().data['fingerprint']
        response = self.client.post(
            '/api/allocations/publish/', self.body(review_fingerprint=fingerprint, acknowledge_soft=False), format='json')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(self.is_published())

    def test_publish_after_the_draft_changed_is_a_409_stale_review(self):
        fingerprint = self.preview().data['fingerprint']
        other = User.objects.create_user(username='teacher_y', password='x')
        self.allocation.teacher = TeacherExtra.objects.create(user=other, mobile='0711111111', status=True)
        self.allocation.save()
        response = self.client.post(
            '/api/allocations/publish/', self.body(review_fingerprint=fingerprint, acknowledge_soft=False), format='json')
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data['code'], 'STALE_REVIEW')
        self.assertFalse(self.is_published())

    def test_publishing_a_class_with_nothing_saved_is_a_400_with_blockers(self):
        self.allocation.delete()
        fingerprint = self.preview().data['fingerprint']
        response = self.client.post(
            '/api/allocations/publish/', self.body(review_fingerprint=fingerprint, acknowledge_soft=False), format='json')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data['code'], 'BLOCKED')
        self.assertEqual(response.data['blockers'][0]['code'], 'NOTHING_TO_PUBLISH')

    def test_missing_ids_are_a_400(self):
        response = self.client.post('/api/allocations/publish/preview/', {'scope': 'class'}, format='json')
        self.assertEqual(response.status_code, 400)

    def test_a_user_without_the_edit_permission_is_refused(self):
        plain = User.objects.create_user(username='plain_user', password='x')
        client = APIClient()
        client.force_authenticate(user=plain)
        self.assertEqual(client.post('/api/allocations/publish/preview/', self.body(), format='json').status_code, 403)
        self.assertEqual(client.post('/api/allocations/publish/', self.body(review_fingerprint='x'), format='json').status_code, 403)
