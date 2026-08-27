# Promotion Panel — Professional Redesign

Status: Approved design, ready for implementation planning
Date: 2026-08-27

## Background

The promotion backend and its readiness/gating logic were built and reviewed in
`docs/superpowers/specs/2026-08-24-promotion-process-redesign-design.md` — that work is done,
correct, and not being touched here. But `PromotionPanel.tsx` (`frontend/src/components/results/`)
still presents as five independent, flat cards with no relationship to each other:

1. **"Finalize Term Results"** takes a raw numeric "Exam Term ID" typed into a text box — no
   name, no year, no indication of which terms exist or are already finalized.
2. Every other card (Bulk Promotion, Single Student, National Exam Recording) has its own
   separate Academic Year / Grade selectors, duplicated four times with no shared state.
3. Nothing in the layout communicates *order* — an admin can click "Run Promotion" without
   ever having looked at "Finalize Term Results", with no visual indication the two are related.
4. The panel only ever reacts to what an admin explicitly checks. It never proactively tells
   an admin what's blocking promotion for a given scope until they've clicked "Check Readiness"
   or "Save Exam Record" and hit a wall.

The user's explicit direction: make this feel like one professional, formal, gated process —
"one cannot proceed without" meeting requirements — and make the process itself more powerful,
not just visually cleaner.

## Goals

- Real term picker (name + year + live finalized state) instead of a raw ID field.
- One shared "working scope" (academic year + optional grade) instead of four duplicated
  selector sets.
- The panel proactively shows what's required and what's missing for the current scope, with
  live numeric progress, before an admin runs anything.
- Promotion actions are hard-gated: disabled with a plain-language reason, not just discouraged,
  until their prerequisites are satisfied for the current scope.
- Readiness/outcome tables show the actual transition (current grade → next grade, or exam
  code) instead of an abstract requirement string.
- An irreversible bulk action (Run Promotion) requires an explicit confirmation stating exact
  counts.
- Readiness and outcome tables are exportable (CSV) for record-keeping.

## Non-goals

- No change to `_readiness_for_student`, `_determine_transition`, `_promote_student`, or any
  other already-reviewed eligibility logic in `school/views/promotion_views.py`. This is a UI/UX
  and information-surfacing layer on top of that logic, not a rebuild of it.
- No "recent promotion activity" audit-log feed. Genuinely useful, but it's a separate list
  endpoint plus its own UI — flagged here as a deliberate cut, not an oversight, for a future
  pass.
