from django.test import TestCase, RequestFactory

from apps.results.models import ClassPerformanceAnalytics, StudentTermResult
from school.tests.base import ExamTestDataMixin
from apps.analytics.views import SchoolAnalyticsAPIView


class SchoolAnalyticsGradeDistributionTests(ExamTestDataMixin, TestCase):
    """
    Covers the mean_grade__startswith bucketing bug: CBC's "BE" (Below Expectation, its worst
    grade) starts with "B" and was being silently counted in the "B (Good)" bucket alongside
    8-4-4's B+/B/B-; "AE" (Approaching Expectation) landed in "A (Distinction)". Also covers the
    pass-rate bug where the label list was missing 'A+' (8-4-4's actual top grade) and every
    CBC label entirely, so any CBC student — or any 8-4-4 student with a straight A+ — was
    counted as failed regardless of real performance.
    """

    def setUp(self):
        self.factory = RequestFactory()
        self.view = SchoolAnalyticsAPIView.as_view()

        ClassPerformanceAnalytics.objects.create(
            term=self.term, class_stream=self.stream_cbc,
            total_students_assessed=2, stream_mean_marks=10, stream_mean_grade='BE',
        )
        StudentTermResult.objects.create(
            student=self.student, term=self.term, class_stream=self.stream_cbc,
            total_marks=10, mean_marks=10, mean_grade='BE', is_published=True,
        )
        StudentTermResult.objects.create(
            student=self.other_student, term=self.term, class_stream=self.stream_cbc,
            total_marks=850, mean_marks=85, mean_grade='EE', is_published=True,
        )

    def _get(self):
        request = self.factory.get('/api/results/school-analytics/', {
            'year': self.year.year, 'term': self.term.name,
        })
        request.user = self.admin_user
        return self.view(request)

    def test_cbc_below_expectation_is_not_counted_as_good(self):
        response = self._get()
        self.assertEqual(response.status_code, 200)
        buckets = {b['name']: b['value'] for b in response.data['gradeDistribution']}
        good_bucket = next(v for k, v in buckets.items() if k.startswith('B /'))
        self.assertEqual(good_bucket, 0)
        below_avg_bucket = next(v for k, v in buckets.items() if k.startswith('D /'))
        self.assertEqual(below_avg_bucket, 1)

    def test_cbc_exceeding_expectation_counts_as_top_tier(self):
        response = self._get()
        buckets = {b['name']: b['value'] for b in response.data['gradeDistribution']}
        top_bucket = next(v for k, v in buckets.items() if k.startswith('A /'))
        self.assertEqual(top_bucket, 1)

    def test_pass_rate_counts_cbc_ee_as_passed(self):
        response = self._get()
        # 1 of 2 students (the EE student) passed; the BE student did not.
        self.assertEqual(response.data['schoolStats']['passRate'], '50.0%')
