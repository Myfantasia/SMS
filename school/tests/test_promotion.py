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
    """
    Math assignment is fully automatic and pathway-aware (never a student pick — see
    SYSTEM_MANAGED_MATH_CODES in subject_views.py): a STEM student whose combo omits both
    Advanced Mathematics (AMAT) and Core Mathematics (CMAT) gets CMAT auto-added; a student on
    any other pathway gets Essential Mathematics (EMAT) instead. AMAT/CMAT already present in
    the combo itself always means no-op (student's chosen maths already satisfies it).
    """

    def setUp(self):
        self.curriculum = Curriculum.objects.create(code='CBC5', name='CBC (core math test)')
        self.tier = Tier.objects.create(curriculum=self.curriculum, name='Senior Secondary', code='SSS5')
        self.grade10 = GradeLevel.objects.create(name='Grade 10Z', numeric_order=10, curriculum=self.curriculum, tier=self.tier)
        self.stream = ClassStream.objects.create(name='Gold', grade=self.grade10)
        self.user = User.objects.create_user(username='core_math_student', password='x')
        self.student = StudentExtra.objects.create(user=self.user, roll='CM01', cl=self.stream, status=True)
        self.year = AcademicYear.objects.create(year='2096')

        self.stem_pathway = Pathway.objects.create(curriculum=self.curriculum, name='STEM')
        self.stem_track = Track.objects.create(pathway=self.stem_pathway, name='Applied Sciences')
        self.other_pathway = Pathway.objects.create(curriculum=self.curriculum, name='Social Sciences')
        self.other_track = Track.objects.create(pathway=self.other_pathway, name='Humanities & Business Studies')

        # Real catalog codes, not test-local ones — _ensure_core_mathematics matches on these
        # exact codes, and Django's test runner gives every test a fresh empty database, so
        # there's no clash with the dev DB's seeded AMAT/CMAT/EMAT rows (id 87/86/88 there).
        self.amat = Subject.objects.create(code='AMAT', name='Advanced Mathematics')
        self.cmat = Subject.objects.create(code='CMAT', name='Core Mathematics')
        self.emat = Subject.objects.create(code='EMAT', name='Essential Mathematics')
        self.physics = Subject.objects.create(code='PHYZ', name='Physics Z')
        self.chem = Subject.objects.create(code='CHEZ', name='Chemistry Z')
        self.bio = Subject.objects.create(code='BIOZ', name='Biology Z')

    def test_stem_combo_with_no_maths_gets_core_maths(self):
        combo = PresetCombination.objects.create(track=self.stem_track, name='No-Maths Combo', code='NM')
        combo.subjects.set([self.physics, self.chem, self.bio])

        _ensure_core_mathematics(self.student, combo, self.year)

        enrollment = StudentSubjectEnrollment.objects.get(student=self.student, subject=self.cmat, academic_year=self.year)
        self.assertEqual(enrollment.status, 'Approved')
        self.assertFalse(
            StudentSubjectEnrollment.objects.filter(student=self.student, subject=self.emat, academic_year=self.year).exists()
        )

    def test_non_stem_combo_with_no_maths_gets_essential_maths(self):
        combo = PresetCombination.objects.create(track=self.other_track, name='No-Maths Combo', code='NM3')
        combo.subjects.set([self.physics, self.chem, self.bio])

        _ensure_core_mathematics(self.student, combo, self.year)

        enrollment = StudentSubjectEnrollment.objects.get(student=self.student, subject=self.emat, academic_year=self.year)
        self.assertEqual(enrollment.status, 'Approved')
        self.assertFalse(
            StudentSubjectEnrollment.objects.filter(student=self.student, subject=self.cmat, academic_year=self.year).exists()
        )

    def test_does_not_add_maths_when_combo_has_advanced_maths(self):
        combo = PresetCombination.objects.create(track=self.stem_track, name='AMAT Combo', code='AM')
        combo.subjects.set([self.amat, self.physics, self.chem])

        _ensure_core_mathematics(self.student, combo, self.year)

        self.assertFalse(
            StudentSubjectEnrollment.objects.filter(
                student=self.student, subject__in=[self.cmat, self.emat], academic_year=self.year).exists()
        )

    def test_does_not_add_maths_when_combo_has_core_maths(self):
        combo = PresetCombination.objects.create(track=self.stem_track, name='CMAT Combo', code='CM')
        combo.subjects.set([self.cmat, self.physics, self.chem])

        _ensure_core_mathematics(self.student, combo, self.year)

        self.assertFalse(
            StudentSubjectEnrollment.objects.filter(student=self.student, subject=self.emat, academic_year=self.year).exists()
        )

    def test_idempotent_on_repeat_calls(self):
        combo = PresetCombination.objects.create(track=self.stem_track, name='No-Maths Combo 2', code='NM2')
        combo.subjects.set([self.physics, self.chem, self.bio])

        _ensure_core_mathematics(self.student, combo, self.year)
        _ensure_core_mathematics(self.student, combo, self.year)

        self.assertEqual(
            StudentSubjectEnrollment.objects.filter(student=self.student, subject=self.cmat, academic_year=self.year).count(), 1
        )


