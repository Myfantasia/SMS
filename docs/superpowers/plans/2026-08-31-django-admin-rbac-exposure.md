# Django Admin RBAC Exposure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register `Permission`, `Role`, and `UserRole` in Django admin so a superuser can allocate roles directly through `/admin/`, with audit-log and permission-cache behavior matching the existing DRF RBAC API exactly.

**Architecture:** Three `ModelAdmin` classes added to `apps/identity/admin.py` (the models' owning app). `RoleAdmin` and `UserRoleAdmin` override `save_model`/`save_related`/`delete_model`/`delete_queryset` to call the same `write_audit_log()`/`invalidate_user_permission_cache()`/`soft_delete()` functions `RoleViewSet`/`UserRoleAssignmentAPIView` already call, so a change made via Django admin is indistinguishable, in the audit trail and in immediate cache effect, from the same change made via the API. `RoleAdmin` blocks renaming/deleting the two system roles (Admin, Teacher) via Django's own `get_readonly_fields`/`has_delete_permission` hooks, mirroring the API's `is_system_role` protection.

**Tech Stack:** Django 6 admin, `django-unfold` 0.100.0 (`unfold.admin.ModelAdmin`), existing `apps.core.services.write_audit_log`, `apps.core.trash.soft_delete`, `school.rbac.invalidate_user_permission_cache`.

**Spec:** `docs/superpowers/specs/2026-08-31-django-admin-overhaul-design.md` (Section A — this plan covers Phase 1 only; navigation/branding/remaining-models/dashboard are separate future plans)

## Global Constraints

- **Never run `makemigrations` or `migrate`.** No schema changes in this plan — pure admin.py registrations.
- **Register in the model's owning app** (`apps/identity/admin.py` — `Permission`/`Role`/`UserRole` are all defined in `apps/identity/models.py`), per `sms-orient` Hard Rule #10.
- **Match existing RBAC audit/cache conventions exactly**: `write_audit_log(operator_id=..., action_type=..., module='RBAC', description=...)` (module is always the literal string `'RBAC'`, matching `RoleViewSet`); `invalidate_user_permission_cache(user_id)`; `soft_delete(instance, operator=..., module='RBAC', description=...)` — `soft_delete` already calls `write_audit_log` internally with `action_type='DELETE'`, so callers of `soft_delete` must NOT also call `write_audit_log` themselves (would double-log the deletion).
- **Django admin is superuser-only** in this codebase today (no non-superuser role carries `is_staff`) — the self-lockout guard `UserRoleAssignmentAPIView.delete` has for non-superusers removing their own last role does not need replicating here; superusers already bypass it in the API too.
- **Test conventions**: plain `django.test.TestCase`, `self.client.force_login(...)`, Django admin URL names follow `admin:<app_label>_<model_name_lowercase>_<action>` (e.g. `admin:identity_role_change`, `admin:identity_userrole_delete`).
- **Follow existing `apps/identity/admin.py` style**: `from unfold.admin import ModelAdmin`, `@admin.register(Model)` decorator pattern (not `admin.site.register(...)` calls), matching every existing registration in that file.

---

### Task 1: `PermissionAdmin` and `RoleAdmin`

**Files:**
- Modify: `apps/identity/admin.py`
- Test: `school/tests/test_rbac_admin.py` (new file)

**Interfaces:**
- Consumes: `apps.identity.models.Permission`, `Role`, `UserRole` (existing); `apps.core.services.write_audit_log` (existing, signature: `write_audit_log(*, operator_id, action_type, module, description, ip_address=None, school_id=None)`); `apps.core.trash.soft_delete` (existing, signature: `soft_delete(instance, *, operator, flag_field='is_deleted', flag_true=True, module, description)` — internally calls `write_audit_log` with `action_type='DELETE'`); `school.rbac.invalidate_user_permission_cache` (existing, signature: `invalidate_user_permission_cache(user_id: int)`).
- Produces: `RoleAdmin`, `PermissionAdmin` registered in Django admin, importable/reachable at `/admin/identity/role/` and `/admin/identity/permission/`. Task 2 (`UserRoleAdmin`) relies on `RoleAdmin` having `search_fields = ('name',)` (required for Django's `autocomplete_fields` to work against `Role`).

- [ ] **Step 1: Write the failing tests**

Create `school/tests/test_rbac_admin.py`:

```python
from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import TestCase
from django.urls import reverse

from apps.core.models import SystemAuditLog
from apps.identity.models import Permission, Role, UserRole
from apps.identity.services import get_user_permission_codes


class RoleAdminTests(TestCase):
    def setUp(self):
        cache.clear()
        self.superuser = User.objects.create_superuser(
            username='root_admin', password='x', email='root@test.com')
        self.client.force_login(self.superuser)
        self.finance_view = Permission.objects.create(
            code='finance.view', label='View finance', module='Finance')

    def test_create_role_writes_audit_log(self):
        response = self.client.post(reverse('admin:identity_role_add'), {
            'name': 'Bursar', 'description': '', 'rank': 6,
            'permissions': [self.finance_view.id],
        })
        self.assertEqual(response.status_code, 302, response.content)
        role = Role.objects.get(name='Bursar')
        self.assertTrue(role.permissions.filter(code='finance.view').exists())
        self.assertTrue(SystemAuditLog.objects.filter(
            module='RBAC', action_type='CREATE', description__icontains='Bursar').exists())

    def test_editing_a_roles_permissions_invalidates_holders_cache(self):
        role = Role.objects.create(name='Custom Role', rank=6)
        user = User.objects.create_user(username='holder', password='x')
        UserRole.objects.create(user=user, role=role)
        # Prime the cache with the pre-edit (empty) permission set.
        self.assertEqual(get_user_permission_codes(user.id), frozenset())

        response = self.client.post(
            reverse('admin:identity_role_change', args=[role.id]),
            {'name': 'Custom Role', 'description': '', 'rank': 6,
             'permissions': [self.finance_view.id]},
        )
        self.assertEqual(response.status_code, 302, response.content)
        self.assertIn('finance.view', get_user_permission_codes(user.id))

    def test_admin_role_cannot_be_renamed(self):
        admin_role = Role.objects.create(name='Admin', rank=1, is_system_role=True)
        response = self.client.get(reverse('admin:identity_role_change', args=[admin_role.id]))
        self.assertEqual(response.status_code, 200)
        # A system role's name must not render as an editable text input -- don't assert
        # on Django's exact readonly-field markup, just that the editable input is gone.
        self.assertNotContains(response, '<input type="text" name="name"')

    def test_admin_role_cannot_be_deleted(self):
        admin_role = Role.objects.create(name='Admin', rank=1, is_system_role=True)
        response = self.client.post(reverse('admin:identity_role_delete', args=[admin_role.id]), {'post': 'yes'})
        admin_role.refresh_from_db()
        self.assertFalse(admin_role.is_deleted)

    def test_deleting_a_custom_role_soft_deletes_and_invalidates_cache(self):
        role = Role.objects.create(name='Temp Role', rank=6)
        user = User.objects.create_user(username='temp_holder', password='x')
        UserRole.objects.create(user=user, role=role)
        role.permissions.add(self.finance_view)
        self.assertIn('finance.view', get_user_permission_codes(user.id))

        response = self.client.post(reverse('admin:identity_role_delete', args=[role.id]), {'post': 'yes'})
        self.assertEqual(response.status_code, 302, response.content)
        role.refresh_from_db()
        self.assertTrue(role.is_deleted)
        self.assertNotIn('finance.view', get_user_permission_codes(user.id))
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `/home/jordan/Documents/SMS/venv/bin/python manage.py test school.tests.test_rbac_admin -v 2 --noinput --keepdb`
Expected: FAIL — `NoReverseMatch: Reverse for 'identity_role_add' not found` (Role isn't registered yet).

- [ ] **Step 3: Register `Permission` and `Role`**

In `apps/identity/admin.py`, update the import block at the top:

```python
from apps.identity.models import AdminExtra, StudentExtra, TeacherExtra, StaffExtra, ParentExtra, Permission, Role, UserRole
from apps.core.services import write_audit_log
from apps.core.trash import soft_delete
from school.rbac import invalidate_user_permission_cache
```

Add, after the existing `ParentExtraAdmin` class at the end of the file:

```python
# --- 3. RBAC: PERMISSION / ROLE / USERROLE ---
# Permission/Role/UserRole changes made here bypass the DRF RoleViewSet/
# UserRoleAssignmentAPIView entirely (Django admin writes straight to the ORM), so the
# audit-log and permission-cache side effects those views provide for free have to be
# replicated explicitly below -- otherwise a role assigned via /admin/ would be invisible
# in the audit trail and the recipient would wait out the 90s cache TTL instead of getting
# immediate access. The rank/permission-containment guards (validate_rank_authority,
# validate_permission_delegation) are NOT replicated here: both already no-op for
# is_superuser, and Django admin is a superuser-only surface in this codebase today.

@admin.register(Permission)
class PermissionAdmin(ModelAdmin):
    list_display = ('code', 'label', 'module')
    list_filter = ('module',)
    search_fields = ('code', 'label')


@admin.register(Role)
class RoleAdmin(ModelAdmin):
    list_display = ('name', 'rank', 'school', 'is_system_role', 'permission_count')
    list_filter = ('rank', 'school', 'is_system_role')
    search_fields = ('name',)
    filter_horizontal = ('permissions',)
    # Soft-delete bookkeeping is managed exclusively by soft_delete()/restore() -- excluded
    # here so a superuser can't hand-edit is_deleted/deleted_at/deleted_by through the form
    # and desync it from the Trash system's own state.
    exclude = ('is_deleted', 'deleted_at', 'deleted_by')

    def get_queryset(self, request):
        # Soft-deleted roles are managed through the Trash UI, not surfaced here as if
        # still active -- matches RoleViewSet.get_queryset()'s own is_deleted=False filter.
        return super().get_queryset(request).filter(is_deleted=False)

    def permission_count(self, obj):
        return obj.permissions.count()
    permission_count.short_description = 'Permissions'

    def get_readonly_fields(self, request, obj=None):
        fields = list(super().get_readonly_fields(request, obj))
        if obj is not None and obj.is_system_role:
            # Matches RoleViewSet.perform_update's is_system_role rename block -- Admin/
            # Teacher's names are looked up by exact string in seed_rbac.py and every
            # non-superuser admin's access depends on them staying stable.
            fields.append('name')
        return fields

    def has_delete_permission(self, request, obj=None):
        if obj is not None and obj.is_system_role:
            return False
        return super().has_delete_permission(request, obj)

    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)
        write_audit_log(
            operator_id=request.user.id,
            action_type='UPDATE' if change else 'CREATE',
            module='RBAC',
            description=f"{'Updated' if change else 'Created'} role '{obj.name}' via Django admin.",
        )

    def save_related(self, request, form, formsets, change):
        # The permissions M2M is written here, after save_model -- invalidate the cache
        # for every current holder, since their effective permission set may have changed.
        super().save_related(request, form, formsets, change)
        for user_id in UserRole.objects.filter(role=form.instance).values_list('user_id', flat=True):
            invalidate_user_permission_cache(user_id)

    def delete_model(self, request, obj):
        # soft_delete() already calls write_audit_log(action_type='DELETE') internally --
        # do not also call it here, or the deletion double-logs.
        role_name = obj.name
        affected_user_ids = list(UserRole.objects.filter(role=obj).values_list('user_id', flat=True))
        soft_delete(
            obj, operator=request.user, module='RBAC',
            description=f"Deleted role '{role_name}' via Django admin.",
        )
        for user_id in affected_user_ids:
            invalidate_user_permission_cache(user_id)

    def delete_queryset(self, request, queryset):
        # Bulk "Delete selected" action -- route each object through the same guarded
        # delete_model logic rather than Django's default bulk .delete() (which would
        # hard-delete and skip soft_delete/cache invalidation entirely).
        for obj in queryset:
            self.delete_model(request, obj)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `/home/jordan/Documents/SMS/venv/bin/python manage.py test school.tests.test_rbac_admin -v 2 --noinput --keepdb`
Expected: PASS (5 tests). Note: `UserRoleAdmin` doesn't exist yet, so none of these tests should reference it — confirm none do before running.

- [ ] **Step 5: Commit**

```bash
git add apps/identity/admin.py school/tests/test_rbac_admin.py
git commit -m "feat(rbac): register Permission and Role in Django admin"
```

---

### Task 2: `UserRoleAdmin` — the actual role-assignment screen

**Files:**
- Modify: `apps/identity/admin.py`
- Test: `school/tests/test_rbac_admin.py`

**Interfaces:**
- Consumes: `RoleAdmin` (Task 1) — `autocomplete_fields = ('role',)` requires `RoleAdmin.search_fields` to be set (it is, from Task 1). Also consumes Django's built-in `UserAdmin` (already registered at the top of `apps/identity/admin.py:29-39`, which inherits `search_fields` from `django.contrib.auth.admin.UserAdmin`, satisfying `autocomplete_fields = ('user',)`'s requirement).
- Produces: `UserRoleAdmin` registered at `/admin/identity/userrole/` — this is where a superuser actually assigns a role to a user.

