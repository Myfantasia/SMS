"""
Regression coverage for the write guard added in 1957b16:
apps.timetable.services.refuse_if_timetable_is_live(*, timetable_id), wired into six write
endpoints in school/views/views_timetable.py plus the Celery task
orchestration/tasks.py::generate_timetable_task, so nothing can write to a Timetable whose
status == 'Published'. That commit had zero automated coverage before this file.

Fixture pattern is deliberately copied from school/tests/test_timetable_publish_api.py's
setUp (same import paths, same permission codes, same object-creation style) so this file is
consistent with the existing convention.
"""
import json
from datetime import date, time

from django.contrib.auth.models import User
from django.test import TestCase

from apps.academics.models import AcademicYear, ClassStream, ExamTerm, GradeLevel, Subject, TimeSlot
from apps.allocations.models import SubjectAllocation
from apps.identity.models import Permission, TeacherExtra
from apps.timetable.models import LessonAllocation, Timetable


class TimetableWriteGuardsTests(TestCase):
    def setUp(self):
        self.year = AcademicYear.objects.create(year='2026', is_active=True)
        self.term = ExamTerm.objects.create(
            name='Term 1', academic_year=self.year,
            start_date=date(2026, 1, 1), end_date=date(2026, 4, 1), is_active=True,
        )
        self.grade = GradeLevel.objects.create(name='Grade 8', numeric_order=8, curriculum_type='CBC')
        self.stream = ClassStream.objects.create(name='North', grade=self.grade)
        self.maths = Subject.objects.create(code='MAT101', name='Mathematics', is_core=True)
        teacher_user = User.objects.create_user(username='teacher_x', password='x')
        self.teacher = TeacherExtra.objects.create(user=teacher_user, mobile='0700000000', status=True)
        SubjectAllocation.objects.create(
            classroom=self.stream, subject=self.maths, teacher=self.teacher,
            academic_year=self.year, term=self.term, is_active=True,
        )

        # The live (Published) timetable every "refused" test writes against.
        self.live_timetable = Timetable.objects.create(
            name='Live Term', academic_year=self.year, term=self.term, status='Published', is_active=True,
        )

        for code in ('timetable.view', 'timetable.edit'):
            Permission.objects.get_or_create(code=code, defaults={'label': code, 'module': 'timetable'})
        self.admin = User.objects.create_user(username='admin_x', password='x', is_superuser=True, is_staff=True)
        self.client.force_login(self.admin)

    # ------------------------------------------------------------------
    # 1. api_save_lesson
    # ------------------------------------------------------------------
    def test_save_lesson_refused_on_a_live_timetable(self):
        slot = TimeSlot.objects.create(day='Monday', start_time=time(8, 0), end_time=time(8, 40))
        before = LessonAllocation.objects.count()

        response = self.client.post(
            '/api/timetable/save-lesson/',
            data=json.dumps({
                'timetable_id': self.live_timetable.id,
                'time_slot_id': slot.id,
                'class_stream_id': self.stream.id,
                'subject_id': self.maths.id,
                'teacher_id': self.teacher.id,
                'is_double_period': False,
            }),
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(LessonAllocation.objects.count(), before)

    # ------------------------------------------------------------------
    # 2. api_remove_lesson
    # ------------------------------------------------------------------
    def test_remove_lesson_refused_on_a_live_timetable(self):
        slot = TimeSlot.objects.create(day='Monday', start_time=time(9, 0), end_time=time(9, 40))
        lesson = LessonAllocation.objects.create(
            timetable=self.live_timetable, time_slot=slot, class_stream=self.stream,
            subject=self.maths, teacher=self.teacher,
        )

        response = self.client.delete(f'/api/timetable/remove-lesson/{lesson.id}/')

        self.assertEqual(response.status_code, 409)
        self.assertTrue(LessonAllocation.objects.filter(id=lesson.id).exists())

    # ------------------------------------------------------------------
    # 3. api_clear_grid
    # ------------------------------------------------------------------
    def test_clear_grid_refused_on_a_live_timetable(self):
        slot = TimeSlot.objects.create(day='Tuesday', start_time=time(8, 0), end_time=time(8, 40))
        lesson = LessonAllocation.objects.create(
            timetable=self.live_timetable, time_slot=slot, class_stream=self.stream,
            subject=self.maths, teacher=self.teacher,
        )

        response = self.client.delete(f'/api/timetable/clear-grid/{self.live_timetable.id}/')

        self.assertEqual(response.status_code, 409)
        self.assertTrue(LessonAllocation.objects.filter(id=lesson.id).exists())

    # ------------------------------------------------------------------
    # 4. api_auto_generate_timetable
    # ------------------------------------------------------------------
    def test_auto_generate_refused_on_a_live_timetable(self):
        before = LessonAllocation.objects.count()

        response = self.client.post(f'/api/timetable/auto-generate/{self.live_timetable.id}/?scope=all')

        self.assertEqual(response.status_code, 409)
        self.assertEqual(LessonAllocation.objects.count(), before)

    # ------------------------------------------------------------------
    # 5 & 6. api_manage_timeslots DELETE
    # ------------------------------------------------------------------
    def test_delete_timeslot_refused_when_it_has_lessons_on_a_live_timetable(self):
        slot = TimeSlot.objects.create(day='Wednesday', start_time=time(8, 0), end_time=time(8, 40))
        LessonAllocation.objects.create(
            timetable=self.live_timetable, time_slot=slot, class_stream=self.stream,
            subject=self.maths, teacher=self.teacher,
        )

        response = self.client.delete(
            '/api/timetable/manage-slots/', data=json.dumps({'id': slot.id}), content_type='application/json',
        )

        self.assertEqual(response.status_code, 409)
        self.assertTrue(TimeSlot.objects.filter(id=slot.id).exists())

    def test_delete_timeslot_with_no_live_lessons_still_succeeds(self):
        """Companion positive-path test: proves the guard in test 5 is genuinely conditional
        (only refuses because of a Published timetable's lessons), not an unconditional refusal."""
        slot = TimeSlot.objects.create(day='Thursday', start_time=time(8, 0), end_time=time(8, 40))
        draft_timetable = Timetable.objects.create(
            name='Draft Term', academic_year=self.year, term=self.term, status='Draft', is_active=False,
        )
        LessonAllocation.objects.create(
            timetable=draft_timetable, time_slot=slot, class_stream=self.stream,
            subject=self.maths, teacher=self.teacher,
        )

        response = self.client.delete(
            '/api/timetable/manage-slots/', data=json.dumps({'id': slot.id}), content_type='application/json',
        )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(TimeSlot.objects.filter(id=slot.id).exists())

    # ------------------------------------------------------------------
    # 7. api_manage_timetables (create) -- Fix 4 / I-1a
    # ------------------------------------------------------------------
    def test_create_timetable_ignores_a_client_supplied_published_status(self):
        response = self.client.post(
            '/api/timetable/manage-containers/',
            data=json.dumps({'name': 'Freshly Created', 'status': 'Published', 'is_active': False}),
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 200)
        created = Timetable.objects.get(name='Freshly Created')
        self.assertEqual(created.status, 'Draft')

    # ------------------------------------------------------------------
    # 8. api_update_timetable_status -- Fix 5 / I-1c
    # ------------------------------------------------------------------
    def test_update_status_rejects_an_invalid_status_value(self):
        target = Timetable.objects.create(
            name='Status Target', academic_year=self.year, term=self.term, status='Draft', is_active=False,
        )
        url = f'/api/timetable/update-status/{target.id}/'

        response = self.client.post(url, data=json.dumps({'status': 'published'}), content_type='application/json')
        self.assertEqual(response.status_code, 400)
        target.refresh_from_db()
        self.assertEqual(target.status, 'Draft')

        response = self.client.post(url, data=json.dumps({'status': None}), content_type='application/json')
        self.assertEqual(response.status_code, 400)
        target.refresh_from_db()
        self.assertEqual(target.status, 'Draft')
