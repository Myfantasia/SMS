from django.test import TestCase
from django.utils import timezone

from apps.academics.models import (
    Curriculum, Tier, GradeLevel, ClassStream, AcademicYear, ExamTerm, next_grade_level, get_or_create_class_stream,
)


class TierExitExamFieldsTests(TestCase):
    def setUp(self):
        self.curriculum = Curriculum.objects.create(code='CBC', name='Competency Based Curriculum')

    def test_exit_exam_code_blank_by_default(self):
        tier = Tier.objects.create(curriculum=self.curriculum, name='Lower Primary', code='LP')
        self.assertEqual(tier.exit_exam_code, '')
        self.assertFalse(tier.exit_is_terminal)

    def test_exit_exam_code_accepts_kjsea(self):
        tier = Tier.objects.create(
            curriculum=self.curriculum, name='Junior Secondary', code='JSS',
            exit_exam_code='KJSEA', exit_is_terminal=True,
        )
        self.assertEqual(tier.exit_exam_code, 'KJSEA')
        self.assertTrue(tier.exit_is_terminal)


class NextGradeLevelTests(TestCase):
    def setUp(self):
        self.curriculum = Curriculum.objects.create(code='CBC2', name='CBC (promotion test)')
        self.tier = Tier.objects.create(curriculum=self.curriculum, name='Upper Primary', code='UP')
        self.grade4 = GradeLevel.objects.create(name='Grade 4Z', numeric_order=4, curriculum=self.curriculum, tier=self.tier)
        self.grade5 = GradeLevel.objects.create(name='Grade 5Z', numeric_order=5, curriculum=self.curriculum, tier=self.tier)

    def test_returns_next_higher_numeric_order_grade(self):
        self.assertEqual(next_grade_level(self.grade4).id, self.grade5.id)

    def test_returns_none_for_highest_grade(self):
        self.assertIsNone(next_grade_level(self.grade5))

    def test_returns_none_for_none_grade(self):
        self.assertIsNone(next_grade_level(None))


class GetOrCreateClassStreamTests(TestCase):
    def setUp(self):
        curriculum = Curriculum.objects.create(code='CBC3', name='CBC (stream test)')
        tier = Tier.objects.create(curriculum=curriculum, name='Junior Secondary', code='JSS3')
        self.grade7 = GradeLevel.objects.create(name='Grade 7Z', numeric_order=7, curriculum=curriculum, tier=tier)
        self.grade8 = GradeLevel.objects.create(name='Grade 8Z', numeric_order=8, curriculum=curriculum, tier=tier)
        self.existing = ClassStream.objects.create(name='Central', grade=self.grade8)

    def test_returns_existing_stream_by_name(self):
        stream = get_or_create_class_stream(self.grade8, 'Central')
        self.assertEqual(stream.id, self.existing.id)

    def test_creates_stream_when_missing(self):
        stream = get_or_create_class_stream(self.grade7, 'Central')
        self.assertNotEqual(stream.id, self.existing.id)
        self.assertEqual(stream.grade_id, self.grade7.id)
        self.assertEqual(stream.capacity, 40)


class ExamTermFinalizationFieldsTests(TestCase):
    def test_defaults_to_not_finalized(self):
        year = AcademicYear.objects.create(year='2099')
        term = ExamTerm.objects.create(name='Term 1', academic_year=year, start_date='2099-01-01', end_date='2099-04-01')
        self.assertFalse(term.results_finalized)
        self.assertIsNone(term.results_finalized_at)

    def test_can_be_finalized(self):
        year = AcademicYear.objects.create(year='2098')
        term = ExamTerm.objects.create(
            name='Term 1', academic_year=year, start_date='2098-01-01', end_date='2098-04-01',
            results_finalized=True, results_finalized_at=timezone.now(),
        )
        self.assertTrue(term.results_finalized)
        self.assertIsNotNone(term.results_finalized_at)
