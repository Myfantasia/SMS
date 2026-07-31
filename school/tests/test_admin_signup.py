import secrets
from datetime import timedelta

from django.contrib.auth.hashers import check_password, make_password
from django.contrib.auth.models import User
from django.contrib.messages import get_messages
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from school.models.models import AdminExtra, AdminInviteCode
from school.models.rbac_models import Permission, Role, UserRole


def _message_texts(response):
    """Reads flashed messages.error()/success() text directly off the request,
    independent of whether the current template actually renders {% if messages %}
    — adminsignup.html doesn't yet (native form conversion hasn't landed), so
    assertContains() against its HTML can't be used to check these."""
    return [str(m) for m in get_messages(response.wsgi_request)]


def _make_invite_code(expires_delta=None, revoked=False, used_by=None):
    """Creates a real AdminInviteCode row the way api_generate_admin_invite would, and
    returns the raw (unhashed) code — the only place it's ever visible, same as in
    production. A fresh random code every call, so tests can create several without
    colliding on the unique code_hash constraint."""
    raw = secrets.token_hex(6).upper()
    invite = AdminInviteCode.objects.create(
        code_hash=AdminInviteCode.hash_code(raw),
        code_preview=raw[-4:],
        expires_at=timezone.now() + (expires_delta if expires_delta is not None else timedelta(days=7)),
    )
    if revoked:
        invite.revoked_at = timezone.now()
        invite.save()
    if used_by is not None:
        invite.used_at = timezone.now()
        invite.used_by = used_by
        invite.save()
    return raw


def _valid_payload(**overrides):
    payload = {
        'first_name': 'Ada',
        'last_name': 'Admin',
        'username': 'ada_admin',
        'email': 'ada@example.com',
        'mobile': '+254712345678',
        'address': '123 Main St',
        'password': 'correct-horse',
        'password2': 'correct-horse',
        'invite_code': '',
    }
    payload.update(overrides)
    return payload


