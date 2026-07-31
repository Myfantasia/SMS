"""
Hardened password reset flow + an admin-triggered reset for accounts that can't use
self-service reset yet (currently: students, whose signup email is an auto-generated
@student.myfantasia.com address with no real inbox behind it — not a limitation of
this flow itself, just of student email addresses today. Once those become real,
the same self-service reset below will start working for them with no changes needed).

Resetting someone else's password is admin-only (api_admin_reset_user_password) and
deliberately can't target another admin account — every other role only ever changes
their own password via their own "My Profile" self-service form.
"""
import json
import secrets

from django.conf import settings
from django.contrib.auth import views as auth_views
from django.contrib.auth.models import User
from django.core.cache import cache
from django.core.mail import send_mail
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from school.models.models import TeacherExtra, StudentExtra, ParentExtra, StaffExtra, ForcedPasswordChange
from school.models.classSubjects_models import SystemAuditLog
from school.decorators import require_permission
from school.permissions import api_login_required

# Deliberately generous — this throttles abuse (spamming a target's inbox, or probing
# many emails to fingerprint which ones exist via response timing), not normal use.
# It never changes what the requester sees: the "check your email" page renders
# identically whether the request was throttled, the email didn't match an account,
# or a real email actually went out — so a rate-limited request leaks nothing.
MAX_REQUESTS_PER_IP_PER_HOUR = 5
MAX_REQUESTS_PER_EMAIL_PER_HOUR = 3

# The initial "forgot password" page is shared by every role's login screen, so the
# "Back to Login" link has to know which one sent the visitor here (?role=... on the
# link, see admin/teacher/parentlogin.html) rather than hardcoding one role's login URL.
ROLE_LOGIN_URLS = {
    'admin': '/adminlogin',
    'teacher': '/teacherlogin/',
    'parent': '/parentlogin',
    'staff': '/stafflogin/',
}


def _client_ip(request):
    forwarded = request.META.get('HTTP_X_FORWARDED_FOR')
    if forwarded:
        return forwarded.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR', 'unknown')


def _reset_password_and_notify(user, actor_description):
    """Sets a new random password on `user` and, if they have a real (non-placeholder)
    email on file, emails them a heads-up naming who reset it. Returns (new_password,
    email_sent) — the plaintext password is never stored, only handed back once to the
    caller for out-of-band relay."""
    new_password = secrets.token_urlsafe(9)  # ~12 char, URL-safe, cryptographically random
    user.set_password(new_password)
    user.save()

    # A relayed temporary password must not quietly become permanent — flag the account
    # so the dashboard blocks access until the user sets their own new password (cleared
    # by api_my_profile's POST handler once they do).
    ForcedPasswordChange.objects.get_or_create(user=user)

    email_sent = False
    if user.email and not user.email.endswith('@student.myfantasia.com'):
        try:
            send_mail(
                subject='Your MyFantasia password was reset',
                message=(
                    f"Hi {user.first_name or user.username},\n\n"
                    f"{actor_description} reset your MyFantasia account password.\n\n"
                    "Please log in with the new password given to you — you'll be asked "
                    "to set your own new password immediately after.\n\n"
                    "— MyFantasia"
                ),
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[user.email],
                fail_silently=True,
            )
            email_sent = True
        except Exception:
            pass

    return new_password, email_sent


class RateLimitedPasswordResetView(auth_views.PasswordResetView):
    """Same as Django's PasswordResetView, except over-threshold requests are
    silently dropped (no email sent) while still rendering the normal success page,
    so throttling itself can't be used to enumerate accounts either."""

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context['login_url'] = ROLE_LOGIN_URLS.get(self.request.GET.get('role'), '/')
        return context

    def form_valid(self, form):
        ip_key = f'pwreset:ip:{_client_ip(self.request)}'
        email_key = f'pwreset:email:{form.cleaned_data.get("email", "").strip().lower()}'

        ip_count = cache.get(ip_key, 0)
        email_count = cache.get(email_key, 0)

        if ip_count >= MAX_REQUESTS_PER_IP_PER_HOUR or email_count >= MAX_REQUESTS_PER_EMAIL_PER_HOUR:
            return super(auth_views.PasswordResetView, self).form_valid(form)  # skip save(), just redirect to done

        cache.set(ip_key, ip_count + 1, 60 * 60)
        cache.set(email_key, email_count + 1, 60 * 60)
        return super().form_valid(form)


class NotifyingPasswordResetConfirmView(auth_views.PasswordResetConfirmView):
    """Same as Django's PasswordResetConfirmView, but emails the account owner a
    heads-up whenever their password is actually changed through this flow, so a
    reset they didn't request doesn't go unnoticed."""

    def form_valid(self, form):
        response = super().form_valid(form)
        user = getattr(self, 'user', None)
        if user is not None and user.email:
            try:
                send_mail(
                    subject='Your MyFantasia password was changed',
                    message=(
                        f"Hi {user.first_name or user.username},\n\n"
                        "Your MyFantasia account password was just changed using the "
                        "\"Forgot password\" link.\n\n"
                        "If this was you, no action is needed. If it wasn't, contact the "
                        "school administration immediately — someone else may have access "
                        "to your account.\n\n"
                        "— MyFantasia"
                    ),
                    from_email=settings.DEFAULT_FROM_EMAIL,
                    recipient_list=[user.email],
                    fail_silently=True,
                )
            except Exception:
                pass
        return response


_ROLE_MODELS = {
    'students': StudentExtra,
    'teachers': TeacherExtra,
    'parents': ParentExtra,
    'staff': StaffExtra,
}


@csrf_exempt
@api_login_required
@require_permission('users.reset_password')
def api_admin_reset_user_password(request):
    """Admin-triggered password reset for a student/teacher/parent/staff account.
    Generates a new random password, sets it directly, and hands it back to the
    admin to relay out-of-band. Also emails the account holder a notice if they
    have a real, non-placeholder email on file.

    Deliberately excludes 'admins' from _ROLE_MODELS: no one, including another
    admin, may reset an admin account's password this way — only that admin's own
    "My Profile" self-service change can do it."""
    if request.method != 'POST':
        return JsonResponse({'status': 'error', 'message': 'Invalid request method'}, status=405)

    try:
        data = json.loads(request.body)
        user_type = data.get('user_type')
        user_id = data.get('id')
    except (json.JSONDecodeError, TypeError):
        return JsonResponse({'status': 'error', 'message': 'Invalid request body'}, status=400)

    model = _ROLE_MODELS.get(user_type)
    if model is None:
        return JsonResponse({'status': 'error', 'message': 'Invalid user type'}, status=400)

    try:
        extra = model.objects.select_related('user').get(id=user_id)
    except model.DoesNotExist:
        return JsonResponse({'status': 'error', 'message': 'User not found'}, status=404)

    new_password, email_sent = _reset_password_and_notify(extra.user, 'An administrator')

    SystemAuditLog.objects.create(
        operator=request.user, action_type='UPDATE', module='PasswordReset',
        description=f"Admin reset password for {user_type[:-1]} account '{extra.user.username}'.",
        ip_address=_client_ip(request),
    )

    return JsonResponse({
        'status': 'success',
        'new_password': new_password,
        'username': extra.user.username,
        'email_notified': email_sent,
    })
