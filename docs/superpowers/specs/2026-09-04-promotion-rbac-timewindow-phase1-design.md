# Promotion Process — Phase 1: RBAC, Time-Windowed Corrections & UX

Status: Approved design, ready for implementation planning
Date: 2026-09-04

## Background

The promotion panel (redesigned in `docs/superpowers/specs/2026-08-27-promotion-panel-professional-redesign-design.md`)
works correctly but has no notion of *who* is allowed to act, and no way to undo a mistake.
Today:

1. **Any user with `results.edit`** can finalize/un-finalize a term, run bulk promotion, or
   promote a single student, with no distinction between an Administrator and a class
   teacher, and no limit on when a correction can be made.
2. **Class teachers have no scoped promotion rights at all.** The user wants a class teacher
   able to run promotion for their own allocated class/stream, and nothing outside it.
3. **Nothing can be undone.** Once `_promote_student` reassigns a student's class (or marks
   them Graduated), there is no recorded "before" state anywhere — not even informally in the
   audit log, whose `description` field is free text, not structured data. There is no revert
   path today.
4. **The "Check Readiness" table is a flat, unpaginated list** (confirmed 190 rows in one
   screenshot) with no grouping — hard to work through for a real school.
5. **Quick Override and Record National Exam are plain inline cards**, not modals, with no
   student search filtering.

This spec (Phase 1 of a larger request) covers: role-based access control for promotion
actions, a genuinely new "revert a promotion" capability with a 12-hour correction window for
Administrators, scoped-but-unrestricted promotion rights for class teachers, and the UX pieces
(grouped/paginated readiness table, Quick Override and Record National Exam as modals with
search/filtering, correct warning styling). Phase 2 (finalize counter-check modal with
results-anomaly detection, and automatic promotion triggered by national exam recording) is a
separate spec, written after this one ships, since it needs its own investigation into the
results/marks models.

## Goals

- Only Administrators (and superusers) can finalize a term.
- Un-finalizing a term is time-boxed: an Administrator can only do it within 12 hours of that
  term's last finalize; a superuser can always do it.
- A class teacher can run promotion (single-student or bulk) only for students in their own
  allocated stream — an ongoing permission, not time-limited, since running promotion isn't a
  destructive action (an already-promoted student is simply not re-promoted).
- A completed promotion (single or bulk) can be reverted — restoring the student's previous
  class, enrollment state, and any pathway selection that was created as part of that
  promotion — by an Administrator within 12 hours of that promotion, or by a superuser at any
  time. Class teachers do not get revert rights.
- The readiness table is grouped by class (stream) and paginated at 15 rows per group.
- Quick Override and Record National Exam open as modals from a clickable trigger, with a real
  student search (name + A–Z first-letter filter).
- Record National Exam's picker only offers grades that actually have an `exit_exam_code`
  configured on their tier — not the whole school.
- The "requirements not yet met" warning reads as an actual caution, not a plain info box.

## Non-goals

- No finalize-time results counter-check modal or anomaly detection — Phase 2.
- No automatic promotion triggered by recording a national exam — Phase 2.
- No change to `_determine_transition`'s transition-type model, `results_finalized_for_year`,
  or the shape of `PromotionReadinessAPIView`'s/`PromotionPrerequisitesAPIView`'s existing
  fields — this spec only adds new fields/endpoints alongside them.
- **This spec does deliberately touch `_promote_student`** (to record a `PromotionEvent` on
  success) — flagging this explicitly since the two prior promotion specs treated
  `_promote_student` as off-limits; that constraint doesn't carry forward to this spec, and the
  change here is additive (one new write, no change to its existing return value or control
  flow).
- No revert path for a national-exam ("exit"/graduated) promotion beyond restoring
  `enrollment_state` — a graduated student's exam record itself is untouched by a revert (the
  `NationalExamRecord` row stays; only the enrollment/class-reassignment side is undone).
- No new generic DRF object-permission class — every permission check in this codebase's
  promotion/subject views is a hand-written inline check (`_is_admin(user) or
  is_class_teacher_of_student(user, student)`); this spec follows that same convention rather
  than introducing a new abstraction.

## Architecture

### 1. New model — `PromotionEvent` (`apps/students/models.py`, alongside `NationalExamRecord`)

