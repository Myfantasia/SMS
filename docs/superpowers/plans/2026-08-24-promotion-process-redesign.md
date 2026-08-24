# Promotion Process Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make grade promotion (CBC and 8-4-4) actually enforce and clearly display its requirements — expose `Tier.exit_exam_code`/`exit_is_terminal` end-to-end, add a shared readiness-check mechanism used both to preview and to enforce promotion, and rebuild the admin UI around real pickers and visible results instead of raw-ID text fields.

**Architecture:** One new non-mutating function, `_readiness_for_student`, becomes the single source of truth for "is this student eligible to promote right now, and why/why not" — `_promote_student` is refactored to call it before mutating, and two new endpoints (a read-only bulk/single readiness check, and a synchronous single-student promote) call it directly. The frontend gains real dropdowns/pickers everywhere a raw ID used to be typed, plus a results table that finally renders data the backend already returns.

**Tech Stack:** Django 6 / DRF (backend), React 19 / TypeScript / MUI (frontend — `PromotionPanel.tsx` is already 100% MUI, not Tailwind; stay in that stack, don't introduce Tailwind classes into this file).

**Spec:** `docs/superpowers/specs/2026-08-24-promotion-process-redesign-design.md`

## Global Constraints

- Migrations are written but **never run** by the implementer — this plan requires none (no schema changes: `exit_exam_code`/`exit_is_terminal` already exist on `Tier`, only serializer/endpoint/UI/seed-command work).
- TDD applies to all backend work: write the failing test first, watch it fail for the right reason, then implement.
- No frontend test suite exists in this repo (established project convention) — frontend tasks are manual-QA-only, verified via `npx tsc -b --noEmit` staying clean plus a manual click-through described in each task.
- `seed_tier_exit_exams.py` (Task 5) is a data-seeding management command, not a schema migration — per this session's established precedent (`seed_pathway_descriptions.py`), the implementer may write and even dry-run it, but the **real** (non-`--dry-run`) invocation is left for the user to run themselves.
- Every new/modified backend file must keep `python manage.py check` and the relevant scoped test run green before moving to the next task.

---

## File Structure

- `school/serializers/curriculum_serializers.py` — `TierSerializer` gains 2 fields (Task 1).
- `school/views/promotion_views.py` — new `_readiness_for_student`, refactored `_promote_student`, two new `APIView` classes (Tasks 2-4).
- `schoolmanagement/Urls/urls.py` — 2 new routes (Tasks 3-4).
- `school/management/commands/seed_tier_exit_exams.py` — new (Task 5).
- `school/tests/test_promotion_readiness.py` — new, covers Tasks 1-4.
- `frontend/src/pages/admin/CurriculumHub.tsx` — `Tier` interface + tier edit form (Task 6).
- `frontend/src/components/results/PromotionPanel.tsx` — full rebuild, split into two tasks: tier summary + bulk promotion (Task 7), single-student + bulk exam recording (Task 8).

---

### Task 1: Expose `Tier.exit_exam_code`/`exit_is_terminal` via `TierSerializer`

**Files:**
- Modify: `school/serializers/curriculum_serializers.py:17-25` (`TierSerializer`)
- Test: `school/tests/test_promotion_readiness.py` (new file — created in this task)

**Interfaces:**
- Produces: `TierSerializer` now serializes/accepts `exit_exam_code: str` (one of `''`, `'KPSEA'`, `'KJSEA'`, `'KCSE'`) and `exit_is_terminal: bool`, consumed by the existing `TierViewSet` (`school/views/curriculum_view.py:222`) with no further changes needed there, and by Task 6's frontend.

- [ ] **Step 1: Write the failing test**

Create `school/tests/test_promotion_readiness.py`:

```python
from django.test import TestCase

from apps.academics.models import Curriculum, Tier
from school.serializers.curriculum_serializers import TierSerializer


class TierSerializerExitFieldsTests(TestCase):
    def test_serializer_exposes_exit_exam_fields(self):
        curriculum = Curriculum.objects.create(code='TSER1', name='Serializer Test Curriculum')
        tier = Tier.objects.create(
            curriculum=curriculum, name='Senior Secondary', code='SSTS1',
            exit_exam_code='KCSE', exit_is_terminal=True,
        )
        data = TierSerializer(tier).data
        self.assertEqual(data['exit_exam_code'], 'KCSE')
        self.assertTrue(data['exit_is_terminal'])

    def test_serializer_accepts_exit_fields_on_write(self):
        curriculum = Curriculum.objects.create(code='TSER2', name='Serializer Test Curriculum 2')
        serializer = TierSerializer(data={
            'curriculum': curriculum.id, 'name': 'Upper Primary', 'code': 'UPTS2',
            'exit_exam_code': 'KPSEA', 'exit_is_terminal': False,
        })
        self.assertTrue(serializer.is_valid(), serializer.errors)
        tier = serializer.save()
        self.assertEqual(tier.exit_exam_code, 'KPSEA')
        self.assertFalse(tier.exit_is_terminal)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./venv/bin/python manage.py test school.tests.test_promotion_readiness.TierSerializerExitFieldsTests --noinput -v 2`
Expected: FAIL — `KeyError: 'exit_exam_code'` on the first test (the field isn't in `TierSerializer.Meta.fields` yet).

- [ ] **Step 3: Write minimal implementation**

In `school/serializers/curriculum_serializers.py`, change:

```python
class TierSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tier
        fields = ['id', 'curriculum', 'name', 'code', 'display_order']
```

to:

```python
class TierSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tier
        fields = ['id', 'curriculum', 'name', 'code', 'display_order', 'exit_exam_code', 'exit_is_terminal']
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./venv/bin/python manage.py test school.tests.test_promotion_readiness.TierSerializerExitFieldsTests --noinput -v 2`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add school/serializers/curriculum_serializers.py school/tests/test_promotion_readiness.py
git commit -m "feat: expose Tier exit-exam fields via TierSerializer"
```

---

### Task 2: Extract `_readiness_for_student`, refactor `_promote_student`

**Files:**
- Modify: `school/views/promotion_views.py:93-127` (`_promote_student`)
- Test: `school/tests/test_promotion_readiness.py` (append)

**Interfaces:**
- Consumes: `_determine_transition(grade)` (existing, `promotion_views.py:25`), `results_finalized_for_year(academic_year)` (existing, `promotion_views.py:51`), `NationalExamRecord` (existing model).
- Produces: `_readiness_for_student(student, academic_year) -> dict` with keys `student_id: int`, `ready: bool`, `transition_type: str | None` (one of `'plain'`, `'exam_gated'`, `'exit'`, or `None` when there's no current class), `requirement: str`, `reason: str | None` (only set when `ready` is `False`), `next_grade_name: str | None`. Consumed by Task 3's readiness endpoint and Task 4's single-student endpoint.
- `_promote_student(student, academic_year) -> dict` keeps its exact existing return shape (`student_id`, `outcome`, `detail`) — this is a refactor, not a behavior change, for every already-covered scenario in `school/tests/test_promotion.py`.

- [ ] **Step 1: Write the failing tests**

Append to `school/tests/test_promotion_readiness.py`:

```python
from django.contrib.auth.models import User

from apps.academics.models import AcademicYear, ClassStream, ExamTerm, GradeLevel
from apps.identity.models import StudentExtra
from apps.students.models import NationalExamRecord
from school.views.promotion_views import _readiness_for_student


class ReadinessForStudentTests(TestCase):
    def setUp(self):
        self.curriculum = Curriculum.objects.create(code='RFS1', name='Readiness Test Curriculum')
        self.year = AcademicYear.objects.create(year='2094')

    def _make_student(self, grade, username):
        stream = ClassStream.objects.create(name='Central', grade=grade)
        user = User.objects.create_user(username=username, password='x')
        return StudentExtra.objects.create(user=user, roll=username[:5].upper(), cl=stream, status=True)

    def test_no_current_class_is_not_ready(self):
        user = User.objects.create_user(username='no_class_student', password='x')
        student = StudentExtra.objects.create(user=user, roll='NC001', status=True)

        result = _readiness_for_student(student, self.year)

        self.assertFalse(result['ready'])
        self.assertIsNone(result['transition_type'])
        self.assertEqual(result['reason'], 'No current class assigned.')

    def test_plain_blocked_when_results_not_finalized(self):
        tier = Tier.objects.create(curriculum=self.curriculum, name='Lower Primary', code='LPRFS1')
        g1 = GradeLevel.objects.create(name='Grade 1RFS', numeric_order=1, curriculum=self.curriculum, tier=tier)
        GradeLevel.objects.create(name='Grade 2RFS', numeric_order=2, curriculum=self.curriculum, tier=tier)
        student = self._make_student(g1, 'plain_blocked_student')
        ExamTerm.objects.create(
            name='Term 1', academic_year=self.year, start_date='2094-01-01', end_date='2094-04-01',
            results_finalized=False,
        )

        result = _readiness_for_student(student, self.year)

        self.assertFalse(result['ready'])
        self.assertEqual(result['transition_type'], 'plain')
        self.assertEqual(result['requirement'], 'Results finalized for the academic year')
        self.assertEqual(result['reason'], 'Results not yet finalized for this academic year.')

    def test_plain_ready_when_results_finalized(self):
        tier = Tier.objects.create(curriculum=self.curriculum, name='Lower Primary', code='LPRFS2')
        g1 = GradeLevel.objects.create(name='Grade 1RFS2', numeric_order=1, curriculum=self.curriculum, tier=tier)
        g2 = GradeLevel.objects.create(name='Grade 2RFS2', numeric_order=2, curriculum=self.curriculum, tier=tier)
        student = self._make_student(g1, 'plain_ready_student')
        ExamTerm.objects.create(
            name='Term 1', academic_year=self.year, start_date='2094-01-01', end_date='2094-04-01',
            results_finalized=True,
        )

        result = _readiness_for_student(student, self.year)

        self.assertTrue(result['ready'])
        self.assertEqual(result['transition_type'], 'plain')
        self.assertIsNone(result['reason'])
        self.assertEqual(result['next_grade_name'], 'Grade 2RFS2')

    def test_exam_gated_blocked_without_record(self):
        tier = Tier.objects.create(
            curriculum=self.curriculum, name='Upper Primary', code='UPRFS1',
            exit_exam_code='KPSEA', exit_is_terminal=False,
        )
        jss_tier = Tier.objects.create(curriculum=self.curriculum, name='Junior Secondary', code='JSSRFS1')
        g6 = GradeLevel.objects.create(name='Grade 6RFS', numeric_order=6, curriculum=self.curriculum, tier=tier)
        GradeLevel.objects.create(name='Grade 7RFS', numeric_order=7, curriculum=self.curriculum, tier=jss_tier)
        student = self._make_student(g6, 'kpsea_blocked_student')

        result = _readiness_for_student(student, self.year)

        self.assertFalse(result['ready'])
        self.assertEqual(result['transition_type'], 'exam_gated')
        self.assertEqual(result['requirement'], 'KPSEA recorded')
        self.assertEqual(result['reason'], 'KPSEA not yet recorded.')

    def test_exam_gated_ready_with_record(self):
        tier = Tier.objects.create(
            curriculum=self.curriculum, name='Upper Primary', code='UPRFS2',
            exit_exam_code='KPSEA', exit_is_terminal=False,
        )
        jss_tier = Tier.objects.create(curriculum=self.curriculum, name='Junior Secondary', code='JSSRFS2')
        g6 = GradeLevel.objects.create(name='Grade 6RFS2', numeric_order=6, curriculum=self.curriculum, tier=tier)
        GradeLevel.objects.create(name='Grade 7RFS2', numeric_order=7, curriculum=self.curriculum, tier=jss_tier)
        student = self._make_student(g6, 'kpsea_ready_student')
        NationalExamRecord.objects.create(student=student, exam_code='KPSEA', academic_year=self.year)

        result = _readiness_for_student(student, self.year)

        self.assertTrue(result['ready'])
        self.assertEqual(result['transition_type'], 'exam_gated')
        self.assertIsNone(result['reason'])

    def test_exit_blocked_without_record(self):
        tier = Tier.objects.create(
            curriculum=self.curriculum, name='Senior Secondary', code='SSRFS1',
            exit_exam_code='KCSE', exit_is_terminal=True,
        )
        g12 = GradeLevel.objects.create(name='Grade 12RFS', numeric_order=12, curriculum=self.curriculum, tier=tier)
        student = self._make_student(g12, 'kcse_blocked_student')

        result = _readiness_for_student(student, self.year)

        self.assertFalse(result['ready'])
        self.assertEqual(result['transition_type'], 'exit')
        self.assertEqual(result['requirement'], 'KCSE recorded')
        self.assertEqual(result['reason'], 'KCSE not yet recorded.')

    def test_exit_ready_with_record(self):
        tier = Tier.objects.create(
            curriculum=self.curriculum, name='Senior Secondary', code='SSRFS2',
            exit_exam_code='KCSE', exit_is_terminal=True,
        )
        g12 = GradeLevel.objects.create(name='Grade 12RFS2', numeric_order=12, curriculum=self.curriculum, tier=tier)
        student = self._make_student(g12, 'kcse_ready_student')
        NationalExamRecord.objects.create(student=student, exam_code='KCSE', academic_year=self.year)

        result = _readiness_for_student(student, self.year)

        self.assertTrue(result['ready'])
        self.assertEqual(result['transition_type'], 'exit')
        self.assertIsNone(result['reason'])
        self.assertIsNone(result['next_grade_name'])
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./venv/bin/python manage.py test school.tests.test_promotion_readiness.ReadinessForStudentTests --noinput -v 2`
Expected: FAIL — `ImportError: cannot import name '_readiness_for_student'` (function doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

In `school/views/promotion_views.py`, replace the existing `_promote_student` function (lines 93-127) with:

```python
def _readiness_for_student(student, academic_year):
    """
    Non-mutating: computes whether `student` is eligible to promote for `academic_year` right
    now, and why/why not. The single source of truth _promote_student, the readiness-check
    endpoint, and the single-student promote endpoint all share — so what's displayed as a
    requirement can never drift from what's actually enforced.
    """
    grade = student.cl.grade if student.cl_id else None
    if grade is None:
        return {
            'student_id': student.id, 'ready': False, 'transition_type': None,
            'requirement': None, 'reason': 'No current class assigned.', 'next_grade_name': None,
        }

    transition_type, exam_code, next_grade = _determine_transition(grade)

    if transition_type == 'plain':
        requirement = 'Results finalized for the academic year'
        if not results_finalized_for_year(academic_year):
            return {
                'student_id': student.id, 'ready': False, 'transition_type': 'plain',
                'requirement': requirement, 'reason': 'Results not yet finalized for this academic year.',
                'next_grade_name': None,
            }
        if next_grade is None:
            return {
                'student_id': student.id, 'ready': False, 'transition_type': 'plain',
                'requirement': requirement, 'reason': 'No next grade configured after this one.',
                'next_grade_name': None,
            }
        return {
            'student_id': student.id, 'ready': True, 'transition_type': 'plain',
            'requirement': requirement, 'reason': None, 'next_grade_name': next_grade.name,
        }

    requirement = f'{exam_code} recorded'
    record = NationalExamRecord.objects.filter(student=student, exam_code=exam_code, academic_year=academic_year).first()
    if record is None:
        return {
            'student_id': student.id, 'ready': False, 'transition_type': transition_type,
            'requirement': requirement, 'reason': f'{exam_code} not yet recorded.', 'next_grade_name': None,
        }

    if transition_type == 'exam_gated':
        if next_grade is None:
            return {
                'student_id': student.id, 'ready': False, 'transition_type': 'exam_gated',
                'requirement': requirement, 'reason': 'No next grade configured after this one.',
                'next_grade_name': None,
            }
        return {
            'student_id': student.id, 'ready': True, 'transition_type': 'exam_gated',
            'requirement': requirement, 'reason': None, 'next_grade_name': next_grade.name,
        }

    # transition_type == 'exit'
    return {
        'student_id': student.id, 'ready': True, 'transition_type': 'exit',
        'requirement': requirement, 'reason': None, 'next_grade_name': None,
    }


def _promote_student(student, academic_year):
    """
    Attempts to promote one student for `academic_year`.
    Returns {'student_id', 'outcome': 'promoted'|'graduated'|'held', 'detail': str}.
    Never raises for a normal "not ready yet" case — those are 'held', not errors.
    """
    readiness = _readiness_for_student(student, academic_year)
    if not readiness['ready']:
        return {'student_id': student.id, 'outcome': 'held', 'detail': readiness['reason']}

    grade = student.cl.grade
    transition_type, exam_code, next_grade = _determine_transition(grade)

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

- [ ] **Step 4: Run tests to verify they pass**

Run: `./venv/bin/python manage.py test school.tests.test_promotion_readiness --noinput -v 2`
Expected: PASS (all tests from Task 1 + Task 2).

- [ ] **Step 5: Run the existing promotion test suite as a regression gate**

Run: `./venv/bin/python manage.py test school.tests.test_promotion --noinput -v 2`
Expected: PASS — every test that existed before this refactor (in particular `PromoteStudentTests`, `EnsureCoreMathematicsTests`, `PromoteStudentSSSPathwayCarryForwardTests`) must still pass unchanged, since `_promote_student`'s observable behavior for ready students is identical to before.

- [ ] **Step 6: Commit**

```bash
git add school/views/promotion_views.py school/tests/test_promotion_readiness.py
git commit -m "refactor: extract _readiness_for_student as shared eligibility check"
```

---

### Task 3: `GET /api/promotion/readiness/` endpoint

**Files:**
- Modify: `school/views/promotion_views.py` (add `PromotionReadinessAPIView`)
- Modify: `schoolmanagement/Urls/urls.py:295-297` (add route)
- Test: `school/tests/test_promotion_readiness.py` (append)

**Interfaces:**
- Consumes: `_readiness_for_student` (Task 2), `StudentExtra` (`apps.identity.models`), `AcademicYear` (`apps.academics.models`).
- Produces: `GET /api/promotion/readiness/?academic_year_id=<id>[&grade_id=<id>|&stream_id=<id>|&student_id=<id>]` returning `{"summary": {"ready": int, "blocked": int, "by_reason": {str: int}}, "students": [{"student_id": int, "name": str, "grade_name": str, "transition_type": str|null, "requirement": str|null, "ready": bool, "reason": str|null}]}`. Consumed by Task 7 (bulk) and Task 8 (single-student) frontend work.

- [ ] **Step 1: Write the failing tests**

Append to `school/tests/test_promotion_readiness.py`:

```python
import json

from django.test import RequestFactory
from django.core.cache import cache

from apps.identity.models import Permission, Role, UserRole
from school.views.promotion_views import PromotionReadinessAPIView
from school.tests.base import ExamTestDataMixin


class PromotionReadinessAPIViewTests(ExamTestDataMixin, TestCase):
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        Permission.objects.get_or_create(code='results.view', defaults={'label': 'results.view', 'module': 'results'})
        role = Role.objects.create(name='Readiness Viewer')
        role.permissions.set(Permission.objects.filter(code='results.view'))
        UserRole.objects.create(user=cls.admin_user, role=role)

        cls.curriculum = Curriculum.objects.create(code='PRAV1', name='Readiness Endpoint Curriculum')
        cls.tier = Tier.objects.create(curriculum=cls.curriculum, name='Lower Primary', code='LPPRAV1')
        cls.g1 = GradeLevel.objects.create(name='Grade 1PRAV', numeric_order=1, curriculum=cls.curriculum, tier=cls.tier)
        GradeLevel.objects.create(name='Grade 2PRAV', numeric_order=2, curriculum=cls.curriculum, tier=cls.tier)
        cls.stream = ClassStream.objects.create(name='Central', grade=cls.g1)

        cls.ready_year = AcademicYear.objects.create(year='2095')
        ExamTerm.objects.create(
            name='Term 1', academic_year=cls.ready_year, start_date='2095-01-01', end_date='2095-04-01',
            results_finalized=True,
        )
        ready_user = User.objects.create_user(username='readiness_ready_student', password='x')
        cls.ready_student = StudentExtra.objects.create(user=ready_user, roll='RR01', cl=cls.stream, status=True)

        blocked_user = User.objects.create_user(username='readiness_blocked_student', password='x')
        cls.blocked_student = StudentExtra.objects.create(user=blocked_user, roll='RB01', cl=cls.stream, status=True)

    def setUp(self):
        cache.clear()
        self.factory = RequestFactory()

    def _get(self, query):
        request = self.factory.get(f'/api/promotion/readiness/?{query}')
        request.user = self.admin_user
        return PromotionReadinessAPIView.as_view()(request)

    def test_returns_ready_and_blocked_summary_for_grade_scope(self):
        response = self._get(f'academic_year_id={self.ready_year.id}&grade_id={self.g1.id}')
        self.assertEqual(response.status_code, 200)
        data = response.data

        self.assertEqual(data['summary']['ready'], 2)
        self.assertEqual(data['summary']['blocked'], 0)

        student_ids = {row['student_id'] for row in data['students']}
        self.assertEqual(student_ids, {self.ready_student.id, self.blocked_student.id})
        self.assertTrue(all(row['ready'] for row in data['students']))

    def test_blocked_student_shows_reason_when_results_not_finalized(self):
        other_year = AcademicYear.objects.create(year='2096')
        response = self._get(f'academic_year_id={other_year.id}&grade_id={self.g1.id}')
        data = response.data

        self.assertEqual(data['summary']['blocked'], 2)
        self.assertIn('Results not yet finalized for this academic year.', data['summary']['by_reason'])

    def test_single_student_scope(self):
        response = self._get(f'academic_year_id={self.ready_year.id}&student_id={self.ready_student.id}')
        data = response.data

        self.assertEqual(len(data['students']), 1)
        self.assertEqual(data['students'][0]['student_id'], self.ready_student.id)

    def test_missing_academic_year_id_is_rejected(self):
        request = self.factory.get('/api/promotion/readiness/')
        request.user = self.admin_user
        response = PromotionReadinessAPIView.as_view()(request)
        self.assertEqual(response.status_code, 400)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./venv/bin/python manage.py test school.tests.test_promotion_readiness.PromotionReadinessAPIViewTests --noinput -v 2`
Expected: FAIL — `ImportError: cannot import name 'PromotionReadinessAPIView'`.

- [ ] **Step 3: Write minimal implementation**

In `school/views/promotion_views.py`, append this class at the end of the file (after `PromoteStudentsAPIView`) — no new imports needed, `Response` and `StudentExtra` are already imported at the top of the file:

```python
class PromotionReadinessAPIView(APIView):
    """Read-only preview of promotion eligibility for a scope — never mutates anything. The
    same _readiness_for_student call that _promote_student uses to actually promote, so this
    can never show a different picture than what running promotion will do."""
    permission_classes = [IsAuthenticated, HasModulePermission]
    authentication_classes = [SessionAuthentication]
    rbac_view_permission = 'results.view'

    def get(self, request):
        academic_year_id = request.query_params.get('academic_year_id')
        if not academic_year_id:
            return Response({"error": "academic_year_id is required."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            academic_year = AcademicYear.objects.get(id=academic_year_id)
        except AcademicYear.DoesNotExist:
            return Response({"error": "Academic year not found."}, status=status.HTTP_404_NOT_FOUND)

        students_qs = StudentExtra.objects.filter(status=True).select_related('user', 'cl__grade')
        student_id = request.query_params.get('student_id')
        stream_id = request.query_params.get('stream_id')
        grade_id = request.query_params.get('grade_id')
        if student_id:
            students_qs = students_qs.filter(id=student_id)
        elif stream_id:
            students_qs = students_qs.filter(cl_id=stream_id)
        elif grade_id:
            students_qs = students_qs.filter(cl__grade_id=grade_id)

        rows = []
        by_reason = {}
        ready_count = 0
        for student in students_qs:
            readiness = _readiness_for_student(student, academic_year)
            rows.append({
                'student_id': student.id,
                'name': student.get_name,
                'grade_name': student.cl.grade.name if student.cl_id else None,
                'transition_type': readiness['transition_type'],
                'requirement': readiness['requirement'],
                'ready': readiness['ready'],
                'reason': readiness['reason'],
            })
            if readiness['ready']:
                ready_count += 1
            else:
                by_reason[readiness['reason']] = by_reason.get(readiness['reason'], 0) + 1

        return Response({
            'summary': {'ready': ready_count, 'blocked': len(rows) - ready_count, 'by_reason': by_reason},
            'students': rows,
        })
```

In `schoolmanagement/Urls/urls.py`, add a route after line 297 (`promote-students/`):

```python
    path('api/promotion/readiness/', promotion_views.PromotionReadinessAPIView.as_view(), name='promotion_readiness'),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `./venv/bin/python manage.py test school.tests.test_promotion_readiness --noinput -v 2`
Expected: PASS (all tests from Tasks 1-3).

- [ ] **Step 5: Commit**

```bash
git add school/views/promotion_views.py schoolmanagement/Urls/urls.py school/tests/test_promotion_readiness.py
git commit -m "feat: add GET /api/promotion/readiness/ preview endpoint"
```

---

### Task 4: `POST /api/promotion/promote-student/<id>/` endpoint

**Files:**
- Modify: `school/views/promotion_views.py` (add `PromoteSingleStudentAPIView`)
- Modify: `schoolmanagement/Urls/urls.py` (add route)
- Test: `school/tests/test_promotion_readiness.py` (append)

**Interfaces:**
- Consumes: `_promote_student` (Task 2, unchanged signature).
- Produces: `POST /api/promotion/promote-student/<student_id>/` with body `{"academic_year_id": <id>}`, returning the same `{student_id, outcome, detail}` shape `_promote_student` already produces, at `200` on success (including a `'held'` outcome — that's a normal response, not an error) or `403`/`404`/`400` for auth/not-found/validation failures. Consumed by Task 8's frontend single-student panel.

- [ ] **Step 1: Write the failing tests**

Append to `school/tests/test_promotion_readiness.py`:

```python
from school.views.promotion_views import PromoteSingleStudentAPIView


class PromoteSingleStudentAPIViewTests(ExamTestDataMixin, TestCase):
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        Permission.objects.get_or_create(code='results.edit', defaults={'label': 'results.edit', 'module': 'results'})
        role = Role.objects.create(name='Single Promote Manager')
        role.permissions.set(Permission.objects.filter(code='results.edit'))
        UserRole.objects.create(user=cls.admin_user, role=role)
        UserRole.objects.create(user=cls.teacher_user, role=role)

        cls.curriculum = Curriculum.objects.create(code='PSSAV1', name='Single Promote Curriculum')
        cls.tier = Tier.objects.create(curriculum=cls.curriculum, name='Lower Primary', code='LPPSSAV1')
        cls.g1 = GradeLevel.objects.create(name='Grade 1PSSAV', numeric_order=1, curriculum=cls.curriculum, tier=cls.tier)
        GradeLevel.objects.create(name='Grade 2PSSAV', numeric_order=2, curriculum=cls.curriculum, tier=cls.tier)
        cls.stream = ClassStream.objects.create(name='Central', grade=cls.g1)

        cls.year = AcademicYear.objects.create(year='2097')
        ExamTerm.objects.create(
            name='Term 1', academic_year=cls.year, start_date='2097-01-01', end_date='2097-04-01',
            results_finalized=True,
        )
        student_user = User.objects.create_user(username='single_promote_student', password='x')
        cls.student = StudentExtra.objects.create(user=student_user, roll='SP01', cl=cls.stream, status=True)

    def setUp(self):
        cache.clear()
        self.factory = RequestFactory()

    def _post(self, user, student_id, payload):
        request = self.factory.post(
            f'/api/promotion/promote-student/{student_id}/',
            data=json.dumps(payload), content_type='application/json',
        )
        request.user = user
        request._dont_enforce_csrf_checks = True
        return PromoteSingleStudentAPIView.as_view()(request, student_id=student_id)

    def test_admin_can_promote_a_ready_student(self):
        response = self._post(self.admin_user, self.student.id, {'academic_year_id': self.year.id})
        self.assertEqual(response.status_code, 200)
        data = response.data
        self.assertEqual(data['outcome'], 'promoted')
        self.student.refresh_from_db()
        self.assertEqual(self.student.cl.grade.name, 'Grade 2PSSAV')

    def test_non_admin_cannot_promote(self):
        response = self._post(self.teacher_user, self.student.id, {'academic_year_id': self.year.id})
        self.assertEqual(response.status_code, 403)

    def test_missing_academic_year_id_is_rejected(self):
        response = self._post(self.admin_user, self.student.id, {})
        self.assertEqual(response.status_code, 400)

    def test_unknown_student_returns_404(self):
        response = self._post(self.admin_user, 999999, {'academic_year_id': self.year.id})
        self.assertEqual(response.status_code, 404)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./venv/bin/python manage.py test school.tests.test_promotion_readiness.PromoteSingleStudentAPIViewTests --noinput -v 2`
Expected: FAIL — `ImportError: cannot import name 'PromoteSingleStudentAPIView'`.

- [ ] **Step 3: Write minimal implementation**

Append to `school/views/promotion_views.py`:

```python
class PromoteSingleStudentAPIView(APIView):
    """Synchronous single-student promote — fast enough to answer inline, unlike the bulk
    path which can span a whole school and goes through the background job queue."""
    permission_classes = [IsAuthenticated, HasModulePermission]
    authentication_classes = [SessionAuthentication]
    rbac_edit_permission = 'results.edit'

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
            outcome = _promote_student(student, academic_year)
            if outcome['outcome'] != 'held':
                write_audit_log(
                    operator_id=user.id, action_type='PROMOTE', module='SinglePromoteStudent',
                    description=f"{outcome['outcome'].capitalize()} {student.get_name} for {academic_year.year}: {outcome['detail']}",
                )
        return Response(outcome, status=status.HTTP_200_OK)
```

Add the `transaction` import at the top of `school/views/promotion_views.py` (alongside the existing imports):

```python
from django.db import transaction
```

In `schoolmanagement/Urls/urls.py`, add a route alongside the one from Task 3:

```python
    path('api/promotion/promote-student/<int:student_id>/', promotion_views.PromoteSingleStudentAPIView.as_view(), name='promote_single_student'),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `./venv/bin/python manage.py test school.tests.test_promotion_readiness --noinput -v 2`
Expected: PASS (all tests from Tasks 1-4).

- [ ] **Step 5: Run the full promotion-related suite as a final backend regression gate**

Run: `./venv/bin/python manage.py test school.tests.test_promotion school.tests.test_promotion_readiness --noinput -v 2`
Expected: PASS, no failures anywhere.

- [ ] **Step 6: Commit**

```bash
git add school/views/promotion_views.py schoolmanagement/Urls/urls.py school/tests/test_promotion_readiness.py
git commit -m "feat: add POST /api/promotion/promote-student/<id>/ single-student endpoint"
```

---

### Task 5: `seed_tier_exit_exams.py` management command

**Files:**
- Create: `school/management/commands/seed_tier_exit_exams.py`

**Interfaces:**
- Consumes: `Tier`, `Curriculum` (`apps.academics.models`).
- Produces: nothing consumed by other tasks — this is a standalone data-backfill script, run manually by the user per the Global Constraints.

- [ ] **Step 1: Write the command**

Create `school/management/commands/seed_tier_exit_exams.py`:

```python
from django.core.management.base import BaseCommand

from apps.academics.models import Tier

# (curriculum_code, name_substring_to_match): (exit_exam_code, exit_is_terminal)
#
# Matched by curriculum code + a case-insensitive name substring, mirroring the same
# name-substring convention tier_requires_pathway_choice already uses (apps/academics/models.py)
# -- robust against exact-spelling drift in admin-entered tier names (the real seeded data has
# a "Junior Srcondary" typo, which "junior" still matches).
#
# Values are dossier-accurate per the CBC national assessment sequence: KPSEA (end of Grade 6,
# same-institution) -> KJSEA (end of Grade 9, cross-institution) -> KCSE (end of Grade 12 /
# Form 4, terminal). Only Upper Primary's KPSEA transition keeps exit_is_terminal=False --
# Upper Primary -> JSS stays inside the same school, so the student's cl still reassigns
# normally; JSS/Senior Secondary/Form 3&4 exits do not (see _promote_student's 'exit' branch).
TIER_EXIT_EXAMS = [
    ('CBC', 'upper primary', 'KPSEA', False),
    ('CBC', 'junior', 'KJSEA', True),
    ('CBC', 'senior secondary', 'KCSE', True),
    ('8-4-4', 'form', 'KCSE', True),
]


class Command(BaseCommand):
    """
    Backfills Tier.exit_exam_code/exit_is_terminal with the dossier-accurate CBC/8-4-4 defaults,
    so exam-gated promotion actually works out of the box instead of every tier silently
    resolving to a 'plain' transition (see docs/superpowers/specs/2026-08-24-promotion-process-
    redesign-design.md).

    Safe to re-run: only touches a tier whose exit_exam_code is still blank, so an admin's own
    configuration (set via the Tiers UI) is never overwritten.

    Usage:
        python manage.py seed_tier_exit_exams
        python manage.py seed_tier_exit_exams --dry-run
    """
    help = "Backfill dossier-accurate exit_exam_code/exit_is_terminal defaults onto existing tiers."

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true', help="Preview without saving changes.")

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        updated = 0
        skipped = []

        for curriculum_code, name_substring, exam_code, is_terminal in TIER_EXIT_EXAMS:
            tiers = Tier.objects.filter(
                curriculum__code=curriculum_code, name__icontains=name_substring,
            )
            if not tiers.exists():
                skipped.append(f"No tier found for curriculum '{curriculum_code}' matching '{name_substring}'.")
                continue
            for tier in tiers:
                if tier.exit_exam_code:
                    skipped.append(f"Tier '{tier.name}' ({curriculum_code}) — already configured, left alone.")
                    continue
                self.stdout.write(f"  {tier.name} ({curriculum_code}): exit_exam_code={exam_code}, exit_is_terminal={is_terminal}")
                if not dry_run:
                    tier.exit_exam_code = exam_code
                    tier.exit_is_terminal = is_terminal
                    tier.save(update_fields=['exit_exam_code', 'exit_is_terminal'])
                updated += 1

        self.stdout.write(self.style.SUCCESS(
            f"\n{'[DRY RUN] Would update' if dry_run else 'Updated'} {updated} tier(s), {len(skipped)} skipped."
        ))
        if skipped:
            self.stdout.write(self.style.WARNING(f"\n{len(skipped)} skipped:"))
            for reason in skipped:
                self.stdout.write(f"  {reason}")
```

- [ ] **Step 2: Dry-run it against the real dev database to verify it targets the right 4 tiers**

Run: `./venv/bin/python manage.py seed_tier_exit_exams --dry-run`
Expected output: 4 lines, one per tier (`Upper Primary`, `Junior Srcondary`, `Senior Secondary`, `Form 3&4`), each showing the correct `exit_exam_code`/`exit_is_terminal` pair, and `[DRY RUN] Would update 4 tier(s), 0 skipped.` If any tier doesn't match, adjust `TIER_EXIT_EXAMS`'s substring for that row and re-run `--dry-run` until all 4 match — do not proceed to a real run yourself; that's for the user.

- [ ] **Step 3: Commit**

```bash
git add school/management/commands/seed_tier_exit_exams.py
git commit -m "feat: add seed_tier_exit_exams management command"
```

---

### Task 6: Frontend — Tier interface + edit form exit-exam fields

**Files:**
- Modify: `frontend/src/pages/admin/CurriculumHub.tsx:37-43` (`Tier` interface)
- Modify: `frontend/src/pages/admin/CurriculumHub.tsx:887-1009` (`TierForm` type, `emptyTierForm`, `TiersTab`'s edit form)

**Interfaces:**
- Consumes: Task 1's `TierSerializer` fields (via the existing `PUT/POST /api/core/curriculum/tiers/` routes — no URL change needed, `TierViewSet` already uses `TierSerializer` directly).
- Produces: `Tier.exit_exam_code: string`, `Tier.exit_is_terminal: boolean` now flow through `CurriculumHub.tsx`'s state, available to Task 7's tier requirements summary.

- [ ] **Step 1: Widen the `Tier` interface**

In `frontend/src/pages/admin/CurriculumHub.tsx`, change:

```typescript
interface Tier {
  id: number;
  curriculum: number;
  name: string;
  code: string;
  display_order: number;
}
```

to:

```typescript
interface Tier {
  id: number;
  curriculum: number;
  name: string;
  code: string;
  display_order: number;
  exit_exam_code: string;
  exit_is_terminal: boolean;
}
```

- [ ] **Step 2: Widen `TierForm` and `emptyTierForm`**

Change:

```typescript
type TierForm = { id?: number; curriculum: number | ''; name: string; code: string; display_order: number };
const emptyTierForm = (): TierForm => ({ curriculum: '', name: '', code: '', display_order: 0 });
```

to:

```typescript
type TierForm = {
  id?: number; curriculum: number | ''; name: string; code: string; display_order: number;
  exit_exam_code: string; exit_is_terminal: boolean;
};
const emptyTierForm = (): TierForm => ({
  curriculum: '', name: '', code: '', display_order: 0, exit_exam_code: '', exit_is_terminal: false,
});
```

- [ ] **Step 3: Include the new fields in the save payload and the edit-open handler**

In `TiersTab`'s `handleSave`, change:

```typescript
    const payload = {
      curriculum: editing.curriculum, name: editing.name.trim(), code: editing.code.trim(), display_order: editing.display_order,
    };
```

to:

```typescript
    const payload = {
      curriculum: editing.curriculum, name: editing.name.trim(), code: editing.code.trim(), display_order: editing.display_order,
      exit_exam_code: editing.exit_exam_code, exit_is_terminal: editing.exit_is_terminal,
    };
```

And in the tier row's Edit button `onClick`, change:

```typescript
                    onClick={(e) => { e.stopPropagation(); setEditing({ id: t.id, curriculum: t.curriculum, name: t.name, code: t.code, display_order: t.display_order }); }}
```

to:

```typescript
                    onClick={(e) => { e.stopPropagation(); setEditing({
                      id: t.id, curriculum: t.curriculum, name: t.name, code: t.code, display_order: t.display_order,
                      exit_exam_code: t.exit_exam_code, exit_is_terminal: t.exit_is_terminal,
                    }); }}
```

- [ ] **Step 4: Add the form fields**

In the tier edit form JSX, immediately after the "Display order" `<label>` block and before the closing `<div className="flex gap-3 justify-end">`, add:

```tsx
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2">
            <label className="text-xs block">
              <span className="block text-slate-500 font-bold mb-1 dark:text-slate-400">Exit requirement (national exam)</span>
              <select
                aria-label="Exit exam code"
                value={editing.exit_exam_code}
                onChange={(e) => setEditing({ ...editing, exit_exam_code: e.target.value })}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-slate-700 dark:focus:border-indigo-400 dark:bg-slate-800 dark:text-slate-100"
              >
                <option value="">None — plain internal promotion</option>
                <option value="KPSEA">KPSEA</option>
                <option value="KJSEA">KJSEA</option>
                <option value="KCSE">KCSE</option>
              </select>
            </label>
            {editing.exit_exam_code && (
              <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={editing.exit_is_terminal}
                  onChange={(e) => setEditing({ ...editing, exit_is_terminal: e.target.checked })}
                />
                Student leaves this school on exit (cross-institution or terminal — e.g. KJSEA/KCSE). Leave unchecked for a same-institution exam like KPSEA.
              </label>
            )}
          </div>
```

- [ ] **Step 5: Type-check**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: no new errors involving `CurriculumHub.tsx`.

- [ ] **Step 6: Manual QA**

Start the frontend dev server if not already running, log in as an admin, go to Curriculum → Tiers, edit "Senior Secondary" (or any tier), confirm the new "Exit requirement" dropdown and checkbox appear, save, reopen the same tier's edit form, and confirm the saved values round-trip correctly.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/admin/CurriculumHub.tsx
git commit -m "feat: add exit-exam configuration to the Tier edit form"
```

---

### Task 7: `PromotionPanel.tsx` rebuild — tier summary + bulk promotion

**Files:**
- Modify: `frontend/src/components/results/PromotionPanel.tsx` (full rewrite of the bulk-promotion half; single-student + exam-recording sections arrive in Task 8)

**Interfaces:**
- Consumes: `GET /api/promotion/readiness/` (Task 3), `POST /api/promotion/promote-students/` (existing, unchanged), `pollJob` (existing, `frontend/src/libs/pollJob.ts`), `GET /api/academic-years/` (existing), `GET /api/academic-hub/` (existing — already used by `CurriculumHub.tsx` for grades), `GET /api/core/curriculum/tiers/` (existing, now includes exit-exam fields per Task 1/6).
- Produces: this task's `PromotionPanel.tsx` renders correctly with Task 8's sections added below it in the same file — Task 8 does not touch anything this task writes above the `{/* TASK 8 SECTIONS GO HERE */}` marker comment.

- [ ] **Step 1: Rewrite the file**

Replace the full contents of `frontend/src/components/results/PromotionPanel.tsx` with:

```tsx
import { useEffect, useState } from 'react';
import {
  Box, Card, CardContent, CardHeader, Button, TextField, MenuItem, Alert,
  CircularProgress, Stack, Typography, Table, TableHead, TableBody, TableRow, TableCell,
  Chip, Divider,
} from '@mui/material';
import { GraduationCap, CheckCircle2 } from 'lucide-react';
import api from '../../libs/axiosInstance';
import { pollJob } from '../../libs/pollJob';

interface AcademicYearOption {
  id: number;
  year: string;
}

interface GradeOption {
  id: number;
  grade_name: string;
  curriculum_id: number;
}

interface TierOption {
  id: number;
  name: string;
  exit_exam_code: string;
  exit_is_terminal: boolean;
}

interface ReadinessRow {
  student_id: number;
  name: string;
  grade_name: string | null;
  transition_type: string | null;
  requirement: string | null;
  ready: boolean;
  reason: string | null;
}

interface ReadinessResponse {
  summary: { ready: number; blocked: number; by_reason: Record<string, number> };
  students: ReadinessRow[];
}

interface PromotionOutcome {
  student_id: number;
  outcome: string;
  detail: string;
}

interface PromotionResult {
  message: string;
  outcomes: PromotionOutcome[];
}

function ReadinessTable({ rows, nameById }: { rows: ReadinessRow[] | PromotionOutcome[]; nameById?: Record<number, string> }) {
  const isReadinessRows = rows.length > 0 && 'ready' in rows[0];
  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>Student</TableCell>
          <TableCell>{isReadinessRows ? 'Requirement' : 'Outcome'}</TableCell>
          <TableCell>{isReadinessRows ? 'Status' : 'Detail'}</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {isReadinessRows
          ? (rows as ReadinessRow[]).map((row) => (
              <TableRow key={row.student_id}>
                <TableCell>{row.name} <Typography component="span" variant="caption" color="text.secondary">({row.grade_name ?? '—'})</Typography></TableCell>
                <TableCell>{row.requirement ?? '—'}</TableCell>
                <TableCell>
                  {row.ready
                    ? <Chip size="small" color="success" label="Ready" />
                    : <Chip size="small" color="warning" label={row.reason ?? 'Blocked'} />}
                </TableCell>
              </TableRow>
            ))
          : (rows as PromotionOutcome[]).map((row) => (
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
  );
}

export default function PromotionPanel() {
  const [academicYears, setAcademicYears] = useState<AcademicYearOption[]>([]);
  const [grades, setGrades] = useState<GradeOption[]>([]);
  const [tiers, setTiers] = useState<TierOption[]>([]);

  useEffect(() => {
    api.get('/api/academic-years/').then((res) => setAcademicYears(res.data?.data ?? []));
    api.get('/api/academic-hub/').then((res) => setGrades(res.data?.data?.classes ?? []));
    api.get('/api/core/curriculum/tiers/').then((res) => setTiers(res.data ?? []));
  }, []);

  const [termId, setTermId] = useState('');
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeMsg, setFinalizeMsg] = useState<string | null>(null);
  const [finalizeFailed, setFinalizeFailed] = useState(false);

  const handleFinalize = async (finalized: boolean) => {
    if (!termId) return;
    setFinalizing(true);
    setFinalizeMsg(null);
    setFinalizeFailed(false);
    try {
      await api.post(`/api/promotion/finalize-term/${termId}/`, { finalized });
      setFinalizeMsg(finalized ? 'Term finalized.' : 'Term un-finalized.');
    } catch (err: any) {
      setFinalizeMsg(err.response?.data?.error || 'Failed to update finalization state.');
      setFinalizeFailed(true);
    } finally {
      setFinalizing(false);
    }
  };

  const [bulkYearId, setBulkYearId] = useState('');
  const [bulkGradeId, setBulkGradeId] = useState('');
  const [checkingReadiness, setCheckingReadiness] = useState(false);
  const [readiness, setReadiness] = useState<ReadinessResponse | null>(null);
  const [readinessError, setReadinessError] = useState<string | null>(null);
  const [promoting, setPromoting] = useState(false);
  const [promoteResult, setPromoteResult] = useState<PromotionResult | null>(null);
  const [promoteError, setPromoteError] = useState<string | null>(null);

  const handleCheckReadiness = async () => {
    if (!bulkYearId) return;
    setCheckingReadiness(true);
    setReadinessError(null);
    setPromoteResult(null);
    try {
      const params = new URLSearchParams({ academic_year_id: bulkYearId });
      if (bulkGradeId) params.set('grade_id', bulkGradeId);
      const res = await api.get(`/api/promotion/readiness/?${params.toString()}`);
      setReadiness(res.data);
    } catch (err: any) {
      setReadinessError(err.response?.data?.error || 'Failed to check readiness.');
      setReadiness(null);
    } finally {
      setCheckingReadiness(false);
    }
  };

  const handlePromote = async () => {
    if (!bulkYearId || !readiness) return;
    setPromoting(true);
    setPromoteError(null);
    setPromoteResult(null);
    try {
      const response = await api.post('/api/promotion/promote-students/', {
        academic_year_id: bulkYearId,
        grade_id: bulkGradeId || undefined,
      });
      const result = await pollJob<PromotionResult>(response.data.job_id);
      setPromoteResult(result);
    } catch (err: any) {
      setPromoteError(err.response?.data?.error || err.message || 'Failed to run bulk promotion.');
    } finally {
      setPromoting(false);
    }
  };

  const nameById = Object.fromEntries((readiness?.students ?? []).map((row) => [row.student_id, row.name]));

  return (
    <Stack spacing={3}>
      <Card variant="outlined">
        <CardHeader title="Tier Requirements" subheader="What each tier requires before a student can promote past it — configure this from Curriculum → Tiers." />
        <CardContent>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Tier</TableCell>
                <TableCell>Exit requirement</TableCell>
                <TableCell>Leaves this school</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {tiers.map((tier) => (
                <TableRow key={tier.id}>
                  <TableCell>{tier.name}</TableCell>
                  <TableCell>
                    {tier.exit_exam_code
                      ? <Chip size="small" label={tier.exit_exam_code} />
                      : <Chip size="small" variant="outlined" label="Not configured (plain)" />}
                  </TableCell>
                  <TableCell>{tier.exit_exam_code ? (tier.exit_is_terminal ? 'Yes' : 'No') : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardHeader title="Finalize Term Results" subheader="Marks a term's results as done recording — the gate for plain grade promotions." />
        <CardContent>
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
            <TextField label="Exam Term ID" value={termId} onChange={(e) => setTermId(e.target.value)} size="small" />
            <Button variant="contained" disabled={finalizing || !termId} onClick={() => handleFinalize(true)}>
              Finalize
            </Button>
            <Button variant="outlined" disabled={finalizing || !termId} onClick={() => handleFinalize(false)}>
              Un-finalize
            </Button>
            {finalizing && <CircularProgress size={20} />}
          </Stack>
          {finalizeMsg && <Alert sx={{ mt: 2 }} severity={finalizeFailed ? 'error' : 'success'}>{finalizeMsg}</Alert>}
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardHeader
          avatar={<GraduationCap size={20} />}
          title="Bulk Promotion"
          subheader="Check who's ready before running anything — held students are simply skipped, never force-promoted."
        />
        <CardContent>
          <Stack spacing={2}>
            <Stack direction="row" spacing={2}>
              <TextField select label="Academic Year" value={bulkYearId} onChange={(e) => { setBulkYearId(e.target.value); setReadiness(null); }} size="small" sx={{ minWidth: 160 }}>
                {academicYears.map((y) => <MenuItem key={y.id} value={y.id}>{y.year}</MenuItem>)}
              </TextField>
              <TextField select label="Grade (optional — whole school if blank)" value={bulkGradeId} onChange={(e) => { setBulkGradeId(e.target.value); setReadiness(null); }} size="small" sx={{ minWidth: 220 }}>
                <MenuItem value="">Whole school</MenuItem>
                {grades.map((g) => <MenuItem key={g.id} value={g.id}>{g.grade_name}</MenuItem>)}
              </TextField>
              <Button variant="outlined" disabled={checkingReadiness || !bulkYearId} onClick={handleCheckReadiness}>
                {checkingReadiness ? <CircularProgress size={20} /> : 'Check Readiness'}
              </Button>
            </Stack>

            {readinessError && <Alert severity="error">{readinessError}</Alert>}

            {readiness && (
              <>
                <Stack direction="row" spacing={1}>
                  <Chip color="success" label={`${readiness.summary.ready} ready`} />
                  {Object.entries(readiness.summary.by_reason).map(([reason, count]) => (
                    <Chip key={reason} color="warning" label={`${count} blocked: ${reason}`} />
                  ))}
                </Stack>
                <ReadinessTable rows={readiness.students} />
                <Divider />
                <Box>
                  <Button variant="contained" color="primary" disabled={promoting || readiness.summary.ready === 0} onClick={handlePromote}>
                    {promoting ? <CircularProgress size={20} /> : 'Run Promotion'}
                  </Button>
                </Box>
              </>
            )}

            {promoteError && <Alert severity="error">{promoteError}</Alert>}
            {promoteResult && (
              <>
                <Alert severity="success" icon={<CheckCircle2 size={20} />}>
                  <Typography variant="body2">{promoteResult.message}</Typography>
                </Alert>
                <ReadinessTable rows={promoteResult.outcomes} nameById={nameById} />
              </>
            )}
          </Stack>
        </CardContent>
      </Card>

      {/* TASK 8 SECTIONS GO HERE */}
    </Stack>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: no new errors involving `PromotionPanel.tsx`. (All three response shapes above were verified against their view functions before being written into this task: `/api/academic-years/` → `{status, data: [{id, year, is_active, is_archived}]}` per `school/views/subject_views.py:api_get_academic_years`; `/api/academic-hub/` → `{data: {classes: [...]}}`, matching `CurriculumHub.tsx`'s own existing `academicHubRes.data?.data?.classes` usage; `/api/core/curriculum/tiers/` → a flat array, matching `CurriculumHub.tsx`'s own existing `setTiers(tierRes.data)` usage — no pagination wrapper on any of these three.)

- [ ] **Step 3: Manual QA**

Log in as admin, go to Results → Promotion. Confirm: the Tier Requirements table lists real tiers (showing "Not configured (plain)" for any tier without an exit exam — expected until Task 5's seed command has been run by the user). Pick an Academic Year + Grade with at least one student, click "Check Readiness", confirm the summary chips and table render real student names and reasons (not raw IDs). Click "Run Promotion" and confirm the outcomes table renders with real names via the `nameById` lookup.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/results/PromotionPanel.tsx
git commit -m "feat: rebuild PromotionPanel with tier summary + readiness-gated bulk promotion"
```

---

### Task 8: `PromotionPanel.tsx` — single-student panel + bulk exam recording

**Files:**
- Modify: `frontend/src/components/results/PromotionPanel.tsx` (insert two new `Card` sections at the `{/* TASK 8 SECTIONS GO HERE */}` marker from Task 7; replace the old raw-ID "Record a National Exam" card entirely — it's superseded, not kept alongside)

**Interfaces:**
- Consumes: `GET /api/promotion/readiness/?student_id=<id>` (Task 3), `POST /api/promotion/promote-student/<id>/` (Task 4), `POST /api/promotion/national-exam/<id>/` (existing, called once per student in the bulk-by-stream loop), `GET /api/approved-users/students/` (existing, `school/views/views.py:653` — returns `{status: 'success', data: [{id, name, username, email, class, enrollment_state, grade_name, grade_order}]}`, the flat student list), `assignmentService.getStudentsForStream(streamId)` (existing, `frontend/src/libs/assignmentService.ts:83` — returns `{id, name, roll}[]` directly, the stream roster; already used by `AssignmentOptionsPanel.tsx`).

- [ ] **Step 1: Add the single-student and bulk-exam-recording sections**

In `frontend/src/components/results/PromotionPanel.tsx`, first add the imports this step needs: `Autocomplete`, `Switch`, `FormControlLabel` to the existing MUI import line, and a new `assignmentService` import alongside the existing `pollJob` import:

```tsx
import {
  Box, Card, CardContent, CardHeader, Button, TextField, MenuItem, Alert,
  CircularProgress, Stack, Typography, Table, TableHead, TableBody, TableRow, TableCell,
  Chip, Divider, Autocomplete, Switch, FormControlLabel,
} from '@mui/material';
```

```tsx
import { assignmentService } from '../../libs/assignmentService';
```

Add this interface near the other interfaces at the top of the file:

```tsx
interface StudentOption {
  id: number;
  name: string;
}

interface StreamOption {
  id: number;
  label: string;
}
```

Add this state and data-fetching, alongside the existing `useEffect` that loads `academicYears`/`grades`/`tiers`:

```tsx
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [streams, setStreams] = useState<StreamOption[]>([]);

  useEffect(() => {
    api.get('/api/academic-hub/').then((res) => {
      const classes = res.data?.data?.classes ?? [];
      setStreams(classes.map((c: any) => ({ id: c.id, label: `${c.grade_name} · Stream #${c.id}` })));
    });
    api.get('/api/approved-users/students/').then((res) => {
      setStudents((res.data?.data ?? []).map((s: any) => ({ id: s.id, name: s.name })));
    }).catch(() => setStudents([]));
  }, []);
```

Add this state for the single-student panel:

```tsx
  const [singleStudent, setSingleStudent] = useState<StudentOption | null>(null);
  const [singleYearId, setSingleYearId] = useState('');
  const [singleReadiness, setSingleReadiness] = useState<ReadinessRow | null>(null);
  const [singleChecking, setSingleChecking] = useState(false);
  const [singlePromoting, setSinglePromoting] = useState(false);
  const [singleResult, setSingleResult] = useState<PromotionOutcome | null>(null);
  const [singleError, setSingleError] = useState<string | null>(null);

  const handleCheckSingle = async () => {
    if (!singleStudent || !singleYearId) return;
    setSingleChecking(true);
    setSingleError(null);
    setSingleResult(null);
    try {
      const params = new URLSearchParams({ academic_year_id: singleYearId, student_id: String(singleStudent.id) });
      const res = await api.get(`/api/promotion/readiness/?${params.toString()}`);
      setSingleReadiness((res.data as ReadinessResponse).students[0] ?? null);
    } catch (err: any) {
      setSingleError(err.response?.data?.error || 'Failed to check readiness.');
    } finally {
      setSingleChecking(false);
    }
  };

  const handlePromoteSingle = async () => {
    if (!singleStudent || !singleYearId) return;
    setSinglePromoting(true);
    setSingleError(null);
    try {
      const res = await api.post(`/api/promotion/promote-student/${singleStudent.id}/`, { academic_year_id: singleYearId });
      setSingleResult(res.data);
      setSingleReadiness(null);
    } catch (err: any) {
      setSingleError(err.response?.data?.error || 'Failed to promote this student.');
    } finally {
      setSinglePromoting(false);
    }
  };
```

Add this state for the exam-recording section:

```tsx
  const [bulkExamMode, setBulkExamMode] = useState(false);
  const [examStudent, setExamStudent] = useState<StudentOption | null>(null);
  const [examStreamId, setExamStreamId] = useState('');
  const [examCode, setExamCode] = useState('KJSEA');
  const [examYearId, setExamYearId] = useState('');
  const [destination, setDestination] = useState('');
  const [recordingExam, setRecordingExam] = useState(false);
  const [examMsg, setExamMsg] = useState<string | null>(null);
  const [examFailed, setExamFailed] = useState(false);

  const handleRecordExam = async () => {
    if (!examYearId) return;
    setRecordingExam(true);
    setExamMsg(null);
    setExamFailed(false);
    try {
      if (bulkExamMode) {
        if (!examStreamId) return;
        const roster = await assignmentService.getStudentsForStream(examStreamId);
        const studentIds = roster.map((s) => s.id);
        await Promise.all(studentIds.map((id) =>
          api.post(`/api/promotion/national-exam/${id}/`, { exam_code: examCode, academic_year_id: examYearId, destination })
        ));
        setExamMsg(`Recorded ${examCode} for ${studentIds.length} student(s).`);
      } else {
        if (!examStudent) return;
        await api.post(`/api/promotion/national-exam/${examStudent.id}/`, { exam_code: examCode, academic_year_id: examYearId, destination });
        setExamMsg('Exam record saved.');
      }
    } catch (err: any) {
      setExamMsg(err.response?.data?.error || 'Failed to save exam record(s).');
      setExamFailed(true);
    } finally {
      setRecordingExam(false);
    }
  };
```

Then replace the `{/* TASK 8 SECTIONS GO HERE */}` marker with:

```tsx
      <Card variant="outlined">
        <CardHeader title="Check / Promote a Single Student" subheader="For one-off corrections outside a bulk run." />
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

      <Card variant="outlined">
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

- [ ] **Step 2: Type-check**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: no new errors involving `PromotionPanel.tsx`.

- [ ] **Step 3: Manual QA**

Log in as admin, Results → Promotion. In "Check / Promote a Single Student": search and pick a real student, pick a year, click Check, confirm the readiness message renders, and if ready, click Promote and confirm the outcome alert shows. In "Record a National Exam": test both the single-student mode (unchanged from before) and the new "whole stream" toggle — pick a stream, save, and spot-check via Django admin or the Curriculum/Results UI that `NationalExamRecord` rows were created for that stream's students.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/results/PromotionPanel.tsx
git commit -m "feat: add single-student promotion and bulk-by-stream exam recording"
```

---

## Self-Review Notes

- **Spec coverage:** All 8 spec sections (§1-8) map to a task: §1→Task1, §2-3→Task2, §4→Task3, §5→Task4, §6→Task5, §7→Task6, §8→Tasks7-8. Data-flow (§ "Data flow") is exercised by Task 7's manual QA steps in order. Error handling (§ "Error handling") is covered by Tasks 3-4's 400/404 tests and the "no current class" / "tier not configured" cases in Task 2's tests.
- **Type consistency:** `ReadinessResult`'s keys (`ready`, `transition_type`, `requirement`, `reason`, `next_grade_name` — internal Python dict, Task 2) match the JSON keys the readiness endpoint emits per-student (Task 3, adds `student_id`/`name`/`grade_name`, drops nothing) match the frontend `ReadinessRow` interface (Task 7) exactly.
- **Endpoint verification:** every endpoint this plan references was confirmed to exist against the current codebase before being written into a task — including Task 8's student list (`GET /api/approved-users/students/`, `school/views/views.py:653`) and stream roster (`assignmentService.getStudentsForStream`, `frontend/src/libs/assignmentService.ts:83`, already consumed by `AssignmentOptionsPanel.tsx`), neither of which were part of the original spec's wording.
