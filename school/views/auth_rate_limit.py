"""
Shared login brute-force throttling for every login path (admin/teacher/student/parent
FBVs) — counts recent FAILED attempts per identifier (email/username) and per client IP,
using the same DB-backed cache the rest of the app's rate limiting already relies on (see
ChatConsumer._check_rate_limit, RateLimitedPasswordResetView in password_reset_views.py).
Thresholds are deliberately generous: this throttles credential stuffing / scripted
guessing, not a real user who mistypes their password a few times.
"""
import logging

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


MAX_STUDENT_SEARCHES_PER_IP_PER_MINUTE = 20


def is_student_search_rate_limited(request):
    """Throttles the public, pre-login student-lookup search used on the parent signup
    page's child-verification step. Without this it's a scriptable way to enumerate
    student names/admission numbers — generous enough for a real parent typing and
    backspacing while they search, tight enough to make bulk scraping impractical."""
    ip_key = f'student_search:ip:{client_ip(request)}'
    count = cache.get(ip_key, 0)
    limited = count >= MAX_STUDENT_SEARCHES_PER_IP_PER_MINUTE
    if not limited:
        cache.set(ip_key, count + 1, 60)
    return limited
