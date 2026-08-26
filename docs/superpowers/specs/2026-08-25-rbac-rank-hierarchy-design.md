# RBAC Rank Hierarchy, Scope & Audit System

Status: Draft — pending user review
Date: 2026-08-25

## Background

The system today has two authority layers that don't know about each other, and
neither has a sense of seniority.

`is_superuser` bypasses everything, by design — `get_user_permission_codes()`
(`apps/identity/services.py:150-171`) short-circuits it to every `Permission.code`
in the system. Below that, `IsApprovedAdmin`
(`school/permissions.py:11-28`) grants full access to `RoleViewSet` and
`UserRoleAssignmentAPIView` (`school/views/rbac_views.py`) to anyone who is a
superuser, `is_staff`, or a member of the `ADMIN` Django Group — a coarse,
all-or-nothing gate that sits *outside* the RBAC model it protects. Below that,
`Role` is fully flat: no field distinguishes a Principal-equivalent role from a
Class Teacher-equivalent one. Any actor who clears `IsApprovedAdmin` can today
edit any `Role`'s permission set (including granting itself codes it doesn't
hold), assign any role to any user, or delete a role out from under its holders
— the only existing guard rail is a narrow self-lockout check in
`UserRoleAssignmentAPIView.delete` (`rbac_views.py:187-198`) that stops a user
removing their own *last* role.

