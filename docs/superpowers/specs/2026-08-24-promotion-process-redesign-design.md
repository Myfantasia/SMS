# Promotion Process Redesign

Status: Approved design, ready for implementation planning
Date: 2026-08-24

## Background

The grade-promotion backend (`school/views/promotion_views.py`, built per
`docs/superpowers/specs/2026-08-12-sss-core-math-and-promotion-design.md`) is structurally
sound — a generic, tier-driven model of plain / exam-gated / exit transitions that works the
same way for CBC and 8-4-4 without hardcoded grade numbers. But it is functionally inert and
the admin-facing UI is unusable in practice:

1. **`Tier.exit_exam_code` / `exit_is_terminal` are configured nowhere.** The fields exist on
   the model, `_determine_transition` reads them, but `TierSerializer` never exposes them and
   no admin UI can set them. Every tier in the live database is unconfigured, so every
   promotion today silently resolves to `'plain'` regardless of what should actually gate it —
   a Grade 9 or Form 4 student due to sit a national exam would just get held with "no next
   grade configured" instead of graduating correctly.
2. **`PromotionPanel.tsx` is a raw-ID-entry MVP.** Three sections, all keyed by typed-in
   numeric IDs (Exam Term ID, Student ID, Academic Year ID, Grade ID) with no name pickers. The
   bulk promotion result's per-student outcome breakdown (`promoteResult.outcomes`) is fetched
   but never rendered — only a generic success message shows. An admin has no way to see, before
   or after running promotion, which students were blocked and why.

The user's explicit direction: make the process smooth, user-friendly, and professional, with
promotion requirements clearly displayed and strictly (not silently) enforced.

## Goals

- An admin can see, before running any promotion, exactly which students are ready and which
  are blocked (and why) for a given scope.
- The same requirement logic that's displayed is the logic that's enforced — no drift between
  what the UI shows and what the backend actually does.
- Real name/entity pickers replace every raw-ID text field.
- Tier exit-exam configuration is visible and editable from the same UI where tiers are managed.
- Both bulk (grade/stream/whole-school) and single-student promotion are supported.
- The four existing tiers (3 CBC + 1 8-4-4) get correct, dossier-accurate default exam gates,
  so the system behaves correctly out of the box rather than requiring an admin to discover and
  fix a silent misconfiguration.

## Non-goals

- No change to `_determine_transition`'s transition-type model (plain/exam_gated/exit) — it's
  already correct and generic.
- No change to `NationalExamRecord`'s shape or the `destination` free-text field (multi-tenancy
  follow-up, out of scope here — see `sms-orient`).
- No scheduler/cron automation of promotion — it stays an explicit, admin-triggered action, per
  the original spec's finding that no scheduler infra exists in this repo.
- No change to how `PromoteStudentsAPIView`'s existing background-job dispatch works internally
  — the new single-student endpoint is a separate, synchronous path, not a refactor of the job
  queue.

## Architecture

**One shared, non-mutating readiness function backs three consumers.** Today
`_promote_student` computes eligibility and mutates state in the same function — there is no
way to ask "would this succeed?" without actually running it, which is the root cause of both
the "not displayed" and "not strictly enforced" complaints (any future change to the
eligibility rule would only need to touch one place, and preview can never drift from
enforcement).

```
_readiness_for_student(student, academic_year) -> ReadinessResult
        |
        +--> _promote_student()               (mutates, if ready)
        +--> GET /api/promotion/readiness/     (bulk preview, read-only)
        +--> POST /api/promotion/promote-student/<id>/   (single-student, mutates if ready)
```

`ReadinessResult` fields: `ready: bool`, `transition_type: 'plain'|'exam_gated'|'exit'|None`,
`requirement: str` (human-readable, e.g. "Results finalized for 2026" or "KJSEA recorded"),
`reason: str | None` (only set when not ready — why it's blocked), `next_grade_name: str | None`.

## Backend changes

### 1. `TierSerializer` (`school/serializers/curriculum_serializers.py`)

Add `exit_exam_code`, `exit_is_terminal` to `Meta.fields`. No new validation needed —
`exit_exam_code`'s model-level `choices` already constrains it.

### 2. `_readiness_for_student(student, academic_year)` (new, `promotion_views.py`)

Extracted from `_promote_student`'s existing branching (grade lookup → `_determine_transition`
→ requirement check), returning a `ReadinessResult` instead of mutating. Handles all three
existing "held" cases (no current class, results not finalized, exam not recorded) plus the
"no next grade configured" edge case, each with a specific `reason`.

