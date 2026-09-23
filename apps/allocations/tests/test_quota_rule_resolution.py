from django.test import TestCase

from apps.academics.models import Curriculum, Department, Tier
from apps.allocations.models import QuotaDefaultRule
from apps.allocations.services import resolve_quota_default


class ResolveQuotaDefaultTests(TestCase):
    def setUp(self):
        self.curriculum = Curriculum.objects.create(name='CBC', code='CBC')
        self.junior = Tier.objects.create(curriculum=self.curriculum, name='Junior Secondary', code='JSS', display_order=1)
        self.sciences = Department.objects.create(name='Sciences', curriculum=self.curriculum)

    def test_tier_specific_rule_wins_over_grade_band_rule(self):
        QuotaDefaultRule.objects.create(
            department=self.sciences, grade_band='JUNIOR_SECONDARY', applies_when_blocked=False,
            total_lessons=5, double_lessons_required=1, remedial_lessons_required=1,
        )
        tier_rule = QuotaDefaultRule.objects.create(
            department=self.sciences, tier=self.junior, grade_band='JUNIOR_SECONDARY',
            applies_when_blocked=False, total_lessons=6, double_lessons_required=2,
            remedial_lessons_required=1, trim_priority=1,
        )
        result = resolve_quota_default(
            department_id=self.sciences.id, tier_id=self.junior.id,
            grade_band='JUNIOR_SECONDARY', applies_when_blocked=False,
        )
        self.assertEqual(result.id, tier_rule.id)
        self.assertEqual(result.total_lessons, 6)

    def test_falls_back_to_legacy_grade_band_rule_when_no_tier_rule_exists(self):
        band_rule = QuotaDefaultRule.objects.create(
            department=self.sciences, grade_band='JUNIOR_SECONDARY', applies_when_blocked=False,
            total_lessons=5, double_lessons_required=1, remedial_lessons_required=1,
        )
        result = resolve_quota_default(
            department_id=self.sciences.id, tier_id=self.junior.id,
            grade_band='JUNIOR_SECONDARY', applies_when_blocked=False,
        )
        self.assertEqual(result.id, band_rule.id)

    def test_falls_back_to_any_department_tier_rule(self):
        wildcard_rule = QuotaDefaultRule.objects.create(
            department=None, tier=self.junior, grade_band='JUNIOR_SECONDARY',
            applies_when_blocked=True, total_lessons=5, double_lessons_required=2,
            remedial_lessons_required=0,
        )
        result = resolve_quota_default(
            department_id=self.sciences.id, tier_id=self.junior.id,
            grade_band='JUNIOR_SECONDARY', applies_when_blocked=True,
        )
        self.assertEqual(result.id, wildcard_rule.id)

    def test_returns_none_when_nothing_matches(self):
        result = resolve_quota_default(
            department_id=self.sciences.id, tier_id=self.junior.id,
            grade_band='JUNIOR_SECONDARY', applies_when_blocked=False,
        )
        self.assertIsNone(result)

    def test_default_trim_priority_is_two(self):
        rule = QuotaDefaultRule.objects.create(
            department=self.sciences, grade_band='JUNIOR_SECONDARY', applies_when_blocked=False,
            total_lessons=5,
        )
        self.assertEqual(rule.trim_priority, 2)
