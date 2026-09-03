from django.test import TestCase

from apps.academics.models import ClassStream
from apps.students.models import StudentSubjectEnrollment
from school.tests.base import ExamTestDataMixin
from school.utils import get_applicable_students, resolve_classroom_students


class GetApplicableStudentsTests(ExamTestDataMixin, TestCase):
    """
    Covers get_applicable_students(): core subjects always return the whole class; electives
    narrow to Approved enrollees ONLY once real enrollment data exists for that subject/grade,
    otherwise they fall back to the whole class (avoiding the regression where every elective
    silently showed zero students because the school hadn't started using choice-tracking yet).
    """

    def test_core_subject_returns_full_class(self):
        roster = get_applicable_students(self.maths, self.stream_cbc, self.year)
        self.assertEqual(set(roster), {self.student, self.other_student})

    def test_elective_with_no_enrollment_data_falls_back_to_full_class(self):
        roster = get_applicable_students(self.french, self.stream_cbc, self.year)
        self.assertEqual(set(roster), {self.student, self.other_student})

    def test_elective_with_real_enrollment_narrows_to_approved_only(self):
        StudentSubjectEnrollment.objects.create(
            student=self.student, subject=self.french, academic_year=self.year, status='Approved')
        roster = get_applicable_students(self.french, self.stream_cbc, self.year)
        self.assertEqual(set(roster), {self.student})

    def test_pending_enrollment_is_not_counted_as_approved(self):
        StudentSubjectEnrollment.objects.create(
            student=self.student, subject=self.french, academic_year=self.year, status='Pending')
        roster = get_applicable_students(self.french, self.stream_cbc, self.year)
        self.assertEqual(set(roster), set())


class ResolveClassroomStudentsTests(ExamTestDataMixin, TestCase):
    """
    Covers the "split groups count as one subject" behavior: multiple virtual ClassStream rows
    spawned by the Splitting Engine for the same subject/grade (e.g. "French - Group 1",
    "French - Group 2") must all resolve to the identical grade-wide roster, regardless of
    which specific group's ClassStream id is passed in.
    """

    def setUp(self):
        self.group1 = ClassStream.objects.create(
            name='French - Group 1', grade=self.stream_cbc.grade, is_virtual=True)
        self.group2 = ClassStream.objects.create(
            name='French - Group 2', grade=self.stream_cbc.grade, is_virtual=True)
        StudentSubjectEnrollment.objects.create(
            student=self.student, subject=self.french, academic_year=self.year, status='Approved')

    def test_real_homeroom_class_uses_direct_membership(self):
        roster = resolve_classroom_students(self.stream_cbc, self.year)
        self.assertEqual(set(roster), {self.student, self.other_student})

    def test_both_groups_resolve_to_the_same_roster(self):
        roster_g1 = set(resolve_classroom_students(self.group1, self.year))
        roster_g2 = set(resolve_classroom_students(self.group2, self.year))
        self.assertEqual(roster_g1, roster_g2)
        self.assertEqual(roster_g1, {self.student})

    def test_unknown_virtual_subject_returns_empty_not_error(self):
        ghost = ClassStream.objects.create(
            name='Nonexistent Subject - Group 1', grade=self.stream_cbc.grade, is_virtual=True)
        roster = resolve_classroom_students(ghost, self.year)
        self.assertEqual(list(roster), [])
