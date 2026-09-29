# school/tests/test_generation_reads_published_only.py
from datetime import date, time

from django.contrib.auth.models import User
from django.test import TestCase

from apps.academics.models import AcademicYear, ClassStream, ExamTerm, GradeLevel, Subject, TimeSlot
from apps.allocations.models import AllocationPublishState, SubjectAllocation, SubjectQuota
from apps.identity.models import TeacherExtra
from apps.timetable.models import LessonAllocation, Timetable
from school.views.views_timetable import generate_lessons_for_scope


class GenerationReadsPublishedOnlyTests(TestCase):
    def setUp(self):
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
        self.published_teacher = self._teacher('teacher_pub')
        self.draft_teacher = self._teacher('teacher_draft')
        self.slot = TimeSlot.objects.create(day='Monday', start_time=time(8, 0), end_time=time(8, 40))
        self.timetable = Timetable.objects.create(
            name='T1', academic_year=self.year, term=self.term, status='Draft', is_active=True,
        )
        # SubjectQuota for both subjects so a full regenerate has something real to schedule --
        # without this, generation has nothing to place and the tests below can't tell the
        # published-vs-draft distinction from "nothing happened for an unrelated reason".
        SubjectQuota.objects.create(grade=self.grade, subject=self.maths, total_lessons=1)
        SubjectQuota.objects.create(grade=self.grade, subject=self.english, total_lessons=1)

    def _teacher(self, username):
        user = User.objects.create_user(username=username, password='x')
        return TeacherExtra.objects.create(user=user, mobile='0700000000', status=True)

    def test_an_unpublished_classs_lesson_survives_a_different_classs_regeneration(self):
        # self.stream WAS published and has a real lesson on the grid, but is NOT published right
        # now (e.g. it was unpublished for editing -- Unpublish only flips the flag, it never
        # touches lessons). Regenerating a completely different, published class must not sweep
        # self.stream's lesson as an "orphan" just because self.stream currently has no published
        # contract -- this is the actual scenario the final review found (I-1).
        SubjectAllocation.objects.create(
            classroom=self.stream, subject=self.maths, teacher=self.published_teacher,
            academic_year=self.year, term=self.term, is_active=True,
        )
        lesson = LessonAllocation.objects.create(
            timetable=self.timetable, time_slot=self.slot, class_stream=self.stream,
            subject=self.maths, teacher=self.published_teacher,
        )
        # self.stream is deliberately NOT published -- no AllocationPublishState row at all here.

        SubjectAllocation.objects.create(
            classroom=self.other_stream, subject=self.english, teacher=self.draft_teacher,
            academic_year=self.year, term=self.term, is_active=True,
        )
        AllocationPublishState.objects.create(
            classroom=self.other_stream, term=self.term, academic_year=self.year, is_published=True,
        )

        generate_lessons_for_scope(self.timetable, [self.other_stream])  # self.stream NOT in scope

        self.assertTrue(LessonAllocation.objects.filter(id=lesson.id).exists())

    # A third scenario -- "the SAME class's contract is edited while still published" -- was
    # deliberately dropped from this test file. It cannot happen: AllocationMatrixAPIView.post
    # (school/views/teacherAllocation_view.py) already hard-blocks any edit to a published class's
    # allocations until it is explicitly unpublished first (Phase 1A's lock_publish_state +
    # published re-check). The only real path to "this class's allocation differs from what's on
    # the timetable" is unpublish -> edit -> not yet republished, which is exactly the
    # is_published=False state the first test above already covers.

    def test_a_never_published_classs_existing_lesson_is_never_deleted_by_an_unrelated_regeneration(self):
        # Belt-and-braces: a class that has NEVER been published (no AllocationPublishState row at
        # all, not even an unpublished one) still keeps its existing lessons when something else
        # regenerates -- same guard, different starting state.
        lesson = LessonAllocation.objects.create(
            timetable=self.timetable, time_slot=self.slot, class_stream=self.stream,
            subject=self.maths, teacher=self.published_teacher,
        )
        SubjectAllocation.objects.create(
            classroom=self.other_stream, subject=self.english, teacher=self.draft_teacher,
            academic_year=self.year, term=self.term, is_active=True,
        )
        AllocationPublishState.objects.create(
            classroom=self.other_stream, term=self.term, academic_year=self.year, is_published=True,
        )

        generate_lessons_for_scope(self.timetable, [self.other_stream])

        self.assertTrue(LessonAllocation.objects.filter(id=lesson.id).exists())
