from datetime import date, time

from django.contrib.auth.models import User
from django.db import transaction
from django.test import TestCase

from apps.academics.models import AcademicYear, ClassStream, ExamTerm, GradeLevel, Subject, TimeSlot
from apps.identity.models import TeacherExtra
from apps.timetable.models import LessonAllocation, Timetable
from apps.timetable.services import (
    get_lesson_triples, get_sync_target, lock_sync_target, preview_sync_with_allocation_changes,
)


class TimetableHelperFixtureMixin:
    def build_world(self):
        self.year = AcademicYear.objects.create(year='2026', is_active=True)
        self.term = ExamTerm.objects.create(
            name='Term 1', academic_year=self.year,
            start_date=date(2026, 1, 1), end_date=date(2026, 4, 1), is_active=True,
        )
        self.grade = GradeLevel.objects.create(name='Grade 8', numeric_order=8, curriculum_type='CBC')
        self.stream = ClassStream.objects.create(name='North', grade=self.grade)
        self.other_stream = ClassStream.objects.create(name='South', grade=self.grade)
        self.maths = Subject.objects.create(code='MAT101', name='Mathematics', is_core=True)
        self.english = Subject.objects.create(code='ENG101', name='English', is_core=True)
        self.teacher_a = self._teacher('teacher_a')
        self.teacher_b = self._teacher('teacher_b')
        self.slot = TimeSlot.objects.create(day='Monday', start_time=time(8, 0), end_time=time(8, 40))
        self.slot2 = TimeSlot.objects.create(day='Monday', start_time=time(8, 40), end_time=time(9, 20))

    def _teacher(self, username):
        user = User.objects.create_user(username=username, password='x')
        return TeacherExtra.objects.create(user=user, mobile='0700000000', status=True)

    def make_timetable(self, *, status='Draft', is_active=True, term=None):
        return Timetable.objects.create(
            name='Term 1 Timetable', academic_year=self.year, term=term or self.term,
            status=status, is_active=is_active,
        )

    def make_lesson(self, timetable, *, stream=None, subject=None, teacher=None, slot=None):
        return LessonAllocation.objects.create(
            timetable=timetable, time_slot=slot or self.slot, class_stream=stream or self.stream,
            subject=subject or self.maths, teacher=teacher or self.teacher_a,
        )


class GetSyncTargetTests(TimetableHelperFixtureMixin, TestCase):
    def setUp(self):
        self.build_world()

    def test_active_draft_timetable_is_a_sync_target_and_not_live(self):
        timetable = self.make_timetable(status='Draft')
        target = get_sync_target(term_id=self.term.id, year_id=self.year.id)
        self.assertEqual(target.timetable_id, timetable.id)
        self.assertFalse(target.is_live)

    def test_active_published_timetable_is_reported_as_live(self):
        self.make_timetable(status='Published')
        target = get_sync_target(term_id=self.term.id, year_id=self.year.id)
        self.assertTrue(target.is_live)

    def test_no_active_timetable_returns_none(self):
        self.make_timetable(status='Draft', is_active=False)
        self.assertIsNone(get_sync_target(term_id=self.term.id, year_id=self.year.id))

    def test_timetable_for_another_term_is_ignored(self):
        other_term = ExamTerm.objects.create(
            name='Term 2', academic_year=self.year,
            start_date=date(2026, 5, 1), end_date=date(2026, 8, 1), is_active=False,
        )
        self.make_timetable(term=other_term)
        self.assertIsNone(get_sync_target(term_id=self.term.id, year_id=self.year.id))


class GetLessonTriplesTests(TimetableHelperFixtureMixin, TestCase):
    def setUp(self):
        self.build_world()

    def test_returns_distinct_triples_only_for_requested_classes(self):
        timetable = self.make_timetable()
        self.make_lesson(timetable, slot=self.slot)
        self.make_lesson(timetable, slot=self.slot2)  # same triple, second period -> still one triple
        self.make_lesson(timetable, stream=self.other_stream, subject=self.english, teacher=self.teacher_b)
        triples = get_lesson_triples(timetable_id=timetable.id, class_ids=[self.stream.id])
        self.assertEqual(triples, frozenset({(self.stream.id, self.teacher_a.id, self.maths.id)}))


class PreviewSyncTests(TimetableHelperFixtureMixin, TestCase):
    def setUp(self):
        self.build_world()

    def test_preview_reports_counts_but_persists_nothing(self):
        timetable = self.make_timetable()
        lesson = self.make_lesson(timetable)
        prior = frozenset({(self.stream.id, self.teacher_a.id, self.maths.id)})

        result = preview_sync_with_allocation_changes(
            active_timetable_id=timetable.id, prior_triples=prior, new_triples=frozenset(),
        )

        self.assertEqual(result.ejected_count, 1)
        self.assertTrue(LessonAllocation.objects.filter(id=lesson.id).exists())

    def test_preview_counts_an_in_place_swap_without_applying_it(self):
        timetable = self.make_timetable()
        lesson = self.make_lesson(timetable)
        prior = frozenset({(self.stream.id, self.teacher_a.id, self.maths.id)})
        new = frozenset({(self.stream.id, self.teacher_b.id, self.maths.id)})

        result = preview_sync_with_allocation_changes(
            active_timetable_id=timetable.id, prior_triples=prior, new_triples=new,
        )

        self.assertEqual(result.swapped_count, 1)
        lesson.refresh_from_db()
        self.assertEqual(lesson.teacher_id, self.teacher_a.id)


class LockSyncTargetTests(TimetableHelperFixtureMixin, TestCase):
    def setUp(self):
        self.build_world()

    def _locked(self):
        with transaction.atomic():
            return lock_sync_target(term_id=self.term.id, year_id=self.year.id)

    def test_matches_get_sync_target_for_an_active_draft(self):
        self.make_timetable(status='Draft')
        target = self._locked()
        self.assertEqual(target, get_sync_target(term_id=self.term.id, year_id=self.year.id))
        self.assertFalse(target.is_live)

    def test_matches_get_sync_target_for_an_active_published_timetable(self):
        self.make_timetable(status='Published')
        target = self._locked()
        self.assertEqual(target, get_sync_target(term_id=self.term.id, year_id=self.year.id))
        self.assertTrue(target.is_live)

    def test_returns_none_when_there_is_no_active_timetable(self):
        self.make_timetable(status='Draft', is_active=False)
        self.assertIsNone(self._locked())