class AdminSignupSecurityTests(TestCase):
    """
    Security/loophole pass on the native admin-signup path, required before the
    Firebase-intercepted template is cut over to it (per the eradication plan).
    """

    def test_bootstrap_admin_gets_immediate_access_without_invite_code(self):
        response = self.client.post(reverse('adminsignup'), _valid_payload(), follow=True)
        self.assertRedirects(response, reverse('adminlogin'))

        user = User.objects.get(email='ada@example.com')
        self.assertTrue(user.groups.filter(name='ADMIN').exists())
        self.assertTrue(AdminExtra.objects.get(user=user).status)
        self.assertTrue(user.check_password('correct-horse'))
        self.assertEqual(user.username, 'ada_admin')  # user-supplied at signup

    def test_second_admin_without_invite_code_is_rejected(self):
        # First admin bootstraps normally.
        self.client.post(reverse('adminsignup'), _valid_payload())

        # A second signup with no invite code must NOT succeed, and must NOT be
        # silently treated as bootstrap just because the first request raced ahead.
        response = self.client.post(reverse('adminsignup'), _valid_payload(username='bob_admin', email='bob@example.com'))
        self.assertFalse(User.objects.filter(email='bob@example.com').exists())
        self.assertTrue(any('Invalid or expired invite code' in m for m in _message_texts(response)))

    def test_second_admin_with_wrong_invite_code_is_rejected(self):
        self.client.post(reverse('adminsignup'), _valid_payload())
        response = self.client.post(
            reverse('adminsignup'),
            _valid_payload(username='bob_admin', email='bob@example.com', invite_code='totally-wrong-code'),
        )
        self.assertFalse(User.objects.filter(email='bob@example.com').exists())
        self.assertTrue(any('Invalid or expired invite code' in m for m in _message_texts(response)))

    def test_second_admin_with_expired_invite_code_is_rejected(self):
        self.client.post(reverse('adminsignup'), _valid_payload())
        code = _make_invite_code(expires_delta=timedelta(days=-1))
        response = self.client.post(
            reverse('adminsignup'),
            _valid_payload(username='bob_admin', email='bob@example.com', invite_code=code),
        )
        self.assertFalse(User.objects.filter(email='bob@example.com').exists())
        self.assertTrue(any('Invalid or expired invite code' in m for m in _message_texts(response)))

    def test_second_admin_with_revoked_invite_code_is_rejected(self):
        self.client.post(reverse('adminsignup'), _valid_payload())
        code = _make_invite_code(revoked=True)
        response = self.client.post(
            reverse('adminsignup'),
            _valid_payload(username='bob_admin', email='bob@example.com', invite_code=code),
        )
        self.assertFalse(User.objects.filter(email='bob@example.com').exists())
        self.assertTrue(any('Invalid or expired invite code' in m for m in _message_texts(response)))

    def test_second_admin_with_already_used_invite_code_is_rejected(self):
        first_admin = User.objects.create_user(username='prior_admin', email='prior@example.com', password='x')
        self.client.post(reverse('adminsignup'), _valid_payload())
        code = _make_invite_code(used_by=first_admin)
        response = self.client.post(
            reverse('adminsignup'),
            _valid_payload(username='bob_admin', email='bob@example.com', invite_code=code),
        )
        self.assertFalse(User.objects.filter(email='bob@example.com').exists())
        self.assertTrue(any('Invalid or expired invite code' in m for m in _message_texts(response)))

    def test_second_admin_with_correct_invite_code_is_pending_not_active(self):
        self.client.post(reverse('adminsignup'), _valid_payload())
        code = _make_invite_code()
        response = self.client.post(
            reverse('adminsignup'),
            _valid_payload(username='bob_admin', email='bob@example.com', invite_code=code),
            follow=True,
        )
        self.assertRedirects(response, reverse('adminlogin'))

        bob = User.objects.get(email='bob@example.com')
        # Pending: created, but withheld from the ADMIN group until approved.
        self.assertFalse(bob.groups.filter(name='ADMIN').exists())
        self.assertFalse(AdminExtra.objects.get(user=bob).status)

        # The invite is now consumed — single use, can't be replayed.
        invite = AdminInviteCode.objects.get(code_hash=AdminInviteCode.hash_code(code))
        self.assertEqual(invite.status, 'Used')
        self.assertEqual(invite.used_by, bob)

    def test_invite_code_cannot_be_reused_after_signup(self):
        self.client.post(reverse('adminsignup'), _valid_payload())
        code = _make_invite_code()
        self.client.post(
            reverse('adminsignup'),
            _valid_payload(username='bob_admin', email='bob@example.com', invite_code=code),
        )
        # Same code, different applicant — must be rejected now that it's used.
        response = self.client.post(
            reverse('adminsignup'),
            _valid_payload(username='carol_admin', email='carol@example.com', invite_code=code),
        )
        self.assertFalse(User.objects.filter(email='carol@example.com').exists())
        self.assertTrue(any('Invalid or expired invite code' in m for m in _message_texts(response)))

    def test_invite_code_is_whitespace_and_case_insensitive(self):
        self.client.post(reverse('adminsignup'), _valid_payload())
        code = _make_invite_code()
        sloppy_code = f"  {code.lower()}  "
        response = self.client.post(
            reverse('adminsignup'),
            _valid_payload(username='bob_admin', email='bob@example.com', invite_code=sloppy_code),
            follow=True,
        )
        self.assertRedirects(response, reverse('adminlogin'))
        self.assertTrue(User.objects.filter(email='bob@example.com').exists())

    def test_pending_admin_cannot_log_in_before_verification(self):
        self.client.post(reverse('adminsignup'), _valid_payload())
        code = _make_invite_code()
        self.client.post(
            reverse('adminsignup'),
            _valid_payload(username='bob_admin', email='bob@example.com', invite_code=code),
        )

        response = self.client.post(reverse('adminlogin'), {
            'email': 'bob@example.com', 'password': 'correct-horse',
        })
        bob = User.objects.get(email='bob@example.com')
        self.assertFalse(bob.groups.filter(name='ADMIN').exists())
        self.assertContains(response, 'pending approval')

    def test_duplicate_email_rejected(self):
        self.client.post(reverse('adminsignup'), _valid_payload())
        code = _make_invite_code()
        response = self.client.post(reverse('adminsignup'), _valid_payload(
            first_name='Eve', invite_code=code,
        ))
        # Still just one User with that email — the duplicate never got created.
        self.assertEqual(User.objects.filter(email='ada@example.com').count(), 1)
        self.assertIn('email', response.context['form'].errors)
        self.assertIn('already exists', str(response.context['form'].errors['email']))

    def test_duplicate_username_rejected(self):
        # Username is now user-chosen at signup, not derived from the email — a second
        # admin picking an already-taken username (even with a different, unique email)
        # must be rejected rather than hitting a duplicate-username IntegrityError.
        self.client.post(reverse('adminsignup'), _valid_payload(username='ada_admin', email='ada@example.com'))
        code = _make_invite_code()
        response = self.client.post(reverse('adminsignup'), _valid_payload(
            username='ada_admin', email='someone-else@example.com',
            invite_code=code,
        ))
        self.assertFalse(User.objects.filter(email='someone-else@example.com').exists())
        self.assertIn('username', response.context['form'].errors)
        self.assertIn('already taken', str(response.context['form'].errors['username']))

    def test_password_confirmation_mismatch_rejected(self):
        response = self.client.post(reverse('adminsignup'), _valid_payload(password2='different-password'))
        self.assertFalse(User.objects.filter(email='ada@example.com').exists())
        self.assertIn('password2', response.context['form'].errors)
        self.assertIn('do not match', str(response.context['form'].errors['password2']))

    def test_password_below_minimum_length_rejected(self):
        response = self.client.post(reverse('adminsignup'), _valid_payload(password='abc', password2='abc'))
        self.assertFalse(User.objects.filter(email='ada@example.com').exists())
        self.assertIn('password', response.context['form'].errors)
        self.assertIn('at least 8 characters', str(response.context['form'].errors['password']))

    def test_weak_common_password_rejected(self):
        # Admin is the highest-privilege role — it must be held to the same strength bar
        # as the self-service password-change form (AUTH_PASSWORD_VALIDATORS), not just
        # a bare length check.
        response = self.client.post(reverse('adminsignup'), _valid_payload(password='password123', password2='password123'))
        self.assertFalse(User.objects.filter(email='ada@example.com').exists())
        self.assertIn('password', response.context['form'].errors)

    def test_missing_required_fields_rejected(self):
        response = self.client.post(reverse('adminsignup'), _valid_payload(mobile='', address=''))
        self.assertFalse(User.objects.filter(email='ada@example.com').exists())
        self.assertEqual(response.status_code, 200)  # re-renders the form with errors, no redirect

    def test_full_two_step_approval_flow_grants_access(self):
        self.client.post(reverse('adminsignup'), _valid_payload())
        code = _make_invite_code()
        self.client.post(
            reverse('adminsignup'),
            _valid_payload(username='bob_admin', email='bob@example.com', invite_code=code),
        )
        bob = User.objects.get(email='bob@example.com')
        bob_extra = AdminExtra.objects.get(user=bob)

        # An existing admin "approves" — generates a verification code out-of-band.
        # Stored hashed, same as api_process_approval/_generate_admin_verification_code.
        bob_extra.verification_code = make_password('123456')
        bob_extra.code_generated_at = timezone.now()
        bob_extra.save()

        response = self.client.post(reverse('adminlogin'), {
            'verification_code': '123456', 'verify_email': 'bob@example.com',
        }, follow=True)
        self.assertContains(response, 'verified')

        bob.refresh_from_db()
        self.assertTrue(bob.groups.filter(name='ADMIN').exists())

        # Now bob can actually log in. (Not following the redirect further —
        # afterlogin_view's own role-based routing is out of scope here.)
        login_response = self.client.post(reverse('adminlogin'), {
            'email': 'bob@example.com', 'password': 'correct-horse',
        })
        self.assertEqual(login_response.status_code, 302)
        self.assertEqual(login_response.url, reverse('afterlogin'))


