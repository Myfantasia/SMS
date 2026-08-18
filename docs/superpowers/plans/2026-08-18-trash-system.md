# Trash / Soft-Delete System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hard `.delete()` calls for User accounts, Class Streams, Subjects, Leave Requests, Roles, Events, Notices, and Assignments with a soft-delete-in-place mechanism, surfaced through a permission-gated Trash page that lets an admin restore anything within a grace period, with most types auto-purged (including their files) after 20 days.

**Architecture:** Every trashable entity gets its own `is_deleted`/`deleted_at`/`deleted_by` flag (or reuses an existing equivalent flag), matching the one soft-delete pattern already in this codebase (`ClassStream.is_deleted`). No generic ledger, no JSON snapshots — restoring is just flipping the flag back, which is lossless for every entity including Assignment's deep object graph. A small set of shared services (`apps/core/services.py`) does the audit logging, the 20-day sweep, and file cleanup; per-entity work is largely mechanical (add fields, filter reads, soft-delete writes).

**Tech Stack:** Django 6 / DRF, Django TestCase (`python manage.py test`), React/Vite/TS frontend, Tailwind.

**Spec:** `docs/superpowers/specs/2026-08-18-trash-system-design.md`

## Global Constraints

- **Never run `python manage.py makemigrations` or `python manage.py migrate` in this project.** The user runs both manually. Every task that adds/changes model fields ends with a checkpoint step telling the user exactly what to run before the task's tests can pass — do not attempt to run tests that depend on unmigrated columns until the user confirms migrations are applied.
- `python manage.py check` must stay clean after every task.
- Class Stream and Subject **never** enter the 20-day auto-purge sweep — restore-only until a superuser/permitted admin manually purges them. Every other entity (Users, Leave, Roles, Events, Notices, Assignments) does auto-purge at 20 days.
- Two existing hard-delete call sites are explicitly OUT of scope and must stay real deletes: `api_process_approval`'s `reject` branch (`school/views/views.py`), and the self-cancel (non-admin) branch of `TeacherLeaveViewSet.perform_destroy` (`school/views/leave_views.py`).
- New permission codes `trash.view` / `trash.manage` must be excluded from the Admin role's blanket "all permissions" grant in `seed_rbac.py` — Trash access is opt-in per admin, not automatic.
- `deleted_by` is always `ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL)`, matching `SystemAuditLog.operator`'s existing convention.
- Every write-path change must call the existing `write_audit_log()` (`apps/core/services.py`) with `action_type='DELETE'` on trash and `action_type='RESTORE'` on restore (this action type exists in `SystemAuditLog.ACTION_CHOICES` today but has zero callers — this plan gives it its first ones).

---

## Task 1: Shared Trash infrastructure (permissions, audit helpers, purge service scaffold)

**Files:**
- Modify: `school/management/commands/seed_rbac.py`
- Create: `apps/core/trash.py`
- Test: `school/tests/test_trash_infra.py`

