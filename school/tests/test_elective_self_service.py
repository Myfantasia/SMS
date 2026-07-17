import json

from django.test import TestCase, RequestFactory

from school.models.classSubjects_models import SubjectQuota, StudentSubjectEnrollment
from school.tests.base import ExamTestDataMixin
from school.views.subject_views import api_student_elective_options, api_student_elective_request


class StudentElectiveSelfServiceTests(ExamTestDataMixin, TestCase):
    """
    Covers the new student self-service elective request flow: students can see which
    electives apply to their own grade, submit a Pending request, and withdraw it — but the
    request must feed the SAME StudentSubjectEnrollment table the existing admin Batch
    Approvals queue (ManageCurriculum.tsx / api_bulk_approve_subjects) already consumes.
    """

    def setUp(self):
        self.factory = RequestFactory()
        SubjectQuota.objects.create(grade=self.grade_cbc, subject=self.french, total_lessons=4)

    def _get_options(self, user):
        request = self.factory.get('/api/subjects/my-electives/')
        request.user = user
        return json.loads(api_student_elective_options(request).content)

    def _post_request(self, user, subject_id):
        request = self.factory.post(
            '/api/subjects/my-electives/request/',
            data=json.dumps({'subject_id': subject_id}), content_type='application/json')
        request.user = user
        return json.loads(api_student_elective_request(request).content)

    def _delete_request(self, user, enrollment_id):
        request = self.factory.delete(
            '/api/subjects/my-electives/request/',
            data=json.dumps({'enrollment_id': enrollment_id}), content_type='application/json')
        request.user = user
        return json.loads(api_student_elective_request(request).content)

    def test_lists_grade_scoped_electives_with_no_status_by_default(self):
        result = self._get_options(self.student_user)
        self.assertEqual(result['status'], 'success')
        french_option = next(e for e in result['data']['electives'] if e['subject_name'] == 'French')
        self.assertIsNone(french_option['status'])

    def test_submitting_a_request_creates_a_pending_enrollment(self):
        result = self._post_request(self.student_user, self.french.id)
        self.assertEqual(result['status'], 'success')

        enrollment = StudentSubjectEnrollment.objects.get(student=self.student, subject=self.french)
        self.assertEqual(enrollment.status, 'Pending')

    def test_core_subject_cannot_be_requested(self):
        result = self._post_request(self.student_user, self.maths.id)
        self.assertEqual(result['status'], 'error')
        self.assertFalse(StudentSubjectEnrollment.objects.filter(student=self.student, subject=self.maths).exists())

    def test_subject_not_in_own_grade_is_rejected(self):
        # French has no SubjectQuota row for the 8-4-4 grade in this test setup.
        other_elective_result = self._post_request(self.student_user, self.french.id)
        self.assertEqual(other_elective_result['status'], 'success')  # sanity: valid for CBC grade

        SubjectQuota.objects.filter(grade=self.grade_cbc, subject=self.french).delete()
        result = self._post_request(self.student_user, self.french.id)
        self.assertEqual(result['status'], 'error')

    def test_already_approved_subject_cannot_be_re_requested(self):
        StudentSubjectEnrollment.objects.create(
            student=self.student, subject=self.french, academic_year=self.year, status='Approved')
        result = self._post_request(self.student_user, self.french.id)
        self.assertEqual(result['status'], 'error')

    def test_withdraw_removes_a_pending_request(self):
        submit_result = self._post_request(self.student_user, self.french.id)
        enrollment_id = submit_result['data']['enrollment_id']

        result = self._delete_request(self.student_user, enrollment_id)
        self.assertEqual(result['status'], 'success')
        self.assertFalse(StudentSubjectEnrollment.objects.filter(id=enrollment_id).exists())

    def test_cannot_withdraw_an_approved_request(self):
        enrollment = StudentSubjectEnrollment.objects.create(
            student=self.student, subject=self.french, academic_year=self.year, status='Approved')
        result = self._delete_request(self.student_user, enrollment.id)
        self.assertEqual(result['status'], 'error')
        self.assertTrue(StudentSubjectEnrollment.objects.filter(id=enrollment.id).exists())

    def test_student_cannot_withdraw_another_students_request(self):
        enrollment = StudentSubjectEnrollment.objects.create(
            student=self.other_student, subject=self.french, academic_year=self.year, status='Pending')
        result = self._delete_request(self.student_user, enrollment.id)
        self.assertEqual(result['status'], 'error')
        self.assertTrue(StudentSubjectEnrollment.objects.filter(id=enrollment.id).exists())
