# Assign Subjects Rework — Tier-Aware Flows + MUI Redesign Implementation Plan

Spec/source: this plan is derived from a plan-mode design captured at
`/home/jordan/.claude/plans/modular-frolicking-harbor.md` and published as an
Artifact (https://claude.ai/code/artifact/72d9400c-5670-4a54-8b40-43727561d359).
That document is the binding authority for anything this plan underspecifies.

## Context

The Assign Subjects admin page (`frontend/src/components/action routes/AssignSubjectsPage.tsx`,
backend `school/views/subject_views.py`) currently treats every grade the same: a flat
per-subject checkbox grid grouped by department. That's wrong for two reasons confirmed
from real screenshots:

1. **Senior Secondary (SSS, Grade 10-12)** students don't pick individual subjects — per the
   CBC dossier they pick ONE pathway, then ONE pre-approved 3-subject combination from that
   pathway's KNEC catalog (4 core subjects are automatic). The current page has no concept of
   this at all for admin-driven assignment.
2. **Every other tier** (Lower Primary, Upper Primary, JSS) has **zero real subject choice** —
   every learner takes the same fixed set (confirmed in the tier-scoping bug fix earlier this
   session). The checkbox-grid UI implies choice that doesn't exist. These should show as
   pre-selected/compulsory with one "Save & Lock" action.

Additionally: an admin should be able to unlock a locked (Approved) assignment to correct it,
and so should the specific class teacher of that student — nobody else. This page (and
admin-dashboard UI going forward) is being redesigned with **Material UI** (`@mui/material`,
already a dependency, currently only used in `frontend/src/public/` marketing pages, never in
the dashboard) instead of hand-rolled Tailwind, with that convention recorded in the
`sms-orient` skill for future sessions.

## Global Constraints

- **Zero migrations required for this plan as scoped.** Do not add model fields or run
  `makemigrations`/`migrate` — the user runs migrations themselves, always (see sms-orient
  Hard Rule #1).
- **Tier detection is a Python-level name-substring check**, mirroring the existing
  `CurriculumHub.tsx` heuristic, centralized into one backend function instead of left
  fragile/duplicated across files.
- **Reuse existing RBAC permission codes** for the two new "unlock" actions
  (`curriculum.edit` / `pathway.edit`, already granted to the seeded Teacher role) — do not
  introduce a new RBAC code, which would require re-seeding.
- **"Unlock" is a `status` transition** (`Approved` → `Pending`), not a new boolean column.
  `StudentSubjectEnrollment`/`StudentPathwaySelection`'s `STATUS_CHOICES` already label
  `'Approved'` as `"Approved & Locked"` — there is no separate lock concept to invent.
- **Authorization for admin-override/unlock actions**: `is_admin` (superuser or ADMIN group)
  OR the requesting user is the specific class teacher of that student. Nobody else. Mirror
  the existing `admin OR is_class_teacher_of_student` gate pattern already used at
  `school/views/subject_views.py:1106` (`api_decide_pathway_request`).
- **No frontend automated test suite exists in this repo.** Frontend tasks are verified by
  typecheck + manual QA, not automated tests.

## Task 1: Tier-detection helper

Add to `apps/academics/models.py`, near the `Tier` model definition (~line 157):

```python
def tier_requires_pathway_choice(tier) -> bool:
    """
    True for a pathway-choice stage (Senior Secondary under CBC) where students choose
    across Pathway -> Track -> PresetCombination, rather than being assigned a fixed
    compulsory set. Tier is admin-defined free text (see Tier docstring — no hardcoded
    JSS/SSS enum), so this is a name-substring convention, centralizing the heuristic
    CurriculumHub.tsx's `showPathway` already uses ad hoc in one place.
    """
    if tier is None:
        return False
    return 'senior secondary' in (tier.name or '').lower()
```

Note: `school/views/promotion_views.py` already imports and uses `tier_requires_pathway_choice`
from `apps.academics.models` (added by the earlier promotion-feature plan) — confirm the
function signature here matches that existing call site exactly (single positional `tier`
argument, returns `bool`). Do not change the existing call site.

Write a focused unit test in `school/tests/test_pathway_assignment.py` (new file — see Task 6
for the rest of this file's contents) covering:
- `tier_requires_pathway_choice(None)` → `False`
- a `Tier` named `"Senior Secondary"` → `True`
- a `Tier` named `"Junior Secondary"` → `False`
- a `Tier` named `"Upper Primary"` → `False`
- case-insensitivity (e.g. `"SENIOR SECONDARY"` → `True`)

## Task 2: View logic — factor existing code, add admin pathway endpoints

In `school/views/subject_views.py`:

- **Factor** `api_student_pathway_options`'s (~line 852) pathway/track/active-combo query and
  serialization logic into a new helper `_pathway_catalog_for_grade(grade, student=None)`.
  `api_student_pathway_options` itself must call this helper afterward and produce the exact
  same response shape it did before (no behavior change to the existing student-facing
  endpoint).
- **Factor** the "approving a combo auto-approves its 3 subjects" block out of
  `api_decide_pathway_request` (~lines 1131-1138) into a new helper
  `_approve_combo_subjects(student, combo, academic_year)`. `api_decide_pathway_request` must
  call this helper afterward with identical resulting behavior.
- **Factor** `api_student_pathway_request`'s POST validation (pathway belongs to grade's
  curriculum; track required iff pathway has tracks; combo required iff track has active
  combos) into a new helper `_validate_pathway_choice(grade, pathway_id, track_id, combo_id)`
  that raises or returns a validation error in a form the caller can turn into a 400 response.
  `api_student_pathway_request` must call this helper afterward with identical resulting
  behavior.
- **New `api_admin_pathway_options(request, student_id)`** (GET) — permission-gated on
  `pathway.view` for read, `pathway.edit` for the unlock affordance (use this repo's existing
  `@require_permission` decorator convention — check `school/rbac.py` / existing decorated
  views in this file for the exact decorator signature and follow it, do not invent a new
  gating mechanism). Looks up the `StudentExtra` by `student_id` (404 if missing), resolves
  `student.cl.grade`, and returns:
  - `_pathway_catalog_for_grade(grade, student=student)`'s payload
  - `requires_pathway_choice`: `tier_requires_pathway_choice(grade.tier)`
  - `can_unlock`: `True` if the requesting user is admin (superuser or ADMIN group,
    matching the `is_admin` check pattern at `school/views/promotion_views.py:212`) OR
    `school.rbac.is_class_teacher_of_student(request.user, student)` returns `True` (the
    existing helper at `school/rbac.py:99` — use it directly, do not reimplement)
- **New `api_admin_assign_pathway(request, student_id)`** (POST) — gated on `pathway.edit`
  PLUS the inline admin-OR-class-teacher 403 check (same pattern as
  `api_decide_pathway_request:1106`). Reads `pathway_id`, `track_id`, `combo_id`,
  `academic_year_id` from the request body. Validates via `_validate_pathway_choice`. Inside
  `transaction.atomic()`: `update_or_create`s the student's `StudentPathwaySelection` for that
  academic year directly with `status='Approved'` (no `Pending` intermediate step — this is
  the admin-override path, matching `api_manage_subject_enrollment`'s existing framing on the
  subject side), then calls `_approve_combo_subjects(student, combo, academic_year)`. Writes
  an audit log entry via `apps.core.services.write_audit_log` (match the calling convention
  used elsewhere in this file, e.g. in `api_decide_pathway_request`). Returns the updated
  selection + resolved subjects.
- **New `api_unlock_subject_enrollment(request, student_id)`** (POST) — gated on
  `curriculum.edit` PLUS the same admin-or-class-teacher gate. Bulk `.update(status='Pending')`
  on the student's current-academic-year `Approved` `StudentSubjectEnrollment` rows.
  Audit-logged. Returns `{'status': 'success', 'is_locked': False}` (mirror
  `api_toggle_lesson_lock`'s response shape at `school/views/views_timetable.py:502`).
- **New `api_unlock_pathway_selection(request, student_id)`** (POST) — gated on
  `pathway.edit` PLUS the same admin-or-class-teacher gate. Reverts the student's current-year
  `StudentPathwaySelection` from `Approved` to `Pending`, AND also reverts the combo's 3
  auto-approved `StudentSubjectEnrollment` rows back to `Pending` (keep the two in sync — an
  unlocked pathway with still-locked subjects would be an inconsistent state). Audit-logged,
  same response shape as above.
- **No change** to `api_manage_subject_enrollment` (`school/views/subject_views.py:607-665`) —
  for compulsory tiers the frontend just submits **all** eligible subject ids from the
  (already tier-correct) `api_subject_catalog` response; the existing "mark rest Rejected,
  approve submitted" logic already does the right thing. Do not modify this function.
- **No change** to `api_manage_category_limits`/`api_manage_exclusion_rules` — only their
  frontend tab visibility changes (Task 4). Do not modify these functions.
- **Register `StudentPathwaySelection` in Django admin.** Confirmed gap: `StudentSubjectEnrollment`
  is already registered (`school/admin.py:236`), but `StudentPathwaySelection`
  (`apps/students/models.py:41`) is not registered anywhere — an admin currently has no
  fallback visibility into pathway selections outside this feature's own UI. Add a
  `StudentPathwaySelectionAdmin` (list_display: `student`, `pathway`, `track`,
  `preset_combination`, `academic_year`, `status`, `updated_at`; list_filter: `status`,
  `academic_year`, `pathway`; search_fields on the student's name/admission fields — match
  whatever convention `StudentSubjectEnrollmentAdmin` at `school/admin.py:236` already uses
  for its own search_fields). Register it in whichever `admin.py` already owns
  `StudentSubjectEnrollment` registration for this model's app (`school/admin.py`), for
  consistency — do not split registration of sibling models across different admin.py files
  without reason. This registration has no schema impact and needs no migration.

Test coverage (append to `school/tests/test_pathway_assignment.py`, Task 6 owns the file's
final shape): `api_admin_pathway_options`'s `can_unlock` for admin vs. an unrelated teacher vs.
the actual class teacher; `api_admin_assign_pathway` creating an `Approved` selection and
auto-approving the combo's 3 subjects atomically, and rejecting mismatched-curriculum /
missing-track / missing-combo input with 400s; both unlock endpoints reverting
`Approved`→`Pending` and 403-ing for unauthorized users; a regression check that
`api_manage_subject_enrollment` still works correctly for the "submit all eligible ids"
compulsory-tier case (no change expected, but prove the refactor in this task didn't break it).

## Task 3: URL routes

In `schoolmanagement/Urls/urls.py`, add these 4 routes alongside the existing
`api/subjects/...` block (~lines 196-218):

```python
path('api/subjects/pathway-options/<int:student_id>/', subject_views.api_admin_pathway_options, name='admin_pathway_options'),
path('api/subjects/pathway-options/<int:student_id>/assign/', subject_views.api_admin_assign_pathway, name='admin_assign_pathway'),
path('api/subjects/pathway-options/<int:student_id>/unlock/', subject_views.api_unlock_pathway_selection, name='unlock_pathway_selection'),
path('api/subjects/manage-enrollment/<int:student_id>/unlock/', subject_views.api_unlock_subject_enrollment, name='unlock_subject_enrollment'),
```

Confirm `subject_views` is already imported in this file under that name (it is, for the
existing `api/subjects/...` routes) — do not add a duplicate import. Run `manage.py check`
after adding these to confirm no URL-resolution errors.

## Task 4: Frontend — `AssignSubjectsPage.tsx` tier-aware rework

File: `frontend/src/components/action routes/AssignSubjectsPage.tsx`.

- **Fix the pre-existing bug while here**: `handleSaveStudentSubjects`'s `finally` block
  calls `setSaving(true)` instead of `setSaving(false)` — this permanently disables the Save
  button after first use. Fix it to `setSaving(false)`.
- On mount, additionally fetch `GET /api/subjects/pathway-options/:studentId/` (Task 2/3) to
  get `requires_pathway_choice`, `can_unlock`, the pathway catalog, and the current selection.
- **SSS branch** (`requires_pathway_choice === true`): a new cascading MUI `Select`/`MenuItem`
  picker (Pathway → Track → PresetCombination), modeled on
  `frontend/src/pages/student/StudentPathwayChoice.tsx`'s cascade logic but admin-direct-assign
  flavored (submits straight to the Task 2 admin-assign endpoint, no Pending step). Show the
  resolved 3 combo subjects as `Chip`s for preview before submit, plus any core SSS subjects
  as a fixed non-editable `Chip` row. Once `Approved`: render a read-only display + a
  `Lock`/`LockOpen` `IconButton` (from `@mui/icons-material`) gated on `can_unlock`, calling
  the unlock endpoint and refetching on success.
- **Non-SSS branch**: replace the checkbox grid with MUI `Card`s grouped by department, each
  subject shown as a disabled/checked `Chip` (compulsory, not togglable). A single
  **"Save & Lock"** button submits the full eligible-id list to the existing
  `api_manage_subject_enrollment` endpoint (unchanged per Task 2). Same Lock/Unlock
  `IconButton` pattern as the SSS branch, gated on the same `can_unlock` flag — also add
  `can_unlock` to `api_student_subject_profile`'s existing response (small backend addition,
  same admin-or-class-teacher computation as Task 2, added inline to that existing view) so
  this branch doesn't need the pathway-options fetch.
- **Hide the "Grade Subject Policies" tab entirely** when `requires_pathway_choice === false`
  (wrap the tab button + body, ~lines 292-299 and 379-450, in the condition) — nothing to
  configure once there's no free per-subject choice.
- MUI component inventory for this task: `Card`/`CardContent`/`CardHeader`, `Tabs`/`Tab`,
  `Chip`, `Button`/`IconButton`, `Alert` (replacing existing `alert()` calls), `Select`/
  `MenuItem` for the cascade, `Switch` (replacing the hand-rolled Bypass Policies toggle),
  `CircularProgress`/`Skeleton` for loading state. Keep
  `frontend/src/components/common/SearchableSelect.tsx` as-is inside the (now SSS-only)
  Policies tab — different UX need (searchable flat list) than the short pathway cascade.

This task depends on Tasks 2 and 3 (the endpoints/routes it calls) — do not dispatch its
implementer before Tasks 2 and 3 are complete.

Manual QA (no automated frontend suite in this repo — flag this step explicitly in the
report rather than skipping it): SSS admin assign+lock+unlock, non-SSS compulsory
save+lock+unlock, Policies tab hidden for non-SSS, and confirm the pre-existing Save-button
bug is actually fixed (save, then save again without a reload).

## Task 5: New admin MUI theme

New file `frontend/src/layouts/theme/adminTheme.ts`. Mirror
`frontend/src/public/theme/publicTheme.ts`'s `createTheme` pattern structurally, but keyed to
the dashboard's existing indigo/slate palette (primary ≈ indigo-600 `#4F46E5`, matching this
page's current `bg-blue-600` accents) rather than the public site's gold/terracotta identity —
these are deliberately different brand contexts, do not reuse the public palette.

Wire `<ThemeProvider theme={adminTheme}>` into `frontend/src/layouts/DashboardLayouts.tsx`
around the existing `<Outlet/>` (matching however `PublicShell.tsx` wires its own
`ThemeProvider` — follow that existing wiring pattern exactly).

Test whether MUI's `CssBaseline` conflicts with the existing global Tailwind base styles once
components render (visually, in a running dev server); omit `CssBaseline` if it does, and rely
on MUI's scoped `sx`/component-level styles only. Note in the report which choice was made and
why.

This theme file is reusable for future admin-dashboard MUI work, not just this page — do not
scope it narrowly to only the values Task 4 happens to use.

This task has no code dependency on Tasks 1-4 and may be dispatched independently, but Task 4
consumes this theme, so it must land before or alongside Task 4's manual QA.

## Task 6: `sms-orient` skill — record the MUI convention + new test file

- Add one bullet to the **Maintainability** subsection of "Growth roadmap" in
  `.claude/skills/sms-orient/SKILL.md`:

  > **New/reworked admin-dashboard UI now uses MUI (@mui/material), not raw Tailwind utility
  > classes** — a 2026-08-15 decision, starting with `AssignSubjectsPage.tsx`. MUI previously
  > existed only in `frontend/src/public/` (marketing/auth); the admin dashboard was 100%
  > hand-rolled Tailwind with no shared Card/Button/Badge primitives. Prefer MUI components
  > for any admin page you create or substantially rework going forward, themed via
  > `frontend/src/layouts/theme/adminTheme.ts` (dashboard's indigo/slate palette, not the
  > public site's gold/terracotta) wired through `DashboardLayouts.tsx`. This is a "new work
  > uses MUI" convention, not a retrofit mandate — expect both styles to coexist for a long
  > transitional period.

- Finalize `school/tests/test_pathway_assignment.py` (new file — no existing test file covers
  `StudentPathwaySelection`/pathway endpoints at all, confirmed zero hits) as the single home
  for all backend test coverage added across Tasks 1-2. If this task is dispatched separately
  from Tasks 1-2, its implementer's job is only the skill-file bullet above plus confirming
  the test file exists and passes — do not duplicate test-writing already done in Tasks 1-2.

This task has no code dependency on Tasks 1-5 and may be dispatched independently or batched
with Task 5 as same-shape small work if you judge them low-risk enough to combine.

## Final Verification

- `python manage.py check`, `lint-imports` (confirm the modular-monolith `apps/*` boundary
  contracts are unaffected — this plan touches `school/views/` and `apps/academics/models.py`
  only, not new cross-app imports, but verify against the current contract count rather than
  assuming), full suite via `python manage.py test school.tests --keepdb --noinput`.
- Reproduce end-to-end in Django shell against real seeded data (an SSS grade + student, a JSS
  grade + student) before/after — same style used to verify the tier-scoping bug fix earlier
  in this project's history.
- No frontend test suite exists in this repo — frontend verification is manual: SSS admin
  assign+lock+unlock, non-SSS compulsory save+lock+unlock, Policies tab hidden for non-SSS.
  Flag this as a manual QA step for the user once implemented; it is not automatable here.
- Confirm zero migration files were created during any task (mtime audit against the plan's
  own "zero migrations required" constraint).

### Critical files
- `school/views/subject_views.py`
- `apps/academics/models.py`
- `schoolmanagement/Urls/urls.py`
- `frontend/src/components/action routes/AssignSubjectsPage.tsx`
- `frontend/src/layouts/DashboardLayouts.tsx`
- `frontend/src/layouts/theme/adminTheme.ts` (new, pattern from `frontend/src/public/theme/publicTheme.ts`)
- `.claude/skills/sms-orient/SKILL.md`
- `school/tests/test_pathway_assignment.py` (new)
