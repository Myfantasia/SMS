# Trash / Soft-Delete System

Status: Draft — pending user review
Date: 2026-08-18

## Background

Today, "delete" across this system means a real, immediate `.delete()` call — for
User accounts, Class Streams, Subjects, Leave Requests, Roles, Events, Notices,
and Assignments alike. There is no undo. The user asked for a Trash feature so
any of these deletions becomes recoverable for a window before it's truly gone,
visible to the Django superuser and to regular admins who hold a new, explicitly
granted permission (not automatic just from being Admin), with items permanently
auto-purged 20 days after being trashed — including their uploaded files, which
Django never cleans up on its own.

Two research passes this session materially shaped the design:

1. **Cascade blast-radius check.** `ClassStream` and `Subject` are `CASCADE`-referenced
   from many unrelated modules (allocations, attendance, assignments, exams,
   results, timetable). Deleting either one today silently destroys attendance
   sessions, assignments, exam results, and timetable data belonging to *other*
   students and teachers who were never part of the delete action — not just the
   deleted item's own history. `api_delete_subject` currently has **zero** guard
   rails against this (`school/views/subject_views.py:483-491`) — a pre-existing
   bug this work incidentally fixes.
2. **User-account purge check.** Purging a trashed Student/Teacher after 20 days
   cascades into `AttendanceRecord`, `StudentSubmission`, `ExamResult`,
   `StudentTermResult`, `TeacherLeave`, `SubjectAllocation`, `LessonAllocation`,
   etc. — but this is that *same person's own* history, not someone else's. This
   is the expected, self-contained shape of "empty the trash," not the
   cross-entity risk found for Class Stream/Subject, so Users are fine for the
   normal 20-day auto-purge.

This produces one real exception to an otherwise uniform design: **Class Stream
and Subject never auto-purge.** Everything else does.

## Architecture: soft-delete in place, no snapshot ledger

Earlier in this design process a generic `ContentType` + `GenericForeignKey` +
JSON-snapshot "Trash ledger" was considered (hard-delete immediately, restore by
replaying a JSON blob). It's rejected: restoring `Assignment` from a snapshot
would mean recreating `AssignmentGroup`/`Question`/`QuestionOption`/
`StudentSubmission`/etc. rows with new primary keys and re-wiring every
relationship by hand — fragile, and a real risk of silent data loss on restore.

Instead, every trashable entity keeps its row in the database, flagged rather
than deleted, mirroring the one soft-delete pattern already in this codebase
(`ClassStream.is_deleted`, `apps/academics/models.py:265-337`). Restore is then
just flipping the flag back — lossless by construction, no reconstruction logic
needed for any entity, including Assignment's subtree.

### Per-entity fields

| Entity | New/reused flag | New fields |
|---|---|---|
| `ClassStream` | `is_deleted` (existing) | `deleted_at`, `deleted_by` |
| `Subject` | `is_deleted` (new) | `deleted_at`, `deleted_by` |
| `StudentExtra` / `TeacherExtra` / `ParentExtra` / `StaffExtra` | `user.is_active = False` (existing Django field, already used this way — see below) | `deleted_at`, `deleted_by` (one pair per Extra model) |
| `TeacherLeave` | `is_deleted` (new) | `deleted_at`, `deleted_by` |
| `Role` | `is_deleted` (new) | `deleted_at`, `deleted_by` |
| `Event` | `is_deleted` (new) | `deleted_at`, `deleted_by` |
| `Notice` | `is_deleted` (new) | `deleted_at`, `deleted_by` |
| `Assignment` | `is_deleted` (new) | `deleted_at`, `deleted_by` |

`deleted_by` is a `ForeignKey(User, null=True, on_delete=SET_NULL)` on every
entity, matching `SystemAuditLog.operator`'s existing convention.

**Reusing `user.is_active` for trashed accounts is not a new idea in this
codebase** — `school/views/class_views.py:677` already flips
`student.user.is_active = True` as part of an existing "reactivate" action, and
Django's default auth backend already rejects login for `is_active=False` users.
Trashing a user account this way gets a real security property for free: a
trashed account can't be used to log in during its 20-day grace window, without
inventing a new field or a new auth check. `enrollment_state` (Active/Suspended/
Transferred/Graduated) is untouched by this — it's a different, existing concept
and this doesn't overload it.

### Why Class Stream and Subject never auto-purge

For every other entity, "empty the trash after 20 days" only destroys the
trashed thing's own history. For Class Stream and Subject, permanently deleting
one reaches into other people's unrelated records. So both:

