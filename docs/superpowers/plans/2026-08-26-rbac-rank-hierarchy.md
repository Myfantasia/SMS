# RBAC Rank Hierarchy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a rank-based delegation hierarchy to the existing RBAC system — a `Role.rank` field, two independent authorization guards (rank gate + no-escalation), and a `rbac.manage` permission code that lets rank-appropriate non-ADMIN-group users reach Role management — plus a nullable `Role.school` field so `Role` is "configuration as data" ready for multi-school growth, matching the `CurriculumPreset` precedent.

**Architecture:** Two new pure-computation functions in `apps/identity/services.py` (`get_user_effective_rank`, `get_undelegatable_permission_codes`), matching that file's existing "take IDs, return primitives" convention. Two new exception-raising wrapper functions in `school/rbac.py` (`validate_rank_authority`, `validate_permission_delegation`), matching that file's existing `assert_curriculum_editable` pattern of building `PermissionDenied`-raising guards on top of the pure `apps.identity.services` functions. Both guards get called from `RoleViewSet`'s three mutation methods and from `UserRoleAssignmentAPIView.post`/`delete`. Superusers bypass both guards unconditionally, as they already bypass RBAC entirely.

**Tech Stack:** Django 6, DRF, `apps.identity` (models/services), `school.rbac`/`school.views.rbac_views` (view-layer integration), React 19 + TS (RoleEditor/RolesPermissions pages).

**Spec:** `docs/superpowers/specs/2026-08-25-rbac-rank-hierarchy-design.md`

## Global Constraints

- **Never run `makemigrations` or `migrate`.** Migration files are prepared and committed; the user applies them. Same for the `backfill_role_school` management command — prepare it, document how to run it, don't run it in this session.
- **Guards raise `rest_framework.exceptions.PermissionDenied`**, never a bare exception — DRF's default exception handler converts this to a 403 automatically from inside `perform_create`/`perform_update`/`perform_destroy`/`post`/`delete`, the same way the existing `ValidationError` raises in `RoleViewSet` already do.
- **DTO-boundary convention**: functions in `apps/identity/services.py` take primitive `user_id: int` / `Sequence[str]` arguments and return primitives (`bool`, `frozenset`, `Optional[int]`) — never a Django model instance, matching that file's own stated rule and its existing `get_user_permission_codes`/`user_has_permission`. Exception-raising, request/view-facing logic belongs in `school/rbac.py`, matching the existing `assert_curriculum_editable` pattern — not in `apps/identity/services.py`.
- **`Role.school` stays nullable this round** — no required-field migration. See the spec's "Deviation from the `CurriculumPreset` precedent" note: making it required would force `school=` onto ~24 existing `Role.objects.create`/`get_or_create` call sites across 14 test files plus `populate_demo_staff.py`/`seed_rbac.py`, with no behavioral payoff while the system runs one school.
- **Every Role/UserRole mutation wrapped in `transaction.atomic()`** — the DB write and its `write_audit_log()` call must not partially apply.
- **Test conventions**: plain `django.test.TestCase` (not `APITestCase`), `self.client.force_login(...)` + `reverse(...)`, `cache.clear()` in every `setUp`, manual `Permission.objects.create`/`Role.objects.create`/`UserRole.objects.create` — no factory library. Matches `school/tests/test_rbac_admin_teacher.py`/`test_rbac_caching.py`.

---

### Task 1: `Role.rank` field + migration

**Files:**
- Modify: `apps/identity/models.py:456-475` (`Role` class)
- Create: `apps/identity/migrations/0006_role_rank.py`
- Test: `school/tests/test_rbac_rank_hierarchy.py` (new file)

**Interfaces:**
- Produces: `Role.rank: Optional[int]` — every later task reads this field.

- [ ] **Step 1: Write the failing test**

Create `school/tests/test_rbac_rank_hierarchy.py`:

```python
from django.core.cache import cache
from django.test import TestCase

from apps.identity.models import Role


class RoleRankFieldTests(TestCase):
    def setUp(self):
        cache.clear()

    def test_role_can_be_created_without_a_rank(self):
        role = Role.objects.create(name='Unranked Custom Role')
        self.assertIsNone(role.rank)

    def test_role_can_be_created_with_a_rank(self):
        role = Role.objects.create(name='Principal', rank=1)
        self.assertEqual(role.rank, 1)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python manage.py test school.tests.test_rbac_rank_hierarchy -v 2`
