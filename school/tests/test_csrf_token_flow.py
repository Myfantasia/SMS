"""
End-to-end regression test for the CSRF/session flow real users now go through since
the public pages moved to React: GET /api/public/csrf/ (sets the csrftoken cookie via
@ensure_csrf_cookie -- see its docstring in public_api_views.py for why this exists) ->
POST /api/public/login/admin/ with the cookie echoed back as the X-CSRFToken header ->
the SPA's first DRF POST, which requires that same cookie/header pair.

Firebase used to sit in this path (firebase_login_bridge) and has been fully removed;
this test pins down that the session-login path still actually sets the cookie a real
browser (or axiosInstance.ts's withXSRFToken) needs, since nothing else in the login
chain does.
"""
from django.contrib.auth.models import User, Group
from django.core.management import call_command
from django.test import TestCase
from django.urls import reverse

from apps.academics.models import Curriculum


class LoginToCsrfCookieFlowTests(TestCase):
    def setUp(self):
        call_command('seed_rbac')  # Permission rows must exist for the superuser-bypass
        # codes check in get_user_permission_codes to resolve 'curriculum.edit' at all.
        self.client = self.client_class(enforce_csrf_checks=True)
        self.user = User.objects.create_user(
            username='csrf_admin', email='csrf_admin@hardening.test',
            password='correct-horse', is_superuser=True, is_staff=True,
        )
        Group.objects.get_or_create(name='ADMIN')[0].user_set.add(self.user)

    def test_login_sets_csrf_cookie_and_unlocks_api_post(self):
        # No cookie at all before login.
        self.assertNotIn('csrftoken', self.client.cookies)

        # The public React shell calls this once on mount, before any form becomes
        # submittable (see PublicShell.tsx) -- a real browser's first request, priming
        # the cookie the subsequent login POST's X-CSRFToken header is read from.
        csrf_response = self.client.get(reverse('api_public_csrf'))
        self.assertEqual(csrf_response.status_code, 200)
        self.assertIn('csrftoken', self.client.cookies)
        pre_login_csrf_token = self.client.cookies['csrftoken'].value
        self.assertTrue(pre_login_csrf_token)

        login_response = self.client.post(
            reverse('api_public_login_admin'),
            {'email': 'csrf_admin@hardening.test', 'password': 'correct-horse'},
            HTTP_X_CSRFTOKEN=pre_login_csrf_token,
        )
        self.assertEqual(login_response.status_code, 200)
        login_data = login_response.json()
        self.assertEqual(login_data['status'], 'success')
        # Superuser -> routed to Django admin directly (see
        # _resolve_post_login_destination in public_api_views.py).
        self.assertEqual(login_data['destination'], 'external')
        self.assertIn('/admin/', login_data['url'])

        # django.contrib.auth.login() rotates the CSRF token (session-fixation
        # hardening) -- the token must be re-read post-login, the pre-login one is
        # now stale. This is exactly why the old flow re-read it only after landing
        # on /afterlogin (post-login), not before.
        self.assertIn('csrftoken', self.client.cookies)
        csrf_token = self.client.cookies['csrftoken'].value
        self.assertTrue(csrf_token)
        self.assertNotEqual(csrf_token, pre_login_csrf_token)

        # Without the header, DRF's SessionAuthentication must still reject the POST.
        rejected = self.client.post(
            '/api/core/curriculum/tiers/', {'curriculum': 1, 'name': 'Junior', 'code': 'JSS'},
        )
        self.assertEqual(rejected.status_code, 403)

        curriculum = Curriculum.objects.create(code='CBC', name='Competency Based Curriculum')
        accepted = self.client.post(
            '/api/core/curriculum/tiers/',
            {'curriculum': curriculum.id, 'name': 'Junior Secondary', 'code': 'JSS'},
            HTTP_X_CSRFTOKEN=csrf_token,
        )
        self.assertEqual(accepted.status_code, 201, accepted.content)