class AdminVerificationCodeSecurityTests(TestCase):
    """Covers the hashed-storage change to AdminExtra.verification_code — it must be
    stored as a make_password() hash, never in plaintext, and only check_password()
    should be able to validate a submitted guess against it."""

    def _pending_admin(self):
        user = User.objects.create_user(username='bob_admin', email='bob@example.com', password='correct-horse')
        return AdminExtra.objects.create(user=user, mobile='+254700000000', address='Somewhere', status=False)

    def test_verification_code_is_stored_hashed_not_plaintext(self):
        admin_extra = self._pending_admin()
        admin_extra.verification_code = make_password('654321')
        admin_extra.code_generated_at = timezone.now()
        admin_extra.save()

        admin_extra.refresh_from_db()
        self.assertNotEqual(admin_extra.verification_code, '654321')
        self.assertTrue(check_password('654321', admin_extra.verification_code))

    def test_wrong_code_against_hash_is_rejected_at_login(self):
        admin_extra = self._pending_admin()
        admin_extra.verification_code = make_password('654321')
        admin_extra.code_generated_at = timezone.now()
        admin_extra.save()

        response = self.client.post(reverse('adminlogin'), {
            'verification_code': '000000', 'verify_email': 'bob@example.com',
        })
        admin_extra.refresh_from_db()
        self.assertFalse(admin_extra.status)
        self.assertContains(response, 'Incorrect verification code')


