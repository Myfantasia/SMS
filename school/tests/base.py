from datetime import date

from django.contrib.auth.models import User, Group
from django.test import TestCase

from school.models.classSubjects_models import GradeLevel, ClassStream, Subject
from school.models.models import AcademicYear, ExamTerm, ExamEvent, GradingRule, TeacherExtra, StudentExtra
from school.models.rbac_models import Permission


class ExamTestDataMixin:
    """
    Builds a minimal, valid object graph shared across exams/results tests: one CBC grade/stream
    and one 8-4-4 grade/stream, a core subject and an elective, both grading scales, three exam
    events (a 50-mark CAT, a 100-mark CAT, and a 100-mark Main), and one student/teacher/admin
    account per relevant group.
    """

    @classmethod
    def setUpTestData(cls):
        cls.year = AcademicYear.objects.create(year='2026', is_active=True)
        cls.term = ExamTerm.objects.create(
            name='Term 1', academic_year=cls.year,
            start_date=date(2026, 1, 1), end_date=date(2026, 4, 1), is_active=True
        )

        cls.grade_cbc = GradeLevel.objects.create(name='Grade 8', numeric_order=8, curriculum_type='CBC')
        cls.grade_844 = GradeLevel.objects.create(name='Form 4', numeric_order=12, curriculum_type='8-4-4')

        cls.stream_cbc = ClassStream.objects.create(name='North', grade=cls.grade_cbc)
        cls.stream_844 = ClassStream.objects.create(name='East', grade=cls.grade_844)

        cls.maths = Subject.objects.create(code='MAT101', name='Mathematics', is_core=True)
        cls.french = Subject.objects.create(code='FRE101', name='French', is_core=False)

        for label, lo, hi in [
            ('A+', 80, 100), ('A-', 75, 79.99), ('B+', 70, 74.99), ('B', 65, 69.99),
            ('C+', 55, 59.99), ('C', 50, 54.99), ('D', 30, 34.99), ('E', 0, 29.99),
        ]:
            GradingRule.objects.create(curriculum='8-4-4', grade_label=label, min_score=lo, max_score=hi)

        for label, lo, hi in [
            ('EE', 75, 100), ('ME', 50, 74.99), ('AE', 25, 49.99), ('BE', 0, 24.99),
        ]:
            GradingRule.objects.create(curriculum='CBC', grade_label=label, min_score=lo, max_score=hi)

        cls.cat1 = ExamEvent.objects.create(
            term=cls.term, name='CAT 1', exam_type='CAT', total_marks=50, status='Draft')
        cls.cat2 = ExamEvent.objects.create(
            term=cls.term, name='CAT 2', exam_type='CAT', total_marks=100, status='Draft')
        cls.main_exam = ExamEvent.objects.create(
            term=cls.term, name='End Of Term', exam_type='MAIN', total_marks=100, status='Draft')

        # HasModulePermission grants a superuser every Permission CODE THAT EXISTS in the
        # table (see get_user_permission_codes) — it doesn't bypass the RBAC gate the way
        # is_superuser does elsewhere, so the rows still need to exist even for admin tests.
        for code in ('exams.view', 'exams.edit', 'results.view', 'results.edit'):
            Permission.objects.get_or_create(code=code, defaults={'label': code, 'module': code.split('.')[0]})

        cls.admin_user = User.objects.create_user(
            username='admin_test', password='x', is_superuser=True, is_staff=True)

        cls.student_group, _ = Group.objects.get_or_create(name='STUDENT')
        cls.parent_group, _ = Group.objects.get_or_create(name='PARENT')
        cls.teacher_group, _ = Group.objects.get_or_create(name='TEACHER')
        cls.admin_group, _ = Group.objects.get_or_create(name='ADMIN')

        cls.student_user = User.objects.create_user(
            username='student_test', password='x', first_name='Test', last_name='Student')
        cls.student_user.groups.add(cls.student_group)
        cls.student = StudentExtra.objects.create(
            user=cls.student_user, roll='S001', cl=cls.stream_cbc, status=True)

        cls.other_student_user = User.objects.create_user(username='student_test2', password='x')
        cls.other_student_user.groups.add(cls.student_group)
        cls.other_student = StudentExtra.objects.create(
            user=cls.other_student_user, roll='S002', cl=cls.stream_cbc, status=True)

        cls.teacher_user = User.objects.create_user(username='teacher_test', password='x')
        cls.teacher_user.groups.add(cls.teacher_group)
        cls.teacher = TeacherExtra.objects.create(user=cls.teacher_user, status=True)

        cls.groupless_user = User.objects.create_user(username='groupless_test', password='x')
