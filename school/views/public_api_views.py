"""JSON API views for the public (pre-login) pages, consumed by the React frontend's
`frontend/src/public/` route tree.

Every view here wraps the *exact* business logic of its now-removed HTML-rendering
counterpart in school/views/views.py, school/views/teacher_dashboard_view.py, and
school/views/password_reset_views.py -- same Form classes, same validation cascades,
same rate limiting, same Group/RBAC assignment, same audit logging, same message text.
Only the transport changed: JsonResponse instead of render()/redirect(), and POST
bodies are read as request.POST/request.FILES (multipart or form-encoded) rather than
JSON, since several of these forms need file uploads anyway -- keeping every endpoint
on the same body format avoids a two-convention split.
"""
import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import authenticate, login as django_login
from django.contrib.auth.forms import PasswordResetForm, SetPasswordForm
from django.contrib.auth.hashers import check_password
from django.contrib.auth.models import Group, User
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.tokens import default_token_generator
from django.core.cache import cache
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.mail import send_mail
from django.db import connection
from django.http import JsonResponse
from django.utils import timezone
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_POST, require_http_methods

from apps.academics.models import ClassStream, Subject
from apps.core.services import write_audit_log
from apps.identity.models import (
    AdminExtra, AdminInviteCode, ParentExtra, Role, StaffExtra, StudentExtra,
    TeacherExtra, UserRole,
)
from apps.content.models import AlumniReview, BlogPost
from apps.content.serializers import AlumniReviewSerializer, BlogPostSerializer
from apps.messaging.models import Event
from school import forms
from school.decorators import is_admin, is_parent, is_school_staff, is_student, is_teacher
from school.views.auth_rate_limit import (
    client_ip, is_login_rate_limited, record_login_failure, security_logger,
)
from school.views.views import _sanitize_email_local_part

# Matches the hardcoded-origin convention already used throughout this codebase
# (settings.CORS_ALLOWED_ORIGINS / CSRF_TRUSTED_ORIGINS, afterlogin_view's dashboard
# redirects, sessionExpiry.ts) -- not a new pattern.
FRONTEND_ORIGIN = 'http://localhost:5173'

PWRESET_MAX_PER_IP_PER_HOUR = 5
PWRESET_MAX_PER_EMAIL_PER_HOUR = 3


# --- Small shared helpers ---------------------------------------------------------

def _field_errors(form):
    return {field: list(errs) for field, errs in form.errors.items()}


def json_ok(**extra):
    return JsonResponse({'status': 'success', **extra})


def json_error(message, status=400, **extra):
    return JsonResponse({'status': 'error', 'message': message, **extra}, status=status)


_WAIT_NOTES = {
    'teacher': (
        'fa-chalkboard-user',
        "An administrator will review your ID and uploaded photo before activating "
        "your Mwalimu dashboard access.",
    ),
    'student': (
        'fa-user-graduate',
        "An administrator needs to verify your class placement and parent details "
        "before your dashboard unlocks.",
    ),
    'parent': (
        'fa-people-roof',
        "An administrator needs to confirm your connection to your child's record "
        "before you can view their progress.",
    ),
    'staff': (
        'fa-briefcase',
        "Once approved, an administrator will also assign you a Role (e.g. Librarian, "
        "Finance Officer) — that's what determines which modules you'll see.",
    ),
}


def _wait_for_approval(role):
    icon, note = _WAIT_NOTES[role]
    return {'destination': 'wait-for-approval', 'role': role, 'visual_icon': icon, 'wait_note': note}