from school.views.promotion_views import _determine_transition, results_finalized_for_year, _promote_student


class DetermineTransitionTests(TestCase):
    def setUp(self):
        self.curriculum = Curriculum.objects.create(code='CBC6', name='CBC (transition test)')

    def test_plain_when_no_exit_exam_code(self):
        tier = Tier.objects.create(curriculum=self.curriculum, name='Lower Primary', code='LP6')
        g3 = GradeLevel.objects.create(name='Grade 3Y', numeric_order=3, curriculum=self.curriculum, tier=tier)
        g4 = GradeLevel.objects.create(name='Grade 4Y', numeric_order=4, curriculum=self.curriculum, tier=Tier.objects.create(curriculum=self.curriculum, name='Upper Primary', code='UP6'))
        transition_type, exam_code, next_grade = _determine_transition(g3)
        self.assertEqual(transition_type, 'plain')
        self.assertIsNone(exam_code)
        self.assertEqual(next_grade.id, g4.id)

    def test_exam_gated_when_exit_exam_code_set_and_not_terminal(self):
        tier = Tier.objects.create(
            curriculum=self.curriculum, name='Upper Primary', code='UP6X',
            exit_exam_code='KPSEA', exit_is_terminal=False,
        )
        jss_tier = Tier.objects.create(curriculum=self.curriculum, name='Junior Secondary', code='JSS6X')
        g6 = GradeLevel.objects.create(name='Grade 6Y', numeric_order=6, curriculum=self.curriculum, tier=tier)
        g7 = GradeLevel.objects.create(name='Grade 7Y', numeric_order=7, curriculum=self.curriculum, tier=jss_tier)
        transition_type, exam_code, next_grade = _determine_transition(g6)
        self.assertEqual(transition_type, 'exam_gated')
        self.assertEqual(exam_code, 'KPSEA')
        self.assertEqual(next_grade.id, g7.id)

    def test_exit_when_terminal(self):
        tier = Tier.objects.create(
            curriculum=self.curriculum, name='Junior Secondary', code='JSS6Y',
            exit_exam_code='KJSEA', exit_is_terminal=True,
        )
        GradeLevel.objects.create(name='Grade 9Y', numeric_order=9, curriculum=self.curriculum, tier=tier)
        g9 = GradeLevel.objects.get(name='Grade 9Y')
        # A Grade 10 row exists elsewhere in the school's data, but must be ignored for 'exit'.
        other_tier = Tier.objects.create(curriculum=self.curriculum, name='Senior Secondary', code='SSS6Y')
        GradeLevel.objects.create(name='Grade 10Y', numeric_order=10, curriculum=self.curriculum, tier=other_tier)
        transition_type, exam_code, next_grade = _determine_transition(g9)
        self.assertEqual(transition_type, 'exit')
        self.assertEqual(exam_code, 'KJSEA')
        self.assertIsNone(next_grade)

    def test_plain_when_no_tier(self):
        g = GradeLevel.objects.create(name='Grade 1Y', numeric_order=1, curriculum=self.curriculum, tier=None)
        transition_type, exam_code, next_grade = _determine_transition(g)
        self.assertEqual(transition_type, 'plain')
        self.assertIsNone(exam_code)

    def test_plain_for_non_exit_grades_within_a_multi_grade_tier(self):
        """
        A Tier with exit_exam_code/exit_is_terminal set (as the plan's own Final Verification
        step instructs admins to configure per-tier, not per-grade — e.g. "Senior Secondary ->
        KCSE + terminal") must only gate its actual exit grade. Grades 10->11 and 11->12 inside a
        three-grade Senior Secondary tier must both stay 'plain', matching the design doc's
        transition table (Grade 8->9, 10->11, 11->12 are all listed as Plain) — only Grade 12,
        whose next grade falls outside the tier, is exam-gated/terminal.
        """
        tier = Tier.objects.create(
            curriculum=self.curriculum, name='Senior Secondary', code='SSS6Z',
            exit_exam_code='KCSE', exit_is_terminal=True,
        )
        g10 = GradeLevel.objects.create(name='Grade 10Z', numeric_order=10, curriculum=self.curriculum, tier=tier)
        g11 = GradeLevel.objects.create(name='Grade 11Z', numeric_order=11, curriculum=self.curriculum, tier=tier)
        g12 = GradeLevel.objects.create(name='Grade 12Z', numeric_order=12, curriculum=self.curriculum, tier=tier)

        transition_type, exam_code, next_grade = _determine_transition(g10)
        self.assertEqual(transition_type, 'plain')
        self.assertIsNone(exam_code)
        self.assertEqual(next_grade.id, g11.id)

        transition_type, exam_code, next_grade = _determine_transition(g11)
        self.assertEqual(transition_type, 'plain')
        self.assertIsNone(exam_code)
        self.assertEqual(next_grade.id, g12.id)

        transition_type, exam_code, next_grade = _determine_transition(g12)
        self.assertEqual(transition_type, 'exit')
        self.assertEqual(exam_code, 'KCSE')
        self.assertIsNone(next_grade)


