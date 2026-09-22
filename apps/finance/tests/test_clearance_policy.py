import json

from django.contrib.auth.models import User
from django.contrib.contenttypes.models import ContentType
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import IntegrityError, transaction
from django.test import RequestFactory, TestCase

from apps.academics.models import AcademicYear, Curriculum, ExamTerm, GradeLevel, Tier
from apps.core.models import SystemAuditLog
from apps.finance.models_fees import FeeCategory, FeeClearanceOverride, FeeClearancePolicy
from apps.finance.models_shared import FinancialRecordImmutableError
from apps.finance.services_fees import (
    get_fee_clearance_policy, grant_clearance_override, is_gate_blocked,
    post_ledger_entry, revoke_clearance_override, update_fee_clearance_policy,
)
from apps.finance.views_policy import (
    ClearanceOverrideListCreateAPIView, ClearanceOverrideRevokeAPIView, FeeClearancePolicyAPIView,
)
from apps.identity.models import Permission, Role, StudentExtra, UserRole


def setUpModule():
    """Ledger entries used to simulate a student balance reference a FeeCategory
    through a GenericForeignKey (see test_fee_clearance.setUpModule for the full
    rationale) -- pre-warm its ContentType row before any test transaction opens.
    FeeClearanceOverride itself has no GenericForeignKey (plain FKs only), so it
    needs no pre-warming."""
    ContentType.objects.get_for_model(FeeCategory)


class ClearancePolicyTestData(TestCase):
    def setUp(self):
        self.category = FeeCategory.objects.create(name='Tuition')
        self.operator = User.objects.create_user(username='policy_operator', password='x')
        curriculum = Curriculum.objects.create(name='CBC')
        tier = Tier.objects.create(name='Junior School', curriculum=curriculum)
        self.grade = GradeLevel.objects.create(
            name='Grade 7', numeric_order=7, curriculum_type='CBC', curriculum=curriculum, tier=tier,
        )
        self.year = AcademicYear.objects.create(year='2026', is_active=True)
        self.other_year = AcademicYear.objects.create(year='2027', is_active=False)
        self.term = ExamTerm.objects.create(name='Term 2', academic_year=self.year, start_date='2026-05-01', end_date='2026-08-01')
        self.other_term = ExamTerm.objects.create(name='Term 3', academic_year=self.year, start_date='2026-09-01', end_date='2026-11-01')

    def make_student(self, roll):
        user = User.objects.create_user(username=f'clr_policy_student_{roll}', password='x')
        return StudentExtra.objects.create(user=user, roll=roll)

    def make_user(self, username, codes):
        for code in codes:
            Permission.objects.get_or_create(code=code, defaults={'label': code, 'module': 'Finance'})
        user = User.objects.create_user(username=username, password='x')
        if codes:
            role = Role.objects.create(name=f'Role for {username}')
            role.permissions.set(Permission.objects.filter(code__in=codes))
            UserRole.objects.create(user=user, role=role)
        return user

    def charge(self, student, amount):
        return post_ledger_entry(
            student=student, entry_type='charge', amount=amount,
            reference=self.category, description='Test charge',
        )


class PolicyDefaultsAndSingletonTests(ClearancePolicyTestData):
    def test_defaults_are_off_and_zero(self):
        policy = get_fee_clearance_policy()
        self.assertFalse(policy.block_report_cards)
        self.assertFalse(policy.block_promotion)
        self.assertEqual(policy.grace_threshold, 0)

    def test_get_solo_returns_the_same_row_on_repeated_calls(self):
        # Proxy for the concurrent-first-read race: two calls must never create
        # two different row-1s.
        first = FeeClearancePolicy.get_solo()
        second = FeeClearancePolicy.get_solo()
        self.assertEqual(first.pk, 1)
        self.assertEqual(second.pk, 1)
        self.assertEqual(FeeClearancePolicy.objects.count(), 1)

    def test_save_always_forces_pk_1(self):
        policy = FeeClearancePolicy(pk=None, block_report_cards=True)
        policy.save()
        self.assertEqual(policy.pk, 1)
        self.assertEqual(FeeClearancePolicy.objects.count(), 1)

    def test_delete_is_disallowed(self):
        policy = FeeClearancePolicy.get_solo()
        with self.assertRaises(FinancialRecordImmutableError):
            policy.delete()
        self.assertTrue(FeeClearancePolicy.objects.filter(pk=1).exists())


