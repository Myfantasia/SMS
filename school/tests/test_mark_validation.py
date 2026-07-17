from django.test import TestCase, RequestFactory

from school.models.classSubjects_models import StudentSubjectEnrollment
from school.models.models import ExamResult
from school.tests.base import ExamTestDataMixin
from school.views.exams_views import RapidMarksEntryView


class RapidMarksEntryValidationTests(ExamTestDataMixin, TestCase):
    """
    Covers two RapidMarksEntryView guards: rejecting a mark above the exam's own total_marks
    (e.g. entering 90 on a 50-mark CAT), and rejecting a mark for a student who isn't actually
    enrolled in an elective subject that DOES have real per-student choice data recorded.
    """

    def setUp(self):
        self.factory = RequestFactory()
        self.view = RapidMarksEntryView.as_view()

    def _post(self, subject_id, marks):
        request = self.factory.post('/api/exams/rapid-entry/', data={
            'exam_id': self.cat1.id, 'subject_id': subject_id,
            'results': [{'student_id': self.student.id, 'marks': marks, 'remarks': ''}],
        }, content_type='application/json')
        request.user = self.admin_user
        request._dont_enforce_csrf_checks = True
        return self.view(request)

    def test_rejects_marks_above_exam_total(self):
        response = self._post(self.maths.id, 90)
        self.assertEqual(response.status_code, 400)
        self.assertFalse(ExamResult.objects.filter(student=self.student, subject=self.maths).exists())

    def test_accepts_marks_within_exam_total(self):
        response = self._post(self.maths.id, 45)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(ExamResult.objects.filter(student=self.student, subject=self.maths).exists())

    def test_rejects_unenrolled_student_for_elective_with_real_enrollment_data(self):
        # Enroll the OTHER student in French, leaving self.student without an approved choice —
        # once real enrollment data exists for a subject/grade, marks entry must respect it.
        StudentSubjectEnrollment.objects.create(
            student=self.other_student, subject=self.french, academic_year=self.year, status='Approved')

        response = self._post(self.french.id, 40)
        self.assertEqual(response.status_code, 400)
        self.assertFalse(ExamResult.objects.filter(student=self.student, subject=self.french).exists())

    def test_allows_elective_with_no_enrollment_data_yet(self):
        # No StudentSubjectEnrollment rows exist for French anywhere — the school hasn't
        # started choice-tracking it, so it must still behave like a whole-class subject.
        response = self._post(self.french.id, 40)
        self.assertEqual(response.status_code, 200)