class ResultsFinalizedForYearTests(TestCase):
    def test_false_when_no_terms(self):
        year = AcademicYear.objects.create(year='2095')
        self.assertFalse(results_finalized_for_year(year))

    def test_false_when_any_term_not_finalized(self):
        year = AcademicYear.objects.create(year='2094')
        ExamTerm.objects.create(name='Term 1', academic_year=year, start_date='2094-01-01', end_date='2094-04-01', results_finalized=True)
        ExamTerm.objects.create(name='Term 2', academic_year=year, start_date='2094-05-01', end_date='2094-08-01', results_finalized=False)
        self.assertFalse(results_finalized_for_year(year))

    def test_true_when_all_terms_finalized(self):
        year = AcademicYear.objects.create(year='2093')
        ExamTerm.objects.create(name='Term 1', academic_year=year, start_date='2093-01-01', end_date='2093-04-01', results_finalized=True)
        ExamTerm.objects.create(name='Term 2', academic_year=year, start_date='2093-05-01', end_date='2093-08-01', results_finalized=True)
        self.assertTrue(results_finalized_for_year(year))


class PromoteStudentTests(TestCase):
    def setUp(self):
        self.curriculum = Curriculum.objects.create(code='CBC7', name='CBC (promote test)')
        self.year = AcademicYear.objects.create(year='2092')

    def test_plain_promotion_held_when_results_not_finalized(self):
        tier = Tier.objects.create(curriculum=self.curriculum, name='Lower Primary', code='LP7')
        g1 = GradeLevel.objects.create(name='Grade 1X', numeric_order=1, curriculum=self.curriculum, tier=tier)
        GradeLevel.objects.create(name='Grade 2X', numeric_order=2, curriculum=self.curriculum, tier=tier)
        stream = ClassStream.objects.create(name='Central', grade=g1)
        user = User.objects.create_user(username='plain_promo_student', password='x')
        student = StudentExtra.objects.create(user=user, roll='PP01', cl=stream, status=True)
        ExamTerm.objects.create(name='Term 1', academic_year=self.year, start_date='2092-01-01', end_date='2092-04-01', results_finalized=False)

        result = _promote_student(student, self.year)
        self.assertEqual(result['outcome'], 'held')
        student.refresh_from_db()
        self.assertEqual(student.cl_id, stream.id)

    def test_plain_promotion_succeeds_when_results_finalized(self):
        tier = Tier.objects.create(curriculum=self.curriculum, name='Lower Primary', code='LP7B')
        g1 = GradeLevel.objects.create(name='Grade 1W', numeric_order=1, curriculum=self.curriculum, tier=tier)
        g2 = GradeLevel.objects.create(name='Grade 2W', numeric_order=2, curriculum=self.curriculum, tier=tier)
        stream = ClassStream.objects.create(name='Central', grade=g1)
        user = User.objects.create_user(username='plain_promo_student2', password='x')
        student = StudentExtra.objects.create(user=user, roll='PP02', cl=stream, status=True)
        ExamTerm.objects.create(name='Term 1', academic_year=self.year, start_date='2092-01-01', end_date='2092-04-01', results_finalized=True)

        result = _promote_student(student, self.year)
        self.assertEqual(result['outcome'], 'promoted')
        student.refresh_from_db()
        self.assertEqual(student.cl.grade_id, g2.id)
        self.assertEqual(student.cl.name, 'Central')

    def test_exam_gated_promotion_held_without_record(self):
        tier = Tier.objects.create(
            curriculum=self.curriculum, name='Upper Primary', code='UP7',
            exit_exam_code='KPSEA', exit_is_terminal=False,
        )
        jss_tier = Tier.objects.create(curriculum=self.curriculum, name='Junior Secondary', code='JSS7')
        g6 = GradeLevel.objects.create(name='Grade 6W', numeric_order=6, curriculum=self.curriculum, tier=tier)
        GradeLevel.objects.create(name='Grade 7W', numeric_order=7, curriculum=self.curriculum, tier=jss_tier)
        stream = ClassStream.objects.create(name='Central', grade=g6)
        user = User.objects.create_user(username='kpsea_student', password='x')
        student = StudentExtra.objects.create(user=user, roll='KP01', cl=stream, status=True)

        result = _promote_student(student, self.year)
        self.assertEqual(result['outcome'], 'held')

    def test_exit_transition_graduates_without_moving_class(self):
        tier = Tier.objects.create(
            curriculum=self.curriculum, name='Junior Secondary', code='JSS7B',
            exit_exam_code='KJSEA', exit_is_terminal=True,
        )
        g9 = GradeLevel.objects.create(name='Grade 9W', numeric_order=9, curriculum=self.curriculum, tier=tier)
        stream = ClassStream.objects.create(name='Central', grade=g9)
        user = User.objects.create_user(username='kjsea_student', password='x')
        student = StudentExtra.objects.create(user=user, roll='KJ01', cl=stream, status=True)
        NationalExamRecord.objects.create(
            student=student, exam_code='KJSEA', academic_year=self.year, destination='Alliance High School',
        )

        result = _promote_student(student, self.year)
        self.assertEqual(result['outcome'], 'graduated')
        student.refresh_from_db()
        self.assertEqual(student.enrollment_state, 'Graduated')
        self.assertEqual(student.cl_id, stream.id)  # cl untouched — cross-institution, no local reassignment

    def test_held_when_no_current_class(self):
        user = User.objects.create_user(username='no_class_student', password='x')
        student = StudentExtra.objects.create(user=user, roll='NC01', cl=None, status=True)
        result = _promote_student(student, self.year)
        self.assertEqual(result['outcome'], 'held')

    def test_internal_grade_of_gated_tier_promotes_plainly_without_exam_record(self):
        """
        Regression for the multi-grade-tier bug: a student in Grade 11 of a three-grade Senior
        Secondary tier configured with exit_exam_code='KCSE'/exit_is_terminal=True (exactly as
        the plan instructs admins to configure it) must promote to Grade 12 on results_finalized
        alone — no KCSE NationalExamRecord required — since Grade 11 is not the tier's exit grade.
        """
        tier = Tier.objects.create(
            curriculum=self.curriculum, name='Senior Secondary', code='SSS7Z',
            exit_exam_code='KCSE', exit_is_terminal=True,
        )
        GradeLevel.objects.create(name='Grade 10ZZ', numeric_order=10, curriculum=self.curriculum, tier=tier)
        g11 = GradeLevel.objects.create(name='Grade 11ZZ', numeric_order=11, curriculum=self.curriculum, tier=tier)
        g12 = GradeLevel.objects.create(name='Grade 12ZZ', numeric_order=12, curriculum=self.curriculum, tier=tier)
        stream = ClassStream.objects.create(name='Central', grade=g11)
        user = User.objects.create_user(username='sss_internal_promo_student', password='x')
        student = StudentExtra.objects.create(user=user, roll='SI01', cl=stream, status=True)
        ExamTerm.objects.create(name='Term 1', academic_year=self.year, start_date='2092-01-01', end_date='2092-04-01', results_finalized=True)

        result = _promote_student(student, self.year)
        self.assertEqual(result['outcome'], 'promoted')
        student.refresh_from_db()
        self.assertEqual(student.cl.grade_id, g12.id)
        self.assertEqual(student.enrollment_state, 'Active')


