from decimal import Decimal

from django.test import TestCase, RequestFactory

from school.models.models import ExamResult
from school.models.resultsModels import SubjectTermResult, StudentTermResult
from school.tests.base import ExamTestDataMixin
from school.views.results_views import GenerateTermResultsAPIView, BulkGenerateTermResultsAPIView


class GenerateTermResultsTests(ExamTestDataMixin, TestCase):
    """
    Covers two real, production-verified bugs in GenerateTermResultsAPIView:

    1. It used to always divide by 3 (cat1+cat2+main)/3 regardless of how many of those three
       exams actually had a mark entered, deflating a subject's term score to ~1/3 of its real
       value whenever a student only had one or two assessments recorded so far.
    2. It called calculate_dynamic_grade() without the stream's curriculum_type, so CBC
       students' grades were computed on the 8-4-4 letter scale instead of EE/ME/AE/BE.
    """

    def setUp(self):
        self.factory = RequestFactory()
        self.view = GenerateTermResultsAPIView.as_view()

    def _generate(self, stream):
        stream_name = f"{stream.grade.name} {stream.name}"
        request = self.factory.post('/api/results/generate/', data={
            'year': self.year.year, 'term': self.term.name, 'stream': stream_name,
        }, content_type='application/json')
        request.user = self.admin_user
        request._dont_enforce_csrf_checks = True
        return self.view(request)

    def test_averages_only_over_assessments_actually_entered(self):
        # Only CAT 1 (out of 50) has a mark. The old code would divide (76+0+0) by 3 = 25.33.
        ExamResult.objects.create(exam=self.cat1, student=self.student, subject=self.maths,
                                   marks_obtained=Decimal('38'))

        response = self._generate(self.stream_cbc)
        self.assertEqual(response.status_code, 200)

        result = SubjectTermResult.objects.get(student=self.student, subject=self.maths, term=self.term)
        self.assertEqual(Decimal(str(result.total_score)), Decimal('76.00'))

    def test_averages_across_multiple_entered_assessments(self):
        ExamResult.objects.create(exam=self.cat1, student=self.student, subject=self.maths,
                                   marks_obtained=Decimal('38'))  # scales to 76
        ExamResult.objects.create(exam=self.main_exam, student=self.student, subject=self.maths,
                                   marks_obtained=Decimal('80'))  # already out of 100

        response = self._generate(self.stream_cbc)
        self.assertEqual(response.status_code, 200)

        result = SubjectTermResult.objects.get(student=self.student, subject=self.maths, term=self.term)
        # Average of 76 and 80, not divided by a phantom third assessment.
        self.assertEqual(Decimal(str(result.total_score)), Decimal('78.00'))

    def test_cbc_student_gets_cbc_grade_label_not_8_4_4(self):
        ExamResult.objects.create(exam=self.cat1, student=self.student, subject=self.maths,
                                   marks_obtained=Decimal('38'))  # scales to 76%

        response = self._generate(self.stream_cbc)
        self.assertEqual(response.status_code, 200)

        result = SubjectTermResult.objects.get(student=self.student, subject=self.maths, term=self.term)
        self.assertEqual(result.grade, 'EE')

        term_result = StudentTermResult.objects.get(student=self.student, term=self.term)
        self.assertEqual(term_result.mean_grade, 'EE')

    def test_8_4_4_student_gets_letter_grade(self):
        student_844 = self.student
        student_844.cl = self.stream_844
        student_844.save()
        ExamResult.objects.create(exam=self.cat1, student=student_844, subject=self.maths,
                                   marks_obtained=Decimal('38'))  # scales to 76%

        response = self._generate(self.stream_844)
        self.assertEqual(response.status_code, 200)

        result = SubjectTermResult.objects.get(student=student_844, subject=self.maths, term=self.term)
        self.assertEqual(result.grade, 'A-')


class BulkGenerateTermResultsTests(ExamTestDataMixin, TestCase):
    """
    Covers BulkGenerateTermResultsAPIView: it must produce identical per-stream numbers to
    running GenerateTermResultsAPIView one stream at a time (since both call the same shared
    generate_results_for_stream()), report a per-class summary rather than failing the whole
    batch on one empty class, and reject non-admin callers.
    """

    def setUp(self):
        self.factory = RequestFactory()
        self.view = BulkGenerateTermResultsAPIView.as_view()
        ExamResult.objects.create(exam=self.cat1, student=self.student, subject=self.maths,
                                   marks_obtained=Decimal('38'))  # scales to 76%
        # stream_844 has no active students at all — must be reported, not fatal to the batch.

    def _post(self, user, **extra):
        request = self.factory.post('/api/results/bulk-generate/', data={
            'year': self.year.year, 'term': self.term.name, **extra,
        }, content_type='application/json')
        request.user = user
        request._dont_enforce_csrf_checks = True
        return self.view(request)

    def test_whole_school_run_covers_every_stream_and_matches_single_stream_math(self):
        response = self._post(self.admin_user)
        self.assertEqual(response.status_code, 200)

        by_id = {c['class_id']: c for c in response.data['per_class']}
        self.assertEqual(by_id[self.stream_cbc.id]['students_assessed'], 1)
        self.assertIsNone(by_id[self.stream_cbc.id]['error'])

        result = SubjectTermResult.objects.get(student=self.student, subject=self.maths, term=self.term)
        self.assertEqual(Decimal(str(result.total_score)), Decimal('76.00'))

    def test_empty_stream_is_reported_not_fatal(self):
        response = self._post(self.admin_user)
        self.assertEqual(response.status_code, 200)
        issue_ids = {c['class_id'] for c in response.data['classes_with_issues']}
        self.assertIn(self.stream_844.id, issue_ids)
        # The CBC stream still succeeded despite the other stream having no students.
        result = SubjectTermResult.objects.filter(student=self.student, subject=self.maths, term=self.term)
        self.assertTrue(result.exists())

    def test_grade_scoped_run_only_touches_that_grade(self):
        response = self._post(self.admin_user, grade_id=self.grade_cbc.id)
        self.assertEqual(response.status_code, 200)
        touched_ids = {c['class_id'] for c in response.data['per_class']}
        self.assertEqual(touched_ids, {self.stream_cbc.id})

    def test_non_admin_is_rejected(self):
        response = self._post(self.teacher_user)
        self.assertEqual(response.status_code, 403)
