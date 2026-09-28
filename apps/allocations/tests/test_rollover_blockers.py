from datetime import date

from django.test import TestCase

from apps.academics.models import AcademicYear, ClassStream, ExamTerm, GradeLevel, Subject
from apps.allocations.models import AllocationPublishState, GlobalAllocationPolicy, SubjectAllocation
from apps.allocations.services import AllocationValidationError, rollover_allocations
from apps.identity.models import TeacherExtra
from django.contrib.auth.models import User


class RolloverAllocationsBlockerTests(TestCase):
    def setUp(self):
        self.year = AcademicYear.objects.create(year='2026', is_active=True)
        self.source_term = ExamTerm.objects.create(
            name='Term 1', academic_year=self.year,
            start_date=date(2026, 1, 1), end_date=date(2026, 4, 1), is_active=True,
        )
        self.target_term = ExamTerm.objects.create(
            name='Term 2', academic_year=self.year,
            start_date=date(2026, 5, 1), end_date=date(2026, 8, 1), is_active=False,
        )
        self.grade = GradeLevel.objects.create(name='Grade 8', numeric_order=8, curriculum_type='CBC')
        self.stream = ClassStream.objects.create(name='North', grade=self.grade)

        self.maths = Subject.objects.create(code='MAT101', name='Mathematics', is_core=True)
        self.english = Subject.objects.create(code='ENG101', name='English', is_core=True)
        self.kiswahili = Subject.objects.create(code='KIS101', name='Kiswahili', is_core=True)

        policy = GlobalAllocationPolicy.load()
        self.assertEqual(policy.max_subjects_per_class, 2)  # the default this test relies on

        user = User.objects.create_user(username='teacher_test', password='x')
        self.teacher = TeacherExtra.objects.create(user=user, mobile='0700000000', status=True)

        for subject in (self.maths, self.english, self.kiswahili):
            SubjectAllocation.objects.create(
                classroom=self.stream, subject=subject, teacher=self.teacher,
                academic_year=self.year, term=self.source_term, is_active=True,
            )

    def test_hard_error_message_text_is_unchanged_when_rollover_exceeds_a_cap(self):
        with self.assertRaises(AllocationValidationError) as ctx:
            rollover_allocations(
                source_term_id=self.source_term.id, target_term_id=self.target_term.id,
                year_id=self.year.id, source_year_id=self.year.id,
                class_id=self.stream.id, operator_id=None,
            )
        self.assertIn('exceeded max subjects', str(ctx.exception))


class RolloverLeavesDraftsTests(TestCase):
    def test_rolled_over_classes_are_drafts_not_published(self):
        year = AcademicYear.objects.create(year='2026', is_active=True)
        source = ExamTerm.objects.create(name='Term 1', academic_year=year,
                                         start_date=date(2026, 1, 1), end_date=date(2026, 4, 1), is_active=True)
        target = ExamTerm.objects.create(name='Term 2', academic_year=year,
                                         start_date=date(2026, 5, 1), end_date=date(2026, 8, 1), is_active=False)
        grade = GradeLevel.objects.create(name='Grade 8', numeric_order=8, curriculum_type='CBC')
        stream = ClassStream.objects.create(name='North', grade=grade)
        maths = Subject.objects.create(code='MAT101', name='Mathematics', is_core=True)
        user = User.objects.create_user(username='teacher_only', password='x')
        teacher = TeacherExtra.objects.create(user=user, mobile='0700000000', status=True)
        SubjectAllocation.objects.create(classroom=stream, subject=maths, teacher=teacher,
                                         academic_year=year, term=source, is_active=True)

        result = rollover_allocations(
            source_term_id=source.id, target_term_id=target.id, year_id=year.id,
            source_year_id=year.id, class_id=stream.id, operator_id=None)

        self.assertEqual(result.new_allocation_count, 1)
        self.assertTrue(SubjectAllocation.objects.filter(classroom=stream, term=target).exists())
        self.assertFalse(AllocationPublishState.objects.filter(classroom=stream, is_published=True).exists())
