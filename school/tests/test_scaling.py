from decimal import Decimal

from django.test import TestCase

from school.tests.base import ExamTestDataMixin
from school.utils import get_scaled_score, calculate_dynamic_grade


class GetScaledScoreTests(ExamTestDataMixin, TestCase):
    """
    Covers the fix replacing the old `'cat 1' in exam.name.lower()` hardcoded x2 multiplier:
    scaling must be driven entirely by each exam's own total_marks, regardless of its name.
    """

    def test_scales_below_100_total_to_percentage(self):
        # CAT 1 is out of 50 — a raw 38 should scale to 76%, matching the real deflation bug
        # found in production data (student scored 76% but the old code stored 25.33%).
        self.assertEqual(get_scaled_score(Decimal('38'), self.cat1), Decimal('76.00'))

    def test_leaves_100_total_unchanged(self):
        self.assertEqual(get_scaled_score(Decimal('77'), self.cat2), Decimal('77.00'))

    def test_returns_none_for_none_input(self):
        self.assertIsNone(get_scaled_score(None, self.cat1))

    def test_scaling_is_not_tied_to_exam_name(self):
        # An exam NOT literally named "cat 1" but still out of 50 must scale identically —
        # the old code only scaled when the name matched "cat 1", leaving any other
        # non-100-mark exam completely unscaled.
        self.cat1.name = 'First Continuous Assessment'
        self.cat1.save()
        self.assertEqual(get_scaled_score(Decimal('38'), self.cat1), Decimal('76.00'))


class CalculateDynamicGradeTests(ExamTestDataMixin, TestCase):
    """
    Covers the curriculum-mismatch bug: calculate_dynamic_grade() must be called with the
    student's real curriculum_type, or CBC students get 8-4-4 letter grades instead of
    EE/ME/AE/BE rubric labels.
    """

    def test_same_score_different_label_per_curriculum(self):
        self.assertEqual(calculate_dynamic_grade(76, '8-4-4'), 'A-')
        self.assertEqual(calculate_dynamic_grade(76, 'CBC'), 'EE')

    def test_defaults_to_8_4_4_when_unspecified(self):
        self.assertEqual(calculate_dynamic_grade(76), 'A-')