Expected: FAIL — `TypeError: 'rank' is an invalid keyword argument for this function` (field doesn't exist yet).

- [ ] **Step 3: Add the field**

In `apps/identity/models.py`, inside `class Role(models.Model):` (`:456`), add after `description`:

```python
    rank = models.PositiveSmallIntegerField(
        null=True, blank=True,
        help_text="Delegation tier. Lower ranks outrank higher ones. Null means "
                  "unranked -- cannot be granted or managed by anyone except a superuser.",
    )
```

- [ ] **Step 4: Write the migration**

Create `apps/identity/migrations/0006_role_rank.py`:

```python
# Hand-written -- see Hard Rule #1 in .claude/skills/sms-orient/SKILL.md (migrations are
# manual). Verify with `python manage.py makemigrations identity --check --dry-run` before
# applying.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('identity', '0005_role_deleted_at_role_deleted_by_role_is_deleted'),
    ]

    operations = [
        migrations.AddField(
            model_name='role',
            name='rank',
            field=models.PositiveSmallIntegerField(
                null=True, blank=True,
                help_text="Delegation tier. Lower ranks outrank higher ones. Null means "
                          "unranked -- cannot be granted or managed by anyone except a superuser.",
            ),
        ),
    ]
```

- [ ] **Step 5: Run test to verify it passes**

Run: `python manage.py test school.tests.test_rbac_rank_hierarchy -v 2`
Expected: PASS (2 tests) — Django's test runner applies every migration to the ephemeral test DB regardless of what's applied to the dev DB, so this passes now even though the dev DB migration hasn't been run.

- [ ] **Step 6: Commit**

```bash
git add apps/identity/models.py apps/identity/migrations/0006_role_rank.py school/tests/test_rbac_rank_hierarchy.py
git commit -m "feat(rbac): add Role.rank field"
```

---

### Task 2: `Role.school` field + migration + backfill command

**Files:**
- Modify: `apps/identity/models.py:456-475` (`Role` class)
- Create: `apps/identity/migrations/0007_role_school.py`
- Create: `school/management/commands/backfill_role_school.py`
- Test: `school/tests/test_backfill_role_school.py` (new file)

**Interfaces:**
- Produces: `Role.school: Optional[School]` (nullable FK) — Task 9 filters `RoleViewSet`'s queryset by it.

- [ ] **Step 1: Add the field**

In `apps/identity/models.py`, inside `class Role(models.Model):`, change `name` and add `school`:

```python
    name = models.CharField(max_length=100)
    description = models.CharField(max_length=255, blank=True)
    rank = models.PositiveSmallIntegerField(
        null=True, blank=True,
        help_text="Delegation tier. Lower ranks outrank higher ones. Null means "
                  "unranked -- cannot be granted or managed by anyone except a superuser.",
    )
    school = models.ForeignKey(
        'School', on_delete=models.PROTECT, null=True, blank=True, related_name='roles',
        help_text="Server-derived, never client-supplied -- see get_current_school_id(). "
                  "Nullable: this system runs one school today, see the RBAC design spec's "
                  "'Deviation from the CurriculumPreset precedent' note for why this field "
                  "isn't required yet.",
    )
```

And update `class Meta:` (currently just `db_table = 'school_role'`):

```python
    class Meta:
        db_table = 'school_role'
        unique_together = [('school', 'name')]
```

- [ ] **Step 2: Write the migration**

Create `apps/identity/migrations/0007_role_school.py`:

```python
# Hand-written -- see Hard Rule #1 in .claude/skills/sms-orient/SKILL.md. Mirrors
# apps/academics/migrations/0004_curriculumpreset_school.py's shape, stopping at nullable --
# see the "Deviation from the CurriculumPreset precedent" note in
# docs/superpowers/specs/2026-08-25-rbac-rank-hierarchy-design.md. Verify with
# `python manage.py makemigrations identity --check --dry-run` before applying.

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('identity', '0006_role_rank'),
    ]

    operations = [
        migrations.AddField(
            model_name='role',
            name='school',
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.PROTECT,
                related_name='roles', to='identity.school',
                help_text='Server-derived, never client-supplied -- see get_current_school_id(). '
                          'Nullable: this system runs one school today.',
            ),
        ),
        migrations.AlterField(
            model_name='role',
            name='name',
            field=models.CharField(max_length=100),
        ),
        migrations.AlterUniqueTogether(
            name='role',
            unique_together={('school', 'name')},
        ),
    ]
```

- [ ] **Step 3: Write the failing backfill test**

Create `school/tests/test_backfill_role_school.py`:

```python
from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase

from apps.identity.models import Role, School


class BackfillRoleSchoolTests(TestCase):
    def setUp(self):
        cache.clear()
        self.school = School.objects.create(name='Default School', level='COMBINED')

    def test_assigns_the_existing_school_to_unassigned_roles(self):
        role = Role.objects.create(name='Bursar')
        self.assertIsNone(role.school)

        call_command('backfill_role_school')

        role.refresh_from_db()
        self.assertEqual(role.school_id, self.school.id)

    def test_is_idempotent(self):
        Role.objects.create(name='Bursar')
        call_command('backfill_role_school')
        call_command('backfill_role_school')  # should not error on a second run
        self.assertEqual(Role.objects.filter(school__isnull=True).count(), 0)

    def test_dry_run_makes_no_changes(self):
        role = Role.objects.create(name='Bursar')
        call_command('backfill_role_school', '--dry-run')
        role.refresh_from_db()
        self.assertIsNone(role.school)

    def test_errors_without_a_school_row(self):
        self.school.delete()
        Role.objects.create(name='Bursar')
        call_command('backfill_role_school')  # writes to stderr, doesn't raise
        self.assertEqual(Role.objects.filter(school__isnull=True).count(), 1)
```

- [ ] **Step 4: Run test to verify it fails**

Run: `python manage.py test school.tests.test_backfill_role_school -v 2`
Expected: FAIL — `CommandError: Unknown command: 'backfill_role_school'`.

- [ ] **Step 5: Write the backfill command**

Create `school/management/commands/backfill_role_school.py`:

```python
from django.core.management.base import BaseCommand

from apps.identity.models import Role, School


class Command(BaseCommand):
    """
    One-time backfill run after migrating in Role.school (nullable, from
    apps.identity.migrations.0007_role_school). Assigns the one existing School row to
    every Role that doesn't have one yet -- without this, RoleViewSet's school-scoped
    queryset would show zero existing roles.

    Assumes exactly one School row already exists (apps.academics's
    backfill_curriculum_preset_school creates it if this is the first tenancy-scoped
    entity to run in this deployment) -- mirrors that command's own single-tenant
    assumption rather than duplicating its "create a Default School" logic.

    Safe to re-run (idempotent): a second run finds zero unassigned roles left.

    Usage:
        python manage.py backfill_role_school             # apply
        python manage.py backfill_role_school --dry-run   # preview only
    """
    help = "Assign the existing School to every Role that doesn't have one yet."

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true', help="Preview without saving changes.")

    def handle(self, *args, **options):
        dry_run = options['dry_run']

        count = School.objects.count()
        if count == 0:
            self.stderr.write(self.style.ERROR(
                "No School row exists yet -- run "
                "`python manage.py backfill_curriculum_preset_school` first."
            ))
            return
        if count > 1:
            self.stderr.write(self.style.ERROR(
                f"Found {count} School rows -- this command assumes single-tenant and won't "
                "guess which one owns the unassigned roles. Assign them manually."
            ))
            return

        school = School.objects.get()
        unassigned = Role.objects.filter(school__isnull=True)
        updated = unassigned.count()
        if not dry_run:
            unassigned.update(school=school)

        self.stdout.write(self.style.SUCCESS(
            f"\n{'[DRY RUN] Would assign' if dry_run else 'Assigned'} school to {updated} role(s)."
        ))
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `python manage.py test school.tests.test_backfill_role_school school.tests.test_rbac_rank_hierarchy -v 2`
Expected: PASS (6 tests total).

- [ ] **Step 7: Commit**

```bash
git add apps/identity/models.py apps/identity/migrations/0007_role_school.py school/management/commands/backfill_role_school.py school/tests/test_backfill_role_school.py
git commit -m "feat(rbac): add nullable Role.school field and backfill command"
```

---

### Task 3: Expose `rank` on `RoleSerializer`

**Files:**
- Modify: `school/serializers/rbac_serializers.py:12-23`
- Test: `school/tests/test_rbac_rank_hierarchy.py`

**Interfaces:**
- Consumes: `Role.rank` (Task 1).
- Produces: `RoleSerializer` accepts/returns `rank` in its JSON — Tasks 9/11 rely on this.

- [ ] **Step 1: Write the failing test**

Append to `school/tests/test_rbac_rank_hierarchy.py`:

```python
from school.serializers.rbac_serializers import RoleSerializer


class RoleSerializerRankFieldTests(TestCase):
    def setUp(self):
        cache.clear()

    def test_rank_is_serialized(self):
        role = Role.objects.create(name='Principal', rank=1)
        data = RoleSerializer(role).data
        self.assertEqual(data['rank'], 1)

    def test_rank_is_writable_and_optional(self):
        serializer = RoleSerializer(data={'name': 'Bursar', 'rank': 3})
        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertEqual(serializer.validated_data['rank'], 3)

        serializer_no_rank = RoleSerializer(data={'name': 'Custom Role'})
        self.assertTrue(serializer_no_rank.is_valid(), serializer_no_rank.errors)
        self.assertNotIn('rank', serializer_no_rank.validated_data)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python manage.py test school.tests.test_rbac_rank_hierarchy.RoleSerializerRankFieldTests -v 2`
Expected: FAIL — `KeyError: 'rank'` on the first test.

- [ ] **Step 3: Add `rank` to the serializer**

In `school/serializers/rbac_serializers.py`, update `Meta.fields`:

```python
class Meta:
    model = Role
    fields = ['id', 'name', 'description', 'rank', 'permissions', 'permission_ids', 'is_system_role', 'member_count']
    read_only_fields = ['is_system_role']
```

`school` is deliberately **not** added here — it stays server-derived only (Task 9 sets it directly, never from client input).

- [ ] **Step 4: Run test to verify it passes**

Run: `python manage.py test school.tests.test_rbac_rank_hierarchy.RoleSerializerRankFieldTests -v 2`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add school/serializers/rbac_serializers.py school/tests/test_rbac_rank_hierarchy.py
git commit -m "feat(rbac): expose Role.rank on RoleSerializer"
```

---

### Task 4: `get_user_effective_rank` service function

**Files:**
- Modify: `apps/identity/services.py`
- Test: `school/tests/test_rbac_rank_hierarchy.py`

**Interfaces:**
- Consumes: `Role.rank` (Task 1), `UserRole` (existing).
- Produces: `get_user_effective_rank(user_id: int) -> Optional[int]` — consumed by `validate_rank_authority` (Task 6).

- [ ] **Step 1: Write the failing test**

Append to `school/tests/test_rbac_rank_hierarchy.py`:

```python
from django.contrib.auth.models import User

from apps.identity.models import UserRole
from apps.identity.services import get_user_effective_rank


class GetUserEffectiveRankTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(username='ranked_user', password='x')

    def test_superuser_is_rank_negative_one(self):
        su = User.objects.create_superuser(username='root', password='x', email='root@test.com')
        self.assertEqual(get_user_effective_rank(su.id), -1)

    def test_user_with_no_roles_is_none(self):
        self.assertIsNone(get_user_effective_rank(self.user.id))

    def test_user_with_one_ranked_role(self):
        role = Role.objects.create(name='Class Teacher', rank=4)
        UserRole.objects.create(user=self.user, role=role)
        self.assertEqual(get_user_effective_rank(self.user.id), 4)

    def test_effective_rank_is_the_minimum_across_roles(self):
        UserRole.objects.create(user=self.user, role=Role.objects.create(name='Class Teacher', rank=4))
        UserRole.objects.create(user=self.user, role=Role.objects.create(name='Subject Teacher', rank=5))
        self.assertEqual(get_user_effective_rank(self.user.id), 4)

    def test_unranked_roles_are_ignored(self):
        UserRole.objects.create(user=self.user, role=Role.objects.create(name='Custom Unranked'))
        self.assertIsNone(get_user_effective_rank(self.user.id))

    def test_soft_deleted_roles_are_ignored(self):
        role = Role.objects.create(name='Deleted Role', rank=2, is_deleted=True)
        UserRole.objects.create(user=self.user, role=role)
        self.assertIsNone(get_user_effective_rank(self.user.id))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python manage.py test school.tests.test_rbac_rank_hierarchy.GetUserEffectiveRankTests -v 2`
Expected: FAIL — `ImportError: cannot import name 'get_user_effective_rank'`.

- [ ] **Step 3: Write the function**

In `apps/identity/services.py`, add near `get_user_permission_codes` (after it, matching that function's style exactly):

```python
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
```

Add the `Role` import to the existing `from apps.identity.models import (...)` block at the top of the file (currently `StudentExtra, TeacherExtra, ParentExtra, Permission, School`):

```python
from apps.identity.models import (
    StudentExtra, TeacherExtra, ParentExtra, Permission, Role, School,
)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python manage.py test school.tests.test_rbac_rank_hierarchy.GetUserEffectiveRankTests -v 2`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/identity/services.py school/tests/test_rbac_rank_hierarchy.py
git commit -m "feat(rbac): add get_user_effective_rank service function"
```

---

### Task 5: `get_undelegatable_permission_codes` service function

**Files:**
- Modify: `apps/identity/services.py`
- Test: `school/tests/test_rbac_rank_hierarchy.py`

**Interfaces:**
- Consumes: `get_user_permission_codes` (existing).
- Produces: `get_undelegatable_permission_codes(actor_id: int, permission_codes) -> frozenset` — consumed by `validate_permission_delegation` (Task 6).

- [ ] **Step 1: Write the failing test**

Append to `school/tests/test_rbac_rank_hierarchy.py`:

```python
from apps.identity.models import Permission
from apps.identity.services import get_undelegatable_permission_codes


class GetUndelegatablePermissionCodesTests(TestCase):
    def setUp(self):
        cache.clear()
        self.finance_view = Permission.objects.create(code='finance.view', label='View finance', module='Finance')
        self.exams_view = Permission.objects.create(code='exams.view', label='View exams', module='Exams')

    def test_superuser_can_delegate_anything(self):
        su = User.objects.create_superuser(username='root', password='x', email='root@test.com')
        result = get_undelegatable_permission_codes(su.id, ['finance.view', 'exams.view'])
        self.assertEqual(result, frozenset())

    def test_actor_holding_all_codes_has_nothing_undelegatable(self):
        user = User.objects.create_user(username='principal', password='x')
        role = Role.objects.create(name='Principal', rank=1)
        role.permissions.set([self.finance_view, self.exams_view])
        UserRole.objects.create(user=user, role=role)
        result = get_undelegatable_permission_codes(user.id, ['finance.view'])
        self.assertEqual(result, frozenset())

    def test_actor_missing_a_code_gets_it_back(self):
        user = User.objects.create_user(username='deputy', password='x')
        role = Role.objects.create(name='Deputy', rank=2)
        role.permissions.set([self.exams_view])  # no finance.view
        UserRole.objects.create(user=user, role=role)
        result = get_undelegatable_permission_codes(user.id, ['finance.view', 'exams.view'])
        self.assertEqual(result, frozenset({'finance.view'}))
```

Add `from django.contrib.auth.models import User` and `from apps.identity.models import Permission, Role, UserRole` at the top of the test file if not already present from earlier tasks (they are, from Task 4 — reuse the same imports, don't duplicate the import lines).

- [ ] **Step 2: Run test to verify it fails**

Run: `python manage.py test school.tests.test_rbac_rank_hierarchy.GetUndelegatablePermissionCodesTests -v 2`
Expected: FAIL — `ImportError: cannot import name 'get_undelegatable_permission_codes'`.

- [ ] **Step 3: Write the function**

In `apps/identity/services.py`, add directly after `get_user_permission_codes`:

```python
def get_undelegatable_permission_codes(actor_id: int, permission_codes: Sequence[str]) -> frozenset:
    """Returns the subset of `permission_codes` the actor does NOT hold -- empty means
    every code may legally be delegated. Superusers always get an empty result, since
    get_user_permission_codes already bypasses to every code for them."""
    actor_codes = get_user_permission_codes(actor_id)
    return frozenset(permission_codes) - actor_codes
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python manage.py test school.tests.test_rbac_rank_hierarchy.GetUndelegatablePermissionCodesTests -v 2`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/identity/services.py school/tests/test_rbac_rank_hierarchy.py
git commit -m "feat(rbac): add get_undelegatable_permission_codes service function"
```

---

### Task 6: `validate_rank_authority` and `validate_permission_delegation` guards

**Files:**
- Modify: `school/rbac.py`
- Test: `school/tests/test_rbac_rank_hierarchy.py`

**Interfaces:**
- Consumes: `get_user_effective_rank`, `get_undelegatable_permission_codes` (Tasks 4/5).
- Produces: `validate_rank_authority(actor: User, target_role_rank: Optional[int]) -> None` (raises `PermissionDenied`), `validate_permission_delegation(actor: User, permission_codes) -> None` (raises `PermissionDenied`) — consumed by Tasks 9/10.

- [ ] **Step 1: Write the failing test**

Append to `school/tests/test_rbac_rank_hierarchy.py`:

```python
from rest_framework.exceptions import PermissionDenied

from school.rbac import validate_rank_authority, validate_permission_delegation


class ValidateRankAuthorityTests(TestCase):
    def setUp(self):
        cache.clear()

    def _user_at_rank(self, username, rank):
        user = User.objects.create_user(username=username, password='x')
        role = Role.objects.create(name=f'{username}_role', rank=rank)
        UserRole.objects.create(user=user, role=role)
        return user

    def test_superuser_bypasses(self):
        su = User.objects.create_superuser(username='root', password='x', email='root@test.com')
        validate_rank_authority(su, 1)  # does not raise, even for rank 1

    def test_actor_cannot_manage_own_rank(self):
        principal = self._user_at_rank('principal', 1)
        with self.assertRaises(PermissionDenied):
            validate_rank_authority(principal, 1)

    def test_actor_cannot_manage_a_more_senior_rank(self):
        deputy = self._user_at_rank('deputy', 2)
        with self.assertRaises(PermissionDenied):
            validate_rank_authority(deputy, 1)

    def test_actor_can_manage_a_strictly_junior_rank(self):
        principal = self._user_at_rank('principal2', 1)
        validate_rank_authority(principal, 6)  # does not raise

    def test_peers_cannot_manage_each_other(self):
        senior_teacher = self._user_at_rank('senior_teacher', 3)
        with self.assertRaises(PermissionDenied):
            validate_rank_authority(senior_teacher, 3)

    def test_null_target_rank_is_blocked_for_non_superuser(self):
        principal = self._user_at_rank('principal3', 1)
        with self.assertRaises(PermissionDenied):
            validate_rank_authority(principal, None)

    def test_roleless_actor_cannot_manage_any_ranked_role(self):
        user = User.objects.create_user(username='no_roles', password='x')
        with self.assertRaises(PermissionDenied):
            validate_rank_authority(user, 6)


class ValidatePermissionDelegationTests(TestCase):
    def setUp(self):
        cache.clear()
        self.finance_view = Permission.objects.create(code='finance.view', label='View finance', module='Finance')

    def test_superuser_bypasses(self):
        su = User.objects.create_superuser(username='root2', password='x', email='root2@test.com')
        validate_permission_delegation(su, ['finance.view'])  # does not raise

    def test_actor_missing_a_code_raises(self):
        deputy = User.objects.create_user(username='deputy2', password='x')
        role = Role.objects.create(name='Deputy2', rank=2)  # no finance.view
        UserRole.objects.create(user=deputy, role=role)
        with self.assertRaises(PermissionDenied):
            validate_permission_delegation(deputy, ['finance.view'])

    def test_actor_holding_all_codes_does_not_raise(self):
        bursar = User.objects.create_user(username='bursar', password='x')
        role = Role.objects.create(name='Bursar Role', rank=3)
        role.permissions.set([self.finance_view])
        UserRole.objects.create(user=bursar, role=role)
        validate_permission_delegation(bursar, ['finance.view'])  # does not raise
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python manage.py test school.tests.test_rbac_rank_hierarchy.ValidateRankAuthorityTests school.tests.test_rbac_rank_hierarchy.ValidatePermissionDelegationTests -v 2`
Expected: FAIL — `ImportError: cannot import name 'validate_rank_authority'`.

- [ ] **Step 3: Write the guards**

In `school/rbac.py`, update the import block at the top:

```python
from apps.identity.services import (
    invalidate_user_permission_cache as _invalidate_user_permission_cache,
    get_user_permission_codes as _get_user_permission_codes,
    user_has_permission as _user_has_permission,
    get_user_role_label as _get_user_role_label,
    is_class_teacher_of_student as _is_class_teacher_of_student,
    get_user_effective_rank as _get_user_effective_rank,
    get_undelegatable_permission_codes as _get_undelegatable_permission_codes,
)
```

Then add, after `user_has_permission` and before `get_user_role_label`:

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python manage.py test school.tests.test_rbac_rank_hierarchy.ValidateRankAuthorityTests school.tests.test_rbac_rank_hierarchy.ValidatePermissionDelegationTests -v 2`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add school/rbac.py school/tests/test_rbac_rank_hierarchy.py
git commit -m "feat(rbac): add validate_rank_authority and validate_permission_delegation guards"
```

---

### Task 7: `rbac.manage` permission, Admin/Teacher ranks, `seed_rbac.py` school wiring

**Files:**
- Modify: `school/management/commands/seed_rbac.py`
- Test: `school/tests/test_seed_rbac.py` (new file)

**Interfaces:**
- Consumes: `Role.rank`/`Role.school` (Tasks 1/2).
- Produces: `Permission(code='rbac.manage')` exists after seeding, `Role.objects.get(name='Admin').rank == 1`, `Role.objects.get(name='Teacher').rank == 5` — Task 8 relies on `rbac.manage` existing.

- [ ] **Step 1: Write the failing test**

Create `school/tests/test_seed_rbac.py`:

```python
from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase

from apps.identity.models import Permission, Role, School


class SeedRbacRankAndSchoolTests(TestCase):
    def setUp(self):
        cache.clear()
        self.school = School.objects.create(name='Default School', level='COMBINED')

    def test_rbac_manage_permission_is_seeded(self):
        call_command('seed_rbac')
        self.assertTrue(Permission.objects.filter(code='rbac.manage').exists())

    def test_admin_role_gets_rank_one_and_rbac_manage(self):
        call_command('seed_rbac')
        admin = Role.objects.get(name='Admin')
        self.assertEqual(admin.rank, 1)
        self.assertTrue(admin.permissions.filter(code='rbac.manage').exists())

    def test_teacher_role_gets_rank_five(self):
        call_command('seed_rbac')
        teacher = Role.objects.get(name='Teacher')
        self.assertEqual(teacher.rank, 5)

    def test_admin_and_teacher_roles_get_the_school(self):
        call_command('seed_rbac')
        admin = Role.objects.get(name='Admin')
        teacher = Role.objects.get(name='Teacher')
        self.assertEqual(admin.school_id, self.school.id)
        self.assertEqual(teacher.school_id, self.school.id)

    def test_rerunning_stays_idempotent(self):
        call_command('seed_rbac')
        call_command('seed_rbac')
        self.assertEqual(Role.objects.filter(name='Admin').count(), 1)
        self.assertEqual(Role.objects.filter(name='Teacher').count(), 1)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python manage.py test school.tests.test_seed_rbac -v 2`
Expected: FAIL — `AssertionError: False is not true` on `test_rbac_manage_permission_is_seeded` (code doesn't exist yet).

- [ ] **Step 3: Update `seed_rbac.py`**

Add `rbac.manage` to `PERMISSIONS` (after the `Trash` entries, as its own module):

```python
    ('trash.view', 'View the Trash (soft-deleted items across all modules)', 'Trash'),
    ('trash.manage', 'Restore or permanently delete items in the Trash', 'Trash'),

    ('rbac.manage', 'Create, edit, delete, and assign RBAC roles -- subject to the rank and permission-containment guards', 'RBAC'),
]
```

Add a rank constant near `ROLE_GROUP_SOURCE`:

```python
ROLE_GROUP_SOURCE = {
    'Admin': 'ADMIN',
    'Teacher': 'TEACHER',
}

# Anchor points for the rank hierarchy -- Admin=1 (Principal-equivalent) and Teacher=5
# (Subject Teacher-equivalent) are the two ends the rest of the ladder (seeded separately,
# Phase 3) is defined relative to. See the RBAC design spec's rank table.
SYSTEM_ROLE_RANKS = {
    'Admin': 1,
    'Teacher': 5,
}
```

Add the `School` import at the top:

```python
from apps.identity.models import Permission, Role, School, UserRole
```

In `handle()`, right after `dry_run = options['dry_run']`, resolve the school once:

```python
        dry_run = options['dry_run']
        school = School.objects.first()
        if school is None and not dry_run:
            self.stderr.write(self.style.WARNING(
                "No School row exists yet -- roles will be seeded without a school. Run "
                "`python manage.py backfill_curriculum_preset_school` first if you want "
                "Admin/Teacher scoped to a school."
            ))
```

Update the Admin `get_or_create`/`update_or_create` block (both the dry-run branch's `Role.objects.filter(name='Admin')` lookups and the real branch) to include `school` and `rank`:

```python
        if dry_run:
            admin_exists = Role.objects.filter(name='Admin').exists()
            all_codes = [c for c, _, m in PERMISSIONS if m != 'Trash']
            self.stdout.write(f"  {'exists' if admin_exists else '[DRY RUN] would create'}: Admin -> ALL except Trash ({len(all_codes)} permissions)")
            roles_by_name['Admin'] = Role.objects.filter(name='Admin').first()
        else:
            # `school` is part of the lookup, not just defaults=, now that Role's unique
            # constraint is (school, name) rather than a bare unique name -- get_or_create's
            # lookup kwargs must match the constraint it's relying on, or a second school's
            # 'Admin' row (once multi-school is real) would raise MultipleObjectsReturned
            # instead of correctly creating its own.
            admin_role, created = Role.objects.get_or_create(
                name='Admin', school=school,
                defaults={'description': 'Full access to every module.', 'rank': SYSTEM_ROLE_RANKS['Admin']},
            )
            if admin_role.rank != SYSTEM_ROLE_RANKS['Admin']:
                admin_role.rank = SYSTEM_ROLE_RANKS['Admin']
                admin_role.save(update_fields=['rank'])
            # Trash is the one module Admin does NOT get automatically -- it's a
            # deliberate per-admin grant via Roles & Permissions, not a blanket right.
            admin_role.permissions.set(Permission.objects.exclude(code__startswith='trash.'))
            if not admin_role.is_system_role:
                admin_role.is_system_role = True
                admin_role.save(update_fields=['is_system_role'])
            roles_by_name['Admin'] = admin_role
            self.stdout.write(f"  {'created' if created else 'updated'}: Admin -> ALL except Trash ({Permission.objects.exclude(code__startswith='trash.').count()} permissions)")
```

Same pattern for Teacher:

```python
        if dry_run:
            teacher_exists = Role.objects.filter(name='Teacher').exists()
            self.stdout.write(f"  {'exists' if teacher_exists else '[DRY RUN] would create'}: Teacher -> {TEACHER_PERMISSIONS}")
            roles_by_name['Teacher'] = Role.objects.filter(name='Teacher').first()
        else:
            teacher_role, created = Role.objects.get_or_create(
                name='Teacher', school=school,
                defaults={'description': 'Day-to-day teaching modules.', 'rank': SYSTEM_ROLE_RANKS['Teacher']},
            )
            if teacher_role.rank != SYSTEM_ROLE_RANKS['Teacher']:
                teacher_role.rank = SYSTEM_ROLE_RANKS['Teacher']
                teacher_role.save(update_fields=['rank'])
            teacher_role.permissions.set([permissions_by_code[c] for c in TEACHER_PERMISSIONS if permissions_by_code.get(c)])
            if not teacher_role.is_system_role:
                teacher_role.is_system_role = True
                teacher_role.save(update_fields=['is_system_role'])
            roles_by_name['Teacher'] = teacher_role
            self.stdout.write(f"  {'created' if created else 'updated'}: Teacher -> {TEACHER_PERMISSIONS}")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python manage.py test school.tests.test_seed_rbac -v 2`
Expected: PASS (5 tests).

- [ ] **Step 5: Run the full existing RBAC test suite to check for regressions**

Run: `python manage.py test school.tests.test_rbac_admin_teacher school.tests.test_rbac_caching -v 2`
Expected: PASS, unchanged — these tests create `Role(name='Admin'/'Teacher', ...)` directly without going through `seed_rbac`, so they're unaffected by this task's changes.

- [ ] **Step 6: Commit**

```bash
git add school/management/commands/seed_rbac.py school/tests/test_seed_rbac.py
git commit -m "feat(rbac): seed rbac.manage permission and Admin/Teacher ranks"
```

---

### Task 8: Composite entry gate (`IsApprovedAdmin | HasModulePermission`)

**Files:**
- Modify: `school/views/rbac_views.py:1-35`
- Test: `school/tests/test_rbac_rank_hierarchy.py`

**Interfaces:**
- Consumes: `HasModulePermission` (existing, `school/rbac.py:36`), `rbac.manage` (Task 7).
- Produces: a non-ADMIN-group user holding `rbac.manage` can now reach `PermissionViewSet`/`RoleViewSet`/`UserRoleAssignmentAPIView`.

- [ ] **Step 1: Write the failing test**

Append to `school/tests/test_rbac_rank_hierarchy.py`:

```python
from django.urls import reverse


class RbacManageEntryGateTests(TestCase):
    def setUp(self):
        cache.clear()

    def test_rbac_manage_holder_without_admin_group_can_list_roles(self):
        permission = Permission.objects.create(code='rbac.manage', label='Manage RBAC', module='RBAC')
        role = Role.objects.create(name='Senior Teacher', rank=3)
        role.permissions.add(permission)
        user = User.objects.create_user(username='senior_teacher', password='x')
        UserRole.objects.create(user=user, role=role)

        self.client.force_login(user)
        response = self.client.get(reverse('rbac-role-list'))
        self.assertEqual(response.status_code, 200)

    def test_user_without_rbac_manage_or_admin_group_is_forbidden(self):
        user = User.objects.create_user(username='nobody', password='x')
        self.client.force_login(user)
        response = self.client.get(reverse('rbac-role-list'))
        self.assertEqual(response.status_code, 403)

    def test_existing_admin_group_access_is_unchanged(self):
        from django.contrib.auth.models import Group
        admin_group, _ = Group.objects.get_or_create(name='ADMIN')
        user = User.objects.create_user(username='group_admin', password='x')
        user.groups.add(admin_group)

        self.client.force_login(user)
        response = self.client.get(reverse('rbac-role-list'))
        self.assertEqual(response.status_code, 200)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python manage.py test school.tests.test_rbac_rank_hierarchy.RbacManageEntryGateTests -v 2`
Expected: FAIL — `test_rbac_manage_holder_without_admin_group_can_list_roles` gets 403 (only `IsApprovedAdmin` is wired today).

- [ ] **Step 3: Wire the composite gate**

In `school/views/rbac_views.py`, update the import block:

```python
from apps.core.services import write_audit_log
from apps.identity.models import Permission, Role, UserRole
from school.permissions import IsApprovedAdmin
from school.rbac import HasModulePermission, invalidate_user_permission_cache, validate_permission_delegation, validate_rank_authority
from school.serializers.rbac_serializers import PermissionSerializer, RoleSerializer
```

Update `PermissionViewSet`:

```python
class PermissionViewSet(viewsets.ReadOnlyModelViewSet):
    """Read-only catalog — permissions are code, not admin-authored data."""
    queryset = Permission.objects.all()
    serializer_class = PermissionSerializer
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsApprovedAdmin | HasModulePermission]
    rbac_view_permission = 'rbac.manage'
```

Update `RoleViewSet`'s class attributes (queryset/get_queryset changes in Task 9):

```python
class RoleViewSet(viewsets.ModelViewSet):
    """..."""  # docstring unchanged
    serializer_class = RoleSerializer
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsApprovedAdmin | HasModulePermission]
    rbac_view_permission = 'rbac.manage'
    rbac_edit_permission = 'rbac.manage'
```

Update `UserRoleAssignmentAPIView`:

```python
class UserRoleAssignmentAPIView(APIView):
    """Search users and view/assign/unassign their RBAC roles."""
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsApprovedAdmin | HasModulePermission]
    rbac_view_permission = 'rbac.manage'
    rbac_edit_permission = 'rbac.manage'
```

(This drops the separate `IsAuthenticated` from `UserRoleAssignmentAPIView`'s old `permission_classes = [IsApprovedAdmin, IsAuthenticated]` — both `IsApprovedAdmin` and `HasModulePermission` already check `request.user.is_authenticated` themselves, so it was redundant.)

- [ ] **Step 4: Run test to verify it passes**

Run: `python manage.py test school.tests.test_rbac_rank_hierarchy.RbacManageEntryGateTests -v 2`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full RBAC test suite to check for regressions**

Run: `python manage.py test school.tests -v 2`
Expected: PASS, no regressions (`RoleViewSet`/`UserRoleAssignmentAPIView`'s `queryset` still exists as a class attribute until Task 9, so this task alone is safe).

- [ ] **Step 6: Commit**

```bash
git add school/views/rbac_views.py school/tests/test_rbac_rank_hierarchy.py
git commit -m "feat(rbac): composite IsApprovedAdmin | rbac.manage entry gate"
```

---

### Task 9: `RoleViewSet` — school-scoped queryset + guard integration

**Files:**
- Modify: `school/views/rbac_views.py` (`RoleViewSet`)
- Test: `school/tests/test_rbac_rank_hierarchy.py`

**Interfaces:**
- Consumes: `validate_rank_authority`, `validate_permission_delegation` (Task 6), `get_current_school_id` (existing, `apps/identity/services.py:201`).
- Produces: `RoleViewSet.create`/`update`/`partial_update`/`destroy` now enforce both guards; `list`/`retrieve` are scoped to the current school.

- [ ] **Step 1: Write the failing tests**

Append to `school/tests/test_rbac_rank_hierarchy.py`:

```python
class RoleViewSetGuardTests(TestCase):
    def setUp(self):
        cache.clear()
        self.school = School.objects.create(name='Default School', level='COMBINED')

    def _login_at_rank(self, username, rank, extra_codes=None):
        user = User.objects.create_user(username=username, password='x')
        role = Role.objects.create(name=f'{username}_role', rank=rank, school=self.school)
        if extra_codes:
            role.permissions.set(Permission.objects.filter(code__in=extra_codes))
        UserRole.objects.create(user=user, role=role)
        self.client.force_login(user)
        return user

    def test_create_role_at_junior_rank_succeeds(self):
        self._login_at_rank('principal', 1)
        response = self.client.post(reverse('rbac-role-list'), {'name': 'New Staff Role', 'rank': 6}, content_type='application/json')
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(Role.objects.get(name='New Staff Role').school_id, self.school.id)

    def test_create_role_at_own_rank_is_forbidden(self):
        self._login_at_rank('senior_teacher', 3)
        response = self.client.post(reverse('rbac-role-list'), {'name': 'Peer Role', 'rank': 3}, content_type='application/json')
        self.assertEqual(response.status_code, 403)
        self.assertFalse(Role.objects.filter(name='Peer Role').exists())

    def test_create_role_with_permission_actor_lacks_is_forbidden(self):
        finance_view = Permission.objects.create(code='finance.view', label='View finance', module='Finance')
        self._login_at_rank('principal2', 1)  # no permissions granted
        response = self.client.post(
            reverse('rbac-role-list'),
            {'name': 'Finance Role', 'rank': 3, 'permission_ids': [finance_view.id]},
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 403)
        self.assertFalse(Role.objects.filter(name='Finance Role').exists())

    def test_update_role_rank_to_a_more_senior_tier_is_forbidden(self):
        self._login_at_rank('principal3', 1)
        target = Role.objects.create(name='Staff Target', rank=6, school=self.school)
        response = self.client.patch(reverse('rbac-role-detail', args=[target.id]), {'rank': 1}, content_type='application/json')
        self.assertEqual(response.status_code, 403)
        target.refresh_from_db()
        self.assertEqual(target.rank, 6)

    def test_update_a_senior_roles_permissions_is_forbidden(self):
        self._login_at_rank('senior_teacher2', 3)
        senior_target = Role.objects.create(name='Another Rank 1', rank=1, school=self.school)
        response = self.client.patch(reverse('rbac-role-detail', args=[senior_target.id]), {'description': 'hijacked'}, content_type='application/json')
        self.assertEqual(response.status_code, 403)

    def test_delete_role_at_junior_rank_succeeds(self):
        self._login_at_rank('principal4', 1)
        target = Role.objects.create(name='Deletable Staff Role', rank=6, school=self.school)
        response = self.client.delete(reverse('rbac-role-detail', args=[target.id]))
        self.assertEqual(response.status_code, 204)

    def test_delete_role_at_own_rank_is_forbidden(self):
        self._login_at_rank('senior_teacher3', 3)
        peer = Role.objects.create(name='Peer Delete Target', rank=3, school=self.school)
        response = self.client.delete(reverse('rbac-role-detail', args=[peer.id]))
        self.assertEqual(response.status_code, 403)

    def test_superuser_bypasses_both_guards(self):
        su = User.objects.create_superuser(username='root3', password='x', email='root3@test.com')
        self.client.force_login(su)
        response = self.client.post(reverse('rbac-role-list'), {'name': 'Superuser Made Role', 'rank': 1}, content_type='application/json')
        self.assertEqual(response.status_code, 201, response.content)

    def test_list_is_scoped_to_current_school(self):
        Role.objects.create(name='Scoped Role', rank=6, school=self.school)
        self._login_at_rank('principal5', 1)
        response = self.client.get(reverse('rbac-role-list'))
        self.assertEqual(response.status_code, 200)
        names = [r['name'] for r in response.json()]
        self.assertIn('Scoped Role', names)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python manage.py test school.tests.test_rbac_rank_hierarchy.RoleViewSetGuardTests -v 2`
Expected: FAIL — e.g. `test_create_role_at_own_rank_is_forbidden` gets 201 instead of 403 (no guard wired yet).

- [ ] **Step 3: Wire the guards into `RoleViewSet`**

In `school/views/rbac_views.py`, add `from django.db import transaction` to the top imports, then replace the `queryset = ...` class attribute and the three `perform_*` methods:

```python
class RoleViewSet(viewsets.ModelViewSet):
    """
    Every mutation here grants or revokes real access elsewhere in the system, so — like
    every other sensitive admin action in this codebase (curriculum rules, allocation splits,
    exam mark alterations, enrollment changes) — it's logged to SystemAuditLog(module='RBAC').

    Guarded by two independent checks on every mutation (see school.rbac): the rank gate
    (an actor may only touch a role strictly more junior than their own effective rank) and
    permission containment (an actor may only grant permission codes they hold themselves).
    Superusers bypass both.
    """
    serializer_class = RoleSerializer
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsApprovedAdmin | HasModulePermission]
    rbac_view_permission = 'rbac.manage'
    rbac_edit_permission = 'rbac.manage'

    def get_queryset(self):
        from apps.identity.services import get_current_school_id
        return (
            Role.objects.filter(is_deleted=False, school_id=get_current_school_id(self.request))
            .prefetch_related('permissions')
            .annotate(member_count=Count('user_assignments', distinct=True))
        )

    @action(detail=True, methods=['get'])
    def members(self, request, pk=None):
        """Reverse lookup for the role card: who actually holds this role today.
        Without this, seeing a role's real-world footprint meant searching users one by
        one on the assignment panel — there was no way to go role -> people."""
        role = self.get_object()
        users = User.objects.filter(rbac_roles__role=role).order_by('first_name', 'last_name', 'username')
        return Response([
            {
                'id': u.id,
                'username': u.username,
                'email': u.email,
                'full_name': f"{u.first_name} {u.last_name}".strip() or u.username,
            }
            for u in users
        ])

    def perform_create(self, serializer):
        from apps.identity.services import get_current_school_id

        actor = self.request.user
        validate_rank_authority(actor, serializer.validated_data.get('rank'))
        permission_codes = {p.code for p in serializer.validated_data.get('permissions', [])}
        validate_permission_delegation(actor, permission_codes)

        with transaction.atomic():
            role = serializer.save(school_id=get_current_school_id(self.request))
            codes = sorted(role.permissions.values_list('code', flat=True))
            write_audit_log(
                operator_id=actor.id,
                action_type='CREATE',
                module='RBAC',
                description=f"Created role '{role.name}' with permissions: {', '.join(codes) or 'none'}."
            )

    def perform_update(self, serializer):
        actor = self.request.user
        validate_rank_authority(actor, serializer.instance.rank)
        new_rank = serializer.validated_data.get('rank', serializer.instance.rank)
        validate_rank_authority(actor, new_rank)

        new_permissions = serializer.validated_data.get('permissions')
        if new_permissions is not None:
            validate_permission_delegation(actor, {p.code for p in new_permissions})

        old_codes = set(serializer.instance.permissions.values_list('code', flat=True))
        old_name = serializer.instance.name

        # System roles (Admin/Teacher) can still have their permissions adjusted freely, but
        # not renamed — seed_rbac.py looks them up by exact name, and every non-superuser
        # admin's access depends on that name staying stable.
        if serializer.instance.is_system_role:
            new_name = serializer.validated_data.get('name', old_name)
            if new_name != old_name:
                raise ValidationError({
                    'name': f"'{old_name}' is a core system role and can't be renamed."
                })

        with transaction.atomic():
            role = serializer.save()
            new_codes = set(role.permissions.values_list('code', flat=True))

            added = sorted(new_codes - old_codes)
            removed = sorted(old_codes - new_codes)
            changes = []
            if old_name != role.name:
                changes.append(f"renamed from '{old_name}' to '{role.name}'")
            if added:
                changes.append(f"granted: {', '.join(added)}")
            if removed:
                changes.append(f"revoked: {', '.join(removed)}")

            write_audit_log(
                operator_id=actor.id,
                action_type='UPDATE',
                module='RBAC',
                description=f"Updated role '{role.name}'" + (f" — {'; '.join(changes)}." if changes else " (no changes).")
            )

    def perform_destroy(self, instance):
        validate_rank_authority(self.request.user, instance.rank)

        if instance.is_system_role:
            raise ValidationError(
                f"'{instance.name}' is a core system role and can't be deleted. "
                "You can still edit which permissions it grants."
            )

        from apps.core.trash import soft_delete
        role_name = instance.name
        affected_user_ids = list(instance.user_assignments.values_list('user_id', flat=True))
        affected_users = list(instance.user_assignments.values_list('user__username', flat=True))
        with transaction.atomic():
            soft_delete(
                instance, operator=self.request.user, module='RBAC',
                description=f"Deleted role '{role_name}'" + (
                    f" — previously assigned to: {', '.join(affected_users)}." if affected_users else "."
                ),
            )
            for uid in affected_user_ids:
                invalidate_user_permission_cache(uid)
```

Note: `queryset` was previously a class attribute; it's now `get_queryset()` since it needs `self.request`. `member_count` is still available via the `.annotate()` inside `get_queryset()`, so `RoleSerializer`'s `member_count` field keeps working unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `python manage.py test school.tests.test_rbac_rank_hierarchy.RoleViewSetGuardTests -v 2`
Expected: PASS (9 tests).

- [ ] **Step 5: Run the full test suite to check for regressions**

Run: `python manage.py test school.tests -v 2`
Expected: PASS with no regressions. No other test file references the `rbac-role`/
`rbac-permission`/`rbac-user-assignments` URL names (confirmed by grepping
`school/tests/` before writing this plan) — every other test file that creates a `Role`
does so to exercise a *different* endpoint's permission check (trash, promotion, etc.),
never `RoleViewSet` itself, so the new `get_queryset()` school filter has no test surface
to break. If this assumption turns out wrong (a newly-added test in the meantime does hit
these URLs), the fix is adding `school=` to that specific test's `Role.objects.create(...)`
call, not changing `RoleViewSet`.

- [ ] **Step 6: Commit**

```bash
git add school/views/rbac_views.py school/tests/test_rbac_rank_hierarchy.py
git commit -m "feat(rbac): wire rank + containment guards and school scoping into RoleViewSet"
```

---

### Task 10: `UserRoleAssignmentAPIView` — guard integration

**Files:**
- Modify: `school/views/rbac_views.py` (`UserRoleAssignmentAPIView`)
- Test: `school/tests/test_rbac_rank_hierarchy.py`

**Interfaces:**
- Consumes: `validate_rank_authority` (Task 6).
- Produces: `.post`/`.delete` now enforce the rank guard, on top of the existing self-lockout guard.

- [ ] **Step 1: Write the failing tests**

Append to `school/tests/test_rbac_rank_hierarchy.py`:

```python
class UserRoleAssignmentGuardTests(TestCase):
    def setUp(self):
        cache.clear()
        self.school = School.objects.create(name='Default School', level='COMBINED')

    def _login_at_rank(self, username, rank):
        actor = User.objects.create_user(username=username, password='x')
        role = Role.objects.create(name=f'{username}_role', rank=rank, school=self.school)
        UserRole.objects.create(user=actor, role=role)
        self.client.force_login(actor)
        return actor

    def test_assign_junior_role_succeeds(self):
        self._login_at_rank('principal6', 1)
        target_user = User.objects.create_user(username='new_staff', password='x')
        staff_role = Role.objects.create(name='Staff Role Assign', rank=6, school=self.school)
        response = self.client.post(
            reverse('rbac-user-assignments'),
            {'user_id': target_user.id, 'role_id': staff_role.id},
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(UserRole.objects.filter(user=target_user, role=staff_role).exists())

    def test_assign_role_at_own_rank_is_self_promotion_and_forbidden(self):
        actor = self._login_at_rank('senior_teacher4', 3)
        peer_role = Role.objects.create(name='Peer Assign Target', rank=3, school=self.school)
        response = self.client.post(
            reverse('rbac-user-assignments'),
            {'user_id': actor.id, 'role_id': peer_role.id},
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 403)
        self.assertFalse(UserRole.objects.filter(user=actor, role=peer_role).exists())

    def test_unassign_junior_role_succeeds(self):
        self._login_at_rank('principal7', 1)
        target_user = User.objects.create_user(username='staff_to_remove', password='x')
        staff_role = Role.objects.create(name='Removable Staff Role', rank=6, school=self.school)
        UserRole.objects.create(user=target_user, role=staff_role)
        response = self.client.delete(
            reverse('rbac-user-assignments'),
            {'user_id': target_user.id, 'role_id': staff_role.id},
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(UserRole.objects.filter(user=target_user, role=staff_role).exists())

    def test_unassign_senior_role_from_another_user_is_forbidden(self):
        self._login_at_rank('senior_teacher5', 3)
        senior_user = User.objects.create_user(username='another_principal', password='x')
        senior_role = Role.objects.create(name='Rank One Role', rank=1, school=self.school)
        UserRole.objects.create(user=senior_user, role=senior_role)
        response = self.client.delete(
            reverse('rbac-user-assignments'),
            {'user_id': senior_user.id, 'role_id': senior_role.id},
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 403)
        self.assertTrue(UserRole.objects.filter(user=senior_user, role=senior_role).exists())

    def test_self_lockout_guard_still_fires_before_rank_guard(self):
        actor = self._login_at_rank('lone_staff', 6)
        only_role = UserRole.objects.get(user=actor).role
        response = self.client.delete(
            reverse('rbac-user-assignments'),
            {'user_id': actor.id, 'role_id': only_role.id},
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("lock you out", response.json()['error'])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python manage.py test school.tests.test_rbac_rank_hierarchy.UserRoleAssignmentGuardTests -v 2`
Expected: FAIL — `test_assign_role_at_own_rank_is_self_promotion_and_forbidden` gets 200 instead of 403 (no guard wired yet).

- [ ] **Step 3: Wire the guard into `.post` and `.delete`**

In `school/views/rbac_views.py`, update `UserRoleAssignmentAPIView.post`:

```python
    def post(self, request):
        user_id = request.data.get('user_id')
        role_id = request.data.get('role_id')
        try:
            user = User.objects.get(id=user_id)
            role = Role.objects.get(id=role_id)
        except (User.DoesNotExist, Role.DoesNotExist):
            return Response({'error': 'User or role not found.'}, status=404)

        validate_rank_authority(request.user, role.rank)

        with transaction.atomic():
            _, created = UserRole.objects.get_or_create(user=user, role=role)
            if created:
                invalidate_user_permission_cache(user.id)
                write_audit_log(
                    operator_id=request.user.id,
                    action_type='CREATE',
                    module='RBAC',
                    description=f"Assigned role '{role.name}' to user '{user.username}'."
                )
        return Response({'status': 'success'})
```

And `.delete`:

```python
    def delete(self, request):
        user_id = request.data.get('user_id')
        role_id = request.data.get('role_id')

        # Self-lockout guard: superusers can never actually be locked out (they bypass RBAC
        # entirely, see get_user_permission_codes), so only non-superusers need protecting.
        # A user removing their own LAST role assignment would leave them with zero RBAC
        # access with no easy way back in — block that specific case. Checked before the
        # rank guard so this friendlier message wins for this specific scenario.
        if str(request.user.id) == str(user_id) and not request.user.is_superuser:
            remaining = UserRole.objects.filter(user_id=user_id).exclude(role_id=role_id).count()
            if remaining == 0:
                return Response({
                    'error': "You can't remove your own last role — this would lock you out of "
                             "the system. Have another admin do this, or assign yourself a "
                             "replacement role first."
                }, status=400)

        role = Role.objects.filter(id=role_id).first()
        if role is not None:
            validate_rank_authority(request.user, role.rank)

        with transaction.atomic():
            deleted_count, _ = UserRole.objects.filter(user_id=user_id, role_id=role_id).delete()
            if deleted_count:
                invalidate_user_permission_cache(user_id)
                user = User.objects.filter(id=user_id).first()
                write_audit_log(
                    operator_id=request.user.id,
                    action_type='DELETE',
                    module='RBAC',
                    description=f"Removed role '{role.name if role else role_id}' from user "
                                 f"'{user.username if user else user_id}'."
                )
        return Response({'status': 'success'})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python manage.py test school.tests.test_rbac_rank_hierarchy.UserRoleAssignmentGuardTests -v 2`
Expected: PASS (5 tests).

- [ ] **Step 5: Run the full test suite to check for regressions**

Run: `python manage.py test school.tests -v 2`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add school/views/rbac_views.py school/tests/test_rbac_rank_hierarchy.py
git commit -m "feat(rbac): wire rank guard into UserRoleAssignmentAPIView assign/unassign"
```

---

### Task 11: Frontend — `rank` field in `RoleEditor`/`RolesPermissions`

**Files:**
- Modify: `frontend/src/pages/admin/RoleEditor.tsx`
- Modify: `frontend/src/pages/admin/RolesPermissions.tsx`

**Interfaces:**
- Consumes: `RoleSerializer`'s `rank` field (Task 3).

- [ ] **Step 1: Add `rank` to `RoleEditor.tsx`'s `Role` interface and load it**

In `frontend/src/pages/admin/RoleEditor.tsx`, update the interface:

```tsx
interface Role {
  id: number;
  name: string;
  description: string;
  rank: number | null;
  permissions: Permission[];
  is_system_role: boolean;
  member_count: number;
}
```

Add state near `description`:

```tsx
  const [description, setDescription] = useState(cloneFrom?.description ?? '');
  const [rank, setRank] = useState<string>('');
```

In the load-existing-role effect, after `setDescription(role.description || '')`:

```tsx
        setDescription(role.description || '');
        setRank(role.rank === null || role.rank === undefined ? '' : String(role.rank));
```

- [ ] **Step 2: Add the rank input to the form**

In the "Role details" grid (after the Description field, before the closing `</div>` of that grid at line ~288):

```tsx
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider block">Rank</label>
          <input type="number" min={1} placeholder="Leave blank for unranked" value={rank}
            className="w-full border border-slate-300 dark:border-slate-600 rounded-xl p-3 outline-none focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-500/20 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 transition-all"
            onChange={(e) => setRank(e.target.value)} />
          <p className="text-xs text-slate-400 dark:text-slate-500">Lower number = more authority. An unranked role can't be managed by anyone except a superuser.</p>
        </div>
```

- [ ] **Step 3: Include `rank` in the save payload**

Update `handleSave`:

```tsx
    const payload = {
      name: roleName.trim(),
      description,
      rank: rank === '' ? null : Number(rank),
      permission_ids: Array.from(selectedIds),
    };
```

- [ ] **Step 4: Show rank on the roles table**

In `frontend/src/pages/admin/RolesPermissions.tsx`, update the `Role` interface the same way as Step 1, then in the "Role" column cell (after the `is_system_role` badge, `:266-269`):

```tsx
                          {role.is_system_role && (
                            <span className="bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-500/40 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full">
                              System
                            </span>
                          )}
                          {role.rank !== null && role.rank !== undefined && (
                            <span className="bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full">
                              Rank {role.rank}
                            </span>
                          )}
```

- [ ] **Step 5: Manual verification**

Run the dev servers (`python manage.py runserver` and `pnpm --dir frontend dev`), log in as an existing ADMIN-group user, open Roles & Permissions, create a role with a rank set, confirm it saves and displays the "Rank N" badge; edit it and clear the rank, confirm it saves as unranked. This can't be automated (no frontend test suite in this repo — see the `sms-orient` roadmap's Maintainability note) — call this out explicitly rather than skipping verification.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/admin/RoleEditor.tsx frontend/src/pages/admin/RolesPermissions.tsx
git commit -m "feat(rbac): add rank field to Role editor and roles table"
```

---

## Final step: migration instructions for the user

After all tasks land, tell the user to run, in order:

```bash
python manage.py makemigrations identity --check --dry-run   # verify the hand-written migrations match
python manage.py migrate
python manage.py backfill_role_school
python manage.py seed_rbac
```

`backfill_role_school` must run before `seed_rbac` only matters in the sense that both are safe to run in either order — `seed_rbac` resolves its own `school` via `School.objects.first()` independently. Running `backfill_role_school` first just means any *pre-existing* custom roles (from `populate_demo_staff.py` or hand-created ones) get scoped to the school at the same time as Admin/Teacher, rather than staying unscoped until a future run.

**One operational consequence to know about, flagged by the final whole-branch review:** this migration only assigns a `rank` to the `Admin` and `Teacher` system roles — every other existing custom role (Secretary, Deputy Principal, HOD, Bursar, or any admin-hand-created role) stays `rank=NULL`. `validate_rank_authority` treats a null-ranked role as unmanageable by any non-superuser, including Admin — this is the guard's documented fail-closed behavior, not a bug, but it means immediately after this migration, a rank-1 Admin who tries to edit one of those existing roles (even just changing its description) gets a 403, and there's no non-superuser way to give an existing role its first rank either (same precheck blocks it). Until Phase 3 seeds ranks for the wider hierarchy, a superuser needs to assign a rank to each pre-existing custom role that should stay editable by ordinary admins — either via the Django admin site or a one-off management command, not yet built here.