- [ ] **Step 1: Write the failing tests**

Append to `school/tests/test_rbac_admin.py`:

```python
class UserRoleAdminTests(TestCase):
    def setUp(self):
        cache.clear()
        self.superuser = User.objects.create_superuser(
            username='root_admin2', password='x', email='root2@test.com')
        self.client.force_login(self.superuser)
        self.finance_view = Permission.objects.create(
            code='finance.view', label='View finance', module='Finance')
        self.role = Role.objects.create(name='Bursar Role', rank=6)
        self.role.permissions.add(self.finance_view)
        self.target_user = User.objects.create_user(username='new_bursar', password='x')

    def test_assigning_a_role_grants_immediate_access_and_logs_it(self):
        self.assertEqual(get_user_permission_codes(self.target_user.id), frozenset())

        response = self.client.post(reverse('admin:identity_userrole_add'), {
            'user': self.target_user.id, 'role': self.role.id,
        })
        self.assertEqual(response.status_code, 302, response.content)
        self.assertTrue(UserRole.objects.filter(user=self.target_user, role=self.role).exists())
        self.assertIn('finance.view', get_user_permission_codes(self.target_user.id))
        self.assertTrue(SystemAuditLog.objects.filter(
            module='RBAC', action_type='CREATE',
            description__icontains='new_bursar').exists())

    def test_removing_a_role_revokes_immediate_access_and_logs_it(self):
        user_role = UserRole.objects.create(user=self.target_user, role=self.role)
        self.assertIn('finance.view', get_user_permission_codes(self.target_user.id))

        response = self.client.post(
            reverse('admin:identity_userrole_delete', args=[user_role.id]), {'post': 'yes'})
        self.assertEqual(response.status_code, 302, response.content)
        self.assertFalse(UserRole.objects.filter(id=user_role.id).exists())
        self.assertNotIn('finance.view', get_user_permission_codes(self.target_user.id))
        self.assertTrue(SystemAuditLog.objects.filter(
            module='RBAC', action_type='DELETE',
            description__icontains='new_bursar').exists())
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `/home/jordan/Documents/SMS/venv/bin/python manage.py test school.tests.test_rbac_admin.UserRoleAdminTests -v 2 --noinput --keepdb`
Expected: FAIL — `NoReverseMatch: Reverse for 'identity_userrole_add' not found`.

- [ ] **Step 3: Register `UserRole`**

In `apps/identity/admin.py`, append after `RoleAdmin`:

```python
@admin.register(UserRole)
class UserRoleAdmin(ModelAdmin):
    """The actual role-assignment screen -- where a superuser gives a user a Role."""
    list_display = ('user', 'role', 'role_rank', 'assigned_at')
    list_filter = ('role',)
    search_fields = ('user__username', 'user__email', 'role__name')
    autocomplete_fields = ('user', 'role')

    def role_rank(self, obj):
        return obj.role.rank
    role_rank.short_description = 'Rank'

    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)
        invalidate_user_permission_cache(obj.user_id)
        write_audit_log(
            operator_id=request.user.id,
            action_type='UPDATE' if change else 'CREATE',
            module='RBAC',
            description=f"Assigned role '{obj.role.name}' to user '{obj.user.username}' via Django admin.",
        )

    def delete_model(self, request, obj):
        user_id = obj.user_id
        role_name = obj.role.name
        username = obj.user.username
        super().delete_model(request, obj)
        invalidate_user_permission_cache(user_id)
        write_audit_log(
            operator_id=request.user.id,
            action_type='DELETE',
            module='RBAC',
            description=f"Removed role '{role_name}' from user '{username}' via Django admin.",
        )

    def delete_queryset(self, request, queryset):
        for obj in queryset:
            self.delete_model(request, obj)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `/home/jordan/Documents/SMS/venv/bin/python manage.py test school.tests.test_rbac_admin -v 2 --noinput --keepdb`
