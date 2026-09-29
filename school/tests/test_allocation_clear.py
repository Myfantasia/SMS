from datetime import date, time

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from apps.academics.models import AcademicYear, ExamTerm, GradeLevel, ClassStream, Subject, TimeSlot
from apps.allocations.models import SubjectAllocation
from apps.identity.models import Permission, TeacherExtra
from apps.timetable.models import LessonAllocation, Timetable


class ClearAllocationsLiveTimetableTests(TestCase):
    """ClearAllocationsAPIView always deletes SubjectAllocation draft rows for the scope, but must
    never write to a Published (live) timetable -- that invariant belongs solely to an explicit
    Review & Publish (orchestration/publish.py). These tests cover both sides: a Draft active
    timetable still gets its stale lessons ejected as before, a Published one doesn't."""

    def setUp(self):
        self.year = AcademicYear.objects.create(year='2026', is_active=True)
        self.term = ExamTerm.objects.create(
            name='Term 1', academic_year=self.year,
            start_date=date(2026, 1, 1), end_date=date(2026, 4, 1), is_active=True,
        )
        self.grade = GradeLevel.objects.create(name='Grade 8', numeric_order=8, curriculum_type='CBC')
        self.stream = ClassStream.objects.create(name='North', grade=self.grade)
        self.maths = Subject.objects.create(code='MAT101', name='Mathematics', is_core=True)

        for code in ('allocations.view', 'allocations.edit', 'allocations.bulk'):
            Permission.objects.get_or_create(code=code, defaults={'label': code, 'module': 'allocations'})

        self.admin_user = User.objects.create_user(
            username='admin_test', password='x', is_superuser=True, is_staff=True)
        teacher_user = User.objects.create_user(username='teacher_test', password='x')
        self.teacher = TeacherExtra.objects.create(user=teacher_user, mobile='0700000000', status=True)
        self.slot = TimeSlot.objects.create(day='Monday', start_time=time(8, 0), end_time=time(8, 40))

        self.client = APIClient()
        self.client.force_authenticate(user=self.admin_user)

    def _seed_allocation_and_lesson(self, timetable):
        SubjectAllocation.objects.create(
            classroom=self.stream, subject=self.maths, teacher=self.teacher,
            academic_year=self.year, term=self.term, is_active=True,
        )
        return LessonAllocation.objects.create(
            timetable=timetable, time_slot=self.slot, class_stream=self.stream,
            subject=self.maths, teacher=self.teacher,
        )

    def _clear(self, **params):
        query = {'term_id': self.term.id, 'year_id': self.year.id, **params}
        # request.query_params (not request.data) is what the view reads, so this must go on
        # the URL, not the DELETE body.
        qs = '&'.join(f'{key}={value}' for key, value in query.items())
        return self.client.delete(f'/api/allocations/clear/?{qs}')

    def test_clear_deletes_lessons_when_the_active_timetable_is_draft(self):
        timetable = Timetable.objects.create(
            name='T1', academic_year=self.year, term=self.term, status='Draft', is_active=True)
        lesson = self._seed_allocation_and_lesson(timetable)

        response = self._clear(class_id=self.stream.id)

        self.assertEqual(response.status_code, 200)
        self.assertFalse(SubjectAllocation.objects.filter(classroom=self.stream).exists())
        self.assertFalse(LessonAllocation.objects.filter(pk=lesson.pk).exists())
        self.assertEqual(response.data['ejected_lesson_count'], 1)

    def test_clear_leaves_lessons_untouched_when_the_active_timetable_is_published(self):
        timetable = Timetable.objects.create(
            name='T1', academic_year=self.year, term=self.term, status='Published', is_active=True)
        lesson = self._seed_allocation_and_lesson(timetable)

        response = self._clear(class_id=self.stream.id)

        self.assertEqual(response.status_code, 200)
        # The draft contract is still gone -- clearing a draft is always fine.
        self.assertFalse(SubjectAllocation.objects.filter(classroom=self.stream).exists())
        # But the live timetable's lesson is untouched: same row, same teacher, same slot.
        lesson.refresh_from_db()
        self.assertEqual(lesson.teacher_id, self.teacher.id)
        self.assertEqual(lesson.time_slot_id, self.slot.id)
        self.assertEqual(response.data['ejected_lesson_count'], 0)
        self.assertIn('live', response.data['message'].lower())

    def test_grade_scope_clear_also_leaves_lessons_untouched_when_the_timetable_is_published(self):
        timetable = Timetable.objects.create(
            name='T1', academic_year=self.year, term=self.term, status='Published', is_active=True)
        lesson = self._seed_allocation_and_lesson(timetable)

        response = self._clear(grade_id=self.grade.id)

        self.assertEqual(response.status_code, 200)
        self.assertFalse(SubjectAllocation.objects.filter(classroom=self.stream).exists())
        lesson.refresh_from_db()
        self.assertEqual(lesson.teacher_id, self.teacher.id)
        self.assertEqual(response.data['ejected_lesson_count'], 0)
