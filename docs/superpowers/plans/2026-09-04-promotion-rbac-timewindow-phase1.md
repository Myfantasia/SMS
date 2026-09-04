# Promotion RBAC & Time-Window Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add role-based access control and a genuinely new "undo a promotion" capability to the promotion process — only Administrators can finalize/revert (revert within 12 hours unless superuser), class teachers get unrestricted-but-scoped promotion rights for their own stream, and the panel's UX catches up (grouped/paginated readiness table, Quick Override and Record National Exam as modals with real search, exam-gated-only picker filtering, real caution styling).

**Architecture:** A new `PromotionEvent` model records exactly what `_promote_student` did to each student, giving both the 12-hour correction window and the revert action something concrete to work from. Two new endpoints (`PromotionRevertAPIView`, `PromotionEventsAPIView`) and one shared time-window helper (`_can_still_correct`) sit alongside the existing promotion views, reusing this repo's established inline-permission-check convention rather than a new abstraction. The frontend changes are additive to the already-shipped `PromotionPanel.tsx` — grouping/pagination, two cards becoming modals, and a client-side picker filter — no new backend endpoints needed for those.

**Tech Stack:** Django 6 / DRF (backend), React + TypeScript + MUI (`@mui/material`) + `lucide-react` icons (frontend).

**Spec:** `docs/superpowers/specs/2026-09-04-promotion-rbac-timewindow-phase1-design.md`

## Global Constraints

