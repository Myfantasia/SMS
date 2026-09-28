# apps/allocations/tests/test_publish_gate.py
from datetime import date

from django.contrib.auth.models import User
from django.test import TestCase

from apps.academics.models import AcademicYear, ClassStream, ExamTerm, GradeLevel, Subject
from apps.allocations.models import AllocationPublishState, SubjectAllocation, SubjectQuota
from apps.allocations.publish_gate import (
    SCOPE_ALL, SCOPE_CLASS, SCOPE_GRADE, compute_scope_fingerprint, get_scope_triples,
    resolve_publish_scope, review_scope,
)
from apps.identity.models import TeacherExtra


class PublishGateFixtureMixin:
    def build_world(self):
        self.year = AcademicYear.objects.create(year='2026', is_active=True)
        self.term = ExamTerm.objects.create(
            name='Term 1', academic_year=self.year,
            start_date=date(2026, 1, 1), end_date=date(2026, 4, 1), is_active=True,
        )
        self.grade = GradeLevel.objects.create(name='Grade 8', numeric_order=8, curriculum_type='CBC')
        self.other_grade = GradeLevel.objects.create(name='Grade 9', numeric_order=9, curriculum_type='CBC')
        self.a = ClassStream.objects.create(name='A', grade=self.grade)
        self.b = ClassStream.objects.create(name='B', grade=self.grade)
        self.c = ClassStream.objects.create(name='C', grade=self.grade)
        self.g9 = ClassStream.objects.create(name='A', grade=self.other_grade)
        self.maths = Subject.objects.create(code='MAT101', name='Mathematics', is_core=True)
        self.english = Subject.objects.create(code='ENG101', name='English', is_core=True)
        self.kiswahili = Subject.objects.create(code='KIS101', name='Kiswahili', is_core=True)
        self.teacher = self.make_teacher('teacher_one')
        self.teacher_two = self.make_teacher('teacher_two')

    def make_teacher(self, username):
        user = User.objects.create_user(username=username, password='x')
        return TeacherExtra.objects.create(user=user, mobile='0700000000', status=True)

    def allocate(self, classroom, subject, teacher):
        return SubjectAllocation.objects.create(
            classroom=classroom, subject=subject, teacher=teacher,
            academic_year=self.year, term=self.term, is_active=True,
        )

    def publish(self, classroom):
        AllocationPublishState.objects.update_or_create(
            classroom=classroom, term=self.term, academic_year=self.year, defaults={'is_published': True},
        )

    def codes(self, review, severity=None):
        return {b.code for b in review.blockers if severity is None or b.severity == severity}


class ResolvePublishScopeTests(PublishGateFixtureMixin, TestCase):
    def setUp(self):
        self.build_world()
        self.allocate(self.a, self.maths, self.teacher)
        self.allocate(self.b, self.maths, self.teacher_two)
        self.allocate(self.g9, self.maths, self.teacher)

    def kwargs(self, scope, class_id=None, grade_id=None):
        return dict(term_id=self.term.id, year_id=self.year.id, scope=scope,
                    class_id=class_id or self.a.id, grade_id=grade_id or self.grade.id)

    def test_class_scope_is_just_that_class(self):
        self.assertEqual(resolve_publish_scope(**self.kwargs(SCOPE_CLASS)), (self.a.id,))

    def test_grade_scope_is_every_drafted_class_in_that_grade_only(self):
        self.assertEqual(resolve_publish_scope(**self.kwargs(SCOPE_GRADE)), tuple(sorted([self.a.id, self.b.id])))

    def test_all_scope_includes_other_grades(self):
        self.assertEqual(
            resolve_publish_scope(**self.kwargs(SCOPE_ALL)), tuple(sorted([self.a.id, self.b.id, self.g9.id])),
        )

    def test_already_published_siblings_are_left_out_but_the_requested_class_stays(self):
        self.publish(self.b)
        self.assertEqual(resolve_publish_scope(**self.kwargs(SCOPE_GRADE)), (self.a.id,))

    def test_grade_scope_without_a_grade_is_rejected(self):
        with self.assertRaises(ValueError):
            resolve_publish_scope(term_id=self.term.id, year_id=self.year.id, scope=SCOPE_GRADE,
                                  class_id=self.a.id, grade_id=None)

    def test_unknown_scope_is_rejected(self):
        with self.assertRaises(ValueError):
            resolve_publish_scope(**self.kwargs('everything'))


class FingerprintTests(PublishGateFixtureMixin, TestCase):
    def setUp(self):
        self.build_world()

    def fp(self, *class_ids):
        return compute_scope_fingerprint(term_id=self.term.id, year_id=self.year.id, class_ids=class_ids)

    def test_same_content_gives_the_same_fingerprint_regardless_of_id_order(self):
        self.allocate(self.a, self.maths, self.teacher)
        self.allocate(self.b, self.maths, self.teacher_two)
        self.assertEqual(self.fp(self.a.id, self.b.id), self.fp(self.b.id, self.a.id))

    def test_changing_a_teacher_changes_the_fingerprint(self):
        allocation = self.allocate(self.a, self.maths, self.teacher)
        before = self.fp(self.a.id)
        allocation.teacher = self.teacher_two
        allocation.save()
        self.assertNotEqual(before, self.fp(self.a.id))

    def test_publishing_a_class_changes_the_fingerprint(self):
        self.allocate(self.a, self.maths, self.teacher)
        before = self.fp(self.a.id)
        self.publish(self.a)
        self.assertNotEqual(before, self.fp(self.a.id))

    def test_scope_triples_are_class_teacher_subject(self):
        self.allocate(self.a, self.maths, self.teacher)
        self.assertEqual(
            get_scope_triples(term_id=self.term.id, year_id=self.year.id, class_ids=[self.a.id]),
            frozenset({(self.a.id, self.teacher.id, self.maths.id)}),
        )