### 3. `_promote_student(student, academic_year)` (refactored)

Becomes: call `_readiness_for_student`; if not ready, return the existing `'held'` outcome
shape using the readiness result's `reason`; if ready, perform exactly the mutation branches it
already has (unchanged). Existing tests (`EnsureCoreMathematicsTests`,
`PromoteStudentSSSPathwayCarryForwardTests`, `PromoteStudentTests`, etc.) continue to exercise
the same observable behavior — this is a refactor, not a behavior change, for the already-ready
paths.

### 4. `GET /api/promotion/readiness/` (new `APIView`)

Query params: `academic_year_id` (required), plus exactly one optional scope narrower —
`grade_id`, `stream_id`, or `student_id` (whole school if none given). `student_id` is the
mechanism the single-student panel (§8) reuses this same endpoint through — one readiness
endpoint, three scope granularities, rather than a second parallel code path. For each in-scope
active `StudentExtra`, calls `_readiness_for_student` and returns:

```json
{
  "summary": {"ready": 42, "blocked": 8, "by_reason": {"Results not finalized": 5, "KJSEA not recorded": 3}},
  "students": [
    {"student_id": 1, "name": "...", "grade_name": "...", "transition_type": "plain",
     "requirement": "Results finalized for 2026", "ready": true, "reason": null},
    ...
  ]
}
```

Read-only, no side effects. Gated via `HasModulePermission` with `rbac_view_permission =
'results.view'` (mirrors the existing GET-vs-mutating split already built into
`HasModulePermission` — see `school/rbac.py`).

### 5. `POST /api/promotion/promote-student/<student_id>/` (new `APIView`)

Synchronous — no background-job dispatch, since a single student's promotion is fast enough to
answer inline (unlike the bulk path, which can span a whole school). Body: `academic_year_id`.
Calls `_promote_student` directly inside a transaction, returns its outcome dict. Same
admin-only + `rbac_edit_permission = 'results.edit'` gate as `PromoteStudentsAPIView` (explicit
`is_admin` check, matching the existing bulk endpoint's reasoning: promotion is a
school-wide-impact action, not something a narrower `results.edit` holder like a class teacher
should trigger solo).

### 6. `seed_tier_exit_exams.py` (new management command)

Idempotent, same pattern as `seed_pathway_descriptions.py` (write it, do not run it — per
standing project convention). Matches tiers by curriculum code + a name-substring convention
(mirroring `tier_requires_pathway_choice`'s own approach, robust against the real seeded data's
"Junior Srcondary" typo) and only sets `exit_exam_code`/`exit_is_terminal` where currently
blank, so it never overwrites an admin's own configuration:

| Curriculum | Tier (matched by name substring) | exit_exam_code | exit_is_terminal |
|---|---|---|---|
| CBC | "upper primary" | KPSEA | False (same-institution, Grade 6→7) |
| CBC | "junior" | KJSEA | True (cross-institution, Grade 9→10) |
| CBC | "senior secondary" | KCSE | True (terminal) |
| 8-4-4 | (the tier containing Form 4) | KCSE | True (terminal) |

## Frontend changes

### 7. Tier edit form (`CurriculumHub.tsx`, `TiersTab`/tier create-edit UI)