- No changes to `_determine_transition`, `results_finalized_for_year`, or the existing field shapes already returned by `PromotionReadinessAPIView`/`PromotionPrerequisitesAPIView` — only additive fields.
- `_promote_student` IS being touched in this plan (Task 1) — this is a deliberate, explicitly-scoped exception to the two prior promotion specs' non-goals; the change is additive (one new DB write per success path, no change to the function's return value or control flow for existing callers).
- Every permission check follows this repo's established inline-check convention (`_is_admin(user)` / `is_class_teacher_of_student(user, student)` from `school/rbac.py` and `school/views/subject_views.py`) — no new DRF object-permission class.
- Never run `makemigrations`/`migrate` — write migration files by hand, do not run them.
- New/modified endpoints use `rbac_view_permission='results.view'` (read-only) or `rbac_edit_permission='results.edit'` (mutating), matching every existing view in `school/views/promotion_views.py`.
- `git add` only the exact files each task lists — never `git add -A`/`git add .` (this repo's working tree is shared with concurrent Claude Code sessions).

---

### Task 1: `PromotionEvent` model, migration, and `_promote_student` recording

**Files:**
- Modify: `apps/students/models.py` (append new model after `NationalExamRecord`, currently ending at line 143)
- Create: `apps/students/migrations/0005_promotionevent.py`
- Modify: `school/views/promotion_views.py` (imports; `_carry_forward_pathway_selection`; `_move_student_to_grade`; `_promote_student`)
- Modify: `orchestration/tasks.py` (`promote_students_task`'s call to `_promote_student`)
- Test: `school/tests/test_promotion.py`

**Interfaces:**
- Produces: `apps.students.models.PromotionEvent` — fields `student` (FK `identity.StudentExtra`), `academic_year` (FK `academics.AcademicYear`), `outcome` (`'promoted'|'graduated'`), `previous_cl` (FK `academics.ClassStream`, nullable), `previous_enrollment_state` (`CharField`), `created_pathway_selection` (FK `StudentPathwaySelection`, nullable), `performed_by`/`reverted_by` (FK `User`, nullable), `performed_at` (`auto_now_add`, indexed), `reverted_at` (nullable).
- Produces: `_promote_student(student, academic_year, performed_by_id=None)` — same return shape as before (`{'student_id', 'outcome', 'detail'}`), now also writes exactly one `PromotionEvent` row per non-`'held'` outcome. Tasks 2-6 read/write this model and this new kwarg.

- [ ] **Step 1: Write the failing tests**

Append to `school/tests/test_promotion.py` (after the last line, currently line 514, right after `PromoteStudentSSSPathwayCarryForwardTests`):

```python
from apps.students.models import PromotionEvent


class PromotionEventRecordingTests(TestCase):
    def setUp(self):
        self.curriculum = Curriculum.objects.create(code='PEV1', name='Promotion Event Test Curriculum')
        self.tier = Tier.objects.create(curriculum=self.curriculum, name='Lower Primary', code='LPPEV1')
        self.grade1 = GradeLevel.objects.create(name='Grade 1PEV', numeric_order=1, curriculum=self.curriculum, tier=self.tier)
        self.grade2 = GradeLevel.objects.create(name='Grade 2PEV', numeric_order=2, curriculum=self.curriculum, tier=self.tier)
        self.stream1 = ClassStream.objects.create(name='Central', grade=self.grade1)

        self.exit_tier = Tier.objects.create(
            curriculum=self.curriculum, name='Senior Secondary', code='SSPEV1',
            exit_exam_code='KCSE', exit_is_terminal=True,
        )
        self.grade12 = GradeLevel.objects.create(name='Grade 12PEV', numeric_order=12, curriculum=self.curriculum, tier=self.exit_tier)
        self.stream12 = ClassStream.objects.create(name='Central', grade=self.grade12)

        self.year = AcademicYear.objects.create(year='2101')
        ExamTerm.objects.create(
            name='Term 1', academic_year=self.year, start_date='2101-01-01', end_date='2101-04-01',
            results_finalized=True,
        )

        self.operator = User.objects.create_user(username='promotion_event_operator', password='x')

    def test_plain_promotion_records_previous_state(self):
        student_user = User.objects.create_user(username='pev_plain_student', password='x')
        student = StudentExtra.objects.create(user=student_user, roll='PV01', cl=self.stream1, status=True)

        result = _promote_student(student, self.year, performed_by_id=self.operator.id)

        self.assertEqual(result['outcome'], 'promoted')
        event = PromotionEvent.objects.get(student=student)
        self.assertEqual(event.outcome, 'promoted')
        self.assertEqual(event.previous_cl_id, self.stream1.id)
        self.assertEqual(event.previous_enrollment_state, 'Active')
        self.assertIsNone(event.created_pathway_selection_id)
        self.assertEqual(event.performed_by_id, self.operator.id)
        self.assertIsNone(event.reverted_at)

    def test_graduation_records_null_previous_cl(self):
        student_user = User.objects.create_user(username='pev_grad_student', password='x')
        student = StudentExtra.objects.create(user=student_user, roll='PV02', cl=self.stream12, status=True)
        NationalExamRecord.objects.create(student=student, exam_code='KCSE', academic_year=self.year)

        result = _promote_student(student, self.year, performed_by_id=self.operator.id)

        self.assertEqual(result['outcome'], 'graduated')
        event = PromotionEvent.objects.get(student=student)
        self.assertEqual(event.outcome, 'graduated')
        self.assertIsNone(event.previous_cl_id)
        self.assertEqual(event.previous_enrollment_state, 'Active')

    def test_held_outcome_writes_no_event(self):
        student_user = User.objects.create_user(username='pev_held_student', password='x')
        unfinalized_year = AcademicYear.objects.create(year='2102')
        student = StudentExtra.objects.create(user=student_user, roll='PV03', cl=self.stream1, status=True)

        result = _promote_student(student, unfinalized_year, performed_by_id=self.operator.id)

        self.assertEqual(result['outcome'], 'held')
        self.assertFalse(PromotionEvent.objects.filter(student=student).exists())

    def test_pathway_carry_forward_creates_event_with_created_selection(self):
        # Mirrors PromoteStudentSSSPathwayCarryForwardTests' setup, but only checks the
        # PromotionEvent side -- the pathway-carry-forward behavior itself is already covered.
        sss_tier = Tier.objects.create(curriculum=self.curriculum, name='Senior Secondary Carry', code='SSCPEV1')
        g10 = GradeLevel.objects.create(name='Grade 10PEV', numeric_order=10, curriculum=self.curriculum, tier=sss_tier)
        g11 = GradeLevel.objects.create(name='Grade 11PEV', numeric_order=11, curriculum=self.curriculum, tier=sss_tier)
        stream10 = ClassStream.objects.create(name='Gold', grade=g10)
        pathway = Pathway.objects.create(curriculum=self.curriculum, name='STEM PEV')
        track = Track.objects.create(pathway=pathway, name='Pure Sciences PEV')

        new_year = AcademicYear.objects.create(year='2103')
        ExamTerm.objects.create(
            name='Term 1', academic_year=new_year, start_date='2103-01-01', end_date='2103-04-01',
            results_finalized=True,
        )
        student_user = User.objects.create_user(username='pev_pathway_student', password='x')
        student = StudentExtra.objects.create(user=student_user, roll='PV04', cl=stream10, status=True)
        StudentPathwaySelection.objects.create(
            student=student, pathway=pathway, track=track, academic_year=self.year, status='Approved',
        )

        result = _promote_student(student, new_year, performed_by_id=self.operator.id)

        self.assertEqual(result['outcome'], 'promoted')
        event = PromotionEvent.objects.get(student=student)
        new_selection = StudentPathwaySelection.objects.get(student=student, academic_year=new_year)
        self.assertEqual(event.created_pathway_selection_id, new_selection.id)

    def test_pathway_carry_forward_does_not_attribute_an_updated_selection(self):
        # If a StudentPathwaySelection already existed for the target year (e.g. re-running
        # promotion after a correction), _carry_forward_pathway_selection updates it rather
        # than creating it -- created_pathway_selection must stay None so a later revert never
        # deletes a row that predates this promotion.
        sss_tier = Tier.objects.create(curriculum=self.curriculum, name='Senior Secondary Update', code='SSUPEV1')
        g10 = GradeLevel.objects.create(name='Grade 10UPEV', numeric_order=10, curriculum=self.curriculum, tier=sss_tier)
        g11 = GradeLevel.objects.create(name='Grade 11UPEV', numeric_order=11, curriculum=self.curriculum, tier=sss_tier)
        stream10 = ClassStream.objects.create(name='Gold', grade=g10)
        pathway = Pathway.objects.create(curriculum=self.curriculum, name='STEM UPEV')
        track = Track.objects.create(pathway=pathway, name='Pure Sciences UPEV')

        new_year = AcademicYear.objects.create(year='2104')
        ExamTerm.objects.create(
            name='Term 1', academic_year=new_year, start_date='2104-01-01', end_date='2104-04-01',
            results_finalized=True,
        )
        student_user = User.objects.create_user(username='pev_update_student', password='x')
        student = StudentExtra.objects.create(user=student_user, roll='PV05', cl=stream10, status=True)
        StudentPathwaySelection.objects.create(
            student=student, pathway=pathway, track=track, academic_year=self.year, status='Approved',
        )
        # Pre-existing selection for the TARGET year -- update_or_create will update this, not create.
        StudentPathwaySelection.objects.create(
            student=student, pathway=pathway, track=track, academic_year=new_year, status='Approved',
        )

        _promote_student(student, new_year, performed_by_id=self.operator.id)

        event = PromotionEvent.objects.get(student=student)
        self.assertIsNone(event.created_pathway_selection_id)
```

Add `from apps.academics.models import Pathway, Track` to the imports available for this new class if not already in scope at this point in the file (they are already imported earlier in the file at line 122 — `from apps.academics.models import Pathway, Track, PresetCombination, Subject` — Python module-level imports anywhere in the file are available everywhere in it, so no new import line is needed; `StudentPathwaySelection` is likewise already imported at line 418).

- [ ] **Step 2: Run the tests to verify they fail**

```bash
DB_NAME=school_db_task1check ./venv/bin/python manage.py test school.tests.test_promotion.PromotionEventRecordingTests --noinput -v 2
```

Expected: FAIL / ERROR — `PromotionEvent` doesn't exist yet, and `_promote_student` doesn't accept `performed_by_id`.

- [ ] **Step 3: Add the `PromotionEvent` model**

Append to `apps/students/models.py` (after the final line, currently 143):

```python


class PromotionEvent(models.Model):
    """
    Written by _promote_student (school/views/promotion_views.py) on every successful
    promotion or graduation -- never on a 'held' outcome. Captures enough of the student's
    pre-promotion state to support a full revert, and performed_at is what the 12-hour
    Administrator correction window (PromotionRevertAPIView, _can_still_correct) measures
    against.
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
        'StudentPathwaySelection', on_delete=models.SET_NULL, null=True, blank=True, related_name='+',
        help_text="Set only if this promotion created a new StudentPathwaySelection row via "
                   "_carry_forward_pathway_selection (SSS grades). Reverting deletes exactly "
                   "this row and nothing else -- an already-existing selection for the target "
                   "year is left untouched.",
    )

    performed_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    performed_at = models.DateTimeField(auto_now_add=True, db_index=True)
    reverted_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    reverted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'school_promotionevent'

    def __str__(self):
        return f"{self.student.get_name} - {self.outcome} ({self.academic_year.year})"
```

- [ ] **Step 4: Write the migration**

Create `apps/students/migrations/0005_promotionevent.py`:

```python
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('academics', '0008_classstream_deleted_at_classstream_deleted_by_and_more'),
        ('identity', '0008_auth_user_trigram_indexes'),
        ('students', '0004_nationalexamrecord'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='PromotionEvent',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('outcome', models.CharField(choices=[('promoted', 'Promoted'), ('graduated', 'Graduated')], max_length=10)),
                ('previous_enrollment_state', models.CharField(max_length=20)),
                ('performed_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('reverted_at', models.DateTimeField(blank=True, null=True)),
                ('academic_year', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='academics.academicyear')),
                ('previous_cl', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to='academics.classstream')),
                ('created_pathway_selection', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to='students.studentpathwayselection')),
                ('performed_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to=settings.AUTH_USER_MODEL)),
                ('reverted_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to=settings.AUTH_USER_MODEL)),
                ('student', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='promotion_events', to='identity.studentextra')),
            ],
            options={
                'db_table': 'school_promotionevent',
            },
        ),
    ]
```

Do **not** run `makemigrations` or `migrate` — this file is the complete, correct output of what `makemigrations` would generate; running it is the user's own step later.

- [ ] **Step 5: Update `_carry_forward_pathway_selection`, `_move_student_to_grade`, and `_promote_student`**

In `school/views/promotion_views.py`, the import block currently reads:

```python
from apps.academics.models import (
    ExamTerm, GradeLevel, next_grade_level, get_or_create_class_stream, tier_requires_pathway_choice, AcademicYear,
)
from apps.identity.models import StudentExtra
from apps.students.models import NationalExamRecord, StudentPathwaySelection
```

Change the third line to:

```python
from apps.students.models import NationalExamRecord, StudentPathwaySelection, PromotionEvent
```

Find `_carry_forward_pathway_selection` (currently):

```python
def _carry_forward_pathway_selection(student, academic_year):
    """
    Clones the student's most recent Approved StudentPathwaySelection into the new academic_year
    (an SSS student's pathway/track/combo doesn't change on promotion, only their grade does),
    then re-approves the combo's subjects and re-runs the core-math guarantee for the new year.
    """
    previous = StudentPathwaySelection.objects.filter(
        student=student, status='Approved',
    ).exclude(academic_year=academic_year).order_by('-academic_year_id').first()
    if previous is None:
        return

    new_selection, _ = StudentPathwaySelection.objects.update_or_create(
        student=student, academic_year=academic_year,
        defaults={
            'pathway': previous.pathway, 'track': previous.track,
            'preset_combination': previous.preset_combination, 'status': 'Approved',
        },
    )
    if new_selection.preset_combination_id:
        _approve_combo_subjects(student, new_selection.preset_combination, academic_year)
        _ensure_core_mathematics(student, new_selection.preset_combination, academic_year)
```

Replace it with:

```python
def _carry_forward_pathway_selection(student, academic_year):
    """
    Clones the student's most recent Approved StudentPathwaySelection into the new academic_year
    (an SSS student's pathway/track/combo doesn't change on promotion, only their grade does),
    then re-approves the combo's subjects and re-runs the core-math guarantee for the new year.
    Returns (selection, created) -- created is True only when a brand-new row was written for
    this (student, academic_year) pair, which _promote_student needs to know before it's safe
    to attribute a PromotionEvent.created_pathway_selection to this promotion.
    """
    previous = StudentPathwaySelection.objects.filter(
        student=student, status='Approved',
    ).exclude(academic_year=academic_year).order_by('-academic_year_id').first()
    if previous is None:
        return None, False

    new_selection, created = StudentPathwaySelection.objects.update_or_create(
        student=student, academic_year=academic_year,
        defaults={
            'pathway': previous.pathway, 'track': previous.track,
            'preset_combination': previous.preset_combination, 'status': 'Approved',
        },
    )
    if new_selection.preset_combination_id:
        _approve_combo_subjects(student, new_selection.preset_combination, academic_year)
        _ensure_core_mathematics(student, new_selection.preset_combination, academic_year)
    return new_selection, created
```

Find `_move_student_to_grade` (currently):

```python
def _move_student_to_grade(student, next_grade, academic_year):
    """Reassigns cl to the same-named stream in next_grade, creating it if needed, and carries
    forward the pathway selection for SSS grades."""
    current_stream_name = student.cl.name
    new_stream = get_or_create_class_stream(next_grade, current_stream_name)
    student.cl = new_stream
    student.save(update_fields=['cl'])

    if tier_requires_pathway_choice(next_grade.tier):
        _carry_forward_pathway_selection(student, academic_year)
```

Replace it with:

```python
def _move_student_to_grade(student, next_grade, academic_year):
    """Reassigns cl to the same-named stream in next_grade, creating it if needed, and carries
    forward the pathway selection for SSS grades. Returns the StudentPathwaySelection created
    by this call (None if none was created -- either not an SSS grade, no previous selection to
    carry forward, or an existing selection for the target year was updated rather than
    created), for _promote_student to record on the resulting PromotionEvent."""
    current_stream_name = student.cl.name
    new_stream = get_or_create_class_stream(next_grade, current_stream_name)
    student.cl = new_stream
    student.save(update_fields=['cl'])

    if tier_requires_pathway_choice(next_grade.tier):
        selection, created = _carry_forward_pathway_selection(student, academic_year)
        return selection if created else None
    return None
```

Find `_promote_student` (currently):

```python
def _promote_student(student, academic_year):
    """
    Attempts to promote one student for `academic_year`.
    Returns {'student_id', 'outcome': 'promoted'|'graduated'|'held', 'detail': str}.
    Never raises for a normal "not ready yet" case — those are 'held', not errors.
    """
    readiness = _readiness_for_student(student, academic_year)
    if not readiness['ready']:
        return {'student_id': student.id, 'outcome': 'held', 'detail': readiness['reason']}

    transition_type, exam_code, next_grade = readiness['_transition']

    if transition_type in ('plain', 'exam_gated'):
        _move_student_to_grade(student, next_grade, academic_year)
        detail = f'Promoted to {next_grade.name}.' if transition_type == 'plain' \
            else f'Promoted to {next_grade.name} ({exam_code} recorded).'
        return {'student_id': student.id, 'outcome': 'promoted', 'detail': detail}

    # transition_type == 'exit'
    student.enrollment_state = 'Graduated'
    student.save(update_fields=['enrollment_state'])
    record = NationalExamRecord.objects.filter(student=student, exam_code=exam_code, academic_year=academic_year).first()
    destination = record.destination or 'not yet recorded'
    return {
        'student_id': student.id, 'outcome': 'graduated',
        'detail': f'Graduated ({exam_code} recorded). Destination: {destination}.',
    }
```

Replace it with:

```python
def _promote_student(student, academic_year, performed_by_id=None):
    """
    Attempts to promote one student for `academic_year`.
    Returns {'student_id', 'outcome': 'promoted'|'graduated'|'held', 'detail': str}.
    Never raises for a normal "not ready yet" case — those are 'held', not errors.

    `performed_by_id`: id of the user running this promotion (an admin, a class teacher, or
    a bulk job's operator_id). Recorded on the PromotionEvent written for every non-'held'
    outcome, so a later revert (PromotionRevertAPIView) and PromotionEventsAPIView's listing
    know who to credit.
    """
    readiness = _readiness_for_student(student, academic_year)
    if not readiness['ready']:
        return {'student_id': student.id, 'outcome': 'held', 'detail': readiness['reason']}

    transition_type, exam_code, next_grade = readiness['_transition']
    previous_cl = student.cl
    previous_enrollment_state = student.enrollment_state

    if transition_type in ('plain', 'exam_gated'):
        created_pathway_selection = _move_student_to_grade(student, next_grade, academic_year)
        detail = f'Promoted to {next_grade.name}.' if transition_type == 'plain' \
            else f'Promoted to {next_grade.name} ({exam_code} recorded).'
        PromotionEvent.objects.create(
            student=student, academic_year=academic_year, outcome='promoted',
            previous_cl=previous_cl, previous_enrollment_state=previous_enrollment_state,
            created_pathway_selection=created_pathway_selection, performed_by_id=performed_by_id,
        )
        return {'student_id': student.id, 'outcome': 'promoted', 'detail': detail}

    # transition_type == 'exit'
    student.enrollment_state = 'Graduated'
    student.save(update_fields=['enrollment_state'])
    record = NationalExamRecord.objects.filter(student=student, exam_code=exam_code, academic_year=academic_year).first()
    destination = record.destination or 'not yet recorded'
    PromotionEvent.objects.create(
        student=student, academic_year=academic_year, outcome='graduated',
        previous_cl=None, previous_enrollment_state=previous_enrollment_state,
        performed_by_id=performed_by_id,
    )
    return {
        'student_id': student.id, 'outcome': 'graduated',
        'detail': f'Graduated ({exam_code} recorded). Destination: {destination}.',
    }
```

- [ ] **Step 6: Update both callers to pass `performed_by_id`**

In `school/views/promotion_views.py`'s `PromoteSingleStudentAPIView.post`, find:

```python
        with transaction.atomic():
            outcome = _promote_student(student, academic_year)
```

Replace with:

```python
        with transaction.atomic():
            outcome = _promote_student(student, academic_year, performed_by_id=user.id)
```

In `orchestration/tasks.py`'s `promote_students_task`, find:

```python
            outcomes = [_promote_student(s, academic_year) for s in students]
```

Replace with:

```python
            outcomes = [_promote_student(s, academic_year, performed_by_id=operator_id) for s in students]
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
DB_NAME=school_db_task1check ./venv/bin/python manage.py test school.tests.test_promotion.PromotionEventRecordingTests --noinput -v 2
```

Expected: PASS — all 5 new tests.

- [ ] **Step 8: Run the full promotion suite as a regression check**

```bash
DB_NAME=school_db_task1check ./venv/bin/python manage.py test school.tests.test_promotion school.tests.test_promotion_readiness --noinput -v 2
./venv/bin/python manage.py check
```

Expected: all existing tests still PASS (including `PromoteStudentSSSPathwayCarryForwardTests`, which calls `_promote_student` without `performed_by_id` — the new kwarg defaults to `None`, so this must keep working unmodified), system check clean.

- [ ] **Step 9: Commit**

```bash
git add apps/students/models.py apps/students/migrations/0005_promotionevent.py school/views/promotion_views.py orchestration/tasks.py school/tests/test_promotion.py
git commit -m "feat(promotion): add PromotionEvent model, recorded on every promote/graduate"
```

---

### Task 2: Shared correction-window helper + `PromotionRevertAPIView`

**Depends on:** Task 1 (`PromotionEvent` model must exist and be committed).

**Files:**
- Modify: `school/views/promotion_views.py` (imports; new `_can_still_correct` helper; new `PromotionRevertAPIView` class)
- Modify: `schoolmanagement/Urls/urls.py` (one new route)
- Create: `school/tests/test_promotion_events.py`

**Interfaces:**
- Consumes: `PromotionEvent` (Task 1), `_is_admin` (existing, imported from `school.views.subject_views`).
- Produces: `_can_still_correct(user, performed_at, window_hours=12) -> bool` — `True` for a superuser unconditionally; for anyone else, `True` only if `performed_at` is not `None` and is within `window_hours` of now. Tasks 3 and 4 reuse this exact function. Produces `POST /api/promotion/revert/<int:event_id>/`.

- [ ] **Step 1: Write the failing tests**

Create `school/tests/test_promotion_events.py`:

```python
import json
from datetime import timedelta

from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import TestCase, RequestFactory
from django.utils import timezone

from apps.academics.models import AcademicYear, ClassStream, Curriculum, ExamTerm, GradeLevel, Tier
from apps.identity.models import Permission, Role, StudentExtra, UserRole
from apps.students.models import PromotionEvent
from school.tests.base import ExamTestDataMixin
from school.views.promotion_views import PromotionRevertAPIView, _promote_student


class PromotionRevertAPIViewTests(ExamTestDataMixin, TestCase):
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        Permission.objects.get_or_create(code='results.edit', defaults={'label': 'results.edit', 'module': 'results'})
        role = Role.objects.create(name='Revert Manager')
        role.permissions.set(Permission.objects.filter(code='results.edit'))
        UserRole.objects.create(user=cls.admin_user, role=role)
        UserRole.objects.create(user=cls.teacher_user, role=role)

        cls.curriculum = Curriculum.objects.create(code='PREV1', name='Revert Test Curriculum')
        cls.tier = Tier.objects.create(curriculum=cls.curriculum, name='Lower Primary', code='LPPREV1')
        cls.g1 = GradeLevel.objects.create(name='Grade 1PREV', numeric_order=1, curriculum=cls.curriculum, tier=cls.tier)
        cls.g2 = GradeLevel.objects.create(name='Grade 2PREV', numeric_order=2, curriculum=cls.curriculum, tier=cls.tier)
        cls.stream = ClassStream.objects.create(name='Central', grade=cls.g1)

        cls.year = AcademicYear.objects.create(year='2105')
        ExamTerm.objects.create(
            name='Term 1', academic_year=cls.year, start_date='2105-01-01', end_date='2105-04-01',
            results_finalized=True,
        )

    def setUp(self):
        cache.clear()
        self.factory = RequestFactory()

    def _promote_a_student(self, username, performed_by_id):
        user = User.objects.create_user(username=username, password='x')
        student = StudentExtra.objects.create(user=user, roll=username[:5].upper(), cl=self.stream, status=True)
        _promote_student(student, self.year, performed_by_id=performed_by_id)
        student.refresh_from_db()
        return student, PromotionEvent.objects.get(student=student)

    def _post(self, user, event_id):
        request = self.factory.post(f'/api/promotion/revert/{event_id}/')
        request.user = user
        request._dont_enforce_csrf_checks = True
        return PromotionRevertAPIView.as_view()(request, event_id=event_id)

    def test_admin_can_revert_within_window(self):
        student, event = self._promote_a_student('revert_admin_student', self.admin_user.id)
        self.assertNotEqual(student.cl_id, self.stream.id)  # promotion already moved them off stream

        response = self._post(self.admin_user, event.id)

        self.assertEqual(response.status_code, 200)
        student.refresh_from_db()
        self.assertEqual(student.cl_id, self.stream.id)
        self.assertEqual(student.enrollment_state, 'Active')
        event.refresh_from_db()
        self.assertIsNotNone(event.reverted_at)
        self.assertEqual(event.reverted_by_id, self.admin_user.id)

    def test_non_admin_cannot_revert(self):
        _, event = self._promote_a_student('revert_nonadmin_student', self.admin_user.id)
        no_role_user = User.objects.create_user(username='revert_no_role', password='x')

        response = self._post(no_role_user, event.id)

        self.assertEqual(response.status_code, 403)

    def test_admin_cannot_revert_past_the_window(self):
        _, event = self._promote_a_student('revert_expired_student', self.admin_user.id)
        event.performed_at = timezone.now() - timedelta(hours=13)
        event.save(update_fields=['performed_at'])

        response = self._post(self.admin_user, event.id)

        self.assertEqual(response.status_code, 403)

    def test_superuser_can_revert_past_the_window(self):
        _, event = self._promote_a_student('revert_superuser_student', self.admin_user.id)
        event.performed_at = timezone.now() - timedelta(hours=48)
        event.save(update_fields=['performed_at'])
        # ExamTestDataMixin's admin_user is created with is_superuser=True.

        response = self._post(self.admin_user, event.id)

        self.assertEqual(response.status_code, 200)

    def test_cannot_revert_twice(self):
        _, event = self._promote_a_student('revert_twice_student', self.admin_user.id)
        self._post(self.admin_user, event.id)

        response = self._post(self.admin_user, event.id)

        self.assertEqual(response.status_code, 400)

    def test_unknown_event_returns_404(self):
        response = self._post(self.admin_user, 999999)
        self.assertEqual(response.status_code, 404)
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
DB_NAME=school_db_task2check ./venv/bin/python manage.py test school.tests.test_promotion_events --noinput -v 2
```

Expected: FAIL / ERROR — `PromotionRevertAPIView` doesn't exist yet, and the URL doesn't resolve.

- [ ] **Step 3: Add `_can_still_correct` and `PromotionRevertAPIView`**

In `school/views/promotion_views.py`, the import block currently reads (after Task 1's change):

```python
"""
Grade promotion: plain (internal-results-gated), same-institution exam-gated (KPSEA), and
exit (cross-institution or terminal, KJSEA/KCSE) transitions. See
docs/superpowers/specs/2026-08-12-sss-core-math-and-promotion-design.md.
"""
from django.utils import timezone
from django.db import transaction
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

from apps.academics.models import (
    ExamTerm, GradeLevel, next_grade_level, get_or_create_class_stream, tier_requires_pathway_choice, AcademicYear,
)
from apps.identity.models import StudentExtra
from apps.students.models import NationalExamRecord, StudentPathwaySelection, PromotionEvent
from apps.core.services import write_audit_log
from school.rbac import HasModulePermission
from school.views.subject_views import _approve_combo_subjects, _ensure_core_mathematics
from school.jobs import dispatch_background_job
from orchestration.tasks import promote_students_task
```

Replace it with (adds `datetime.timedelta` and imports `_is_admin`):

```python
"""
Grade promotion: plain (internal-results-gated), same-institution exam-gated (KPSEA), and
exit (cross-institution or terminal, KJSEA/KCSE) transitions. See
docs/superpowers/specs/2026-08-12-sss-core-math-and-promotion-design.md.
"""
from datetime import timedelta

from django.utils import timezone
from django.db import transaction
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

from apps.academics.models import (
    ExamTerm, GradeLevel, next_grade_level, get_or_create_class_stream, tier_requires_pathway_choice, AcademicYear,
)
from apps.identity.models import StudentExtra
from apps.students.models import NationalExamRecord, StudentPathwaySelection, PromotionEvent
from apps.core.services import write_audit_log
from school.rbac import HasModulePermission
from school.views.subject_views import _approve_combo_subjects, _ensure_core_mathematics, _is_admin
from school.jobs import dispatch_background_job
from orchestration.tasks import promote_students_task
```

Add this helper right after `results_finalized_for_year` (currently ending at line 55, right before `def _carry_forward_pathway_selection`):

```python
def _can_still_correct(user, performed_at, window_hours=12):
    """
    True if `user` may still correct/undo something that happened at `performed_at`.
    A superuser always can. Anyone else needs to be within `window_hours` of `performed_at`
    (None -- nothing has happened yet -- is never within the window). This only measures the
    TIME part; admin standing itself is checked separately by each caller via _is_admin, since
    _is_admin already returns True for superusers, so composing `_is_admin(user) and
    _can_still_correct(user, performed_at)` correctly captures: superuser -> always allowed;
    non-superuser admin -> allowed only within the window; non-admin -> never allowed.
    """
    if user.is_superuser:
        return True
    if performed_at is None:
        return False
    return timezone.now() - performed_at <= timedelta(hours=window_hours)
```

Add this new view class right after `PromoteSingleStudentAPIView` (at the end of the file):

```python


class PromotionRevertAPIView(APIView):
    """
    Admin-only undo of a completed promotion/graduation, within 12 hours unless the requester
    is a superuser (see _can_still_correct). Restores previous_cl/previous_enrollment_state and
    deletes any StudentPathwaySelection this specific promotion created -- never a
    pre-existing one, since _promote_student only ever attributes created_pathway_selection
    when _carry_forward_pathway_selection actually created a fresh row.
    """
    permission_classes = [IsAuthenticated, HasModulePermission]
    authentication_classes = [SessionAuthentication]
    rbac_edit_permission = 'results.edit'

    def post(self, request, event_id):
        user = request.user
        try:
            event = PromotionEvent.objects.select_related('student', 'created_pathway_selection').get(id=event_id)
        except PromotionEvent.DoesNotExist:
            return Response({"error": "Promotion event not found."}, status=status.HTTP_404_NOT_FOUND)

        if event.reverted_at is not None:
            return Response({"error": "This promotion was already reverted."}, status=status.HTTP_400_BAD_REQUEST)

        if not _is_admin(user):
            return Response({"error": "Only Administrators can revert a promotion."}, status=status.HTTP_403_FORBIDDEN)
        if not _can_still_correct(user, event.performed_at):
            return Response(
                {"error": "The 12-hour window to revert this promotion has passed. "
                          "Only a superuser can revert it now."}, status=status.HTTP_403_FORBIDDEN,
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

- [ ] **Step 4: Add the URL route**

In `schoolmanagement/Urls/urls.py`, find the line registering `api/promotion/prerequisites/` (added by an earlier plan) and add immediately after it:

```python
    path('api/promotion/revert/<int:event_id>/', promotion_views.PromotionRevertAPIView.as_view(), name='promotion_revert'),
```

(If that exact anchor line has moved, add this route anywhere inside the `api/promotion/...` route group — it must sit alongside the other promotion routes.)

- [ ] **Step 5: Run the tests to verify they pass**

```bash
DB_NAME=school_db_task2check ./venv/bin/python manage.py test school.tests.test_promotion_events --noinput -v 2
```

Expected: PASS — all 6 tests.

- [ ] **Step 6: Run the full promotion suite as a regression check**

```bash
DB_NAME=school_db_task2check ./venv/bin/python manage.py test school.tests.test_promotion school.tests.test_promotion_readiness school.tests.test_promotion_events --noinput -v 2
./venv/bin/python manage.py check
```

Expected: all PASS, system check clean.

- [ ] **Step 7: Commit**

```bash
git add school/views/promotion_views.py schoolmanagement/Urls/urls.py school/tests/test_promotion_events.py
git commit -m "feat(promotion): add PromotionRevertAPIView with a 12-hour admin correction window"
```

---

### Task 3: `PromotionEventsAPIView`

**Depends on:** Task 2 (`_can_still_correct`, `PromotionEvent` must exist and be committed).

**Files:**
- Modify: `school/views/promotion_views.py` (new `PromotionEventsAPIView` class)
- Modify: `schoolmanagement/Urls/urls.py` (one new route)
- Test: `school/tests/test_promotion_events.py`

**Interfaces:**
- Consumes: `_can_still_correct` (Task 2), `PromotionEvent` (Task 1).
- Produces: `GET /api/promotion/events/?student_id=<id>` returning `{"events": [{"id", "outcome", "academic_year", "performed_at", "performed_by_name", "reverted_at", "can_revert"}, ...]}`, most-recent-first. Task 7 (frontend) consumes this exact shape.

- [ ] **Step 1: Write the failing tests**

Append to `school/tests/test_promotion_events.py` (at the end of the file):

```python
from school.views.promotion_views import PromotionEventsAPIView


class PromotionEventsAPIViewTests(ExamTestDataMixin, TestCase):
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        Permission.objects.get_or_create(code='results.view', defaults={'label': 'results.view', 'module': 'results'})
        role = Role.objects.create(name='Events Viewer')
        role.permissions.set(Permission.objects.filter(code='results.view'))
        UserRole.objects.create(user=cls.admin_user, role=role)
        UserRole.objects.create(user=cls.teacher_user, role=role)

        cls.curriculum = Curriculum.objects.create(code='PEVW1', name='Events View Test Curriculum')
        cls.tier = Tier.objects.create(curriculum=cls.curriculum, name='Lower Primary', code='LPPEVW1')
        cls.g1 = GradeLevel.objects.create(name='Grade 1PEVW', numeric_order=1, curriculum=cls.curriculum, tier=cls.tier)
        GradeLevel.objects.create(name='Grade 2PEVW', numeric_order=2, curriculum=cls.curriculum, tier=cls.tier)
        cls.stream = ClassStream.objects.create(name='Central', grade=cls.g1)
        cls.year = AcademicYear.objects.create(year='2106')
        ExamTerm.objects.create(
            name='Term 1', academic_year=cls.year, start_date='2106-01-01', end_date='2106-04-01',
            results_finalized=True,
        )

    def setUp(self):
        cache.clear()
        self.factory = RequestFactory()

    def _get(self, user, student_id):
        request = self.factory.get(f'/api/promotion/events/?student_id={student_id}')
        request.user = user
        return PromotionEventsAPIView.as_view()(request)

    def test_missing_student_id_is_rejected(self):
        request = self.factory.get('/api/promotion/events/')
        request.user = self.admin_user
        response = PromotionEventsAPIView.as_view()(request)
        self.assertEqual(response.status_code, 400)

    def test_unknown_student_returns_404(self):
        response = self._get(self.admin_user, 999999)
        self.assertEqual(response.status_code, 404)

    def test_admin_within_window_can_revert(self):
        student_user = User.objects.create_user(username='pev_view_student_a', password='x')
        student = StudentExtra.objects.create(user=student_user, roll='PVA1', cl=self.stream, status=True)
        _promote_student(student, self.year, performed_by_id=self.admin_user.id)

        response = self._get(self.admin_user, student.id)

        self.assertEqual(response.status_code, 200)
        events = response.data['events']
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]['outcome'], 'promoted')
        self.assertIsNone(events[0]['reverted_at'])
        self.assertTrue(events[0]['can_revert'])

    def test_non_admin_cannot_revert_even_within_window(self):
        student_user = User.objects.create_user(username='pev_view_student_b', password='x')
        student = StudentExtra.objects.create(user=student_user, roll='PVB1', cl=self.stream, status=True)
        _promote_student(student, self.year, performed_by_id=self.admin_user.id)

        response = self._get(self.teacher_user, student.id)

        self.assertFalse(response.data['events'][0]['can_revert'])

    def test_already_reverted_event_cannot_revert_again(self):
        student_user = User.objects.create_user(username='pev_view_student_c', password='x')
        student = StudentExtra.objects.create(user=student_user, roll='PVC1', cl=self.stream, status=True)
        _promote_student(student, self.year, performed_by_id=self.admin_user.id)
        event = PromotionEvent.objects.get(student=student)
        event.reverted_at = timezone.now()
        event.reverted_by = self.admin_user
        event.save(update_fields=['reverted_at', 'reverted_by'])

        response = self._get(self.admin_user, student.id)

        self.assertFalse(response.data['events'][0]['can_revert'])
        self.assertIsNotNone(response.data['events'][0]['reverted_at'])
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
DB_NAME=school_db_task3check ./venv/bin/python manage.py test school.tests.test_promotion_events.PromotionEventsAPIViewTests --noinput -v 2
```

Expected: FAIL / ERROR — `PromotionEventsAPIView` doesn't exist and the URL doesn't resolve.

- [ ] **Step 3: Add `PromotionEventsAPIView`**

Append to `school/views/promotion_views.py`, after `PromotionRevertAPIView` (at the end of the file):

```python


class PromotionEventsAPIView(APIView):
    """Read-only: a student's promotion/graduation history, each row annotated with whether
    the requesting user may revert it right now (see _can_still_correct)."""
    permission_classes = [IsAuthenticated, HasModulePermission]
    authentication_classes = [SessionAuthentication]
    rbac_view_permission = 'results.view'

    def get(self, request):
        student_id = request.query_params.get('student_id')
        if not student_id:
            return Response({"error": "student_id is required."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            student = StudentExtra.objects.get(id=student_id)
        except StudentExtra.DoesNotExist:
            return Response({"error": "Student not found."}, status=status.HTTP_404_NOT_FOUND)

        user = request.user
        events = PromotionEvent.objects.filter(student=student).select_related(
            'academic_year', 'performed_by',
        ).order_by('-performed_at')

        rows = []
        for event in events:
            can_revert = (
                event.reverted_at is None
                and _is_admin(user)
                and _can_still_correct(user, event.performed_at)
            )
            rows.append({
                'id': event.id,
                'outcome': event.outcome,
                'academic_year': event.academic_year.year,
                'performed_at': event.performed_at.isoformat(),
                'performed_by_name': (
                    (event.performed_by.get_full_name() or event.performed_by.username)
                    if event.performed_by else None
                ),
                'reverted_at': event.reverted_at.isoformat() if event.reverted_at else None,
                'can_revert': can_revert,
            })
        return Response({'events': rows})
```

- [ ] **Step 4: Add the URL route**

In `schoolmanagement/Urls/urls.py`, add immediately after the `api/promotion/revert/<int:event_id>/` route added in Task 2:

```python
    path('api/promotion/events/', promotion_views.PromotionEventsAPIView.as_view(), name='promotion_events'),
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
DB_NAME=school_db_task3check ./venv/bin/python manage.py test school.tests.test_promotion_events --noinput -v 2
```

Expected: PASS — all tests in the file (Task 2's + Task 3's).

- [ ] **Step 6: Run the full promotion suite as a regression check**

```bash
DB_NAME=school_db_task3check ./venv/bin/python manage.py test school.tests.test_promotion school.tests.test_promotion_readiness school.tests.test_promotion_events --noinput -v 2
./venv/bin/python manage.py check
```

Expected: all PASS, system check clean.

- [ ] **Step 7: Commit**

```bash
git add school/views/promotion_views.py schoolmanagement/Urls/urls.py school/tests/test_promotion_events.py
git commit -m "feat(promotion): add PromotionEventsAPIView for a student's promotion history"
```

---

### Task 4: `FinalizeTermAPIView` un-finalize gating

**Depends on:** Task 2 (`_can_still_correct`, `_is_admin` import must already be in the file).

**Files:**
- Modify: `school/views/promotion_views.py` (`FinalizeTermAPIView.post`)
- Test: `school/tests/test_promotion.py`

**Interfaces:**
- Consumes: `_can_still_correct`, `_is_admin` (both already imported into this file by Task 2).
- Produces: no new interface — same `FinalizeTermAPIView` endpoint, now with an added permission/time gate on the `finalized=False` branch only.

- [ ] **Step 1: Write the failing tests**

Add these two test methods to the existing `FinalizeTermAPIViewTests` class in `school/tests/test_promotion.py` (currently lines 559-580 — add these as new methods inside that class, after `test_can_un_finalize`):

```python
    def test_non_admin_cannot_un_finalize(self):
        self.term.results_finalized = True
        self.term.results_finalized_at = timezone.now()
        self.term.save()
        no_role_user = User.objects.create_user(username='finalize_no_role', password='x')
        response = self._post(
            FinalizeTermAPIView, f'/api/promotion/finalize-term/{self.term.id}/',
            no_role_user, {'finalized': False}, term_id=self.term.id,
        )
        self.assertEqual(response.status_code, 403)
        self.term.refresh_from_db()
        self.assertTrue(self.term.results_finalized)

    def test_admin_cannot_un_finalize_past_the_window(self):
        from datetime import timedelta
        self.term.results_finalized = True
        self.term.results_finalized_at = timezone.now() - timedelta(hours=13)
        self.term.save()
        response = self._post(
            FinalizeTermAPIView, f'/api/promotion/finalize-term/{self.term.id}/',
            self.admin_user, {'finalized': False}, term_id=self.term.id,
        )
        # ExamTestDataMixin's admin_user is a superuser, which is always exempt from the
        # window -- use a non-superuser Administrator to actually exercise the 12h block.
        self.assertEqual(response.status_code, 200)

        non_superuser_admin_user = User.objects.create_user(username='finalize_plain_admin', password='x')
        non_superuser_admin_user.groups.add(self.admin_group)
        self.term.results_finalized = True
        self.term.results_finalized_at = timezone.now() - timedelta(hours=13)
        self.term.save()
        response = self._post(
            FinalizeTermAPIView, f'/api/promotion/finalize-term/{self.term.id}/',
            non_superuser_admin_user, {'finalized': False}, term_id=self.term.id,
        )
        self.assertEqual(response.status_code, 403)
        self.term.refresh_from_db()
        self.assertTrue(self.term.results_finalized)
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
DB_NAME=school_db_task4check ./venv/bin/python manage.py test school.tests.test_promotion.FinalizeTermAPIViewTests --noinput -v 2
```

Expected: `test_non_admin_cannot_un_finalize` FAILs (currently any `results.edit` holder can un-finalize; `no_role_user` here has no role at all, so this actually already 403s today via `HasModulePermission` itself — check the failure message; if it already passes because of the existing permission-class gate, that's fine, note it in your report and move to `test_admin_cannot_un_finalize_past_the_window`, which WILL fail since no window check exists yet). `test_admin_cannot_un_finalize_past_the_window`'s second assertion (403 for the non-superuser admin past the window) FAILs — no such gate exists yet.

- [ ] **Step 3: Add the gating**

In `school/views/promotion_views.py`, find `FinalizeTermAPIView.post` (currently):

```python
    def post(self, request, term_id):
        try:
            term = ExamTerm.objects.get(id=term_id)
        except ExamTerm.DoesNotExist:
            return Response({"error": "Term not found."}, status=status.HTTP_404_NOT_FOUND)

        finalized = bool(request.data.get('finalized', True))
        term.results_finalized = finalized
        term.results_finalized_at = timezone.now() if finalized else None
        term.save(update_fields=['results_finalized', 'results_finalized_at'])
```

Replace with:

```python
    def post(self, request, term_id):
        try:
            term = ExamTerm.objects.get(id=term_id)
        except ExamTerm.DoesNotExist:
            return Response({"error": "Term not found."}, status=status.HTTP_404_NOT_FOUND)

        finalized = bool(request.data.get('finalized', True))

        if not finalized:
            if not _is_admin(request.user):
                return Response(
                    {"error": "Only Administrators can un-finalize a term."}, status=status.HTTP_403_FORBIDDEN,
                )
            if not _can_still_correct(request.user, term.results_finalized_at):
                return Response(
                    {"error": "The 12-hour window to un-finalize this term has passed. "
                              "Only a superuser can un-finalize it now."}, status=status.HTTP_403_FORBIDDEN,
                )

        term.results_finalized = finalized
        term.results_finalized_at = timezone.now() if finalized else None
        term.save(update_fields=['results_finalized', 'results_finalized_at'])
```

Also update the class docstring, currently:

```python
class FinalizeTermAPIView(APIView):
    """Admin toggle for ExamTerm.results_finalized — purely informational, does not block
    result regeneration (see Task 2/spec §2)."""
```

Replace with:

```python
class FinalizeTermAPIView(APIView):
    """Admin toggle for ExamTerm.results_finalized — purely informational, does not block
    result regeneration. Finalizing has no restriction beyond the base results.edit
    permission; un-finalizing is Administrator-only and time-boxed to 12 hours after the
    last finalize, unless the requester is a superuser (see _can_still_correct)."""
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
DB_NAME=school_db_task4check ./venv/bin/python manage.py test school.tests.test_promotion.FinalizeTermAPIViewTests --noinput -v 2
```

Expected: PASS — all tests in the class, including the two new ones and the pre-existing `test_admin_can_finalize_term`/`test_can_un_finalize` (both use the superuser `admin_user`, so they're unaffected by the new window check).

- [ ] **Step 5: Run the full promotion suite as a regression check**

```bash
DB_NAME=school_db_task4check ./venv/bin/python manage.py test school.tests.test_promotion school.tests.test_promotion_readiness school.tests.test_promotion_events --noinput -v 2
./venv/bin/python manage.py check
```

Expected: all PASS, system check clean.

- [ ] **Step 6: Commit**

```bash
git add school/views/promotion_views.py school/tests/test_promotion.py
git commit -m "feat(promotion): gate un-finalize to Administrators within a 12-hour window"
```

---

### Task 5: Class-teacher scoping on promotion endpoints

**Depends on:** Task 1 (both call sites this task touches were already edited by Task 1 to add `performed_by_id=...` — this task edits the permission-check lines around those calls, not the calls themselves).

**Files:**
- Modify: `school/views/promotion_views.py` (imports; `PromoteSingleStudentAPIView.post`; `PromoteStudentsAPIView.post`)
- Test: `school/tests/test_promotion.py`, `school/tests/test_promotion_readiness.py`

**Interfaces:**
- Consumes: `_is_admin` (already imported by Task 2), `is_class_teacher_of_student` (`school.rbac`, not yet imported into this file — add it).
- Produces: no new interface — same two endpoints, `PromoteSingleStudentAPIView` now also allows a student's own class teacher (not just admins), `PromoteStudentsAPIView` now also allows a class teacher scoped to their own `stream_id`.

- [ ] **Step 1: Write the failing tests**

First, `PromotionAdminEndpointTestMixin` (`school/tests/test_promotion.py`, currently lines 529-537) only grants the `results.edit`/`results.view` role to `cls.admin_user` — `cls.teacher_user` has no RBAC permission at all yet, so every request from it is rejected by `HasModulePermission` itself before your new class-teacher logic is ever reached. The new tests below need `teacher_user` to actually reach that logic. Find:

```python
class PromotionAdminEndpointTestMixin(ExamTestDataMixin):
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        Permission.objects.get_or_create(code='results.edit', defaults={'label': 'results.edit', 'module': 'results'})
        Permission.objects.get_or_create(code='results.view', defaults={'label': 'results.view', 'module': 'results'})
        role = Role.objects.create(name='Results Manager')
        role.permissions.set(Permission.objects.filter(code__in=('results.edit', 'results.view')))
        UserRole.objects.create(user=cls.admin_user, role=role)
```

Replace with:

```python
class PromotionAdminEndpointTestMixin(ExamTestDataMixin):
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        Permission.objects.get_or_create(code='results.edit', defaults={'label': 'results.edit', 'module': 'results'})
        Permission.objects.get_or_create(code='results.view', defaults={'label': 'results.view', 'module': 'results'})
        role = Role.objects.create(name='Results Manager')
        role.permissions.set(Permission.objects.filter(code__in=('results.edit', 'results.view')))
        UserRole.objects.create(user=cls.admin_user, role=role)
        # Granted here (not just to admin_user) so class-teacher-scoped tests can reach the
        # actual business logic in PromoteStudentsAPIView/PromoteSingleStudentAPIView instead
        # of being short-circuited by HasModulePermission's module-level RBAC gate first.
        UserRole.objects.create(user=cls.teacher_user, role=role)
```

Now add these three methods to `PromoteStudentsAPIViewTests` in the same file (currently lines 616-644 — add after `test_scope_with_only_a_graduated_student_returns_404`):

```python
    @override_settings(CELERY_TASK_ALWAYS_EAGER=True)
    def test_class_teacher_can_promote_their_own_stream(self):
        self.term.results_finalized = True
        self.term.save()
        self.stream_cbc.class_teacher = self.teacher
        self.stream_cbc.save(update_fields=['class_teacher'])
        response = self._post(
            PromoteStudentsAPIView, '/api/promotion/promote-students/',
            self.teacher_user, {'academic_year_id': self.year.id, 'stream_id': self.stream_cbc.id},
        )
        self.assertEqual(response.status_code, 202)

    def test_class_teacher_cannot_promote_a_different_stream(self):
        other_stream = ClassStream.objects.create(name='Other', grade=self.grade9)
        response = self._post(
            PromoteStudentsAPIView, '/api/promotion/promote-students/',
            self.teacher_user, {'academic_year_id': self.year.id, 'stream_id': other_stream.id},
        )
        self.assertEqual(response.status_code, 403)

    def test_class_teacher_without_stream_id_is_rejected(self):
        response = self._post(
            PromoteStudentsAPIView, '/api/promotion/promote-students/',
            self.teacher_user, {'academic_year_id': self.year.id, 'grade_id': self.grade9.id},
        )
        self.assertEqual(response.status_code, 403)
```

(`self.stream_cbc` and `self.grade9` come from `ExamTestDataMixin`/`PromotionAdminEndpointTestMixin` respectively — `stream_cbc` already has an enrolled active student per the mixin's own setup, so the promotion job has real work to do.)

Add this new test class to `school/tests/test_promotion_readiness.py`, at the end of the file (after `PromoteSingleStudentAPIViewTests`):

```python
class PromoteSingleStudentClassTeacherScopingTests(ExamTestDataMixin, TestCase):
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        Permission.objects.get_or_create(code='results.edit', defaults={'label': 'results.edit', 'module': 'results'})
        role = Role.objects.create(name='Class Teacher Promote')
        role.permissions.set(Permission.objects.filter(code='results.edit'))
        UserRole.objects.create(user=cls.teacher_user, role=role)

        cls.curriculum = Curriculum.objects.create(code='PCTS1', name='Class Teacher Scoping Curriculum')
        cls.tier = Tier.objects.create(curriculum=cls.curriculum, name='Lower Primary', code='LPPCTS1')
        cls.g1 = GradeLevel.objects.create(name='Grade 1PCTS', numeric_order=1, curriculum=cls.curriculum, tier=cls.tier)
        GradeLevel.objects.create(name='Grade 2PCTS', numeric_order=2, curriculum=cls.curriculum, tier=cls.tier)
        cls.own_stream = ClassStream.objects.create(name='Own', grade=cls.g1, class_teacher=cls.teacher)
        cls.other_stream = ClassStream.objects.create(name='Other', grade=cls.g1)

        cls.year = AcademicYear.objects.create(year='2107')
        ExamTerm.objects.create(
            name='Term 1', academic_year=cls.year, start_date='2107-01-01', end_date='2107-04-01',
            results_finalized=True,
        )

        own_user = User.objects.create_user(username='pcts_own_student', password='x')
        cls.own_student = StudentExtra.objects.create(user=own_user, roll='CTS1', cl=cls.own_stream, status=True)
        other_user = User.objects.create_user(username='pcts_other_student', password='x')
        cls.other_student = StudentExtra.objects.create(user=other_user, roll='CTS2', cl=cls.other_stream, status=True)

    def setUp(self):
        cache.clear()
        self.factory = RequestFactory()

    def _post(self, user, student_id):
        request = self.factory.post(
            f'/api/promotion/promote-student/{student_id}/',
            data=json.dumps({'academic_year_id': self.year.id}), content_type='application/json',
        )
        request.user = user
        request._dont_enforce_csrf_checks = True
        return PromoteSingleStudentAPIView.as_view()(request, student_id=student_id)

    def test_class_teacher_can_promote_own_student(self):
        response = self._post(self.teacher_user, self.own_student.id)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['outcome'], 'promoted')

    def test_class_teacher_cannot_promote_other_student(self):
        response = self._post(self.teacher_user, self.other_student.id)
        self.assertEqual(response.status_code, 403)
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
DB_NAME=school_db_task5check ./venv/bin/python manage.py test school.tests.test_promotion.PromoteStudentsAPIViewTests school.tests.test_promotion_readiness.PromoteSingleStudentClassTeacherScopingTests --noinput -v 2
```

Expected: FAIL — every new test gets 403 today (single-student promote is still admin-only; bulk's `test_class_teacher_can_promote_their_own_stream` gets 403 since no class-teacher path exists yet).

- [ ] **Step 3: Add the imports**

In `school/views/promotion_views.py`, find (as left by Task 2):

```python
from school.rbac import HasModulePermission
from school.views.subject_views import _approve_combo_subjects, _ensure_core_mathematics, _is_admin
```

Replace with:

```python
from apps.academics.models import ClassStream
from school.rbac import HasModulePermission, is_class_teacher_of_student
from school.views.subject_views import _approve_combo_subjects, _ensure_core_mathematics, _is_admin
```

(`ClassStream` is added as a standalone import line here rather than folded into the existing multi-line `apps.academics.models` import block above it, to keep this diff minimal and unambiguous — either placement is fine; just don't import it twice.)

- [ ] **Step 4: Scope `PromoteSingleStudentAPIView`**

Find (as left by Task 1's Step 6):

```python
    def post(self, request, student_id):
        user = request.user
        is_admin = user.is_superuser or user.groups.filter(name='ADMIN').exists()
        if not is_admin:
            return Response({"error": "Only Administrators can promote a student."}, status=status.HTTP_403_FORBIDDEN)

        academic_year_id = request.data.get('academic_year_id')
        if not academic_year_id:
            return Response({"error": "academic_year_id is required."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            academic_year = AcademicYear.objects.get(id=academic_year_id)
        except AcademicYear.DoesNotExist:
            return Response({"error": "Academic year not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            student = StudentExtra.objects.select_related('cl__grade__tier').get(id=student_id)
        except StudentExtra.DoesNotExist:
            return Response({"error": "Student not found."}, status=status.HTTP_404_NOT_FOUND)

        with transaction.atomic():
            outcome = _promote_student(student, academic_year, performed_by_id=user.id)
```

Replace with:

```python
    def post(self, request, student_id):
        user = request.user
        academic_year_id = request.data.get('academic_year_id')
        if not academic_year_id:
            return Response({"error": "academic_year_id is required."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            academic_year = AcademicYear.objects.get(id=academic_year_id)
        except AcademicYear.DoesNotExist:
            return Response({"error": "Academic year not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            student = StudentExtra.objects.select_related('cl__grade__tier').get(id=student_id)
        except StudentExtra.DoesNotExist:
            return Response({"error": "Student not found."}, status=status.HTTP_404_NOT_FOUND)

        if not (_is_admin(user) or is_class_teacher_of_student(user, student)):
            return Response(
                {"error": "Only Administrators, or this student's own class teacher, can promote them."},
                status=status.HTTP_403_FORBIDDEN,
            )

        with transaction.atomic():
            outcome = _promote_student(student, academic_year, performed_by_id=user.id)
```

(The rest of the method, including the `write_audit_log` call and `return Response(outcome, ...)`, is unchanged.)

- [ ] **Step 5: Scope `PromoteStudentsAPIView`**

Find:

```python
        if not academic_year_id:
            return Response({"error": "academic_year_id is mandatory."}, status=status.HTTP_400_BAD_REQUEST)

        user = request.user
        is_admin = user.is_superuser or user.groups.filter(name='ADMIN').exists()
        if not is_admin:
            return Response({"error": "Only Administrators can run a bulk promotion."}, status=status.HTTP_403_FORBIDDEN)

        students_qs = StudentExtra.objects.filter(status=True).exclude(
            enrollment_state__in=['Graduated', 'Expelled', 'Transferred']
        )
```

Replace with:

```python
        if not academic_year_id:
            return Response({"error": "academic_year_id is mandatory."}, status=status.HTTP_400_BAD_REQUEST)

        user = request.user
        if not _is_admin(user):
            if not stream_id:
                return Response(
                    {"error": "Only Administrators can run a whole-grade or whole-school promotion. "
                              "A class teacher must select their own stream."}, status=status.HTTP_403_FORBIDDEN,
                )
            if not ClassStream.objects.filter(id=stream_id, class_teacher__user=user).exists():
                return Response(
                    {"error": "You can only run promotion for a class you are the class teacher of."},
                    status=status.HTTP_403_FORBIDDEN,
                )

        students_qs = StudentExtra.objects.filter(status=True).exclude(
            enrollment_state__in=['Graduated', 'Expelled', 'Transferred']
        )
```

(The rest of the method — the `stream_id`/`grade_id` filtering below this block, the job dispatch — is unchanged; `stream_id` is already read from `request.data` earlier in this method, so no new variable needs introducing.)

- [ ] **Step 6: Run the tests to verify they pass**

```bash
DB_NAME=school_db_task5check ./venv/bin/python manage.py test school.tests.test_promotion.PromoteStudentsAPIViewTests school.tests.test_promotion_readiness.PromoteSingleStudentAPIViewTests school.tests.test_promotion_readiness.PromoteSingleStudentClassTeacherScopingTests --noinput -v 2
```

Expected: PASS — all tests, including the pre-existing `PromoteSingleStudentAPIViewTests` (its `test_non_admin_cannot_promote` uses a plain `teacher_user` with no class-teacher relationship to that test's student, so it still correctly gets 403 under the new `is_class_teacher_of_student` check).

- [ ] **Step 7: Run the full promotion suite as a regression check**

```bash
DB_NAME=school_db_task5check ./venv/bin/python manage.py test school.tests.test_promotion school.tests.test_promotion_readiness school.tests.test_promotion_events --noinput -v 2
./venv/bin/python manage.py check
```

Expected: all PASS, system check clean.

- [ ] **Step 8: Commit**

```bash
git add school/views/promotion_views.py school/tests/test_promotion.py school/tests/test_promotion_readiness.py
git commit -m "feat(promotion): scope class-teacher promotion rights to their own stream"
```

---

### Task 6: `stream_name` on readiness rows

**Files:**
- Modify: `school/views/promotion_views.py` (`PromotionReadinessAPIView.get`'s `rows.append` block)
- Test: `school/tests/test_promotion_readiness.py`

**Interfaces:**
- Produces: each row in `GET /api/promotion/readiness/`'s `students` list gains `stream_name: string | null`. Task 7 (frontend) groups the readiness table by this field.

- [ ] **Step 1: Write the failing test**

Add this method to the existing `PromotionReadinessAPIViewTests` class in `school/tests/test_promotion_readiness.py` (add it as a new method, e.g. right after `test_ready_row_includes_transition_preview_fields`):

```python
    def test_row_includes_stream_name(self):
        response = self._get(f'academic_year_id={self.ready_year.id}&grade_id={self.g1.id}')
        data = response.data
        row = next(r for r in data['students'] if r['student_id'] == self.ready_student.id)
        self.assertEqual(row['stream_name'], self.stream.name)
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
DB_NAME=school_db_task6check ./venv/bin/python manage.py test school.tests.test_promotion_readiness.PromotionReadinessAPIViewTests.test_row_includes_stream_name --noinput -v 2
```

Expected: FAIL with a `KeyError: 'stream_name'`.

- [ ] **Step 3: Add the field**

In `school/views/promotion_views.py`'s `PromotionReadinessAPIView.get`, find:

```python
            rows.append({
                'student_id': student.id,
                'name': student.get_name,
                'grade_name': student.cl.grade.name if student.cl_id else None,
                'transition_type': readiness['transition_type'],
                'requirement': readiness['requirement'],
                'ready': readiness['ready'],
                'reason': readiness['reason'],
                'next_grade_name': readiness['next_grade_name'],
                'exam_code': readiness['_transition'][1],
            })
```

Replace with:

```python
            rows.append({
                'student_id': student.id,
                'name': student.get_name,
                'grade_name': student.cl.grade.name if student.cl_id else None,
                'stream_name': student.cl.name if student.cl_id else None,
                'transition_type': readiness['transition_type'],
                'requirement': readiness['requirement'],
                'ready': readiness['ready'],
                'reason': readiness['reason'],
                'next_grade_name': readiness['next_grade_name'],
                'exam_code': readiness['_transition'][1],
            })
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
DB_NAME=school_db_task6check ./venv/bin/python manage.py test school.tests.test_promotion_readiness.PromotionReadinessAPIViewTests --noinput -v 2
```

Expected: PASS — all tests in the class.

- [ ] **Step 5: Run the full promotion suite as a regression check**

```bash
DB_NAME=school_db_task6check ./venv/bin/python manage.py test school.tests.test_promotion school.tests.test_promotion_readiness school.tests.test_promotion_events --noinput -v 2
./venv/bin/python manage.py check
```

Expected: all PASS, system check clean.

- [ ] **Step 6: Commit**

```bash
git add school/views/promotion_views.py school/tests/test_promotion_readiness.py
git commit -m "feat(promotion): expose stream_name on readiness rows for grouping"
```

---

### Task 7: Frontend — grouped/paginated readiness table, modal-based Quick Override & Record National Exam, caution styling

**Depends on:** Task 3 (`PromotionEventsAPIView`), Task 2 (`PromotionRevertAPIView`), Task 6 (`stream_name`). Read all three "Produces" sections above before starting — the code below assumes those exact shapes.

**Files:**
- Modify: `frontend/src/components/results/PromotionPanel.tsx`

**Interfaces:**
- Consumes: `GET /api/promotion/events/?student_id=<id>` (Task 3), `POST /api/promotion/revert/<id>/` (Task 2), `stream_name` on readiness rows (Task 6). Also consumes the already-existing `/api/academic-hub/` grade objects, which already carry `tier_id` (confirmed at `school/views/class_views.py:54` — no backend change needed for this), and the already-existing `/api/core/curriculum/tiers/` response, whose `TierOption` shape (`exit_exam_code`) is already fetched by this component.
- Produces: no new exports consumed elsewhere.

- [ ] **Step 1: Confirm `/api/approved-users/students/` already returns `grade_name` per student**

This is a read-only sanity check, not a code change — `school/views/views.py:686` already includes `'grade_name': u.cl.grade.name if u.cl and u.cl.grade else "Not Assigned"` in that endpoint's per-student serialization. The frontend change below relies on this being present; if a `grep -n "grade_name" school/views/views.py` around the `api_get_approved_users` function doesn't show it, stop and report — that would mean this task needs a backend change first.

- [ ] **Step 2: Update interfaces and the students/grades fetch**

In `frontend/src/components/results/PromotionPanel.tsx`, find:

```tsx
interface GradeOption {
  id: number;
  grade_name: string;
  curriculum_id: number;
}
```

Replace with:

```tsx
interface GradeOption {
  id: number;
  grade_name: string;
  curriculum_id: number;
  tier_id: number | null;
}
```

Find:

```tsx
interface ReadinessRow {
  student_id: number;
  name: string;
  grade_name: string | null;
  transition_type: string | null;
  requirement: string | null;
  ready: boolean;
  reason: string | null;
  next_grade_name: string | null;
  exam_code: string | null;
}
```

Replace with:

```tsx
interface ReadinessRow {
  student_id: number;
  name: string;
  grade_name: string | null;
  stream_name: string | null;
  transition_type: string | null;
  requirement: string | null;
  ready: boolean;
  reason: string | null;
  next_grade_name: string | null;
  exam_code: string | null;
}
```

Find:

```tsx
interface StudentOption {
  id: number;
  name: string;
}
```

Replace with:

```tsx
interface StudentOption {
  id: number;
  name: string;
  grade_name: string;
}

interface PromotionEventRow {
  id: number;
  outcome: string;
  academic_year: string;
  performed_at: string;
  performed_by_name: string | null;
  reverted_at: string | null;
  can_revert: boolean;
}
```

Find:

```tsx
    api.get('/api/approved-users/students/').then((res) => {
      setStudents((res.data?.data ?? []).map((s: any) => ({ id: s.id, name: s.name })));
    }).catch(() => setStudents([]));
```

Replace with:

```tsx
    api.get('/api/approved-users/students/').then((res) => {
      setStudents((res.data?.data ?? []).map((s: any) => ({ id: s.id, name: s.name, grade_name: s.grade_name ?? 'Not Assigned' })));
    }).catch(() => setStudents([]));
```

- [ ] **Step 3: Derive the exam-gated grade set, and filter the exam-recording pickers**

Find:

```tsx
  useEffect(() => {
    api.get('/api/academic-hub/').then((res) => {
      const classes = res.data?.data?.classes ?? [];
      setStreams(classes.flatMap((c: any) =>
        (c.streams ?? []).map((s: any) => ({ id: s.id, label: `${c.grade_name} · ${s.name}` }))
      ));
    });
```

Replace with:

```tsx
  useEffect(() => {
    api.get('/api/academic-hub/').then((res) => {
      const classes = res.data?.data?.classes ?? [];
      const examGatedGradeIds = new Set(
        classes.filter((c: any) => examGatedTierIds.has(c.tier_id)).map((c: any) => c.id),
      );
      setStreams(classes
        .filter((c: any) => examGatedGradeIds.has(c.id))
        .flatMap((c: any) => (c.streams ?? []).map((s: any) => ({ id: s.id, label: `${c.grade_name} · ${s.name}` }))));
    });
```

This introduces a dependency on `examGatedTierIds`, computed once `tiers` is loaded. Find the `grades`/`tiers` fetch effect:

```tsx
  useEffect(() => {
    api.get('/api/academic-years/').then((res) => setAcademicYears(res.data?.data ?? []));
    api.get('/api/academic-hub/').then((res) => setGrades(res.data?.data?.classes ?? []));
    api.get('/api/core/curriculum/tiers/').then((res) => setTiers(res.data ?? []));
  }, []);
```

Leave this effect unchanged (it's a separate, independent fetch of the same `/api/academic-hub/` data purely for the `grades` dropdown — duplicating the request is pre-existing behavior in this file, not something this task should refactor). Immediately after it, add:

```tsx

  const examGatedTierIds = new Set(tiers.filter((t) => !!t.exit_exam_code).map((t) => t.id));
  const examEligibleStudents = students.filter((s) =>
    grades.some((g) => g.grade_name === s.grade_name && examGatedTierIds.has(g.tier_id as number)),
  );
```

(`examGatedTierIds` must be declared before the `useEffect` in Step 3 above that references it — place this new block directly after the `academicYears`/`grades`/`tiers` fetch effect and before the `students`/`streams` fetch effect, reordering the two effects if necessary so `examGatedTierIds` is in scope where it's used. `examEligibleStudents` is used in Step 6 below, for the Record National Exam dialog's single-student `Autocomplete`.)

- [ ] **Step 4: Add pagination state and group the readiness table by stream**

Find the `ReadinessTable` component's signature:

```tsx
function ReadinessTable({
  rows, nameById, onExport,
}: {
  rows: ReadinessRow[] | PromotionOutcome[];
  nameById?: Record<number, string>;
  onExport?: () => void;
}) {
  const isReadinessRows = rows.length > 0 && 'ready' in rows[0];
  return (
    <Stack spacing={1}>
      {onExport && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button size="small" startIcon={<Download size={16} />} onClick={onExport}>Export CSV</Button>
        </Box>
      )}
      <Table size="small">
```

Replace this whole function with a version that groups readiness rows by `stream_name` and paginates each group at 15, while leaving outcome-row rendering (no grouping — outcome lists are the result of one already-scoped run, not the large flat readiness list) exactly as it is today:

```tsx
function PaginatedRowGroup({ rows }: { rows: ReadinessRow[] }) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(rows.length / 15));
  const pageRows = rows.slice((page - 1) * 15, page * 15);
  return (
    <Stack spacing={1}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Student</TableCell>
            <TableCell>Transition</TableCell>
            <TableCell>Requirement</TableCell>
            <TableCell>Status</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {pageRows.map((row) => (
            <TableRow key={row.student_id}>
              <TableCell>{row.name}</TableCell>
              <TableCell>
                {row.transition_type === 'exit'
                  ? <Chip size="small" variant="outlined" label={`Graduates${row.exam_code ? ` (${row.exam_code})` : ''}`} />
                  : row.next_grade_name
                    ? <Chip size="small" variant="outlined" label={`→ ${row.next_grade_name}${row.exam_code ? ` (${row.exam_code})` : ''}`} />
                    : '—'}
              </TableCell>
              <TableCell>{row.requirement ?? '—'}</TableCell>
              <TableCell>
                {row.ready
                  ? <Chip size="small" color="success" label="Ready" />
                  : <Chip size="small" color="warning" label={row.reason ?? 'Blocked'} />}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {pageCount > 1 && (
        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
          <Pagination count={pageCount} page={page} onChange={(_e, p) => setPage(p)} size="small" />
        </Box>
      )}
    </Stack>
  );
}

function ReadinessTable({
  rows, nameById, onExport,
}: {
  rows: ReadinessRow[] | PromotionOutcome[];
  nameById?: Record<number, string>;
  onExport?: () => void;
}) {
  const isReadinessRows = rows.length > 0 && 'ready' in rows[0];

  if (isReadinessRows) {
    const readinessRows = rows as ReadinessRow[];
    const groups = new Map<string, ReadinessRow[]>();
    for (const row of readinessRows) {
      const key = row.stream_name ?? 'Unassigned';
      const existing = groups.get(key);
      if (existing) existing.push(row); else groups.set(key, [row]);
    }
    return (
      <Stack spacing={2}>
        {onExport && (
          <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button size="small" startIcon={<Download size={16} />} onClick={onExport}>Export CSV</Button>
          </Box>
        )}
        {[...groups.entries()].map(([streamName, groupRows]) => (
          <Box key={streamName}>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              {streamName} <Typography component="span" variant="caption" color="text.secondary">({groupRows.length})</Typography>
            </Typography>
            <PaginatedRowGroup rows={groupRows} />
          </Box>
        ))}
      </Stack>
    );
  }

  return (
    <Stack spacing={1}>
      {onExport && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button size="small" startIcon={<Download size={16} />} onClick={onExport}>Export CSV</Button>
        </Box>
      )}
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Student</TableCell>
            <TableCell>Outcome</TableCell>
            <TableCell>Detail</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {(rows as PromotionOutcome[]).map((row) => (
            <TableRow key={row.student_id}>
              <TableCell>{nameById?.[row.student_id] ?? `Student #${row.student_id}`}</TableCell>
              <TableCell>
                <Chip
                  size="small"
                  color={row.outcome === 'promoted' ? 'success' : row.outcome === 'graduated' ? 'info' : 'warning'}
                  label={row.outcome}
                />
              </TableCell>
              <TableCell>{row.detail}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Stack>
  );
}
```

Add `Pagination` to the MUI import list at the top of the file — find:

```tsx
import {
  Box, Card, CardContent, CardHeader, Button, TextField, MenuItem, Alert,
  CircularProgress, Stack, Typography, Table, TableHead, TableBody, TableRow, TableCell,
  Chip, Autocomplete, Switch, FormControlLabel,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
} from '@mui/material';
```

Replace with:

```tsx
import {
  Box, Card, CardContent, CardHeader, Button, TextField, MenuItem, Alert,
  CircularProgress, Stack, Typography, Table, TableHead, TableBody, TableRow, TableCell,
  Chip, Autocomplete, Switch, FormControlLabel, Pagination, ToggleButton, ToggleButtonGroup,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
} from '@mui/material';
```

- [ ] **Step 5: Restyle the caution/warning `Alert`s**

Find (Step 2's requirements-not-met warning):

```tsx
          {prerequisites !== null && !allRequirementsSatisfied && (
            <Alert severity="warning">
              Not all Step 1 requirements are met yet for this scope: {unmetRequirements.map((g) => g.requirement).join('; ')}.
              Some students below may show as blocked for reasons Step 1 already explains.
            </Alert>
          )}
```

Replace with:

```tsx
          {prerequisites !== null && !allRequirementsSatisfied && (
            <Alert severity="warning" variant="filled" sx={{ fontWeight: 500 }}>
              Not all Step 1 requirements are met yet for this scope: {unmetRequirements.map((g) => g.requirement).join('; ')}.
              Some students below may show as blocked for reasons Step 1 already explains.
            </Alert>
          )}
```

Find, inside Step 1's requirement-group rendering, the "Not yet" `Chip`:

```tsx
                  {group.satisfied
                    ? <Chip size="small" color="success" label="Satisfied" />
                    : <Chip size="small" color="warning" label="Not yet" />}
```

Replace with:

```tsx
                  {group.satisfied
                    ? <Chip size="small" color="success" label="Satisfied" />
                    : <Chip size="small" color="warning" variant="filled" label="⚠ Not yet" sx={{ fontWeight: 600 }} />}
```

- [ ] **Step 6: Turn Quick Override into a modal with search, A–Z filter, and revert**

Find the entire Quick Override state block:

```tsx
  const [singleStudent, setSingleStudent] = useState<StudentOption | null>(null);
  const [singleYearId, setSingleYearId] = useState('');
  const [singleReadiness, setSingleReadiness] = useState<ReadinessRow | null>(null);
  const [singleChecking, setSingleChecking] = useState(false);
  const [singlePromoting, setSinglePromoting] = useState(false);
  const [singleResult, setSingleResult] = useState<PromotionOutcome | null>(null);
  const [singleError, setSingleError] = useState<string | null>(null);
```

Replace with:

```tsx
  const [quickOverrideOpen, setQuickOverrideOpen] = useState(false);
  const [nameFilterLetter, setNameFilterLetter] = useState<string | null>(null);
  const [singleStudent, setSingleStudent] = useState<StudentOption | null>(null);
  const [singleYearId, setSingleYearId] = useState('');
  const [singleReadiness, setSingleReadiness] = useState<ReadinessRow | null>(null);
  const [singleChecking, setSingleChecking] = useState(false);
  const [singlePromoting, setSinglePromoting] = useState(false);
  const [singleResult, setSingleResult] = useState<PromotionOutcome | null>(null);
  const [singleError, setSingleError] = useState<string | null>(null);
  const [studentEvents, setStudentEvents] = useState<PromotionEventRow[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [revertingEventId, setRevertingEventId] = useState<number | null>(null);
  const [revertError, setRevertError] = useState<string | null>(null);

  const fetchStudentEvents = async (studentId: number) => {
    setEventsLoading(true);
    try {
      const res = await api.get(`/api/promotion/events/?student_id=${studentId}`);
      setStudentEvents(res.data?.events ?? []);
    } catch {
      setStudentEvents([]);
    } finally {
      setEventsLoading(false);
    }
  };

  const handleRevert = async (eventId: number) => {
    setRevertingEventId(eventId);
    setRevertError(null);
    try {
      await api.post(`/api/promotion/revert/${eventId}/`);
      if (singleStudent) await fetchStudentEvents(singleStudent.id);
    } catch (err: any) {
      setRevertError(err.response?.data?.error || 'Failed to revert this promotion.');
    } finally {
      setRevertingEventId(null);
    }
  };

  const filteredStudents = nameFilterLetter
    ? students.filter((s) => s.name.toUpperCase().startsWith(nameFilterLetter))
    : students;
```

Find `handleCheckSingle`'s student-change handler dependency — locate:

```tsx
              <Autocomplete
                options={students}
                getOptionLabel={(o) => o.name}
                isOptionEqualToValue={(o, v) => o.id === v.id}
                value={singleStudent}
                onChange={(_e, value) => { setSingleStudent(value); setSingleReadiness(null); setSingleResult(null); }}
                sx={{ minWidth: 260 }}
                renderInput={(params) => <TextField {...params} label="Student" size="small" />}
              />
              <TextField select label="Academic Year" value={singleYearId} onChange={(e) => { setSingleYearId(e.target.value); setSingleReadiness(null); }} size="small" sx={{ minWidth: 160 }}>
                {academicYears.map((y) => <MenuItem key={y.id} value={y.id}>{y.year}</MenuItem>)}
              </TextField>
              <Button variant="outlined" disabled={singleChecking || !singleStudent || !singleYearId} onClick={handleCheckSingle}>
                {singleChecking ? <CircularProgress size={20} /> : 'Check'}
              </Button>
```

This whole block moves into the new dialog (Step 6 continued below); it does not stay where it is.

Find the entire Quick Override `Card` (currently):

```tsx
      <Card variant="outlined">
        <CardHeader title="Quick Override — Check / Promote a Single Student" subheader="For one-off corrections outside a full scope run." />
        <CardContent>
          <Stack spacing={2}>
            <Stack direction="row" spacing={2}>
              <Autocomplete
                options={students}
                getOptionLabel={(o) => o.name}
                isOptionEqualToValue={(o, v) => o.id === v.id}
                value={singleStudent}
                onChange={(_e, value) => { setSingleStudent(value); setSingleReadiness(null); setSingleResult(null); }}
                sx={{ minWidth: 260 }}
                renderInput={(params) => <TextField {...params} label="Student" size="small" />}
              />
              <TextField select label="Academic Year" value={singleYearId} onChange={(e) => { setSingleYearId(e.target.value); setSingleReadiness(null); }} size="small" sx={{ minWidth: 160 }}>
                {academicYears.map((y) => <MenuItem key={y.id} value={y.id}>{y.year}</MenuItem>)}
              </TextField>
              <Button variant="outlined" disabled={singleChecking || !singleStudent || !singleYearId} onClick={handleCheckSingle}>
                {singleChecking ? <CircularProgress size={20} /> : 'Check'}
              </Button>
            </Stack>
            {singleError && <Alert severity="error">{singleError}</Alert>}
            {singleReadiness && (
              <>
                <Alert severity={singleReadiness.ready ? 'success' : 'warning'}>
                  {singleReadiness.requirement ?? 'No requirement'} — {singleReadiness.ready ? 'Ready to promote.' : singleReadiness.reason}
                </Alert>
                <Box>
                  <Button variant="contained" disabled={!singleReadiness.ready || singlePromoting} onClick={handlePromoteSingle}>
                    {singlePromoting ? <CircularProgress size={20} /> : 'Promote This Student'}
                  </Button>
                </Box>
              </>
            )}
            {singleResult && (
              <Alert severity={singleResult.outcome === 'held' ? 'warning' : 'success'}>
                {singleResult.outcome}: {singleResult.detail}
              </Alert>
            )}
          </Stack>
        </CardContent>
      </Card>
```

Replace with:

```tsx
      <Card variant="outlined">
        <CardHeader title="Quick Override — Check / Promote a Single Student" subheader="For one-off corrections outside a full scope run." />
        <CardContent>
          <Button variant="contained" onClick={() => setQuickOverrideOpen(true)}>Open Quick Override</Button>
        </CardContent>
      </Card>

      <Dialog open={quickOverrideOpen} onClose={() => setQuickOverrideOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Quick Override — Check / Promote a Single Student</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <ToggleButtonGroup
              size="small" value={nameFilterLetter} exclusive
              onChange={(_e, letter) => setNameFilterLetter(letter)}
              sx={{ flexWrap: 'wrap' }}
            >
              {'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((letter) => (
                <ToggleButton key={letter} value={letter} sx={{ px: 1, minWidth: 32 }}>{letter}</ToggleButton>
              ))}
            </ToggleButtonGroup>
            <Stack direction="row" spacing={2}>
              <Autocomplete
                options={filteredStudents}
                getOptionLabel={(o) => `${o.name} (${o.grade_name})`}
                isOptionEqualToValue={(o, v) => o.id === v.id}
                value={singleStudent}
                onChange={(_e, value) => {
                  setSingleStudent(value);
                  setSingleReadiness(null);
                  setSingleResult(null);
                  setStudentEvents([]);
                  if (value) fetchStudentEvents(value.id);
                }}
                sx={{ minWidth: 260, flexGrow: 1 }}
                renderInput={(params) => <TextField {...params} label="Student" size="small" />}
              />
              <TextField select label="Academic Year" value={singleYearId} onChange={(e) => { setSingleYearId(e.target.value); setSingleReadiness(null); }} size="small" sx={{ minWidth: 160 }}>
                {academicYears.map((y) => <MenuItem key={y.id} value={y.id}>{y.year}</MenuItem>)}
              </TextField>
            </Stack>
            <Box>
              <Button variant="outlined" disabled={singleChecking || !singleStudent || !singleYearId} onClick={handleCheckSingle}>
                {singleChecking ? <CircularProgress size={20} /> : 'Check'}
              </Button>
            </Box>
            {singleError && <Alert severity="error">{singleError}</Alert>}
            {singleReadiness && (
              <>
                <Alert severity={singleReadiness.ready ? 'success' : 'warning'}>
                  {singleReadiness.requirement ?? 'No requirement'} — {singleReadiness.ready ? 'Ready to promote.' : singleReadiness.reason}
                </Alert>
                <Box>
                  <Button variant="contained" disabled={!singleReadiness.ready || singlePromoting} onClick={handlePromoteSingle}>
                    {singlePromoting ? <CircularProgress size={20} /> : 'Promote This Student'}
                  </Button>
                </Box>
              </>
            )}
            {singleResult && (
              <Alert severity={singleResult.outcome === 'held' ? 'warning' : 'success'}>
                {singleResult.outcome}: {singleResult.detail}
              </Alert>
            )}
            {singleStudent && (
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>Recent promotions for {singleStudent.name}</Typography>
                {eventsLoading && <CircularProgress size={20} />}
                {revertError && <Alert severity="error" sx={{ mb: 1 }}>{revertError}</Alert>}
                {!eventsLoading && studentEvents.length === 0 && (
                  <Typography variant="body2" color="text.secondary">No promotion history yet.</Typography>
                )}
                {studentEvents.map((event) => (
                  <Stack key={event.id} direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
                    <Chip
                      size="small"
                      color={event.outcome === 'graduated' ? 'info' : 'success'}
                      label={`${event.outcome} — ${event.academic_year}`}
                    />
                    <Typography variant="caption" color="text.secondary">
                      {event.performed_by_name ?? 'unknown'} · {new Date(event.performed_at).toLocaleString()}
                      {event.reverted_at ? ' · reverted' : ''}
                    </Typography>
                    {event.can_revert && (
                      <Button
                        size="small" color="error"
                        disabled={revertingEventId === event.id}
                        onClick={() => handleRevert(event.id)}
                      >
                        {revertingEventId === event.id ? <CircularProgress size={16} /> : 'Revert'}
                      </Button>
                    )}
                  </Stack>
                ))}
              </Box>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setQuickOverrideOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
```

- [ ] **Step 7: Turn Record National Exam into a modal with the exam-gated filter applied**

Find the exam-recording state block:

```tsx
  const [bulkExamMode, setBulkExamMode] = useState(false);
  const [examStudent, setExamStudent] = useState<StudentOption | null>(null);
```

Replace with:

```tsx
  const [examDialogOpen, setExamDialogOpen] = useState(false);
  const [bulkExamMode, setBulkExamMode] = useState(false);
  const [examStudent, setExamStudent] = useState<StudentOption | null>(null);
```

Find the entire Record National Exam `Card` (currently):

```tsx
      <Card variant="outlined" ref={examSectionRef}>
        <CardHeader title="Record a National Exam" subheader="KPSEA (Grade 6), KJSEA (Grade 9), or KCSE (Form 4 / Grade 12)." />
        <CardContent>
          <Stack spacing={2}>
            <FormControlLabel
              control={<Switch checked={bulkExamMode} onChange={(e) => setBulkExamMode(e.target.checked)} />}
              label="Record for a whole stream at once"
            />
            <Stack direction="row" spacing={2}>
              {bulkExamMode ? (
                <TextField select label="Stream" value={examStreamId} onChange={(e) => setExamStreamId(e.target.value)} size="small" sx={{ minWidth: 220 }}>
                  {streams.map((s) => <MenuItem key={s.id} value={s.id}>{s.label}</MenuItem>)}
                </TextField>
              ) : (
                <Autocomplete
                  options={students}
                  getOptionLabel={(o) => o.name}
                  isOptionEqualToValue={(o, v) => o.id === v.id}
                  value={examStudent}
                  onChange={(_e, value) => setExamStudent(value)}
                  sx={{ minWidth: 260 }}
                  renderInput={(params) => <TextField {...params} label="Student" size="small" />}
                />
              )}
              <TextField select label="Academic Year" value={examYearId} onChange={(e) => setExamYearId(e.target.value)} size="small" sx={{ minWidth: 160 }}>
                {academicYears.map((y) => <MenuItem key={y.id} value={y.id}>{y.year}</MenuItem>)}
              </TextField>
              <TextField select label="Exam" value={examCode} onChange={(e) => setExamCode(e.target.value)} size="small" sx={{ minWidth: 120 }}>
                <MenuItem value="KPSEA">KPSEA</MenuItem>
                <MenuItem value="KJSEA">KJSEA</MenuItem>
                <MenuItem value="KCSE">KCSE</MenuItem>
              </TextField>
            </Stack>
            <TextField
              label="Destination (placement school / university — optional for KPSEA)"
              value={destination} onChange={(e) => setDestination(e.target.value)} size="small" fullWidth
            />
            <Box>
              <Button
                variant="contained"
                disabled={recordingExam || !examYearId || (bulkExamMode ? !examStreamId : !examStudent)}
                onClick={handleRecordExam}
              >
                {recordingExam ? <CircularProgress size={20} /> : bulkExamMode ? 'Save for Whole Stream' : 'Save Exam Record'}
              </Button>
            </Box>
          </Stack>
          {examMsg && <Alert sx={{ mt: 2 }} severity={examFailed ? 'error' : 'success'}>{examMsg}</Alert>}
        </CardContent>
      </Card>
```

Replace with:

```tsx
      <Card variant="outlined" ref={examSectionRef}>
        <CardHeader title="Record a National Exam" subheader="KPSEA (Grade 6), KJSEA (Grade 9), or KCSE (Form 4 / Grade 12)." />
        <CardContent>
          <Button variant="contained" onClick={() => setExamDialogOpen(true)}>Open National Exam Recording</Button>
        </CardContent>
      </Card>

      <Dialog open={examDialogOpen} onClose={() => setExamDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Record a National Exam</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Only grades whose tier has a national exam configured are offered below.
            </Typography>
            <FormControlLabel
              control={<Switch checked={bulkExamMode} onChange={(e) => setBulkExamMode(e.target.checked)} />}
              label="Record for a whole stream at once"
            />
            <Stack direction="row" spacing={2}>
              {bulkExamMode ? (
                <TextField select label="Stream" value={examStreamId} onChange={(e) => setExamStreamId(e.target.value)} size="small" sx={{ minWidth: 220 }}>
                  {streams.map((s) => <MenuItem key={s.id} value={s.id}>{s.label}</MenuItem>)}
                </TextField>
              ) : (
                <Autocomplete
                  options={examEligibleStudents}
                  getOptionLabel={(o) => `${o.name} (${o.grade_name})`}
                  isOptionEqualToValue={(o, v) => o.id === v.id}
                  value={examStudent}
                  onChange={(_e, value) => setExamStudent(value)}
                  sx={{ minWidth: 260 }}
                  renderInput={(params) => <TextField {...params} label="Student" size="small" />}
                />
              )}
              <TextField select label="Academic Year" value={examYearId} onChange={(e) => setExamYearId(e.target.value)} size="small" sx={{ minWidth: 160 }}>
                {academicYears.map((y) => <MenuItem key={y.id} value={y.id}>{y.year}</MenuItem>)}
              </TextField>
              <TextField select label="Exam" value={examCode} onChange={(e) => setExamCode(e.target.value)} size="small" sx={{ minWidth: 120 }}>
                <MenuItem value="KPSEA">KPSEA</MenuItem>
                <MenuItem value="KJSEA">KJSEA</MenuItem>
                <MenuItem value="KCSE">KCSE</MenuItem>
              </TextField>
            </Stack>
            <TextField
              label="Destination (placement school / university — optional for KPSEA)"
              value={destination} onChange={(e) => setDestination(e.target.value)} size="small" fullWidth
            />
            <Box>
              <Button
                variant="contained"
                disabled={recordingExam || !examYearId || (bulkExamMode ? !examStreamId : !examStudent)}
                onClick={handleRecordExam}
              >
                {recordingExam ? <CircularProgress size={20} /> : bulkExamMode ? 'Save for Whole Stream' : 'Save Exam Record'}
              </Button>
            </Box>
            {examMsg && <Alert severity={examFailed ? 'error' : 'success'}>{examMsg}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setExamDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
```

Update the "Go to National Exam Recording" button in Step 1 so it also opens this dialog — find:

```tsx
                {!group.terms && !group.satisfied && (
                  <Button
                    size="small" variant="outlined"
                    onClick={() => {
                      if (group.exam_code) setExamCode(group.exam_code);
                      if (scopeYearId) setExamYearId(scopeYearId);
                      examSectionRef.current?.scrollIntoView({ behavior: 'smooth' });
                    }}
                  >
                    Go to National Exam Recording
                  </Button>
                )}
```

Replace with:

```tsx
                {!group.terms && !group.satisfied && (
                  <Button
                    size="small" variant="outlined"
                    onClick={() => {
                      if (group.exam_code) setExamCode(group.exam_code);
                      if (scopeYearId) setExamYearId(scopeYearId);
                      setExamDialogOpen(true);
                    }}
                  >
                    Go to National Exam Recording
                  </Button>
                )}
```

(`examSectionRef` and the `ref={examSectionRef}` on the "Record a National Exam" `Card` can stay in place — they're harmless now that the button no longer scrolls to it, and removing them isn't necessary for correctness. Leave them as-is to keep this diff minimal.)

- [ ] **Step 8: Typecheck**

```bash
cd /home/jordan/Documents/SMS/frontend && npx tsc -b --noEmit 2>&1 | grep -iE "PromotionPanel|ProcessStepCard"
```

Expected: no output.

- [ ] **Step 9: Manual QA**

There is no frontend test suite for this panel. Start the dev servers and, as an admin:
1. Check Readiness for a scope with 30+ ready students across at least 2 streams — confirm the table is grouped by stream with a per-group count, and each group paginates at 15 rows once it exceeds that.
2. Open Quick Override — confirm it's now a modal; type a letter in the A–Z row and confirm the student `Autocomplete`'s options narrow to matching first letters; search and select a student, confirm "Recent promotions for <name>" loads (empty state if none).
3. Promote a student via Quick Override (or via Step 3's bulk run), reopen Quick Override for that same student — confirm a promotion event appears with a "Revert" button, click it, confirm the student's class/enrollment state is restored and the button disappears (or the row shows "reverted").
4. Open Record a National Exam — confirm it's now a modal, and that its student/stream pickers only list grades whose tier has an exit exam configured (cross-check against Curriculum → Tiers).
5. Confirm the Step 1 "Not yet" chips and Step 2's unmet-requirements banner now read as a stronger, filled warning rather than a plain box.

Report the outcome of this pass explicitly.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/components/results/PromotionPanel.tsx
git commit -m "feat(promotion): grouped/paginated readiness table, modal overrides, exam-gated filtering"
```

## Plan Self-Review Notes

- **Spec coverage:** Roles table (Tasks 4, 5), `PromotionEvent`/revert capability (Tasks 1-3), 12h window (Tasks 2, 4, shared via `_can_still_correct`), class-teacher scoping (Task 5), `stream_name`/grouped+paginated table (Tasks 6, 7), Quick Override & Record National Exam as modals with search/A-Z/exam-gated filtering (Task 7), caution styling (Task 7) — every spec section has a task. The spec's Non-goals (no change to `_determine_transition`/`results_finalized_for_year`/existing field shapes beyond additions, no new DRF permission class, no revert of the exam record itself) are respected throughout.
- **Type consistency:** `PromotionEventRow` (Task 7 frontend) matches `PromotionEventsAPIView`'s exact response shape (Task 3). `ReadinessRow.stream_name` (Task 7) matches Task 6's added field. `GradeOption.tier_id` (Task 7) matches the already-existing backend field confirmed at `school/views/class_views.py:54`. `_can_still_correct`'s signature (Task 2) is used identically in Tasks 3 and 4.
- **Sequencing:** Tasks 1→2→3→4 are strictly sequential (each depends on the previous). Task 5 depends only on Task 1 (the `performed_by_id` call sites it edits around). Task 6 is independent of Tasks 2-5 but is listed after them to keep the plan's backend-then-frontend shape; an implementer could technically run it earlier, but this plan dispatches tasks in written order per this skill's process. Task 7 depends on Tasks 2, 3, and 6 and must run last.