class ReviewScopeTests(PublishGateFixtureMixin, TestCase):
    def setUp(self):
        self.build_world()

    def review(self, *class_ids):
        return review_scope(term_id=self.term.id, year_id=self.year.id, class_ids=class_ids)

    def test_clean_draft_has_no_blockers(self):
        self.allocate(self.a, self.maths, self.teacher)
        # Grade 8 has 3 streams, so the prep-consolidation notice (target: 2 streams per teacher)
        # would fire for a lone stream; B (outside the scope) meets the target and keeps this clean.
        self.allocate(self.b, self.maths, self.teacher)
        review = self.review(self.a.id)
        self.assertEqual(review.blockers, ())
        self.assertEqual(review.class_ids, (self.a.id,))
        self.assertTrue(review.fingerprint)

    def test_a_teacher_over_the_per_class_subject_limit_is_a_hard_blocker(self):
        for subject in (self.maths, self.english, self.kiswahili):
            self.allocate(self.a, subject, self.teacher)  # policy default: max 2 subjects per class
        review = self.review(self.a.id)
        self.assertIn('MAX_SUBJECTS_PER_CLASS', self.codes(review, 'HARD'))

    def test_load_in_classes_outside_the_scope_counts_against_the_scope(self):
        self.allocate(self.a, self.maths, self.teacher)
        self.allocate(self.b, self.maths, self.teacher)
        self.allocate(self.c, self.maths, self.teacher)  # third stream of the same subject (max 2)
        review = self.review(self.c.id)  # only C is being published; A and B are elsewhere
        hard = [b for b in review.hard_blockers if b.code == 'MAX_CLASSES_PER_SUBJECT']
        self.assertEqual(len(hard), 1)
        self.assertEqual(hard[0].classroom_id, self.c.id)

    def test_already_published_class_is_a_hard_blocker(self):
        self.allocate(self.a, self.maths, self.teacher)
        self.publish(self.a)
        self.assertIn('ALREADY_PUBLISHED', self.codes(self.review(self.a.id), 'HARD'))

    def test_class_with_nothing_saved_is_a_hard_blocker(self):
        self.assertIn('NOTHING_TO_PUBLISH', self.codes(self.review(self.a.id), 'HARD'))

    def test_missing_quota_subject_is_a_soft_blocker(self):
        SubjectQuota.objects.create(grade=self.grade, subject=self.kiswahili, total_lessons=4)
        self.allocate(self.a, self.maths, self.teacher)
        review = self.review(self.a.id)
        soft = [b for b in review.soft_blockers if b.code == 'INCOMPLETE_CLASS']
        self.assertEqual(len(soft), 1)
        self.assertIn('Kiswahili', soft[0].message)
        self.assertEqual(review.hard_blockers, ())

    def test_designated_class_teacher_left_out_is_a_blocker(self):
        self.a.class_teacher = self.teacher_two
        self.a.save()
        self.allocate(self.a, self.maths, self.teacher)  # teacher_two teaches nothing in A
        review = self.review(self.a.id)
        blockers = [b for b in review.blockers if b.code == 'CLASS_TEACHER_UNASSIGNED']
        self.assertEqual(len(blockers), 1)
        self.assertEqual(blockers[0].teacher_id, self.teacher_two.id)

    def test_prep_notice_is_dropped_when_the_teacher_finally_teaches_enough_streams_in_scope(self):
        self.allocate(self.a, self.maths, self.teacher)
        self.allocate(self.b, self.maths, self.teacher)  # C has nothing: 3-stream grade
        review = self.review(self.a.id, self.b.id)
        self.assertNotIn('PREP_CONSOLIDATION_MISS', self.codes(review))

    def test_a_lone_stream_in_a_three_stream_grade_keeps_the_prep_notice(self):
        self.allocate(self.a, self.maths, self.teacher)
        review = self.review(self.a.id)
        notices = [b for b in review.blockers if b.code == 'PREP_CONSOLIDATION_MISS']
        self.assertEqual(len(notices), 1)
        self.assertEqual(notices[0].severity, 'SOFT')

    def test_class_teacher_left_out_is_reported_once_not_also_as_incomplete(self):
        SubjectQuota.objects.create(grade=self.grade, subject=self.maths, total_lessons=4)
        self.a.class_teacher = self.teacher_two
        self.a.save()
        self.allocate(self.a, self.maths, self.teacher)  # quota fully covered
        review = self.review(self.a.id)
        codes = [b.code for b in review.blockers]
        self.assertEqual(codes.count('CLASS_TEACHER_UNASSIGNED'), 1)
        self.assertNotIn('INCOMPLETE_CLASS', codes)
