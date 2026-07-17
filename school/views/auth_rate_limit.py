"""
Shared login brute-force throttling for every login path (admin/teacher/student FBVs
and the parent LoginView subclass) — counts recent FAILED attempts per identifier
(email/username) and per client IP, using the same DB-backed cache the rest of the
app's rate limiting already relies on (see ChatConsumer._check_rate_limit,
RateLimitedPasswordResetView in password_reset_views.py). Thresholds are deliberately
generous: this throttles credential stuffing / scripted guessing, not a real user who
mistypes their password a few times.
"""
import logging

from django.contrib.auth import views as auth_views
from django.core.cache import cache

security_logger = logging.getLogger('school.security')

MAX_ATTEMPTS_PER_IDENTIFIER = 8
MAX_ATTEMPTS_PER_IP = 20
THROTTLE_WINDOW_SECONDS = 15 * 60


def client_ip(request):
    forwarded = request.META.get('HTTP_X_FORWARDED_FOR')
    if forwarded:
        return forwarded.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR', 'unknown')


def is_login_rate_limited(request, identifier):
    """True if this identifier/IP has failed too many times recently. Call BEFORE
    authenticate() and, if True, skip straight to the same generic invalid-credentials
    message a wrong password gets — never a distinct "too many attempts" message,
    so throttling itself can't be used to fingerprint valid identifiers."""
    ip_key = f'login_fail:ip:{client_ip(request)}'
    id_key = f'login_fail:id:{identifier.strip().lower()}'
    limited = cache.get(ip_key, 0) >= MAX_ATTEMPTS_PER_IP or cache.get(id_key, 0) >= MAX_ATTEMPTS_PER_IDENTIFIER
    if limited:
        security_logger.warning('Login rate limit hit for identifier=%r ip=%s', identifier, client_ip(request))
    return limited


def record_login_failure(request, identifier):
    """Call after authenticate() fails — never on a successful login, so legitimate
    repeated logins are never penalized."""
    ip_key = f'login_fail:ip:{client_ip(request)}'
    id_key = f'login_fail:id:{identifier.strip().lower()}'
    cache.set(ip_key, cache.get(ip_key, 0) + 1, THROTTLE_WINDOW_SECONDS)
    cache.set(id_key, cache.get(id_key, 0) + 1, THROTTLE_WINDOW_SECONDS)
    security_logger.info('Failed login attempt for identifier=%r ip=%s', identifier, client_ip(request))


class RateLimitedLoginView(auth_views.LoginView):
    """Parent login currently uses Django's built-in LoginView directly (see
    urls.py) with no hook for the throttling the other three login paths
    (admin/teacher/student) apply. AuthenticationForm.clean() calls authenticate()
    internally with no way to skip it ahead of time, so a throttled request still
    executes authenticate() — but form_valid is overridden to still refuse the
    login while throttled, and form_invalid always records the failure, so the
    lockout itself is never actually bypassable even though authenticate() runs.
    """

    def form_valid(self, form):
        identifier = (self.request.POST.get('username') or '').strip()
        if identifier and is_login_rate_limited(self.request, identifier):
            form.add_error(None, 'Please enter a correct username and password. Note that both fields may be case-sensitive.')
            return self.form_invalid(form)
        return super().form_valid(form)

    def form_invalid(self, form):
        identifier = (self.request.POST.get('username') or '').strip()
        if identifier:
            record_login_failure(self.request, identifier)
        return super().form_invalid(form)