- Get restore, exactly like every other entity.
- **Never** enter the 20-day auto-purge sweep — they stay in Trash indefinitely.
- Can only be permanently removed by an explicit manual action (same
  `trash.manage` permission, no extra tier), behind a frontend confirmation
  dialog that says plainly what else it will destroy. Backend requires no
  special flag beyond the same permission check — the friction is intentionally
  in the UI, not a second server-side gate, per YAGNI.

## Permissions

Two new codes in `school/management/commands/seed_rbac.py`'s `PERMISSIONS`
catalog, under a new `'Trash'` module:

```python
('trash.view', 'View the Trash (soft-deleted items across all modules)', 'Trash'),
('trash.manage', 'Restore or permanently delete items in the Trash', 'Trash'),
```

Superusers already bypass all permission checks (`get_user_permission_codes()`'s
existing `if user.is_superuser: return frozenset(...)` shortcut) — no change
needed there.

**Carve-out needed:** today, `admin_role.permissions.set(Permission.objects.all())`
(`seed_rbac.py:144`) means every new permission code auto-flows to every Admin,
unconditionally. The user explicitly asked for Trash to be "admin *with the
trash permission*" — a deliberate grant, not automatic. This line changes to
`Permission.objects.exclude(code__startswith='trash.')`, so Trash is the one
module an Admin has to be handed explicitly via Roles & Permissions, same as any
custom role. This is the only carve-out in the whole permission catalog — worth
flagging in the migration plan/PR description since it's a one-line change with
an easy-to-miss effect (a fresh `seed_rbac` run silently stops granting Trash to
Admins that already had it, unless they were granted it as an individual
role-permission edit — which is the intended behavior, but worth a heads-up).

## API surface

- `GET /api/trash/<entity_type>/` — list soft-deleted rows for one entity type
  (`users`, `class-streams`, `subjects`, `leave-requests`, `roles`, `events`,
  `notices`, `assignments`). One tab per type on the frontend rather than a
  merged cross-model feed — simpler pagination/sorting, and matches how the rest
  of the admin UI is already organized by module. Runs the lazy purge sweep
  (below) first, so an expired row never shows up as "still restorable" only to
   404 a second later.
- `POST /api/trash/<entity_type>/<id>/restore/` — flips the flag back, clears
  `deleted_at`/`deleted_by`, writes a `RESTORE` audit log entry (the action type
  already exists in `SystemAuditLog.ACTION_CHOICES` — this is its first real
  caller).
- `POST /api/trash/<entity_type>/<id>/purge/` — permanent delete. Auto-purgeable
  types also reach this via the sweep; Class Stream/Subject only reach it via
  this manual endpoint. Runs file cleanup (below) then the real `.delete()`.

All three gated by `trash.view` (list) / `trash.manage` (restore, purge).

## Auto-purge mechanism

No Celery Beat / cron infra exists in this repo (confirmed — same finding the
sibling promotion-system spec already documents). Two-pronged, matching that
spec's own precedent:

1. **Lazy sweep on page load** — every `GET /api/trash/<entity_type>/` call
   purges that type's own expired rows first (`deleted_at <= now - 20 days`,
   auto-purgeable types only). Self-healing, zero new infra.
2. **Management command** `python manage.py purge_expired_trash` — runs the same
   sweep across all auto-purgeable types in one pass. Lets the user wire up an
   external cron later for a true "always within 20 days, whether or not anyone
   opens the page" guarantee, without this feature depending on that existing.

Both call one shared function, e.g. `purge_expired_trash(entity_type=None)` in
a new `apps/core/services.py` addition — single source of truth, so the sweep
and the command can never drift.

## File cleanup on purge

Django never deletes a `FileField`/`ImageField`'s underlying file when a row is
deleted — confirmed gap. Every purge path explicitly calls
`<field>.delete(save=False)` before the row goes:

- `StudentExtra` / `TeacherExtra` / `StaffExtra` — `profile_pic`.
- `Notice` — `attachment`.
- `Assignment` subtree (must walk before the row's `CASCADE` fires, since
  cascade only removes DB rows, never storage): `Assignment.teacher_attachment`,
  each `AssignmentAttachment.file`, each `StudentSubmission.student_attachment`
  and `.teacher_returned_file`, each `StudentAnswer.uploaded_file`.

## Scope boundaries (what does *not* route through Trash)

Two existing hard-delete call sites are deliberately left as real deletes,
since neither has any history worth protecting:

- **Rejecting a pending signup** (`api_process_approval`'s `reject` branch,
  `school/views/views.py:~934`) — this account was never approved/active; there's
  nothing to restore. Only `api_delete_user` (deleting an existing, approved
  account) routes through Trash.
