"""
Admin/Teacher access used to come purely from raw Django-group membership — the RBAC
Role/Permission system never got consulted for them, only for Staff. This pins down the
switch: new admins/teachers are auto-assigned the matching system Role at the exact moment
Group membership is granted, previously admin-only-bypass endpoints now honor a scoped
custom Role instead of requiring full ADMIN-group membership, and a couple of related
hardening fixes (Notifications create, report-card publish) from the same pass.
"""
from django.contrib.auth.hashers import make_password
from django.contrib.auth.models import Group, User
from django.core.cache import cache
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from apps.identity.models import AdminExtra
from apps.messaging.models import Notification
from apps.identity.models import Permission, Role, UserRole


class AdminApprovalAutoAssignsRoleTests(TestCase):
    def setUp(self):
        cache.clear()
        Role.objects.get_or_create(name='Admin', defaults={'description': 'Full access to every module.', 'is_system_role': True})
        self.pending_user = User.objects.create_user(
            username='pending_admin', email='pending@rbac.test', password='correct-horse')
        self.admin_extra = AdminExtra.objects.create(
            user=self.pending_user, status=False,
            verification_code=make_password('123456'), code_generated_at=timezone.now(),
        )

    def test_verifying_the_code_assigns_the_admin_role(self):
        self.assertFalse(UserRole.objects.filter(user=self.pending_user, role__name='Admin').exists())

        response = self.client.post(reverse('api_public_login_admin'), {
            'verification_code': '123456', 'verify_email': 'pending@rbac.test',
        })
        self.assertIn('verified', response.json()['message'])
        self.assertTrue(UserRole.objects.filter(user=self.pending_user, role__name='Admin').exists())

    def test_missing_admin_role_does_not_block_verification(self):
        # If `seed_rbac` was never run, the 'Admin' Role row won't exist — verification
        # (and ADMIN-group membership) must still succeed rather than 500ing.
        Role.objects.filter(name='Admin').delete()
        response = self.client.post(reverse('api_public_login_admin'), {
            'verification_code': '123456', 'verify_email': 'pending@rbac.test',
        })
        self.assertIn('verified', response.json()['message'])
        self.pending_user.refresh_from_db()
        self.assertTrue(self.pending_user.groups.filter(name='ADMIN').exists())


