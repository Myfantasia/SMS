from django.test import TestCase

from apps.academics.models import (
    Curriculum, Tier, Department, Subject, SubjectCurriculumProfile,
)
from school.views.class_views import _eligible_subjects_for


class EligibleSubjectsForTests(TestCase):
    """
    Covers _eligible_subjects_for's tier-scoping: a subject with no profile rows is always
    eligible (legacy/shared); a subject with only curriculum-wide (tier=None) rows is eligible
    in every tier of that curriculum; and — the regression this file exists for — a subject
    that has BOTH a curriculum-wide row (used purely to carry its Department, per
    SubjectCurriculumProfile.department's own docstring) AND one or more tier-specific rows
    must be narrowed to just those tiers, not leak into every tier just because the
    department-only row exists. Real-world case: History & Citizenship and General Science
    (Senior-Secondary-only per the CBC dossier) were leaking into Upper Primary because of
    this before the fix.
    """

    @classmethod
    def setUpTestData(cls):
        cls.curriculum = Curriculum.objects.create(code='CBC3', name='CBC (eligibility test)')
        cls.upper_primary = Tier.objects.create(curriculum=cls.curriculum, name='Upper Primary', code='UP')
        cls.senior_secondary = Tier.objects.create(curriculum=cls.curriculum, name='Senior Secondary', code='SSS')
        cls.humanities = Department.objects.create(name='Humanities & RE (test)', curriculum=cls.curriculum, is_active=True)

        cls.no_profile_subject = Subject.objects.create(code='NPS101', name='No Profile Subject', is_core=True)

        cls.curriculum_wide_subject = Subject.objects.create(code='CWS101', name='Curriculum Wide Subject', is_core=True)
        SubjectCurriculumProfile.objects.create(subject=cls.curriculum_wide_subject, curriculum=cls.curriculum, tier=None)

        cls.history = Subject.objects.create(code='HIST101', name='History & Citizenship', is_core=False)
        SubjectCurriculumProfile.objects.create(
            subject=cls.history, curriculum=cls.curriculum, tier=None, department=cls.humanities)
        SubjectCurriculumProfile.objects.create(
            subject=cls.history, curriculum=cls.curriculum, tier=cls.senior_secondary)

    def _names(self, tier):
        return {s.name for s, *_ in _eligible_subjects_for(self.curriculum, tier)}

    def test_subject_with_no_profile_rows_is_eligible_everywhere(self):
        self.assertIn('No Profile Subject', self._names(self.upper_primary))
        self.assertIn('No Profile Subject', self._names(self.senior_secondary))

    def test_curriculum_wide_only_subject_is_eligible_everywhere(self):
        self.assertIn('Curriculum Wide Subject', self._names(self.upper_primary))
        self.assertIn('Curriculum Wide Subject', self._names(self.senior_secondary))

    def test_tier_specific_subject_does_not_leak_into_other_tiers(self):
        self.assertNotIn('History & Citizenship', self._names(self.upper_primary))

    def test_tier_specific_subject_is_eligible_in_its_own_tier(self):
        self.assertIn('History & Citizenship', self._names(self.senior_secondary))