class PolicyUpdateTests(ClearancePolicyTestData):
    def test_update_changes_fields_and_sets_updated_by(self):
        policy = update_fee_clearance_policy(
            updated_by=self.operator, block_report_cards=True, grace_threshold=500,
        )
        self.assertTrue(policy.block_report_cards)
        self.assertEqual(policy.grace_threshold, 500)
        self.assertFalse(policy.block_promotion)
        self.assertEqual(policy.updated_by, self.operator)

    def test_update_is_audit_logged_with_old_and_new_values(self):
        before = SystemAuditLog.objects.count()
        update_fee_clearance_policy(updated_by=self.operator, block_report_cards=True, grace_threshold=200)
        self.assertEqual(SystemAuditLog.objects.count(), before + 1)
        entry = SystemAuditLog.objects.latest('id')
        self.assertEqual(entry.module, 'finance')
        self.assertEqual(entry.action_type, 'UPDATE')
        self.assertIn('block_report_cards', entry.description)
        self.assertIn('False', entry.description)
        self.assertIn('True', entry.description)
        self.assertIn('grace_threshold', entry.description)

    def test_partial_update_leaves_other_fields_unchanged(self):
        update_fee_clearance_policy(updated_by=self.operator, block_report_cards=True)
        policy = update_fee_clearance_policy(updated_by=self.operator, grace_threshold=300)
        self.assertTrue(policy.block_report_cards)
        self.assertEqual(policy.grace_threshold, 300)

    def test_negative_grace_threshold_is_rejected(self):
        with self.assertRaises(ValidationError):
            update_fee_clearance_policy(updated_by=self.operator, grace_threshold=-1)
        self.assertEqual(get_fee_clearance_policy().grace_threshold, 0)

    def test_non_integer_grace_threshold_is_rejected(self):
        with self.assertRaises(ValidationError):
            update_fee_clearance_policy(updated_by=self.operator, grace_threshold='abc')
        with self.assertRaises(ValidationError):
            update_fee_clearance_policy(updated_by=self.operator, grace_threshold=1.5)


class IsGateBlockedTests(ClearancePolicyTestData):
    def setUp(self):
        super().setUp()
        self.student = self.make_student('GATE-1')

    def test_flag_off_returns_false_even_with_big_balance(self):
        self.charge(self.student, 1_000_000)
        self.assertFalse(is_gate_blocked(student_id=self.student.id, gate='report_card', term_id=self.term.id))
        self.assertFalse(is_gate_blocked(student_id=self.student.id, gate='promotion', academic_year_id=self.year.id))

    def test_flag_on_balance_above_grace_is_true(self):
        update_fee_clearance_policy(updated_by=self.operator, block_report_cards=True, grace_threshold=500)
        self.charge(self.student, 501)
        self.assertTrue(is_gate_blocked(student_id=self.student.id, gate='report_card', term_id=self.term.id))

    def test_flag_on_balance_at_grace_is_false(self):
        update_fee_clearance_policy(updated_by=self.operator, block_report_cards=True, grace_threshold=500)
        self.charge(self.student, 500)
        self.assertFalse(is_gate_blocked(student_id=self.student.id, gate='report_card', term_id=self.term.id))

    def test_flag_on_credit_balance_is_false(self):
        update_fee_clearance_policy(updated_by=self.operator, block_report_cards=True)
        self.charge(self.student, -3000)
        self.assertFalse(is_gate_blocked(student_id=self.student.id, gate='report_card', term_id=self.term.id))

    def test_flag_on_with_active_override_is_false(self):
        update_fee_clearance_policy(updated_by=self.operator, block_report_cards=True)
        self.charge(self.student, 5000)
        granter = self.make_user('gate_granter_1', ['finance.override_clearance'])
        grant_clearance_override(
            student=self.student, gate='report_card', granted_by=granter, reason='hardship', term=self.term,
        )
        self.assertFalse(is_gate_blocked(student_id=self.student.id, gate='report_card', term_id=self.term.id))

    def test_revoked_override_is_blocked_again(self):
        update_fee_clearance_policy(updated_by=self.operator, block_report_cards=True)
        self.charge(self.student, 5000)
        granter = self.make_user('gate_granter_2', ['finance.override_clearance'])
        override = grant_clearance_override(
            student=self.student, gate='report_card', granted_by=granter, reason='hardship', term=self.term,
        )
        self.assertFalse(is_gate_blocked(student_id=self.student.id, gate='report_card', term_id=self.term.id))
        revoke_clearance_override(override=override, revoked_by=granter, reason='mistake')
        self.assertTrue(is_gate_blocked(student_id=self.student.id, gate='report_card', term_id=self.term.id))

    def test_override_for_a_different_term_does_not_leak_protection(self):
        update_fee_clearance_policy(updated_by=self.operator, block_report_cards=True)
        self.charge(self.student, 5000)
        granter = self.make_user('gate_granter_3', ['finance.override_clearance'])
        grant_clearance_override(
            student=self.student, gate='report_card', granted_by=granter, reason='hardship', term=self.other_term,
        )
        self.assertTrue(is_gate_blocked(student_id=self.student.id, gate='report_card', term_id=self.term.id))

    def test_override_for_a_different_gate_does_not_leak_protection(self):
        update_fee_clearance_policy(updated_by=self.operator, block_report_cards=True, block_promotion=True)
        self.charge(self.student, 5000)
        granter = self.make_user('gate_granter_4', ['finance.override_clearance'])
        grant_clearance_override(
            student=self.student, gate='promotion', granted_by=granter, reason='hardship', academic_year=self.year,
        )
        self.assertTrue(is_gate_blocked(student_id=self.student.id, gate='report_card', term_id=self.term.id))

    def test_unknown_student_is_false(self):
        update_fee_clearance_policy(updated_by=self.operator, block_report_cards=True)
        self.assertFalse(is_gate_blocked(student_id=999999, gate='report_card', term_id=self.term.id))

    def test_promotion_gate_matrix(self):
        update_fee_clearance_policy(updated_by=self.operator, block_promotion=True, grace_threshold=100)
        self.charge(self.student, 100)
        self.assertFalse(is_gate_blocked(student_id=self.student.id, gate='promotion', academic_year_id=self.year.id))
        self.charge(self.student, 1)
        self.assertTrue(is_gate_blocked(student_id=self.student.id, gate='promotion', academic_year_id=self.year.id))
        granter = self.make_user('gate_granter_5', ['finance.override_clearance'])
        grant_clearance_override(
            student=self.student, gate='promotion', granted_by=granter, reason='hardship', academic_year=self.year,
        )
        self.assertFalse(is_gate_blocked(student_id=self.student.id, gate='promotion', academic_year_id=self.year.id))
        # A different year must not benefit from this year's override.
        self.assertTrue(is_gate_blocked(student_id=self.student.id, gate='promotion', academic_year_id=self.other_year.id))


