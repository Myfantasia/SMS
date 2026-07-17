from rest_framework.permissions import BasePermission
from django.core.exceptions import PermissionDenied
from functools import wraps
from django.http import JsonResponse


# ==========================================
# 1. DJANGO REST FRAMEWORK CUSTOM PERMISSIONS (For CBVs)
# ==========================================

class IsApprovedAdmin(BasePermission):
    """
    Grants access to active superusers, staff, or members of the ADMIN group.
    Mirrors the check_is_admin/api_admin_required pattern used everywhere else in this
    codebase — ADMIN-group membership is the actual authority signal. Do NOT also require
    an AdminExtra row here: it's optional profile data, not part of the admin grant, and
    admins created without one (e.g. added to the group directly) were previously locked
    out of RBAC management despite passing every other admin-gated endpoint.
    """

    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated):
            return False
        return bool(
            request.user.is_superuser or
            request.user.is_staff or
            request.user.groups.filter(name='ADMIN').exists()
        )


class IsApprovedTeacher(BasePermission):
    """
    Grants access strictly to authenticated teachers whose profiles
    have been marked as status=True by an administrator.
    """

    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated):
            return False
        try:
            return request.user.teacherextra.status is True
        except AttributeError:
            return False


class IsApprovedAdminOrTeacher(BasePermission):
    """
    Composite permission allowing access to either approved administrators
    or approved teachers. Ideal for grading pipelines and student profile viewing.
    """

    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated):
            return False

        is_admin = request.user.is_superuser or request.user.groups.filter(name='ADMIN').exists()
        try:
            is_teacher = request.user.teacherextra.status is True
        except AttributeError:
            is_teacher = False

        return bool(is_admin or is_teacher)


# ==========================================
# 2. FUNCTION-BASED VIEW DECORATORS (For JSON/FBV API Endpoints)
# ==========================================

def api_login_required(view_func):
    """
    Enforces authentication for function-based views and returns a unified
    clean JSON payload instead of an HTML redirect on failure.
    """

    @wraps(view_func)
    def _wrapped_view(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return JsonResponse({
                'status': 'error',
                'message': 'Authentication credentials were not provided or are invalid.'
            }, status=401)
        return view_func(request, *args, **kwargs)

    return _wrapped_view


def api_admin_required(view_func):
    """
    Enforces active administrative permissions for traditional function-based views.
    """

    @wraps(view_func)
    def _wrapped_view(request, *args, **kwargs):
        if not request.user.is_superuser and not request.user.groups.filter(name='ADMIN').exists():
            return JsonResponse({
                'status': 'error',
                'message': 'Permission denied. System Administrator authorization required.'
            }, status=403)
        return view_func(request, *args, **kwargs)

    return _wrapped_view