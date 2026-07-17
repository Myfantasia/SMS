from django.conf import settings
from django.http import JsonResponse
from django.shortcuts import render

from school.decorators import is_admin

# Exact paths that stay reachable during maintenance regardless of who's asking: the
# public marketing site, the admin login/signup entry points, and logout. Deliberately
# NOT included: /afterlogin. It's the router every login (admin and non-admin alike)
# redirects through, so if it were unconditionally allowed here, an already-logged-in
# non-admin could reach it directly and see whatever it renders for their role (e.g.
# their wait-for-approval page) — a maintenance-mode bypass. A *freshly* authenticated
# admin doesn't need it whitelisted either: login() already ran before the redirect, so
# by the time the browser follows it to /afterlogin, the admin-bypass check below
# (user.is_authenticated and is_admin(user)) already lets them through on its own.
MAINTENANCE_ALLOWED_PATHS = {
    '/',
    '/aboutus',
    '/contactus',
    '/events/',
    '/privacy-policy/',
    '/terms-of-service/',
    '/system-status/',
    '/adminclick',
    '/adminlogin',
    '/adminlogin/',
    '/adminsignup',
    '/logout',
    '/logout/',
}

# Path prefixes that stay reachable regardless of exact path: static/media assets,
# Django's own admin site, password reset (harmless — only useful with a valid
# emailed token — and it's how a locked-out admin recovers), and the Firebase
# bridges the admin login/signup pages call.
MAINTENANCE_ALLOWED_PREFIXES = (
    '/static/',
    '/media/',
    '/admin/',
    '/password-reset',
    '/api/firebase-login/',
    '/api/firebase-admin-signup/',
)


class MaintenanceModeMiddleware:
    """
    While settings.MAINTENANCE_MODE is on, blocks every request except the public
    marketing pages and the admin auth flow. An already-authenticated admin passes
    through untouched; everyone else (anonymous or a non-admin role, even with an
    existing session) gets a 503 instead of whatever they asked for — including
    direct URL access to a dashboard route or API endpoint, not just the login forms.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if not settings.MAINTENANCE_MODE:
            return self.get_response(request)

        path = request.path

        if path in MAINTENANCE_ALLOWED_PATHS or path.startswith(MAINTENANCE_ALLOWED_PREFIXES):
            return self.get_response(request)

        user = getattr(request, 'user', None)
        if user is not None and user.is_authenticated and (user.is_superuser or is_admin(user)):
            return self.get_response(request)

        if path.startswith('/api/'):
            return JsonResponse(
                {'status': 'error', 'message': 'The system is currently under maintenance. Please check back shortly.'},
                status=503,
            )

        return render(request, 'school/maintenance.html', status=503)
