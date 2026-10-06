"""Trash purge of a student with fee history: the PROTECT references from finance must
turn into a skip result, not a ProtectedError that aborts the auto-purge sweep.

Needs no StudentFeeAdjustment rows, but the purge's delete collector still walks that
relation, so these tests run after the user's migration like the rest of this package."""
from django.contrib.auth.models import User
from django.test import TestCase

from apps.academics.models import AcademicYear, Curriculum, ExamTerm, GradeLevel, Tier
from apps.core.trash import PurgeSkipped
from apps.finance.models_fees import FeeCategory, FeeStructure, FeeStructureItem
from apps.finance.services_fees import generate_invoice_for_student
from apps.identity.models import StudentExtra
from apps.identity.models import _purge_student


class PurgeStudentWithFinancialRecordsTests(TestCase):
    def setUp(self):
        curriculum = Curriculum.objects.create(name='CBC')
        tier = Tier.objects.create(name='Junior School', curriculum=curriculum)
        grade = GradeLevel.objects.create(
            name='Grade 7', numeric_order=7, curriculum_type='CBC', curriculum=curriculum, tier=tier,
        )
        year = AcademicYear.objects.create(year='2026', is_active=True)
        term = ExamTerm.objects.create(name='Term 2', academic_year=year, start_date='2026-05-01', end_date='2026-08-01')
        self.structure = FeeStructure.objects.create(grade_level=grade, term=term, name='Grade 7 - Term 2 2026')
        FeeStructureItem.objects.create(fee_structure=self.structure, category=FeeCategory.objects.create(name='Tuition'), amount=15000)
        self.operator = User.objects.create_user(username='purge_operator', password='x')

    def test_student_with_fee_history_is_skipped_not_raised(self):
        user = User.objects.create_user(username='purge_student_fees', password='x', is_active=False)
        student = StudentExtra.objects.create(user=user, roll='PURGE-1')
        generate_invoice_for_student(student=student, fee_structure=self.structure, operator=self.operator)

        result = _purge_student(student)

        self.assertIsInstance(result, PurgeSkipped)
        self.assertFalse(result)
        self.assertEqual(result.reason, 'has_financial_records')
        self.assertTrue(User.objects.filter(pk=user.pk).exists())
        self.assertTrue(StudentExtra.objects.filter(pk=student.pk).exists())

    def test_student_without_fee_history_is_purged(self):
        user = User.objects.create_user(username='purge_student_clean', password='x', is_active=False)
        student = StudentExtra.objects.create(user=user, roll='PURGE-2')

        result = _purge_student(student)

        self.assertIsNone(result)
        self.assertFalse(User.objects.filter(pk=user.pk).exists())
