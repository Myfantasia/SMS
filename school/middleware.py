from django.conf import settings
from django.http import JsonResponse

from school.decorators import is_admin

# Exact paths that stay reachable during maintenance regardless of who's asking.
# Deliberately NOT included: /api/public/afterlogin/. It's the router every login
# (admin and non-admin alike) resolves through, so if it were unconditionally allowed
# here, an already-logged-in non-admin could reach it directly and see whatever it
# returns for their role (e.g. their wait-for-approval destination) — a maintenance-mode
# bypass. A *freshly* authenticated admin doesn't need it whitelisted either: login()
# already ran by the time the frontend calls it, so the admin-bypass check below
# (user.is_authenticated and is_admin(user)) already lets them through on its own.
#
# Note: since the public pages moved to React (frontend/src/public/), Django no longer
# serves any HTML for them directly -- every legitimate request from a browser now goes
# through /api/*, which the prefix check below already covers with a JSON 503. This
# path-level allowlist only needs to keep /logout reachable, so a session that's stuck
# mid-maintenance can still be cleared.
MAINTENANCE_ALLOWED_PATHS = {
    '/logout',
    '/logout/',
}

# Path prefixes that stay reachable regardless of exact path: static/media assets and
# Django's own admin site.
MAINTENANCE_ALLOWED_PREFIXES = (
    '/static/',
    '/media/',
    '/admin/',
)


class MaintenanceModeMiddleware:
    """
    While settings.MAINTENANCE_MODE is on, blocks every request except the allowlist
    above and the admin auth flow. An already-authenticated admin passes through
    untouched; everyone else (anonymous or a non-admin role, even with an existing
    session) gets a 503 instead of whatever they asked for — including direct URL
    access to a dashboard route or API endpoint, not just the login forms.

    Always responds with JSON now (never a Django-rendered HTML page): every caller is
    either the React app's own /api/* calls (which render their own MaintenancePage
    component on a 503, see frontend/src/public/PublicShell.tsx) or something that
    doesn't expect/need an HTML response at all (there's no more Django-rendered public
    page for a stray direct request to fall back to).
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

        return JsonResponse(
            {'status': 'error', 'message': 'The system is currently under maintenance. Please check back shortly.'},
            status=503,
        )
