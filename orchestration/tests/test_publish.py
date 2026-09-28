from datetime import date, time

from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase

from apps.academics.models import AcademicYear, ClassStream, ExamTerm, GradeLevel, Subject, TimeSlot
from apps.allocations.models import AllocationPublishState, SubjectAllocation, SubjectQuota
from apps.allocations.publish_gate import compute_scope_fingerprint
from apps.identity.models import TeacherExtra
from apps.timetable.models import LessonAllocation, Timetable
from orchestration.publish import (
    AcknowledgementRequiredError, PublishBlockedError, StaleReviewError, preview_publish, publish_scope,
)


class PublishWorldMixin:
    def build_world(self, timetable_status='Draft'):
        self.year = AcademicYear.objects.create(year='2026', is_active=True)
        self.term = ExamTerm.objects.create(
            name='Term 1', academic_year=self.year,
            start_date=date(2026, 1, 1), end_date=date(2026, 4, 1), is_active=True,
        )
        self.grade = GradeLevel.objects.create(name='Grade 8', numeric_order=8, curriculum_type='CBC')
        self.stream = ClassStream.objects.create(name='North', grade=self.grade)
        self.maths = Subject.objects.create(code='MAT101', name='Mathematics', is_core=True)
        self.english = Subject.objects.create(code='ENG101', name='English', is_core=True)
        self.kiswahili = Subject.objects.create(code='KIS101', name='Kiswahili', is_core=True)
        self.teacher_a = self.make_teacher('teacher_a')
        self.teacher_b = self.make_teacher('teacher_b')
        self.operator = User.objects.create_user(username='operator', password='x')
        self.slot = TimeSlot.objects.create(day='Monday', start_time=time(8, 0), end_time=time(8, 40))
        self.timetable = Timetable.objects.create(
            name='Term 1', academic_year=self.year, term=self.term, status=timetable_status, is_active=True,
        )
        # The grid currently has teacher_a teaching maths to this class...
        self.lesson = LessonAllocation.objects.create(
            timetable=self.timetable, time_slot=self.slot, class_stream=self.stream,
            subject=self.maths, teacher=self.teacher_a,
        )
        # ...and the saved draft now says teacher_b should.
        self.draft = SubjectAllocation.objects.create(
            classroom=self.stream, subject=self.maths, teacher=self.teacher_b,
            academic_year=self.year, term=self.term, is_active=True,
        )

    def make_teacher(self, username):
        user = User.objects.create_user(username=username, password='x')
        return TeacherExtra.objects.create(user=user, mobile='0700000000', status=True)

    def fingerprint(self):
        return compute_scope_fingerprint(term_id=self.term.id, year_id=self.year.id, class_ids=[self.stream.id])

    def publish(self, fingerprint=None, acknowledge_soft=False):
        return publish_scope(
            term_id=self.term.id, year_id=self.year.id, class_ids=[self.stream.id],
            review_fingerprint=fingerprint or self.fingerprint(), acknowledge_soft=acknowledge_soft,
            operator_id=self.operator.id,
        )

    def is_published(self):
        return AllocationPublishState.objects.filter(
            classroom=self.stream, term=self.term, academic_year=self.year, is_published=True).exists()


class PreviewPublishTests(PublishWorldMixin, TestCase):
    def setUp(self):
        self.build_world()

    def test_preview_reports_the_swap_and_changes_nothing(self):
        preview = preview_publish(term_id=self.term.id, year_id=self.year.id, class_ids=[self.stream.id])
        self.assertTrue(preview.can_publish)
        self.assertTrue(preview.sync.synced)
        self.assertEqual(preview.sync.swapped_count, 1)
        self.assertEqual(preview.fingerprint, self.fingerprint())
        self.lesson.refresh_from_db()
        self.assertEqual(self.lesson.teacher_id, self.teacher_a.id)
        self.assertFalse(self.is_published())

    def test_preview_of_a_scope_with_hard_blockers_skips_the_sync_preview(self):
        for subject in (self.english, self.kiswahili):
            SubjectAllocation.objects.create(
                classroom=self.stream, subject=subject, teacher=self.teacher_b,
                academic_year=self.year, term=self.term, is_active=True,
            )  # teacher_b now has 3 subjects in one class (policy max is 2)
        preview = preview_publish(term_id=self.term.id, year_id=self.year.id, class_ids=[self.stream.id])
        self.assertFalse(preview.can_publish)
        self.assertFalse(preview.sync.synced)


