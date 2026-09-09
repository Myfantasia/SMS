import json

from django.test import TestCase, RequestFactory

from apps.allocations.models import SubjectAllocation
from apps.students.models import StudentSubjectEnrollment
from school.tests.base import ExamTestDataMixin
from school.views.subject_views import api_student_subjects_overview


class StudentSubjectsOverviewTests(ExamTestDataMixin, TestCase):
    """
    Covers the "My Subjects" consolidation's Compulsory data source: a student's own core
    subjects, with lock status and (when a SubjectAllocation exists) the assigned teacher's
    name -- electives are deliberately NOT covered here, they stay on
    api_student_elective_options's own existing test file.
    """

    def setUp(self):
        self.factory = RequestFactory()

    def _get(self, user):
        request = self.factory.get('/api/subjects/my-subjects/')
        request.user = user
        return json.loads(api_student_subjects_overview(request).content)

    def test_core_subject_listed_elective_is_not(self):
        result = self._get(self.student_user)
        self.assertEqual(result['status'], 'success')
        names = [s['subject_name'] for s in result['data']['compulsory']]
        self.assertIn('Mathematics', names)
        self.assertNotIn('French', names)

    def test_no_enrollment_yet_shows_null_status(self):
        result = self._get(self.student_user)
        maths = next(s for s in result['data']['compulsory'] if s['subject_name'] == 'Mathematics')
        self.assertIsNone(maths['status'])
        self.assertIsNone(maths['teacher_name'])

    def test_approved_enrollment_reflects_locked_status(self):
        StudentSubjectEnrollment.objects.create(
            student=self.student, subject=self.maths, academic_year=self.year, status='Approved')
        result = self._get(self.student_user)
        maths = next(s for s in result['data']['compulsory'] if s['subject_name'] == 'Mathematics')
        self.assertEqual(maths['status'], 'Approved')

    def test_assigned_teacher_name_is_surfaced(self):
        SubjectAllocation.objects.create(
            classroom=self.stream_cbc, subject=self.maths, teacher=self.teacher,
            academic_year=self.year, term=self.term, is_active=True)
        result = self._get(self.student_user)
        maths = next(s for s in result['data']['compulsory'] if s['subject_name'] == 'Mathematics')
        self.assertEqual(maths['teacher_name'], self.teacher.get_name)

    def test_unauthenticated_request_is_rejected(self):
        from django.contrib.auth.models import AnonymousUser
        request = self.factory.get('/api/subjects/my-subjects/')
        request.user = AnonymousUser()
        response = api_student_subjects_overview(request)
        self.assertEqual(response.status_code, 401)
