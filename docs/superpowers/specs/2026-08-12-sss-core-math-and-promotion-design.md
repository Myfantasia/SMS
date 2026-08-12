# SSS Core-Math Guarantee + Multi-Tier Student Promotion

Status: Approved design, ready for implementation planning
Date: 2026-08-12

## Background

Two related gaps surfaced from a user review of the Assign Subjects / Manage Curriculum admin flows:

1. **SSS math guarantee**: under CBC, every Senior Secondary student must study mathematics regardless of pathway. Today a STEM student can pick a 3-subject combination that omits both Advanced Mathematics (AMAT) and Core Mathematics (CMAT), leaving them with no maths subject at all.
2. **No grade promotion exists anywhere in the codebase.** Grade 11/12 students never get a subject selection carried forward or reflected on their dashboard, because nothing ever advances a student from one grade to the next. This is confirmed greenfield — a repo-wide grep for `promot|advance_grade|next_grade|graduat|carry_forward` across `apps/` and `school/` returns zero real hits (only unrelated English-word/icon-class matches).

Because promotion touches national examinations (KPSEA, KJSEA, KCSE) with genuinely different institutional semantics, this grew from "carry forward SSS selections" into a full multi-tier promotion design, scoped per the CBC dossier (authoritative source for CBC structure) and the user's explicit direction on 8-4-4 (Form 3→4 only, since 8-4-4 is being phased out).

## 1. Core-math guarantee (SSS, Grade 10-12)

New helper `_ensure_core_mathematics(student, combo, academic_year)` in `school/views/subject_views.py`, invoked immediately after `_approve_combo_subjects` runs — both at fresh pathway-combo approval and at promotion carry-forward (§4). If the combo's 3 approved subjects include neither AMAT nor CMAT, `update_or_create` an `Approved` `StudentSubjectEnrollment` row for EMAT (Essential Mathematics), flagged as system-added.