Records exactly what `_promote_student` did, so a later action can undo it and so the 12-hour
window has a concrete timestamp to measure against.

```python
class PromotionEvent(models.Model):
    """
    Written by _promote_student on every successful promotion or graduation (never on a
    'held' outcome). Captures enough of the student's pre-promotion state to support a
    full revert, and performed_at is what the 12-hour Administrator correction window
    (see PromotionRevertAPIView) measures against.
    """
    OUTCOME_CHOICES = [('promoted', 'Promoted'), ('graduated', 'Graduated')]

    student = models.ForeignKey('identity.StudentExtra', on_delete=models.CASCADE, related_name='promotion_events')
    academic_year = models.ForeignKey('academics.AcademicYear', on_delete=models.CASCADE)
    outcome = models.CharField(max_length=10, choices=OUTCOME_CHOICES)

    previous_cl = models.ForeignKey(
        'academics.ClassStream', on_delete=models.SET_NULL, null=True, blank=True, related_name='+',
        help_text="Student's class stream immediately before this promotion. Null for a "
                   "'graduated' outcome, since graduation doesn't reassign cl.",
    )
    previous_enrollment_state = models.CharField(max_length=20)
    created_pathway_selection = models.ForeignKey(
        'students.StudentPathwaySelection', on_delete=models.SET_NULL, null=True, blank=True, related_name='+',
        help_text="Set only if this promotion created a new StudentPathwaySelection row via "
                   "_carry_forward_pathway_selection (SSS grades). Reverting deletes exactly "
                   "this row and nothing else — an already-existing selection for the target "
                   "year is left untouched.",
    )

    performed_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    performed_at = models.DateTimeField(auto_now_add=True, db_index=True)
    reverted_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    reverted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'school_promotionevent'
```

`_promote_student` (`school/views/promotion_views.py`) gains one write per success path:

- `plain`/`exam_gated` (promoted): capture `previous_cl = student.cl` and
  `previous_enrollment_state = student.enrollment_state` *before* calling
  `_move_student_to_grade`, then create the `PromotionEvent` after, with
  `created_pathway_selection` set to whatever `_carry_forward_pathway_selection` created (that
  function already returns the `StudentPathwaySelection` instance via `update_or_create`'s
  first element — capture it and pass it through, but **only** record it as
  `created_pathway_selection` if `update_or_create`'s second element (`created`) was `True`; an
  updated pre-existing row must never be attributed to this promotion, so a revert can't delete
  something that predates it).
- `exit` (graduated): capture `previous_enrollment_state` before setting it to `'Graduated'`,
  `previous_cl = None`.
- `held`: no `PromotionEvent` — nothing happened.

A companion `write_audit_log(module='PromoteAndReadyForRevert', ...)` call is not needed — the
`PromotionEvent` row itself is the durable record; the existing
`SinglePromoteStudent`/`BulkPromoteStudents` audit-log calls stay as-is for the human-readable
trail.

### 2. Revert endpoint — `PromotionRevertAPIView`

`POST /api/promotion/revert/<int:event_id>/`, `rbac_edit_permission='results.edit'`.

```python
def post(self, request, event_id):
    user = request.user
    try:
        event = PromotionEvent.objects.select_related('student', 'created_pathway_selection').get(id=event_id)
    except PromotionEvent.DoesNotExist:
        return Response({"error": "Promotion event not found."}, status=404)

    if event.reverted_at is not None:
        return Response({"error": "This promotion was already reverted."}, status=400)

    is_admin = _is_admin(user)
    if not (user.is_superuser or is_admin):
        return Response({"error": "Only Administrators can revert a promotion."}, status=403)

    if not user.is_superuser:
        window_expired = timezone.now() - event.performed_at > timedelta(hours=12)
        if window_expired:
            return Response(
                {"error": "The 12-hour window to revert this promotion has passed. "
                          "Only a superuser can revert it now."}, status=403,
            )

    with transaction.atomic():
        student = event.student
        if event.outcome == 'graduated':
            student.enrollment_state = event.previous_enrollment_state
            student.save(update_fields=['enrollment_state'])
        else:
            student.cl = event.previous_cl
            student.enrollment_state = event.previous_enrollment_state
            student.save(update_fields=['cl', 'enrollment_state'])
            if event.created_pathway_selection_id:
                event.created_pathway_selection.delete()

        event.reverted_by = user
        event.reverted_at = timezone.now()
        event.save(update_fields=['reverted_by', 'reverted_at'])

    write_audit_log(
        operator_id=user.id, action_type='UPDATE', module='PromotionRevert',
        description=f"Reverted {event.outcome} for {student.get_name} "
                    f"({event.academic_year.year}), originally performed by "
                    f"{event.performed_by.username if event.performed_by else 'unknown'}.",
    )
    return Response({"student_id": student.id, "reverted": True})
```

