from datetime import date

from django.contrib.auth.models import User
from django.test import TestCase

from apps.academics.models import AcademicYear, ClassStream, ExamTerm, GradeLevel, Subject
from apps.allocations.models import GlobalAllocationPolicy, SubjectAllocation
from apps.allocations.rebalance import propose_rebalance
from apps.identity.models import TeacherExtra


class ProposeRebalanceFixtureMixin:
    def build_world(self):
        self.year = AcademicYear.objects.create(year='2026', is_active=True)
        self.term = ExamTerm.objects.create(
            name='Term 1', academic_year=self.year,
            start_date=date(2026, 1, 1), end_date=date(2026, 4, 1), is_active=True,
        )
        self.grade = GradeLevel.objects.create(name='Grade 8', numeric_order=8, curriculum_type='CBC')
        # Deliberately only one stream in the grade: with the policy default
        # min_classes_per_subject=2 and enforce_prep_consolidation=True, a grade with MORE
        # streams than that target makes AllocationValidator emit a SOFT PREP_CONSOLIDATION_MISS
        # notice for any subject not yet spread across enough streams -- which would make
        # test_a_clean_scope_proposes_nothing's single allocation non-clean for a reason
        # unrelated to what it's testing. A single-stream grade keeps this fixture's "clean"
        # tests clean under the real (already-committed) AllocationValidator rules.
        self.a = ClassStream.objects.create(name='A', grade=self.grade)
        self.maths = Subject.objects.create(code='MAT101', name='Mathematics', is_core=True)
        self.english = Subject.objects.create(code='ENG101', name='English', is_core=True)
        self.kiswahili = Subject.objects.create(code='KIS101', name='Kiswahili', is_core=True)
        self.overloaded = self.make_teacher('overloaded')
        self.spare = self.make_teacher('spare')
        for t in (self.overloaded, self.spare):
            t.qualified_subjects.add(self.maths)

    def make_teacher(self, username):
        user = User.objects.create_user(username=username, password='x')
        return TeacherExtra.objects.create(user=user, mobile='0700000000', status=True)

    def allocate(self, classroom, subject, teacher):
        return SubjectAllocation.objects.create(
            classroom=classroom, subject=subject, teacher=teacher,
            academic_year=self.year, term=self.term, is_active=True,
        )


class ProposeRebalanceTests(ProposeRebalanceFixtureMixin, TestCase):
    def setUp(self):
        self.build_world()

    def test_a_clean_scope_proposes_nothing(self):
        self.allocate(self.a, self.maths, self.spare)
        proposal = propose_rebalance(term_id=self.term.id, year_id=self.year.id, class_ids=[self.a.id])
        self.assertEqual(proposal.moves, ())
        self.assertEqual(proposal.unresolved_blockers, ())
        self.assertTrue(proposal.fingerprint)

    def test_a_teacher_over_the_per_class_subject_limit_gets_a_move_proposed(self):
        # overloaded teaches 3 subjects in class A -- hits MAX_SUBJECTS_PER_CLASS (default 2).
        # AllocationValidator.validate_and_record processes in-scope rows ordered by
        # (classroom_id, subject_id) and HARD-rejects only the row that actually crosses the
        # cap -- i.e. whichever of these three subjects has the highest subject_id, not
        # necessarily Mathematics -- so spare is made qualified for all three (not just maths)
        # to be a valid alternative for whichever one the real ordering flags. spare is
        # otherwise completely free in class A.
        for subject in (self.maths, self.english, self.kiswahili):
            self.overloaded.qualified_subjects.add(subject)
            self.spare.qualified_subjects.add(subject)
            self.allocate(self.a, subject, self.overloaded)

        proposal = propose_rebalance(term_id=self.term.id, year_id=self.year.id, class_ids=[self.a.id])

        self.assertTrue(any(b.code == 'MAX_SUBJECTS_PER_CLASS' for b in proposal.blockers_before))
        resolving_moves = [m for m in proposal.moves if m.resolves_blocker_code == 'MAX_SUBJECTS_PER_CLASS']
        self.assertEqual(len(resolving_moves), 1)
        move = resolving_moves[0]
        self.assertEqual(move.classroom_id, self.a.id)
        self.assertEqual(move.from_teacher_id, self.overloaded.id)
        self.assertEqual(move.to_teacher_id, self.spare.id)
        self.assertTrue(move.reason)

    def test_a_blocker_with_no_qualified_alternative_stays_unresolved(self):
        for subject in (self.maths, self.english, self.kiswahili):
            self.overloaded.qualified_subjects.add(subject)
            self.allocate(self.a, subject, self.overloaded)
        # No other teacher is qualified for english/kiswahili at all -- those can't be fixed.

        proposal = propose_rebalance(term_id=self.term.id, year_id=self.year.id, class_ids=[self.a.id])

        self.assertTrue(len(proposal.unresolved_blockers) >= 1)
        fixed_subject_ids = {m.subject_id for m in proposal.moves}
        unresolved_subject_ids = {b.subject_id for b in proposal.unresolved_blockers}
        self.assertTrue(unresolved_subject_ids - fixed_subject_ids or len(proposal.moves) < 2)

    def test_proposal_never_writes_anything(self):
        for subject in (self.maths, self.english, self.kiswahili):
            self.overloaded.qualified_subjects.add(subject)
            self.allocate(self.a, subject, self.overloaded)

        propose_rebalance(term_id=self.term.id, year_id=self.year.id, class_ids=[self.a.id])

        still_overloaded = SubjectAllocation.objects.filter(
            classroom=self.a, teacher=self.overloaded, is_active=True).count()
        self.assertEqual(still_overloaded, 3)  # nothing persisted

    def test_fingerprint_matches_publish_gates_own_fingerprint_for_the_same_scope(self):
        from apps.allocations.publish_gate import compute_scope_fingerprint

        self.allocate(self.a, self.maths, self.spare)
        proposal = propose_rebalance(term_id=self.term.id, year_id=self.year.id, class_ids=[self.a.id])
        expected = compute_scope_fingerprint(term_id=self.term.id, year_id=self.year.id, class_ids=[self.a.id])
        self.assertEqual(proposal.fingerprint, expected)