class GrantOverrideTests(ClearancePolicyTestData):
    def setUp(self):
        super().setUp()
        self.student = self.make_student('GRANT-1')
        self.holder = self.make_user('override_holder_1', ['finance.override_clearance'])
        self.non_holder = self.make_user('non_override_holder_1', ['finance.view'])

    def test_grant_requires_the_permission(self):
        with self.assertRaises(PermissionDenied):
            grant_clearance_override(
                student=self.student, gate='report_card', granted_by=self.non_holder, reason='x', term=self.term,
            )
        self.assertFalse(FeeClearanceOverride.objects.exists())

    def test_reason_is_required(self):
        with self.assertRaises(ValidationError):
            grant_clearance_override(
                student=self.student, gate='report_card', granted_by=self.holder, reason='   ', term=self.term,
            )
        self.assertFalse(FeeClearanceOverride.objects.exists())

    def test_report_card_override_requires_a_term(self):
        with self.assertRaises(ValidationError):
            grant_clearance_override(
                student=self.student, gate='report_card', granted_by=self.holder, reason='hardship',
            )

    def test_promotion_override_requires_an_academic_year(self):
        with self.assertRaises(ValidationError):
            grant_clearance_override(
                student=self.student, gate='promotion', granted_by=self.holder, reason='hardship',
            )

    def test_duplicate_active_override_same_scope_is_rejected(self):
        grant_clearance_override(
            student=self.student, gate='report_card', granted_by=self.holder, reason='first', term=self.term,
        )
        with self.assertRaises(ValidationError):
            grant_clearance_override(
                student=self.student, gate='report_card', granted_by=self.holder, reason='second', term=self.term,
            )
        self.assertEqual(FeeClearanceOverride.objects.count(), 1)

    def test_duplicate_allowed_for_a_different_term(self):
        grant_clearance_override(
            student=self.student, gate='report_card', granted_by=self.holder, reason='first', term=self.term,
        )
        grant_clearance_override(
            student=self.student, gate='report_card', granted_by=self.holder, reason='second', term=self.other_term,
        )
        self.assertEqual(FeeClearanceOverride.objects.count(), 2)

    def test_report_card_override_rejects_academic_year_also_set(self):
        with self.assertRaises(ValidationError):
            grant_clearance_override(
                student=self.student, gate='report_card', granted_by=self.holder, reason='hardship',
                term=self.term, academic_year=self.year,
            )
        self.assertFalse(FeeClearanceOverride.objects.exists())

    def test_promotion_override_rejects_term_also_set(self):
        with self.assertRaises(ValidationError):
            grant_clearance_override(
                student=self.student, gate='promotion', granted_by=self.holder, reason='hardship',
                academic_year=self.year, term=self.term,
            )
        self.assertFalse(FeeClearanceOverride.objects.exists())

    def test_grant_is_audit_logged(self):
        before = SystemAuditLog.objects.count()
        grant_clearance_override(
            student=self.student, gate='report_card', granted_by=self.holder, reason='hardship', term=self.term,
        )
        self.assertEqual(SystemAuditLog.objects.count(), before + 1)
        entry = SystemAuditLog.objects.latest('id')
        self.assertEqual(entry.module, 'finance')
        self.assertEqual(entry.action_type, 'CREATE')

    def test_override_fields_are_immutable(self):
        override = grant_clearance_override(
            student=self.student, gate='report_card', granted_by=self.holder, reason='hardship', term=self.term,
        )
        override.reason = 'changed'
        with self.assertRaises(FinancialRecordImmutableError):
            override.save()


