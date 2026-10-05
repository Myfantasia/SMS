"""Activating a fee structure: refused with no line items, audited when it succeeds.
Does not touch StudentFeeAdjustment.invoice, so it runs before the user's migration."""
from unittest import mock

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.academics.models import AcademicYear, Curriculum, ExamTerm, GradeLevel, Tier
from apps.core.models import SystemAuditLog
from apps.finance.models_fees import FeeCategory, FeeStructure, FeeStructureItem
from apps.finance.views import ActivateFeeStructureAPIView
from apps.identity.models import Permission, Role, UserRole


class ActivateFeeStructureTests(TestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        curriculum = Curriculum.objects.create(name='CBC')
        tier = Tier.objects.create(name='Junior School', curriculum=curriculum)
        grade = GradeLevel.objects.create(
            name='Grade 7', numeric_order=7, curriculum_type='CBC', curriculum=curriculum, tier=tier,
        )
        year = AcademicYear.objects.create(year='2026', is_active=True)
        term = ExamTerm.objects.create(name='Term 2', academic_year=year, start_date='2026-05-01', end_date='2026-08-01')
        self.empty = FeeStructure.objects.create(grade_level=grade, term=term, name='Empty structure')
        self.filled = FeeStructure.objects.create(
            grade_level=GradeLevel.objects.create(
                name='Grade 8', numeric_order=8, curriculum_type='CBC', curriculum=curriculum, tier=tier,
            ),
            term=term, name='Filled structure',
        )
        FeeStructureItem.objects.create(
            fee_structure=self.filled, category=FeeCategory.objects.create(name='Tuition'), amount=15000,
        )
        self.user = self.make_user('activation_operator', ['finance.view', 'finance.edit'])

    def make_user(self, username, codes):
        for code in codes:
            Permission.objects.get_or_create(code=code, defaults={'label': code, 'module': 'Finance'})
        user = User.objects.create_user(username=username, password='x')
        role = Role.objects.create(name=f'Role for {username}')
        role.permissions.set(Permission.objects.filter(code__in=codes))
        UserRole.objects.create(user=user, role=role)
        return user

    def activate(self, structure):
        request = self.factory.post(f'/api/finance/fee-structures/{structure.id}/activate/')
        force_authenticate(request, user=self.user)
        return ActivateFeeStructureAPIView.as_view()(request, structure_id=structure.id)

    def test_structure_with_no_items_is_refused_and_not_dispatched(self):
        with mock.patch('apps.finance.views.dispatch_background_job') as dispatch:
            response = self.activate(self.empty)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.data['error'],
            'A fee structure needs at least one line item before it can be activated.',
        )
        dispatch.assert_not_called()
        self.empty.refresh_from_db()
        self.assertEqual(self.empty.status, 'draft')

    def test_structure_with_items_activates_and_is_audited(self):
        job = mock.Mock(id='11111111-1111-1111-1111-111111111111')
        with mock.patch('apps.finance.views.dispatch_background_job', return_value=(job, None)):
            response = self.activate(self.filled)
        self.assertEqual(response.status_code, 202)
        self.filled.refresh_from_db()
        self.assertEqual(self.filled.status, 'active')
        audit = SystemAuditLog.objects.filter(
            module='finance', action_type='UPDATE', description=f"Activated fee structure 'Filled structure' (id {self.filled.id})",
        )
        self.assertEqual(audit.count(), 1)
        self.assertEqual(audit.get().operator_id, self.user.id)
