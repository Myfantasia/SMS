from django.conf import settings
from django.contrib.auth.models import User
from django.contrib.messages import get_messages
from django.test import TestCase
from django.urls import reverse

from school.models.models import AdminExtra


def _message_texts(response):
    """Reads flashed messages.error()/success() text directly off the request,
    independent of whether the current template actually renders {% if messages %}
    — adminsignup.html doesn't yet (native form conversion hasn't landed), so
    assertContains() against its HTML can't be used to check these."""
    return [str(m) for m in get_messages(response.wsgi_request)]


def _valid_payload(**overrides):
    payload = {
        'first_name': 'Ada',
        'last_name': 'Admin',
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
        self.assertTrue(user.username)  # auto-generated, non-empty

    def test_second_admin_without_invite_code_is_rejected(self):
        # First admin bootstraps normally.
        self.client.post(reverse('adminsignup'), _valid_payload())

        # A second signup with no invite code must NOT succeed, and must NOT be
        # silently treated as bootstrap just because the first request raced ahead.
        response = self.client.post(reverse('adminsignup'), _valid_payload(email='bob@example.com'))
        self.assertFalse(User.objects.filter(email='bob@example.com').exists())
        self.assertTrue(any('Invalid invite code' in m for m in _message_texts(response)))

    def test_second_admin_with_wrong_invite_code_is_rejected(self):
        self.client.post(reverse('adminsignup'), _valid_payload())
        response = self.client.post(
            reverse('adminsignup'),
            _valid_payload(email='bob@example.com', invite_code='totally-wrong-code'),
        )
        self.assertFalse(User.objects.filter(email='bob@example.com').exists())
        self.assertTrue(any('Invalid invite code' in m for m in _message_texts(response)))

    def test_second_admin_with_correct_invite_code_is_pending_not_active(self):
        self.client.post(reverse('adminsignup'), _valid_payload())
        response = self.client.post(
            reverse('adminsignup'),
            _valid_payload(email='bob@example.com', invite_code=settings.ADMIN_SIGNUP_INVITE_CODE),
            follow=True,
        )
        self.assertRedirects(response, reverse('adminlogin'))

        bob = User.objects.get(email='bob@example.com')
        # Pending: created, but withheld from the ADMIN group until approved.
        self.assertFalse(bob.groups.filter(name='ADMIN').exists())
        self.assertFalse(AdminExtra.objects.get(user=bob).status)

    def test_pending_admin_cannot_log_in_before_verification(self):
        self.client.post(reverse('adminsignup'), _valid_payload())
        self.client.post(
            reverse('adminsignup'),
            _valid_payload(email='bob@example.com', invite_code=settings.ADMIN_SIGNUP_INVITE_CODE),
        )

        response = self.client.post(reverse('adminlogin'), {
            'email': 'bob@example.com', 'password': 'correct-horse',
        })
        bob = User.objects.get(email='bob@example.com')
        self.assertFalse(bob.groups.filter(name='ADMIN').exists())
        self.assertContains(response, 'pending approval')

    def test_duplicate_email_rejected(self):
        self.client.post(reverse('adminsignup'), _valid_payload())
        response = self.client.post(reverse('adminsignup'), _valid_payload(
            first_name='Eve', invite_code=settings.ADMIN_SIGNUP_INVITE_CODE,
        ))
        # Still just one User with that email — the duplicate never got created.
        self.assertEqual(User.objects.filter(email='ada@example.com').count(), 1)
        self.assertIn('email', response.context['form'].errors)
        self.assertIn('already exists', str(response.context['form'].errors['email']))

    def test_auto_generated_usernames_never_collide(self):
        # Two different emails sharing the same local part ("ada@") must not produce
        # a duplicate-username IntegrityError — the generator must de-duplicate.
        self.client.post(reverse('adminsignup'), _valid_payload(email='ada@example.com'))
        self.client.post(reverse('adminsignup'), _valid_payload(
            email='ada@other-domain.com', invite_code=settings.ADMIN_SIGNUP_INVITE_CODE,
        ))
        usernames = set(User.objects.filter(
            email__in=['ada@example.com', 'ada@other-domain.com']
        ).values_list('username', flat=True))
        self.assertEqual(len(usernames), 2)

    def test_password_confirmation_mismatch_rejected(self):
        response = self.client.post(reverse('adminsignup'), _valid_payload(password2='different-password'))
        self.assertFalse(User.objects.filter(email='ada@example.com').exists())
        self.assertIn('password2', response.context['form'].errors)
        self.assertIn('do not match', str(response.context['form'].errors['password2']))

    def test_password_below_minimum_length_rejected(self):
        response = self.client.post(reverse('adminsignup'), _valid_payload(password='abc', password2='abc'))
        self.assertFalse(User.objects.filter(email='ada@example.com').exists())
        self.assertIn('password', response.context['form'].errors)
        self.assertIn('at least 6 characters', str(response.context['form'].errors['password']))

    def test_missing_required_fields_rejected(self):
        response = self.client.post(reverse('adminsignup'), _valid_payload(mobile='', address=''))
        self.assertFalse(User.objects.filter(email='ada@example.com').exists())
        self.assertEqual(response.status_code, 200)  # re-renders the form with errors, no redirect

    def test_full_two_step_approval_flow_grants_access(self):
        self.client.post(reverse('adminsignup'), _valid_payload())
        self.client.post(
            reverse('adminsignup'),
            _valid_payload(email='bob@example.com', invite_code=settings.ADMIN_SIGNUP_INVITE_CODE),
        )
        bob = User.objects.get(email='bob@example.com')
        bob_extra = AdminExtra.objects.get(user=bob)

        # An existing admin "approves" — generates a verification code out-of-band.
        bob_extra.verification_code = '123456'
        from django.utils import timezone
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