Add an "Exit requirement" field group: a `<select>` for `exit_exam_code` (None / KPSEA / KJSEA
/ KCSE) and a checkbox/toggle for `exit_is_terminal` ("student leaves this school on exit —
KJSEA/KCSE-style; leave unchecked for a same-institution exam like KPSEA"). This is the first
place "requirements are displayed" — visible at tier-configuration time, not just at
promotion time.

### 8. `PromotionPanel.tsx` — full rebuild, four sections

- **Tier requirements summary** (read-only, top of panel): one row per tier — name, configured
  exit exam or "Not configured" (flagged visually), terminal or not. Lets the admin sanity-check
  setup before touching anything below.
- **Bulk promotion**: Academic Year and Grade become real dropdowns (`SearchableSelect` /
  `<select>`, populated from `/api/academic-years/` and `/api/academic-hub/`, both already used
  elsewhere in this codebase — no new list endpoints needed). A **"Check Readiness"** button
  calls `GET /api/promotion/readiness/` and renders the summary bar + full per-student table
  (name, grade, requirement, ready/blocked, reason). **"Run Promotion"** stays disabled until a
  readiness check has been run for the current scope; running it dispatches the existing
  background job exactly as today, and on completion renders the same table shape but populated
  from the real `promoteResult.outcomes` (already fetched today, simply never displayed).
- **Single-student check/promote**: a `SearchableSelect` student picker. On selection, calls the
  same readiness endpoint scoped to that one student (`student_id` param) and shows their
  requirement/status inline, with a "Promote This Student" button that POSTs to the new
  single-student endpoint when ready.
- **Record National Exam**: Student ID field replaced with a `SearchableSelect` picker; Academic
  Year ID becomes a dropdown. Adds a **bulk-by-stream mode** (toggle): pick a stream instead of
  a student, and the whole cohort gets a `NationalExamRecord` row created in one action (score/
  destination left blank, editable later) — recording KCSE/KJSEA one student at a time for an
  entire class is the kind of friction this redesign is meant to remove.

## Data flow (bulk promotion, the main flow)

1. Admin selects Academic Year (+ optional Grade) → clicks "Check Readiness".
2. Frontend calls `GET /api/promotion/readiness/?academic_year_id=...&grade_id=...`.
3. Backend resolves the student scope, calls `_readiness_for_student` per student, returns
   summary + rows. No writes occur.
4. Admin reviews the table, sees exactly who's blocked and why, optionally goes and fixes
   blockers (finalizes a term, records an exam) via the other sections or elsewhere in the app.
5. Admin clicks "Run Promotion" (enabled once step 3 has completed for the current scope) →
   existing `PromoteStudentsAPIView` flow (background job, `pollJob`) → real per-student
   outcomes rendered in the same table component, now showing final promoted/graduated/held
   status.

## Error handling

- Readiness/single-student endpoints return `400` for missing `academic_year_id`, `404` for an
  unknown academic year/student, matching existing sibling endpoints' conventions in this file.
- A student with no current class assignment shows as blocked with reason "No current class
  assigned" in the readiness table — never silently omitted from the list, so counts stay
  honest.
- If a tier has no `exit_exam_code` configured, its students show `transition_type: 'plain'`
  with requirement "Results finalized" — the same behavior as today, but now the *reason* it's
  being treated as plain (unconfigured tier) is visible in the tier requirements summary above
  the table, not a silent surprise.

## Testing

- Backend: new `school/tests/test_promotion_readiness.py` — `_readiness_for_student` for all
  three transition types (ready and blocked cases each), the readiness endpoint's scope
  filtering and summary counts, the single-student endpoint's admin-gate and ready/not-ready
  paths, and a regression check that `_promote_student`'s refactor doesn't change any existing
  `test_promotion.py` outcome for the already-covered scenarios (run that file unchanged as a
  regression gate).
- `seed_tier_exit_exams.py`: a `--dry-run` pass reviewed manually (matching how
  `seed_pathway_descriptions.py` was verified) before the user applies it for real.
- Frontend: no test suite exists in this repo for it (established precedent) — manual QA once
  implemented: check readiness for a scope with a mix of ready/blocked students, run promotion,
  confirm the outcomes table matches the earlier readiness table's blocked reasons for students
  that were already blocked, and single-student promote for one student.

## Critical files

- `school/views/promotion_views.py`
- `school/serializers/curriculum_serializers.py`
- `schoolmanagement/Urls/urls.py` (2 new routes)
- `frontend/src/components/results/PromotionPanel.tsx`
- `frontend/src/pages/admin/CurriculumHub.tsx` (Tier edit form)
- `school/management/commands/seed_tier_exit_exams.py` (new)
- `school/tests/test_promotion_readiness.py` (new)
