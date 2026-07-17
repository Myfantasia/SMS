from django.http import JsonResponse
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import BasePermission

from school.models.rbac_models import Permission


def get_user_permission_codes(user):
    """Resolves the set of permission codes granted to a user.

    Superusers bypass this entirely, matching the is_superuser-first convention
    already used by IsApprovedAdmin/api_admin_required elsewhere in this codebase —
    a superuser never needs a Role assignment.
    """
    if not user.is_authenticated:
        return set()
    if user.is_superuser:
        return set(Permission.objects.values_list('code', flat=True))
    return set(
        Permission.objects.filter(roles__user_assignments__user=user)
        .values_list('code', flat=True).distinct()
    )


def user_has_permission(user, code):
    return code in get_user_permission_codes(user)


def get_user_role_label(user):
    """Human-readable role label for a Django User (e.g. chat participant lists).

    Admin-first precedence, mirroring chat_views.check_is_admin's predicate inline
    rather than importing it — chat_views already imports from this module, so the
    reverse import would be circular.
    """
    if user.is_superuser or user.is_staff or hasattr(user, 'adminextra') or user.groups.filter(name='ADMIN').exists():
        return 'Admin'
    if hasattr(user, 'teacherextra'):
        return 'Teacher'
    if hasattr(user, 'parentextra'):
        return 'Parent'
    if hasattr(user, 'studentextra'):
        return 'Student'
    return 'User'


class HasModulePermission(BasePermission):
    """
    Generic DRF permission class for module-level RBAC gating on class-based views.

    Reads rbac_view_permission / rbac_edit_permission off the view class rather than
    being subclassed per module, so a gated APIView/ViewSet just sets two class
    attributes and adds this class to its existing permission_classes list — added
    alongside whatever's already there, so it can only tighten access, never loosen it.

    Either attribute may be a single code string, or a tuple/list of alternative codes —
    holding ANY one of them is sufficient. This is how a broad code (e.g. exams.edit) and a
    narrower one scoped to just this action (e.g. exams.marks) both work for the same view:
    set rbac_edit_permission = ('exams.edit', 'exams.marks') rather than duplicating the view.

    Mirrors require_permission's GET-vs-mutating split (school/decorators.py).
    """

    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated):
            return False

        view_code = getattr(view, 'rbac_view_permission', None)
        edit_code = getattr(view, 'rbac_edit_permission', None)

        needed = view_code
        if edit_code and request.method not in ('GET', 'HEAD', 'OPTIONS'):
            needed = edit_code

        if not needed:
            return True

        codes = (needed,) if isinstance(needed, str) else needed
        return any(user_has_permission(request.user, code) for code in codes)


def assert_curriculum_editable(curriculum, user):
    """
    Gate for writes against anything scoped to a Curriculum (presets, pathways, pools, or
    the grade-level subject rules in subject_views.py via grade.curriculum). An archived
    curriculum is frozen against ordinary curriculum.edit writes — only curriculum.archive
    holders can still correct it, and doing so is logged as a distinct, auditable event
    rather than blending into routine edits.

    No-op if curriculum is None (record predates the curriculum link, see CurriculumPreset).
    """
    if curriculum is None or not curriculum.is_archived:
        return

    if not user_has_permission(user, 'curriculum.archive'):
        raise PermissionDenied(
            f"'{curriculum.name}' is archived — only an admin with curriculum.archive can "
            "make changes to it."
        )

    from school.models.classSubjects_models import SystemAuditLog
    SystemAuditLog.objects.create(
        operator=user,
        action_type='UPDATE',
        module='ArchivedCurriculumCorrection',
        description=f"Modified archived curriculum '{curriculum.name}' (user: {user.username})."
    )


def is_class_teacher_of_student(user, student):
    """
    True if `user` is the officially assigned Class Teacher of `student`'s stream.

    The same check is duplicated inline in attendance_views.py and results_views.py
    (against a ClassStream directly, e.g. `stream.class_teacher_id == teacher_profile.id`)
    without a shared helper. This is the student-scoped version, added here since pathway
    approval is now a third consumer of the same idea — worth centralizing.
    """
    teacher = getattr(user, 'teacherextra', None)
    return bool(teacher and student.cl_id and student.cl.class_teacher_id == teacher.id)


def curriculum_edit_guard(curriculum, user):
    """FBV-friendly wrapper around assert_curriculum_editable, for the plain
    JsonResponse-returning views in subject_views.py (not DRF, so PermissionDenied would
    otherwise surface as an unhandled 500 instead of a clean 403).

    Returns a 403 JsonResponse if the write should be blocked, or None if it may proceed
    (any archived-curriculum correction has already been logged by this point).
    """
    try:
        assert_curriculum_editable(curriculum, user)
    except PermissionDenied as e:
        return JsonResponse({'status': 'error', 'message': str(e)}, status=403)
    return None
