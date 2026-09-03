"""
Admin-triggered password reset for accounts that can't use self-service reset yet
(currently: students, whose signup email is an auto-generated @student.myfantasia.com
address with no real inbox behind it — not a limitation of the self-service flow
itself, just of student email addresses today. Once those become real, the self-service
flow in school/views/public_api_views.py -- api_password_reset_request/
api_password_reset_confirm -- starts working for them with no changes needed).

Resetting someone else's password is admin-only (api_admin_reset_user_password) and
deliberately can't target another admin account — every other role only ever changes
their own password via their own "My Profile" self-service form.

The self-service "forgot password" flow used to live in this file as
RateLimitedPasswordResetView/NotifyingPasswordResetConfirmView (Django's server-rendered
auth views) -- removed when the public pages moved to React; see
school/views/public_api_views.py's api_password_reset_request/api_password_reset_confirm
for its JSON-API replacement (a separate, self-contained token/throttle implementation --
it doesn't reuse anything in this file, since it lets the user set their own chosen
password rather than generating one, unlike _reset_password_and_notify below).
"""
import json
import secrets

from django.conf import settings
from django.core.mail import send_mail
from django.http import JsonResponse

from apps.identity.models import TeacherExtra, StudentExtra, ParentExtra, StaffExtra, ForcedPasswordChange
from apps.core.services import write_audit_log
from school.decorators import require_permission
from school.permissions import api_login_required


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


_ROLE_MODELS = {
    'students': StudentExtra,
    'teachers': TeacherExtra,
    'parents': ParentExtra,
    'staff': StaffExtra,
}


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

    write_audit_log(
        operator_id=request.user.id, action_type='UPDATE', module='PasswordReset',
        description=f"Admin reset password for {user_type[:-1]} account '{extra.user.username}'.",
        ip_address=_client_ip(request),
    )

    return JsonResponse({
        'status': 'success',
        'new_password': new_password,
        'username': extra.user.username,
        'email_notified': email_sent,
    })