class RevokeOverrideTests(ClearancePolicyTestData):
    def setUp(self):
        super().setUp()
        self.student = self.make_student('REVOKE-1')
        self.holder = self.make_user('override_holder_2', ['finance.override_clearance'])
        self.non_holder = self.make_user('non_override_holder_2', ['finance.view'])
        self.override = grant_clearance_override(
            student=self.student, gate='report_card', granted_by=self.holder, reason='hardship', term=self.term,
        )

    def test_revoke_sets_fields(self):
        revoked = revoke_clearance_override(override=self.override, revoked_by=self.holder, reason='mistake')
        self.assertIsNotNone(revoked.revoked_at)
        self.assertEqual(revoked.revoked_by, self.holder)
        self.assertEqual(revoked.revoke_reason, 'mistake')

    def test_revoke_requires_the_permission(self):
        with self.assertRaises(PermissionDenied):
            revoke_clearance_override(override=self.override, revoked_by=self.non_holder, reason='mistake')
        self.override.refresh_from_db()
        self.assertIsNone(self.override.revoked_at)

    def test_revoke_reason_is_required(self):
        with self.assertRaises(ValidationError):
            revoke_clearance_override(override=self.override, revoked_by=self.holder, reason='')

    def test_double_revoke_via_stale_object_is_rejected(self):
        stale = FeeClearanceOverride.objects.get(pk=self.override.pk)  # revoked_at still None in memory
        revoke_clearance_override(override=self.override, revoked_by=self.holder, reason='first')
        with self.assertRaises(ValidationError):
            revoke_clearance_override(override=stale, revoked_by=self.holder, reason='second')

    def test_revoke_is_audit_logged(self):
        before = SystemAuditLog.objects.count()
        revoke_clearance_override(override=self.override, revoked_by=self.holder, reason='mistake')
        self.assertEqual(SystemAuditLog.objects.count(), before + 1)
        entry = SystemAuditLog.objects.latest('id')
        self.assertEqual(entry.module, 'finance')
        self.assertEqual(entry.action_type, 'DELETE')

    def test_after_revoke_a_new_override_can_be_granted_for_the_same_scope(self):
        revoke_clearance_override(override=self.override, revoked_by=self.holder, reason='mistake')
        second = grant_clearance_override(
            student=self.student, gate='report_card', granted_by=self.holder, reason='again', term=self.term,
        )
        self.assertIsNone(second.revoked_at)
        self.assertEqual(FeeClearanceOverride.objects.filter(student=self.student, gate='report_card', term=self.term).count(), 2)


