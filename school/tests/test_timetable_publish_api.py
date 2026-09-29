from datetime import date, time

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from apps.academics.models import AcademicYear, ClassStream, ExamTerm, GradeLevel, Subject, TimeSlot
from apps.allocations.models import AllocationPublishState, SubjectAllocation
from apps.identity.models import Permission, TeacherExtra
from apps.timetable.models import LessonAllocation, Timetable


class TimetablePublishApiTests(TestCase):
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
        SubjectAllocation.objects.create(
            classroom=self.stream, subject=self.maths, teacher=self.teacher,
            academic_year=self.year, term=self.term, is_active=True,
        )
        AllocationPublishState.objects.create(
            classroom=self.stream, term=self.term, academic_year=self.year, is_published=True,
        )
        slot = TimeSlot.objects.create(day='Monday', start_time=time(8, 0), end_time=time(8, 40))
        self.timetable = Timetable.objects.create(
            name='Term 1', academic_year=self.year, term=self.term, status='Draft', is_active=True,
        )
        LessonAllocation.objects.create(
            timetable=self.timetable, time_slot=slot, class_stream=self.stream,
            subject=self.maths, teacher=self.teacher,
        )
        for code in ('timetable.view', 'timetable.edit'):
            Permission.objects.get_or_create(code=code, defaults={'label': code, 'module': 'timetable'})
        self.admin = User.objects.create_user(username='admin_x', password='x', is_superuser=True, is_staff=True)
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

    def preview(self):
        return self.client.post('/api/timetable/publish/preview/', {'timetable_id': self.timetable.id}, format='json')

    def test_preview_returns_fingerprint_and_no_blockers(self):
        response = self.preview()
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data['can_publish'])
        self.assertTrue(response.data['fingerprint'])

    def test_publish_with_the_reviewed_fingerprint_publishes(self):
        fingerprint = self.preview().data['fingerprint']
        response = self.client.post('/api/timetable/publish/', {
            'timetable_id': self.timetable.id, 'review_fingerprint': fingerprint, 'acknowledge_soft': True,
        }, format='json')
        self.assertEqual(response.status_code, 200)
        self.timetable.refresh_from_db()
        self.assertEqual(self.timetable.status, 'Published')

    def test_publish_after_the_grid_changed_is_a_409(self):
        fingerprint = self.preview().data['fingerprint']
        LessonAllocation.objects.create(
            timetable=self.timetable,
            time_slot=TimeSlot.objects.create(day='Tuesday', start_time=time(8, 0), end_time=time(8, 40)),
            class_stream=self.stream, subject=self.maths, teacher=self.teacher,
        )
        response = self.client.post('/api/timetable/publish/', {
            'timetable_id': self.timetable.id, 'review_fingerprint': fingerprint, 'acknowledge_soft': True,
        }, format='json')
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data['code'], 'STALE_REVIEW')

    def test_missing_timetable_id_is_a_400(self):
        response = self.client.post('/api/timetable/publish/preview/', {}, format='json')
        self.assertEqual(response.status_code, 400)

    def test_a_user_without_edit_permission_is_refused(self):
        plain = User.objects.create_user(username='plain', password='x')
        client = APIClient()
        client.force_authenticate(user=plain)
        self.assertEqual(client.post('/api/timetable/publish/preview/', {'timetable_id': self.timetable.id}, format='json').status_code, 403)