from apps.students.models import StudentPathwaySelection


class PromoteStudentSSSPathwayCarryForwardTests(TestCase):
    """
    Exercises _move_student_to_grade -> _carry_forward_pathway_selection: promoting a student
    across two grades that are BOTH inside a 'Senior Secondary' tier (so
    tier_requires_pathway_choice(next_grade.tier) is True) must clone their prior year's
    Approved StudentPathwaySelection into the new academic year and re-approve the combo's
    subjects, per _carry_forward_pathway_selection's docstring. No existing PromoteStudentTests
    case promotes into a pathway-choice tier, so this path had zero coverage before.
    """

    def setUp(self):
        self.curriculum = Curriculum.objects.create(code='CBC8', name='CBC (pathway carry-forward test)')
        self.tier = Tier.objects.create(curriculum=self.curriculum, name='Senior Secondary', code='SSS8')
        self.grade10 = GradeLevel.objects.create(name='Grade 10V', numeric_order=10, curriculum=self.curriculum, tier=self.tier)
        self.grade11 = GradeLevel.objects.create(name='Grade 11V', numeric_order=11, curriculum=self.curriculum, tier=self.tier)
        self.stream10 = ClassStream.objects.create(name='Gold', grade=self.grade10)

        self.pathway = Pathway.objects.create(curriculum=self.curriculum, name='STEM')
        self.track = Track.objects.create(pathway=self.pathway, name='Pure Sciences')

        # No AMAT/CMAT in this combo -- on a STEM pathway the core-math guarantee should add
        # CMAT (Core Mathematics) on top; EMAT is reserved for non-STEM pathways.
        self.physics = Subject.objects.create(code='PHY8', name='Physics 8')
        self.chem = Subject.objects.create(code='CHE8', name='Chemistry 8')
        self.bio = Subject.objects.create(code='BIO8', name='Biology 8')
        self.cmat = Subject.objects.create(code='CMAT', name='Core Mathematics')
        self.combo = PresetCombination.objects.create(track=self.track, name='Sciences Combo', code='SC8')
        self.combo.subjects.set([self.physics, self.chem, self.bio])

        self.current_year = AcademicYear.objects.create(year='2091Z')
        self.new_year = AcademicYear.objects.create(year='2092Z')

        user = User.objects.create_user(username='sss_carryforward_student', password='x')
        self.student = StudentExtra.objects.create(user=user, roll='SC01', cl=self.stream10, status=True)

        self.previous_selection = StudentPathwaySelection.objects.create(
            student=self.student, pathway=self.pathway, track=self.track,
            preset_combination=self.combo, academic_year=self.current_year, status='Approved',
        )

        # This tier has no exit_exam_code -> 'plain' transition, gated on
        # results_finalized_for_year for the *destination* academic_year (see _promote_student).
        ExamTerm.objects.create(
            name='Term 1', academic_year=self.new_year, start_date='2092-01-01', end_date='2092-04-01',
            results_finalized=True,
        )

    def test_carries_forward_pathway_and_approves_combo_subjects(self):
        result = _promote_student(self.student, self.new_year)

        self.assertEqual(result['outcome'], 'promoted')
        self.student.refresh_from_db()
        self.assertEqual(self.student.cl.grade_id, self.grade11.id)

        new_selection = StudentPathwaySelection.objects.get(student=self.student, academic_year=self.new_year)
        self.assertEqual(new_selection.status, 'Approved')
        self.assertEqual(new_selection.pathway_id, self.pathway.id)
        self.assertEqual(new_selection.track_id, self.track.id)
        self.assertEqual(new_selection.preset_combination_id, self.combo.id)

        for subject in (self.physics, self.chem, self.bio):
            enrollment = StudentSubjectEnrollment.objects.get(
                student=self.student, subject=subject, academic_year=self.new_year,
            )
            self.assertEqual(enrollment.status, 'Approved')

        # Combo has neither AMAT nor CMAT, and the pathway is STEM -> the core-math
        # guarantee should have added CMAT too.
        cmat_enrollment = StudentSubjectEnrollment.objects.get(
            student=self.student, subject=self.cmat, academic_year=self.new_year,
        )
        self.assertEqual(cmat_enrollment.status, 'Approved')

        # Prior year's selection is untouched (a clone, not a move).
        self.previous_selection.refresh_from_db()
        self.assertEqual(self.previous_selection.status, 'Approved')
        self.assertEqual(self.previous_selection.academic_year_id, self.current_year.id)

    def test_carries_forward_pathway_without_combo_leaves_subjects_untouched(self):
        # A track-only selection (student hasn't picked a preset combination yet) must still
        # carry the pathway/track forward, but _carry_forward_pathway_selection's
        # `if new_selection.preset_combination_id` guard means no subject enrollment work happens.
        self.previous_selection.preset_combination = None
        self.previous_selection.save(update_fields=['preset_combination'])

        result = _promote_student(self.student, self.new_year)

        self.assertEqual(result['outcome'], 'promoted')
        new_selection = StudentPathwaySelection.objects.get(student=self.student, academic_year=self.new_year)
        self.assertEqual(new_selection.status, 'Approved')
        self.assertEqual(new_selection.pathway_id, self.pathway.id)
        self.assertEqual(new_selection.track_id, self.track.id)
        self.assertIsNone(new_selection.preset_combination_id)

        self.assertFalse(
            StudentSubjectEnrollment.objects.filter(student=self.student, academic_year=self.new_year).exists()
        )


