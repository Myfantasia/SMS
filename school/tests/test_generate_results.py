from decimal import Decimal
from unittest.mock import Mock

from celery.exceptions import MaxRetriesExceededError
from django.core.cache import cache
from django.test import TestCase, RequestFactory, override_settings

from school.models.jobs_models import BackgroundJob
from school.models.models import ExamResult, Notification
from school.models.resultsModels import SubjectTermResult, StudentTermResult
from school.tasks import _mark_success, _mark_failure, _acquire_lock_or_retry
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

    The endpoint queues a Celery task (school/tasks.py:bulk_generate_term_results_task)
    rather than compiling inline — CELERY_TASK_ALWAYS_EAGER is on for tests (see
    schoolmanagement/settings.py), so `.delay()` runs synchronously in-process and the
    BackgroundJob row is already SUCCESS/FAILURE by the time the POST returns.
    """

    def setUp(self):
        # The per-term lock (bulk_results_lock_term_<id>) lives in Redis, which — unlike the
        # old DatabaseCache — isn't wiped between tests automatically. Each test's own run
        # releases its own lock via the task's `finally`, but clearing here/tearDown protects
        # against one test's deliberately-held lock (see the 423 test below) leaking into
        # whichever test happens to run next.
        cache.clear()
        self.factory = RequestFactory()
        self.view = BulkGenerateTermResultsAPIView.as_view()
        ExamResult.objects.create(exam=self.cat1, student=self.student, subject=self.maths,
                                   marks_obtained=Decimal('38'))  # scales to 76%
        # stream_844 has no active students at all — must be reported, not fatal to the batch.

    def tearDown(self):
        cache.clear()

    def _post(self, user, **extra):
        request = self.factory.post('/api/results/bulk-generate/', data={
            'year': self.year.year, 'term': self.term.name, **extra,
        }, content_type='application/json')
        request.user = user
        request._dont_enforce_csrf_checks = True
        return self.view(request)

    def _run_and_get_result(self, user, **extra):
        response = self._post(user, **extra)
        self.assertEqual(response.status_code, 202)
        job = BackgroundJob.objects.get(id=response.data['job_id'])
        self.assertEqual(job.status, 'SUCCESS', job.error_message)
        return job.result

    def test_whole_school_run_covers_every_stream_and_matches_single_stream_math(self):
        result = self._run_and_get_result(self.admin_user)

        by_id = {c['class_id']: c for c in result['per_class']}
        self.assertEqual(by_id[self.stream_cbc.id]['students_assessed'], 1)
        self.assertIsNone(by_id[self.stream_cbc.id]['error'])

        term_result = SubjectTermResult.objects.get(student=self.student, subject=self.maths, term=self.term)
        self.assertEqual(Decimal(str(term_result.total_score)), Decimal('76.00'))

    def test_empty_stream_is_reported_not_fatal(self):
        result = self._run_and_get_result(self.admin_user)
        issue_ids = {c['class_id'] for c in result['classes_with_issues']}
        self.assertIn(self.stream_844.id, issue_ids)
        # The CBC stream still succeeded despite the other stream having no students.
        term_result = SubjectTermResult.objects.filter(student=self.student, subject=self.maths, term=self.term)
        self.assertTrue(term_result.exists())

    def test_grade_scoped_run_only_touches_that_grade(self):
        result = self._run_and_get_result(self.admin_user, grade_id=self.grade_cbc.id)
        touched_ids = {c['class_id'] for c in result['per_class']}
        self.assertEqual(touched_ids, {self.stream_cbc.id})

    def test_non_admin_is_rejected(self):
        response = self._post(self.teacher_user)
        self.assertEqual(response.status_code, 403)

    def test_second_request_while_one_is_running_is_queued_not_rejected(self):
        # Simulates a real race: someone else's run is holding the per-term lock when this
        # admin's request comes in. It's still accepted (202) with an informational note —
        # not rejected outright — since bulk_generate_term_results_task retries against the
        # lock and runs automatically once it frees up (school/tasks.py:_acquire_lock_or_retry).
        cache.add(f"bulk_results_lock_term_{self.term.id}", "another_admin", timeout=300)
        response = self._post(self.admin_user)
        self.assertEqual(response.status_code, 202)
        self.assertIn("already running", response.data['note'])

        # CELERY_TASK_ALWAYS_EAGER runs the whole retry loop as one synchronous call with
        # no real worker cycle to actually wait inside — so in tests specifically, giving up
        # is simulated immediately rather than genuinely retried (see _acquire_lock_or_retry).
        # The point being verified here is that a contended lock produces a clean FAILURE
        # with a clear message, not an unhandled exception bubbling out of the view.
        job = BackgroundJob.objects.get(id=response.data['job_id'])
        self.assertEqual(job.status, 'FAILURE')
        self.assertIn("Timed out waiting", job.error_message)


class JobCompletionNotificationTests(ExamTestDataMixin, TestCase):
    """
    A completed background job (school/tasks.py) always notifies the operator who
    triggered it via the existing Notification model/bell — not just via the frontend's
    poll, so an admin who navigated away still finds out. Covers _mark_success/
    _mark_failure directly rather than round-tripping a whole view+task run, since the
    notification behavior itself doesn't depend on which of the 4 job types produced it.
    """

    def test_success_notifies_the_operator(self):
        job = BackgroundJob.objects.create(job_type='bulk_generate_term_results', operator=self.admin_user)
        _mark_success(str(job.id), {'message': 'All done.'})

        note = Notification.objects.get(recipient=self.admin_user)
        self.assertIn('complete', note.title.lower())
        self.assertEqual(note.action_url, '/admin-dashboard/results')

    def test_failure_notifies_the_operator_with_the_error(self):
        job = BackgroundJob.objects.create(job_type='rollover_allocations', operator=self.admin_user)
        _mark_failure(str(job.id), 'Something went wrong during rollover.')

        note = Notification.objects.get(recipient=self.admin_user)
        self.assertIn('failed', note.title.lower())
        self.assertIn('Something went wrong during rollover.', note.message)

    def test_no_notification_when_job_has_no_operator(self):
        job = BackgroundJob.objects.create(job_type='generate_timetable', operator=None)
        _mark_success(str(job.id), {'message': 'done'})
        self.assertFalse(Notification.objects.exists())


class LockRetryMechanismTests(TestCase):
    """
    Covers _acquire_lock_or_retry (school/tasks.py) directly, with a mock task double
    standing in for the real Celery bound task — this is what actually makes "someone
    else's bulk operation is running" turn into "queued, will run automatically once it
    frees up" rather than an outright rejection. CELERY_TASK_ALWAYS_EAGER is on for the
    whole test suite, so it's overridden to False here specifically to exercise the real
    (non-eager) retry path — under eager mode task.retry() can't meaningfully wait at all
    (see the class docstring in tasks.py), which is covered separately in
    BulkGenerateTermResultsTests.test_second_request_while_one_is_running_is_queued_not_rejected.
    """

    def setUp(self):
        cache.clear()

    def tearDown(self):
        cache.clear()

    def test_free_lock_is_acquired_without_retrying(self):
        task = Mock()
        acquired = _acquire_lock_or_retry(task, 'job-1', 'test_lock_key_free')
        self.assertTrue(acquired)
        task.retry.assert_not_called()
        self.assertEqual(cache.get('test_lock_key_free'), 'job-1')

    @override_settings(CELERY_TASK_ALWAYS_EAGER=False)
    def test_contended_lock_retries_with_bounded_backoff_then_fails_cleanly(self):
        cache.set('test_lock_key_held', 'someone_elses_job', timeout=300)
        task = Mock()
        task.retry.side_effect = MaxRetriesExceededError()
        job = BackgroundJob.objects.create(job_type='rollover_allocations')

        acquired = _acquire_lock_or_retry(task, str(job.id), 'test_lock_key_held')

        self.assertFalse(acquired)
        task.retry.assert_called_once_with(countdown=10, max_retries=20)
        job.refresh_from_db()
        self.assertEqual(job.status, 'FAILURE')
        self.assertIn('Timed out waiting', job.error_message)
