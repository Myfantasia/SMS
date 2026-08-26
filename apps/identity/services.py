"""Public service surface for the `identity` app.

Users, role profiles (Teacher/Student/Parent/Admin/Staff Extra), RBAC,
admin invites, School/tenant anchor.

RULE: every function here takes and returns plain dataclasses -- never a
Django model instance or QuerySet. This is what lets `identity` be swapped
for a real HTTP client later (Phase 2/3) without touching any caller.

This app may import services from:
    - apps.core.services (audit logging)

Track B step 9 (final Track B step): TeacherExtra/StudentExtra/ParentExtra/
AdminExtra/StaffExtra/AdminInviteCode/ForcedPasswordChange/Permission/Role/
UserRole physically relocated to apps/identity/models.py -- function bodies
below now import from there directly. school/rbac.py and
school/decorators.py still hold the original, more complete RBAC/permission
logic (this module's RBAC functions are a narrower relocation, kept for
Track A's DTO-boundary story) -- both now import Permission/TeacherExtra/
StudentExtra/ParentExtra from apps.identity.models rather than duplicating
model definitions, but haven't been physically moved into this package
themselves; that consolidation is a follow-up, not required for Track B's
migration-safety goal.
"""
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Optional, Sequence, Union

from django.core.exceptions import ImproperlyConfigured

from apps.identity.models import (
    StudentExtra, TeacherExtra, ParentExtra, Permission, Role, School,
)

RoleLabel = Literal["Admin", "Teacher", "Parent", "Student", "Staff", "User"]

RBAC_CACHE_TTL_SECONDS = 90  # matches school/rbac.py's existing constant -- keep in sync until that file is retired


@dataclass(frozen=True)
class StudentProfileDTO:
    id: int
    user_id: int
    roll: str
    class_stream_id: Optional[int]
    status: bool
    full_name: str


@dataclass(frozen=True)
class TeacherProfileDTO:
    id: int
    user_id: int
    status: bool
    full_name: str


@dataclass(frozen=True)
class ParentProfileDTO:
    id: int
    user_id: int
    status: bool
    student_ids: tuple


@dataclass(frozen=True)
class AdminProfileDTO:
    id: int
    user_id: int
    status: bool


@dataclass(frozen=True)
class StaffProfileDTO:
    id: int
    user_id: int
    status: bool


def get_student_profile(user_id: int) -> Optional[StudentProfileDTO]:
    s = StudentExtra.objects.filter(user_id=user_id).select_related('user').first()
    if not s:
        return None
    return StudentProfileDTO(
        id=s.id, user_id=s.user_id, roll=s.roll, class_stream_id=s.cl_id,
        status=s.status, full_name=f"{s.user.first_name} {s.user.last_name}".strip(),
    )


def get_teacher_profile(user_id: int) -> Optional[TeacherProfileDTO]:
    t = TeacherExtra.objects.filter(user_id=user_id).select_related('user').first()
    if not t:
        return None
    return TeacherProfileDTO(
        id=t.id, user_id=t.user_id, status=t.status,
        full_name=f"{t.user.first_name} {t.user.last_name}".strip(),
    )


def get_parent_profile(user_id: int) -> Optional[ParentProfileDTO]:
    p = ParentExtra.objects.filter(user_id=user_id).first()
    if not p:
        return None
    return ParentProfileDTO(
        id=p.id, user_id=p.user_id, status=p.status,
        student_ids=tuple(p.students.values_list('id', flat=True)),
    )


def is_class_teacher_of_student(user_id: int, student_id: int) -> bool:
    """True if `user_id` is the officially assigned Class Teacher of
    `student_id`'s stream. Relocated from school/rbac.py's
    is_class_teacher_of_student -- same logic, DTO-shaped inputs instead of
    live User/StudentExtra instances."""
    teacher = TeacherExtra.objects.filter(user_id=user_id).first()
    if not teacher:
        return False
    student = StudentExtra.objects.filter(id=student_id).select_related('cl').first()
    return bool(student and student.cl_id and student.cl.class_teacher_id == teacher.id)


def get_user_role_label(user_id: int) -> RoleLabel:
    """Relocated from school/rbac.py's get_user_role_label. Admin-first
    precedence preserved exactly."""
    from django.contrib.auth.models import User

    user = User.objects.filter(id=user_id).first()
    if not user:
        return "User"
    if user.is_superuser or user.is_staff or hasattr(user, 'adminextra') or user.groups.filter(name='ADMIN').exists():
        return "Admin"
    if hasattr(user, 'teacherextra'):
        return "Teacher"
    if hasattr(user, 'parentextra'):
        return "Parent"
    if hasattr(user, 'studentextra'):
        return "Student"
    if hasattr(user, 'staffextra'):
        return "Staff"
    return "User"


