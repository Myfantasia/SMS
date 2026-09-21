from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.academics.models import AcademicYear, ExamTerm, GradeLevel, Curriculum, Tier
from apps.core.models import SystemAuditLog
from apps.identity.models import Permission, Role, UserRole, StudentExtra
from apps.finance.models_fees import FeeCategory, FeeStructure, FeeStructureItem, StudentFeeItemEnrollment
from apps.finance.views import (
    FeeCategoryListCreateAPIView, FeeStructureListCreateAPIView,
    FeeStructureDetailAPIView, StudentFeeItemEnrollmentSetAPIView,
)


class FinanceAPITestData(TestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        curriculum = Curriculum.objects.create(name='CBC')
        tier = Tier.objects.create(name='Junior School', curriculum=curriculum)
        self.grade = GradeLevel.objects.create(name='Grade 7', numeric_order=7, curriculum_type='CBC', curriculum=curriculum, tier=tier)
        year = AcademicYear.objects.create(year='2026', is_active=True)
        self.term = ExamTerm.objects.create(name='Term 2', academic_year=year, start_date='2026-05-01', end_date='2026-08-01')

        view_perm, _ = Permission.objects.get_or_create(code='finance.view', defaults={'label': 'View', 'module': 'Finance'})
        edit_perm, _ = Permission.objects.get_or_create(code='finance.edit', defaults={'label': 'Edit', 'module': 'Finance'})
        role, _ = Role.objects.get_or_create(name='Finance Officer Test Role')
        role.permissions.set([view_perm, edit_perm])
        self.finance_user = User.objects.create_user(username='finance_officer_test', password='x')
        UserRole.objects.create(user=self.finance_user, role=role)

        view_only_role, _ = Role.objects.get_or_create(name='Finance Viewer Test Role')
        view_only_role.permissions.set([view_perm])
        self.viewer_user = User.objects.create_user(username='finance_viewer_test', password='x')
        UserRole.objects.create(user=self.viewer_user, role=view_only_role)

        self.plain_user = User.objects.create_user(username='no_permission_user', password='x')

    def call(self, view, method, path, user, data=None, **kwargs):
        request = getattr(self.factory, method)(path, data, format='json') if data is not None else getattr(self.factory, method)(path)
        force_authenticate(request, user=user)
        return view.as_view()(request, **kwargs)

    def make_student(self, n):
        user = User.objects.create_user(username=f'fee_api_student_{n}', password='x')
        return StudentExtra.objects.create(user=user, roll=f'FEEAPI-{n}')


class FeeCategoryAPITests(FinanceAPITestData):
    def test_finance_officer_can_create_category(self):
        response = self.call(FeeCategoryListCreateAPIView, 'post', '/api/finance/fee-categories/', self.finance_user,
                             {'name': 'Boarding', 'description': 'Boarding fee'})
        self.assertEqual(response.status_code, 201)
        self.assertTrue(FeeCategory.objects.filter(name='Boarding').exists())

    def test_user_without_permission_cannot_create_category(self):
        response = self.call(FeeCategoryListCreateAPIView, 'post', '/api/finance/fee-categories/', self.plain_user, {'name': 'Boarding'})
        self.assertEqual(response.status_code, 403)

    def test_can_list_categories(self):
        FeeCategory.objects.create(name='Tuition')
        response = self.call(FeeCategoryListCreateAPIView, 'get', '/api/finance/fee-categories/', self.finance_user)
        self.assertEqual(response.status_code, 200)
        # No DEFAULT_PAGINATION_CLASS in REST_FRAMEWORK settings: response.data is a plain list.
        self.assertEqual(len(response.data), 1)

    def test_duplicate_category_name_is_a_400(self):
        FeeCategory.objects.create(name='Tuition')
        response = self.call(FeeCategoryListCreateAPIView, 'post', '/api/finance/fee-categories/', self.finance_user, {'name': 'Tuition'})
        self.assertEqual(response.status_code, 400)
        self.assertIn('name', response.data)
        self.assertEqual(FeeCategory.objects.filter(name='Tuition').count(), 1)

    def test_view_only_user_can_get_but_not_post(self):
        get_response = self.call(FeeCategoryListCreateAPIView, 'get', '/api/finance/fee-categories/', self.viewer_user)
        self.assertEqual(get_response.status_code, 200)
        post_response = self.call(FeeCategoryListCreateAPIView, 'post', '/api/finance/fee-categories/', self.viewer_user, {'name': 'Boarding'})
        self.assertEqual(post_response.status_code, 403)
        self.assertFalse(FeeCategory.objects.filter(name='Boarding').exists())

    def test_creating_a_category_writes_an_audit_log(self):
        self.call(FeeCategoryListCreateAPIView, 'post', '/api/finance/fee-categories/', self.finance_user, {'name': 'Boarding'})
        log = SystemAuditLog.objects.get(module='finance', action_type='CREATE')
        self.assertEqual(log.operator_id, self.finance_user.id)
        self.assertIn('Boarding', log.description)


class FeeStructureAPITests(FinanceAPITestData):
    def test_can_create_structure(self):
        response = self.call(FeeStructureListCreateAPIView, 'post', '/api/finance/fee-structures/', self.finance_user, {
            'grade_level': self.grade.id, 'term': self.term.id, 'name': 'Grade 7 - Term 2 2026',
        })
        self.assertEqual(response.status_code, 201)

    def test_duplicate_grade_and_term_is_a_400(self):
        FeeStructure.objects.create(grade_level=self.grade, term=self.term, name='Existing')
        response = self.call(FeeStructureListCreateAPIView, 'post', '/api/finance/fee-structures/', self.finance_user, {
            'grade_level': self.grade.id, 'term': self.term.id, 'name': 'Duplicate',
        })
        self.assertEqual(response.status_code, 400)
        self.assertEqual(FeeStructure.objects.count(), 1)

    def test_view_only_user_cannot_create_structure(self):
        response = self.call(FeeStructureListCreateAPIView, 'post', '/api/finance/fee-structures/', self.viewer_user, {
            'grade_level': self.grade.id, 'term': self.term.id, 'name': 'X',
        })
        self.assertEqual(response.status_code, 403)

    def test_creating_a_structure_writes_an_audit_log(self):
        self.call(FeeStructureListCreateAPIView, 'post', '/api/finance/fee-structures/', self.finance_user, {
            'grade_level': self.grade.id, 'term': self.term.id, 'name': 'Grade 7 - Term 2 2026',
        })
        log = SystemAuditLog.objects.get(module='finance', action_type='CREATE')
        self.assertEqual(log.operator_id, self.finance_user.id)
        self.assertIn('Grade 7 - Term 2 2026', log.description)

    def test_detail_view_includes_items(self):
        structure = FeeStructure.objects.create(grade_level=self.grade, term=self.term, name='Grade 7 - Term 2 2026')
        FeeStructureItem.objects.create(fee_structure=structure, category=FeeCategory.objects.create(name='Tuition'), amount=15000)
        response = self.call(FeeStructureDetailAPIView, 'get', f'/api/finance/fee-structures/{structure.id}/',
                             self.finance_user, structure_id=structure.id)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data['items']), 1)

    def test_detail_view_404_for_unknown_structure(self):
        response = self.call(FeeStructureDetailAPIView, 'get', '/api/finance/fee-structures/999999/',
                             self.finance_user, structure_id=999999)
        self.assertEqual(response.status_code, 404)


