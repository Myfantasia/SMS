from django.test import TestCase, RequestFactory

from apps.identity.models import ParentExtra
from apps.messaging.models import Notification
from apps.results.models import StudentTermResult
from school.tests.base import ExamTestDataMixin
from school.views.results_views import StudentReportCardAPIView


class PublishReportCardNotificationTests(ExamTestDataMixin, TestCase):
    """
    Covers the new notification hook: publishing a StudentTermResult (the flag that actually
    controls whether a student/parent can view it, per StudentReportCardAPIView.get()) must
    notify the student and every linked parent, and only them.
    """

    def setUp(self):
        self.factory = RequestFactory()
        self.view = StudentReportCardAPIView.as_view()
        self.term_result = StudentTermResult.objects.create(
            student=self.student, term=self.term, class_stream=self.stream_cbc,
            total_marks=760, mean_marks=76, mean_grade='EE', is_published=False,
        )

    def _publish(self):
        request = self.factory.post('/api/results/report-card/', data={
            'admNo': self.student.roll, 'year': self.year.year, 'term': self.term.name,
        }, content_type='application/json')
        request.user = self.admin_user
        request._dont_enforce_csrf_checks = True
        return self.view(request)

    def test_publishing_notifies_the_student(self):
        response = self._publish()
        self.assertEqual(response.status_code, 200)

        notif = Notification.objects.get(recipient=self.student_user)
        self.assertEqual(notif.title, "Report Card Published")
        self.assertIn(self.term.name, notif.message)

    def test_publishing_notifies_linked_parents_only(self):
        parent_user = self.other_student_user.__class__.objects.create_user(username='parent_test', password='x')
        parent_user.groups.add(self.parent_group)
        parent = ParentExtra.objects.create(user=parent_user, mobile='0700000000', status=True)
        parent.students.add(self.student)

        self._publish()

        self.assertTrue(Notification.objects.filter(recipient=parent_user).exists())
        # The other student's own parent-less account gets nothing.
        self.assertFalse(Notification.objects.filter(recipient=self.other_student_user).exists())

    def test_publishing_flips_is_published_flag(self):
        self._publish()
        self.term_result.refresh_from_db()
        self.assertTrue(self.term_result.is_published)
