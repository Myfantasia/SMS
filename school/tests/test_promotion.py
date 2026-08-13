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


from django.contrib.auth.models import User

from apps.identity.models import StudentExtra
from apps.students.models import NationalExamRecord


class NationalExamRecordTests(TestCase):
    def setUp(self):
        self.curriculum = Curriculum.objects.create(code='CBC4', name='CBC (exam record test)')
        self.tier = Tier.objects.create(curriculum=self.curriculum, name='Junior Secondary', code='JSS4')
        self.grade9 = GradeLevel.objects.create(name='Grade 9Z', numeric_order=9, curriculum=self.curriculum, tier=self.tier)
        self.stream = ClassStream.objects.create(name='Central', grade=self.grade9)
        self.user = User.objects.create_user(username='exam_record_student', password='x')
        self.student = StudentExtra.objects.create(user=self.user, roll='EX01', cl=self.stream, status=True)
        self.year = AcademicYear.objects.create(year='2097')

    def test_can_record_a_national_exam(self):
        record = NationalExamRecord.objects.create(
            student=self.student, exam_code='KJSEA', academic_year=self.year, destination='Alliance High School',
        )
        self.assertEqual(record.destination, 'Alliance High School')
        self.assertIsNotNone(record.recorded_at)

    def test_one_record_per_student_exam_year(self):
        NationalExamRecord.objects.create(student=self.student, exam_code='KJSEA', academic_year=self.year)
        with self.assertRaises(Exception):
            NationalExamRecord.objects.create(student=self.student, exam_code='KJSEA', academic_year=self.year)


class StudentExtraGraduatedStateTests(TestCase):
    def test_graduated_is_a_valid_enrollment_state(self):
        codes = dict(StudentExtra.ENROLLMENT_STATUS_CHOICES)
        self.assertIn('Graduated', codes)


class AuditLogPromoteActionTests(TestCase):
    def test_promote_is_a_valid_action_type(self):
        from apps.core.models import SystemAuditLog
        codes = dict(SystemAuditLog.ACTION_CHOICES)
        self.assertIn('PROMOTE', codes)


from apps.academics.models import Pathway, Track, PresetCombination, Subject
from apps.students.models import StudentSubjectEnrollment
from school.views.subject_views import _ensure_core_mathematics


class EnsureCoreMathematicsTests(TestCase):
    def setUp(self):
        self.curriculum = Curriculum.objects.create(code='CBC5', name='CBC (core math test)')
        self.tier = Tier.objects.create(curriculum=self.curriculum, name='Senior Secondary', code='SSS5')
        self.grade10 = GradeLevel.objects.create(name='Grade 10Z', numeric_order=10, curriculum=self.curriculum, tier=self.tier)
        self.stream = ClassStream.objects.create(name='Gold', grade=self.grade10)
        self.user = User.objects.create_user(username='core_math_student', password='x')
        self.student = StudentExtra.objects.create(user=self.user, roll='CM01', cl=self.stream, status=True)
        self.year = AcademicYear.objects.create(year='2096')

        self.pathway = Pathway.objects.create(curriculum=self.curriculum, name='STEM')
        self.track = Track.objects.create(pathway=self.pathway, name='Applied Sciences')

        # Real catalog codes, not test-local ones — _ensure_core_mathematics matches on these
        # exact codes, and Django's test runner gives every test a fresh empty database, so
        # there's no clash with the dev DB's seeded AMAT/CMAT/EMAT rows (id 87/86/88 there).
        self.amat = Subject.objects.create(code='AMAT', name='Advanced Mathematics')
        self.cmat = Subject.objects.create(code='CMAT', name='Core Mathematics')
        self.emat = Subject.objects.create(code='EMAT', name='Essential Mathematics')
        self.physics = Subject.objects.create(code='PHYZ', name='Physics Z')
        self.chem = Subject.objects.create(code='CHEZ', name='Chemistry Z')
        self.bio = Subject.objects.create(code='BIOZ', name='Biology Z')

    def test_adds_essential_maths_when_combo_has_no_maths(self):
        combo = PresetCombination.objects.create(track=self.track, name='No-Maths Combo', code='NM')
        combo.subjects.set([self.physics, self.chem, self.bio])

        _ensure_core_mathematics(self.student, combo, self.year)

        enrollment = StudentSubjectEnrollment.objects.get(student=self.student, subject=self.emat, academic_year=self.year)
        self.assertEqual(enrollment.status, 'Approved')

    def test_does_not_add_essential_maths_when_combo_has_advanced_maths(self):
        combo = PresetCombination.objects.create(track=self.track, name='AMAT Combo', code='AM')
        combo.subjects.set([self.amat, self.physics, self.chem])

        _ensure_core_mathematics(self.student, combo, self.year)

        self.assertFalse(
            StudentSubjectEnrollment.objects.filter(student=self.student, subject=self.emat, academic_year=self.year).exists()
        )

    def test_does_not_add_essential_maths_when_combo_has_core_maths(self):
        combo = PresetCombination.objects.create(track=self.track, name='CMAT Combo', code='CM')
        combo.subjects.set([self.cmat, self.physics, self.chem])

        _ensure_core_mathematics(self.student, combo, self.year)

        self.assertFalse(
            StudentSubjectEnrollment.objects.filter(student=self.student, subject=self.emat, academic_year=self.year).exists()
        )

    def test_idempotent_on_repeat_calls(self):
        combo = PresetCombination.objects.create(track=self.track, name='No-Maths Combo 2', code='NM2')
        combo.subjects.set([self.physics, self.chem, self.bio])

        _ensure_core_mathematics(self.student, combo, self.year)
        _ensure_core_mathematics(self.student, combo, self.year)

        self.assertEqual(
            StudentSubjectEnrollment.objects.filter(student=self.student, subject=self.emat, academic_year=self.year).count(), 1
        )