def _resolve_post_login_destination(user):
    """Lifted verbatim from afterlogin_view (school/views/views.py) -- the single
    source of truth for where a just-authenticated user goes next. Used by every
    login/auto-login-signup endpoint below plus api_afterlogin, so this branching
    logic lives in exactly one place."""
    if user.is_superuser:
        return {'destination': 'external', 'url': f'http://localhost:8000/admin/'}

    if is_admin(user):
        return {'destination': 'dashboard', 'path': '/admin-dashboard'}

    if is_teacher(user):
        if TeacherExtra.objects.filter(user_id=user.id, status=True).exists():
            return {'destination': 'dashboard', 'path': '/teacher-dashboard'}
        return _wait_for_approval('teacher')

    if is_student(user):
        if StudentExtra.objects.filter(user_id=user.id, status=True).exists():
            return {'destination': 'dashboard', 'path': '/student-dashboard'}
        return _wait_for_approval('student')

    if is_parent(user):
        if ParentExtra.objects.filter(user_id=user.id, status=True).exists():
            return {'destination': 'dashboard', 'path': '/parent-dashboard'}
        return _wait_for_approval('parent')

    if is_school_staff(user):
        if StaffExtra.objects.filter(user_id=user.id, status=True).exists():
            return {'destination': 'dashboard', 'path': '/staff-dashboard'}
        return _wait_for_approval('staff')

    return {'destination': 'portal'}


def _get_user_from_uidb64(uidb64):
    try:
        uid = force_str(urlsafe_base64_decode(uidb64))
        return User.objects.get(pk=uid)
    except (TypeError, ValueError, OverflowError, User.DoesNotExist):
        return None


# --- Bootstrap / navigation --------------------------------------------------------

@require_GET
@ensure_csrf_cookie
def api_csrf(request):
    """Called once by the public React shell on mount, before any form becomes
    submittable. Today the CSRF cookie only gets set as a side effect of Django
    rendering a template containing {% csrf_token %} -- with no public page
    server-rendered any more, nothing else sets it (see afterlogin_view's matching
    @ensure_csrf_cookie for the same reason, one step later in the old flow)."""
    return JsonResponse({'status': 'ok'})


@require_GET
def api_afterlogin(request):
    if not request.user.is_authenticated:
        return json_error('Not authenticated.', status=401)
    return JsonResponse({'status': 'success', **_resolve_post_login_destination(request.user)})


@require_GET
def api_home(request):
    events = Event.objects.filter(is_active=True).order_by('-start_time')[:3]
    data = [{
        'id': e.id,
        'title': e.title,
        'description': e.description,
        'start_time': e.start_time.isoformat(),
        'end_time': e.end_time.isoformat(),
        'event_type': e.event_type,
    } for e in events]
    return JsonResponse({'status': 'success', 'recent_events': data})


@require_GET
def api_system_status(request):
    try:
        with connection.cursor() as cursor:
            cursor.execute('SELECT 1')
        database_operational = True
    except Exception:
        database_operational = False

    services = [
        {'name': 'Web Portal & Login', 'operational': True},
        {'name': 'Database', 'operational': database_operational},
        {'name': 'Parent, Student & Teacher Dashboards', 'operational': True},
        {'name': 'Fee Payments (M-PESA)', 'operational': True},
        {'name': 'Results & Report Cards', 'operational': True},
    ]
    all_operational = all(s['operational'] for s in services)
    return JsonResponse({'status': 'success', 'services': services, 'all_operational': all_operational})


@require_GET
def api_public_blog_list(request):
    # Newest first, published only -- drafts stay admin-only until published from
    # the Content management screen. Capped at 30: this is a teaser/listing feed,
    # not a paginated archive (nothing in the design plan calls for one yet).
    posts = BlogPost.objects.filter(is_published=True).order_by('-published_at')[:30]
    data = BlogPostSerializer(posts, many=True, context={'request': request}).data
    return JsonResponse({'status': 'success', 'posts': data})


@require_GET
def api_public_blog_detail(request, slug):
    try:
        post = BlogPost.objects.get(slug=slug, is_published=True)
    except BlogPost.DoesNotExist:
        return json_error('Post not found.', status=404)
    data = BlogPostSerializer(post, context={'request': request}).data
    return JsonResponse({'status': 'success', 'post': data})