- **A teacher cancelling their own pending leave request**
  (`leave_views.py`'s `perform_destroy`, the non-`_can_edit_broadly` branch) —
  this is a self-service withdrawal of a request nobody has decided on yet, not
  an admin removing a record. Only the admin-initiated delete branch
  (`_can_edit_broadly(user) == True`) routes through Trash.

## Call sites to change

| File | Current behavior | Change |
|---|---|---|
| `school/views/views.py:774` `api_delete_user` | `obj.user.delete()` | Soft-delete: `is_active=False` + `deleted_at`/`deleted_by` on the Extra row |
| `school/views/subject_views.py:483-491` `api_delete_subject` | bare `subject.delete()`, no guards | Soft-delete; incidentally fixes the existing no-guard-rails bug |
| `apps/academics/models.py` `ClassStream.soft_delete()` | already soft-deletes, no restore | Add `deleted_at`/`deleted_by` + a new `restore()` method |
| `school/views/leave_views.py:158-175` `perform_destroy` | hard delete, both branches | Soft-delete only on the `_can_edit_broadly` (admin) branch |
| `school/views/rbac_views.py:97-116` `RoleViewSet.perform_destroy` | `instance.delete()` | Soft-delete |
| `school/views/attendance_views.py` `EventViewSet` / `NoticeViewSet` | no `perform_destroy` override → DRF's raw delete | Add `perform_destroy` on each: soft-delete + audit log |
| `school/views/assignment_teacher_views.py:468-477` `delete()` | `assignment.delete()` | Soft-delete |

**Read-side filtering is the largest single piece of work here and is
explicitly a plan-level task, not decided in this spec**: every existing query
against these 8 models needs to stop returning trashed rows. The default
manager stays "all rows" (least surprising, and Trash's own list view needs
exactly that), with a `live` manager added per model (matching
`ClassStream.live` already) — the implementation plan must grep each model name
across `apps/` and `school/views/` and switch every user-facing list/detail
query to it. For Users specifically this also means adding
`user__is_active=True` to the existing directory/pending-approval queries,
since `status` (pending-approval) and `is_active` (trashed) are different flags
today.

## Frontend

- New `Trash.tsx` page, tabbed by entity type, each row showing label,
  `deleted_at`, `deleted_by`, and either a "N days left" countdown or "Kept
  indefinitely — restore or delete manually" for Class Stream/Subject rows.
  Restore and (permanent) Delete buttons, both gated the same way the backend
  is.
- New Trash item in `Menu.tsx`, visible only when the resolved permission list
  includes `trash.view`. `MenuItemDef` currently has no permission-gating field
  for the admin/teacher/student/parent menus (only `StaffMenuItemDef` does,
  `permission: string`) — add an equivalent optional `requiredPermission?:
  string` to `MenuItemDef` and extend the existing filter
  (`Menu.tsx:239-242`) with `&& (!item.requiredPermission ||
  permissions.includes(item.requiredPermission))`. No new plumbing needed
  beyond that: `permissions` is already fetched once and passed to `<Menu>` for
  every role (`DashboardLayouts.tsx:31,46,183`).
- **No change to any existing "Delete" button's UX** — every delete action
  across the app looks and behaves the same from the user's perspective. The
  only difference is that it's now reversible from Trash instead of being
  final, which is the entire point of this feature.

## Explicitly out of scope

- Exam Results — confirmed no delete endpoint exists anywhere for it today, so
  there is nothing to migrate.
- Departments — user was asked directly and did not include it in scope.
- A true scheduled/cron-triggered purge — the management command exists for the
  user to wire up externally later; this feature doesn't assume Celery Beat.
- Any change to `enrollment_state` semantics (Active/Suspended/Transferred/
  Graduated) — untouched, orthogonal to the new `is_active`-as-trash-flag use.

## Verification

- `python manage.py check` clean after all model field additions (migrations
  run by the user, not by this work, per standing project convention).
- Each of the 8 delete call sites: trash it, confirm it disappears from its
  normal list view, confirm it appears in the matching Trash tab, restore it,
  confirm it reappears in the normal list view unchanged.
- Assignment purge specifically: confirm all 5 file-field locations actually
  remove their files from storage, not just their DB rows.
- Class Stream / Subject: confirm trashing one does *not* auto-purge after
  manipulating `deleted_at` into the past + running the sweep — only the manual
  purge endpoint should remove them.
- Permission carve-out: confirm a fresh `seed_rbac` run does *not* grant
  `trash.*` to the Admin role, and that a superuser can still reach `/api/trash/`
  regardless.
- `npx tsc -b` clean.
