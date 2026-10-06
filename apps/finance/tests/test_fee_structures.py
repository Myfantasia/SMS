from django.contrib.auth.models import User
from django.db import IntegrityError
from django.test import TestCase

from apps.academics.models import AcademicYear, ExamTerm, GradeLevel, Curriculum, Tier
from apps.identity.models import StudentExtra
from apps.finance.models_fees import FeeCategory, FeeStructure, FeeStructureItem, StudentFeeItemEnrollment


class FeeStructureTestData:
    """Shared setup — minimal real objects for the academics FKs FeeStructure needs."""

    @classmethod
    def setUpTestData(cls):
        cls.curriculum = Curriculum.objects.create(name='CBC')
        cls.tier = Tier.objects.create(name='Junior School', curriculum=cls.curriculum)
        cls.grade = GradeLevel.objects.create(
            name='Grade 7', numeric_order=7, curriculum_type='CBC',
            curriculum=cls.curriculum, tier=cls.tier,
        )
        cls.year = AcademicYear.objects.create(year='2026', is_active=True)
        cls.term = ExamTerm.objects.create(
            name='Term 2', academic_year=cls.year,
            start_date='2026-05-01', end_date='2026-08-01',
        )
        cls.tuition = FeeCategory.objects.create(name='Tuition')
        cls.transport = FeeCategory.objects.create(name='Transport')


class FeeStructureTests(FeeStructureTestData, TestCase):
    def test_can_create_structure_for_grade_and_term(self):
        structure = FeeStructure.objects.create(
            grade_level=self.grade, term=self.term, name='Grade 7 - Term 2 2026',
        )
        self.assertEqual(structure.status, 'draft')

    def test_only_one_structure_per_grade_and_term(self):
        FeeStructure.objects.create(grade_level=self.grade, term=self.term, name='First')
        with self.assertRaises(IntegrityError):
            FeeStructure.objects.create(grade_level=self.grade, term=self.term, name='Duplicate')


class FeeStructureItemTests(FeeStructureTestData, TestCase):
    def setUp(self):
        self.structure = FeeStructure.objects.create(
            grade_level=self.grade, term=self.term, name='Grade 7 - Term 2 2026',
        )

    def test_mandatory_item_defaults_not_optional(self):
        item = FeeStructureItem.objects.create(
            fee_structure=self.structure, category=self.tuition, amount=15000,
        )
        self.assertFalse(item.is_optional)

    def test_optional_item_flag(self):
        item = FeeStructureItem.objects.create(
            fee_structure=self.structure, category=self.transport, amount=3000, is_optional=True,
        )
        self.assertTrue(item.is_optional)


class StudentFeeItemEnrollmentTests(FeeStructureTestData, TestCase):
    def setUp(self):
        self.structure = FeeStructure.objects.create(
            grade_level=self.grade, term=self.term, name='Grade 7 - Term 2 2026',
        )
        self.transport_item = FeeStructureItem.objects.create(
            fee_structure=self.structure, category=self.transport, amount=3000, is_optional=True,
        )
        user = User.objects.create_user(username='student_a', password='x')
        self.student = StudentExtra.objects.create(user=user)

    def test_can_enroll_student_in_optional_item(self):
        enrollment = StudentFeeItemEnrollment.objects.create(
            student=self.student, fee_structure_item=self.transport_item,
        )
        self.assertEqual(enrollment.student, self.student)

    def test_duplicate_enrollment_rejected(self):
        StudentFeeItemEnrollment.objects.create(
            student=self.student, fee_structure_item=self.transport_item,
        )
        with self.assertRaises(IntegrityError):
            StudentFeeItemEnrollment.objects.create(
                student=self.student, fee_structure_item=self.transport_item,
            )