@require_GET
def api_public_alumni_reviews(request):
    reviews = AlumniReview.objects.filter(is_published=True).order_by('display_order', '-created_at')
    data = AlumniReviewSerializer(reviews, many=True, context={'request': request}).data
    return JsonResponse({'status': 'success', 'reviews': data})


@require_POST
def api_contact(request):
    form = forms.ContactusForm(request.POST)
    if not form.is_valid():
        return json_error('Please fix the errors below.', field_errors=_field_errors(form))

    email = form.cleaned_data['Email']
    name = form.cleaned_data['Name']
    message = form.cleaned_data['Message']

    try:
        send_mail(
            subject=f'{name} || {email}',
            message=message,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[settings.EMAIL_HOST_USER or settings.DEFAULT_FROM_EMAIL],
            fail_silently=False,
        )
    except Exception:
        return json_error(
            "Sorry, your message could not be sent right now. Please try again "
            "shortly, or reach us directly using the phone number or email above."
        )

    return json_ok(message='Your message has been sent.')


# --- Signup --------------------------------------------------------------------

@require_POST
def api_signup_admin(request):
    form = forms.AdminSigupForm(request.POST)
    if not form.is_valid():
        return json_error('Please fix the errors below.', field_errors=_field_errors(form))

    is_bootstrap = not User.objects.filter(groups__name='ADMIN').exists()
    invite_code = request.POST.get('invite_code', '')
    invite = None

    if not is_bootstrap:
        invite = AdminInviteCode.objects.filter(
            code_hash=AdminInviteCode.hash_code(invite_code)
        ).first() if invite_code else None
        if not invite or invite.status != 'Active':
            return json_error('Invalid or expired invite code. Contact an existing administrator for access.')

    user = form.save(commit=False)
    user.email = form.cleaned_data['email']
    user.set_password(form.cleaned_data['password'])
    user.save()

    admin_extra, _ = AdminExtra.objects.get_or_create(user=user)
    admin_extra.mobile = form.cleaned_data['mobile']
    admin_extra.address = form.cleaned_data['address']
    admin_extra.status = is_bootstrap
    admin_extra.save()

    if invite is not None:
        invite.used_at = timezone.now()
        invite.used_by = user
        invite.save()

    my_admin_group, _ = Group.objects.get_or_create(name='ADMIN')
    if is_bootstrap:
        my_admin_group.user_set.add(user)
        admin_role = Role.objects.filter(name='Admin').first()
        if admin_role:
            UserRole.objects.get_or_create(user=user, role=admin_role)
        message = 'Registration Successful! As the first administrator, you have immediate access.'
    else:
        message = 'Registration submitted! An existing administrator must approve your account before you can log in.'

    return json_ok(message=message, is_bootstrap=is_bootstrap)


@require_GET
def api_student_signup_class_streams(request):
    """Public, pre-login class/stream list for the student admission form's 'cl' field --
    student signup happens before login, so this can't reuse any authenticated dashboard
    endpoint. Mirrors StudentExtraForm.cl's own queryset/ordering exactly, and the
    api_teacher_signup_subjects/api_staff_signup_roles pattern above (same file, same
    trivial GET-a-list-for-a-dropdown shape)."""
    streams = ClassStream.objects.all().order_by('grade__numeric_order', 'name')
    return JsonResponse({
        'status': 'success',
        'class_streams': [{'id': s.id, 'name': str(s)} for s in streams],
    })


