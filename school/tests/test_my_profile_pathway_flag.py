from django.test import TestCase
from django.urls import reverse

from apps.academics.models import Curriculum, Tier, GradeLevel, ClassStream, Pathway
from apps.students.models import StudentPathwaySelection
from school.tests.base import ExamTestDataMixin


class MyProfileRequiresPathwayChoiceTests(ExamTestDataMixin, TestCase):
    """
    api_my_profile is what DashboardLayouts.tsx/Menu.tsx use to decide whether a student sees
    the "My Pathway" menu item -- only Grade 10 (the entry grade of a pathway-choice tier)
    should get requires_pathway_choice: true.
    """

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.curriculum = Curriculum.objects.create(code='CBC4', name='CBC (my-profile test)')
        cls.sss_tier = Tier.objects.create(curriculum=cls.curriculum, name='Senior Secondary', code='SSS')
        cls.grade10 = GradeLevel.objects.create(name='Grade 10Y', numeric_order=10, curriculum=cls.curriculum, tier=cls.sss_tier)
        cls.grade11 = GradeLevel.objects.create(name='Grade 11Y', numeric_order=11, curriculum=cls.curriculum, tier=cls.sss_tier)
        cls.stream10 = ClassStream.objects.create(name='A', grade=cls.grade10)
        cls.stream11 = ClassStream.objects.create(name='A', grade=cls.grade11)

    def test_grade10_student_requires_pathway_choice(self):
        self.student.cl = self.stream10
        self.student.save()
        self.client.force_login(self.student_user)
        response = self.client.get(reverse('api_my_profile'))
        self.assertEqual(response.json()['data']['requires_pathway_choice'], True)
        self.assertEqual(response.json()['data']['role'], 'Student')

    def test_grade11_student_does_not_require_pathway_choice(self):
        self.student.cl = self.stream11
        self.student.save()
        self.client.force_login(self.student_user)
        response = self.client.get(reverse('api_my_profile'))
        self.assertEqual(response.json()['data']['requires_pathway_choice'], False)

    def test_non_student_defaults_to_false(self):
        self.client.force_login(self.admin_user)
        response = self.client.get(reverse('api_my_profile'))
        self.assertEqual(response.json()['data']['requires_pathway_choice'], False)

    def test_grade10_student_with_approved_selection_no_longer_requires_choice(self):
        """Once a Grade 10 student's pathway is Approved, 'My Pathway' should stop appearing
        in the menu (nothing left to choose) -- distinct from the entry-grade gate above,
        which only looks at the grade, not whether a choice was already made."""
        self.student.cl = self.stream10
        self.student.save()
        pathway = Pathway.objects.create(curriculum=self.curriculum, name='STEM')
        StudentPathwaySelection.objects.create(
            student=self.student, pathway=pathway, academic_year=self.year, status='Approved')
        self.client.force_login(self.student_user)
        response = self.client.get(reverse('api_my_profile'))
        self.assertEqual(response.json()['data']['requires_pathway_choice'], False)

    def test_grade10_student_with_pending_selection_still_requires_choice(self):
        """A Pending (not-yet-approved) request must keep the menu item visible -- the
        student may still want to withdraw/change it via the same page."""
        self.student.cl = self.stream10
        self.student.save()
        pathway = Pathway.objects.create(curriculum=self.curriculum, name='STEM')
        StudentPathwaySelection.objects.create(
            student=self.student, pathway=pathway, academic_year=self.year, status='Pending')
        self.client.force_login(self.student_user)
        response = self.client.get(reverse('api_my_profile'))
        self.assertEqual(response.json()['data']['requires_pathway_choice'], True)