class TwoGateUniquenessConstraintTests(ClearancePolicyTestData):
    """Exercises the DB constraint directly (bypassing the service's own
    pre-check) to prove the partial index itself does the job for BOTH gates."""

    def setUp(self):
        super().setUp()
        self.student = self.make_student('CONSTRAINT-1')
        self.holder = self.make_user('constraint_holder', ['finance.override_clearance'])

    def _create(self, **kwargs):
        defaults = dict(student=self.student, reason='x', granted_by=self.holder)
        defaults.update(kwargs)
        return FeeClearanceOverride.objects.create(**defaults)

    def test_two_active_report_card_overrides_same_term_violate_the_constraint(self):
        self._create(gate='report_card', term=self.term)
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                self._create(gate='report_card', term=self.term)

    def test_two_active_promotion_overrides_same_year_violate_the_constraint(self):
        self._create(gate='promotion', academic_year=self.year)
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                self._create(gate='promotion', academic_year=self.year)

    def test_report_card_and_promotion_overrides_for_the_same_student_do_not_collide(self):
        # Different gates, one keyed on term and the other on academic_year --
        # neither partial constraint's condition matches the other gate's rows.
        self._create(gate='report_card', term=self.term)
        self._create(gate='promotion', academic_year=self.year)
        self.assertEqual(FeeClearanceOverride.objects.filter(student=self.student).count(), 2)

    def test_revoked_row_does_not_block_a_new_active_one(self):
        first = self._create(gate='report_card', term=self.term)
        first.revoked_at = first.created_at
        first.save(update_fields=['revoked_at'])
        self._create(gate='report_card', term=self.term)
        self.assertEqual(FeeClearanceOverride.objects.filter(student=self.student, gate='report_card', term=self.term).count(), 2)


FINANCE_POLICY_CODES = ['finance.view', 'finance.edit', 'finance.override_clearance']


class ClearancePolicyAPITestData(ClearancePolicyTestData):
    def setUp(self):
        super().setUp()
        self.factory = RequestFactory()
        self.student = self.make_student('API-1')

    def _request(self, method, path, user, payload=None):
        kwargs = {}
        if payload is not None:
            kwargs = {'data': json.dumps(payload), 'content_type': 'application/json'}
        request = getattr(self.factory, method)(path, **kwargs)
        request.user = user
        # SessionAuthentication.authenticate() enforces CSRF whenever request.user is
        # already set, which a RequestFactory-built request can't satisfy -- same fix
        # as ActivateFeeStructureAPIViewTests in test_bulk_invoice_generation.py.
        request._dont_enforce_csrf_checks = True
        return request


class FeeClearancePolicyAPITests(ClearancePolicyAPITestData):
    def setUp(self):
        super().setUp()
        self.viewer = self.make_user('policy_api_viewer', ['finance.view'])
        self.editor = self.make_user('policy_api_editor', ['finance.edit'])

    def test_get_requires_finance_view(self):
        stranger = self.make_user('policy_api_stranger', [])
        request = self._request('get', '/x/', stranger)
        response = FeeClearancePolicyAPIView.as_view()(request)
        self.assertEqual(response.status_code, 403)

    def test_get_returns_the_policy(self):
        request = self._request('get', '/x/', self.viewer)
        response = FeeClearancePolicyAPIView.as_view()(request)
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data['block_report_cards'])
        self.assertEqual(response.data['grace_threshold'], 0)

    def test_put_requires_finance_edit_not_just_view(self):
        request = self._request('put', '/x/', self.viewer, {'block_report_cards': True})
        response = FeeClearancePolicyAPIView.as_view()(request)
        self.assertEqual(response.status_code, 403)

    def test_put_updates_the_policy(self):
        request = self._request('put', '/x/', self.editor, {'block_report_cards': True, 'grace_threshold': 250})
        response = FeeClearancePolicyAPIView.as_view()(request)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data['block_report_cards'])
        self.assertEqual(response.data['grace_threshold'], 250)

    def test_put_bad_input_is_a_400_not_a_500(self):
        for payload in ({'grace_threshold': -1}, {'grace_threshold': 'abc'}, {'block_report_cards': 'maybe'}):
            request = self._request('put', '/x/', self.editor, payload)
            response = FeeClearancePolicyAPIView.as_view()(request)
            self.assertEqual(response.status_code, 400, payload)

    def test_patch_partial_update(self):
        request = self._request('patch', '/x/', self.editor, {'grace_threshold': 75})
        response = FeeClearancePolicyAPIView.as_view()(request)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['grace_threshold'], 75)
        self.assertFalse(response.data['block_report_cards'])