@require_POST
def api_signup_student(request):
    form1 = forms.StudentUserForm(request.POST)
    form2 = forms.StudentExtraForm(request.POST, request.FILES)

    if not (form1.is_valid() and form2.is_valid()):
        return json_error('Please fix the errors below.', field_errors={
            **_field_errors(form1), **_field_errors(form2),
        })

    user = form1.save(commit=False)
    user.set_password(user.password)

    first = _sanitize_email_local_part(form1.cleaned_data['first_name'])
    last = _sanitize_email_local_part(form1.cleaned_data['last_name'])
    domain = "@student.myfantasia.com"
    base_email = f"{first}.{last}{domain}"

    email = base_email
    counter = 1
    while User.objects.filter(email=email).exists() and counter < 500:
        email = f"{first}.{last}{counter}{domain}"
        counter += 1
    if User.objects.filter(email=email).exists():
        email = f"{first}.{last}.{secrets.token_hex(3)}{domain}"

    user.email = email
    user.save()

    f2 = form2.save(commit=False)
    f2.user = user
    f2.roll = form1.cleaned_data.get('username')
    f2.status = False
    f2.refresh_parent_summary()
    f2.save()

    my_student_group, _ = Group.objects.get_or_create(name='STUDENT')
    my_student_group.user_set.add(user)

    return json_ok(message='Registration Successful!')


@require_GET
def api_teacher_signup_subjects(request):
    subjects = Subject.objects.all().order_by('name')
    return JsonResponse({'status': 'success', 'subjects': [{'id': s.id, 'name': s.name} for s in subjects]})


@require_POST
def api_signup_teacher(request):
    first_name = request.POST.get('first_name')
    last_name = request.POST.get('last_name')
    username = (request.POST.get('username') or '').strip()
    email = (request.POST.get('email') or '').strip().lower()
    password = request.POST.get('password')
    password2 = request.POST.get('password2')

    id_number = request.POST.get('id_number')
    mobile = request.POST.get('mobile')
    address = request.POST.get('address')
    profile_pic = request.FILES.get('profile_pic')
    subjects_list = request.POST.getlist('subjects')
    subjects_str = ", ".join(subjects_list)

    error = None
    if User.objects.filter(username=username).exists():
        error = 'This username is already taken. Please choose another.'
    elif User.objects.filter(email=email).exists():
        error = 'An account with this email already exists.'
    elif not password:
        error = 'Password is required.'
    else:
        try:
            validate_password(password, user=User(
                username=username, email=email, first_name=first_name, last_name=last_name
            ))
        except DjangoValidationError as e:
            error = ' '.join(e.messages)
        if not error and password != password2:
            error = 'Passwords do not match.'

    if error:
        return json_error(error)

    user = User.objects.create_user(
        username=username, password=password, email=email,
        first_name=first_name, last_name=last_name,
    )

    teacher = TeacherExtra.objects.create(
        user=user, id_number=id_number, mobile=mobile, address=address,
        profile_pic=profile_pic, status=False, salary=0, subjects=subjects_str,
    )
    if subjects_list:
        teacher.qualified_subjects.set(Subject.objects.filter(name__in=subjects_list))

    my_teacher_group, _ = Group.objects.get_or_create(name='TEACHER')
    my_teacher_group.user_set.add(user)
    teacher_role = Role.objects.filter(name='Teacher').first()
    if teacher_role:
        UserRole.objects.get_or_create(user=user, role=teacher_role)

    auth_user = authenticate(username=username, password=password)
    if auth_user is not None:
        django_login(request, auth_user)
        return json_ok(message='Application submitted successfully!', **_resolve_post_login_destination(auth_user))
    return json_ok(message='Application submitted successfully!')


@require_GET
def api_staff_signup_roles(request):
    roles = Role.objects.filter(is_system_role=False).order_by('name')
    return JsonResponse({'status': 'success', 'roles': [{'id': r.id, 'name': r.name} for r in roles]})


