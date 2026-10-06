"""
Leave for teachers AND staff, with the school's approval rules:
  * every teacher and staff member can apply for their own leave (no permission needed);
  * an admin, or anyone granted `leave.approve`, can decide both teacher and staff requests;
  * nobody decides their own request;
  * an approver's OWN leave can only be decided by an admin.

The rules themselves are a pure function (apps.staff.services.can_decide_leave) so they are tested
exhaustively without a database. The API tests need the `staff` column on the leave table -- a model
change whose migration you run yourself -- so they skip themselves until that migration exists.
"""
import unittest
from datetime import date

from django.contrib.auth.models import Group, User
from django.db.migrations.loader import MigrationLoader
from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from apps.staff.services import can_decide_leave


def _leave_migration_exists():
    """True once a migration adding TeacherLeave.staff is present (i.e. after you've run
    `makemigrations staff`), so these tests switch on by themselves."""
    try:
        state = MigrationLoader(None, ignore_no_migrations=True).project_state()
        return 'staff' in dict(state.models[('staff', 'teacherleave')].fields)
    except Exception:
        return False


class CanDecideLeaveRulesTests(SimpleTestCase):
    """Every branch of the approval rules, as a table."""

    def _decide(self, **overrides):
        args = dict(
            decider_user_id=1, decider_is_admin=False, decider_can_approve=True,
            applicant_user_id=2, applicant_can_approve=False,
        )
        args.update(overrides)
        return can_decide_leave(**args)

    def test_an_approver_can_decide_an_ordinary_request(self):
        self.assertEqual(self._decide(), (True, ''))

    def test_an_admin_can_decide_an_ordinary_request(self):
        self.assertTrue(self._decide(decider_is_admin=True, decider_can_approve=False)[0])

    def test_someone_with_neither_admin_nor_approve_cannot_decide(self):
        allowed, reason = self._decide(decider_can_approve=False)
        self.assertFalse(allowed)
        self.assertIn('permission', reason)

    def test_nobody_decides_their_own_request_not_even_an_admin(self):
        for is_admin, can_approve in [(False, True), (True, False), (True, True)]:
            allowed, reason = self._decide(
                decider_user_id=5, applicant_user_id=5, decider_is_admin=is_admin, decider_can_approve=can_approve)
            self.assertFalse(allowed, (is_admin, can_approve))
            self.assertIn('own', reason)

    def test_an_approvers_own_leave_cannot_be_decided_by_another_approver(self):
        allowed, reason = self._decide(applicant_can_approve=True)
        self.assertFalse(allowed)
        self.assertIn('administrator', reason)

    def test_an_approvers_own_leave_can_be_decided_by_an_admin(self):
        self.assertTrue(self._decide(applicant_can_approve=True, decider_is_admin=True, decider_can_approve=False)[0])


