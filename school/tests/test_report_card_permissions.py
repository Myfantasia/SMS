from django.test import TestCase
from rest_framework.test import APIRequestFactory

from school.models.resultsModels import StudentTermResult
from school.tests.base import ExamTestDataMixin
from school.views.results_views import StudentReportCardAPIView


class StudentReportCardAccessTests(ExamTestDataMixin, TestCase):
    """
    Covers the permission bug where StudentReportCardAPIView's class-level
    IsApprovedAdminOrTeacher + HasModulePermission unconditionally 403'd students/parents
    before the view's own self-lookup logic could run, and the access-control gap where an
    authenticated user in no recognized group could look up ANY student by search query.
    """

    def setUp(self):
        self.factory = APIRequestFactory()
        self.view = StudentReportCardAPIView.as_view()
        StudentTermResult.objects.create(
            student=self.student, term=self.term, class_stream=self.stream_cbc,
            total_marks=805.67, mean_marks=72.73, mean_grade='EE',
            stream_position=1, is_published=True,
        )

    def _get(self, user, search=''):
        request = self.factory.get('/api/results/report-card/', {'search': search})
        request.user = user
        return self.view(request)

    def test_student_can_view_own_published_report_card(self):
        response = self._get(self.student_user, search=self.student.roll)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['student']['admNo'], self.student.roll)

    def test_student_is_forced_to_own_roll_even_if_querying_someone_else(self):
        # search_query is overwritten to the caller's own roll regardless of what they pass —
        # this must hold even when the target search happens to name another real student.
        response = self._get(self.student_user, search=self.other_student.roll)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['student']['admNo'], self.student.roll)

    def test_unpublished_report_card_is_blocked_for_student(self):
        StudentTermResult.objects.filter(student=self.student).update(is_published=False)
        response = self._get(self.student_user, search=self.student.roll)
        self.assertEqual(response.status_code, 403)

    def test_groupless_authenticated_user_is_rejected(self):
        # Previously fell through with the raw `search` query left unrestricted, only ever
        # blocked by the (over-broad, since-removed) class-level permission class.
        response = self._get(self.groupless_user, search=self.student.roll)
        self.assertEqual(response.status_code, 403)

    def test_admin_can_view_any_students_report_card(self):
        response = self._get(self.admin_user, search=self.student.roll)
        self.assertEqual(response.status_code, 200)