@require_POST
def api_signup_staff(request):
    roles = Role.objects.filter(is_system_role=False).order_by('name')

    first_name = request.POST.get('first_name')
    last_name = request.POST.get('last_name')
    username = (request.POST.get('username') or '').strip()
    email = (request.POST.get('email') or '').strip().lower()
    password = request.POST.get('password')
    password2 = request.POST.get('password2')

    job_title = request.POST.get('job_title')
    id_number = request.POST.get('id_number')
    mobile = request.POST.get('mobile')
    address = request.POST.get('address')
    requested_role = roles.filter(id=request.POST.get('role_id')).first()

    error = None
    if User.objects.filter(username=username).exists():
        error = 'This username is already taken. Please choose another.'
    elif User.objects.filter(email=email).exists():
        error = 'An account with this email already exists.'
    elif not password:
        error = 'Password is required.'
    else:
        try:
            validate_password(password, user=User(
                username=username, email=email, first_name=first_name, last_name=last_name
            ))
        except DjangoValidationError as e:
            error = ' '.join(e.messages)
        if not error and password != password2:
            error = 'Passwords do not match.'

    if error:
        return json_error(error)

    user = User.objects.create_user(
        username=username, password=password, email=email,
        first_name=first_name, last_name=last_name,
    )

    StaffExtra.objects.create(
        user=user, job_title=job_title, requested_role=requested_role,
        id_number=id_number, mobile=mobile, address=address, status=False,
    )

    staff_group, _ = Group.objects.get_or_create(name='STAFF')
    staff_group.user_set.add(user)

    auth_user = authenticate(username=username, password=password)
    if auth_user is not None:
        django_login(request, auth_user)
        return json_ok(message='Application submitted successfully!', **_resolve_post_login_destination(auth_user))
    return json_ok(message='Application submitted successfully!')


@require_POST
def api_signup_parent(request):
    # selected_student_ids arrives as a comma-separated string in POST, matching
    # ParentExtraForm.clean_selected_student_ids exactly -- the frontend joins its
    # chip-list of chosen child IDs into that format before submitting.
    form1 = forms.ParentUserForm(request.POST)
    form2 = forms.ParentExtraForm(request.POST)

    if not (form1.is_valid() and form2.is_valid()):
        return json_error('Please fix the errors below.', field_errors={
            **_field_errors(form1), **_field_errors(form2),
        })

    user = form1.save(commit=False)
    raw_password = form1.cleaned_data['password']
    user.set_password(raw_password)
    user.email = form1.cleaned_data['email']
    user.save()

    parent_extra = form2.save(commit=False)
    parent_extra.user = user
    parent_extra.status = False
    parent_extra.save()
    parent_extra.students.set(form2.cleaned_data['selected_student_ids'])

    my_parent_group, _ = Group.objects.get_or_create(name='PARENT')
    my_parent_group.user_set.add(user)

    auth_user = authenticate(username=user.username, password=raw_password)
    if auth_user is not None:
        django_login(request, auth_user)
        return json_ok(message='Registration submitted successfully!', **_resolve_post_login_destination(auth_user))

    # Matches the original view's fallback (HttpResponseRedirect('parentlogin')) for
    # this near-impossible case: account created, but the immediate re-authenticate
    # somehow failed. Account creation itself still succeeded.
    return json_ok(message='Registration submitted successfully! Please log in.', auto_login_failed=True)


# --- Login -----------------------------------------------------------------------