**Interfaces:**
- Produces: `apps/core/trash.py` exposes `soft_delete(instance, *, operator, flag_field='is_deleted', flag_true=True, module, description) -> None` and `restore(instance, *, operator, flag_field='is_deleted', flag_true=True, module, description) -> None` — both set/clear `deleted_at`/`deleted_by` on `instance`, save it, and call `write_audit_log`. Later tasks (2-10) call these instead of hand-rolling the same 4 lines per entity.
- Produces: `apps/core/trash.py` exposes `TRASH_REGISTRY: dict[str, TrashEntityConfig]` — an empty dict populated by later tasks (each entity task registers itself here so Task 11's list/restore/purge views and Task 12's purge sweep don't need to know about every model up front).
- Produces: `TrashEntityConfig` (a `dataclass`) with fields: `model`, `flag_field: str`, `flag_true`, `flag_false`, `auto_purge: bool`, `label_fn: Callable[[Any], str]`, `purge_fn: Callable[[Any], None] | None` (for entities needing file cleanup before delete — `None` means plain `.delete()`).

- [ ] **Step 1: Add the two new permission codes to the RBAC catalog**

Edit `school/management/commands/seed_rbac.py`. Add a new module block after the `AdminInvites` entry (currently the last line of `PERMISSIONS`, before the closing `]`):

```python
    ('admin_invites.manage', 'Generate/revoke admin signup invite codes; view and regenerate post-approval verification codes', 'AdminInvites'),

    ('trash.view', 'View the Trash (soft-deleted items across all modules)', 'Trash'),
    ('trash.manage', 'Restore or permanently delete items in the Trash', 'Trash'),
]
```

- [ ] **Step 2: Carve Trash out of Admin's blanket grant**

In the same file, find:

```python
            admin_role, created = Role.objects.get_or_create(name='Admin', defaults={'description': 'Full access to every module.'})
            admin_role.permissions.set(Permission.objects.all())
```

Replace the second line with:

```python
            # Trash is the one module Admin does NOT get automatically — it's a
            # deliberate per-admin grant via Roles & Permissions, not a blanket right.
            admin_role.permissions.set(Permission.objects.exclude(code__startswith='trash.'))
```

Also update the two `dry_run` branches just above/below that reference `len(all_codes)` / `Permission.objects.count()` so the printed count in `--dry-run` mode matches reality — find:

```python
            admin_exists = Role.objects.filter(name='Admin').exists()
            all_codes = [c for c, _, _ in PERMISSIONS]
            self.stdout.write(f"  {'exists' if admin_exists else '[DRY RUN] would create'}: Admin -> ALL ({len(all_codes)} permissions)")
```

Replace with:

```python
            admin_exists = Role.objects.filter(name='Admin').exists()
            all_codes = [c for c, _, m in PERMISSIONS if m != 'Trash']
            self.stdout.write(f"  {'exists' if admin_exists else '[DRY RUN] would create'}: Admin -> ALL except Trash ({len(all_codes)} permissions)")
```

And the non-dry-run success line:

```python
            self.stdout.write(f"  {'created' if created else 'updated'}: Admin -> ALL ({Permission.objects.count()} permissions)")
```

Replace with:

```python
            self.stdout.write(f"  {'created' if created else 'updated'}: Admin -> ALL except Trash ({Permission.objects.exclude(code__startswith='trash.').count()} permissions)")
```

- [ ] **Step 3: Write `apps/core/trash.py`**

```python
"""
Shared plumbing for the Trash/soft-delete system. Every trashable entity
(ClassStream, Subject, User accounts, TeacherLeave, Role, Event, Notice,
Assignment) registers itself in TRASH_REGISTRY so the Trash list/restore/purge
views (school/views/trash_views.py) and the auto-purge sweep
(apps.core.trash.purge_expired_trash) don't need per-model branches.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from typing import Any, Callable, Optional

from django.contrib.auth.models import User
from django.utils import timezone

from apps.core.services import write_audit_log

AUTO_PURGE_AFTER = timedelta(days=20)


@dataclass(frozen=True)
class TrashEntityConfig:
    model: type
    flag_field: str          # e.g. 'is_deleted' or 'user__is_active' style lookup base
    flag_true: Any            # value meaning "trashed" (True, or False for is_active)
    flag_false: Any           # value meaning "live"
    auto_purge: bool          # False for ClassStream, Subject
    label_fn: Callable[[Any], str]
    purge_fn: Optional[Callable[[Any], None]] = None  # None => instance.delete()


TRASH_REGISTRY: dict[str, TrashEntityConfig] = {}


def register_trash_entity(entity_type: str, config: TrashEntityConfig) -> None:
    TRASH_REGISTRY[entity_type] = config


def soft_delete(instance, *, operator: Optional[User], flag_field: str = 'is_deleted',
                 flag_true: Any = True, module: str, description: str) -> None:
    setattr(instance, flag_field, flag_true)
    instance.deleted_at = timezone.now()
    instance.deleted_by = operator
    instance.save()
    write_audit_log(
        operator_id=operator.id if operator else None,
        action_type='DELETE', module=module, description=description,
    )


def restore(instance, *, operator: Optional[User], flag_field: str = 'is_deleted',
            flag_false: Any = False, module: str, description: str) -> None:
    setattr(instance, flag_field, flag_false)
    instance.deleted_at = None
    instance.deleted_by = None
    instance.save()
    write_audit_log(
        operator_id=operator.id if operator else None,
        action_type='RESTORE', module=module, description=description,
    )
```

- [ ] **Step 4: Write the infra test**

```python
from django.contrib.auth.models import User
from django.test import TestCase

from apps.core.models import SystemAuditLog
from apps.core.trash import soft_delete, restore
from apps.identity.models import Permission, Role


class SoftDeleteRestoreHelperTests(TestCase):
    def setUp(self):
        self.operator = User.objects.create_user(username='op', password='x')

    def test_soft_delete_stamps_fields_and_logs(self):
        role = Role.objects.create(name='Throwaway')
        soft_delete(role, operator=self.operator, module='RBAC', description='Deleted role Throwaway.')
        role.refresh_from_db()
        self.assertTrue(role.is_deleted)
        self.assertIsNotNone(role.deleted_at)
        self.assertEqual(role.deleted_by_id, self.operator.id)
        self.assertTrue(SystemAuditLog.objects.filter(action_type='DELETE', module='RBAC').exists())

    def test_restore_clears_fields_and_logs(self):
        role = Role.objects.create(name='Throwaway2', is_deleted=True)
        restore(role, operator=self.operator, module='RBAC', description='Restored role Throwaway2.')
        role.refresh_from_db()
        self.assertFalse(role.is_deleted)
        self.assertIsNone(role.deleted_at)
        self.assertIsNone(role.deleted_by_id)
        self.assertTrue(SystemAuditLog.objects.filter(action_type='RESTORE', module='RBAC').exists())


class TrashPermissionSeedTests(TestCase):
    def test_seed_rbac_excludes_trash_from_admin(self):
        from django.core.management import call_command
        call_command('seed_rbac')
        admin = Role.objects.get(name='Admin')
        self.assertFalse(admin.permissions.filter(code__startswith='trash.').exists())
        self.assertTrue(Permission.objects.filter(code='trash.view').exists())
        self.assertTrue(Permission.objects.filter(code='trash.manage').exists())
```

Note: `test_soft_delete_stamps_fields_and_logs` and `test_restore_clears_fields_and_logs` reference `Role.is_deleted`/`deleted_at`/`deleted_by`, which don't exist yet — this test file is written now but **only runs starting in Task 7** once Role has those fields. Leave it in place; it's correct code, just not yet runnable. Do not run `manage.py test` on this file until Task 7 is complete — running it now will fail with "no such column," which is expected, not a bug.

- [ ] **Step 5: Run `python manage.py check`**

Expected: clean, no errors (this task adds no model fields, so no migration checkpoint here).

- [ ] **Step 6: Commit**

```bash
git add apps/core/trash.py school/management/commands/seed_rbac.py school/tests/test_trash_infra.py
git commit -m "feat: add Trash permission codes and shared soft-delete/restore helpers"
```

---

## Task 2: ClassStream — deleted_at/deleted_by, restore(), read-site filtering

**Files:**
- Modify: `apps/academics/models.py`
- Modify: `school/views/class_views.py`
- Modify: `apps/core/trash.py` (register)
- Test: `school/tests/test_trash_class_stream.py`

**Interfaces:**
- Consumes: `soft_delete`/`restore`/`register_trash_entity`/`TrashEntityConfig` from Task 1.
- Produces: `ClassStream.restore(operator_user=None)` method, mirroring the existing `soft_delete()`.

- [ ] **Step 1: Add fields to `ClassStream`**

In `apps/academics/models.py`, `ClassStream` currently ends its field list at `is_deleted = models.BooleanField(default=False, db_index=True)` (line 296) before `# --- ATTACH MANAGERS ---`. Add directly below it:

```python
    is_deleted = models.BooleanField(default=False, db_index=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    deleted_by = models.ForeignKey('auth.User', on_delete=models.SET_NULL, null=True, blank=True, related_name='+')

    # --- ATTACH MANAGERS ---
```

- [ ] **Step 2: Add `restore()` and update `soft_delete()` to use the shared helper**

Replace the existing `soft_delete` method:

```python
    def soft_delete(self, operator_user=None):
        """Safely removes resource from active streams without breaking database constraints."""
        from apps.core.services import write_audit_log

        self.is_deleted = True
        self.save()
        # Automatically log who deleted this classroom
        write_audit_log(
            operator_id=operator_user.id if operator_user else None,
            action_type='DELETE',
            module='ClassStream',
            description=f"Soft deleted stream: {self.grade.name} {self.name} (ID: {self.id})"
        )
```

with:

```python
    def soft_delete(self, operator_user=None):
        """Safely removes resource from active streams without breaking database constraints."""
        from apps.core.trash import soft_delete as _soft_delete
        _soft_delete(
            self, operator=operator_user, module='ClassStream',
            description=f"Soft deleted stream: {self.grade.name} {self.name} (ID: {self.id})",
        )

    def restore(self, operator_user=None):
        from apps.core.trash import restore as _restore
        _restore(
            self, operator=operator_user, module='ClassStream',
            description=f"Restored stream: {self.grade.name} {self.name} (ID: {self.id})",
        )
```

This is behavior-preserving for `soft_delete` (same flag, same audit log shape) — the two existing callers (`school/views/teacherAllocation_view.py:1125`, `school/views/class_views.py:505`) need no changes.

- [ ] **Step 3: Register ClassStream in the Trash registry**

At the bottom of `apps/academics/models.py`, or in a new small block right after the `ClassStream` class (before `get_or_create_class_stream`), add:

```python
def _register_class_stream_trash():
    from apps.core.trash import register_trash_entity, TrashEntityConfig
    register_trash_entity('class-streams', TrashEntityConfig(
        model=ClassStream, flag_field='is_deleted', flag_true=True, flag_false=False,
        auto_purge=False,
        label_fn=lambda cs: f"{cs.grade.name} {cs.name}",
    ))


_register_class_stream_trash()
```

- [ ] **Step 4: Fix read-site filtering in `school/views/class_views.py`**

Every plain `ClassStream.objects` list/detail read in this file must become `ClassStream.live` so trashed streams stop appearing. Apply this exact substitution at each of these lines (confirmed via grep — these are the only user-facing reads in this file that currently bypass `.live`):

- Line 57: `ClassStream.objects` → `ClassStream.live`
- Line 298: `ClassStream.objects` → `ClassStream.live`
- Line 440: `ClassStream.objects` → `ClassStream.live`
- Line 458: `ClassStream.objects` → `ClassStream.live`
- Line 503: `ClassStream.objects` → `ClassStream.live`
- Line 521: `ClassStream.objects` → `ClassStream.live`
- Line 566: `ClassStream.objects` → `ClassStream.live`
- Line 618: `ClassStream.objects` → `ClassStream.live`

Do not touch line 214 (single by-ID lookup used as an internal reference, not a list) or the two existing `ClassStream.live` call sites (432, 478) — they're already correct.

- [ ] **Step 5: Write the test**

```python
from django.contrib.auth.models import User
from django.test import TestCase

from apps.academics.models import ClassStream, GradeLevel, Curriculum, Department


class ClassStreamTrashTests(TestCase):
    def setUp(self):
        self.operator = User.objects.create_user(username='admin1', password='x')
        curriculum = Curriculum.objects.create(name='CBC', is_active_for_new_grades=True)
        self.grade = GradeLevel.objects.create(curriculum=curriculum, name='Grade 7', numeric_order=7)
        self.stream = ClassStream.objects.create(name='East', grade=self.grade)

    def test_soft_delete_hides_from_live_manager(self):
        self.assertIn(self.stream, ClassStream.live.all())
        self.stream.soft_delete(operator_user=self.operator)
        self.assertNotIn(self.stream, ClassStream.live.all())
        self.assertIn(self.stream, ClassStream.objects.all())

    def test_restore_brings_it_back(self):
        self.stream.soft_delete(operator_user=self.operator)
        self.stream.restore(operator_user=self.operator)
        self.stream.refresh_from_db()
        self.assertFalse(self.stream.is_deleted)
        self.assertIsNone(self.stream.deleted_at)
        self.assertIn(self.stream, ClassStream.live.all())
```

- [ ] **Step 6: Checkpoint — model fields changed, stop and hand off**

Tell the user: "ClassStream gained `deleted_at`/`deleted_by` fields. Please run `python manage.py makemigrations academics && python manage.py migrate` before I continue." Wait for confirmation.

- [ ] **Step 7: Run the test**

Run: `python manage.py test school.tests.test_trash_class_stream -v 2`
Expected: PASS (both tests).

- [ ] **Step 8: Run `python manage.py check`**

Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add apps/academics/models.py school/views/class_views.py school/tests/test_trash_class_stream.py
git commit -m "feat: add ClassStream restore() and fix trashed-stream read filtering"
```

---

## Task 3: Subject — is_deleted/deleted_at/deleted_by, live manager, fix api_delete_subject, read-site filtering

**Files:**
- Modify: `apps/academics/models.py`
- Modify: `school/views/subject_views.py`
- Modify: `school/views/class_views.py`
- Modify: `school/views/views_timetable.py`
- Modify: `school/views/exams_views.py`
- Modify: `school/views/teacherAllocation_view.py`
- Test: `school/tests/test_trash_subject.py`

**Interfaces:**
- Consumes: `soft_delete`/`restore`/`register_trash_entity`/`TrashEntityConfig` from Task 1.
- Produces: `Subject.live` manager (same shape as `ClassStream.live`).

- [ ] **Step 1: Add fields and a `live` manager to `Subject`**

In `apps/academics/models.py`, `Subject`'s field list ends at line 423 (`synchronized_blocking_min_grade`), with `class Meta:` at line 425. Insert between them:

```python
    is_deleted = models.BooleanField(default=False, db_index=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    deleted_by = models.ForeignKey('auth.User', on_delete=models.SET_NULL, null=True, blank=True, related_name='+')

    objects = models.Manager()
    live = models.Manager.from_queryset(models.QuerySet)()

    class Meta:
```

Then, immediately above the `Subject` class definition, add the queryset/manager properly (Django managers need a real subclass, not an inline `from_queryset` on `models.QuerySet` with no filter — fix this by defining a small manager class instead, same shape as `ClassStream`'s `NonDeletedManager`):

Replace the two manager lines just added with:

```python
    objects = models.Manager()
    live = SubjectLiveManager()

    class Meta:
```

And above `class Subject(models.Model):`, add:

```python
class SubjectLiveManager(models.Manager):
    def get_queryset(self):
        return super().get_queryset().filter(is_deleted=False)


class Subject(models.Model):
```

- [ ] **Step 2: Add `soft_delete()`/`restore()` methods and register**

At the end of the `Subject` class body (after its last existing method — check the class for a `__str__` or similar and add after it; if none exists, add these as the first methods), add:

```python
    def soft_delete(self, operator_user=None):
        from apps.core.trash import soft_delete as _soft_delete
        _soft_delete(
            self, operator=operator_user, module='Subject',
            description=f"Soft deleted subject: {self.name} ({self.code}).",
        )

    def restore(self, operator_user=None):
        from apps.core.trash import restore as _restore
        _restore(
            self, operator=operator_user, module='Subject',
            description=f"Restored subject: {self.name} ({self.code}).",
        )
```

Then, right after the `Subject` class (before `SubjectCurriculumProfile`), add:

```python
def _register_subject_trash():
    from apps.core.trash import register_trash_entity, TrashEntityConfig
    register_trash_entity('subjects', TrashEntityConfig(
        model=Subject, flag_field='is_deleted', flag_true=True, flag_false=False,
        auto_purge=False,
        label_fn=lambda s: f"{s.name} ({s.code})",
    ))


_register_subject_trash()
```

- [ ] **Step 3: Fix `api_delete_subject`**

In `school/views/subject_views.py`, find the current body (lines 483-491):

```python
def api_delete_subject(request, pk):
    ...
    subject = get_object_or_404(Subject, pk=pk)
    subject.delete()
    return JsonResponse({'status': 'success', 'message': 'Subject permanently deleted.'})
```

(exact surrounding code may include a try/except — keep the existing decorator/method-check/exception wrapper, only change the body logic). Replace the `subject.delete()` line and success message with:

```python
    subject = get_object_or_404(Subject, pk=pk)
    subject.soft_delete(operator_user=request.user)
    return JsonResponse({'status': 'success', 'message': 'Subject moved to Trash.'})
```

- [ ] **Step 4: Fix read-site filtering**

Apply `Subject.objects` → `Subject.live` at these confirmed list/dropdown call sites:

- `school/views/class_views.py:57`
- `school/views/subject_views.py:249`
- `school/views/subject_views.py:255`
- `school/views/subject_views.py:521`
- `school/views/subject_views.py:731`
- `school/views/views_timetable.py:35`
- `school/views/views_timetable.py:1475`
- `school/views/exams_views.py:412`
- `school/views/teacherAllocation_view.py:84`
- `school/views/teacherAllocation_view.py:1003`

Leave the internal by-ID/name reference lookups untouched (`class_views.py:214`, `public_api_views.py:358,408`, `views.py:551,1057`, `teacherAllocation_view.py:72,98,253,614`, `subject_views.py:340,410,431,487,888,1054,1889,1890`, `exams_views.py:69,132,262`, `views_timetable.py:216,685,2022`) — these resolve a specific subject already referenced by an existing FK (e.g. an Assignment's `.subject`), and a soft-deleted Subject must still resolve correctly there so historical records don't break.

- [ ] **Step 5: Write the test**

```python
from django.contrib.auth.models import User
from django.test import TestCase

from apps.academics.models import Subject


class SubjectTrashTests(TestCase):
    def setUp(self):
        self.operator = User.objects.create_user(username='admin2', password='x')
        self.subject = Subject.objects.create(code='MAT101', name='Mathematics')

    def test_soft_delete_hides_from_live_manager(self):
        self.assertIn(self.subject, Subject.live.all())
        self.subject.soft_delete(operator_user=self.operator)
        self.assertNotIn(self.subject, Subject.live.all())
        self.assertIn(self.subject, Subject.objects.all())

    def test_restore_brings_it_back(self):
        self.subject.soft_delete(operator_user=self.operator)
        self.subject.restore(operator_user=self.operator)
        self.subject.refresh_from_db()
        self.assertFalse(self.subject.is_deleted)
        self.assertIn(self.subject, Subject.live.all())

    def test_delete_endpoint_soft_deletes(self):
        self.client.force_login(self.operator)
        self.operator.is_superuser = True
        self.operator.save()
        response = self.client.post(f'/api/subjects/{self.subject.id}/delete/')
        self.subject.refresh_from_db()
        self.assertTrue(self.subject.is_deleted)
```

(If `api_delete_subject`'s actual URL differs from `/api/subjects/<id>/delete/`, adjust the test's URL to match what `schoolmanagement/Urls/urls.py` actually registers for it — check with `grep -n "delete_subject\|api_delete_subject" schoolmanagement/Urls/urls.py` before finalizing this step.)

- [ ] **Step 6: Checkpoint — model fields changed, stop and hand off**

Tell the user: "Subject gained `is_deleted`/`deleted_at`/`deleted_by` fields. Please run `python manage.py makemigrations academics && python manage.py migrate` before I continue." Wait for confirmation.

- [ ] **Step 7: Run the test**

Run: `python manage.py test school.tests.test_trash_subject -v 2`
Expected: PASS.

- [ ] **Step 8: Run `python manage.py check`**

Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add apps/academics/models.py school/views/subject_views.py school/views/class_views.py school/views/views_timetable.py school/views/exams_views.py school/views/teacherAllocation_view.py school/tests/test_trash_subject.py
git commit -m "feat: soft-delete Subject instead of hard delete, fix trashed-subject read filtering"
```

---

## Task 4: User accounts — deleted_at/deleted_by fields, soft-delete on api_delete_user, restore

**Files:**
- Modify: `apps/identity/models.py`
- Modify: `school/views/views.py`
- Test: `school/tests/test_trash_users.py`

**Interfaces:**
- Consumes: `soft_delete`/`restore`/`register_trash_entity`/`TrashEntityConfig` from Task 1.
- Produces: nothing new consumed by later tasks in this plan (Task 5 touches a different function in the same file).

- [ ] **Step 1: Add `deleted_at`/`deleted_by` to all four Extra models**

In `apps/identity/models.py`, insert the same two lines directly before each model's `class Meta:`:

```python
    deleted_at = models.DateTimeField(null=True, blank=True)
    deleted_by = models.ForeignKey('auth.User', on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
```

Insertion points (confirmed): before line 113 (`TeacherExtra`), before line 161 (`StaffExtra`), before line 237 (`StudentExtra`), before line 288 (`ParentExtra`). `related_name='+'` on all four to avoid a reverse-accessor name clash (Django would otherwise complain about 4 different models all trying to claim the same default reverse name on `User`).

- [ ] **Step 2: Add a shared trash helper and register all four**

Since "trash a user" always means the same thing (flip `user.is_active`, stamp the Extra row) regardless of which of the 4 Extra types it is, add one small module-level helper near the top of `apps/identity/models.py` (after the imports, before the first model class) rather than repeating it 4 times:

```python
def trash_user_account(extra_instance, *, operator=None, module, label):
    """Soft-deletes a User account: blocks login (is_active=False, already the
    convention this app uses for 'reactivate' — see class_views.py's reactivate
    action) and stamps the owning Extra row so it can be found/restored from Trash."""
    from django.utils import timezone
    from apps.core.services import write_audit_log

    extra_instance.user.is_active = False
    extra_instance.user.save(update_fields=['is_active'])
    extra_instance.deleted_at = timezone.now()
    extra_instance.deleted_by = operator
    extra_instance.save(update_fields=['deleted_at', 'deleted_by'])
    write_audit_log(
        operator_id=operator.id if operator else None,
        action_type='DELETE', module=module,
        description=f"Soft deleted {module.lower()} account for '{label}'.",
    )


def restore_user_account(extra_instance, *, operator=None, module, label):
    from apps.core.services import write_audit_log

    extra_instance.user.is_active = True
    extra_instance.user.save(update_fields=['is_active'])
    extra_instance.deleted_at = None
    extra_instance.deleted_by = None
    extra_instance.save(update_fields=['deleted_at', 'deleted_by'])
    write_audit_log(
        operator_id=operator.id if operator else None,
        action_type='RESTORE', module=module,
        description=f"Restored {module.lower()} account for '{label}'.",
    )
```

At the bottom of the file, register all four with the Trash registry. Purging a User account is the one auto-purge path with file cleanup to do first (`profile_pic` on Student/Teacher/Staff — `ParentExtra` has no `profile_pic` field, confirmed), then deleting `instance.user` (cascades to remove the Extra row itself, mirroring exactly what the original hard-delete path did with `obj.user.delete()`):

```python
def _purge_student(extra):
    if extra.profile_pic:
        extra.profile_pic.delete(save=False)
    extra.user.delete()


def _purge_teacher(extra):
    if extra.profile_pic:
        extra.profile_pic.delete(save=False)
    extra.user.delete()


def _purge_staff(extra):
    if extra.profile_pic:
        extra.profile_pic.delete(save=False)
    extra.user.delete()


def _purge_parent(extra):
    extra.user.delete()


def _register_user_trash():
    from apps.core.trash import register_trash_entity, TrashEntityConfig
    for entity_type, model, module, purge_fn in [
        ('users-students', StudentExtra, 'Student', _purge_student),
        ('users-teachers', TeacherExtra, 'Teacher', _purge_teacher),
        ('users-parents', ParentExtra, 'Parent', _purge_parent),
        ('users-staff', StaffExtra, 'Staff', _purge_staff),
    ]:
        register_trash_entity(entity_type, TrashEntityConfig(
            model=model, flag_field='user__is_active', flag_true=False, flag_false=True,
            auto_purge=True,
            label_fn=lambda obj: obj.get_name,
            purge_fn=purge_fn,
        ))


_register_user_trash()
```

- [ ] **Step 3: Route `api_delete_user` through soft-delete**

In `school/views/views.py`, `api_delete_user` (line 774 onward), replace:

```python
            # Deleting the base User automatically cascades and deletes the Extra profile
            obj.user.delete()

            return JsonResponse({'status': 'success'})
```

with:

```python
            from apps.identity.models import trash_user_account
            trash_user_account(
                obj, operator=request.user,
                module=user_type[:-1].capitalize(), label=obj.get_name,
            )

            return JsonResponse({'status': 'success'})
```

- [ ] **Step 4: Write the test**

```python
from django.contrib.auth.models import User
from django.test import TestCase

from apps.identity.models import StudentExtra, trash_user_account, restore_user_account


class UserAccountTrashTests(TestCase):
    def setUp(self):
        self.operator = User.objects.create_user(username='admin3', password='x', is_superuser=True)
        student_user = User.objects.create_user(username='stu1', password='x', first_name='Stu', last_name='One')
        self.student = StudentExtra.objects.create(user=student_user, roll='stu1', status=True)

    def test_trash_blocks_login_and_stamps_fields(self):
        trash_user_account(self.student, operator=self.operator, module='Student', label='Stu One')
        self.student.refresh_from_db()
        self.student.user.refresh_from_db()
        self.assertFalse(self.student.user.is_active)
        self.assertIsNotNone(self.student.deleted_at)
        self.assertEqual(self.student.deleted_by_id, self.operator.id)
        self.assertFalse(self.client.login(username='stu1', password='x'))

    def test_restore_reallows_login(self):
        trash_user_account(self.student, operator=self.operator, module='Student', label='Stu One')
        restore_user_account(self.student, operator=self.operator, module='Student', label='Stu One')
        self.student.refresh_from_db()
        self.student.user.refresh_from_db()
        self.assertTrue(self.student.user.is_active)
        self.assertIsNone(self.student.deleted_at)
        self.assertTrue(self.client.login(username='stu1', password='x'))

    def test_delete_endpoint_soft_deletes_not_hard_deletes(self):
        self.client.force_login(self.operator)
        response = self.client.post('/api/delete-user/', {
            'user_type': 'students', 'id': self.student.id,
        }, content_type='application/json')
        self.assertTrue(StudentExtra.objects.filter(id=self.student.id).exists())
        self.student.refresh_from_db()
        self.student.user.refresh_from_db()
        self.assertFalse(self.student.user.is_active)
```

(Check the actual registered URL name/path for `api_delete_user` in `schoolmanagement/Urls/urls.py` before finalizing `test_delete_endpoint_soft_deletes_not_hard_deletes` — adjust the URL string if it differs from `/api/delete-user/`.)

- [ ] **Step 5: Checkpoint — model fields changed, stop and hand off**

Tell the user: "StudentExtra/TeacherExtra/ParentExtra/StaffExtra gained `deleted_at`/`deleted_by` fields. Please run `python manage.py makemigrations identity && python manage.py migrate` before I continue." Wait for confirmation.

- [ ] **Step 6: Run the test**

Run: `python manage.py test school.tests.test_trash_users -v 2`
Expected: PASS.

- [ ] **Step 7: Run `python manage.py check`**

Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add apps/identity/models.py school/views/views.py school/tests/test_trash_users.py
git commit -m "feat: soft-delete user accounts instead of hard delete (blocks login via is_active)"
```

---

## Task 5: User directory listing excludes trashed accounts

**Files:**
- Modify: `school/views/views.py` (`api_get_approved_users`, lines 635-770)
- Test: `school/tests/test_trash_users_directory.py`

**Interfaces:**
- Consumes: Task 4's `trash_user_account`.

- [ ] **Step 1: Add `user__is_active=True` to every `status=True` filter in `api_get_approved_users`**

Replace the full function body in `school/views/views.py` (the one currently spanning roughly lines 635-770, starting `def api_get_approved_users(request, user_type):`) with this version — every `status=True` filter now also requires `user__is_active=True` (single accounts fetched via `id=`/`id__in=` off an already-status-filtered queryset don't need a second explicit filter, since they're derived from the same filtered set — confirmed below):

```python
@api_login_required
def api_get_approved_users(request, user_type):
    data = []
    user = request.user

    is_admin_user = user.is_superuser or user.groups.filter(name='ADMIN').exists()
    is_teacher_user = user.groups.filter(name='TEACHER').exists()
    is_parent_user = user.groups.filter(name='PARENT').exists()
    is_student_user = user.groups.filter(name='STUDENT').exists()

    try:
        if user_type == 'students':
            if is_admin_user or is_teacher_user:
                users = StudentExtra.objects.filter(status=True, user__is_active=True).select_related('user', 'cl').order_by('user__first_name', 'user__last_name')
            elif is_parent_user:
                parent_profile = getattr(user, 'parentextra', None)
                users = parent_profile.students.filter(status=True, user__is_active=True).select_related('user', 'cl').order_by('user__first_name', 'user__last_name') if parent_profile else []
            elif is_student_user:
                student_profile = getattr(user, 'studentextra', None)
                if student_profile and student_profile.cl:
                    users = StudentExtra.objects.filter(status=True, user__is_active=True, cl=student_profile.cl).select_related('user', 'cl').order_by('user__first_name', 'user__last_name')
                else:
                    users = StudentExtra.objects.filter(status=True, user__is_active=True, user=user).select_related('user', 'cl')
            else:
                users = []

            for u in users:
                data.append({
                    'id': u.id,
                    'name': u.get_name,
                    'username': u.user.username,
                    'email': u.user.email,
                    'class': str(u.cl) if u.cl else "Not Assigned",
                    'enrollment_state': u.enrollment_state,
                    'grade_name': u.cl.grade.name if u.cl and u.cl.grade else "Not Assigned",
                    'grade_order': u.cl.grade.numeric_order if u.cl and u.cl.grade else 9999,
                })

        elif user_type == 'teachers':
            if is_admin_user or is_teacher_user:
                teachers = TeacherExtra.objects.filter(status=True, user__is_active=True).select_related('user').prefetch_related('assigned_classes').order_by('user__first_name', 'user__last_name')
            elif is_parent_user:
                parent_profile = getattr(user, 'parentextra', None)
                if parent_profile:
                    child_stream_ids = parent_profile.students.filter(status=True, user__is_active=True).values_list('cl_id', flat=True)
                    allocated_teacher_ids = SubjectAllocation.objects.filter(classroom_id__in=child_stream_ids, is_active=True).values_list('teacher_id', flat=True)
                    teachers = TeacherExtra.objects.filter(status=True, user__is_active=True, id__in=allocated_teacher_ids).select_related('user').distinct().order_by('user__first_name', 'user__last_name')
                else:
                    teachers = []
            elif is_student_user:
                student_profile = getattr(user, 'studentextra', None)
                if student_profile and student_profile.cl:
                    allocated_teacher_ids = SubjectAllocation.objects.filter(classroom=student_profile.cl, is_active=True).values_list('teacher_id', flat=True)
                    teachers = TeacherExtra.objects.filter(status=True, user__is_active=True, id__in=allocated_teacher_ids).select_related('user').distinct().order_by('user__first_name', 'user__last_name')
                else:
                    teachers = []
            else:
                teachers = []

            for u in teachers:
                homeroom_streams = u.assigned_classes.filter(is_deleted=False)
                homeroom_names = [str(s) for s in homeroom_streams]
                data.append({
                    'id': u.id,
                    'name': u.get_name,
                    'username': u.user.username,
                    'email': u.user.email,
                    'subjects': u.subjects or "N/A",
                    'is_class_teacher': bool(homeroom_names),
                    'class_teacher_of': ", ".join(homeroom_names) if homeroom_names else None,
                })

        elif user_type == 'parents':
            if is_admin_user or is_teacher_user:
                parents = ParentExtra.objects.filter(status=True, user__is_active=True).prefetch_related('students__user', 'students__cl').select_related('user').order_by('user__first_name', 'user__last_name')
            else:
                return JsonResponse({'status': 'error', 'message': 'Access Denied.'}, status=403)

            for u in parents:
                linked_children = sorted(u.students.all(), key=lambda c: c.get_name.lower())
                children = ", ".join([child.get_name for child in linked_children])
                data.append({
                    'id': u.id,
                    'name': u.get_name,
                    'username': u.user.username,
                    'email': u.user.email,
                    'children': children,
                    'children_detail': [
                        {'id': c.id, 'name': c.get_name, 'class': str(c.cl) if c.cl else 'Not Assigned'}
                        for c in linked_children
                    ],
                    'relationship': u.relationship,
                    'children_count': len(linked_children),
                })

        elif user_type == 'staff':
            if not is_admin_user:
                return JsonResponse({'status': 'error', 'message': 'Access Denied.'}, status=403)
            staff = StaffExtra.objects.filter(status=True, user__is_active=True).select_related('user').order_by('user__first_name', 'user__last_name')
            for u in staff:
                data.append({
                    'id': u.id,
                    'name': u.get_name,
                    'username': u.user.username,
                    'email': u.user.email,
                    'job_title': u.job_title or "N/A",
                })

        return JsonResponse({'status': 'success', 'data': data})

    except Exception as e:
        return JsonResponse({'status': 'error', 'message': str(e)}, status=500)
```

Only the filter lines changed (`user__is_active=True` added everywhere `status=True` appears); every field name, branch, and response shape is identical to the current function — no frontend change needed for this task.

- [ ] **Step 2: Write the test**

```python
from django.contrib.auth.models import User, Group
from django.test import TestCase

from apps.identity.models import StudentExtra, trash_user_account


class DirectoryExcludesTrashedTests(TestCase):
    def setUp(self):
        admin_group, _ = Group.objects.get_or_create(name='ADMIN')
        self.admin_user = User.objects.create_user(username='admin4', password='x')
        self.admin_user.groups.add(admin_group)
        self.operator = self.admin_user

        live_user = User.objects.create_user(username='live_stu', password='x', first_name='Live', last_name='Student')
        self.live_student = StudentExtra.objects.create(user=live_user, roll='live_stu', status=True)

        trashed_user = User.objects.create_user(username='trashed_stu', password='x', first_name='Trashed', last_name='Student')
        self.trashed_student = StudentExtra.objects.create(user=trashed_user, roll='trashed_stu', status=True)
        trash_user_account(self.trashed_student, operator=self.operator, module='Student', label='Trashed Student')

    def test_trashed_student_excluded_from_directory(self):
        self.client.force_login(self.admin_user)
        response = self.client.get('/api/approved-users/students/')
        names = [row['name'] for row in response.json()['data']]
        self.assertIn(self.live_student.get_name, names)
        self.assertNotIn(self.trashed_student.get_name, names)
```

(Confirm the exact registered path for `api_get_approved_users` in `schoolmanagement/Urls/urls.py` before finalizing — `UserDirectoryTable.tsx:148` calls `GET /api/approved-users/<user_type>/` per Task-1-era research; adjust the test URL if the actual route differs.)

- [ ] **Step 2: Run the test**

Run: `python manage.py test school.tests.test_trash_users_directory -v 2`
Expected: PASS. (No migration checkpoint needed — this task only changes query filters, no new fields.)

- [ ] **Step 3: Run `python manage.py check`**

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add school/views/views.py school/tests/test_trash_users_directory.py
git commit -m "fix: exclude trashed accounts from the user directory listing"
```

---

## Task 6: TeacherLeave — is_deleted/deleted_at/deleted_by, admin-only soft-delete, read filtering

**Files:**
- Modify: `apps/staff/models.py`
- Modify: `school/views/leave_views.py`
- Test: `school/tests/test_trash_leave.py`

**Interfaces:**
- Consumes: `soft_delete`/`register_trash_entity`/`TrashEntityConfig` from Task 1.

- [ ] **Step 1: Add fields to `TeacherLeave`**

In `apps/staff/models.py`, fields end at line 53 (`created_at`), `class Meta:` at line 55. Insert between:

```python
    is_deleted = models.BooleanField(default=False, db_index=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    deleted_by = models.ForeignKey('auth.User', on_delete=models.SET_NULL, null=True, blank=True, related_name='+')

    class Meta:
```

- [ ] **Step 2: Register with the Trash registry**

After the `TeacherLeave` class body, add:

```python
def _register_leave_trash():
    from apps.core.trash import register_trash_entity, TrashEntityConfig
    register_trash_entity('leave-requests', TrashEntityConfig(
        model=TeacherLeave, flag_field='is_deleted', flag_true=True, flag_false=False,
        auto_purge=True,
        label_fn=lambda lv: f"{lv.teacher.get_name} — {lv.get_leave_type_display()} ({lv.start_date} to {lv.end_date})",
    ))


_register_leave_trash()
```

- [ ] **Step 3: Route only the admin-initiated delete branch through soft-delete**

In `school/views/leave_views.py`, `perform_destroy` currently reads:

```python
    def perform_destroy(self, instance):
        user = self.request.user
        if self._can_edit_broadly(user):
            write_audit_log(
                operator_id=user.id if user.is_authenticated else None,
                action_type='DELETE',
                module='TeacherLeave',
                description=f"Deleted {instance.teacher.get_name}'s {instance.get_leave_type_display()} "
                            f"request ({instance.start_date} to {instance.end_date}), status was {instance.status}."
            )
            instance.delete()
            return

        if instance.teacher.user_id != user.id:
            raise PermissionDenied("You may only cancel your own leave requests.")
        if instance.status != 'Pending':
            raise PermissionDenied("Only pending requests can be cancelled.")
        instance.delete()
```

Replace the admin branch's body (keep the self-cancel branch below it untouched — that one stays a real delete per the spec's explicit scope boundary):

```python
    def perform_destroy(self, instance):
        user = self.request.user
        if self._can_edit_broadly(user):
            from apps.core.trash import soft_delete
            soft_delete(
                instance, operator=user if user.is_authenticated else None,
                module='TeacherLeave',
                description=f"Deleted {instance.teacher.get_name}'s {instance.get_leave_type_display()} "
                            f"request ({instance.start_date} to {instance.end_date}), status was {instance.status}.",
            )
            return

        if instance.teacher.user_id != user.id:
            raise PermissionDenied("You may only cancel your own leave requests.")
        if instance.status != 'Pending':
            raise PermissionDenied("Only pending requests can be cancelled.")
        instance.delete()
```

- [ ] **Step 4: Fix read filtering**

In `school/views/leave_views.py`, `get_queryset` currently starts:

```python
    def get_queryset(self):
        user = self.request.user
        qs = TeacherLeave.objects.select_related(
            'teacher__user', 'longtermreliefassignment__relief_teacher__user'
        ).order_by('-created_at')
```

Change the `qs =` line to:

```python
    def get_queryset(self):
        user = self.request.user
        qs = TeacherLeave.objects.filter(is_deleted=False).select_related(
            'teacher__user', 'longtermreliefassignment__relief_teacher__user'
        ).order_by('-created_at')
```

- [ ] **Step 5: Write the test**

```python
from django.contrib.auth.models import User, Group
from django.test import TestCase

from apps.identity.models import TeacherExtra
from apps.staff.models import TeacherLeave


class LeaveTrashTests(TestCase):
    def setUp(self):
        admin_group, _ = Group.objects.get_or_create(name='ADMIN')
        self.admin_user = User.objects.create_user(username='admin5', password='x')
        self.admin_user.groups.add(admin_group)
        teacher_user = User.objects.create_user(username='teach1', password='x', first_name='Tee', last_name='Cher')
        self.teacher = TeacherExtra.objects.create(user=teacher_user, status=True)
        self.leave = TeacherLeave.objects.create(
            teacher=self.teacher, leave_type='Sick', start_date='2026-08-01', end_date='2026-08-03',
        )

    def test_admin_delete_soft_deletes(self):
        self.client.force_login(self.admin_user)
        self.client.delete(f'/api/core/leaves/{self.leave.id}/')
        self.leave.refresh_from_db()
        self.assertTrue(self.leave.is_deleted)
        self.assertIsNotNone(self.leave.deleted_at)

    def test_trashed_leave_excluded_from_listing(self):
        self.leave.is_deleted = True
        self.leave.save()
        self.client.force_login(self.admin_user)
        response = self.client.get('/api/core/leaves/')
        ids = [row['id'] for row in response.json()['results']] if 'results' in response.json() else [row['id'] for row in response.json()]
        self.assertNotIn(self.leave.id, ids)
```

(Adjust `leave_type`/`status` field choices in `setUp` if `TeacherLeave`'s actual `STATUS_CHOICES`/`leave_type` choices differ — check `apps/staff/models.py` before finalizing.)

- [ ] **Step 6: Checkpoint — model fields changed, stop and hand off**

Tell the user: "TeacherLeave gained `is_deleted`/`deleted_at`/`deleted_by` fields. Please run `python manage.py makemigrations staff && python manage.py migrate` before I continue." Wait for confirmation.

- [ ] **Step 7: Run the test**

Run: `python manage.py test school.tests.test_trash_leave -v 2`
Expected: PASS.

- [ ] **Step 8: Run `python manage.py check`**

Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add apps/staff/models.py school/views/leave_views.py school/tests/test_trash_leave.py
git commit -m "feat: soft-delete admin-initiated leave request deletions"
```

---

## Task 7: Role — is_deleted/deleted_at/deleted_by, soft-delete, fix permission-leak bug

**Files:**
- Modify: `apps/identity/models.py`
- Modify: `school/views/rbac_views.py`
- Modify: `apps/identity/services.py`
- Test: `school/tests/test_trash_role.py`

**Interfaces:**
- Consumes: `soft_delete`/`register_trash_entity`/`TrashEntityConfig` from Task 1.

- [ ] **Step 1: Add fields to `Role`**

In `apps/identity/models.py`, `Role`'s last field is `is_system_role` at line 420, `class Meta:` at line 422. Insert between:

```python
    is_deleted = models.BooleanField(default=False, db_index=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    deleted_by = models.ForeignKey('auth.User', on_delete=models.SET_NULL, null=True, blank=True, related_name='+')

    class Meta:
```

- [ ] **Step 2: Register with the Trash registry**

After the `Role` class body, add:

```python
def _register_role_trash():
    from apps.core.trash import register_trash_entity, TrashEntityConfig
    register_trash_entity('roles', TrashEntityConfig(
        model=Role, flag_field='is_deleted', flag_true=True, flag_false=False,
        auto_purge=True,
        label_fn=lambda r: r.name,
    ))


_register_role_trash()
```

- [ ] **Step 3: Route `RoleViewSet.perform_destroy` through soft-delete**

In `school/views/rbac_views.py`, replace:

```python
    def perform_destroy(self, instance):
        if instance.is_system_role:
            raise ValidationError(
                f"'{instance.name}' is a core system role and can't be deleted. "
                "You can still edit which permissions it grants."
            )

        role_name = instance.name
        affected_users = list(instance.user_assignments.values_list('user__username', flat=True))
        instance.delete()
        write_audit_log(
            operator_id=self.request.user.id,
            action_type='DELETE',
            module='RBAC',
            description=f"Deleted role '{role_name}'" + (
                f" — previously assigned to: {', '.join(affected_users)}." if affected_users else "."
            )
        )
```

with:

```python
    def perform_destroy(self, instance):
        if instance.is_system_role:
            raise ValidationError(
                f"'{instance.name}' is a core system role and can't be deleted. "
                "You can still edit which permissions it grants."
            )

        from apps.core.trash import soft_delete
        role_name = instance.name
        affected_users = list(instance.user_assignments.values_list('user__username', flat=True))
        soft_delete(
            instance, operator=self.request.user, module='RBAC',
            description=f"Deleted role '{role_name}'" + (
                f" — previously assigned to: {', '.join(affected_users)}." if affected_users else "."
            ),
        )
```

Also add a queryset filter so trashed roles disappear from the Roles & Permissions list. Find `queryset = Role.objects.all().prefetch_related('permissions').annotate(...)` (line 32) and change `Role.objects.all()` to `Role.objects.filter(is_deleted=False)`.

- [ ] **Step 4: Fix the permission-leak bug — a trashed Role must stop granting its permissions**

This is a real, independently-valuable bug fix this plan surfaces: `get_user_permission_codes()` (`apps/identity/services.py:167-169`) currently does:

```python
    return frozenset(
        Permission.objects.filter(roles__user_assignments__user_id=user_id).values_list('code', flat=True)
    )
```

Change to:

```python
    return frozenset(
        Permission.objects.filter(
            roles__user_assignments__user_id=user_id, roles__is_deleted=False,
        ).values_list('code', flat=True)
    )
```

Also fix `school/views/rbac_views.py:132`, which currently does `Role.objects.filter(user_assignments__user=user)` (a "list this user's roles" endpoint) — change to `Role.objects.filter(user_assignments__user=user, is_deleted=False)`.

- [ ] **Step 5: Write the test**

```python
from django.contrib.auth.models import User, Group
from django.test import TestCase

from apps.identity.models import Permission, Role, UserRole
from apps.identity.services import get_user_permission_codes


class RoleTrashTests(TestCase):
    def setUp(self):
        admin_group, _ = Group.objects.get_or_create(name='ADMIN')
        self.admin_user = User.objects.create_user(username='admin6', password='x')
        self.admin_user.groups.add(admin_group)

        self.permission = Permission.objects.create(code='custom.thing', label='Custom thing', module='Custom')
        self.role = Role.objects.create(name='CustomRole')
        self.role.permissions.add(self.permission)

        self.holder_user = User.objects.create_user(username='holder1', password='x')
        UserRole.objects.create(user=self.holder_user, role=self.role)

    def test_trashed_role_no_longer_grants_permissions(self):
        self.assertIn('custom.thing', get_user_permission_codes(self.holder_user.id))

        from apps.core.trash import soft_delete
        soft_delete(self.role, operator=self.admin_user, module='RBAC', description='Deleted role CustomRole.')

        self.assertNotIn('custom.thing', get_user_permission_codes(self.holder_user.id))

    def test_delete_endpoint_soft_deletes(self):
        self.client.force_login(self.admin_user)
        self.client.delete(f'/api/core/rbac/roles/{self.role.id}/')
        self.role.refresh_from_db()
        self.assertTrue(self.role.is_deleted)
```

- [ ] **Step 6: Checkpoint — model fields changed, stop and hand off**

Tell the user: "Role gained `is_deleted`/`deleted_at`/`deleted_by` fields. Please run `python manage.py makemigrations identity && python manage.py migrate` before I continue." Wait for confirmation.

- [ ] **Step 7: Run the test**

Run: `python manage.py test school.tests.test_trash_role school.tests.test_trash_infra -v 2`
Expected: PASS. (This is also when Task 1's `test_trash_infra.py` Role-based tests become runnable — run them together to confirm both pass now that `Role.is_deleted`/`deleted_at`/`deleted_by` exist.)

- [ ] **Step 8: Run `python manage.py check`**

Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add apps/identity/models.py apps/identity/services.py school/views/rbac_views.py school/tests/test_trash_role.py
git commit -m "feat: soft-delete roles; fix trashed roles silently retaining granted permissions"
```

---

## Task 8: Event — reuse existing is_active, add deleted_at/deleted_by, read filtering, serializer fix

**Files:**
- Modify: `apps/messaging/models.py`
- Modify: `school/views/attendance_views.py`
- Modify: `school/serializers/serializers.py`
- Test: `school/tests/test_trash_event.py`

**Interfaces:**
- Consumes: `restore`/`register_trash_entity`/`TrashEntityConfig` from Task 1.

- [ ] **Step 1: Add `deleted_at`/`deleted_by` to `Event`**

`Event` already has `is_active = models.BooleanField(default=True)` right before its `class Meta: db_table = 'school_event'` in `apps/messaging/models.py` (~line 76-79) — **do not add a second `is_deleted` field**, reuse `is_active` (same reasoning as User accounts: an entity already has a working boolean, adding a second one would create two overlapping flags on the same model). Insert directly after the existing `is_active` field:

```python
    is_active = models.BooleanField(default=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    deleted_by = models.ForeignKey('auth.User', on_delete=models.SET_NULL, null=True, blank=True, related_name='+')

    class Meta:
        db_table = 'school_event'
```

- [ ] **Step 2: Register with the Trash registry**

After the `Event` class body, add:

```python
def _register_event_trash():
    from apps.core.trash import register_trash_entity, TrashEntityConfig
    register_trash_entity('events', TrashEntityConfig(
        model=Event, flag_field='is_active', flag_true=False, flag_false=True,
        auto_purge=True,
        label_fn=lambda e: e.title,
    ))


_register_event_trash()
```

(Adjust `e.title` if `Event`'s actual title field is named differently — confirm against `apps/messaging/models.py` before finalizing.)

- [ ] **Step 3: Add `get_queryset` and `perform_destroy` to `EventViewSet`**

In `school/views/attendance_views.py`, `EventViewSet` currently has no `get_queryset`/`perform_destroy` override — just:

```python
class EventViewSet(viewsets.ModelViewSet):
    queryset = Event.objects.all()
    serializer_class = EventSerializer
    permission_classes = [IsAdminForWrite, HasModulePermission]
    rbac_edit_permission = 'events.edit'
```

Replace with:

```python
class EventViewSet(viewsets.ModelViewSet):
    queryset = Event.objects.all()
    serializer_class = EventSerializer
    permission_classes = [IsAdminForWrite, HasModulePermission]
    rbac_edit_permission = 'events.edit'

    def get_queryset(self):
        return Event.objects.filter(is_active=True).order_by('-start_time')

    def perform_destroy(self, instance):
        from apps.core.trash import soft_delete
        soft_delete(
            instance, operator=self.request.user, module='Events',
            flag_field='is_active', flag_true=False,
            description=f"Deleted event '{instance.title}'.",
        )
```

- [ ] **Step 4: Fix `EventSerializer` so new bookkeeping fields don't leak into normal API responses**

In `school/serializers/serializers.py`, `EventSerializer` (line 24) currently uses `fields = '__all__'`. Change to an explicit list excluding the new fields — read the model's actual current field list first (`apps/messaging/models.py`, `Event` class) and enumerate every existing field explicitly plus `is_active`, but leave out `deleted_at`/`deleted_by`. For example, if `Event`'s fields are `id, title, description, start_time, end_time, is_active`, the serializer becomes:

```python
class EventSerializer(serializers.ModelSerializer):
    class Meta:
        model = Event
        fields = ['id', 'title', 'description', 'start_time', 'end_time', 'is_active']
```

(Confirm the exact field set against the live `Event` model before writing this — do not guess field names not confirmed by reading the model.)

- [ ] **Step 5: Write the test**

```python
from django.contrib.auth.models import User, Group
from django.test import TestCase
from django.utils import timezone

from apps.messaging.models import Event


class EventTrashTests(TestCase):
    def setUp(self):
        admin_group, _ = Group.objects.get_or_create(name='ADMIN')
        self.admin_user = User.objects.create_user(username='admin7', password='x', is_superuser=True)
        self.admin_user.groups.add(admin_group)
        self.event = Event.objects.create(
            title='Sports Day', start_time=timezone.now(), end_time=timezone.now(),
        )

    def test_delete_soft_deletes_via_is_active(self):
        self.client.force_login(self.admin_user)
        self.client.delete(f'/api/core/events/{self.event.id}/')
        self.event.refresh_from_db()
        self.assertFalse(self.event.is_active)
        self.assertIsNotNone(self.event.deleted_at)

    def test_trashed_event_excluded_from_list(self):
        self.event.is_active = False
        self.event.save()
        response = self.client.get('/api/core/events/')
        body = response.json()
        rows = body['results'] if 'results' in body else body
        self.assertNotIn(self.event.id, [row['id'] for row in rows])

    def test_serializer_does_not_leak_deleted_by(self):
        self.client.force_login(self.admin_user)
        response = self.client.get(f'/api/core/events/{self.event.id}/')
        self.assertNotIn('deleted_by', response.json())
        self.assertNotIn('deleted_at', response.json())
```

(Adjust `Event.objects.create(...)` fields to match the model's actual required fields — check `apps/messaging/models.py` before finalizing.)

- [ ] **Step 6: Checkpoint — model fields changed, stop and hand off**

Tell the user: "Event gained `deleted_at`/`deleted_by` fields (reusing the existing `is_active` flag for trashing). Please run `python manage.py makemigrations messaging && python manage.py migrate` before I continue." Wait for confirmation.

- [ ] **Step 7: Run the test**

Run: `python manage.py test school.tests.test_trash_event -v 2`
Expected: PASS.

- [ ] **Step 8: Run `python manage.py check`**

Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add apps/messaging/models.py school/views/attendance_views.py school/serializers/serializers.py school/tests/test_trash_event.py
git commit -m "feat: soft-delete events via existing is_active flag, exclude trashed events from listings"
```

---

## Task 9: Notice — is_deleted/deleted_at/deleted_by, read filtering, serializer fix, file cleanup on purge

**Files:**
- Modify: `apps/messaging/models.py`
- Modify: `school/views/attendance_views.py`
- Modify: `school/serializers/serializers.py`
- Test: `school/tests/test_trash_notice.py`

**Interfaces:**
- Consumes: `soft_delete`/`register_trash_entity`/`TrashEntityConfig` from Task 1.

- [ ] **Step 1: Add fields to `Notice`**

In `apps/messaging/models.py`, `Notice`'s last field is `is_urgent` (~line 51), `class Meta:` at ~line 53. Insert between:

```python
    is_deleted = models.BooleanField(default=False, db_index=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    deleted_by = models.ForeignKey('auth.User', on_delete=models.SET_NULL, null=True, blank=True, related_name='+')

    class Meta:
```

- [ ] **Step 2: Register with the Trash registry, including a purge function for file cleanup**

After the `Notice` class body, add:

```python
def _purge_notice(notice):
    if notice.attachment:
        notice.attachment.delete(save=False)
    notice.delete()


def _register_notice_trash():
    from apps.core.trash import register_trash_entity, TrashEntityConfig
    register_trash_entity('notices', TrashEntityConfig(
        model=Notice, flag_field='is_deleted', flag_true=True, flag_false=False,
        auto_purge=True,
        label_fn=lambda n: n.title,
        purge_fn=_purge_notice,
    ))


_register_notice_trash()
```

(Adjust `n.title` / `notice.attachment` if `Notice`'s actual title/attachment field names differ — confirm against `apps/messaging/models.py` before finalizing; the spec confirms `Notice` has a `FileField` named `attachment`.)

- [ ] **Step 3: Fix `NoticeViewSet`'s `get_queryset` and add `perform_destroy`**

In `school/views/attendance_views.py`, `NoticeViewSet.get_queryset` currently starts:

```python
    def get_queryset(self):
        queryset = Notice.objects.all().order_by('-date')
```

Change to:

```python
    def get_queryset(self):
        queryset = Notice.objects.filter(is_deleted=False).order_by('-date')
```

Add a `perform_destroy` method to the class (it currently has none):

```python
    def perform_destroy(self, instance):
        from apps.core.trash import soft_delete
        soft_delete(
            instance, operator=self.request.user, module='Notices',
            description=f"Deleted notice '{instance.title}'.",
        )
```

- [ ] **Step 4: Fix both `NoticeSerializer`s so new bookkeeping fields don't leak**

`school/serializers/serializers.py:36` uses `fields = '__all__'` — change to an explicit field list the same way as `EventSerializer` in Task 8, enumerating Notice's real current fields plus excluding `is_deleted`/`deleted_at`/`deleted_by`. `school/serializers/teacher_serializers.py:28`'s separate `NoticeSerializer` already uses an explicit list (`['id','title','message','date','by','is_urgent']`) and needs no change.

- [ ] **Step 5: Write the test**

```python
from django.contrib.auth.models import User, Group
from django.test import TestCase

from apps.messaging.models import Notice


class NoticeTrashTests(TestCase):
    def setUp(self):
        admin_group, _ = Group.objects.get_or_create(name='ADMIN')
        self.admin_user = User.objects.create_user(username='admin8', password='x', is_superuser=True)
        self.admin_user.groups.add(admin_group)
        self.notice = Notice.objects.create(title='Fee Reminder', message='Pay fees by Friday.')

    def test_delete_soft_deletes(self):
        self.client.force_login(self.admin_user)
        self.client.delete(f'/api/core/notices/{self.notice.id}/')
        self.notice.refresh_from_db()
        self.assertTrue(self.notice.is_deleted)
        self.assertIsNotNone(self.notice.deleted_at)

    def test_trashed_notice_excluded_from_list(self):
        self.notice.is_deleted = True
        self.notice.save()
        self.client.force_login(self.admin_user)
        response = self.client.get('/api/core/notices/')
        body = response.json()
        rows = body['results'] if 'results' in body else body
        self.assertNotIn(self.notice.id, [row['id'] for row in rows])
```

(Adjust `Notice.objects.create(...)` fields/required-field set to match the model's actual definition — check `apps/messaging/models.py` before finalizing.)

- [ ] **Step 6: Checkpoint — model fields changed, stop and hand off**

Tell the user: "Notice gained `is_deleted`/`deleted_at`/`deleted_by` fields. Please run `python manage.py makemigrations messaging && python manage.py migrate` before I continue." Wait for confirmation.

- [ ] **Step 7: Run the test**

Run: `python manage.py test school.tests.test_trash_notice -v 2`
Expected: PASS.

- [ ] **Step 8: Run `python manage.py check`**

Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add apps/messaging/models.py school/views/attendance_views.py school/serializers/serializers.py school/tests/test_trash_notice.py
git commit -m "feat: soft-delete notices, purge cleans up attachment files"
```

---

## Task 10: Assignment — is_deleted/deleted_at/deleted_by, soft-delete, read filtering, full-subtree file cleanup

**Files:**
- Modify: `apps/assignments/models.py`
- Modify: `school/views/assignment_teacher_views.py`
- Modify: `school/views/assignment_student_views.py`
- Modify: `apps/assignments/services.py`
- Modify: `school/views/student_dashboard_view.py`
- Test: `school/tests/test_trash_assignment.py`

**Interfaces:**
- Consumes: `soft_delete`/`register_trash_entity`/`TrashEntityConfig` from Task 1.

- [ ] **Step 1: Add fields to `Assignment`**

In `apps/assignments/models.py`, `Assignment`'s field list ends with `reference_notes` (right before `class Meta:\n        db_table = 'school_assignment'`). Insert between:

```python
    reference_notes = models.TextField(null=True, blank=True, help_text="Free-text reference material / instructions.")

    is_deleted = models.BooleanField(default=False, db_index=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    deleted_by = models.ForeignKey('auth.User', on_delete=models.SET_NULL, null=True, blank=True, related_name='+')

    class Meta:
        db_table = 'school_assignment'
```

- [ ] **Step 2: Register with the Trash registry, including full-subtree file cleanup**

After the `Assignment` class body (before `AssignmentGroup`), add:

```python
def _purge_assignment(assignment):
    if assignment.teacher_attachment:
        assignment.teacher_attachment.delete(save=False)
    for attachment in assignment.attachments.all():
        if attachment.file:
            attachment.file.delete(save=False)
    for submission in assignment.submissions.all():
        if submission.student_attachment:
            submission.student_attachment.delete(save=False)
        if submission.teacher_returned_file:
            submission.teacher_returned_file.delete(save=False)
        for answer in submission.answers.all():
            if answer.uploaded_file:
                answer.uploaded_file.delete(save=False)
    assignment.delete()


def _register_assignment_trash():
    from apps.core.trash import register_trash_entity, TrashEntityConfig
    register_trash_entity('assignments', TrashEntityConfig(
        model=Assignment, flag_field='is_deleted', flag_true=True, flag_false=False,
        auto_purge=True,
        label_fn=lambda a: a.title,
        purge_fn=_purge_assignment,
    ))


_register_assignment_trash()
```

This walks every file field in Assignment's object graph (`teacher_attachment`, each `AssignmentAttachment.file`, each `StudentSubmission.student_attachment`/`teacher_returned_file`, each `StudentAnswer.uploaded_file`) before the `CASCADE` deletes the rows — matching the spec's explicit call-out that CASCADE only removes DB rows, never storage files.

- [ ] **Step 3: Route the teacher delete endpoint through soft-delete**

In `school/views/assignment_teacher_views.py`, replace:

```python
    def delete(self, request, pk):
        """
        Deletes the assignment entirely. Models.CASCADE will safely remove all
        linked questions, options, and student submissions automatically.
        """
        try:
            assignment = self._get_assignment_safely(request.user, pk)
            assignment.delete()
            return Response({"message": "Assignment deleted successfully."}, status=status.HTTP_204_NO_CONTENT)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
```

with:

```python
    def delete(self, request, pk):
        """Moves the assignment to Trash. Permanently purging it (after 20 days,
        or manually) walks its full file-attachment subtree — see
        apps.assignments.models._purge_assignment."""
        try:
            assignment = self._get_assignment_safely(request.user, pk)
            from apps.core.trash import soft_delete
            soft_delete(
                assignment, operator=request.user, module='Assignments',
                description=f"Deleted assignment '{assignment.title}'.",
            )
            return Response({"message": "Assignment moved to Trash."}, status=status.HTTP_204_NO_CONTENT)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
```

- [ ] **Step 4: Fix read-site filtering**

Apply `is_deleted=False` filtering at each confirmed listing call site:

- `school/views/assignment_student_views.py:126` — add `is_deleted=False` to the existing `Assignment.objects.filter(...)` call's keyword arguments.
- `school/views/assignment_teacher_views.py:114` — change `Assignment.objects.all().select_related(...)` to `Assignment.objects.filter(is_deleted=False).select_related(...)`.
- `school/views/assignment_teacher_views.py:119` — add `is_deleted=False` to the existing `Assignment.objects.filter(teacher=teacher_profile)...` call's keyword arguments.
- `school/views/student_dashboard_view.py:45` — add `is_deleted=False` to the existing `Assignment.objects.filter(...)` call's keyword arguments.
- `apps/assignments/services.py:47` (`list_assignments`) — change `qs = Assignment.objects.all()` to `qs = Assignment.objects.filter(is_deleted=False)`.

Leave `apps/assignments/services.py:42` (`get_assignment`, a single by-ID lookup) unfiltered — it's used as an internal reference resolver, matching the same reasoning as Subject's by-ID lookups in Task 3.

- [ ] **Step 5: Write the test**

```python
from django.contrib.auth.models import User
from django.test import TestCase

from apps.academics.models import ClassStream, GradeLevel, Curriculum, Subject
from apps.assignments.models import Assignment
from apps.identity.models import TeacherExtra


class AssignmentTrashTests(TestCase):
    def setUp(self):
        self.operator = User.objects.create_user(username='teach2', password='x', first_name='Tee', last_name='Cher2')
        self.teacher = TeacherExtra.objects.create(user=self.operator, status=True)
        curriculum = Curriculum.objects.create(name='CBC2', is_active_for_new_grades=True)
        grade = GradeLevel.objects.create(curriculum=curriculum, name='Grade 8', numeric_order=8)
        self.stream = ClassStream.objects.create(name='West', grade=grade)
        self.subject = Subject.objects.create(code='ENG101', name='English')
        self.assignment = Assignment.objects.create(
            title='Essay 1', teacher=self.teacher, subject=self.subject, class_stream=self.stream,
        )

    def test_delete_soft_deletes(self):
        self.client.force_login(self.operator)
        self.client.delete(f'/api/assignments/teacher/{self.assignment.id}/')
        self.assignment.refresh_from_db()
        self.assertTrue(self.assignment.is_deleted)
        self.assertIsNotNone(self.assignment.deleted_at)
        self.assertTrue(Assignment.objects.filter(id=self.assignment.id).exists())
```

(Confirm the exact registered URL path for the teacher assignment delete endpoint in `schoolmanagement/Urls/urls.py` or `apps/assignments/urls.py` before finalizing — adjust if it differs from `/api/assignments/teacher/<id>/`. Also confirm `Assignment`'s actual required fields/`assignment_type` default before finalizing `setUp`.)

- [ ] **Step 6: Checkpoint — model fields changed, stop and hand off**

Tell the user: "Assignment gained `is_deleted`/`deleted_at`/`deleted_by` fields. Please run `python manage.py makemigrations assignments && python manage.py migrate` before I continue." Wait for confirmation.

- [ ] **Step 7: Run the test**

Run: `python manage.py test school.tests.test_trash_assignment -v 2`
Expected: PASS.

- [ ] **Step 8: Run `python manage.py check`**

Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add apps/assignments/models.py school/views/assignment_teacher_views.py school/views/assignment_student_views.py apps/assignments/services.py school/views/student_dashboard_view.py school/tests/test_trash_assignment.py
git commit -m "feat: soft-delete assignments, purge cleans up full attachment subtree"
```

---

## Task 11: Trash list/restore/purge API

**Files:**
- Create: `school/views/trash_views.py`
- Modify: `schoolmanagement/Urls/urls.py`
- Test: `school/tests/test_trash_api.py`

**Interfaces:**
- Consumes: `TRASH_REGISTRY`, `soft_delete`, `restore` from `apps/core/trash.py` (fully populated as of Task 10 — all 9 registry keys registered: `class-streams`, `subjects`, `users-students`, `users-teachers`, `users-parents`, `users-staff`, `leave-requests`, `roles`, `events`, `notices`, `assignments`).
- Produces: `GET /api/trash/<entity_type>/`, `POST /api/trash/<entity_type>/<id>/restore/`, `POST /api/trash/<entity_type>/<id>/purge/`.

- [ ] **Step 1: Write `school/views/trash_views.py`**

```python
"""
Trash API — list/restore/permanently-purge soft-deleted rows across every
entity type registered in apps.core.trash.TRASH_REGISTRY. One generic set of
views instead of one per entity, since every entity follows the same
flag/restore/purge shape (see apps/core/trash.py for the registry contract).
"""
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.http import require_http_methods

from apps.core.trash import TRASH_REGISTRY, restore
from school.decorators import require_permission


def _entity_config_or_404(entity_type):
    config = TRASH_REGISTRY.get(entity_type)
    if config is None:
        return None
    return config


@require_permission('trash.view')
def api_list_trash(request, entity_type):
    config = _entity_config_or_404(entity_type)
    if config is None:
        return JsonResponse({'status': 'error', 'message': f"Unknown trash entity type '{entity_type}'."}, status=404)

    from apps.core.trash import purge_expired_trash
    if config.auto_purge:
        purge_expired_trash(entity_type=entity_type)

    lookup = {config.flag_field: config.flag_true}
    rows = config.model.objects.filter(**lookup).order_by('-deleted_at')

    data = []
    for row in rows:
        purge_at = None
        if config.auto_purge and row.deleted_at:
            from apps.core.trash import AUTO_PURGE_AFTER
            purge_at = (row.deleted_at + AUTO_PURGE_AFTER).isoformat()
        data.append({
            'id': row.id,
            'label': config.label_fn(row),
            'deleted_at': row.deleted_at.isoformat() if row.deleted_at else None,
            'deleted_by': row.deleted_by.get_full_name() or row.deleted_by.username if row.deleted_by else None,
            'auto_purge': config.auto_purge,
            'purge_at': purge_at,
        })
    return JsonResponse({'status': 'success', 'entity_type': entity_type, 'data': data})


@require_http_methods(['POST'])
@require_permission('trash.manage')
def api_restore_trash_item(request, entity_type, pk):
    config = _entity_config_or_404(entity_type)
    if config is None:
        return JsonResponse({'status': 'error', 'message': f"Unknown trash entity type '{entity_type}'."}, status=404)

    instance = get_object_or_404(config.model, pk=pk)
    restore(
        instance, operator=request.user, flag_field=config.flag_field, flag_false=config.flag_false,
        module=entity_type, description=f"Restored {config.label_fn(instance)} from Trash.",
    )
    return JsonResponse({'status': 'success'})


@require_http_methods(['POST'])
@require_permission('trash.manage')
def api_purge_trash_item(request, entity_type, pk):
    config = _entity_config_or_404(entity_type)
    if config is None:
        return JsonResponse({'status': 'error', 'message': f"Unknown trash entity type '{entity_type}'."}, status=404)

    instance = get_object_or_404(config.model, pk=pk)
    label = config.label_fn(instance)

    from apps.core.services import write_audit_log
    if config.purge_fn:
        config.purge_fn(instance)
    else:
        instance.delete()
    write_audit_log(
        operator_id=request.user.id, action_type='DELETE', module=entity_type,
        description=f"Permanently purged {label} from Trash.",
    )
    return JsonResponse({'status': 'success'})
```

Note: `flag_field` for the four `users-*` entity types is `'user__is_active'` (a related lookup, not a plain model field) — `Model.objects.filter(**{'user__is_active': False})` works fine for `api_list_trash`'s query, but `restore()`'s `setattr(instance, flag_field, flag_false)` in `apps/core/trash.py` would fail on `'user__is_active'` (that's a lookup path, not an attribute path). Fix `restore()` in `apps/core/trash.py` (Task 1's file) to handle this: replace the `restore()` function body's `setattr(instance, flag_field, flag_false)` line with a check —

```python
def restore(instance, *, operator: Optional[User], flag_field: str = 'is_deleted',
            flag_false: Any = False, module: str, description: str) -> None:
    if '__' in flag_field:
        obj, attr = flag_field.split('__', 1)
        setattr(getattr(instance, obj), attr, flag_false)
        getattr(instance, obj).save(update_fields=[attr])
    else:
        setattr(instance, flag_field, flag_false)
    instance.deleted_at = None
    instance.deleted_by = None
    instance.save()
    write_audit_log(
        operator_id=operator.id if operator else None,
        action_type='RESTORE', module=module, description=description,
    )
```

Apply this fix to `apps/core/trash.py` as part of this task's Step 1 (it's a correction to Task 1's file, needed because Task 1 was written before the Users entity's `user__is_active` shape was fully worked out in Task 4).

- [ ] **Step 2: Wire up URLs**

In `schoolmanagement/Urls/urls.py`, add near the other `path(...)` entries (alongside the `api/core/` router include):

```python
    path('api/trash/<str:entity_type>/', trash_views.api_list_trash, name='api_list_trash'),
    path('api/trash/<str:entity_type>/<int:pk>/restore/', trash_views.api_restore_trash_item, name='api_restore_trash_item'),
    path('api/trash/<str:entity_type>/<int:pk>/purge/', trash_views.api_purge_trash_item, name='api_purge_trash_item'),
```

Add the import near the other `school.views.*` imports at the top of the file:

```python
from school.views import trash_views
```

- [ ] **Step 3: Write the test**

```python
from django.contrib.auth.models import User, Group
from django.test import TestCase

from apps.identity.models import Permission, Role, UserRole
from apps.academics.models import Subject


class TrashAPITests(TestCase):
    def setUp(self):
        self.superuser = User.objects.create_user(username='super1', password='x', is_superuser=True)
        self.subject = Subject.objects.create(code='SCI101', name='Science')
        self.subject.soft_delete(operator_user=self.superuser)

    def test_superuser_can_list_trash(self):
        self.client.force_login(self.superuser)
        response = self.client.get('/api/trash/subjects/')
        self.assertEqual(response.status_code, 200)
        ids = [row['id'] for row in response.json()['data']]
        self.assertIn(self.subject.id, ids)

    def test_admin_without_permission_is_denied(self):
        admin_group, _ = Group.objects.get_or_create(name='ADMIN')
        plain_admin = User.objects.create_user(username='plainadmin', password='x')
        plain_admin.groups.add(admin_group)
        self.client.force_login(plain_admin)
        response = self.client.get('/api/trash/subjects/')
        self.assertEqual(response.status_code, 403)

    def test_admin_with_trash_permission_can_restore(self):
        admin_group, _ = Group.objects.get_or_create(name='ADMIN')
        granted_admin = User.objects.create_user(username='grantedadmin', password='x')
        granted_admin.groups.add(admin_group)
        role = Role.objects.create(name='TrashKeeper')
        role.permissions.add(
            Permission.objects.create(code='trash.view', label='View Trash', module='Trash'),
            Permission.objects.create(code='trash.manage', label='Manage Trash', module='Trash'),
        )
        UserRole.objects.create(user=granted_admin, role=role)

        self.client.force_login(granted_admin)
        response = self.client.post(f'/api/trash/subjects/{self.subject.id}/restore/')
        self.assertEqual(response.status_code, 200)
        self.subject.refresh_from_db()
        self.assertFalse(self.subject.is_deleted)

    def test_unknown_entity_type_404s(self):
        self.client.force_login(self.superuser)
        response = self.client.get('/api/trash/not-a-real-type/')
        self.assertEqual(response.status_code, 404)
```

- [ ] **Step 4: Run the test**

Run: `python manage.py test school.tests.test_trash_api -v 2`
Expected: PASS. (No migration checkpoint — no new model fields in this task; `purge_expired_trash` is imported but not yet defined until Task 12 — stub it in `apps/core/trash.py` now as `def purge_expired_trash(entity_type=None): pass` so this task's tests run standalone; Task 12 fills in the real body.)

- [ ] **Step 5: Run `python manage.py check`**

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add school/views/trash_views.py apps/core/trash.py schoolmanagement/Urls/urls.py school/tests/test_trash_api.py
git commit -m "feat: add Trash list/restore/purge API"
```

---

## Task 12: Auto-purge sweep + management command

**Files:**
- Modify: `apps/core/trash.py` (replace the Task-11 stub)
- Create: `apps/core/management/commands/purge_expired_trash.py`
- Test: `school/tests/test_trash_purge_sweep.py`

**Interfaces:**
- Consumes: `TRASH_REGISTRY`, `AUTO_PURGE_AFTER` from `apps/core/trash.py`.
- Produces: `purge_expired_trash(entity_type: str | None = None) -> int` (returns count purged) — real implementation replacing Task 11's stub. Called by `api_list_trash` (Task 11) and the new management command.

- [ ] **Step 1: Implement `purge_expired_trash` in `apps/core/trash.py`**

Replace the stub added in Task 11 with:

```python
def purge_expired_trash(entity_type: Optional[str] = None) -> int:
    """
    Permanently deletes every auto-purgeable row whose deleted_at is more than
    AUTO_PURGE_AFTER in the past. Class Stream and Subject are registered with
    auto_purge=False and are never touched here — they only leave Trash via the
    manual purge endpoint (school/views/trash_views.py:api_purge_trash_item).
    Safe to call repeatedly (idempotent — nothing left to purge is a no-op).
    """
    from apps.core.services import write_audit_log

    cutoff = timezone.now() - AUTO_PURGE_AFTER
    entity_types = [entity_type] if entity_type else list(TRASH_REGISTRY.keys())
    purged_count = 0

    for et in entity_types:
        config = TRASH_REGISTRY.get(et)
        if config is None or not config.auto_purge:
            continue

        lookup = {config.flag_field: config.flag_true, 'deleted_at__lte': cutoff}
        expired = list(config.model.objects.filter(**lookup))
        for instance in expired:
            label = config.label_fn(instance)
            if config.purge_fn:
                config.purge_fn(instance)
            else:
                instance.delete()
            write_audit_log(
                operator_id=None, action_type='DELETE', module=et,
                description=f"Auto-purged {label} from Trash after 20 days.",
            )
            purged_count += 1

    return purged_count
```

- [ ] **Step 2: Write the management command**

```python
from django.core.management.base import BaseCommand

from apps.core.trash import purge_expired_trash


class Command(BaseCommand):
    """
    Permanently deletes any Trash item older than 20 days (Class Stream and
    Subject are excluded — they only leave Trash manually, see
    apps/core/trash.py's TrashEntityConfig.auto_purge). Safe to run repeatedly;
    intended to be wired up to an external cron by the operator, since this
    project has no Celery Beat schedule configured. The Trash page itself also
    runs this same sweep lazily whenever it's opened, so this command is a
    belt-and-suspenders guarantee, not the only way purging happens.

    Usage:
        python manage.py purge_expired_trash
    """
    help = "Permanently deletes Trash items past their 20-day auto-purge window."

    def handle(self, *args, **options):
        count = purge_expired_trash()
        self.stdout.write(self.style.SUCCESS(f"Purged {count} expired Trash item(s)."))
```

- [ ] **Step 3: Write the test**

```python
from datetime import timedelta

from django.contrib.auth.models import User
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone

from apps.academics.models import Subject
from apps.identity.models import Role


class AutoPurgeSweepTests(TestCase):
    def setUp(self):
        self.operator = User.objects.create_user(username='super2', password='x', is_superuser=True)

    def test_expired_auto_purgeable_item_is_deleted(self):
        role = Role.objects.create(name='ExpiredRole')
        role.is_deleted = True
        role.deleted_at = timezone.now() - timedelta(days=21)
        role.save()

        from apps.core.trash import purge_expired_trash
        purged = purge_expired_trash(entity_type='roles')

        self.assertEqual(purged, 1)
        self.assertFalse(Role.objects.filter(id=role.id).exists())

    def test_not_yet_expired_item_survives(self):
        role = Role.objects.create(name='FreshRole')
        role.is_deleted = True
        role.deleted_at = timezone.now() - timedelta(days=5)
        role.save()

        from apps.core.trash import purge_expired_trash
        purge_expired_trash(entity_type='roles')

        self.assertTrue(Role.objects.filter(id=role.id).exists())

    def test_class_stream_and_subject_never_auto_purge(self):
        subject = Subject.objects.create(code='HIST101', name='History')
        subject.is_deleted = True
        subject.deleted_at = timezone.now() - timedelta(days=100)
        subject.save()

        from apps.core.trash import purge_expired_trash
        purge_expired_trash()

        self.assertTrue(Subject.objects.filter(id=subject.id).exists())

    def test_management_command_runs(self):
        call_command('purge_expired_trash')
```

- [ ] **Step 4: Run the test**

Run: `python manage.py test school.tests.test_trash_purge_sweep -v 2`
Expected: PASS.

- [ ] **Step 5: Run `python manage.py check`**

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/core/trash.py apps/core/management/commands/purge_expired_trash.py school/tests/test_trash_purge_sweep.py
git commit -m "feat: implement 20-day auto-purge sweep and purge_expired_trash management command"
```

---

## Task 13: Frontend — Menu permission gating, Trash page, routing

**Files:**
- Modify: `frontend/src/components/Menu.tsx`
- Modify: `frontend/src/App.tsx`
- Create: `frontend/src/pages/admin/Trash.tsx`

**Interfaces:**
- Consumes: `GET /api/trash/<entity_type>/`, `POST /api/trash/<entity_type>/<id>/restore/`, `POST /api/trash/<entity_type>/<id>/purge/` from Task 11. `permissions: string[]` prop already passed into `<Menu>` (confirmed existing plumbing, `DashboardLayouts.tsx:31,46,183`).

- [ ] **Step 1: Add `requiredPermission` to `MenuItemDef` and gate the Trash entry**

In `frontend/src/components/Menu.tsx`, find the `MenuItemDef` interface (currently: `visible: Role[]`, `requiresClassTeacher?`, `requiresPathwayChoice?`, no permission field) and add:

```typescript
interface MenuItemDef {
  // ...existing fields unchanged...
  requiredPermission?: string;
}
```

Find the main filter (currently `section.items.filter(item => item.visible.includes(userRole) && !(item.requiresClassTeacher && userRole === 'teacher' && !isClassTeacher) && !(item.requiresPathwayChoice && userRole === 'student' && !requiresPathwayChoice))`) and extend it:

```typescript
section.items.filter(item =>
  item.visible.includes(userRole) &&
  !(item.requiresClassTeacher && userRole === 'teacher' && !isClassTeacher) &&
  !(item.requiresPathwayChoice && userRole === 'student' && !requiresPathwayChoice) &&
  (!item.requiredPermission || permissions.includes(item.requiredPermission))
)
```

Add a new menu item entry (in whichever section houses admin-only utility items — match the existing item shape used for other admin-only entries, e.g. Roles & Permissions):

```typescript
{ label: 'Trash', icon: Trash2, path: '/admin-dashboard/trash', visible: ['admin'], requiredPermission: 'trash.view' },
```

(Import `Trash2` from `lucide-react` alongside the file's other icon imports if not already imported. Match the exact object shape — additional fields like `path`/`icon` — used by neighboring admin-only menu entries already in the file; do not invent a different shape.)

- [ ] **Step 2: Write `frontend/src/pages/admin/Trash.tsx`**

```tsx
import { useEffect, useState } from 'react';
import axios from 'axios';
import { Trash2, RotateCcw, AlertTriangle } from 'lucide-react';

const ENTITY_TABS: { key: string; label: string }[] = [
  { key: 'users-students', label: 'Students' },
  { key: 'users-teachers', label: 'Teachers' },
  { key: 'users-parents', label: 'Parents' },
  { key: 'users-staff', label: 'Staff' },
  { key: 'class-streams', label: 'Class Streams' },
  { key: 'subjects', label: 'Subjects' },
  { key: 'leave-requests', label: 'Leave Requests' },
  { key: 'roles', label: 'Roles' },
  { key: 'events', label: 'Events' },
  { key: 'notices', label: 'Notices' },
  { key: 'assignments', label: 'Assignments' },
];

interface TrashRow {
  id: number;
  label: string;
  deleted_at: string | null;
  deleted_by: string | null;
  auto_purge: boolean;
  purge_at: string | null;
}

function daysLeft(purgeAt: string | null): string {
  if (!purgeAt) return 'Kept indefinitely — restore or delete manually';
  const diffMs = new Date(purgeAt).getTime() - Date.now();
  const days = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  return `${days} day${days === 1 ? '' : 's'} left`;
}

export default function Trash() {
  const [activeTab, setActiveTab] = useState(ENTITY_TABS[0].key);
  const [rows, setRows] = useState<TrashRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    axios.get(`/api/trash/${activeTab}/`, { withCredentials: true })
      .then(res => setRows(res.data.data))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [activeTab]);

  const restore = async (id: number) => {
    await axios.post(`/api/trash/${activeTab}/${id}/restore/`, {}, { withCredentials: true });
    setRows(rows.filter(r => r.id !== id));
  };

  const purge = async (id: number) => {
    if (!window.confirm('Permanently delete this item? This cannot be undone.')) return;
    await axios.post(`/api/trash/${activeTab}/${id}/purge/`, {}, { withCredentials: true });
    setRows(rows.filter(r => r.id !== id));
  };

  return (
    <div className="p-6 bg-slate-50 dark:bg-slate-950 min-h-screen">
      <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-4 flex items-center gap-2">
        <Trash2 className="w-6 h-6" /> Trash
      </h1>

      <div className="flex gap-2 mb-4 flex-wrap">
        {ENTITY_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-colors ${
              activeTab === tab.key
                ? 'bg-blue-600 text-white'
                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-700 overflow-hidden">
        {loading ? (
          <div className="p-6 text-slate-400 text-sm">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-slate-400 text-sm">Nothing in Trash for this category.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
              <tr>
                <th className="text-left px-4 py-2">Item</th>
                <th className="text-left px-4 py-2">Deleted by</th>
                <th className="text-left px-4 py-2">Status</th>
                <th className="text-right px-4 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id} className="border-t border-slate-100 dark:border-slate-700">
                  <td className="px-4 py-2 text-slate-800 dark:text-slate-100">{row.label}</td>
                  <td className="px-4 py-2 text-slate-500 dark:text-slate-400">{row.deleted_by ?? '—'}</td>
                  <td className="px-4 py-2 text-slate-500 dark:text-slate-400">
                    <span className="inline-flex items-center gap-1">
                      {!row.auto_purge && <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />}
                      {daysLeft(row.purge_at)}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right space-x-2">
                    <button onClick={() => restore(row.id)} className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 hover:text-emerald-700">
                      <RotateCcw className="w-3.5 h-3.5" /> Restore
                    </button>
                    <button onClick={() => purge(row.id)} className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 hover:text-red-700">
                      <Trash2 className="w-3.5 h-3.5" /> Delete Forever
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
```

(Confirm the existing axios call convention — base URL, whether `withCredentials` is set globally on a shared axios instance already, and the CSRF-token header pattern used elsewhere for `POST` calls, e.g. in `AddUserModal.tsx` or `NoticeFormModal` — before finalizing; match whatever pattern the rest of the admin dashboard already uses for POST requests rather than inventing a new one, since this project already has an established CSRF-token-header convention for mutating requests.)

- [ ] **Step 3: Register the route**

In `frontend/src/App.tsx`, find where other admin-dashboard pages are lazily imported and routed (e.g. the Roles & Permissions page) and add, matching the exact existing pattern for lazy-loaded admin routes:

```typescript
const Trash = lazy(() => import('./pages/admin/Trash'));
```

and, inside the admin dashboard's nested `<Route>` block:

```tsx
<Route path="trash" element={<Trash />} />
```

(Match whatever the existing admin routes actually look like — some may not be lazy-loaded; follow the file's real convention rather than assuming `lazy()` is used everywhere.)

- [ ] **Step 4: Manually verify in the browser**

Start the dev servers if not already running (`npm run dev` in `frontend/`, `python manage.py runserver` in the repo root — both per this project's existing dev workflow). Log in as a superuser, navigate to Trash, confirm all 11 tabs load (even if empty), confirm the Class Streams/Subjects rows (once something's trashed there) show "Kept indefinitely" instead of a countdown, and confirm Restore/Delete Forever both work end-to-end. Log in as a plain Admin without the `trash.view` permission and confirm the Trash menu item does not appear at all.

- [ ] **Step 5: Run `npx tsc -b`**

Expected: clean (no new TypeScript errors beyond the pre-existing baseline).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/Menu.tsx frontend/src/App.tsx frontend/src/pages/admin/Trash.tsx
git commit -m "feat: add Trash page and permission-gated menu item"
```

---

## Post-implementation note for the user

Every task with a "Checkpoint" step paused for a manual `makemigrations`/`migrate` — by the end of Task 13, the following apps have pending migrations that must all be applied for the feature to work end-to-end: `academics` (ClassStream, Subject), `identity` (Student/Teacher/Parent/StaffExtra, Role), `staff` (TeacherLeave), `messaging` (Event, Notice), `assignments` (Assignment). If any checkpoint was skipped or deferred, running the full test suite (`python manage.py test school.tests -v 2`) will surface exactly which app's migration is still missing via "no such column" errors.
