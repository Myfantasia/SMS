from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIRequestFactory

from apps.identity.models import StudentExtra, ParentExtra
from apps.finance.models_fees import FeeCategory
from apps.finance.services_fees import post_ledger_entry
from apps.finance.views import StudentFeeLedgerStatementAPIView, MyFeeLedgerAPIView


class LedgerStatementAuthorizationTests(TestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        student_user = User.objects.create_user(username='ledger_auth_student', password='x')
        # `roll` is unique=True on StudentExtra (see apps/identity/models.py) -- the brief's
        # fixture omitted it, which collides between self.student and self.other_student
        # below since both would default to roll=''. Explicit unique rolls, matching the
        # precedent in apps/finance/tests/test_documents.py / test_views_invoices_payments.py.
        self.student = StudentExtra.objects.create(user=student_user, roll='LEDGER-AUTH-1')
        self.category = FeeCategory.objects.create(name='Tuition')
        post_ledger_entry(student=self.student, entry_type='charge', amount=8000, reference=self.category, description='Term fee')

        parent_user = User.objects.create_user(username='ledger_auth_parent', password='x')
        # `status=True` marks the parent link as approved -- `_can_view_student_statement`
        # in apps/finance/views.py gates on it (see apps/finance/tests/test_documents.py's
        # precedent), so an unapproved parent (the model default) would get 403 here.
        self.parent = ParentExtra.objects.create(user=parent_user, mobile='0700', status=True)
        self.parent.students.add(self.student)

        other_student_user = User.objects.create_user(username='ledger_auth_other_student', password='x')
        self.other_student = StudentExtra.objects.create(user=other_student_user, roll='LEDGER-AUTH-2')

    def test_student_can_view_own_ledger_by_id(self):
        request = self.factory.get(f'/api/finance/students/{self.student.id}/ledger/')
        request.user = self.student.user
        response = StudentFeeLedgerStatementAPIView.as_view()(request, student_id=self.student.id)
        self.assertEqual(response.status_code, 200)

    def test_student_cannot_view_someone_elses_ledger(self):
        request = self.factory.get(f'/api/finance/students/{self.other_student.id}/ledger/')
        request.user = self.student.user
        response = StudentFeeLedgerStatementAPIView.as_view()(request, student_id=self.other_student.id)
        self.assertEqual(response.status_code, 403)

    def test_parent_can_view_own_childs_ledger(self):
        request = self.factory.get(f'/api/finance/students/{self.student.id}/ledger/')
        request.user = self.parent.user
        response = StudentFeeLedgerStatementAPIView.as_view()(request, student_id=self.student.id)
        self.assertEqual(response.status_code, 200)

    def test_parent_cannot_view_a_non_child_students_ledger(self):
        request = self.factory.get(f'/api/finance/students/{self.other_student.id}/ledger/')
        request.user = self.parent.user
        response = StudentFeeLedgerStatementAPIView.as_view()(request, student_id=self.other_student.id)
        self.assertEqual(response.status_code, 403)

    def test_my_ledger_resolves_current_student_without_an_id(self):
        request = self.factory.get('/api/finance/students/me/ledger/')
        request.user = self.student.user
        response = MyFeeLedgerAPIView.as_view()(request)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['balance'], 8000)

    def test_my_ledger_rejects_a_user_with_no_student_profile(self):
        request = self.factory.get('/api/finance/students/me/ledger/')
        request.user = self.parent.user
        response = MyFeeLedgerAPIView.as_view()(request)
        self.assertEqual(response.status_code, 403)
