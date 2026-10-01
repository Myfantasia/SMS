from datetime import date

from django.contrib.auth.models import User
from django.test import TestCase

from apps.academics.models import AcademicYear, ClassStream, ExamTerm, GradeLevel, Subject, TimeSlot
from apps.allocations.models import GlobalAllocationPolicy, SubjectAllocation, SubjectBlock
from apps.identity.models import TeacherExtra
from school.utils import AllocationValidator, rank_candidates


class RankCandidatesTests(TestCase):
    def setUp(self):
        # AllocationValidator._effective_weekly_cap derives real teacher capacity from the actual
        # timetable grid (TimeSlot rows where is_global=False), not just the flat policy cap — with
        # none seeded here, every teacher's capacity is 0 and every candidate hard-errors on the
        # Burnout Warning check regardless of ranking. These slots exist purely so candidates clear
        # that pre-existing capacity gate; they don't affect the scoring behavior under test.
        for day in ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'):
            for i in range(8):
                TimeSlot.objects.create(
                    day=day, start_time=f'{8 + i:02d}:00', end_time=f'{9 + i:02d}:00', is_global=False,
                )

        self.year = AcademicYear.objects.create(year='2026', is_active=True)
        self.term = ExamTerm.objects.create(
            name='Term 1', academic_year=self.year,
            start_date=date(2026, 1, 1), end_date=date(2026, 4, 1), is_active=True,
        )
        self.grade = GradeLevel.objects.create(name='Grade 8', numeric_order=8, curriculum_type='CBC')
        self.a = ClassStream.objects.create(name='A', grade=self.grade)
        self.b = ClassStream.objects.create(name='B', grade=self.grade)
        self.c = ClassStream.objects.create(name='C', grade=self.grade)
        self.maths = Subject.objects.create(code='MAT101', name='Mathematics', is_core=True)
        self.light_teacher = self._teacher('light')
        self.heavy_teacher = self._teacher('heavy')
        self.light_teacher.qualified_subjects.add(self.maths)
        self.heavy_teacher.qualified_subjects.add(self.maths)

        # heavy_teacher already carries load in another class this policy/validator run knows about.
        SubjectAllocation.objects.create(
            classroom=self.b, subject=self.maths, teacher=self.heavy_teacher,
            academic_year=self.year, term=self.term, is_active=True,
        )

    def _teacher(self, username):
        user = User.objects.create_user(username=username, password='x')
        return TeacherExtra.objects.create(user=user, mobile='0700000000', status=True)

    def _validator(self, seed_from=()):
        policy = GlobalAllocationPolicy.load()
        validator = AllocationValidator(policy, {}, {}, {(self.grade.id, self.maths.id): 5})
        if seed_from:
            validator.seed_from_existing(seed_from)
        return validator, policy

    def test_lighter_teacher_ranks_first_all_else_equal(self):
        baseline = SubjectAllocation.objects.filter(is_active=True).select_related(
            'classroom', 'subject', 'classroom__grade')
        validator, policy = self._validator(seed_from=baseline)
        qualified = {self.light_teacher.id: {self.maths.id}, self.heavy_teacher.id: {self.maths.id}}

        results = rank_candidates(
            validator=validator, subject=self.maths, target_class=self.c,
            teacher_qualified_map=qualified, active_teachers=[self.light_teacher, self.heavy_teacher],
            teacher_subject_classes={self.heavy_teacher.id: {self.maths.id: [self.b]}},
            policy=policy, term_id=self.term.id, year_id=self.year.id,
        )

        self.assertEqual(len(results), 2)
        _priority, winner, _warnings = results[0]
        self.assertEqual(winner.id, self.light_teacher.id)

    def test_unqualified_teacher_is_excluded(self):
        unqualified = self._teacher('unqualified')
        validator, policy = self._validator()
        qualified = {self.light_teacher.id: {self.maths.id}}  # unqualified has no entry

        results = rank_candidates(
            validator=validator, subject=self.maths, target_class=self.c,
            teacher_qualified_map=qualified, active_teachers=[self.light_teacher, unqualified],
            teacher_subject_classes={}, policy=policy, term_id=self.term.id, year_id=self.year.id,
        )

        self.assertEqual([t.id for _p, t, _w in results], [self.light_teacher.id])

    def test_dry_run_never_commits_into_the_validator(self):
        validator, policy = self._validator()
        qualified = {self.light_teacher.id: {self.maths.id}}
        before = dict(validator.teacher_weekly_lessons)

        rank_candidates(
            validator=validator, subject=self.maths, target_class=self.c,
            teacher_qualified_map=qualified, active_teachers=[self.light_teacher],
            teacher_subject_classes={}, policy=policy, term_id=self.term.id, year_id=self.year.id,
        )

        self.assertEqual(validator.teacher_weekly_lessons, before)

    def test_fill_remaining_subjects_still_picks_the_same_winner_through_the_extracted_function(self):
        """Regression guard for the extraction itself: fill_remaining_subjects's own observable
        output must be unchanged by routing through rank_candidates."""
        from school.utils import fill_remaining_subjects

        baseline = SubjectAllocation.objects.filter(is_active=True).select_related(
            'classroom', 'subject', 'classroom__grade')
        validator, policy = self._validator(seed_from=baseline)
        qualified = {self.light_teacher.id: {self.maths.id}, self.heavy_teacher.id: {self.maths.id}}

        result = fill_remaining_subjects(
            validator=validator, target_class=self.c, required_subjects=[self.maths],
            reserved_subject_id=None, teacher_qualified_map=qualified,
            active_teachers=[self.light_teacher, self.heavy_teacher],
            teacher_subject_classes={self.heavy_teacher.id: {self.maths.id: [self.b]}},
            policy=policy, term_id=self.term.id, year_id=self.year.id,
        )

        self.assertEqual(result[0]['teacher_id'], self.light_teacher.id)
        self.assertEqual(result[0]['status'], 'Success')