class StudentFeeItemEnrollmentSetAPITests(FinanceAPITestData):
    def setUp(self):
        super().setUp()
        self.structure = FeeStructure.objects.create(grade_level=self.grade, term=self.term, name='Grade 7 - Term 2 2026')
        self.transport_item = FeeStructureItem.objects.create(
            fee_structure=self.structure, category=FeeCategory.objects.create(name='Transport'), amount=3000, is_optional=True,
        )

    def put(self, item_id, payload, user=None):
        return self.call(StudentFeeItemEnrollmentSetAPIView, 'put', f'/api/finance/fee-structure-items/{item_id}/enrollments/',
                         user or self.finance_user, payload, item_id=item_id)

    def test_can_replace_the_enrollment_roster_for_an_item(self):
        student = self.make_student(1)
        response = self.put(self.transport_item.id, {'student_ids': [student.id]})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.transport_item.enrollments.count(), 1)
        self.assertEqual(response.data['enrolled_count'], 1)
        self.assertEqual(response.data['ignored_student_ids'], [])

    def test_replacing_removes_students_no_longer_listed(self):
        keep, drop, add = self.make_student(1), self.make_student(2), self.make_student(3)
        StudentFeeItemEnrollment.objects.create(student=keep, fee_structure_item=self.transport_item)
        StudentFeeItemEnrollment.objects.create(student=drop, fee_structure_item=self.transport_item)
        response = self.put(self.transport_item.id, {'student_ids': [keep.id, add.id]})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            set(self.transport_item.enrollments.values_list('student_id', flat=True)), {keep.id, add.id},
        )

    def test_unknown_student_ids_are_reported_as_ignored(self):
        student = self.make_student(1)
        response = self.put(self.transport_item.id, {'student_ids': [student.id, 999999]})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['enrolled_count'], 1)
        self.assertEqual(response.data['ignored_student_ids'], [999999])

    def test_duplicate_ids_in_the_request_do_not_break_the_roster(self):
        student = self.make_student(1)
        response = self.put(self.transport_item.id, {'student_ids': [student.id, student.id]})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.transport_item.enrollments.count(), 1)

    def test_unknown_item_is_a_404(self):
        response = self.put(999999, {'student_ids': []})
        self.assertEqual(response.status_code, 404)

    def test_non_list_student_ids_is_a_400(self):
        for bad in ('1,2,3', {'a': 1}, None, 5):
            response = self.put(self.transport_item.id, {'student_ids': bad})
            self.assertEqual(response.status_code, 400, bad)

    def test_missing_student_ids_is_a_400(self):
        self.assertEqual(self.put(self.transport_item.id, {}).status_code, 400)

    def test_non_integer_entries_are_a_400(self):
        for bad in (['a'], [1.5], [True], [None], [[1]]):
            response = self.put(self.transport_item.id, {'student_ids': bad})
            self.assertEqual(response.status_code, 400, bad)

    def test_mandatory_item_is_a_400(self):
        mandatory = FeeStructureItem.objects.create(
            fee_structure=self.structure, category=FeeCategory.objects.create(name='Tuition'), amount=15000, is_optional=False,
        )
        response = self.put(mandatory.id, {'student_ids': [self.make_student(1).id]})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(mandatory.enrollments.count(), 0)

    def test_view_only_user_cannot_put(self):
        response = self.put(self.transport_item.id, {'student_ids': []}, user=self.viewer_user)
        self.assertEqual(response.status_code, 403)

    def test_roster_replacement_writes_an_audit_log_with_counts(self):
        keep, drop = self.make_student(1), self.make_student(2)
        StudentFeeItemEnrollment.objects.create(student=drop, fee_structure_item=self.transport_item)
        self.put(self.transport_item.id, {'student_ids': [keep.id]})
        log = SystemAuditLog.objects.get(module='finance', action_type='UPDATE')
        self.assertEqual(log.operator_id, self.finance_user.id)
        self.assertIn(f'item {self.transport_item.id}', log.description)
        self.assertIn('1 -> 1', log.description)