Two more gaps compound this: permissions are module-level only (`exams.marks`
means "can enter marks," not "can enter marks for *this* class"), and
`SystemAuditLog` (`apps/core/models.py:50-82`) only ever hears about writes —
sensitive reads (a student's full profile, exam results, finance records) leave
no trail at all.

This spec closes all of it in five phases: a rank hierarchy with two
independent delegation guards, scope checks tied to real teaching data,
correctly-seeded hierarchy roles across the right Django Groups, a
permission-aware frontend nav everywhere the Staff dashboard already has one,
and a widened audit trail. It supersedes and formalizes the informal design
discussed earlier this session (published as the *Rank & Ledger* artifact) —
this document is the version of record.

## Guiding principle: two independent guards, both required

**Guard 1 — rank gate.** A non-superuser may create, update, delete, assign, or
remove a `Role` only when `target_role.rank > actor_effective_rank`. Lower
number outranks higher. This alone stops cross-rank and same-rank tampering,
including self-promotion, but says nothing about *what* the role grants.

**Guard 2 — no-escalation (permission containment).** Whenever a `Role`'s
permission set is written (create, or update including partial updates), every
`Permission.code` in it must already be present in the actor's own
`get_user_permission_codes()`. This alone stops handing out permissions the
actor doesn't hold, but says nothing about seniority — without Guard 1, two
peers holding the same permission set could still reassign each other's roles.

Both run on every mutation. Superusers bypass both, unconditionally.

```
Actor
 │
 ▼
Superuser? ──Yes──▶ Allow
 │No
 ▼
target_role.rank > actor_effective_rank? ──No──▶ 403
 │Yes
 ▼
target_role.permissions ⊆ actor_permissions? ──No──▶ 403
 │Yes
 ▼
Allow
```

## Entry gate: how actors reach Role management at all

`IsApprovedAdmin` checks ADMIN-group membership, not any RBAC permission —
which means a rank-3 Senior Teacher delegated authority over rank-4+ roles has
no way to reach `RoleViewSet`/`UserRoleAssignmentAPIView` today, since nothing
short of ADMIN-group membership gets them past the current permission class.

**Decision:** add a new permission code, `rbac.manage` (module `RBAC`), to the
seeded catalog in `seed_rbac.py`. Because the `Admin` system role already
receives every non-`trash.*` code automatically
(`admin_role.permissions.set(Permission.objects.exclude(code__startswith='trash.'))`,
`seed_rbac.py:149`), it picks up `rbac.manage` with no extra seed code. Change
`RoleViewSet` and `UserRoleAssignmentAPIView`'s `permission_classes` from
`[IsApprovedAdmin]` to a composite that allows either `IsApprovedAdmin`
(unchanged — preserves existing ADMIN-group bootstrap access) **or** holding
`rbac.manage` via `HasModulePermission`. This is additive: nobody who has
access today loses it, and a Senior Teacher who is later delegated
`rbac.manage` through the normal Role-editing flow (subject to Guard 2 — the
delegator must hold `rbac.manage` themselves) gains a path in without being
added to ADMIN. Guards 1 and 2 apply identically regardless of which half of
the OR let the actor through.

## Data model changes

### `Role.rank`

```python
# apps/identity/models.py — Role
rank = models.PositiveSmallIntegerField(
    null=True, blank=True,
    help_text="Delegation tier. Lower ranks outrank higher ones. "
              "Null means unranked — cannot be granted or managed by anyone "
              "except a superuser.",
)
```

Nullable rather than defaulted, deliberately: every *existing* custom Role in
this codebase (the 16 seeded by `populate_demo_staff.py`, plus any admin has
hand-created) has no rank today, and a non-null default would silently assign
them a real delegation tier no one chose. Null is treated by the rank guard as
"cannot be managed by a non-superuser" (fails the `>` comparison against any
real actor rank) — it fails closed, not open. Seeding (Phase 3) assigns real
ranks to the hierarchy roles explicitly; any role an admin created that isn't
part of the seeded hierarchy stays null until an admin (or a future migration)
gives it one.

Migration: new file in `apps/identity/migrations/`, next number `0006_*`, app
label `identity`. **Not run by this work** — see Migration Instructions below.

### `Role.school` — multi-tenancy readiness, structural only

The system runs one school today, but per explicit direction this round, `Role`
should be built "configuration as data" the same way `CurriculumPreset` already
was (`apps/academics/models.py:678-682`, "first entity in the multi-tenancy
rollout," decided 2026-08-13) — not deferred until a second school shows up.
This mirrors that precedent exactly, field-for-field and migration-for-migration:

```python
# apps/identity/models.py — Role
school = models.ForeignKey(
    'identity.School', on_delete=models.PROTECT, related_name='roles',
)
```

```python
# Role.Meta
unique_together = [('name', 'school')]  # replaces the current bare unique=True on name
```

Two migrations, same shape as `CurriculumPreset`'s `0004`/`0005`:

1. Add `school` **nullable** first + `unique_together`.
2. A backfill command (`backfill_role_school`, mirroring
   `backfill_curriculum_preset_school.py`) assigns every existing `Role` to
   the one `School` row already in the database — that row already exists,
   since `CurriculumPreset`'s own backfill required it and is already applied.
3. A second migration makes `school` non-nullable, matching
   `0005_curriculumpreset_school_required.py`'s two-step pattern.

`RoleViewSet`'s queryset gains `.filter(school_id=get_current_school_id(request))`,
and `perform_create` sets `school` server-side from the same call — never from
client input, matching the existing rule for `CurriculumPreset`. `UserRole`
gets no new field: it's transitively scoped through `role.school_id`, so a
second `school` FK on the assignment row itself would just be redundant data
that could drift out of sync with its own `role`.

**What this does and doesn't buy right now:** structurally, `Role` becomes
exactly as tenant-ready as `CurriculumPreset` already is. It does **not**
turn on real cross-school enforcement, because `get_current_school_id()`
(`apps/identity/services.py:201-222`) is still the same one-school shim
`CurriculumPreset` itself relies on today — no profile model links a user to
a school yet, so there's no per-user school to derive. That's a separate,
larger, identity-wide project (already blocking full multi-school use of
Curriculum Hub too), explicitly not part of this work — see "Explicitly out
of scope" below. What changes today is purely structural: the schema and
queryset shape are in place so that the moment user↔school linking lands,
`Role` starts behaving per-school with no further migration on this model.

`Permission` is **not** scoped — it stays a global catalog of what a
permission code *means* (`finance.view`, `exams.marks`, …), the same status
`Curriculum`/`Pathway`/`Track` already have as "national structures shared by
every school, not per-school config." Only `Role` — the school's own naming
and bundling of those codes into a hierarchy — is the configurable surface,
exactly matching how `CurriculumPreset` (a school's own config) is scoped
while `Curriculum`/`Pathway`/`Track` underneath it are not.

Migration: new files in `apps/identity/migrations/`, following `0006_*`
(the `rank` migration above), app label `identity`. **Not run by this work.**

### `Department.head`

```python
# apps/academics/models.py — Department
head = models.ForeignKey(
    'identity.TeacherExtra', on_delete=models.SET_NULL,
    null=True, blank=True, related_name='headed_departments',
)
```

Note on what `Department` means in this codebase: it's `curriculum`-scoped
(`unique_together=[('name','curriculum'), ('code','curriculum')]`) — a subject
grouping within a `Curriculum`, not an HR org-chart department. That's the
correct target for HOD scope anyway: "Head of Department" in the real school
hierarchy governs a subject department (e.g. Sciences, Languages), which is
exactly what this model represents. No redefinition needed, just the new FK.

Migration: new file in `apps/academics/migrations/`, next number `0010_*`, app
label `academics`. **Not run by this work.**

## Effective rank

One function, reused everywhere a rank comparison is needed — no rank math
duplicated in any view.

```python
# apps/identity/services.py
def get_user_effective_rank(user) -> int | None:
    """
    -1            → superuser (outranks every real rank; never stored)
    None          → user holds no ranked role (least privileged; fails every
                    rank-guard comparison for a non-superuser actor)
    int >= 1      → MIN(rank) across the user's UserRole → Role rows that
                    have a non-null rank
    """
    if user.is_superuser:
        return -1
    ranks = Role.objects.filter(
        user_assignments__user=user, rank__isnull=False,
    ).values_list('rank', flat=True)
    return min(ranks) if ranks else None
```

A user holding both a rank-5 Subject Teacher role and a rank-4 Class Teacher
role operates at rank 4 — their most senior available tier, matching how the
role actually works in a real school (a Class Teacher who also teaches a
subject doesn't lose the Class Teacher authority).

## Permission containment service

```python
# apps/identity/services.py
def validate_permission_delegation(actor, permission_codes: set[str]) -> None:
    if actor.is_superuser:
        return
    actor_codes = get_user_permission_codes(actor.id)
    illegal = set(permission_codes) - actor_codes
    if illegal:
        raise PermissionDenied(
            "You cannot delegate permissions you do not possess: "
            + ", ".join(sorted(illegal))
        )
```

Raises DRF's `PermissionDenied` (→ 403 with the message above, not a 500) so
`RoleViewSet.perform_create`/`perform_update` can call it directly without
each view re-deriving the diff.

## Rank guard service

```python
# apps/identity/services.py
def validate_rank_authority(actor, target_role) -> None:
    if actor.is_superuser:
        return
    if target_role.rank is None:
        raise PermissionDenied("This role has no assigned rank and cannot be "
                                "managed except by a superuser.")
    actor_rank = get_user_effective_rank(actor)
    if actor_rank is None or target_role.rank <= actor_rank:
        raise PermissionDenied("You cannot manage a role at or above your own rank.")
```

Called from every `RoleViewSet` mutation and from
`UserRoleAssignmentAPIView.post`/`delete`, against the **role being touched**.
For `perform_update`, called twice when `rank` is part of the payload — once
against `instance.rank` (the role's rank *before* the edit, so a rank-5 actor
can't touch a rank-3 role even to "fix" it) and once against the proposed new
`rank` (so that same actor can't take a rank-6 role they're allowed to touch
and promote it to rank-1). Both must pass. `validate_permission_delegation` is
called separately against the role's post-edit permission set in the same
request.

## Rank hierarchy

Grounded in the actual permission catalog (`seed_rbac.py:17-75` — 39 codes,
15 modules) rather than the illustrative codes in earlier discussion. Notably,
this catalog has **`finance.view` only** (no `finance.edit` exists), and
enrollment is `classes.enrollment`, not a standalone `enrollment.view`. Gaps
are left between tiers on purpose, so a future role can be inserted without
renumbering anything below it.

| Rank | Role | Maps to | Permission set (illustrative — exact grants finalized at seed time) |
|---|---|---|---|
| *implicit* | Super Admin | `is_superuser` | Every code, both guards bypassed. Never a `Role` row. |
| 1 | Principal | existing **`Admin`** system role | All 37 non-`trash.*` codes (unchanged — `seed_rbac.py:149`) |
| 2 | Deputy Principal (Academics / Administration) | new custom role | Broad academic + operational subset: `classes.*`, `attendance.*`, `results.*`, `exams.view/edit`, `timetable.view`, `allocations.view` |
| 3 | Senior Teacher, Dean of Students, Registrar, Bursar | new custom roles, **peers** | Domain-specific: Registrar → `classes.enrollment`, `classes.view`; Bursar → `finance.view`; Dean → `attendance.*`, `leave.approve`; Senior Teacher → `results.view`, `exams.view` |
| 4 | Head of Department, Class Teacher | new custom roles, **peers**, scope-restricted | `results.edit`, `exams.marks`, `attendance.edit` — gated further by Phase 2 scope checks, not module permission alone |
| 5 | Subject Teacher | existing **`Teacher`** system role | Unchanged fixed list (`seed_rbac.py:79-94`) |
| 6+ | Non-teaching staff (Secretary, Librarian, Finance Officer, HR Officer, Nurse, ICT Technician, Security, …) | existing custom roles from `populate_demo_staff.py`, corrected | Unchanged per-role — rank 6 governs delegation ceiling, not capability; staff roles keep their differentiated permission sets exactly as seeded today |

Peers at the same rank number (3, and 4) cannot manage each other — Guard 1 is
a strict `>`, so equal rank always fails.

### Primary school mapping

Same numbers, no second hierarchy table, rank 4 simply unused:

| Rank | Secondary | Primary |
|---|---|---|
| 1 | Principal | Headteacher |
| 2 | Deputy Principal | Deputy Headteacher I / II |
| 3 | Senior Teacher / Dean / Registrar / Bursar | Senior Teacher |
| 4 | Head of Department / Class Teacher | *unused* |
| 5 | Subject Teacher | Class Teacher / Subject Teacher |

## Teaching track vs. staff track

`populate_demo_staff.py` currently seeds **Deputy Principal** and **Head of
Department** into the `STAFF` Django Group (`populate_demo_staff.py:24-25,81`).
That's wrong: both are teaching-hierarchy positions that still need
mark-entry, class-register, and other tools gated behind `TEACHER`-group
membership, not `STAFF`. Phase 3 corrects this:

- **Ranks 1–5** (Principal, Deputy Principal, Senior Teacher, Dean, Registrar,
  Bursar, HOD, Class Teacher, Subject Teacher) stay in / move into `TEACHER`.
  Their elevated authority comes from the RBAC `Role` layered on top, not from
  a different Group.
- **Rank 6+** (genuinely non-teaching staff) stay in `STAFF`, exactly as
  today.

Layer summary, unchanged in kind, now precise in practice:

```
Django Group  → broad application track (which dashboard/tools you get)
RBAC Role     → capabilities (which permission codes you hold)
Rank          → delegation authority (who can manage whose role)
Scope         → data boundary (which rows those capabilities apply to)
```

This is also why Phase 4's permission-aware nav has to reach the **Teacher**
dashboard, not just Staff: today only the Staff dashboard's nav reads a live
`permissions[]` array (`Menu.tsx:155-156`); an elevated Deputy Principal role
has nothing to visibly change until Teacher's nav becomes permission-aware
too.

## Scoped permissions (Phase 2 — Option A: derive from real data)

Module permissions answer "can this user act on marks at all." They don't
answer "for *this* class." The existing pattern for this is
`is_class_teacher_of_student(user, student)`
(`apps/identity/services.py:110-116`, thin wrapper in `school/rbac.py:99-103`)
— a plain boolean checked against `ClassStream.class_teacher_id`, called
inline as `_is_admin(user) or is_class_teacher_of_student(user, student)` at
each guarded view. Two more functions extend the same pattern; no new model,
no migration beyond `Department.head` above, and scope can never drift from
real assignments because it *is* the real assignment.

```python
# apps/identity/services.py
def teacher_is_allocated_to(user, class_stream, subject) -> bool:
    """True if `user` is the active, current-term SubjectAllocation teacher
    for this class stream + subject."""
    teacher = TeacherExtra.objects.filter(user=user).first()
    if not teacher:
        return False
    return SubjectAllocation.objects.filter(
        teacher=teacher, classroom=class_stream, subject=subject,
        is_active=True,
    ).exists()

def is_hod_of_subject_department(user, subject, curriculum, tier=None) -> bool:
    """True if `user` is the Department.head for `subject`'s effective
    department under this curriculum/tier."""
    teacher = TeacherExtra.objects.filter(user=user).first()
    if not teacher:
        return False
    department = get_effective_department(subject, curriculum, tier)
    return bool(department and department.head_id == teacher.id)
```

Deliberately reuses `get_effective_department(subject, curriculum, tier)`
(`apps/academics/models.py:569`) rather than reading `subject.department`
directly — `Subject.department` is a flat fallback FK, but a subject's real
department can be overridden per-curriculum via
`SubjectCurriculumProfile.department` (e.g. a subject grouped under Sciences
in CBC but Technical in 8-4-4). Using the flat field would resolve the wrong
HOD in a school running both curricula, exactly the kind of drift Option A is
meant to avoid.

Both get a `school/rbac.py` thin wrapper matching the existing
`is_class_teacher_of_student` convention, and are called **in addition to**,
never instead of, `HasModulePermission`/`require_permission`:

```python
require_permission(user, "exams.marks")       # can the user enter marks at all
teacher_is_allocated_to(user, class_stream, subject)  # can they enter marks HERE
```

Both must pass. A 403 from the scope check reads distinctly from a 403 from
the module check (see Error Handling below) so failures stay diagnosable.

**Deferred, not built now:** a generic `ScopedGrant` model (`user`,
`permission_or_role`, `scope_type`, `scope_id`, `expires_at`) for scope with no
natural backing row — an acting HOD, a temporary class cover. Real
assignments stay the source of truth for every case Phase 2 actually needs;
`ScopedGrant` is an explicitly planned future addition on top of this, not a
replacement.

## Permission-aware navigation (Phase 4)

`Menu.tsx` currently branches by `userRole`. For `admin`/`teacher`, items come
from a static array filtered by a hardcoded `visible: Role[]` list
(`Menu.tsx:82-150,242-247`) — only one item (`Trash`, gated on `trash.view`)
is actually permission-driven. For `staff`, every item already carries a
single `permission: string` and the whole list is filtered live against the
`permissions[]` array the layout already fetches (`Menu.tsx:60-80,155-156`,
comment at `Menu.tsx:55-59` explaining exactly why).

Phase 4 extends the Staff pattern to Admin and Teacher: each static item in
`menuItems` gains a `requiredPermission` (many already have this field wired,
just not populated — `RolesPermissions.tsx`'s own `Trash` entry proves the
mechanism works), and the filter becomes permission-first rather than
role-first. This is UX only — every one of these routes must already be
independently protected server-side by `HasModulePermission`/
`require_permission`/scope checks; hiding a nav item never substitutes for
that.

Concretely: a Subject Teacher (rank 5, module perms only) sees *My Classes /
Attendance / Marks / Assignments*. A Head of Department (rank 4, same module
perms plus whatever HOD-specific codes their role grants) additionally sees
*Department Results*. This must fall out of the permission set the HOD role
actually holds, not a hardcoded check for the string `"Head of Department"`.

## Audit trail widening (Phase 5)

`SystemAuditLog` (`apps/core/models.py:50-82`) is append-only and already
covers writes via `write_audit_log()` (`apps/core/services.py:60-84`) — role
mutations, password resets, 2FA events. It's never called on a *read*. A
permitted-but-unusual read (a Bursar opening one specific student's full
profile off-hours) is invisible today even though it's exactly the access
pattern worth detecting, not just preventing.

Phase 5 adds `write_audit_log(module=..., action_type='READ', ...)` calls (a
new `READ` value added to `SystemAuditLog.action_type`'s choices) to three
sensitive GET surfaces: finance record views (`apps/finance/views.py`), exam
marks/results views (`results_views.py`, `exams_views.py`), and a student's
full profile view (`subject_views.py`). No schema change beyond the new
choice value. Scope is deliberately narrow — not every GET, just these three
surfaces — so the log stays a signal, not noise.

The frontend already has a partial audit view:
`RolesPermissions.tsx` fetches `/api/timetable/audit-logs/?module=RBAC`
inline on the Roles page. Phase 5 doesn't rebuild this; it broadens what
`module` values exist to query (the new read-logging surfaces) and, if the
existing embedded view proves too narrow once those are live, promotes it to
a standalone page under the same `audit.view` permission it already implies.

## Error handling

Every guard raises DRF's `PermissionDenied` → 403, never a bare exception that
surfaces as 500. Messages are specific enough to self-diagnose without leaking
what the actor doesn't already know:

- `"You cannot manage a role at or above your own rank."`
- `"You cannot delegate permissions you do not possess: <codes>"`
- `"You are not authorized to act on this class."` (scope failure — deliberately
  distinct wording from the module-permission failure so the two are
  distinguishable in logs and in the UI)

## Transaction safety

`RoleViewSet.perform_create`/`perform_update` and
`UserRoleAssignmentAPIView.post`/`delete` wrap the guard checks, the model
mutation, and the `write_audit_log()` call in a single
`transaction.atomic()` block — a failed audit write must not leave a role
half-created, and a failed guard must not leave a partial permission set
persisted.

## Seed data (Phase 3)

`seed_rbac.py` gains: the `rbac.manage` permission code; `rank` values for the
existing `Admin` (1) and `Teacher` (5) system roles; `rank`/permission
definitions for the six new hierarchy roles (Deputy Principal, Senior Teacher,
Dean of Students, Registrar, Bursar, Head of Department, Class Teacher — seven,
matching the table above); and `school=get_current_school_id(request=None)`
(or the equivalent direct `School.objects.get()` a management command can use
without a request object) on every `Role.get_or_create`/`update_or_create`
call, now that `school` is required. Existing idempotency conventions are
otherwise unchanged.

`populate_demo_staff.py`'s `STAFF` list is corrected: `deborah.deputy` and
`michael.hod` move from the `STAFF` group into `TEACHER`
(`staff_group.user_set.add(user)` at line 94 becomes conditional on the
role's rank tier), and their `ROLES` entries pick up the new ranks from
`seed_rbac.py` rather than being defined ad hoc in this file.

## Testing (Phase 1–5, following existing conventions)

The existing RBAC test files (`school/tests/test_rbac_admin_teacher.py`,
`test_rbac_caching.py`) use plain `django.test.TestCase`, `force_login()` +
`reverse()`, `cache.clear()` in every `setUp`, and manual
`Permission.objects.create`/`Role.objects.create`/`UserRole.objects.create` —
no factory library, no DRF `APITestCase`. New tests follow the same
convention rather than introducing one.

**Rank guard, per actor tier** (superuser, Principal/rank-1, Deputy/rank-2,
Senior Teacher/rank-3, Teacher/rank-5): manage-own-rank-or-above fails,
manage-strictly-below succeeds, cross-peer (rank-3 vs rank-3) fails.

**Self-promotion:** actor attempts to assign themselves a role ranked at or
above their effective rank → 403.

**Permission escalation:** actor lacking `finance.view` attempts to create/
update a role containing `finance.view` → 403, exact message asserted.

**Rank-via-edit escalation:** actor manages a rank-6 role they're entitled to,
attempts to change its `rank` to 1 in the same request → 403 (validated
against both old and new rank per the Rank Guard Service section above).

**Scope:** teacher holds `exams.marks` and is allocated to Math/Class A via
`SubjectAllocation` → allowed for Math/Class A, 403 for Math/Class B. Same
shape for class-teacher-of-own-class vs. another class, and HOD-of-own-
department vs. another department (once `Department.head` exists).

**`Role.school` backfill:** the backfill command assigns every pre-existing
`Role` to the single `School` row without error; the second (required-field)
migration is a no-op on a fully-backfilled table, mirroring the same check
already implicit in `CurriculumPreset`'s rollout.

**API-level, not just helper functions:** `POST`/`PATCH`/`DELETE` on
`RoleViewSet` and `POST`/`DELETE` on `UserRoleAssignmentAPIView`, exercised via
DRF's test client at each actor tier — this is the first test file to hit
these two views directly (existing coverage only reaches RBAC indirectly
through `require_permission`-gated FBVs), so it's new coverage, not a
duplicate of what exists.

**Frontend:** `Menu.tsx`'s filtering logic given a fixed `permissions[]`
fixture, asserting a Subject Teacher / HOD / Deputy Principal / Bursar /
Secretary / Librarian each render a distinct nav set.

## Migration instructions (for the user to run — not run by this work)

Once implementation lands:

```bash
python manage.py makemigrations identity academics
python manage.py migrate
python manage.py backfill_role_school   # after the first identity migration, before the second
python manage.py migrate                # applies the second (required-field) identity migration
```

`identity` gets three migrations this round: `Role.rank` (nullable, no
backfill needed — existing roles stay unranked until Phase 3's seed assigns
one), `Role.school` added nullable, then `Role.school` made required after
`backfill_role_school` runs (same two-step shape as
`CurriculumPreset`'s `0004`/`0005`). The `academics` migration adds
`Department.head` (nullable FK, no backfill required).

## Implementation order

1. **Rank hierarchy** — `Role.rank`, `Role.school` (+ backfill command),
   `get_user_effective_rank`, `validate_rank_authority`,
   `validate_permission_delegation`, `rbac.manage` permission + composite
   entry gate, `RoleViewSet`/`UserRoleAssignmentAPIView` guard integration
   and school-scoped queryset/create, transaction wrapping.
2. **Scoped permissions** — `Department.head`, `teacher_is_allocated_to`,
   `is_hod_of_subject_department`, wired alongside existing module-permission
   checks at the relevant views.
3. **Hierarchy roles** — `seed_rbac.py` additions, `populate_demo_staff.py`
   Group-placement correction.
4. **Permission-aware nav** — `Menu.tsx` extended to Admin/Teacher, matching
   the existing Staff pattern.
5. **Audit** — `READ` action type, read-logging at the three sensitive
   surfaces, RBAC audit view broadened.

## Explicitly out of scope for this work

- `ScopedGrant` model (deferred, Phase 2 addition, not built now).
- Any change to `is_superuser` semantics or creation of a Super Admin model —
  stays exactly `user.is_superuser`.
- Any change to `IsApprovedAdmin`'s existing behavior — only additive (OR'd
  with `rbac.manage`), never narrowed.
- Renaming or restructuring the existing `Permission`/`Role`/`UserRole` models
  beyond the two new fields above.
- **Real cross-school enforcement.** `Role.school` (above) makes the schema
  tenant-ready, matching `CurriculumPreset`'s precedent, but two schools
  cannot actually see different Roles until a user carries a `school` link
  somewhere — none of the five profile models do today, and
  `get_current_school_id()` is still a one-row shim. Wiring users to schools
  is a separate, identity-wide project (also blocking real multi-school use
  of Curriculum Hub), not part of this work.
- `Permission` scoping — stays a global catalog, not per-school, for the
  reasons given in the `Role.school` section above.
- Board of Management, per-occupation functional subsystems (e.g. a real
  Library Management module for the Librarian role), and fully distinct
  hand-crafted dashboards per role beyond nav-visibility — raised in this
  session's design discussion but not yet incorporated into this spec's
  phases. See the `sms-orient` roadmap's new "Feature breadth" note; each
  needs its own dedicated brainstorming pass and likely its own spec.
