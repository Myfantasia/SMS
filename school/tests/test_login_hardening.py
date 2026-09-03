from datetime import timedelta

from django.contrib.auth.hashers import make_password
from django.contrib.auth.models import User, Group
from django.core.cache import cache
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from apps.identity.models import AdminExtra


class AdminLoginRateLimitTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            username='ada_hardening', email='ada@hardening.test', password='correct-horse')
        Group.objects.get_or_create(name='ADMIN')[0].user_set.add(self.user)

    def test_correct_login_works_under_threshold(self):
        response = self.client.post(reverse('api_public_login_admin'), {
            'email': 'ada@hardening.test', 'password': 'correct-horse',
        })
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data['status'], 'success')
        self.assertEqual(data['destination'], 'dashboard')

    def test_repeated_wrong_passwords_eventually_locked_out(self):
        for _ in range(8):
            self.client.post(reverse('api_public_login_admin'), {
                'email': 'ada@hardening.test', 'password': 'wrong-password',
            })

        # Even the CORRECT password is now rejected while the identifier is locked out.
        response = self.client.post(reverse('api_public_login_admin'), {
            'email': 'ada@hardening.test', 'password': 'correct-horse',
        })
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['status'], 'error')
        self.assertFalse(response.wsgi_request.user.is_authenticated)

    def test_lockout_is_per_identifier_not_global(self):
        other_user = User.objects.create_user(
            username='bob_hardening', email='bob@hardening.test', password='correct-horse')
        Group.objects.get_or_create(name='ADMIN')[0].user_set.add(other_user)

        for _ in range(8):
            self.client.post(reverse('api_public_login_admin'), {
                'email': 'ada@hardening.test', 'password': 'wrong-password',
            })

        # A different identifier from the same client is unaffected.
        response = self.client.post(reverse('api_public_login_admin'), {
            'email': 'bob@hardening.test', 'password': 'correct-horse',
        })
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data['status'], 'success')
        self.assertEqual(data['destination'], 'dashboard')


class TeacherStudentLoginRateLimitTests(TestCase):
    def setUp(self):
        cache.clear()

    def test_teacher_login_locks_out_after_repeated_failures(self):
        User.objects.create_user(username='t1', email='t1@hardening.test', password='correct-horse')
        for _ in range(8):
            self.client.post(reverse('api_public_login_teacher'), {
                'email': 't1@hardening.test', 'password': 'wrong',
            })
        response = self.client.post(reverse('api_public_login_teacher'), {
            'email': 't1@hardening.test', 'password': 'correct-horse',
        })
        self.assertFalse(response.wsgi_request.user.is_authenticated)

    def test_student_login_locks_out_after_repeated_failures(self):
        User.objects.create_user(username='s1', password='correct-horse')
        for _ in range(8):
            self.client.post(reverse('api_public_login_student'), {
                'username': 's1', 'password': 'wrong',
            })
        response = self.client.post(reverse('api_public_login_student'), {
            'username': 's1', 'password': 'correct-horse',
        })
        self.assertFalse(response.wsgi_request.user.is_authenticated)


class ParentLoginRateLimitTests(TestCase):
    def setUp(self):
        cache.clear()
        User.objects.create_user(
            username='parent1', email='parent1@hardening.test', password='correct-horse')

    def test_correct_login_works_under_threshold(self):
        # api_login_parent is email-based (matching admin/teacher/student login), not
        # Django's generic username-based AuthenticationForm.
        response = self.client.post(reverse('api_public_login_parent'), {
            'email': 'parent1@hardening.test', 'password': 'correct-horse',
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['status'], 'success')

    def test_locks_out_after_repeated_failures(self):
        for _ in range(8):
            self.client.post(reverse('api_public_login_parent'), {
                'email': 'parent1@hardening.test', 'password': 'wrong',
            })
        response = self.client.post(reverse('api_public_login_parent'), {
            'email': 'parent1@hardening.test', 'password': 'correct-horse',
        })
        self.assertFalse(response.wsgi_request.user.is_authenticated)
        self.assertEqual(response.status_code, 400)


class VerificationCodeHardeningTests(TestCase):
    def setUp(self):
        cache.clear()
        self.pending_user = User.objects.create_user(
            username='pending_admin', email='pending@hardening.test', password='correct-horse')
        self.admin_extra = AdminExtra.objects.create(
            user=self.pending_user, status=False,
            verification_code=make_password('123456'), code_generated_at=timezone.now(),
        )

    def _submit_code(self, code):
        return self.client.post(reverse('api_public_login_admin'), {
            'verification_code': code, 'verify_email': 'pending@hardening.test',
        })

    def test_correct_code_within_window_succeeds(self):
        response = self._submit_code('123456')
        self.assertIn('verified', response.json()['message'])
        self.pending_user.refresh_from_db()
        self.assertTrue(self.pending_user.groups.filter(name='ADMIN').exists())

    def test_expired_code_rejected_even_if_correct(self):
        self.admin_extra.code_generated_at = timezone.now() - timedelta(minutes=31)
        self.admin_extra.save()

        response = self._submit_code('123456')
        self.assertIn('expired', response.json()['message'])
        self.pending_user.refresh_from_db()
        self.assertFalse(self.pending_user.groups.filter(name='ADMIN').exists())

        # The stale code is fully invalidated, not just temporarily rejected.
        self.admin_extra.refresh_from_db()
        self.assertIsNone(self.admin_extra.verification_code)

    def test_code_invalidated_after_five_wrong_guesses(self):
        for _ in range(5):
            self._submit_code('000000')

        # Even the genuinely correct code no longer works — it was invalidated.
        response = self._submit_code('123456')
        self.assertIn('expired', response.json()['message'])
        self.pending_user.refresh_from_db()
        self.assertFalse(self.pending_user.groups.filter(name='ADMIN').exists())

    def test_wrong_guesses_under_the_limit_do_not_invalidate(self):
        for _ in range(3):
            self._submit_code('000000')

        response = self._submit_code('123456')
        self.assertIn('verified', response.json()['message'])
        self.pending_user.refresh_from_db()
        self.assertTrue(self.pending_user.groups.filter(name='ADMIN').exists())