- EMAT is added **on top of** the combo's 3 subjects — it never displaces a student's chosen subject (per the user's earlier "add as 4th subject" decision).
- AMAT/CMAT/EMAT already exist as distinct, tier-scoped catalog rows (`SubjectCurriculumProfile`) under the Mathematics department — no new subject data needed, only the selection/enrollment logic.
- Idempotent: re-running for a student who already has a maths subject (chosen or previously auto-added) is a no-op.

## 2. Results finalization flag

Promotion for "plain" transitions (§3) must wait until a school has recorded its own results for the year — but no such concept exists today. `StudentTermResult.is_published` is a parent/student **visibility** flag, not a completion signal, and isn't safe to reuse: `generate_results_for_stream`'s `update_or_create` always writes `is_published: False` in `defaults`, so re-running result generation silently un-publishes an already-published term.

Adding a separate, purely informational flag avoids overloading that field:

- New fields on `ExamTerm` (`apps/academics/models.py`): `results_finalized` (bool, default `False`), `results_finalized_at` (nullable datetime).
- New admin action `api_finalize_term_results(term_id)` (permission `results.edit`) sets `results_finalized=True` / stamps the timestamp. A corresponding un-finalize action clears it.
- **This flag does not block or lock anything else.** `generate_results_for_stream` is untouched — finalizing is an explicit admin signal ("we're done recording results for this term"), not an enforcement mechanism. Admins are trusted to finalize only once results are actually settled; the flag exists purely so the promotion gate has something concrete to check.
- Gate condition for "results recorded for the year": every `ExamTerm` under the target `AcademicYear` has `results_finalized=True`.

## 3. Promotion — four transition types

Every grade→grade edge in the system is exactly one of these. Which type applies is derived from existing admin-defined `Tier`/`GradeLevel` data using the same name/entry-grade heuristic convention as `tier_requires_pathway_choice` — nothing is hardcoded to a specific grade number.

| Type | Example | Gate | Action |
|---|---|---|---|
| **Plain** | Grade 1→2 … 8→9, 10→11, 11→12, Form 3→4 | Year's `ExamTerm`s all `results_finalized` (§2) | Reassign `StudentExtra.cl` to the next grade's `ClassStream` (match by name within the grade; create if no matching stream exists yet). For SSS grades, additionally carry forward the pathway/track/combo and re-run `_approve_combo_subjects` + `_ensure_core_mathematics` (§1) on the new grade. |
| **Same-institution national** | Grade 6→7 (KPSEA) | A `NationalExamRecord` (exam_code=`KPSEA`) exists for the student | Same reassignment as Plain — Upper Primary→JSS is administratively separate but physically the same school, so `cl` moves normally. |
| **Cross-institution national** | Grade 9→10 (KJSEA) | A `NationalExamRecord` (exam_code=`KJSEA`) exists for the student | **No `cl` reassignment** — genuinely different institution, unsupported until multi-tenancy (see §6). `StudentExtra.enrollment_state` → `'Graduated'`. Dashboard shows "Graduated to Senior Secondary" + `NationalExamRecord.destination` (placement school, admin-entered). |
| **Terminal** | Form 4 / Grade 12 exit (KCSE) | A `NationalExamRecord` (exam_code=`KCSE`) exists for the student | Same shape as cross-institution: `enrollment_state` → `'Graduated'`, dashboard shows "Graduated" + `destination` (university/institution, admin-entered, may be left blank if not yet known). |

### `NationalExamRecord` (new model)

Fields: `student` (FK), `exam_code` (choices: `KPSEA`/`KJSEA`/`KCSE`), `academic_year` (FK), `recorded_at`, `score`/`grade` (optional, informational only), `destination` (nullable `CharField` — unused for KPSEA, meaningful for KJSEA/KCSE), `recorded_by` (FK to user). One admin screen records it per student or in bulk by stream, entering `destination` at the same time for KJSEA/KCSE.

`StudentExtra.ENROLLMENT_STATUS_CHOICES` gains `'Graduated'` alongside the existing Active/Suspended/Expelled/Transferred.

## 4. Trigger mechanism

No scheduler infrastructure exists in this repo (no Celery Beat schedule, no cron, no signals on `AcademicYear.is_active`) — Celery is present but only used on-demand via `dispatch_background_job`. A true "nightly" job is out of scope without adding new infra, so promotion is an **admin-triggered, on-demand batch action** ("Promote Students", scoped to a grade/stream/whole-school), dispatched as a `BackgroundJob` the same way bulk result generation already works. It reports a per-student outcome — promoted / held (results not yet finalized) / graduated — back to the admin. Held students are simply skipped and re-checked on the next run; no separate retry queue.

## 5. Dashboard reflection

No new caching layer. Student/parent dashboards read `StudentExtra.cl` (current grade/class), `enrollment_state`, and the student's latest `NationalExamRecord` directly. A `'Graduated'` `enrollment_state` renders a distinct "Graduated" card (destination + exam recorded) in place of the normal class/timetable view.

## 6. Multi-tenancy note

Grade 9→10 cross-institution promotion is the second concrete multi-tenancy trigger in this system (alongside the existing `CurriculumPreset`/`SubjectPool` note in `sms-orient`). When the system eventually handles multiple schools' data, `NationalExamRecord.destination` becomes a real FK to another tenant's school record instead of free text, and actual `cl` reassignment across tenants becomes possible — today it is intentionally blocked because a single school's admin has no authority or visibility over another institution's roster. This note is being added to `sms-orient`'s roadmap alongside this spec.

## Out of scope (deferred, not part of this spec)

- Sub-project #2: 8-4-4 parity for the "Grade Subject Policies" tab.
- Sub-project #3: Curriculum Presets UI/UX improvements (subject pool creation flow).
- Sub-project #4: Manage Curriculum / Manage Enrollment UI/UX redesign.

These were explicitly deferred by the user in favor of finishing this design first, and should be brainstormed separately once this is implemented.

## Zero-migration note

This spec **does** require new migrations (new `NationalExamRecord` model, new `ExamTerm` fields, new `StudentExtra.enrollment_state` choice) — unlike some earlier work in this repo, this isn't avoidable given the scope. Per standing project convention, migrations are written but **never run** by the assistant — the user applies `makemigrations`/`migrate` themselves.
