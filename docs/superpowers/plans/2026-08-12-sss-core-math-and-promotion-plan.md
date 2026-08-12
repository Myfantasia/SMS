# SSS Core-Math Guarantee + Multi-Tier Student Promotion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guarantee every Senior Secondary student has a mathematics subject, and build grade promotion across CBC and 8-4-4 — gated on internal results finalization for plain transitions and on national exams (KPSEA/KJSEA/KCSE) for tier-exit transitions — reflected on student dashboards.

**Architecture:** All new business logic lives in the existing `school/views/` legacy layer (as plain module-level functions, matching `_approve_combo_subjects`'s precedent), not in the `apps/*/services.py` DTO layer, because `school/` sits outside the `apps/*` import-linter boundary and this feature's logic reaches across `academics`/`students`/`identity`/`core` models directly — exactly the same shape as the existing pathway-assignment code it extends. New schema is three small additive changes (`Tier` exit-exam fields, `ExamTerm` finalization fields, one new `NationalExamRecord` model) plus one new enum value and one new audit action type — no restructuring of existing tables.

**Tech Stack:** Django 6 / DRF, Celery (existing `dispatch_background_job` pattern), React 19 + TS + MUI (per the `sms-orient` "new admin UI uses MUI" convention), `lucide-react` icons (not `@mui/icons-material`, which isn't installed).

## Global Constraints

- **Never run `makemigrations`/`migrate`** — write migration-triggering model changes, but the user applies them. Each schema task ends with a reminder, not a migration command.
- `Tier` is admin-defined free text — no hardcoded grade numbers or tier-name substrings for the new exam-gating logic (only the pre-existing `tier_requires_pathway_choice`/`grade_requires_pathway_choice` keep their existing name-substring convention; this feature's gating is driven by new explicit `Tier` fields instead, since a substring/numeric-order heuristic was shown to misfire on Grade 3→4, a same-institution, non-exam-gated tier crossing).
- Respect `.importlinter`: `apps.students` may not `from apps.academics.models import ...` directly (contract `no-model-import-students`). Where both `apps/academics/models.py` and `apps/students/models.py` need the same `NATIONAL_EXAM_CHOICES` tuple, define it independently in each file rather than importing across the boundary.
- `school/views/*.py` is exempt from `.importlinter` (not in `root_packages`) — free to import Django models directly across apps, matching `subject_views.py`/`results_views.py`'s existing style.
- New frontend admin UI uses MUI (`@mui/material`, themed via `frontend/src/layouts/theme/adminTheme.ts`) and `lucide-react` icons, per `sms-orient`.
- Reuse the existing `results.edit` RBAC permission code for every new admin endpoint in this plan — do not introduce a new permission code (would require a `seed_rbac` re-run the user would have to trigger).

---

## Task 1: Tier exit-exam fields + `next_grade_level` + `get_or_create_class_stream`

**Files:**
- Modify: `apps/academics/models.py` (near `Tier`, ~line 139-157; near `ClassStream`, ~line 246-276)
- Test: `school/tests/test_promotion.py` (new)

**Interfaces:**
- Produces: `Tier.exit_exam_code` (str, blank-able), `Tier.exit_is_terminal` (bool); `next_grade_level(grade) -> Optional[GradeLevel]`; `get_or_create_class_stream(grade, name) -> ClassStream`.

- [ ] **Step 1: Write the failing tests**

```python
# school/tests/test_promotion.py
from django.test import TestCase

from apps.academics.models import (
    Curriculum, Tier, GradeLevel, ClassStream, next_grade_level, get_or_create_class_stream,
)


class TierExitExamFieldsTests(TestCase):
    def setUp(self):
        self.curriculum = Curriculum.objects.create(code='CBC', name='Competency Based Curriculum')

    def test_exit_exam_code_blank_by_default(self):
        tier = Tier.objects.create(curriculum=self.curriculum, name='Lower Primary', code='LP')
        self.assertEqual(tier.exit_exam_code, '')
        self.assertFalse(tier.exit_is_terminal)

    def test_exit_exam_code_accepts_kjsea(self):
        tier = Tier.objects.create(
            curriculum=self.curriculum, name='Junior Secondary', code='JSS',
            exit_exam_code='KJSEA', exit_is_terminal=True,
        )
        self.assertEqual(tier.exit_exam_code, 'KJSEA')
        self.assertTrue(tier.exit_is_terminal)


class NextGradeLevelTests(TestCase):
    def setUp(self):
        self.curriculum = Curriculum.objects.create(code='CBC2', name='CBC (promotion test)')
        self.tier = Tier.objects.create(curriculum=self.curriculum, name='Upper Primary', code='UP')
        self.grade4 = GradeLevel.objects.create(name='Grade 4Z', numeric_order=4, curriculum=self.curriculum, tier=self.tier)
        self.grade5 = GradeLevel.objects.create(name='Grade 5Z', numeric_order=5, curriculum=self.curriculum, tier=self.tier)

    def test_returns_next_higher_numeric_order_grade(self):
        self.assertEqual(next_grade_level(self.grade4).id, self.grade5.id)

    def test_returns_none_for_highest_grade(self):
        self.assertIsNone(next_grade_level(self.grade5))

    def test_returns_none_for_none_grade(self):
        self.assertIsNone(next_grade_level(None))


class GetOrCreateClassStreamTests(TestCase):
    def setUp(self):
        curriculum = Curriculum.objects.create(code='CBC3', name='CBC (stream test)')
        tier = Tier.objects.create(curriculum=curriculum, name='Junior Secondary', code='JSS3')
        self.grade7 = GradeLevel.objects.create(name='Grade 7Z', numeric_order=7, curriculum=curriculum, tier=tier)
        self.grade8 = GradeLevel.objects.create(name='Grade 8Z', numeric_order=8, curriculum=curriculum, tier=tier)
        self.existing = ClassStream.objects.create(name='Central', grade=self.grade8)

    def test_returns_existing_stream_by_name(self):
        stream = get_or_create_class_stream(self.grade8, 'Central')
        self.assertEqual(stream.id, self.existing.id)

    def test_creates_stream_when_missing(self):
        stream = get_or_create_class_stream(self.grade7, 'Central')
        self.assertNotEqual(stream.id, self.existing.id)
        self.assertEqual(stream.grade_id, self.grade7.id)
        self.assertEqual(stream.capacity, 40)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `venv/bin/python manage.py test school.tests.test_promotion -v 2`
Expected: FAIL — `ImportError: cannot import name 'next_grade_level'` (and `exit_exam_code` field errors).

- [ ] **Step 3: Add the fields and helpers**

In `apps/academics/models.py`, right before the `Tier` class (~line 139), add:

```python
NATIONAL_EXAM_CHOICES = [
    ('KPSEA', 'KPSEA'),
    ('KJSEA', 'KJSEA'),
    ('KCSE', 'KCSE'),
]
```

Inside `Tier`, after `display_order` (~line 148):

```python
    exit_exam_code = models.CharField(
        max_length=10, choices=NATIONAL_EXAM_CHOICES, blank=True,
        help_text="National exam gating promotion out of this tier, if any. Blank means no "
                   "national exam — promotion out of this tier is a plain, internal-results-gated "
                   "transition (see results_finalized_for_year in school/views/promotion_views.py)."
    )
    exit_is_terminal = models.BooleanField(
        default=False,
        help_text="True if this tier's exit exam also ends the student's journey at this school "
                   "(cross-institution placement, e.g. KJSEA into Senior School, or school-leaving, "
                   "e.g. KCSE) rather than continuing into another grade at this school. Only "
                   "meaningful when exit_exam_code is set."
    )
```

Right after `grade_requires_pathway_choice` at the end of the `GradeLevel` section (~line 224), add:

```python
def next_grade_level(grade):
    """
    The next GradeLevel in the same curriculum by numeric_order, regardless of tier — this
    naturally spans tier boundaries (e.g. Grade 6 Upper Primary -> Grade 7 Junior Secondary)
    since a promotion tier isn't a 1:1 mapping to a single grade. Returns None for a
    curriculum's highest-numeric_order grade (a terminal exit grade, e.g. Grade 12/Form 4).
    """
    if grade is None:
        return None
    return GradeLevel.objects.filter(
        curriculum_id=grade.curriculum_id, numeric_order__gt=grade.numeric_order
    ).order_by('numeric_order').first()
```

Right after the `ClassStream` class body (~line 276), add:

```python
def get_or_create_class_stream(grade, name):
    """
    Finds the ClassStream named `name` within `grade`, creating it (default capacity, no
    assigned class teacher) if it doesn't exist yet. Used by promotion to move a student into
    "the same-named stream" in their next grade (e.g. Grade 10 Central -> Grade 11 Central),
    matching ClassStream's per-grade (not global) name uniqueness.
    """
    stream, _ = ClassStream.objects.get_or_create(
        grade=grade, name=name, is_deleted=False, defaults={'capacity': 40},
    )
    return stream
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `venv/bin/python manage.py test school.tests.test_promotion -v 2`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/academics/models.py school/tests/test_promotion.py
git commit -m "feat: add Tier exit-exam fields, next_grade_level, get_or_create_class_stream"
```

---

## Task 2: `ExamTerm` finalization fields

**Files:**
- Modify: `apps/academics/models.py` (`ExamTerm`, ~line 631-644)
- Test: `school/tests/test_promotion.py`

**Interfaces:**
- Produces: `ExamTerm.results_finalized` (bool), `ExamTerm.results_finalized_at` (datetime, nullable).

- [ ] **Step 1: Write the failing test**

```python
# Append to school/tests/test_promotion.py
from django.utils import timezone

from apps.academics.models import AcademicYear, ExamTerm


class ExamTermFinalizationFieldsTests(TestCase):
    def test_defaults_to_not_finalized(self):
        year = AcademicYear.objects.create(year='2099')
        term = ExamTerm.objects.create(name='Term 1', academic_year=year, start_date='2099-01-01', end_date='2099-04-01')
        self.assertFalse(term.results_finalized)
        self.assertIsNone(term.results_finalized_at)

    def test_can_be_finalized(self):
        year = AcademicYear.objects.create(year='2098')
        term = ExamTerm.objects.create(
            name='Term 1', academic_year=year, start_date='2098-01-01', end_date='2098-04-01',
            results_finalized=True, results_finalized_at=timezone.now(),
        )
        self.assertTrue(term.results_finalized)
        self.assertIsNotNone(term.results_finalized_at)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `venv/bin/python manage.py test school.tests.test_promotion.ExamTermFinalizationFieldsTests -v 2`
Expected: FAIL — `TypeError: 'results_finalized' is an invalid keyword argument`

- [ ] **Step 3: Add the fields**

In `apps/academics/models.py`'s `ExamTerm` class, after `is_active` (~line 641):

```python
    results_finalized = models.BooleanField(
        default=False,
        help_text="Admin-confirmed: this term's results are done being recorded. Purely "
                   "informational — does not block result regeneration. Used as the promotion "
                   "gate for plain (non-nationally-exam-gated) grade transitions — see "
                   "results_finalized_for_year in school/views/promotion_views.py."
    )
    results_finalized_at = models.DateTimeField(null=True, blank=True)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `venv/bin/python manage.py test school.tests.test_promotion.ExamTermFinalizationFieldsTests -v 2`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/academics/models.py school/tests/test_promotion.py
git commit -m "feat: add ExamTerm.results_finalized fields"
```

---

## Task 3: Cross-app schema — `NationalExamRecord`, `StudentExtra.Graduated`, `SystemAuditLog.PROMOTE`

**Files:**
- Modify: `apps/students/models.py` (new `NationalExamRecord` model)
- Modify: `apps/identity/models.py` (`StudentExtra.ENROLLMENT_STATUS_CHOICES`, ~line 225-234)
- Modify: `apps/core/models.py` (`SystemAuditLog.ACTION_CHOICES`, ~line 55-66)
- Test: `school/tests/test_promotion.py`

**Interfaces:**
- Produces: `apps.students.models.NationalExamRecord` (fields: `student`, `exam_code`, `academic_year`, `recorded_at`, `score`, `destination`, `recorded_by`); `StudentExtra.ENROLLMENT_STATUS_CHOICES` includes `'Graduated'`; `SystemAuditLog.ACTION_CHOICES` includes `'PROMOTE'`.

- [ ] **Step 1: Write the failing tests**

```python
# Append to school/tests/test_promotion.py
from django.contrib.auth.models import User

from apps.identity.models import StudentExtra
from apps.students.models import NationalExamRecord


class NationalExamRecordTests(TestCase):
    def setUp(self):
        self.curriculum = Curriculum.objects.create(code='CBC4', name='CBC (exam record test)')
        self.tier = Tier.objects.create(curriculum=self.curriculum, name='Junior Secondary', code='JSS4')
        self.grade9 = GradeLevel.objects.create(name='Grade 9Z', numeric_order=9, curriculum=self.curriculum, tier=self.tier)
        self.stream = ClassStream.objects.create(name='Central', grade=self.grade9)
        self.user = User.objects.create_user(username='exam_record_student', password='x')
        self.student = StudentExtra.objects.create(user=self.user, roll='EX01', cl=self.stream, status=True)
        self.year = AcademicYear.objects.create(year='2097')

    def test_can_record_a_national_exam(self):
        record = NationalExamRecord.objects.create(
            student=self.student, exam_code='KJSEA', academic_year=self.year, destination='Alliance High School',
        )
        self.assertEqual(record.destination, 'Alliance High School')
        self.assertIsNotNone(record.recorded_at)

    def test_one_record_per_student_exam_year(self):
        NationalExamRecord.objects.create(student=self.student, exam_code='KJSEA', academic_year=self.year)
        with self.assertRaises(Exception):
            NationalExamRecord.objects.create(student=self.student, exam_code='KJSEA', academic_year=self.year)


class StudentExtraGraduatedStateTests(TestCase):
    def test_graduated_is_a_valid_enrollment_state(self):
        codes = dict(StudentExtra.ENROLLMENT_STATUS_CHOICES)
        self.assertIn('Graduated', codes)


class AuditLogPromoteActionTests(TestCase):
    def test_promote_is_a_valid_action_type(self):
        from apps.core.models import SystemAuditLog
        codes = dict(SystemAuditLog.ACTION_CHOICES)
        self.assertIn('PROMOTE', codes)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `venv/bin/python manage.py test school.tests.test_promotion -v 2`
Expected: FAIL — `ImportError: cannot import name 'NationalExamRecord'`, and the two other tests fail on missing choices.

- [ ] **Step 3: Add `NationalExamRecord`**

In `apps/students/models.py`, add `from django.contrib.auth.models import User` to the top import (alongside the existing `from django.db import models`), and append at the end of the file:

```python
NATIONAL_EXAM_CHOICES = [
    ('KPSEA', 'KPSEA'),
    ('KJSEA', 'KJSEA'),
    ('KCSE', 'KCSE'),
]
# Duplicated (not imported) from apps.academics.models.NATIONAL_EXAM_CHOICES — .importlinter's
# no-model-import-students contract forbids `students` from importing apps.academics.models
# directly, and Django needs a real list at class-definition time for `choices=`, not a lazy
# app-label string reference like the FK fields below use. Three exam codes, unlikely to drift.


class NationalExamRecord(models.Model):
    """
    Records that a student sat one of Kenya's national exit exams (KPSEA/KJSEA/KCSE), gating
    the tier transitions Tier.exit_exam_code marks as exam-gated (apps/academics/models.py).
    `destination` is free text today (the placement school for KJSEA, or the
    university/institution for KCSE) — see sms-orient's multi-tenancy roadmap for why this
    isn't yet a real FK to another school.
    """
    student = models.ForeignKey('identity.StudentExtra', on_delete=models.CASCADE, related_name='national_exam_records')
    exam_code = models.CharField(max_length=10, choices=NATIONAL_EXAM_CHOICES)
    academic_year = models.ForeignKey('academics.AcademicYear', on_delete=models.CASCADE)
    recorded_at = models.DateTimeField(auto_now_add=True)
    score = models.CharField(max_length=20, blank=True, help_text="Informational only — not used by any gating logic.")
    destination = models.CharField(
        max_length=255, blank=True,
        help_text="Placement school (KJSEA) or university/institution (KCSE). Blank for KPSEA."
    )
    recorded_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)

    class Meta:
        db_table = 'school_nationalexamrecord'
        unique_together = ('student', 'exam_code', 'academic_year')

    def __str__(self):
        return f"{self.student.get_name} - {self.exam_code} ({self.academic_year.year})"
```

- [ ] **Step 4: Add `'Graduated'` enrollment state**

In `apps/identity/models.py`, in `StudentExtra.ENROLLMENT_STATUS_CHOICES` (~line 225-230):

```python
    ENROLLMENT_STATUS_CHOICES = [
        ('Active', 'Active'),
        ('Suspended', 'Suspended'),
        ('Expelled', 'Expelled'),
        ('Transferred', 'Transferred Out'),
        ('Graduated', 'Graduated'),
    ]
```

- [ ] **Step 5: Add `'PROMOTE'` audit action type**

In `apps/core/models.py`, in `SystemAuditLog.ACTION_CHOICES` (~line 55-66), after `('REJECT', 'Rejected Pending Account')`:

```python
        ('PROMOTE', 'Promoted or Graduated Student'),
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `venv/bin/python manage.py test school.tests.test_promotion -v 2`
Expected: PASS (13 tests total so far)

- [ ] **Step 7: Commit**

```bash
git add apps/students/models.py apps/identity/models.py apps/core/models.py school/tests/test_promotion.py
git commit -m "feat: add NationalExamRecord model, Graduated enrollment state, PROMOTE audit action"
```

**Migration reminder (do not run yourself):** Tasks 1-3 together require one migration each for `academics`, `students`, `identity`, `core`. Tell the user to run `makemigrations academics students identity core && migrate` once this plan is implemented — do not run it in this session.

---

## Task 4: Core-math guarantee helper

**Files:**
- Modify: `school/views/subject_views.py` (near `_approve_combo_subjects`, ~line 995-1011; call sites ~line 1235, ~1347)
- Test: `school/tests/test_promotion.py`

**Interfaces:**
- Consumes: `StudentSubjectEnrollment` (`apps.students.models`), `Subject` (`apps.academics.models`).
- Produces: `_ensure_core_mathematics(student, combo, academic_year) -> None`, called from `api_decide_pathway_request` and `api_admin_assign_pathway` immediately after their existing `_approve_combo_subjects(...)` calls.

- [ ] **Step 1: Write the failing test**

```python
# Append to school/tests/test_promotion.py
from apps.academics.models import Pathway, Track, PresetCombination, Subject
from apps.students.models import StudentSubjectEnrollment
from school.views.subject_views import _ensure_core_mathematics


class EnsureCoreMathematicsTests(TestCase):
    def setUp(self):
        self.curriculum = Curriculum.objects.create(code='CBC5', name='CBC (core math test)')
        self.tier = Tier.objects.create(curriculum=self.curriculum, name='Senior Secondary', code='SSS5')
        self.grade10 = GradeLevel.objects.create(name='Grade 10Z', numeric_order=10, curriculum=self.curriculum, tier=self.tier)
        self.stream = ClassStream.objects.create(name='Gold', grade=self.grade10)
        self.user = User.objects.create_user(username='core_math_student', password='x')
        self.student = StudentExtra.objects.create(user=self.user, roll='CM01', cl=self.stream, status=True)
        self.year = AcademicYear.objects.create(year='2096')

        self.pathway = Pathway.objects.create(curriculum=self.curriculum, name='STEM')
        self.track = Track.objects.create(pathway=self.pathway, name='Applied Sciences')

        # Real catalog codes, not test-local ones — _ensure_core_mathematics matches on these
        # exact codes, and Django's test runner gives every test a fresh empty database, so
        # there's no clash with the dev DB's seeded AMAT/CMAT/EMAT rows (id 87/86/88 there).
        self.amat = Subject.objects.create(code='AMAT', name='Advanced Mathematics')
        self.cmat = Subject.objects.create(code='CMAT', name='Core Mathematics')
        self.emat = Subject.objects.create(code='EMAT', name='Essential Mathematics')
        self.physics = Subject.objects.create(code='PHYZ', name='Physics Z')
        self.chem = Subject.objects.create(code='CHEZ', name='Chemistry Z')
        self.bio = Subject.objects.create(code='BIOZ', name='Biology Z')

    def test_adds_essential_maths_when_combo_has_no_maths(self):
        combo = PresetCombination.objects.create(track=self.track, name='No-Maths Combo', code='NM')
        combo.subjects.set([self.physics, self.chem, self.bio])

        _ensure_core_mathematics(self.student, combo, self.year)

        enrollment = StudentSubjectEnrollment.objects.get(student=self.student, subject=self.emat, academic_year=self.year)
        self.assertEqual(enrollment.status, 'Approved')

    def test_does_not_add_essential_maths_when_combo_has_advanced_maths(self):
        combo = PresetCombination.objects.create(track=self.track, name='AMAT Combo', code='AM')
        combo.subjects.set([self.amat, self.physics, self.chem])

        _ensure_core_mathematics(self.student, combo, self.year)

        self.assertFalse(
            StudentSubjectEnrollment.objects.filter(student=self.student, subject=self.emat, academic_year=self.year).exists()
        )

    def test_does_not_add_essential_maths_when_combo_has_core_maths(self):
        combo = PresetCombination.objects.create(track=self.track, name='CMAT Combo', code='CM')
        combo.subjects.set([self.cmat, self.physics, self.chem])

        _ensure_core_mathematics(self.student, combo, self.year)

        self.assertFalse(
            StudentSubjectEnrollment.objects.filter(student=self.student, subject=self.emat, academic_year=self.year).exists()
        )

    def test_idempotent_on_repeat_calls(self):
        combo = PresetCombination.objects.create(track=self.track, name='No-Maths Combo 2', code='NM2')
        combo.subjects.set([self.physics, self.chem, self.bio])

        _ensure_core_mathematics(self.student, combo, self.year)
        _ensure_core_mathematics(self.student, combo, self.year)

        self.assertEqual(
            StudentSubjectEnrollment.objects.filter(student=self.student, subject=self.emat, academic_year=self.year).count(), 1
        )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `venv/bin/python manage.py test school.tests.test_promotion.EnsureCoreMathematicsTests -v 2`
Expected: FAIL — `ImportError: cannot import name '_ensure_core_mathematics'`

- [ ] **Step 3: Implement the helper**

In `school/views/subject_views.py`, immediately after `_approve_combo_subjects` (~line 1004, before `_revert_combo_subjects`):

```python
def _ensure_core_mathematics(student, combo, academic_year):
    """
    Every SSS student must study mathematics regardless of pathway (per the CBC dossier). If
    `combo`'s subjects don't already include Advanced Mathematics (AMAT) or Core Mathematics
    (CMAT), auto-approve Essential Mathematics (EMAT) as an extra subject — added on top of
    the combo's 3, never displacing a chosen subject. Idempotent via update_or_create.
    """
    combo_codes = set(combo.subjects.values_list('code', flat=True))
    if combo_codes & {'AMAT', 'CMAT'}:
        return
    try:
        essential_maths = Subject.objects.get(code='EMAT')
    except Subject.DoesNotExist:
        return
    StudentSubjectEnrollment.objects.update_or_create(
        student=student, subject=essential_maths, academic_year=academic_year,
        defaults={'status': 'Approved'}
    )
```

- [ ] **Step 4: Wire the helper into both call sites**

In `school/views/subject_views.py`, at the `api_decide_pathway_request` call site (~line 1235):

```python
                _approve_combo_subjects(selection.student, combo, selection.academic_year)
                _ensure_core_mathematics(selection.student, combo, selection.academic_year)
```

And at the `api_admin_assign_pathway` call site (~line 1347):

```python
                _approve_combo_subjects(student, preset_combination, current_year)
                _ensure_core_mathematics(student, preset_combination, current_year)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `venv/bin/python manage.py test school.tests.test_promotion.EnsureCoreMathematicsTests -v 2`
Expected: PASS (4 tests)

- [ ] **Step 6: Run the full existing pathway-assignment suite to check for regressions**

Run: `venv/bin/python manage.py test school.tests.test_pathway_assignment -v 2`
Expected: PASS (all existing tests still pass — `_ensure_core_mathematics` is additive and only creates a *new* subject enrollment row, never modifies the combo's own 3 `StudentSubjectEnrollment` rows the existing tests assert on)

- [ ] **Step 7: Commit**

```bash
git add school/views/subject_views.py school/tests/test_promotion.py
git commit -m "feat: guarantee a mathematics subject for every SSS pathway combo"
```

---

## Task 5: Promotion transition-type resolution + core orchestration

**Files:**
- Create: `school/views/promotion_views.py`
- Test: `school/tests/test_promotion.py`

**Interfaces:**
- Consumes: `next_grade_level`, `get_or_create_class_stream` (Task 1); `Tier.exit_exam_code`/`exit_is_terminal`, `ExamTerm.results_finalized` (Tasks 1-2); `NationalExamRecord` (Task 3); `_approve_combo_subjects`, `_ensure_core_mathematics` (Task 4, `school.views.subject_views`); `tier_requires_pathway_choice` (`apps.academics.models`).
- Produces: `_determine_transition(grade) -> tuple[str, Optional[str], Optional[GradeLevel]]` (`'plain'|'exam_gated'|'exit'`, exam_code or `None`, next_grade or `None`); `results_finalized_for_year(academic_year) -> bool`; `_promote_student(student, academic_year) -> dict` (`{'student_id', 'outcome': 'promoted'|'graduated'|'held', 'detail'}`) — consumed by Task 6's bulk endpoint.

- [ ] **Step 1: Write the failing tests**

```python
# Append to school/tests/test_promotion.py
from school.views.promotion_views import _determine_transition, results_finalized_for_year, _promote_student


class DetermineTransitionTests(TestCase):
    def setUp(self):
        self.curriculum = Curriculum.objects.create(code='CBC6', name='CBC (transition test)')

    def test_plain_when_no_exit_exam_code(self):
        tier = Tier.objects.create(curriculum=self.curriculum, name='Lower Primary', code='LP6')
        g3 = GradeLevel.objects.create(name='Grade 3Y', numeric_order=3, curriculum=self.curriculum, tier=tier)
        g4 = GradeLevel.objects.create(name='Grade 4Y', numeric_order=4, curriculum=self.curriculum, tier=Tier.objects.create(curriculum=self.curriculum, name='Upper Primary', code='UP6'))
        transition_type, exam_code, next_grade = _determine_transition(g3)
        self.assertEqual(transition_type, 'plain')
        self.assertIsNone(exam_code)
        self.assertEqual(next_grade.id, g4.id)

    def test_exam_gated_when_exit_exam_code_set_and_not_terminal(self):
        tier = Tier.objects.create(
            curriculum=self.curriculum, name='Upper Primary', code='UP6X',
            exit_exam_code='KPSEA', exit_is_terminal=False,
        )
        jss_tier = Tier.objects.create(curriculum=self.curriculum, name='Junior Secondary', code='JSS6X')
        g6 = GradeLevel.objects.create(name='Grade 6Y', numeric_order=6, curriculum=self.curriculum, tier=tier)
        g7 = GradeLevel.objects.create(name='Grade 7Y', numeric_order=7, curriculum=self.curriculum, tier=jss_tier)
        transition_type, exam_code, next_grade = _determine_transition(g6)
        self.assertEqual(transition_type, 'exam_gated')
        self.assertEqual(exam_code, 'KPSEA')
        self.assertEqual(next_grade.id, g7.id)

    def test_exit_when_terminal(self):
        tier = Tier.objects.create(
            curriculum=self.curriculum, name='Junior Secondary', code='JSS6Y',
            exit_exam_code='KJSEA', exit_is_terminal=True,
        )
        GradeLevel.objects.create(name='Grade 9Y', numeric_order=9, curriculum=self.curriculum, tier=tier)
        g9 = GradeLevel.objects.get(name='Grade 9Y')
        # A Grade 10 row exists elsewhere in the school's data, but must be ignored for 'exit'.
        other_tier = Tier.objects.create(curriculum=self.curriculum, name='Senior Secondary', code='SSS6Y')
        GradeLevel.objects.create(name='Grade 10Y', numeric_order=10, curriculum=self.curriculum, tier=other_tier)
        transition_type, exam_code, next_grade = _determine_transition(g9)
        self.assertEqual(transition_type, 'exit')
        self.assertEqual(exam_code, 'KJSEA')
        self.assertIsNone(next_grade)

    def test_plain_when_no_tier(self):
        g = GradeLevel.objects.create(name='Grade 1Y', numeric_order=1, curriculum=self.curriculum, tier=None)
        transition_type, exam_code, next_grade = _determine_transition(g)
        self.assertEqual(transition_type, 'plain')
        self.assertIsNone(exam_code)


class ResultsFinalizedForYearTests(TestCase):
    def test_false_when_no_terms(self):
        year = AcademicYear.objects.create(year='2095')
        self.assertFalse(results_finalized_for_year(year))

    def test_false_when_any_term_not_finalized(self):
        year = AcademicYear.objects.create(year='2094')
        ExamTerm.objects.create(name='Term 1', academic_year=year, start_date='2094-01-01', end_date='2094-04-01', results_finalized=True)
        ExamTerm.objects.create(name='Term 2', academic_year=year, start_date='2094-05-01', end_date='2094-08-01', results_finalized=False)
        self.assertFalse(results_finalized_for_year(year))

    def test_true_when_all_terms_finalized(self):
        year = AcademicYear.objects.create(year='2093')
        ExamTerm.objects.create(name='Term 1', academic_year=year, start_date='2093-01-01', end_date='2093-04-01', results_finalized=True)
        ExamTerm.objects.create(name='Term 2', academic_year=year, start_date='2093-05-01', end_date='2093-08-01', results_finalized=True)
        self.assertTrue(results_finalized_for_year(year))


class PromoteStudentTests(TestCase):
    def setUp(self):
        self.curriculum = Curriculum.objects.create(code='CBC7', name='CBC (promote test)')
        self.year = AcademicYear.objects.create(year='2092')

    def test_plain_promotion_held_when_results_not_finalized(self):
        tier = Tier.objects.create(curriculum=self.curriculum, name='Lower Primary', code='LP7')
        g1 = GradeLevel.objects.create(name='Grade 1X', numeric_order=1, curriculum=self.curriculum, tier=tier)
        GradeLevel.objects.create(name='Grade 2X', numeric_order=2, curriculum=self.curriculum, tier=tier)
        stream = ClassStream.objects.create(name='Central', grade=g1)
        user = User.objects.create_user(username='plain_promo_student', password='x')
        student = StudentExtra.objects.create(user=user, roll='PP01', cl=stream, status=True)
        ExamTerm.objects.create(name='Term 1', academic_year=self.year, start_date='2092-01-01', end_date='2092-04-01', results_finalized=False)

        result = _promote_student(student, self.year)
        self.assertEqual(result['outcome'], 'held')
        student.refresh_from_db()
        self.assertEqual(student.cl_id, stream.id)

    def test_plain_promotion_succeeds_when_results_finalized(self):
        tier = Tier.objects.create(curriculum=self.curriculum, name='Lower Primary', code='LP7B')
        g1 = GradeLevel.objects.create(name='Grade 1W', numeric_order=1, curriculum=self.curriculum, tier=tier)
        g2 = GradeLevel.objects.create(name='Grade 2W', numeric_order=2, curriculum=self.curriculum, tier=tier)
        stream = ClassStream.objects.create(name='Central', grade=g1)
        user = User.objects.create_user(username='plain_promo_student2', password='x')
        student = StudentExtra.objects.create(user=user, roll='PP02', cl=stream, status=True)
        ExamTerm.objects.create(name='Term 1', academic_year=self.year, start_date='2092-01-01', end_date='2092-04-01', results_finalized=True)

        result = _promote_student(student, self.year)
        self.assertEqual(result['outcome'], 'promoted')
        student.refresh_from_db()
        self.assertEqual(student.cl.grade_id, g2.id)
        self.assertEqual(student.cl.name, 'Central')

    def test_exam_gated_promotion_held_without_record(self):
        tier = Tier.objects.create(
            curriculum=self.curriculum, name='Upper Primary', code='UP7',
            exit_exam_code='KPSEA', exit_is_terminal=False,
        )
        jss_tier = Tier.objects.create(curriculum=self.curriculum, name='Junior Secondary', code='JSS7')
        g6 = GradeLevel.objects.create(name='Grade 6W', numeric_order=6, curriculum=self.curriculum, tier=tier)
        GradeLevel.objects.create(name='Grade 7W', numeric_order=7, curriculum=self.curriculum, tier=jss_tier)
        stream = ClassStream.objects.create(name='Central', grade=g6)
        user = User.objects.create_user(username='kpsea_student', password='x')
        student = StudentExtra.objects.create(user=user, roll='KP01', cl=stream, status=True)

        result = _promote_student(student, self.year)
        self.assertEqual(result['outcome'], 'held')

    def test_exit_transition_graduates_without_moving_class(self):
        tier = Tier.objects.create(
            curriculum=self.curriculum, name='Junior Secondary', code='JSS7B',
            exit_exam_code='KJSEA', exit_is_terminal=True,
        )
        g9 = GradeLevel.objects.create(name='Grade 9W', numeric_order=9, curriculum=self.curriculum, tier=tier)
        stream = ClassStream.objects.create(name='Central', grade=g9)
        user = User.objects.create_user(username='kjsea_student', password='x')
        student = StudentExtra.objects.create(user=user, roll='KJ01', cl=stream, status=True)
        NationalExamRecord.objects.create(
            student=student, exam_code='KJSEA', academic_year=self.year, destination='Alliance High School',
        )

        result = _promote_student(student, self.year)
        self.assertEqual(result['outcome'], 'graduated')
        student.refresh_from_db()
        self.assertEqual(student.enrollment_state, 'Graduated')
        self.assertEqual(student.cl_id, stream.id)  # cl untouched — cross-institution, no local reassignment

    def test_held_when_no_current_class(self):
        user = User.objects.create_user(username='no_class_student', password='x')
        student = StudentExtra.objects.create(user=user, roll='NC01', cl=None, status=True)
        result = _promote_student(student, self.year)
        self.assertEqual(result['outcome'], 'held')
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `venv/bin/python manage.py test school.tests.test_promotion -v 2`
Expected: FAIL — `ModuleNotFoundError: No module named 'school.views.promotion_views'`

- [ ] **Step 3: Implement `school/views/promotion_views.py`**

```python
"""
Grade promotion: plain (internal-results-gated), same-institution exam-gated (KPSEA), and
exit (cross-institution or terminal, KJSEA/KCSE) transitions. See
docs/superpowers/specs/2026-08-12-sss-core-math-and-promotion-design.md.
"""
from apps.academics.models import ExamTerm, next_grade_level, get_or_create_class_stream, tier_requires_pathway_choice
from apps.students.models import NationalExamRecord, StudentPathwaySelection
from apps.core.services import write_audit_log
from school.views.subject_views import _approve_combo_subjects, _ensure_core_mathematics


def _determine_transition(grade):
    """
    Classifies the promotion edge leaving `grade`:
      - ('plain', None, next_grade) — no national exam gates this exit.
      - ('exam_gated', exam_code, next_grade) — same-institution, gated on that exam being recorded.
      - ('exit', exam_code, None) — cross-institution or terminal; no cl reassignment.
    Driven entirely by the admin-configured Tier.exit_exam_code/exit_is_terminal fields — never
    hardcoded grade numbers, matching tier_requires_pathway_choice's own convention.
    """
    tier = grade.tier
    next_grade = next_grade_level(grade)
    if tier is None or not tier.exit_exam_code:
        return ('plain', None, next_grade)
    if tier.exit_is_terminal:
        return ('exit', tier.exit_exam_code, None)
    return ('exam_gated', tier.exit_exam_code, next_grade)


def results_finalized_for_year(academic_year):
    """True once every ExamTerm under `academic_year` has been admin-finalized (Task 2)."""
    terms = ExamTerm.objects.filter(academic_year=academic_year)
    return terms.exists() and not terms.filter(results_finalized=False).exists()


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


def _move_student_to_grade(student, next_grade, academic_year):
    """Reassigns cl to the same-named stream in next_grade, creating it if needed, and carries
    forward the pathway selection for SSS grades."""
    current_stream_name = student.cl.name
    new_stream = get_or_create_class_stream(next_grade, current_stream_name)
    student.cl = new_stream
    student.save(update_fields=['cl'])

    if tier_requires_pathway_choice(next_grade.tier):
        _carry_forward_pathway_selection(student, academic_year)


def _promote_student(student, academic_year):
    """
    Attempts to promote one student for `academic_year`.
    Returns {'student_id', 'outcome': 'promoted'|'graduated'|'held', 'detail': str}.
    Never raises for a normal "not ready yet" case — those are 'held', not errors.
    """
    grade = student.cl.grade if student.cl_id else None
    if grade is None:
        return {'student_id': student.id, 'outcome': 'held', 'detail': 'No current class assigned.'}

    transition_type, exam_code, next_grade = _determine_transition(grade)

    if transition_type == 'plain':
        if not results_finalized_for_year(academic_year):
            return {'student_id': student.id, 'outcome': 'held', 'detail': 'Results not yet finalized for this academic year.'}
        if next_grade is None:
            return {'student_id': student.id, 'outcome': 'held', 'detail': 'No next grade configured after this one.'}
        _move_student_to_grade(student, next_grade, academic_year)
        return {'student_id': student.id, 'outcome': 'promoted', 'detail': f'Promoted to {next_grade.name}.'}

    record = NationalExamRecord.objects.filter(student=student, exam_code=exam_code, academic_year=academic_year).first()
    if record is None:
        return {'student_id': student.id, 'outcome': 'held', 'detail': f'{exam_code} not yet recorded.'}

    if transition_type == 'exam_gated':
        if next_grade is None:
            return {'student_id': student.id, 'outcome': 'held', 'detail': 'No next grade configured after this one.'}
        _move_student_to_grade(student, next_grade, academic_year)
        return {'student_id': student.id, 'outcome': 'promoted', 'detail': f'Promoted to {next_grade.name} ({exam_code} recorded).'}

    # transition_type == 'exit'
    student.enrollment_state = 'Graduated'
    student.save(update_fields=['enrollment_state'])
    destination = record.destination or 'not yet recorded'
    return {'student_id': student.id, 'outcome': 'graduated', 'detail': f'Graduated ({exam_code} recorded). Destination: {destination}.'}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `venv/bin/python manage.py test school.tests.test_promotion -v 2`
Expected: PASS (all tests so far, ~26 tests)

- [ ] **Step 5: Commit**

```bash
git add school/views/promotion_views.py school/tests/test_promotion.py
git commit -m "feat: add promotion transition-type resolution and per-student orchestration"
```

---

## Task 6: Admin endpoints — finalize term, record national exam

**Files:**
- Modify: `school/views/promotion_views.py`
- Modify: `schoolmanagement/Urls/urls.py` (near the `api/subjects/`/`api/results/` blocks, ~line 233/287)
- Test: `school/tests/test_promotion.py`

**Interfaces:**
- Consumes: `HasModulePermission` (`school.rbac`), `write_audit_log` (`apps.core.services`).
- Produces: `FinalizeTermAPIView` (`POST /api/promotion/finalize-term/<int:term_id>/`), `RecordNationalExamAPIView` (`POST /api/promotion/national-exam/<int:student_id>/`).

- [ ] **Step 1: Write the failing tests**

```python
# Append to school/tests/test_promotion.py
import json
from django.test import RequestFactory

from school.tests.base import ExamTestDataMixin
from apps.identity.models import Permission, Role, UserRole
from school.views.promotion_views import FinalizeTermAPIView, RecordNationalExamAPIView


class PromotionAdminEndpointTestMixin(ExamTestDataMixin):
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        Permission.objects.get_or_create(code='results.edit', defaults={'label': 'results.edit', 'module': 'results'})
        Permission.objects.get_or_create(code='results.view', defaults={'label': 'results.view', 'module': 'results'})
        role = Role.objects.create(name='Results Manager')
        role.permissions.set(Permission.objects.filter(code__in=('results.edit', 'results.view')))
        UserRole.objects.create(user=cls.admin_user, role=role)

        cls.grade9 = GradeLevel.objects.create(
            name='Grade 9 Promo', numeric_order=9,
            curriculum=Curriculum.objects.create(code='CBC8', name='CBC (endpoint test)'),
        )
        cls.stream = ClassStream.objects.create(name='Central', grade=cls.grade9)
        exam_user = User.objects.create_user(username='promo_endpoint_student', password='x')
        cls.exam_student = StudentExtra.objects.create(user=exam_user, roll='PE01', cl=cls.stream, status=True)

    def setUp(self):
        self.factory = RequestFactory()

    def _post(self, view, path, user, payload, **kwargs):
        request = self.factory.post(path, data=json.dumps(payload), content_type='application/json')
        request.user = user
        response = view.as_view()(request, **kwargs)
        return response


class FinalizeTermAPIViewTests(PromotionAdminEndpointTestMixin, TestCase):
    def test_admin_can_finalize_term(self):
        response = self._post(
            FinalizeTermAPIView, f'/api/promotion/finalize-term/{self.term.id}/',
            self.admin_user, {'finalized': True}, term_id=self.term.id,
        )
        self.assertEqual(response.status_code, 200)
        self.term.refresh_from_db()
        self.assertTrue(self.term.results_finalized)
        self.assertIsNotNone(self.term.results_finalized_at)

    def test_can_un_finalize(self):
        self.term.results_finalized = True
        self.term.save()
        response = self._post(
            FinalizeTermAPIView, f'/api/promotion/finalize-term/{self.term.id}/',
            self.admin_user, {'finalized': False}, term_id=self.term.id,
        )
        self.assertEqual(response.status_code, 200)
        self.term.refresh_from_db()
        self.assertFalse(self.term.results_finalized)
        self.assertIsNone(self.term.results_finalized_at)


class RecordNationalExamAPIViewTests(PromotionAdminEndpointTestMixin, TestCase):
    def test_admin_can_record_an_exam(self):
        response = self._post(
            RecordNationalExamAPIView, f'/api/promotion/national-exam/{self.exam_student.id}/',
            self.admin_user, {'exam_code': 'KJSEA', 'academic_year_id': self.year.id, 'destination': 'Alliance High School'},
            student_id=self.exam_student.id,
        )
        self.assertEqual(response.status_code, 201)
        record = NationalExamRecord.objects.get(student=self.exam_student, exam_code='KJSEA')
        self.assertEqual(record.destination, 'Alliance High School')
        self.assertEqual(record.recorded_by_id, self.admin_user.id)

    def test_duplicate_record_for_same_year_updates_not_duplicates(self):
        self._post(
            RecordNationalExamAPIView, f'/api/promotion/national-exam/{self.exam_student.id}/',
            self.admin_user, {'exam_code': 'KJSEA', 'academic_year_id': self.year.id, 'destination': 'First School'},
            student_id=self.exam_student.id,
        )
        self._post(
            RecordNationalExamAPIView, f'/api/promotion/national-exam/{self.exam_student.id}/',
            self.admin_user, {'exam_code': 'KJSEA', 'academic_year_id': self.year.id, 'destination': 'Corrected School'},
            student_id=self.exam_student.id,
        )
        self.assertEqual(NationalExamRecord.objects.filter(student=self.exam_student, exam_code='KJSEA').count(), 1)
        self.assertEqual(
            NationalExamRecord.objects.get(student=self.exam_student, exam_code='KJSEA').destination, 'Corrected School'
        )
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `venv/bin/python manage.py test school.tests.test_promotion -v 2`
Expected: FAIL — `ImportError: cannot import name 'FinalizeTermAPIView'`

- [ ] **Step 3: Implement the two endpoints**

Append to `school/views/promotion_views.py` (add these imports to the top first: `from django.utils import timezone`, `from rest_framework.authentication import SessionAuthentication`, `from rest_framework.permissions import IsAuthenticated`, `from rest_framework.views import APIView`, `from rest_framework.response import Response`, `from rest_framework import status`, `from school.rbac import HasModulePermission`, `from apps.academics.models import AcademicYear`, `from apps.identity.models import StudentExtra`):

```python
class FinalizeTermAPIView(APIView):
    """Admin toggle for ExamTerm.results_finalized — purely informational, does not block
    result regeneration (see Task 2/spec §2)."""
    permission_classes = [IsAuthenticated, HasModulePermission]
    authentication_classes = [SessionAuthentication]
    rbac_edit_permission = 'results.edit'

    def post(self, request, term_id):
        try:
            term = ExamTerm.objects.get(id=term_id)
        except ExamTerm.DoesNotExist:
            return Response({"error": "Term not found."}, status=status.HTTP_404_NOT_FOUND)

        finalized = bool(request.data.get('finalized', True))
        term.results_finalized = finalized
        term.results_finalized_at = timezone.now() if finalized else None
        term.save(update_fields=['results_finalized', 'results_finalized_at'])

        write_audit_log(
            operator_id=request.user.id, action_type='UPDATE', module='PromotionResultsFinalization',
            description=f"{'Finalized' if finalized else 'Un-finalized'} results for term "
                        f"'{term.name}' ({term.academic_year.year}).",
        )
        return Response({"id": term.id, "results_finalized": term.results_finalized})


class RecordNationalExamAPIView(APIView):
    """Admin records that a student sat KPSEA/KJSEA/KCSE, optionally with a destination
    (placement school for KJSEA, university/institution for KCSE)."""
    permission_classes = [IsAuthenticated, HasModulePermission]
    authentication_classes = [SessionAuthentication]
    rbac_edit_permission = 'results.edit'

    def post(self, request, student_id):
        try:
            student = StudentExtra.objects.get(id=student_id)
        except StudentExtra.DoesNotExist:
            return Response({"error": "Student not found."}, status=status.HTTP_404_NOT_FOUND)

        exam_code = request.data.get('exam_code')
        academic_year_id = request.data.get('academic_year_id')
        if exam_code not in ('KPSEA', 'KJSEA', 'KCSE') or not academic_year_id:
            return Response({"error": "exam_code and academic_year_id are required."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            academic_year = AcademicYear.objects.get(id=academic_year_id)
        except AcademicYear.DoesNotExist:
            return Response({"error": "Academic year not found."}, status=status.HTTP_404_NOT_FOUND)

        record, created = NationalExamRecord.objects.update_or_create(
            student=student, exam_code=exam_code, academic_year=academic_year,
            defaults={
                'score': request.data.get('score', ''),
                'destination': request.data.get('destination', ''),
                'recorded_by': request.user,
            },
        )
        write_audit_log(
            operator_id=request.user.id, action_type='UPDATE', module='NationalExamRecord',
            description=f"Recorded {exam_code} for {student.get_name} ({academic_year.year}).",
        )
        return Response(
            {"id": record.id, "exam_code": record.exam_code, "destination": record.destination},
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )
```

- [ ] **Step 4: Register the routes**

In `schoolmanagement/Urls/urls.py`, add near the `api/results/` block (~line 287), after importing `promotion_views` alongside the existing `subject_views`/`results_views` imports at the top of the file:

```python
    path('api/promotion/finalize-term/<int:term_id>/', promotion_views.FinalizeTermAPIView.as_view(), name='finalize_term'),
    path('api/promotion/national-exam/<int:student_id>/', promotion_views.RecordNationalExamAPIView.as_view(), name='record_national_exam'),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `venv/bin/python manage.py test school.tests.test_promotion -v 2`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add school/views/promotion_views.py schoolmanagement/Urls/urls.py school/tests/test_promotion.py
git commit -m "feat: add finalize-term and record-national-exam admin endpoints"
```

---

## Task 7: Bulk promote endpoint + Celery task

**Files:**
- Modify: `school/views/promotion_views.py`
- Modify: `orchestration/tasks.py` (mirrors `bulk_generate_term_results_task`, ~line 315-364)
- Modify: `schoolmanagement/Urls/urls.py`
- Test: `school/tests/test_promotion.py`

**Interfaces:**
- Consumes: `dispatch_background_job` (`school.jobs`), `_promote_student` (Task 5), `BackgroundJob` (`apps.core.models`).
- Produces: `PromoteStudentsAPIView` (`POST /api/promotion/promote-students/`), `promote_students_task` Celery task.

- [ ] **Step 1: Write the failing test**

```python
# Append to school/tests/test_promotion.py
from django.test import override_settings
from school.views.promotion_views import PromoteStudentsAPIView


class PromoteStudentsAPIViewTests(PromotionAdminEndpointTestMixin, TestCase):
    @override_settings(CELERY_TASK_ALWAYS_EAGER=True)
    def test_admin_can_queue_a_bulk_promotion(self):
        self.term.results_finalized = True
        self.term.save()
        response = self._post(
            PromoteStudentsAPIView, '/api/promotion/promote-students/',
            self.admin_user, {'academic_year_id': self.year.id, 'grade_id': self.grade9.id},
        )
        self.assertEqual(response.status_code, 202)

    def test_non_admin_cannot_queue_a_bulk_promotion(self):
        response = self._post(
            PromoteStudentsAPIView, '/api/promotion/promote-students/',
            self.teacher_user, {'academic_year_id': self.year.id, 'grade_id': self.grade9.id},
        )
        self.assertEqual(response.status_code, 403)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `venv/bin/python manage.py test school.tests.test_promotion.PromoteStudentsAPIViewTests -v 2`
Expected: FAIL — `ImportError: cannot import name 'PromoteStudentsAPIView'`

- [ ] **Step 3: Add the Celery task**

In `orchestration/tasks.py`, alongside `bulk_generate_term_results_task`, add:

```python
@shared_task(bind=True)
def promote_students_task(self, job_id, academic_year_id, student_ids, operator_id):
    from apps.identity.models import StudentExtra
    from apps.academics.models import AcademicYear
    from school.views.promotion_views import _promote_student

    _mark_running(job_id)
    try:
        with transaction.atomic():
            academic_year = AcademicYear.objects.get(id=academic_year_id)
            students = StudentExtra.objects.filter(id__in=student_ids).select_related('cl__grade__tier')

            outcomes = [_promote_student(s, academic_year) for s in students]
            promoted = sum(1 for o in outcomes if o['outcome'] == 'promoted')
            graduated = sum(1 for o in outcomes if o['outcome'] == 'graduated')
            held = sum(1 for o in outcomes if o['outcome'] == 'held')

            core_services.write_audit_log(
                operator_id=operator_id, action_type='PROMOTE', module='BulkPromoteStudents',
                description=f"Promotion run for {academic_year.year}: {promoted} promoted, "
                            f"{graduated} graduated, {held} held.",
            )
        _mark_success(job_id, {
            "message": f"{promoted} promoted, {graduated} graduated, {held} held pending results/exams.",
            "outcomes": outcomes,
        })
    except Exception as e:
        _mark_failure(job_id, str(e))
```

- [ ] **Step 4: Add `PromoteStudentsAPIView`**

Append to `school/views/promotion_views.py` (add `from django.contrib.auth.models import User` isn't needed; add `from school.jobs import dispatch_background_job` and `from orchestration.tasks import promote_students_task` to the top imports):

```python
class PromoteStudentsAPIView(APIView):
    """Admin-triggered bulk promotion (see spec §4 — no scheduler infra exists in this repo,
    so this is on-demand, mirroring BulkGenerateTermResultsAPIView's exact pattern)."""
    permission_classes = [IsAuthenticated, HasModulePermission]
    authentication_classes = [SessionAuthentication]
    rbac_edit_permission = 'results.edit'

    def post(self, request):
        academic_year_id = request.data.get('academic_year_id')
        grade_id = request.data.get('grade_id')
        stream_id = request.data.get('stream_id')

        if not academic_year_id:
            return Response({"error": "academic_year_id is mandatory."}, status=status.HTTP_400_BAD_REQUEST)

        user = request.user
        is_admin = user.is_superuser or user.groups.filter(name='ADMIN').exists()
        if not is_admin:
            return Response({"error": "Only Administrators can run a bulk promotion."}, status=status.HTTP_403_FORBIDDEN)

        students_qs = StudentExtra.objects.filter(status=True)
        if stream_id:
            students_qs = students_qs.filter(cl_id=stream_id)
        elif grade_id:
            students_qs = students_qs.filter(cl__grade_id=grade_id)
        student_ids = list(students_qs.values_list('id', flat=True))

        if not student_ids:
            return Response({"error": "No students found for the given scope."}, status=status.HTTP_404_NOT_FOUND)

        job, error_response = dispatch_background_job(
            job_type='promote_students',
            task=promote_students_task,
            task_args=(academic_year_id, student_ids, request.user.id),
            operator=request.user,
        )
        if error_response is not None:
            return error_response

        return Response({"status": "queued", "job_id": str(job.id)}, status=status.HTTP_202_ACCEPTED)
```

- [ ] **Step 5: Register the route**

In `schoolmanagement/Urls/urls.py`:

```python
    path('api/promotion/promote-students/', promotion_views.PromoteStudentsAPIView.as_view(), name='promote_students'),
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `venv/bin/python manage.py test school.tests.test_promotion -v 2`
Expected: PASS (full suite for this file)

- [ ] **Step 7: Run the full backend suite for regressions**

Run: `venv/bin/python manage.py test school.tests --keepdb`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add school/views/promotion_views.py orchestration/tasks.py schoolmanagement/Urls/urls.py school/tests/test_promotion.py
git commit -m "feat: add bulk promote-students endpoint and Celery task"
```

---

## Task 8: Dashboard reflection — backend

**Files:**
- Modify: `school/views/student_dashboard_view.py` (~line 13-33)
- Test: `school/tests/test_promotion.py`

**Interfaces:**
- Produces: `StudentDashboardOverviewAPI`'s `profile_data` gains `enrollment_state`, `graduation_destination` keys.

- [ ] **Step 1: Write the failing test**

```python
# Append to school/tests/test_promotion.py
from school.views.student_dashboard_view import StudentDashboardOverviewAPI


class StudentDashboardGraduatedReflectionTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        curriculum = Curriculum.objects.create(code='CBC9', name='CBC (dashboard test)')
        tier = Tier.objects.create(curriculum=curriculum, name='Junior Secondary', code='JSS9', exit_exam_code='KJSEA', exit_is_terminal=True)
        grade9 = GradeLevel.objects.create(name='Grade 9 Dash', numeric_order=9, curriculum=curriculum, tier=tier)
        stream = ClassStream.objects.create(name='Central', grade=grade9)
        self.user = User.objects.create_user(username='dash_grad_student', password='x')
        self.student = StudentExtra.objects.create(
            user=self.user, roll='DG01', cl=stream, status=True, enrollment_state='Graduated',
        )
        year = AcademicYear.objects.create(year='2091')
        NationalExamRecord.objects.create(
            student=self.student, exam_code='KJSEA', academic_year=year, destination='Alliance High School',
        )

    def test_dashboard_surfaces_graduated_state_and_destination(self):
        request = self.factory.get('/api/student/dashboard-overview/')
        request.user = self.user
        response = StudentDashboardOverviewAPI.as_view()(request)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['profile']['enrollment_state'], 'Graduated')
        self.assertEqual(response.data['profile']['graduation_destination'], 'Alliance High School')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `venv/bin/python manage.py test school.tests.test_promotion.StudentDashboardGraduatedReflectionTests -v 2`
Expected: FAIL — `KeyError: 'enrollment_state'`

- [ ] **Step 3: Extend the view**

In `school/views/student_dashboard_view.py`, add `from apps.students.models import NationalExamRecord` to the imports, then in `StudentDashboardOverviewAPI.get`, after building `profile_data` (~line 26-33):

```python
        latest_exam_record = NationalExamRecord.objects.filter(student=student).order_by('-recorded_at').first()

        profile_data = {
            "name": student.get_name,
            "roll": student.roll,
            "class_name": get_class_stream_name(student.cl),
            "mobile": student.mobile,
            "fee": student.fee,
            "profile_pic": request.build_absolute_uri(student.profile_pic.url) if student.profile_pic else None,
            "enrollment_state": student.enrollment_state,
            "graduation_destination": latest_exam_record.destination if latest_exam_record else None,
        }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `venv/bin/python manage.py test school.tests.test_promotion.StudentDashboardGraduatedReflectionTests -v 2`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add school/views/student_dashboard_view.py school/tests/test_promotion.py
git commit -m "feat: surface enrollment_state and graduation destination on student dashboard"
```

---

## Task 9: Frontend — Promotion tab in Results Hub (finalize term, record exam, bulk promote)

**Files:**
- Create: `frontend/src/components/results/PromotionPanel.tsx`
- Modify: `frontend/src/components/results/ResultsHub.tsx` (add a 4th tab, admin-only)

**Interfaces:**
- Consumes: `POST /api/promotion/finalize-term/:termId/`, `POST /api/promotion/national-exam/:studentId/`, `POST /api/promotion/promote-students/`, `pollJob` (`frontend/src/libs/pollJob.ts`), `api` (existing axios instance used elsewhere in `results/`).

- [ ] **Step 1: Check how `api` is imported in this directory**

Run: `grep -n "^import api" frontend/src/components/results/ClassPerformanceSummary.tsx`
Expected output confirms the import path to reuse (e.g. `import api from '../../libs/api';` or similar) — use the exact same path in the new file.

- [ ] **Step 2: Build the panel component**

```tsx
// frontend/src/components/results/PromotionPanel.tsx
import { useState } from 'react';
import {
  Box, Card, CardContent, CardHeader, Button, TextField, MenuItem, Alert,
  CircularProgress, Stack, Typography, Switch, FormControlLabel,
} from '@mui/material';
import { GraduationCap, CheckCircle2 } from 'lucide-react';
import api from '../../libs/api'; // adjust to match Step 1's confirmed import path
import { pollJob } from '../../libs/pollJob';

interface PromotionResult {
  message: string;
  outcomes: { student_id: number; outcome: string; detail: string }[];
}

export default function PromotionPanel() {
  const [termId, setTermId] = useState('');
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeMsg, setFinalizeMsg] = useState<string | null>(null);

  const [examStudentId, setExamStudentId] = useState('');
  const [examCode, setExamCode] = useState('KJSEA');
  const [academicYearId, setAcademicYearId] = useState('');
  const [destination, setDestination] = useState('');
  const [recordingExam, setRecordingExam] = useState(false);
  const [examMsg, setExamMsg] = useState<string | null>(null);

  const [promoteYearId, setPromoteYearId] = useState('');
  const [promoteGradeId, setPromoteGradeId] = useState('');
  const [promoting, setPromoting] = useState(false);
  const [promoteResult, setPromoteResult] = useState<PromotionResult | null>(null);
  const [promoteError, setPromoteError] = useState<string | null>(null);

  const handleFinalize = async (finalized: boolean) => {
    if (!termId) return;
    setFinalizing(true);
    setFinalizeMsg(null);
    try {
      await api.post(`/api/promotion/finalize-term/${termId}/`, { finalized });
      setFinalizeMsg(finalized ? 'Term finalized.' : 'Term un-finalized.');
    } catch (err: any) {
      setFinalizeMsg(err.response?.data?.error || 'Failed to update finalization state.');
    } finally {
      setFinalizing(false);
    }
  };

  const handleRecordExam = async () => {
    if (!examStudentId || !academicYearId) return;
    setRecordingExam(true);
    setExamMsg(null);
    try {
      await api.post(`/api/promotion/national-exam/${examStudentId}/`, {
        exam_code: examCode, academic_year_id: academicYearId, destination,
      });
      setExamMsg('Exam record saved.');
    } catch (err: any) {
      setExamMsg(err.response?.data?.error || 'Failed to save exam record.');
    } finally {
      setRecordingExam(false);
    }
  };

  const handlePromote = async () => {
    if (!promoteYearId) return;
    setPromoting(true);
    setPromoteError(null);
    setPromoteResult(null);
    try {
      const response = await api.post('/api/promotion/promote-students/', {
        academic_year_id: promoteYearId,
        grade_id: promoteGradeId || undefined,
      });
      const result = await pollJob<PromotionResult>(response.data.job_id);
      setPromoteResult(result);
    } catch (err: any) {
      setPromoteError(err.response?.data?.error || err.message || 'Failed to run bulk promotion.');
    } finally {
      setPromoting(false);
    }
  };

  return (
    <Stack spacing={3}>
      <Card variant="outlined">
        <CardHeader title="Finalize Term Results" subheader="Marks a term's results as done recording — the gate for plain grade promotions." />
        <CardContent>
          <Stack direction="row" spacing={2} alignItems="center">
            <TextField label="Exam Term ID" value={termId} onChange={(e) => setTermId(e.target.value)} size="small" />
            <Button variant="contained" disabled={finalizing || !termId} onClick={() => handleFinalize(true)}>
              Finalize
            </Button>
            <Button variant="outlined" disabled={finalizing || !termId} onClick={() => handleFinalize(false)}>
              Un-finalize
            </Button>
            {finalizing && <CircularProgress size={20} />}
          </Stack>
          {finalizeMsg && <Alert sx={{ mt: 2 }} severity="info">{finalizeMsg}</Alert>}
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardHeader title="Record a National Exam" subheader="KPSEA (Grade 6), KJSEA (Grade 9), or KCSE (Form 4 / Grade 12)." />
        <CardContent>
          <Stack spacing={2}>
            <Stack direction="row" spacing={2}>
              <TextField label="Student ID" value={examStudentId} onChange={(e) => setExamStudentId(e.target.value)} size="small" />
              <TextField label="Academic Year ID" value={academicYearId} onChange={(e) => setAcademicYearId(e.target.value)} size="small" />
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
              <Button variant="contained" disabled={recordingExam || !examStudentId || !academicYearId} onClick={handleRecordExam}>
                Save Exam Record
              </Button>
            </Box>
          </Stack>
          {examMsg && <Alert sx={{ mt: 2 }} severity="info">{examMsg}</Alert>}
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardHeader
          avatar={<GraduationCap size={20} />}
          title="Promote Students"
          subheader="Runs against every eligible student in scope — held students (results not finalized / exam not recorded) are simply skipped."
        />
        <CardContent>
          <Stack direction="row" spacing={2} alignItems="center">
            <TextField label="Academic Year ID" value={promoteYearId} onChange={(e) => setPromoteYearId(e.target.value)} size="small" />
            <TextField label="Grade ID (optional — whole school if blank)" value={promoteGradeId} onChange={(e) => setPromoteGradeId(e.target.value)} size="small" />
            <Button variant="contained" color="primary" disabled={promoting || !promoteYearId} onClick={handlePromote}>
              {promoting ? <CircularProgress size={20} /> : 'Run Promotion'}
            </Button>
          </Stack>
          {promoteError && <Alert sx={{ mt: 2 }} severity="error">{promoteError}</Alert>}
          {promoteResult && (
            <Alert sx={{ mt: 2 }} severity="success" icon={<CheckCircle2 size={20} />}>
              <Typography variant="body2">{promoteResult.message}</Typography>
            </Alert>
          )}
        </CardContent>
      </Card>
    </Stack>
  );
}
```

- [ ] **Step 3: Wire it into `ResultsHub.tsx` as a 4th, admin-only tab**

In `frontend/src/components/results/ResultsHub.tsx`, add the import (`import PromotionPanel from './PromotionPanel';`), change the tab union type to include `'promotion'`, and append to the `tabs` array (only when `role === 'admin'`):

```tsx
  const tabs = [
    { id: 'performance' as const, label: 'Class Performance', icon: BarChart3 },
    { id: 'reports' as const, label: 'Student Report Cards', icon: FileText },
    { id: 'analytics' as const, label: 'School Analytics', icon: TrendingUp },
    ...(role === 'admin' ? [{ id: 'promotion' as const, label: 'Promotion', icon: Award }] : []),
  ];
```

And in the "Dynamic Content Area" block, alongside the existing `activeTab === 'performance'` etc. branches:

```tsx
        {activeTab === 'promotion' && role === 'admin' && (
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
            <PromotionPanel />
          </div>
        )}
```

- [ ] **Step 4: Manual QA (no frontend test suite exists in this repo)**

Run: `cd frontend && pnpm dev` (or the repo's existing dev-server command), log in as an admin, navigate to Results → Promotion, and confirm: finalize/un-finalize a term returns a success message; recording a KJSEA exam with a destination succeeds; running promotion for a scope with no finalized results returns a "held" summary, and re-running after finalizing shows students moving grade.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/results/PromotionPanel.tsx frontend/src/components/results/ResultsHub.tsx
git commit -m "feat: add Promotion admin panel (finalize term, record exam, bulk promote)"
```

---

## Task 10: Frontend — Graduated card on student dashboard

**Files:**
- Modify: `frontend/src/pages/student/StudentDashboard.tsx` (interface ~line 10-17, JSX ~line 97-113)

**Interfaces:**
- Consumes: `enrollment_state`, `graduation_destination` from `GET /api/student/dashboard-overview/` (Task 8).

- [ ] **Step 1: Extend the `StudentProfile` interface**

```tsx
interface StudentProfile {
  name: string;
  roll: string;
  class_name: string;
  mobile: string | null;
  fee: number | null;
  profile_pic: string | null;
  enrollment_state: string;
  graduation_destination: string | null;
}
```

- [ ] **Step 2: Branch the header card on `enrollment_state`**

Around the existing class-name/roll display (~line 106), wrap with a conditional:

```tsx
{data.profile.enrollment_state === 'Graduated' ? (
  <p className="text-indigo-100 font-medium text-sm md:text-base">
    Graduated
    {data.profile.graduation_destination
      ? ` — placed at ${data.profile.graduation_destination}`
      : ' — destination not yet recorded'}
  </p>
) : (
  <p className="text-indigo-100 font-medium text-sm md:text-base">
    {data.profile.class_name} &middot; Roll No. {data.profile.roll}
  </p>
)}
```

- [ ] **Step 3: Manual QA**

Log in as a student whose `StudentExtra.enrollment_state` is `'Graduated'` (set via Django admin or shell for testing) and confirm the dashboard header shows the graduated message with destination instead of the class/roll line.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/student/StudentDashboard.tsx
git commit -m "feat: show graduated state and destination on student dashboard"
```

---

## Final Verification

- [ ] Run the complete backend suite: `venv/bin/python manage.py test school.tests --keepdb`
- [ ] Run `venv/bin/python manage.py check`
- [ ] Run `lint-imports` (verifies the `.importlinter` contracts — especially that `apps/students/models.py`'s new `NationalExamRecord` didn't accidentally import `apps.academics.models`)
- [ ] Confirm no migrations were run — `git status` should show only `.py` model/view/test/frontend changes, no new files under `apps/*/migrations/`
- [ ] Tell the user: run `makemigrations academics students identity core && migrate` when ready, then manually configure `Tier.exit_exam_code`/`exit_is_terminal` for each seeded tier (Upper Primary → KPSEA, Junior Secondary → KJSEA + terminal, Senior Secondary → KCSE + terminal, Form 3&4 → KCSE + terminal) via Django admin, since these fields default blank/False and the promotion logic treats an unconfigured tier as a plain transition.
