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

    def test_two_blockers_resolving_to_the_same_teacher_dont_jointly_breach_capacity(self):
        # Two separate classes (own grade, own two streams -- isolated from self.a/self.grade so
        # this doesn't interact with the other tests' fixtures), each with its own overloaded
        # teacher hitting MAX_SUBJECTS_PER_CLASS on the same subject -- Kiswahili, by the same
        # subject_id-ordering mechanics confirmed in the test above (maths/english/kiswahili
        # created in that order in build_world, so kiswahili -- the highest subject_id -- is the
        # one AllocationValidator.validate_and_record HARD-rejects in each class). Only one other
        # teacher ("rescuer") is qualified for Kiswahili at all, and starts with ZERO class
        # groups, so either class's blocker alone would propose rescuer as the fix.
        #
        # max_total_class_groups is capped at 1 so the two picks can't BOTH be safe: validate_
        # and_record's own check (school/utils.py) is "len(t_groups_set) + 1 > max_total_class_
        # groups" -- the FIRST class rescuer picks up is fine (0 + 1 == 1, not > 1), but the
        # SECOND would be 1 + 1 = 2 > 1. This only self-corrects if propose_rebalance commits the
        # first pick into the validator's running state (dry_run=False) before scoring the second
        # blocker -- the fix this test guards against regressing. overloaded_d/overloaded_e are
        # deliberately also qualified for all three subjects (so they're real candidates too) but
        # each already holds their OWN class as a seeded group, so the same cap rules them out as
        # an alternative for the OTHER class regardless -- confirmed by the same validate_and_
        # record logic, not assumed.
        grade2 = GradeLevel.objects.create(name='Grade 9', numeric_order=9, curriculum_type='CBC')
        class_d = ClassStream.objects.create(name='D', grade=grade2)
        class_e = ClassStream.objects.create(name='E', grade=grade2)

        policy = GlobalAllocationPolicy.load()
        policy.max_total_class_groups = 1
        policy.save()

        overloaded_d = self.make_teacher('overloaded_d')
        overloaded_e = self.make_teacher('overloaded_e')
        rescuer = self.make_teacher('rescuer')
        rescuer.qualified_subjects.add(self.kiswahili)

        for classroom, teacher in ((class_d, overloaded_d), (class_e, overloaded_e)):
            for subject in (self.maths, self.english, self.kiswahili):
                teacher.qualified_subjects.add(subject)
                self.allocate(classroom, subject, teacher)

        proposal = propose_rebalance(
            term_id=self.term.id, year_id=self.year.id, class_ids=[class_d.id, class_e.id],
        )

        rescuer_moves = [m for m in proposal.moves if m.to_teacher_id == rescuer.id]
        # The whole point of the fix: rescuer may be proposed for at most ONE of the two classes,
        # never both -- taking both would jointly breach max_total_class_groups=1.
        self.assertLessEqual(len({m.classroom_id for m in rescuer_moves}), 1)
        self.assertEqual(len(rescuer_moves), len({m.classroom_id for m in rescuer_moves}))
        # And since rescuer is the only teacher qualified for Kiswahili who isn't already pinned
        # to their own class by the same cap, at least one of the two MAX_SUBJECTS_PER_CLASS
        # blockers must be left unresolved -- nobody else can safely take it.
        unresolved_kiswahili = [
            b for b in proposal.unresolved_blockers
            if b.code == 'MAX_SUBJECTS_PER_CLASS' and b.subject_id == self.kiswahili.id
        ]
        self.assertTrue(len(unresolved_kiswahili) >= 1)

    def test_fingerprint_matches_publish_gates_own_fingerprint_for_the_same_scope(self):
        from apps.allocations.publish_gate import compute_scope_fingerprint

        self.allocate(self.a, self.maths, self.spare)
        proposal = propose_rebalance(term_id=self.term.id, year_id=self.year.id, class_ids=[self.a.id])
        expected = compute_scope_fingerprint(term_id=self.term.id, year_id=self.year.id, class_ids=[self.a.id])
        self.assertEqual(proposal.fingerprint, expected)