class TeacherSignupAutoAssignsRoleTests(TestCase):
    def setUp(self):
        cache.clear()
        Role.objects.get_or_create(name='Teacher', defaults={'description': 'Day-to-day teaching modules.', 'is_system_role': True})

    def test_signup_assigns_the_teacher_role(self):
        response = self.client.post(reverse('api_public_signup_teacher'), {
            'first_name': 'Tess', 'last_name': 'Teacher', 'username': 'tess_teacher',
            'email': 'tess@rbac.test', 'password': 'correct-horse', 'password2': 'correct-horse',
            'id_number': '12345678', 'mobile': '+254712345678', 'address': '1 Main St',
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['status'], 'success')
        user = User.objects.get(username='tess_teacher')
        self.assertTrue(UserRole.objects.filter(user=user, role__name='Teacher').exists())


class ScopedAdminEndpointTests(TestCase):
    """The concrete "different types of admins" proof: a user with no ADMIN-group
    membership at all, holding only a narrow custom Role, gets exactly what that Role
    grants — not full admin access — on the endpoints that used to be all-or-nothing."""

    def setUp(self):
        cache.clear()
        self.users_view = Permission.objects.create(code='users.view', label='View users', module='Users')
        self.users_delete = Permission.objects.create(code='users.delete', label='Delete users', module='Users')

        self.viewer_role = Role.objects.create(name='Directory Viewer')
        self.viewer_role.permissions.add(self.users_view)

        self.scoped_user = User.objects.create_user(username='scoped_admin', password='x')
        UserRole.objects.create(user=self.scoped_user, role=self.viewer_role)

    def test_scoped_user_can_view_pending_users(self):
        self.client.force_login(self.scoped_user)
        response = self.client.get(reverse('api_pending_users', args=['teachers']))
        self.assertEqual(response.status_code, 200)

    def test_scoped_user_cannot_delete_a_user(self):
        self.client.force_login(self.scoped_user)
        response = self.client.post(reverse('api_delete_user'), {'user_type': 'teachers', 'id': 999},
                                     content_type='application/json')
        self.assertEqual(response.status_code, 403)

    def test_full_admin_group_membership_alone_no_longer_grants_users_view(self):
        # This is the behavioral flip this whole change is about: raw ADMIN-group
        # membership by itself (no Role assignment) no longer satisfies a users.* check —
        # only holding the permission code (directly or via the system Admin role) does.
        bare_admin = User.objects.create_user(username='bare_admin', password='x')
        Group.objects.get_or_create(name='ADMIN')[0].user_set.add(bare_admin)
        self.client.force_login(bare_admin)
        response = self.client.get(reverse('api_pending_users', args=['teachers']))
        self.assertEqual(response.status_code, 403)

    def test_admin_role_assignment_restores_full_access(self):
        # ...and assigning the seeded 'Admin' role (as the real signup/verification flow
        # now does automatically) grants it back, via the exact same mechanism.
        admin_role = Role.objects.create(name='Admin', is_system_role=True)
        admin_role.permissions.add(self.users_view, self.users_delete)
        full_admin = User.objects.create_user(username='full_admin', password='x')
        UserRole.objects.create(user=full_admin, role=admin_role)

        self.client.force_login(full_admin)
        response = self.client.get(reverse('api_pending_users', args=['teachers']))
        self.assertEqual(response.status_code, 200)


class AdminInviteAndPasswordResetPermissionTests(TestCase):
    def setUp(self):
        cache.clear()
        self.perm = Permission.objects.create(code='admin_invites.manage', label='Manage invites', module='AdminInvites')
        role = Role.objects.create(name='Invite Manager')
        role.permissions.add(self.perm)
        self.scoped_user = User.objects.create_user(username='invite_mgr', password='x')
        UserRole.objects.create(user=self.scoped_user, role=role)

        self.no_perm_user = User.objects.create_user(username='no_perm', password='x')

    def test_scoped_user_can_list_invites(self):
        self.client.force_login(self.scoped_user)
        response = self.client.get(reverse('api_list_admin_invites'))
        self.assertEqual(response.status_code, 200)

    def test_user_without_the_code_is_forbidden(self):
        self.client.force_login(self.no_perm_user)
        response = self.client.get(reverse('api_list_admin_invites'))
        self.assertEqual(response.status_code, 403)


class NotificationCreateHardeningTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(username='notif_user', password='x')

    def test_post_is_rejected(self):
        self.client.force_login(self.user)
        other = User.objects.create_user(username='victim', password='x')
        response = self.client.post(reverse('notification-list'), {
            'recipient': other.id, 'title': 'Forged', 'message': 'not really from the system',
        })
        self.assertEqual(response.status_code, 405)
        self.assertFalse(Notification.objects.filter(recipient=other).exists())


class ReportCardPublishHonorsRbacTests(TestCase):
    def setUp(self):
        cache.clear()
        self.perm = Permission.objects.create(code='results.edit', label='Edit results', module='Results')
        role = Role.objects.create(name='Results Editor')
        role.permissions.add(self.perm)
        self.scoped_user = User.objects.create_user(username='results_editor', password='x')
        UserRole.objects.create(user=self.scoped_user, role=role)

        self.no_perm_user = User.objects.create_user(username='no_results_perm', password='x')

    def test_user_without_results_edit_is_forbidden(self):
        self.client.force_login(self.no_perm_user)
        response = self.client.post(reverse('student_report_card'), {}, content_type='application/json')
        self.assertEqual(response.status_code, 403)

    def test_scoped_user_passes_the_permission_gate(self):
        self.client.force_login(self.scoped_user)
        response = self.client.post(reverse('student_report_card'), {}, content_type='application/json')
        # Permission gate passed — fails on missing admNo/year/term instead, not on RBAC.
        self.assertEqual(response.status_code, 400)
