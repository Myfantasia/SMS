"""
Before this, no endpoint in the app except login/password-reset had any request-rate
limit at all. This pins down the new ScopedRateThrottle applied to the handful of
sensitive/heavy endpoints flagged as unlimited: chat attachment uploads, assignment
submissions, and bulk allocation/results operations (all rate-limited under the
'bulk_ops' scope, since the same admin/staff user pool operates all three — the quota
is intentionally shared across them, not per-view).

Uses APIRequestFactory + force_authenticate to hit the view directly, bypassing
session/CSRF plumbing entirely — DRF's throttle check runs in APIView.initial(), after
authentication/permissions but before the handler body, so it fires regardless of
what the view would otherwise do with the request.
"""
from django.contrib.auth.models import User
from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from school.views.assignment_student_views import SubmitAssignmentAPIView
from school.views.chat_views import ChatAttachmentUploadAPI
from school.views.results_views import BulkGenerateTermResultsAPIView


class ScopedThrottleTests(TestCase):
    def setUp(self):
        cache.clear()
        # get_user_permission_codes' superuser bypass returns every Permission row that
        # actually EXISTS — with none seeded in a fresh test DB that's an empty set, so
        # HasModulePermission (BulkGenerateTermResultsAPIView's 'results.edit' gate) would
        # 403 even a superuser without this.
        call_command('seed_rbac')
        self.factory = APIRequestFactory()
        self.user = User.objects.create_user(username='throttle_user', password='x', is_superuser=True)

    def test_uploads_scope_returns_429_past_the_limit(self):
        # 'uploads' rate is 30/min (settings.py REST_FRAMEWORK DEFAULT_THROTTLE_RATES).
        view = ChatAttachmentUploadAPI.as_view()
        statuses = []
        for _ in range(31):
            request = self.factory.post('/api/chat/attachments/1/', {})
            force_authenticate(request, user=self.user)
            response = view(request, thread_id=1)
            statuses.append(response.status_code)
        self.assertNotIn(429, statuses[:30])
        self.assertEqual(statuses[30], 429)

    def test_submissions_scope_returns_429_past_the_limit(self):
        # 'submissions' rate is 30/min.
        view = SubmitAssignmentAPIView.as_view()
        statuses = []
        for _ in range(31):
            request = self.factory.post('/api/assignments/student/submit/', {})
            force_authenticate(request, user=self.user)
            response = view(request)
            statuses.append(response.status_code)
        self.assertNotIn(429, statuses[:30])
        self.assertEqual(statuses[30], 429)

    def test_bulk_ops_scope_returns_429_past_the_limit(self):
        # 'bulk_ops' rate is 5/min, shared across every bulk allocation/results endpoint.
        view = BulkGenerateTermResultsAPIView.as_view()
        statuses = []
        for _ in range(6):
            request = self.factory.post('/api/results/bulk-generate/', {})
            force_authenticate(request, user=self.user)
            response = view(request)
            statuses.append(response.status_code)
        self.assertNotIn(429, statuses[:5])
        self.assertEqual(statuses[5], 429)