import json
from django.core.cache import cache
from django.test import RequestFactory

from school.tests.base import ExamTestDataMixin
from apps.identity.models import Permission, Role, UserRole
from school.views.promotion_views import FinalizeTermAPIView, RecordNationalExamAPIView


class PromotionAdminEndpointTestMixin(ExamTestDataMixin):
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        Permission.objects.get_or_create(code='results.edit', defaults={'label': 'results.edit', 'module': 'results'})
        Permission.objects.get_or_create(code='results.view', defaults={'label': 'results.view', 'module': 'results'})
        role = Role.objects.create(name='Results Manager')
        role.permissions.set(Permission.objects.filter(code__in=('results.edit', 'results.view')))
        UserRole.objects.create(user=cls.admin_user, role=role)

        cls.grade9 = GradeLevel.objects.create(
            name='Grade 9 Promo', numeric_order=9,
            curriculum=Curriculum.objects.create(code='CBC8', name='CBC (endpoint test)'),
        )
        cls.stream = ClassStream.objects.create(name='Central', grade=cls.grade9)
        exam_user = User.objects.create_user(username='promo_endpoint_student', password='x')
        cls.exam_student = StudentExtra.objects.create(user=exam_user, roll='PE01', cl=cls.stream, status=True)

    def setUp(self):
        cache.clear()
        self.factory = RequestFactory()

    def _post(self, view, path, user, payload, **kwargs):
        request = self.factory.post(path, data=json.dumps(payload), content_type='application/json')
        request.user = user
        request._dont_enforce_csrf_checks = True
        response = view.as_view()(request, **kwargs)
        return response


