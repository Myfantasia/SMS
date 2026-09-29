from datetime import date, time

from django.contrib.auth.models import User
from django.test import TestCase

from apps.academics.models import AcademicYear, ClassStream, ExamTerm, GradeLevel, Subject, TimeSlot
from apps.allocations.models import AllocationPublishState, SubjectAllocation
from apps.identity.models import TeacherExtra
from apps.timetable.models import LessonAllocation, Timetable
from apps.timetable.verify import compute_timetable_fingerprint
from orchestration.timetable_publish import (
    AcknowledgementRequiredError, StaleReviewError, TimetableBlockedError,
    preview_timetable_publish, publish_timetable,
)


class TimetablePublishWorldMixin:
    def build_world(self):
        self.year = AcademicYear.objects.create(year='2026', is_active=True)
        self.term = ExamTerm.objects.create(
            name='Term 1', academic_year=self.year,
            start_date=date(2026, 1, 1), end_date=date(2026, 4, 1), is_active=True,
        )
        self.grade = GradeLevel.objects.create(name='Grade 8', numeric_order=8, curriculum_type='CBC')
        self.stream = ClassStream.objects.create(name='North', grade=self.grade)
        self.maths = Subject.objects.create(code='MAT101', name='Mathematics', is_core=True)
        self.teacher = self._teacher('teacher_a')
        self.operator = User.objects.create_user(username='operator', password='x')
        self.slot = TimeSlot.objects.create(day='Monday', start_time=time(8, 0), end_time=time(8, 40))
        self.timetable = Timetable.objects.create(
            name='Term 1', academic_year=self.year, term=self.term, status='Draft', is_active=True,
        )
        SubjectAllocation.objects.create(
            classroom=self.stream, subject=self.maths, teacher=self.teacher,
            academic_year=self.year, term=self.term, is_active=True,
        )
        AllocationPublishState.objects.create(
            classroom=self.stream, term=self.term, academic_year=self.year, is_published=True,
        )
        self.lesson = LessonAllocation.objects.create(
            timetable=self.timetable, time_slot=self.slot, class_stream=self.stream,
            subject=self.maths, teacher=self.teacher,
        )

    def _teacher(self, username):
        user = User.objects.create_user(username=username, password='x')
        return TeacherExtra.objects.create(user=user, mobile='0700000000', status=True)

    def fingerprint(self):
        return compute_timetable_fingerprint(timetable_id=self.timetable.id)

    def publish(self, fingerprint=None, acknowledge_soft=True):
        return publish_timetable(
            timetable_id=self.timetable.id, review_fingerprint=fingerprint or self.fingerprint(),
            acknowledge_soft=acknowledge_soft, operator_id=self.operator.id,
        )


class PreviewTimetablePublishTests(TimetablePublishWorldMixin, TestCase):
    def setUp(self):
        self.build_world()

    def test_clean_timetable_can_publish(self):
        report = preview_timetable_publish(timetable_id=self.timetable.id)
        self.assertEqual(report.hard_blockers, ())


class PublishTimetableTests(TimetablePublishWorldMixin, TestCase):
    def setUp(self):
        self.build_world()

    def test_publish_flips_status_to_published(self):
        self.publish()
        self.timetable.refresh_from_db()
        self.assertEqual(self.timetable.status, 'Published')

    def test_a_stale_review_is_rejected_and_status_unchanged(self):
        stale = self.fingerprint()
        LessonAllocation.objects.create(
            timetable=self.timetable, time_slot=TimeSlot.objects.create(day='Tuesday', start_time=time(8, 0), end_time=time(8, 40)),
            class_stream=self.stream, subject=self.maths, teacher=self.teacher,
        )
        with self.assertRaises(StaleReviewError):
            self.publish(fingerprint=stale)
        self.timetable.refresh_from_db()
        self.assertEqual(self.timetable.status, 'Draft')

    def test_hard_conflict_stops_the_publish(self):
        # Deviation from the brief: a second lesson with the *same* class_stream/subject/teacher
        # as self.lesson would collide with LessonAllocation's own DB-level unique_together
        # constraints (('timetable', 'time_slot', 'teacher') and
        # ('timetable', 'time_slot', 'class_stream', 'subject') -- "THE COLLISION ENGINE" in
        # apps/timetable/models.py) before ever reaching verify_timetable's CLASS_DOUBLE_BOOKED
        # check, raising IntegrityError instead of exercising the code under test. Using a
        # different subject/teacher for the second lesson in the same slot/class still triggers a
        # hard blocker (CLASS_DOUBLE_BOOKED, since the class has two overlapping lessons) without
        # hitting that constraint.
        other_subject = Subject.objects.create(code='ENG101', name='English', is_core=True)
        other_teacher = self._teacher('teacher_b')
        LessonAllocation.objects.create(
            timetable=self.timetable, time_slot=self.slot, class_stream=self.stream,
            subject=other_subject, teacher=other_teacher,
        )
        with self.assertRaises(TimetableBlockedError):
            self.publish()
        self.timetable.refresh_from_db()
        self.assertEqual(self.timetable.status, 'Draft')

    def test_make_active_sets_the_singleton(self):
        other = Timetable.objects.create(
            name='Other', academic_year=self.year, term=self.term, status='Draft', is_active=True,
        )
        publish_timetable(
            timetable_id=self.timetable.id, review_fingerprint=self.fingerprint(),
            acknowledge_soft=True, operator_id=self.operator.id, make_active=True,
        )
        other.refresh_from_db()
        self.timetable.refresh_from_db()
        self.assertFalse(other.is_active)
        self.assertTrue(self.timetable.is_active)
