import threading
import time
from datetime import date

from django.db import connection, transaction
from django.test import TransactionTestCase

from apps.academics.models import AcademicYear, ClassStream, ExamTerm, GradeLevel
from apps.allocations.services import lock_publish_state


class LockPublishStateConcurrencyTests(TransactionTestCase):
    def setUp(self):
        self.year = AcademicYear.objects.create(year='2026', is_active=True)
        self.term = ExamTerm.objects.create(
            name='Term 1', academic_year=self.year,
            start_date=date(2026, 1, 1), end_date=date(2026, 4, 1), is_active=True,
        )
        self.grade = GradeLevel.objects.create(name='Grade 8', numeric_order=8, curriculum_type='CBC')
        self.stream = ClassStream.objects.create(name='North', grade=self.grade)

    def test_second_caller_blocks_until_first_transaction_commits(self):
        acquired_by_first = threading.Event()
        release_first = threading.Event()
        second_acquired_at = {}

        def first_holder():
            try:
                with transaction.atomic():
                    lock_publish_state(
                        classroom_id=self.stream.id, term_id=self.term.id, academic_year_id=self.year.id,
                    )
                    acquired_by_first.set()
                    release_first.wait(timeout=5)
            finally:
                connection.close()

        def second_caller():
            try:
                acquired_by_first.wait(timeout=5)
                with transaction.atomic():
                    lock_publish_state(
                        classroom_id=self.stream.id, term_id=self.term.id, academic_year_id=self.year.id,
                    )
                    second_acquired_at['time'] = time.monotonic()
            finally:
                connection.close()

        t1 = threading.Thread(target=first_holder)
        t1.start()
        acquired_by_first.wait(timeout=5)
        t2 = threading.Thread(target=second_caller)
        t2.start()
        time.sleep(0.3)  # give t2 a real chance to attempt (and block on) the row lock
        self.assertNotIn('time', second_acquired_at, "second caller acquired the lock while the first still held it")
        before_release = time.monotonic()
        release_first.set()
        t1.join(timeout=5)
        t2.join(timeout=5)
        self.assertIn('time', second_acquired_at)
        self.assertGreaterEqual(second_acquired_at['time'], before_release)

    def test_row_is_created_on_first_call_and_reused_on_second(self):
        from apps.allocations.models import AllocationPublishState

        with transaction.atomic():
            row = lock_publish_state(
                classroom_id=self.stream.id, term_id=self.term.id, academic_year_id=self.year.id,
            )
        self.assertFalse(row.is_published)
        self.assertEqual(AllocationPublishState.objects.count(), 1)

        with transaction.atomic():
            same_row = lock_publish_state(
                classroom_id=self.stream.id, term_id=self.term.id, academic_year_id=self.year.id,
            )
        self.assertEqual(same_row.id, row.id)
        self.assertEqual(AllocationPublishState.objects.count(), 1)