@require_POST
def api_login_admin(request):
    submitted_code = request.POST.get('verification_code')
    if submitted_code:
        verify_email = request.POST.get('verify_email', '')
        try:
            pending_user = User.objects.get(email=verify_email)
            admin_extra = AdminExtra.objects.get(user=pending_user, status=False)
        except (User.DoesNotExist, AdminExtra.DoesNotExist):
            return json_error('Verification session expired. Please log in again to restart.')

        attempts_key = f'verify_code_attempts:{admin_extra.pk}'
        attempts = cache.get(attempts_key, 0)
        code_expired = (
            admin_extra.code_generated_at is not None
            and timezone.now() - admin_extra.code_generated_at > timedelta(minutes=30)
        )

        if attempts >= 5 or code_expired:
            admin_extra.verification_code = None
            admin_extra.code_generated_at = None
            admin_extra.save()
            cache.delete(attempts_key)
            security_logger.warning('Verification code invalidated (expired or too many attempts) for %s', verify_email)
            write_audit_log(
                operator_id=pending_user.id, action_type='AUTH_FAILURE', module='Authentication',
                description=f"2FA verification code expired/exhausted for '{pending_user.username}'.",
                ip_address=client_ip(request),
            )
            return json_error('This code has expired. Ask the approving administrator to approve you again for a fresh code.')

        if admin_extra.verification_code and check_password(submitted_code.strip(), admin_extra.verification_code):
            admin_extra.status = True
            admin_extra.verification_code = None
            admin_extra.code_generated_at = None
            admin_extra.save()
            cache.delete(attempts_key)

            my_admin_group, _ = Group.objects.get_or_create(name='ADMIN')
            my_admin_group.user_set.add(pending_user)
            admin_role = Role.objects.filter(name='Admin').first()
            if admin_role:
                UserRole.objects.get_or_create(user=pending_user, role=admin_role)

            write_audit_log(
                operator_id=pending_user.id, action_type='AUTH_SUCCESS', module='Authentication',
                description=f"2FA verification succeeded for '{pending_user.username}'.",
                ip_address=client_ip(request),
            )
            return json_ok(message='Account verified! You can now log in below.', verified=True)

        cache.set(attempts_key, attempts + 1, 30 * 60)
        write_audit_log(
            operator_id=pending_user.id, action_type='AUTH_FAILURE', module='Authentication',
            description=f"Incorrect 2FA verification code submitted for '{pending_user.username}' (attempt {attempts + 1}).",
            ip_address=client_ip(request),
        )
        return json_error('Incorrect verification code. Please try again.',
                           needs_verification=True, verification_email=verify_email)

    email = request.POST.get('email')
    password = request.POST.get('password')

    if is_login_rate_limited(request, email):
        return json_error('Invalid email or password.')

    try:
        user = User.objects.get(email=email)
    except User.DoesNotExist:
        record_login_failure(request, email)
        return json_error('No account found with this email.')

    auth_user = authenticate(username=user.username, password=password)
    if auth_user is None:
        record_login_failure(request, email)

    if auth_user is not None and auth_user.groups.filter(name='ADMIN').exists():
        django_login(request, auth_user)
        return JsonResponse({'status': 'success', **_resolve_post_login_destination(auth_user)})
    elif auth_user is not None and AdminExtra.objects.filter(user=auth_user, status=False).exists():
        admin_extra = AdminExtra.objects.get(user=auth_user)
        if admin_extra.verification_code:
            # Not an error -- an existing admin already approved and generated a code;
            # prompt for it instead of blocking. Matches the template's silent swap.
            return JsonResponse({'status': 'needs_verification', 'verification_email': email})
        return json_error('Your admin account is pending approval by an existing administrator.')
    else:
        return json_error('Invalid email or password.')


@require_POST
def api_login_student(request):
    username = request.POST.get('username')
    password = request.POST.get('password')

    if is_login_rate_limited(request, username):
        return json_error('Invalid admission number or password.')

    auth_user = authenticate(username=username, password=password)
    if auth_user is not None:
        django_login(request, auth_user)
        return JsonResponse({'status': 'success', **_resolve_post_login_destination(auth_user)})

    record_login_failure(request, username)
    return json_error('Invalid admission number or password.')


@require_POST
def api_login_teacher(request):
    email = request.POST.get('email')
    password = request.POST.get('password')

    if is_login_rate_limited(request, email):
        return json_error('Invalid email or password.')

    try:
        user = User.objects.get(email=email)
    except User.DoesNotExist:
        record_login_failure(request, email)
        return json_error('No account found with this email.')

    auth_user = authenticate(username=user.username, password=password)
    if auth_user is not None:
        django_login(request, auth_user)
        return JsonResponse({'status': 'success', **_resolve_post_login_destination(auth_user)})

    record_login_failure(request, email)
    return json_error('Invalid email or password.')


