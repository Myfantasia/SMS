from django.core.cache import cache
from django.http import JsonResponse
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import BasePermission

from apps.identity.services import (
    get_user_effective_rank as _get_user_effective_rank,
    get_undelegatable_permission_codes as _get_undelegatable_permission_codes,
)

from school.models.rbac_models import Permission

# Every RBAC-gated request (HasModulePermission, require_permission) calls
# get_user_permission_codes at least once — with no caching this was a fresh
# Permission/Role/UserRole join on every single request. 90s is short enough that a
# role/permission change reaches an already-cached user almost immediately, but long
# enough to absorb the request volume a real, populated deployment will see.
RBAC_CACHE_TTL_SECONDS = 90


def _rbac_cache_key(user_id):
    return f'rbac_perms:{user_id}'


def invalidate_user_permission_cache(user_id):
    """Call after a per-user Role assignment changes (UserRoleAssignmentAPIView) so the
    affected user doesn't wait out the TTL. A Role's own permission set changing
    (RoleViewSet) affects everyone holding that role — invalidating every one of those
    users individually isn't worth the complexity, so that case relies on the TTL
    self-healing within RBAC_CACHE_TTL_SECONDS instead."""
    cache.delete(_rbac_cache_key(user_id))


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

    cache_key = _rbac_cache_key(user.id)
    codes = cache.get(cache_key)
    if codes is None:
        codes = set(
            Permission.objects.filter(roles__user_assignments__user=user)
            .values_list('code', flat=True).distinct()
        )
        cache.set(cache_key, codes, RBAC_CACHE_TTL_SECONDS)
    return codes


def user_has_permission(user, code):
    return code in get_user_permission_codes(user)


def validate_rank_authority(actor, target_role_rank):
    """Raises PermissionDenied unless `actor` may create/edit/delete/assign/remove a Role
    whose rank is `target_role_rank` (None = unranked). Lower rank number outranks higher;
    an actor may only touch a role STRICTLY more junior (higher number) than their own
    effective rank -- this blocks self-promotion and same-or-senior-rank tampering by
    construction, since a role at or above the actor's own rank always fails the check."""
    if actor.is_superuser:
        return
    if target_role_rank is None:
        raise PermissionDenied(
            "This role has no assigned rank and cannot be managed except by a superuser."
        )
    actor_rank = _get_user_effective_rank(actor.id)
    if actor_rank is None or target_role_rank <= actor_rank:
        raise PermissionDenied("You cannot manage a role at or above your own rank.")


def validate_permission_delegation(actor, permission_codes):
    """Raises PermissionDenied if `actor` doesn't personally hold every code in
    `permission_codes` -- you cannot delegate a permission you don't have yourself,
    regardless of rank."""
    if actor.is_superuser:
        return
    illegal = _get_undelegatable_permission_codes(actor.id, permission_codes)
    if illegal:
        raise PermissionDenied(
            "You cannot delegate permissions you do not possess: " + ", ".join(sorted(illegal))
        )


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
    if hasattr(user, 'staffextra'):
        return 'Staff'
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