class FinalizeTermAPIViewTests(PromotionAdminEndpointTestMixin, TestCase):
    def test_admin_can_finalize_term(self):
        response = self._post(
            FinalizeTermAPIView, f'/api/promotion/finalize-term/{self.term.id}/',
            self.admin_user, {'finalized': True}, term_id=self.term.id,
        )
        self.assertEqual(response.status_code, 200)
        self.term.refresh_from_db()
        self.assertTrue(self.term.results_finalized)
        self.assertIsNotNone(self.term.results_finalized_at)

    def test_can_un_finalize(self):
        self.term.results_finalized = True
        self.term.save()
        response = self._post(
            FinalizeTermAPIView, f'/api/promotion/finalize-term/{self.term.id}/',
            self.admin_user, {'finalized': False}, term_id=self.term.id,
        )
        self.assertEqual(response.status_code, 200)
        self.term.refresh_from_db()
        self.assertFalse(self.term.results_finalized)
        self.assertIsNone(self.term.results_finalized_at)


class RecordNationalExamAPIViewTests(PromotionAdminEndpointTestMixin, TestCase):
    def test_admin_can_record_an_exam(self):
        response = self._post(
            RecordNationalExamAPIView, f'/api/promotion/national-exam/{self.exam_student.id}/',
            self.admin_user, {'exam_code': 'KJSEA', 'academic_year_id': self.year.id, 'destination': 'Alliance High School'},
            student_id=self.exam_student.id,
        )
        self.assertEqual(response.status_code, 201)
        record = NationalExamRecord.objects.get(student=self.exam_student, exam_code='KJSEA')
        self.assertEqual(record.destination, 'Alliance High School')
        self.assertEqual(record.recorded_by_id, self.admin_user.id)

    def test_duplicate_record_for_same_year_updates_not_duplicates(self):
        self._post(
            RecordNationalExamAPIView, f'/api/promotion/national-exam/{self.exam_student.id}/',
            self.admin_user, {'exam_code': 'KJSEA', 'academic_year_id': self.year.id, 'destination': 'First School'},
            student_id=self.exam_student.id,
        )
        self._post(
            RecordNationalExamAPIView, f'/api/promotion/national-exam/{self.exam_student.id}/',
            self.admin_user, {'exam_code': 'KJSEA', 'academic_year_id': self.year.id, 'destination': 'Corrected School'},
            student_id=self.exam_student.id,
        )
        self.assertEqual(NationalExamRecord.objects.filter(student=self.exam_student, exam_code='KJSEA').count(), 1)
        self.assertEqual(
            NationalExamRecord.objects.get(student=self.exam_student, exam_code='KJSEA').destination, 'Corrected School'
        )