- No scheduler/automation — promotion stays an explicit, admin-triggered action (per the prior
  spec's finding).
- No change to `PromoteStudentsAPIView`'s background-job bulk-promote path, `RecordNationalExamAPIView`,
  or `FinalizeTermAPIView` beyond what's described below — this reuses those endpoints, it
  doesn't replace them.

## Architecture

**One new read endpoint backs the entire gating UI.** Today the panel has no way to know what's
required for a scope until an admin runs a readiness check. A new `GET
/api/promotion/prerequisites/` computes, for a given academic year (and optional grade), which
transition types are in play among currently-enrolled students and reports live progress against
each one's requirement — the same requirement logic `_readiness_for_student` already enforces,
just aggregated and exposed *before* a check-readiness call, not only in its results.

This mirrors the existing pattern of "one function backs both what's displayed and what's
enforced" from the prior spec — `results_finalized_for_year` and `_determine_transition` are
called here exactly as they're called inside `_readiness_for_student`, so the prerequisite
checklist can never drift from what promotion actually requires.

### 1. New backend endpoint — `GET /api/promotion/prerequisites/`

`school/views/promotion_views.py`, `PromotionPrerequisitesAPIView`, `rbac_view_permission =
'results.view'` (matches `PromotionReadinessAPIView`'s read-only gate).

Query params: `academic_year_id` (required), `grade_id` (optional).

Logic:
- Resolve the candidate grade set: if `grade_id` given, that one grade; otherwise every
  distinct `GradeLevel` currently represented among enrolled (`status=True`, not
  Graduated/Expelled/Transferred) students.
- For each candidate grade, call `_determine_transition(grade)` (imported, not reimplemented)
  to get `(transition_type, exam_code, next_grade)`.
- Bucket grades by `(transition_type, exam_code)`:
  - **`plain`** bucket (at most one, exam_code always None): requirement is
    `results_finalized_for_year(academic_year)`. Detail is computed directly from
    `ExamTerm.objects.filter(academic_year=academic_year)` — count finalized vs total, and
    include the raw per-term list (id, name, results_finalized) so the frontend's Step 1 can
    render a finalize control per term without a second request.
  - **`exam_gated` / `exit`** buckets (one per distinct exam_code): requirement is "all
    enrolled students across this bucket's grades have a `NationalExamRecord` for `exam_code`
    in this academic year". Detail is `recorded_count` vs `total_count` via a single
    `NationalExamRecord.objects.filter(...).values_list('student_id', flat=True)` intersected
    against the enrolled-student queryset for that bucket's grades — no per-student loop.
- Each bucket serializes to:
  ```
  {
    "transition_type": "plain" | "exam_gated" | "exit",
    "exam_code": "KPSEA" | null,
    "grade_names": ["Grade 6"],
    "requirement": "Results finalized for 2026" | "KPSEA recorded",
    "satisfied": bool,
    "detail": "2 of 3 terms finalized" | "38 of 45 students recorded",
    "terms": [{"id": 1, "name": "Term 1", "results_finalized": true}, ...]   // plain bucket only
  }
  ```
- Response: `{"scope": {"academic_year": "2026", "grade_name": "Grade 9" | null}, "requirement_groups": [...]}`.
- Empty scope (no enrolled students match) returns `"requirement_groups": []` — the frontend
  renders an explicit "No students in this scope" empty state, not a spinner or blank card.

### 2. Readiness transition preview — small addition, not a new endpoint

`PromotionReadinessAPIView`'s per-row dict (`school/views/promotion_views.py` ~line 356-364)
already has `next_grade_name` and `exam_code` available from `_readiness_for_student`'s return
value — they're computed but never copied into the response row. Add both to the `rows.append`
dict. No change to `_readiness_for_student` itself.

No equivalent change is needed on the promote-outcome side (`_promote_student`'s `outcomes`
list, consumed by both the bulk job result and `PromoteSingleStudentAPIView`): its `detail`
string already names the destination grade/exam in prose (e.g. "Promoted to Grade 10."). Only
the pre-promotion readiness table needs the structured fields for its "Current → Next" column.

### 3. `schoolmanagement/Urls/urls.py`

One new route: `path('api/promotion/prerequisites/', promotion_views.PromotionPrerequisitesAPIView.as_view(), name='promotion_prerequisites')`.

### 4. Frontend restructure — `frontend/src/components/results/PromotionPanel.tsx`

Layout, top to bottom:

- **Tier Requirements** (unchanged) — reference table, always visible, not part of the gated
  flow.
- **Working Scope** — new shared `Academic Year` (required) + `Grade` (optional, blank = whole
  school) selector pair at the top of the gated section. Replaces Bulk Promotion's own
  year/grade fields. Single Student and National Exam Recording sections keep their own
  student/stream pickers (they legitimately target a specific student or stream that may not
  match the working scope) but default their academic-year field from the shared scope to cut
  down re-entry.
- **Step 1 — Requirements** (new component `RequirementsChecklist`): calls `/api/promotion/prerequisites/`
  whenever the working scope changes. Renders one row per `requirement_group`: a check/cross
  icon, the requirement text, the live detail string, and an inline action:
  - `plain` group with unfinalized terms → each term row gets a "Finalize" button, calling the
    existing `FinalizeTermAPIView` (`/api/promotion/finalize-term/<id>/`) directly — this
    *replaces* today's standalone "Finalize Term Results" card; it becomes rows inside Step 1
    instead of a disconnected card with a raw ID field.
  - `exam_gated`/`exit` group not fully satisfied → a "Record exams" button that scrolls to /
    expands the existing National Exam Recording section (kept as its own section below, per
    Non-goals — not rebuilt, just linked to).
  - Refetches after any finalize action so the checklist updates live.
- **Step 2 — Check Readiness**: the existing readiness table/summary, gated — disabled with a
  tooltip/inline reason ("Complete Step 1 first: results not finalized for this year") until
  every `requirement_group` from Step 1 is `satisfied`. Once run, the table gains a "Current →
  Next" column built from the new `next_grade_name`/`exam_code` fields.
- **Step 3 — Run Promotion**: unchanged trigger logic, but (a) disabled until Step 2 has been
  run and `summary.ready > 0`, matching today's behavior, now just visually sequenced as a
  locked step rather than a plain disabled button with no context, and (b) wrapped in a
  confirmation `Dialog` — "This will promote N student(s); M will be held. Continue?" — before
  firing.
- **Quick Override — Check/Promote a Single Student**: kept, restyled to match (MUI `Card`
  with the same step-badge visual language, not part of the locked sequence since it's
  explicitly for one-off corrections outside a full scope run).
- **Record a National Exam**: kept as its own section (bulk-by-stream and single-student modes
  unchanged), restyled to match, linked to from Step 1's exam-gated rows.
- **CSV export**: a small `Download` icon button on both the readiness table and the promotion
  outcome table — client-side only, builds a CSV Blob from the already-fetched JSON and triggers
  a download. No backend change.

### 5. New shared component — `ProcessStepCard`

A thin wrapper (`Card` + `CardHeader` with a numbered `Chip` avatar + locked/unlocked visual
state: dimmed content, lock icon, and a reason `Alert` when locked) used by Steps 1-3 so the
"gated sequence" look is one component, not copy-pasted across three cards.

## Data flow

1. Admin sets Working Scope (year, optional grade).
2. Panel fetches `/api/promotion/prerequisites/` → renders Step 1's checklist.
3. Admin resolves any unsatisfied requirement inline (finalize a term, record exams) → Step 1
   refetches → checklist updates.
4. Once all groups are satisfied, Step 2 unlocks. Admin clicks "Check Readiness" →
   `/api/promotion/readiness/` (existing endpoint, now returning two extra fields per row).
5. Step 3 unlocks once Step 2 has run and has at least one ready student. Admin clicks "Run
   Promotion" → confirmation dialog → existing bulk-promote job flow, unchanged.

## Error handling

- `/api/promotion/prerequisites/` with no `academic_year_id` → 400, same shape as the existing
  readiness endpoint's validation error.
- Empty scope (no matching students) → 200 with `requirement_groups: []`; frontend shows an
  explicit empty state, Steps 2/3 stay locked with "No students in this scope" rather than a
  false "requirements satisfied".
- Network/permission failures on the prerequisites fetch → existing `Alert severity="error"`
  pattern already used elsewhere in this panel, no new pattern needed.

## Testing

- New backend tests (extend `school/tests/test_promotion_readiness.py` or a new
  `test_promotion_prerequisites.py`): bucketing for a mixed scope (some plain grades, some
  exam-gated, some exit-terminal) is grouped correctly; per-bucket `satisfied`/`detail` counts
  match `results_finalized_for_year`/`NationalExamRecord` state; `grade_id` narrows to a single
  bucket; empty scope returns `[]`; permission check (`results.view` required, matches
  `PromotionReadinessAPIView`'s existing test pattern).
- Regression: existing `test_promotion.py`/`test_promotion_readiness.py` suites stay green —
  no change to `_readiness_for_student`/`_promote_student` themselves.
- Frontend: no test suite exists for this panel (consistent with the rest of the frontend) —
  manual QA: scope switching updates the checklist live; finalizing a term from Step 1 unlocks
  Step 2 when it's the last unsatisfied requirement; Step 3 stays locked with zero ready
  students even after Step 2 runs; confirmation dialog blocks an accidental Run Promotion click;
  CSV export produces a well-formed file for both tables.

## Critical files

- `school/views/promotion_views.py` (new `PromotionPrerequisitesAPIView`, two-field addition to
  `PromotionReadinessAPIView`'s row serialization)
- `schoolmanagement/Urls/urls.py` (one new route)
- `frontend/src/components/results/PromotionPanel.tsx` (restructure)
- `frontend/src/components/results/ProcessStepCard.tsx` (new, shared)
- `school/tests/test_promotion_readiness.py` or new `test_promotion_prerequisites.py`