class ClearanceOverrideAPITests(ClearancePolicyAPITestData):
    def setUp(self):
        super().setUp()
        self.viewer = self.make_user('override_api_viewer', ['finance.view'])
        self.holder = self.make_user('override_api_holder', ['finance.override_clearance'])

    def test_post_requires_override_clearance_not_just_view(self):
        request = self._request(
            'post', '/x/', self.viewer,
            {'student': self.student.id, 'gate': 'report_card', 'term': self.term.id, 'reason': 'x'},
        )
        response = ClearanceOverrideListCreateAPIView.as_view()(request)
        self.assertEqual(response.status_code, 403)
        self.assertFalse(FeeClearanceOverride.objects.exists())

    def test_post_creates_an_override(self):
        request = self._request(
            'post', '/x/', self.holder,
            {'student': self.student.id, 'gate': 'report_card', 'term': self.term.id, 'reason': 'hardship'},
        )
        response = ClearanceOverrideListCreateAPIView.as_view()(request)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['gate'], 'report_card')
        self.assertEqual(response.data['reason'], 'hardship')

    def test_post_bad_input_is_a_400_not_a_500(self):
        bad_payloads = [
            {'student': self.student.id, 'gate': 'report_card', 'reason': 'x'},  # missing term
            {'student': self.student.id, 'gate': 'bogus', 'term': self.term.id, 'reason': 'x'},
            {'student': self.student.id, 'gate': 'report_card', 'term': self.term.id, 'reason': ''},
            {'student': 99999999, 'gate': 'report_card', 'term': self.term.id, 'reason': 'x'},
        ]
        for payload in bad_payloads:
            request = self._request('post', '/x/', self.holder, payload)
            response = ClearanceOverrideListCreateAPIView.as_view()(request)
            self.assertEqual(response.status_code, 400, payload)
        self.assertFalse(FeeClearanceOverride.objects.exists())

    def test_post_both_scope_fields_set_is_a_clean_400(self):
        request = self._request(
            'post', '/x/', self.holder,
            {
                'student': self.student.id, 'gate': 'report_card',
                'term': self.term.id, 'academic_year': self.year.id, 'reason': 'hardship',
            },
        )
        response = ClearanceOverrideListCreateAPIView.as_view()(request)
        self.assertEqual(response.status_code, 400)
        self.assertNotIn("['", response.data['error'])
        self.assertFalse(FeeClearanceOverride.objects.exists())

    def test_get_lists_and_filters_by_student_and_gate(self):
        grant_clearance_override(student=self.student, gate='report_card', granted_by=self.holder, reason='x', term=self.term)
        other = self.make_student('API-2')
        grant_clearance_override(student=other, gate='promotion', granted_by=self.holder, reason='y', academic_year=self.year)
        request = self._request('get', f'/x/?student_id={self.student.id}', self.viewer)
        response = ClearanceOverrideListCreateAPIView.as_view()(request)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)
        request = self._request('get', '/x/?gate=promotion', self.viewer)
        response = ClearanceOverrideListCreateAPIView.as_view()(request)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]['gate'], 'promotion')

    def test_get_requires_finance_view(self):
        stranger = self.make_user('override_api_stranger', [])
        request = self._request('get', '/x/', stranger)
        response = ClearanceOverrideListCreateAPIView.as_view()(request)
        self.assertEqual(response.status_code, 403)


class ClearanceOverrideRevokeAPITests(ClearancePolicyAPITestData):
    def setUp(self):
        super().setUp()
        self.holder = self.make_user('revoke_api_holder', ['finance.override_clearance'])
        self.viewer = self.make_user('revoke_api_viewer', ['finance.view'])
        self.override = grant_clearance_override(
            student=self.student, gate='report_card', granted_by=self.holder, reason='hardship', term=self.term,
        )

    def _revoke(self, user, override_id, reason='mistake'):
        request = self._request('post', '/x/', user, {'reason': reason})
        return ClearanceOverrideRevokeAPIView.as_view()(request, override_id=override_id)

    def test_revoke_requires_override_clearance_not_just_view(self):
        response = self._revoke(self.viewer, self.override.id)
        self.assertEqual(response.status_code, 403)

    def test_revoke_succeeds(self):
        response = self._revoke(self.holder, self.override.id)
        self.assertEqual(response.status_code, 200)
        self.assertIsNotNone(response.data['revoked_at'])

    def test_revoke_missing_override_is_404(self):
        response = self._revoke(self.holder, 99999999)
        self.assertEqual(response.status_code, 404)

    def test_revoke_twice_is_a_clean_400(self):
        self._revoke(self.holder, self.override.id)
        response = self._revoke(self.holder, self.override.id)
        self.assertEqual(response.status_code, 400)
        self.assertNotIn("['", response.data['error'])