Expected: PASS (7 tests total: 5 from Task 1 + 2 from Task 2).

- [ ] **Step 5: Run the RBAC-adjacent regression suite**

Run: `/home/jordan/Documents/SMS/venv/bin/python manage.py test school.tests.test_rbac_admin_teacher school.tests.test_rbac_caching school.tests.test_seed_rbac school.tests.test_backfill_role_school school.tests.test_rbac_rank_hierarchy school.tests.test_trash_role -v 1 --noinput --keepdb`
Expected: PASS, no regressions — this admin.py change doesn't touch any file those tests exercise, but confirms nothing about the new `apps/identity/admin.py` imports broke Django's app loading.

- [ ] **Step 6: Commit**

```bash
git add apps/identity/admin.py school/tests/test_rbac_admin.py
git commit -m "feat(rbac): register UserRole in Django admin as the role-assignment screen"
```

---

## Manual verification (for the user)

Automated tests cover the behavior; visually confirming the UI still needs a human, since this session has no browser access:

1. Log into `/admin/` as a superuser.
2. Under "Identity" (default grouping — Phase 2 of the spec reorganizes this into "Governance & RBAC"), open Roles. Create a new role, set a rank, tick some permissions, save.
3. Open Permissions — confirm the catalog is browsable/filterable by module.
4. Open User roles, click "Add User role", pick a user and the role just created — confirm it saves and appears in the list.
5. Log in as that user (or check via the Roles & Permissions React page) to confirm the newly granted permissions are live immediately, not after a delay.
6. Try to rename or delete the seeded "Admin" role — confirm the name field is read-only and no delete option is offered.

## Known limitation, accepted for this pass

Django admin's default delete-confirmation page computes cascade-related objects before calling `delete_model`/`delete_queryset` — for a soft-deleted entity like `Role`, this can show a "the following related objects will also be deleted" message that doesn't quite match what actually happens (a flag flip, not a real delete). This is a pre-existing friction point with soft-delete + Django admin's default UI, not something this plan's scope covers fixing (would require overriding `get_deleted_objects`, a separate, non-trivial customization). Noted in the spec as accepted.