class AdminInviteApiTests(TestCase):
    """Covers the admin-only invite-generation/management endpoints backing the
    "Invite Codes & Verification" tab on the admins approval page."""

    def setUp(self):
        self.admin_user = User.objects.create_user(username='root_admin', email='root@example.com', password='x')
        from django.contrib.auth.models import Group
        Group.objects.get_or_create(name='ADMIN')[0].user_set.add(self.admin_user)
        # ADMIN-group membership alone no longer grants access to these endpoints (see
        # school/rbac.py) — a real admin gets the 'Admin' Role auto-assigned at
        # signup/verification time; mirror that here rather than relying on the raw group.
        perm = Permission.objects.create(code='admin_invites.manage', label='Manage invites', module='AdminInvites')
        role = Role.objects.create(name='Admin', is_system_role=True)
        role.permissions.add(perm)
        UserRole.objects.create(user=self.admin_user, role=role)
        self.client.force_login(self.admin_user)

    def test_generate_invite_returns_raw_code_once_and_stores_only_hash(self):
        response = self.client.post(
            reverse('api_generate_admin_invite'),
            data='{"expires_in_days": 7}', content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['status'], 'success')
        raw_code = body['code']

        invite = AdminInviteCode.objects.get()
        self.assertEqual(invite.code_hash, AdminInviteCode.hash_code(raw_code))
        self.assertNotEqual(invite.code_hash, raw_code)
        self.assertEqual(invite.status, 'Active')
        self.assertEqual(invite.created_by, self.admin_user)

    def test_generate_invite_rejects_invalid_duration(self):
        response = self.client.post(
            reverse('api_generate_admin_invite'),
            data='{"expires_in_days": 999}', content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(AdminInviteCode.objects.count(), 0)

    def test_revoke_invite_marks_it_revoked_and_blocks_double_revoke(self):
        code = _make_invite_code()
        invite = AdminInviteCode.objects.get(code_hash=AdminInviteCode.hash_code(code))

        response = self.client.post(reverse('api_revoke_admin_invite', args=[invite.pk]))
        self.assertEqual(response.status_code, 200)
        invite.refresh_from_db()
        self.assertEqual(invite.status, 'Revoked')

        second_response = self.client.post(reverse('api_revoke_admin_invite', args=[invite.pk]))
        self.assertEqual(second_response.status_code, 400)

    def test_non_admin_cannot_generate_invite(self):
        outsider = User.objects.create_user(username='outsider', email='outsider@example.com', password='x')
        self.client.force_login(outsider)
        response = self.client.post(
            reverse('api_generate_admin_invite'),
            data='{"expires_in_days": 7}', content_type='application/json',
        )
        self.assertEqual(response.status_code, 403)

    def test_regenerate_replaces_code_and_resets_attempts(self):
        pending_user = User.objects.create_user(username='pending_admin', email='pending@example.com', password='x')
        admin_extra = AdminExtra.objects.create(user=pending_user, mobile='+254700000000', address='Somewhere', status=False)
        admin_extra.verification_code = make_password('111111')
        admin_extra.code_generated_at = timezone.now()
        admin_extra.save()
        from django.core.cache import cache
        cache.set(f'verify_code_attempts:{admin_extra.pk}', 4, 30 * 60)

        response = self.client.post(reverse('api_regenerate_admin_code', args=[admin_extra.pk]))
        self.assertEqual(response.status_code, 200)
        new_code = response.json()['verification_code']
        self.assertNotEqual(new_code, '111111')

        admin_extra.refresh_from_db()
        self.assertFalse(check_password('111111', admin_extra.verification_code))
        self.assertTrue(check_password(new_code, admin_extra.verification_code))
        self.assertEqual(cache.get(f'verify_code_attempts:{admin_extra.pk}', 0), 0)

    def test_verification_status_lists_pending_admins_without_exposing_code(self):
        pending_user = User.objects.create_user(username='pending_admin', email='pending@example.com', password='x')
        admin_extra = AdminExtra.objects.create(user=pending_user, mobile='+254700000000', address='Somewhere', status=False)
        admin_extra.verification_code = make_password('111111')
        admin_extra.code_generated_at = timezone.now()
        admin_extra.save()

        response = self.client.get(reverse('api_admin_verification_status'))
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(len(body['data']), 1)
        entry = body['data'][0]
        self.assertEqual(entry['email'], 'pending@example.com')
        self.assertNotIn('verification_code', entry)
        self.assertNotIn('code', entry)
