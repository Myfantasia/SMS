from django.core.exceptions import PermissionDenied
from functools import wraps
from django.http import JsonResponse
from . import models
from .rbac import user_has_permission

# --- BASIC GROUP CHECKS ---
def is_admin(user):
    return user.groups.filter(name='ADMIN').exists()

def is_teacher(user):
    return user.groups.filter(name='TEACHER').exists()

def is_student(user):
    return user.groups.filter(name='STUDENT').exists()

def is_parent(user):
    return user.groups.filter(name='PARENT').exists()

def is_school_staff(user):
    # Named to avoid colliding with Django's own User.is_staff flag.
    return user.groups.filter(name='STAFF').exists()


# --- SECURE APPROVAL CHECKS ---
# These prevent unapproved users from typing the URL to bypass the waiting screen.

def is_approved_teacher(user):
    if is_teacher(user):
        teacher = models.TeacherExtra.objects.filter(user_id=user.id, status=True).first()
        if teacher:
            return True
    raise PermissionDenied

def is_approved_student(user):
    if is_student(user):
        student = models.StudentExtra.objects.filter(user_id=user.id, status=True).first()
        if student:
            return True
    raise PermissionDenied

def is_approved_parent(user):
    if is_parent(user):
        parent = models.ParentExtra.objects.filter(user_id=user.id, status=True).first()
        if parent:
            return True
    raise PermissionDenied


# --- RBAC PERMISSION CHECK (For JSON/FBV API Endpoints) ---

def require_permission(view_permission, edit_permission=None):
    """
    Enforces an RBAC permission code for a function-based view.

    If edit_permission is given, GET/HEAD/OPTIONS requests only need view_permission
    while every other method needs edit_permission — lets a single FBV that already
    handles both read and write require different permissions per method without
    being split into two views.

    Either argument may be a single code string, or a tuple/list of alternative codes —
    holding ANY one of them is sufficient (mirrors HasModulePermission in school/rbac.py).
    """

    def decorator(view_func):
        @wraps(view_func)
        def _wrapped_view(request, *args, **kwargs):
            if not request.user.is_authenticated:
                return JsonResponse({
                    'status': 'error',
                    'message': 'Authentication required.'
                }, status=401)

            needed = view_permission
            if edit_permission and request.method not in ('GET', 'HEAD', 'OPTIONS'):
                needed = edit_permission

            codes = (needed,) if isinstance(needed, str) else needed
            if not any(user_has_permission(request.user, code) for code in codes):
                return JsonResponse({
                    'status': 'error',
                    'message': 'Permission denied.'
                }, status=403)

            return view_func(request, *args, **kwargs)

        return _wrapped_view

    return decorator