def _rbac_cache_key(user_id: int) -> str:
    return f'rbac_perms:{user_id}'


def invalidate_user_permission_cache(user_id: int) -> None:
    from django.core.cache import cache
    cache.delete(_rbac_cache_key(user_id))


def get_user_permission_codes(user_id: int) -> frozenset:
    """Relocated from school/rbac.py's get_user_permission_codes. Same
    90s-TTL cache convention, same superuser bypass."""
    from django.contrib.auth.models import User
    from django.core.cache import cache

    user = User.objects.filter(id=user_id).first()
    if not user or not user.is_authenticated:
        return frozenset()
    if user.is_superuser:
        return frozenset(Permission.objects.values_list('code', flat=True))

    cache_key = _rbac_cache_key(user_id)
    codes = cache.get(cache_key)
    if codes is None:
        codes = frozenset(
            Permission.objects.filter(
                roles__user_assignments__user_id=user_id, roles__is_deleted=False,
            ).values_list('code', flat=True).distinct()
        )
        cache.set(cache_key, codes, RBAC_CACHE_TTL_SECONDS)
    return codes


def get_undelegatable_permission_codes(actor_id: int, permission_codes: Sequence[str]) -> frozenset:
    """Returns the subset of `permission_codes` the actor does NOT hold -- empty means
    every code may legally be delegated. Superusers always get an empty result, since
    get_user_permission_codes already bypasses to every code for them."""
    actor_codes = get_user_permission_codes(actor_id)
    return frozenset(permission_codes) - actor_codes


def get_user_effective_rank(user_id: int) -> Optional[int]:
    """
    -1    -- superuser (outranks every real rank; never stored on a Role)
    None  -- user holds no Role with a non-null rank (least privileged)
    int   -- MIN(rank) across the user's ranked, non-deleted Role assignments
    """
    from django.contrib.auth.models import User

    user = User.objects.filter(id=user_id).first()
    if user and user.is_superuser:
        return -1

    ranks = Role.objects.filter(
        user_assignments__user_id=user_id, rank__isnull=False, is_deleted=False,
    ).values_list('rank', flat=True)
    return min(ranks) if ranks else None


def user_has_permission(user_id: int, code: Union[str, Sequence[str]]) -> bool:
    """`code` may be a single permission code or a sequence of alternatives
    (holding ANY one suffices) -- matches HasModulePermission/
    require_permission's existing calling convention."""
    codes_needed = (code,) if isinstance(code, str) else code
    held = get_user_permission_codes(user_id)
    return any(c in held for c in codes_needed)


@dataclass(frozen=True)
class SchoolDTO:
    id: int
    name: str
    level: str
    shares_compound_with_id: Optional[int]


def create_school(*, name: str, level: str, shares_compound_with_id: Optional[int] = None) -> SchoolDTO:
    """No callers yet -- School (apps/identity/models.py) is a new, inert
    model until the migration is generated and run (see that file's
    docstring) and something starts actually scoping data by school."""
    row = School.objects.create(name=name, level=level, shares_compound_with_id=shares_compound_with_id)
    return SchoolDTO(id=row.id, name=row.name, level=row.level, shares_compound_with_id=row.shares_compound_with_id)


def get_current_school_id(request) -> int:
    """TODO(multi-tenant): interim shim for the CurriculumPreset scoping rollout (see
    /home/jordan/.claude/plans/floofy-churning-mango.md). No profile model (TeacherExtra/
    StudentExtra/AdminExtra/...) carries a `school` link yet, so there is no real way to
    derive "this request's school" from `request.user` -- that wiring is a separate,
    materially bigger project (see School's own docstring). Until it exists, this assumes
    exactly one School row exists in the whole system and returns it, failing loudly rather
    than guessing the moment that stops being true. `request` is accepted now, unused, so
    the call signature doesn't change when real per-user derivation replaces this body.
    """
    count = School.objects.count()
    if count == 0:
        raise ImproperlyConfigured(
            "No School row exists yet -- run `python manage.py backfill_curriculum_preset_school` first."
        )
    if count > 1:
        raise ImproperlyConfigured(
            "More than one School row exists -- get_current_school_id() can no longer guess which "
            "one a request belongs to. Wire request.user to a school before a second school is added "
            "(see the 'Explicitly out of scope' section of the CurriculumPreset scoping plan)."
        )
    return School.objects.values_list('id', flat=True).get()