from django.test import override_settings
from school.views.promotion_views import PromoteStudentsAPIView


class PromoteStudentsAPIViewTests(PromotionAdminEndpointTestMixin, TestCase):
    @override_settings(CELERY_TASK_ALWAYS_EAGER=True)
    def test_admin_can_queue_a_bulk_promotion(self):
        self.term.results_finalized = True
        self.term.save()
        response = self._post(
            PromoteStudentsAPIView, '/api/promotion/promote-students/',
            self.admin_user, {'academic_year_id': self.year.id, 'grade_id': self.grade9.id},
        )
        self.assertEqual(response.status_code, 202)

    def test_non_admin_cannot_queue_a_bulk_promotion(self):
        response = self._post(
            PromoteStudentsAPIView, '/api/promotion/promote-students/',
            self.teacher_user, {'academic_year_id': self.year.id, 'grade_id': self.grade9.id},
        )
        self.assertEqual(response.status_code, 403)

    def test_scope_with_only_a_graduated_student_returns_404(self):
        """A Graduated/Expelled/Transferred student must never be re-processed by a bulk
        promotion run — excluding them from an otherwise-empty scope should behave exactly
        like an empty scope (404), not silently queue a job with zero real work."""
        self.exam_student.enrollment_state = 'Graduated'
        self.exam_student.save(update_fields=['enrollment_state'])
        response = self._post(
            PromoteStudentsAPIView, '/api/promotion/promote-students/',
            self.admin_user, {'academic_year_id': self.year.id, 'grade_id': self.grade9.id},
        )
        self.assertEqual(response.status_code, 404)


from school.views.student_dashboard_view import StudentDashboardOverviewAPI


class StudentDashboardGraduatedReflectionTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        curriculum = Curriculum.objects.create(code='CBC9', name='CBC (dashboard test)')
        tier = Tier.objects.create(curriculum=curriculum, name='Junior Secondary', code='JSS9', exit_exam_code='KJSEA', exit_is_terminal=True)
        grade9 = GradeLevel.objects.create(name='Grade 9 Dash', numeric_order=9, curriculum=curriculum, tier=tier)
        stream = ClassStream.objects.create(name='Central', grade=grade9)
        self.user = User.objects.create_user(username='dash_grad_student', password='x')
        self.student = StudentExtra.objects.create(
            user=self.user, roll='DG01', cl=stream, status=True, enrollment_state='Graduated',
        )
        year = AcademicYear.objects.create(year='2091')
        NationalExamRecord.objects.create(
            student=self.student, exam_code='KJSEA', academic_year=year, destination='Alliance High School',
        )

    def test_dashboard_surfaces_graduated_state_and_destination(self):
        request = self.factory.get('/api/student/dashboard-overview/')
        request.user = self.user
        response = StudentDashboardOverviewAPI.as_view()(request)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['data']['profile']['enrollment_state'], 'Graduated')
        self.assertEqual(response.data['data']['profile']['graduation_destination'], 'Alliance High School')
