from datetime import date, time

from django.contrib.auth.models import User
from django.test import TestCase

from apps.academics.models import AcademicYear, ClassStream, ExamTerm, GradeLevel, Subject, TimeSlot
# Routed through apps.allocations.services / apps.staff.services, not .models directly -- see the
# matching comment in apps/timetable/verify.py: the no-model-import-timetable import-linter
# contract forbids apps.timetable (tests included) from a direct `from apps.allocations.models
# import ...` / `from apps.staff.models import ...`; both services modules already import these
# same classes at module scope, so this is the lint-clean path to the real model instances these
# fixtures need.
from apps.allocations.services import AllocationPublishState, SubjectAllocation, SubjectQuota
from apps.identity.models import TeacherExtra
from apps.staff.services import TeacherStructuralAvailability
from apps.timetable.models import LessonAllocation, Timetable
from apps.timetable.verify import compute_timetable_fingerprint, verify_timetable


class VerifyTimetableFixtureMixin:
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
        # Overlaps self.slot (8:00-8:40) in wall-clock time but is a DIFFERENT TimeSlot row, so a
        # teacher can legally hold both under LessonAllocation's own unique_together (keyed on
        # time_slot id, not on actual start/end) -- this is the real double-booking risk verify_timetable
        # has to catch, since an identical time_slot id for the same teacher+timetable is already
        # impossible at the DB level.
        self.overlapping_slot = TimeSlot.objects.create(day='Monday', start_time=time(8, 20), end_time=time(9, 0))
        self.global_slot = TimeSlot.objects.create(
            day='Monday', start_time=time(9, 20), end_time=time(9, 40), is_global=True, global_label='Break',
        )
        self.timetable = Timetable.objects.create(
            name='T1', academic_year=self.year, term=self.term, status='Draft', is_active=True,
        )

    def _teacher(self, username):
        user = User.objects.create_user(username=username, password='x')
        return TeacherExtra.objects.create(user=user, mobile='0700000000', status=True)

    def allocate_and_publish(self, classroom, subject, teacher):
        SubjectAllocation.objects.create(
            classroom=classroom, subject=subject, teacher=teacher,
            academic_year=self.year, term=self.term, is_active=True,
        )
        AllocationPublishState.objects.update_or_create(
            classroom=classroom, term=self.term, academic_year=self.year, defaults={'is_published': True},
        )

    def lesson(self, *, stream=None, subject=None, teacher=None, slot=None):
        return LessonAllocation.objects.create(
            timetable=self.timetable, time_slot=slot or self.slot, class_stream=stream or self.stream,
            subject=subject or self.maths, teacher=teacher or self.teacher_a,
        )