### 3. Listing a student's promotion events — `PromotionEventsAPIView`

`GET /api/promotion/events/?student_id=<id>`, `rbac_view_permission='results.view'`. Returns
the student's `PromotionEvent` rows (most recent first), each serialized with `id`, `outcome`,
`academic_year`, `performed_at`, `performed_by_name`, `reverted_at`, and a computed
`can_revert` (`True` iff `reverted_at is None` and the requesting user is either superuser, or
admin-and-within-window). This backs the redesigned Quick Override modal's "recent promotions
for this student, with Revert where eligible" section.

### 4. Finalize/un-finalize gating (`FinalizeTermAPIView`)

The endpoint already takes `finalized: bool`. Add, only on the `finalized is False` branch:

```python
if not finalized:
    is_admin = _is_admin(request.user)
    if not (request.user.is_superuser or is_admin):
        return Response({"error": "Only Administrators can un-finalize a term."}, status=403)
    if not request.user.is_superuser and term.results_finalized_at is not None:
        if timezone.now() - term.results_finalized_at > timedelta(hours=12):
            return Response(
                {"error": "The 12-hour window to un-finalize this term has passed. "
                          "Only a superuser can un-finalize it now."}, status=403,
            )
```

Finalizing (`finalized=True`) is unchanged — no time restriction, Admin/superuser only (already
true via the existing `rbac_edit_permission`, tightened here to explicitly require `_is_admin`
rather than any `results.edit` holder, matching the Goals table).

### 5. Class-teacher scoping on promotion actions

- **`PromoteSingleStudentAPIView`**: replace the current `is_admin` 403 gate with `_is_admin(user)
  or is_class_teacher_of_student(user, student)`.