@unittest.skipUnless(_leave_migration_exists(), "Needs the migration for TeacherLeave.staff: run `makemigrations staff` and `migrate`.")
class LeaveApiTests(TestCase):
    URL = '/api/core/leaves/'
    PAYLOAD = {'leave_type': 'Casual', 'start_date': '2106-02-01', 'end_date': '2106-02-03', 'reason': 'Family matter'}

    @classmethod
    def setUpTestData(cls):
        from apps.identity.models import Permission, Role, StaffExtra, TeacherExtra, UserRole

        def perm(code):
            return Permission.objects.get_or_create(code=code, defaults={'label': code, 'module': 'Leave'})[0]

        def make_user(name, **kw):
            return User.objects.create_user(username=name, password='x', first_name=name.title(), last_name='T', **kw)

        def give(user, role_name, codes):
            role, _ = Role.objects.get_or_create(name=role_name)
            role.permissions.add(*[perm(c) for c in codes])
            UserRole.objects.get_or_create(user=user, role=role)

        admin_group, _ = Group.objects.get_or_create(name='ADMIN')
        cls.admin = make_user('lv_admin', is_superuser=True)
        cls.admin.groups.add(admin_group)

        cls.staff_a = make_user('lv_staff_a')     # ordinary staff
        cls.staff_a_profile = StaffExtra.objects.create(user=cls.staff_a, status=True)
        cls.approver1 = make_user('lv_approver1')  # staff approver
        cls.approver1_profile = StaffExtra.objects.create(user=cls.approver1, status=True)
        give(cls.approver1, 'Leave Approver', ['leave.view', 'leave.approve'])
        cls.approver2 = make_user('lv_approver2')  # another staff approver
        cls.approver2_profile = StaffExtra.objects.create(user=cls.approver2, status=True)
        give(cls.approver2, 'Leave Approver', ['leave.view', 'leave.approve'])
        cls.viewer = make_user('lv_viewer')        # staff who may only look
        StaffExtra.objects.create(user=cls.viewer, status=True)
        give(cls.viewer, 'Leave Viewer', ['leave.view'])

        cls.teacher_user = make_user('lv_teacher')
        cls.teacher = TeacherExtra.objects.create(user=cls.teacher_user, status=True)

    def _client(self, user):
        client = APIClient()
        client.force_authenticate(user)
        return client

    def _apply(self, user):
        return self._client(user).post(self.URL, self.PAYLOAD, format='json')

    def _decide(self, user, leave_id, new_status='Approved', **extra):
        return self._client(user).patch(f'{self.URL}{leave_id}/', {'status': new_status, **extra}, format='json')

    # --- applying ---------------------------------------------------------------------
    def test_staff_can_apply_for_their_own_leave_without_any_permission(self):
        resp = self._apply(self.staff_a)
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data['status'], 'Pending')
        self.assertEqual(resp.data['applicant_type'], 'staff')
        self.assertEqual(resp.data['staff'], self.staff_a_profile.id)
        self.assertIsNone(resp.data['teacher'])

    def test_teachers_still_apply_as_before(self):
        resp = self._apply(self.teacher_user)
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data['applicant_type'], 'teacher')
        self.assertEqual(resp.data['teacher'], self.teacher.id)

    def test_applying_notifies_admins_and_approvers_but_not_the_applicant(self):
        from apps.messaging.models import Notification
        self._apply(self.staff_a)
        notified = set(Notification.objects.filter(title='New Leave Request').values_list('recipient__username', flat=True))
        self.assertEqual(notified, {'lv_admin', 'lv_approver1', 'lv_approver2'})

    def test_an_approvers_own_request_notifies_only_admins(self):
        from apps.messaging.models import Notification
        self._apply(self.approver1)
        notified = set(Notification.objects.filter(title='New Leave Request').values_list('recipient__username', flat=True))
        self.assertEqual(notified, {'lv_admin'})

    # --- deciding ---------------------------------------------------------------------
    def test_an_approver_can_approve_a_staff_request_and_a_teacher_request(self):
        staff_leave = self._apply(self.staff_a).data['id']
        teacher_leave = self._apply(self.teacher_user).data['id']
        self.assertEqual(self._decide(self.approver1, staff_leave).status_code, 200)
        self.assertEqual(self._decide(self.approver1, teacher_leave, 'Rejected').status_code, 200)

    def test_the_applicant_is_told_the_decision(self):
        from apps.messaging.models import Notification
        leave_id = self._apply(self.staff_a).data['id']
        self._decide(self.approver1, leave_id)
        note = Notification.objects.get(recipient=self.staff_a, title='Leave Approved')
        self.assertEqual(note.action_url, '/staff-dashboard/leave-requests')

    def test_nobody_can_approve_their_own_request(self):
        own = self._apply(self.approver1).data['id']
        self.assertEqual(self._decide(self.approver1, own).status_code, 403)

    def test_an_approver_cannot_approve_another_approvers_request_but_an_admin_can(self):
        leave_id = self._apply(self.approver1).data['id']
        self.assertEqual(self._decide(self.approver2, leave_id).status_code, 403)
        self.assertEqual(self._decide(self.admin, leave_id).status_code, 200)

    def test_someone_who_can_only_view_cannot_decide(self):
        leave_id = self._apply(self.staff_a).data['id']
        self.assertEqual(self._decide(self.viewer, leave_id).status_code, 403)

    def test_a_requester_cannot_approve_their_own_request_by_editing_it(self):
        # staff_a holds no leave.approve, so this is also rejected for lack of permission --
        # test_nobody_can_approve_their_own_request below covers the sharper case where the
        # requester DOES hold leave.approve and must still be refused.
        leave_id = self._apply(self.staff_a).data['id']
        resp = self._decide(self.staff_a, leave_id)
        self.assertEqual(resp.status_code, 403)
        from apps.staff.models import TeacherLeave
        self.assertEqual(TeacherLeave.objects.get(pk=leave_id).status, 'Pending')

    def test_an_approver_cannot_assign_a_relief_teacher_without_timetable_rights(self):
        leave_id = self._apply(self.teacher_user).data['id']
        resp = self._decide(self.approver1, leave_id, relief_teacher_id=self.teacher.id)
        self.assertEqual(resp.status_code, 403)

    # --- who sees what ----------------------------------------------------------------
    @staticmethod
    def _rows(response):
        data = response.json()
        return data['results'] if isinstance(data, dict) else data

    def test_ordinary_staff_only_see_their_own_requests(self):
        mine = self._apply(self.staff_a).data['id']
        self._apply(self.teacher_user)
        rows = self._rows(self._client(self.staff_a).get(self.URL))
        self.assertEqual([r['id'] for r in rows], [mine])

    def test_an_approver_sees_everyones_requests_but_mine_narrows_to_their_own(self):
        self._apply(self.staff_a)
        own = self._apply(self.approver1).data['id']
        client = self._client(self.approver1)
        self.assertEqual(len(self._rows(client.get(self.URL))), 2)
        self.assertEqual([r['id'] for r in self._rows(client.get(self.URL + '?mine=1'))], [own])

    # --- editing / cancelling your own ------------------------------------------------
    def test_you_can_cancel_your_own_pending_request(self):
        leave_id = self._apply(self.staff_a).data['id']
        self.assertEqual(self._client(self.staff_a).delete(f'{self.URL}{leave_id}/').status_code, 204)

    def test_you_cannot_cancel_a_decided_request(self):
        leave_id = self._apply(self.staff_a).data['id']
        self._decide(self.approver1, leave_id)
        self.assertEqual(self._client(self.staff_a).delete(f'{self.URL}{leave_id}/').status_code, 403)

    # --- data integrity ---------------------------------------------------------------
    def test_a_request_must_belong_to_exactly_one_applicant(self):
        from django.core.exceptions import ValidationError
        from apps.staff.models import TeacherLeave
        for kwargs in ({}, {'teacher': self.teacher, 'staff': self.staff_a_profile}):
            with self.assertRaises(ValidationError):
                TeacherLeave.objects.create(
                    leave_type='Casual', start_date=date(2106, 3, 1), end_date=date(2106, 3, 2), **kwargs)