class PublishScopeTests(PublishWorldMixin, TestCase):
    def setUp(self):
        self.build_world()

    def test_publish_marks_the_class_published_and_applies_the_change_to_the_draft_timetable(self):
        result = self.publish()
        self.assertTrue(self.is_published())
        self.lesson.refresh_from_db()
        self.assertEqual(self.lesson.teacher_id, self.teacher_b.id)
        self.assertTrue(result.sync.synced)
        self.assertEqual(result.sync.swapped_count, 1)
        self.assertEqual(result.class_ids, (self.stream.id,))

    def test_a_stale_review_is_rejected_and_nothing_changes(self):
        stale = self.fingerprint()
        self.draft.teacher = self.teacher_a
        self.draft.save()  # the draft changed after the admin reviewed it
        with self.assertRaises(StaleReviewError):
            self.publish(fingerprint=stale)
        self.assertFalse(self.is_published())
        self.lesson.refresh_from_db()
        self.assertEqual(self.lesson.teacher_id, self.teacher_a.id)

    def test_hard_blockers_stop_the_publish_and_nothing_changes(self):
        for subject in (self.english, self.kiswahili):
            SubjectAllocation.objects.create(
                classroom=self.stream, subject=subject, teacher=self.teacher_b,
                academic_year=self.year, term=self.term, is_active=True,
            )
        with self.assertRaises(PublishBlockedError) as ctx:
            self.publish()
        self.assertEqual(ctx.exception.code, 'BLOCKED')
        self.assertTrue(any(b.severity == 'HARD' for b in ctx.exception.blockers))
        self.assertFalse(self.is_published())
        self.lesson.refresh_from_db()
        self.assertEqual(self.lesson.teacher_id, self.teacher_a.id)

    def test_soft_findings_need_acknowledgement(self):
        SubjectQuota.objects.create(grade=self.grade, subject=self.kiswahili, total_lessons=4)  # not allocated
        with self.assertRaises(AcknowledgementRequiredError):
            self.publish()
        self.assertFalse(self.is_published())
        self.publish(acknowledge_soft=True)
        self.assertTrue(self.is_published())

    def test_a_live_timetable_is_never_touched(self):
        Timetable.objects.filter(id=self.timetable.id).update(status='Published')
        result = self.publish()
        self.assertTrue(self.is_published())
        self.assertFalse(result.sync.synced)
        self.assertTrue(result.sync.target_is_live)
        self.lesson.refresh_from_db()
        self.assertEqual(self.lesson.teacher_id, self.teacher_a.id)

    def test_publishing_with_no_active_timetable_still_publishes(self):
        Timetable.objects.filter(id=self.timetable.id).update(is_active=False)
        result = self.publish()
        self.assertTrue(self.is_published())
        self.assertFalse(result.sync.synced)
        self.assertIsNone(result.sync.target_timetable_id)

    def test_republish_after_unpublish_diffs_against_what_is_really_on_the_grid(self):
        self.publish()  # grid now teacher_b
        AllocationPublishState.objects.filter(classroom=self.stream).update(is_published=False)
        self.draft.teacher = self.teacher_a
        self.draft.save()
        result = self.publish()
        self.lesson.refresh_from_db()
        self.assertEqual(self.lesson.teacher_id, self.teacher_a.id)
        self.assertEqual(result.sync.swapped_count, 1)

    def test_an_exception_during_the_sync_rolls_everything_back(self):
        with patch('apps.timetable.services.sync_with_allocation_changes', side_effect=RuntimeError('boom')):
            with self.assertRaises(RuntimeError):
                self.publish()
        self.assertFalse(self.is_published())
        self.assertFalse(AllocationPublishState.objects.filter(classroom=self.stream).exists())
        self.lesson.refresh_from_db()
        self.assertEqual(self.lesson.teacher_id, self.teacher_a.id)

    def test_the_published_event_fires_once_after_commit(self):
        with patch('orchestration.publish.bus.publish') as publish_mock:
            with self.captureOnCommitCallbacks(execute=True) as callbacks:
                self.publish()
        self.assertEqual(len(callbacks), 1)
        publish_mock.assert_called_once()
        event = publish_mock.call_args.args[0]
        self.assertEqual(event.class_ids, (self.stream.id,))
        self.assertEqual(event.teacher_user_ids, (self.teacher_b.user_id,))
        self.assertTrue(event.timetable_synced)
        self.assertEqual(event.published_by_id, self.operator.id)

    def test_a_blocked_publish_fires_no_event(self):
        for subject in (self.english, self.kiswahili):
            SubjectAllocation.objects.create(
                classroom=self.stream, subject=subject, teacher=self.teacher_b,
                academic_year=self.year, term=self.term, is_active=True,
            )
        with patch('orchestration.publish.bus.publish') as publish_mock:
            with self.captureOnCommitCallbacks(execute=True) as callbacks:
                with self.assertRaises(PublishBlockedError):
                    self.publish()
        self.assertEqual(len(callbacks), 0)
        publish_mock.assert_not_called()

    def test_preview_against_a_live_target_skips_the_sync(self):
        Timetable.objects.filter(id=self.timetable.id).update(status='Published')
        preview = preview_publish(term_id=self.term.id, year_id=self.year.id, class_ids=[self.stream.id])
        self.assertTrue(preview.can_publish)
        self.assertFalse(preview.sync.synced)
        self.assertTrue(preview.sync.target_is_live)
        self.lesson.refresh_from_db()
        self.assertEqual(self.lesson.teacher_id, self.teacher_a.id)