- **`PromoteStudentsAPIView`** (bulk): today's payload is `{academic_year_id, grade_id}`. Add
  optional `stream_id` (mirroring `PromotionReadinessAPIView`'s existing `stream_id` support).
  If the requester is not an admin/superuser, **require** `stream_id` and check directly against
  `ClassStream.class_teacher` — `ClassStream.objects.filter(id=stream_id, class_teacher__user=request.user).exists()`
  — rather than going through `is_class_teacher_of_student` (which needs a student instance and
  would awkwardly require "at least one enrolled student" as a proxy for stream ownership; a
  direct `ClassStream.class_teacher` check is simpler and correct even for an empty stream).
  Reject with 403 otherwise. Admins/superusers keep full `academic_year_id`/`grade_id`/whole-school
  access unchanged.
- **`PromotionReadinessAPIView`**: no permission change needed — it's already `rbac_view_permission`
  (read-only preview), open to any authenticated viewer with that permission, same as today.

### 6. Frontend — readiness table grouping + pagination

`PromotionReadinessAPIView`'s rows gain one new field, `stream_name` (`student.cl.name if
student.cl_id else None` — already available in the existing query, no new join). The frontend
groups `readiness.students` by `stream_name` (client-side, no new endpoint), rendering one
collapsible section per stream (visual pattern reused from Step 1's per-requirement-group
layout), each internally paginated at 15 rows via MUI `Pagination`.

### 7. Frontend — Quick Override & Record National Exam as modals

Both sections become a `Card` with just a title/subheader and an "Open" `Button` that launches
a MUI `Dialog`. Inside the Quick Override dialog: an `Autocomplete`-driven search with an
additional A–Z `ToggleButtonGroup` row (clicking a letter filters the student list to names
starting with it — client-side filter over the already-fetched `students` list, no new
endpoint), the existing check/promote flow, and the new "Recent promotions for this student"
list from `PromotionEventsAPIView` with a Revert button where `can_revert` is true. The Record
National Exam dialog keeps its existing form, with its student/stream options now filtered by
Goal 6 below.

### 8. Frontend — Record National Exam picker filtering

The panel already fetches `/api/academic-hub/` for `grades`/`streams` and `/api/core/curriculum/tiers/`
for `tiers`. Add a client-side filter: only include a grade/stream in the exam-recording
picker if its `GradeLevel.tier` has a non-empty `exit_exam_code` (cross-referencing the already-
fetched `tiers` list by the grade's `curriculum_id`/tier relationship — if the existing
`/api/academic-hub/` grade objects don't carry a `tier_id`, add one to that response; check
during implementation whether it's already present before assuming a backend change is needed).

### 9. Frontend — caution styling

The Step 1/Step 2 "not yet satisfied" `Alert`s switch from their current styling to a more
overt warning treatment: `severity="warning"` with a filled (not outlined) variant, a larger
icon, and a left border accent — standard MUI warning-`Alert` treatment, no new component.

## Data flow

1. Admin finalizes a term → `results_finalized_at` set (unchanged) → 12h un-finalize clock
   starts.
2. Admin or class teacher runs promotion (their own stream, if not admin) → `_promote_student`
   succeeds → `PromotionEvent` row written → 12h revert clock starts for that event.
3. Admin opens Quick Override, searches the student, sees their recent `PromotionEvent`s → within
   12h (or always, if superuser), clicks Revert → student's `cl`/`enrollment_state` restored,
   any newly-created pathway selection deleted, event marked reverted.
4. A class teacher can immediately re-run promotion for that same student/stream after a revert
   (or after any other correction) — re-running is not itself time-limited.

## Error handling

- All new 403s carry a plain-language reason (see code blocks above) — matching this panel's
  existing convention of surfacing `err.response?.data?.error` directly in an `Alert`.
- Reverting an already-reverted event → 400, not 403 (distinct from a permission failure).
- `PromotionRevertAPIView`/`PromotionEventsAPIView` on an unknown `event_id`/`student_id` →
  404, matching every other view in this file.

## Testing

- New `school/tests/test_promotion_events.py` (or extend `test_promotion_readiness.py`):
  `PromotionEvent` correctly captures `previous_cl`/`previous_enrollment_state` for a plain
  promotion, `previous_cl=None` for a graduation; `created_pathway_selection` is set only when
  `update_or_create` actually created a row, never when it updated a pre-existing one.
- `PromotionRevertAPIView`: happy path restores exact prior state (including deleting the
  created pathway selection and NOT deleting a pre-existing one); 403 for non-admin; 403 for
  admin past 12h; superuser succeeds past 12h; 400 for a re-revert attempt.
- `PromotionEventsAPIView`: `can_revert` computed correctly for admin-within-window,
  admin-past-window, superuser, non-admin.
- `FinalizeTermAPIView`: un-finalize 403 for non-admin, 403 for admin past 12h, success for
  admin within 12h, success for superuser regardless of elapsed time; finalize itself
  unaffected.
- `PromoteSingleStudentAPIView`/`PromoteStudentsAPIView`: class teacher can promote their own
  student/stream, 403 for a different stream, admin/superuser unrestricted; bulk without
  `stream_id` from a non-admin is rejected.
- Regression: existing `test_promotion.py`/`test_promotion_readiness.py` suites stay green.
- Frontend: no test suite exists for this panel — manual QA as usual, called out explicitly in
  the implementation plan.

## Critical files

- `apps/students/models.py` (new `PromotionEvent`)
- `apps/students/migrations/0005_promotionevent.py` (new, hand-written per this repo's
  migrations-are-manual rule — not run during implementation)
- `school/views/promotion_views.py` (`_promote_student` write, `PromotionRevertAPIView`,
  `PromotionEventsAPIView`, `FinalizeTermAPIView` gating, class-teacher scoping on both
  promote endpoints, `stream_name` field)
- `schoolmanagement/Urls/urls.py` (two new routes)
- `frontend/src/components/results/PromotionPanel.tsx` (grouped/paginated readiness table,
  Quick Override and Record National Exam as modals, caution styling)
- `school/tests/test_promotion_events.py` (new)