@require_POST
def api_login_parent(request):
    email = request.POST.get('email')
    password = request.POST.get('password')

    if is_login_rate_limited(request, email):
        return json_error('Invalid email or password.')

    try:
        user = User.objects.get(email=email)
        auth_user = authenticate(username=user.username, password=password)
        if auth_user is not None:
            django_login(request, auth_user)
            return JsonResponse({'status': 'success', **_resolve_post_login_destination(auth_user)})
        record_login_failure(request, email)
        return json_error('Invalid email or password.')
    except User.DoesNotExist:
        record_login_failure(request, email)
        return json_error('No account found with this email.')


@require_POST
def api_login_staff(request):
    # No rate limiting here, matching staff_login_view today (school/views/views.py)
    # -- a known inconsistency versus the other 4 logins, intentionally preserved
    # rather than silently "fixed" as part of this rewrite.
    email = request.POST.get('email')
    password = request.POST.get('password')

    try:
        user = User.objects.get(email=email)
        auth_user = authenticate(username=user.username, password=password)
        if auth_user is not None:
            django_login(request, auth_user)
            return JsonResponse({'status': 'success', **_resolve_post_login_destination(auth_user)})
        return json_error('Invalid email or password.')
    except User.DoesNotExist:
        return json_error('No account found with this email.')


# --- Password reset ----------------------------------------------------------------

@require_POST
def api_password_reset_request(request):
    form = PasswordResetForm(data=request.POST)
    if not form.is_valid():
        return json_error('Please enter a valid email address.', field_errors=_field_errors(form))

    email = form.cleaned_data['email'].strip().lower()
    ip_key = f'pwreset:ip:{client_ip(request)}'
    email_key = f'pwreset:email:{email}'
    ip_count = cache.get(ip_key, 0)
    email_count = cache.get(email_key, 0)

    # Over-threshold requests are silently dropped (no email, no counter bump) while
    # still returning the exact same response as a real request -- matches
    # RateLimitedPasswordResetView.form_valid exactly, so throttling itself can't be
    # used to enumerate accounts either.
    if ip_count < PWRESET_MAX_PER_IP_PER_HOUR and email_count < PWRESET_MAX_PER_EMAIL_PER_HOUR:
        cache.set(ip_key, ip_count + 1, 60 * 60)
        cache.set(email_key, email_count + 1, 60 * 60)

        for user in form.get_users(email):
            uid = urlsafe_base64_encode(force_bytes(user.pk))
            token = default_token_generator.make_token(user)
            reset_url = f'{FRONTEND_ORIGIN}/password-reset-confirm/{uid}/{token}/'
            send_mail(
                subject='Reset your MyFantasia password',
                message=(
                    f"Hi {user.first_name or user.username},\n\n"
                    "You're receiving this email because you (or someone else) requested "
                    "a password reset for your MyFantasia account.\n\n"
                    f"Reset your password here: {reset_url}\n\n"
                    "If you didn't request this, you can safely ignore this email.\n\n"
                    "— MyFantasia"
                ),
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[user.email],
                fail_silently=True,
            )

    return json_ok()


@require_http_methods(['GET', 'POST'])
def api_password_reset_confirm(request, uidb64, token):
    """Not a wrapper of NotifyingPasswordResetConfirmView -- that CBV's redirect-and-
    swap-token-for-session-key dance is a browser-navigation pattern with no equivalent
    for a stateless SPA POST. Re-implemented using the same primitives Django's view
    uses internally (default_token_generator, SetPasswordForm), which is the standard
    approach for an API-driven reset-confirm step."""
    user = _get_user_from_uidb64(uidb64)
    token_valid = user is not None and default_token_generator.check_token(user, token)

    if request.method == 'GET':
        return JsonResponse({'status': 'success', 'valid': bool(token_valid)})

    if not token_valid:
        return json_error('This password reset link is invalid or has expired.', valid=False)

    form = SetPasswordForm(user, data=request.POST)
    if not form.is_valid():
        return json_error('Please fix the errors below.', field_errors=_field_errors(form))

    form.save()

    if user.email:
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

    return json_ok(message='Your password has been reset.')