class VerifyConflictsTests(VerifyTimetableFixtureMixin, TestCase):
    def setUp(self):
        self.build_world()

    def test_clean_timetable_has_no_hard_blockers(self):
        self.allocate_and_publish(self.stream, self.maths, self.teacher_a)
        self.lesson()
        report = verify_timetable(timetable_id=self.timetable.id)
        self.assertEqual(report.hard_blockers, ())

    def test_teacher_double_booked_in_one_slot_is_a_hard_blocker(self):
        # Two DIFFERENT (but overlapping) TimeSlot rows, not the same row twice: an identical
        # (timetable, time_slot, teacher) tuple is already impossible at the DB level (see
        # LessonAllocation.Meta.unique_together), so the only way a teacher actually ends up
        # double-booked is via two distinct slots whose wall-clock ranges collide -- e.g. after
        # slot times were edited post-placement.
        self.allocate_and_publish(self.stream, self.maths, self.teacher_a)
        self.allocate_and_publish(self.other_stream, self.english, self.teacher_a)
        self.lesson(stream=self.stream, subject=self.maths, teacher=self.teacher_a, slot=self.slot)
        self.lesson(stream=self.other_stream, subject=self.english, teacher=self.teacher_a, slot=self.overlapping_slot)
        report = verify_timetable(timetable_id=self.timetable.id)
        self.assertIn('TEACHER_DOUBLE_BOOKED', {b.code for b in report.hard_blockers})

    def test_class_with_two_lessons_in_one_slot_is_a_hard_blocker(self):
        self.allocate_and_publish(self.stream, self.maths, self.teacher_a)
        self.allocate_and_publish(self.stream, self.english, self.teacher_b)
        self.lesson(stream=self.stream, subject=self.maths, teacher=self.teacher_a, slot=self.slot)
        self.lesson(stream=self.stream, subject=self.english, teacher=self.teacher_b, slot=self.slot)
        report = verify_timetable(timetable_id=self.timetable.id)
        self.assertIn('CLASS_DOUBLE_BOOKED', {b.code for b in report.hard_blockers})

    def test_teacher_in_a_structural_blackout_slot_is_a_hard_blocker(self):
        self.allocate_and_publish(self.stream, self.maths, self.teacher_a)
        TeacherStructuralAvailability.objects.create(teacher=self.teacher_a, time_slot=self.slot)
        self.lesson()
        report = verify_timetable(timetable_id=self.timetable.id)
        self.assertIn('TEACHER_STRUCTURALLY_UNAVAILABLE', {b.code for b in report.hard_blockers})

    def test_a_lesson_in_a_global_slot_is_a_hard_blocker(self):
        self.allocate_and_publish(self.stream, self.maths, self.teacher_a)
        self.lesson(slot=self.global_slot)
        report = verify_timetable(timetable_id=self.timetable.id)
        self.assertIn('LESSON_IN_GLOBAL_SLOT', {b.code for b in report.hard_blockers})

    def test_a_lesson_not_matching_a_published_contract_is_a_hard_blocker(self):
        self.allocate_and_publish(self.stream, self.maths, self.teacher_a)
        self.lesson(stream=self.stream, subject=self.maths, teacher=self.teacher_b)  # wrong teacher
        report = verify_timetable(timetable_id=self.timetable.id)
        self.assertIn('LESSON_NOT_PUBLISHED', {b.code for b in report.hard_blockers})

    def test_a_locked_lesson_that_doesnt_match_is_still_flagged(self):
        # Locking pins a placement against automated resync; it is never a silent exemption from
        # what the timetable actually claims to represent once it goes live.
        self.allocate_and_publish(self.stream, self.maths, self.teacher_a)
        LessonAllocation.objects.create(
            timetable=self.timetable, time_slot=self.slot, class_stream=self.stream,
            subject=self.maths, teacher=self.teacher_b, is_locked=True,
        )
        report = verify_timetable(timetable_id=self.timetable.id)
        self.assertIn('LESSON_NOT_PUBLISHED', {b.code for b in report.hard_blockers})


class VerifyCompletenessTests(VerifyTimetableFixtureMixin, TestCase):
    def setUp(self):
        self.build_world()

    def test_a_published_class_missing_a_quota_subject_is_soft(self):
        SubjectQuota.objects.create(grade=self.grade, subject=self.english, total_lessons=4)
        self.allocate_and_publish(self.stream, self.maths, self.teacher_a)
        self.lesson()
        report = verify_timetable(timetable_id=self.timetable.id)
        self.assertIn('INCOMPLETE_CLASS', {b.code for b in report.soft_blockers})
        self.assertEqual(report.hard_blockers, ())


class VerifyPedagogyTests(VerifyTimetableFixtureMixin, TestCase):
    def setUp(self):
        self.build_world()

    def test_exceeding_the_weekly_lesson_cap_is_flagged(self):
        from apps.allocations.services import GlobalAllocationPolicy
        policy = GlobalAllocationPolicy.load()
        policy.max_weekly_lessons = 1
        policy.save()
        self.allocate_and_publish(self.stream, self.maths, self.teacher_a)
        self.allocate_and_publish(self.other_stream, self.english, self.teacher_a)
        self.lesson(stream=self.stream, subject=self.maths, teacher=self.teacher_a, slot=self.slot)
        self.lesson(stream=self.other_stream, subject=self.english, teacher=self.teacher_a, slot=self.slot2)
        report = verify_timetable(timetable_id=self.timetable.id)
        self.assertIn('TEACHER_WEEKLY_CAP', {b.code for b in report.soft_blockers} | {b.code for b in report.hard_blockers})


class FingerprintTests(VerifyTimetableFixtureMixin, TestCase):
    def setUp(self):
        self.build_world()

    def test_moving_a_lesson_changes_the_fingerprint(self):
        self.allocate_and_publish(self.stream, self.maths, self.teacher_a)
        lesson = self.lesson()
        before = compute_timetable_fingerprint(timetable_id=self.timetable.id)
        lesson.time_slot = self.slot2
        lesson.save()
        self.assertNotEqual(before, compute_timetable_fingerprint(timetable_id=self.timetable.id))
