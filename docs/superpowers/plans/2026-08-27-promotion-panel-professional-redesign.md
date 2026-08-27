# Promotion Panel Professional Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `PromotionPanel.tsx` from five disconnected, raw-ID-driven cards into one cohesive, gated, professional promotion process, backed by a new prerequisites endpoint that proactively reports live progress against the exact requirements `_readiness_for_student` already enforces.

**Architecture:** A new read-only `GET /api/promotion/prerequisites/` endpoint groups currently-enrolled grades by transition type (plain/exam_gated/exit) and reports live satisfied/detail progress, reusing `_determine_transition` and `results_finalized_for_year` rather than reimplementing them. The frontend gains one shared "Working Scope" selector, a new `ProcessStepCard` component for consistent numbered/locked step visuals, and restructures the panel into Step 1 (Requirements checklist, replacing the standalone Finalize Term card), Step 2 (Check Readiness, gated, with a transition-preview column), and Step 3 (Run Promotion, gated, with a confirmation dialog) — plus CSV export on both tables.

**Tech Stack:** Django 6 / DRF (backend), React + TypeScript + MUI (`@mui/material`) + `lucide-react` icons (frontend).

**Spec:** `docs/superpowers/specs/2026-08-27-promotion-panel-professional-redesign-design.md`

## Global Constraints

- No changes to `_readiness_for_student`, `_determine_transition`, `_promote_student`, `PromoteStudentsAPIView`, `RecordNationalExamAPIView`, or `FinalizeTermAPIView` internals beyond what's explicitly described in this plan.
- No "recent promotion activity" audit-log feed — explicitly out of scope.
- No scheduler/automation of promotion.
- Never run `makemigrations`/`migrate` — this plan requires zero migrations (no model changes).
- New endpoint uses `rbac_view_permission = 'results.view'`, matching `PromotionReadinessAPIView`'s existing read-only gate.
- `git add` only the exact files each task touches — never `git add -A`/`git add .` (this repo's working tree is shared with concurrent sessions).

---

### Task 1: `PromotionPrerequisitesAPIView` — backend endpoint + URL route

**Files:**
- Modify: `school/views/promotion_views.py` (add `GradeLevel` import, add new view class after `PromotionReadinessAPIView`, i.e. after line 373)
- Modify: `schoolmanagement/Urls/urls.py` (one new route)
- Test: `school/tests/test_promotion_readiness.py` (append new test class)

**Interfaces:**
- Consumes: `_determine_transition(grade)` (existing, returns `(transition_type, exam_code, next_grade)`), `results_finalized_for_year(academic_year)` (existing), `AcademicYear`, `ExamTerm`, `NationalExamRecord`, `StudentExtra`, `GradeLevel` models.
- Produces: `GET /api/promotion/prerequisites/?academic_year_id=<id>&grade_id=<id optional>` returning:
  ```json
  {
    "scope": {"academic_year": "2026", "grade_name": "Grade 9" | null},
    "requirement_groups": [
      {
        "transition_type": "plain",
        "exam_code": null,
        "grade_names": ["Grade 1"],
        "requirement": "Results finalized for 2026",
        "satisfied": true,
        "detail": "2 of 3 term(s) finalized",
        "terms": [{"id": 1, "name": "Term 1", "results_finalized": true}]
      },
      {
        "transition_type": "exam_gated",
        "exam_code": "KPSEA",
        "grade_names": ["Grade 6"],
        "requirement": "KPSEA recorded",
        "satisfied": false,
        "detail": "38 of 45 student(s) recorded"
      }
    ]
  }
  ```
  Only the `plain` group carries a `terms` key. Later tasks (frontend) rely on this exact shape.

- [ ] **Step 1: Add the `GradeLevel` import**

In `school/views/promotion_views.py`, the import at the top currently reads:

```python
from apps.academics.models import (
    ExamTerm, next_grade_level, get_or_create_class_stream, tier_requires_pathway_choice, AcademicYear,
)
```

Change it to:

```python
from apps.academics.models import (
    ExamTerm, GradeLevel, next_grade_level, get_or_create_class_stream, tier_requires_pathway_choice, AcademicYear,
)
```

- [ ] **Step 2: Write the failing tests**

Append to `school/tests/test_promotion_readiness.py` (after the existing `PromoteSingleStudentAPIViewTests` class, at the end of the file):

```python
from school.views.promotion_views import PromotionPrerequisitesAPIView


class PromotionPrerequisitesAPIViewTests(ExamTestDataMixin, TestCase):
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        Permission.objects.get_or_create(code='results.view', defaults={'label': 'results.view', 'module': 'results'})
        role = Role.objects.create(name='Prerequisites Viewer')
        role.permissions.set(Permission.objects.filter(code='results.view'))
        UserRole.objects.create(user=cls.admin_user, role=role)

        cls.curriculum = Curriculum.objects.create(code='PREQ1', name='Prerequisites Test Curriculum')

        # A plain-transition grade (no exit exam configured on its tier).
        cls.plain_tier = Tier.objects.create(curriculum=cls.curriculum, name='Lower Primary', code='LPPREQ1')
        cls.plain_grade = GradeLevel.objects.create(
            name='Grade 1PREQ', numeric_order=1, curriculum=cls.curriculum, tier=cls.plain_tier,
        )
        GradeLevel.objects.create(name='Grade 2PREQ', numeric_order=2, curriculum=cls.curriculum, tier=cls.plain_tier)
        cls.plain_stream = ClassStream.objects.create(name='Central', grade=cls.plain_grade)

        # An exam-gated grade (exits its tier via KPSEA, non-terminal).
        cls.exam_tier = Tier.objects.create(
            curriculum=cls.curriculum, name='Upper Primary', code='UPPREQ1',
            exit_exam_code='KPSEA', exit_is_terminal=False,
        )
        cls.jss_tier = Tier.objects.create(curriculum=cls.curriculum, name='Junior Secondary', code='JSSPREQ1')
        cls.exam_grade = GradeLevel.objects.create(
            name='Grade 6PREQ', numeric_order=6, curriculum=cls.curriculum, tier=cls.exam_tier,
        )
        GradeLevel.objects.create(name='Grade 7PREQ', numeric_order=7, curriculum=cls.curriculum, tier=cls.jss_tier)
        cls.exam_stream = ClassStream.objects.create(name='Central', grade=cls.exam_grade)

        cls.year = AcademicYear.objects.create(year='2098')
        ExamTerm.objects.create(
            name='Term 1', academic_year=cls.year, start_date='2098-01-01', end_date='2098-04-01',
            results_finalized=True,
        )
        ExamTerm.objects.create(
            name='Term 2', academic_year=cls.year, start_date='2098-05-01', end_date='2098-08-01',
            results_finalized=False,
        )

        plain_user = User.objects.create_user(username='preq_plain_student', password='x')
        cls.plain_student = StudentExtra.objects.create(user=plain_user, roll='PP01', cl=cls.plain_stream, status=True)

        exam_user_a = User.objects.create_user(username='preq_exam_student_a', password='x')
        cls.exam_student_a = StudentExtra.objects.create(user=exam_user_a, roll='PE01', cl=cls.exam_stream, status=True)
        exam_user_b = User.objects.create_user(username='preq_exam_student_b', password='x')
        cls.exam_student_b = StudentExtra.objects.create(user=exam_user_b, roll='PE02', cl=cls.exam_stream, status=True)
        NationalExamRecord.objects.create(student=cls.exam_student_a, exam_code='KPSEA', academic_year=cls.year)

    def setUp(self):
        cache.clear()
        self.factory = RequestFactory()

    def _get(self, query):
        request = self.factory.get(f'/api/promotion/prerequisites/?{query}')
        request.user = self.admin_user
        return PromotionPrerequisitesAPIView.as_view()(request)

    def test_missing_academic_year_id_is_rejected(self):
        request = self.factory.get('/api/promotion/prerequisites/')
        request.user = self.admin_user
        response = PromotionPrerequisitesAPIView.as_view()(request)
        self.assertEqual(response.status_code, 400)

    def test_unknown_grade_id_returns_404(self):
        response = self._get(f'academic_year_id={self.year.id}&grade_id=999999')
        self.assertEqual(response.status_code, 404)

    def test_whole_school_scope_buckets_by_transition_type(self):
        response = self._get(f'academic_year_id={self.year.id}')
        self.assertEqual(response.status_code, 200)
        data = response.data
        self.assertIsNone(data['scope']['grade_name'])

        groups = {(g['transition_type'], g['exam_code']): g for g in data['requirement_groups']}
        self.assertIn(('plain', None), groups)
        self.assertIn(('exam_gated', 'KPSEA'), groups)

        plain_group = groups[('plain', None)]
        self.assertEqual(plain_group['grade_names'], ['Grade 1PREQ'])
        self.assertFalse(plain_group['satisfied'])
        self.assertEqual(plain_group['detail'], '1 of 2 term(s) finalized')
        self.assertEqual(len(plain_group['terms']), 2)

        exam_group = groups[('exam_gated', 'KPSEA')]
        self.assertEqual(exam_group['grade_names'], ['Grade 6PREQ'])
        self.assertFalse(exam_group['satisfied'])
        self.assertEqual(exam_group['detail'], '1 of 2 student(s) recorded')

    def test_grade_scope_narrows_to_one_group(self):
        response = self._get(f'academic_year_id={self.year.id}&grade_id={self.exam_grade.id}')
        data = response.data
        self.assertEqual(data['scope']['grade_name'], 'Grade 6PREQ')
        self.assertEqual(len(data['requirement_groups']), 1)
        self.assertEqual(data['requirement_groups'][0]['transition_type'], 'exam_gated')

    def test_fully_satisfied_plain_group(self):
        satisfied_year = AcademicYear.objects.create(year='2099')
        ExamTerm.objects.create(
            name='Term 1', academic_year=satisfied_year, start_date='2099-01-01', end_date='2099-04-01',
            results_finalized=True,
        )
        response = self._get(f'academic_year_id={satisfied_year.id}&grade_id={self.plain_grade.id}')
        data = response.data
        self.assertTrue(data['requirement_groups'][0]['satisfied'])
        self.assertEqual(data['requirement_groups'][0]['detail'], '1 of 1 term(s) finalized')

    def test_empty_scope_returns_no_groups(self):
        empty_year = AcademicYear.objects.create(year='2100')
        empty_tier = Tier.objects.create(curriculum=self.curriculum, name='Empty Tier', code='EMPPREQ1')
        empty_grade = GradeLevel.objects.create(
            name='Grade EmptyPREQ', numeric_order=99, curriculum=self.curriculum, tier=empty_tier,
        )
        response = self._get(f'academic_year_id={empty_year.id}&grade_id={empty_grade.id}')
        self.assertEqual(response.data['requirement_groups'], [])

    def test_permission_required(self):
        no_role_user = User.objects.create_user(username='preq_no_role', password='x')
        request = self.factory.get(f'/api/promotion/prerequisites/?academic_year_id={self.year.id}')
        request.user = no_role_user
        response = PromotionPrerequisitesAPIView.as_view()(request)
        self.assertEqual(response.status_code, 403)
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
DB_NAME=school_db_task1check ./venv/bin/python manage.py test school.tests.test_promotion_readiness.PromotionPrerequisitesAPIViewTests --noinput -v 2
```

Expected: FAIL / ERROR — `PromotionPrerequisitesAPIView` doesn't exist yet, and the URL doesn't resolve.

- [ ] **Step 3: Implement `PromotionPrerequisitesAPIView`**

In `school/views/promotion_views.py`, add this class immediately after `PromotionReadinessAPIView` (i.e. right before the blank lines preceding `class PromoteSingleStudentAPIView`, around line 375):

```python
class PromotionPrerequisitesAPIView(APIView):
    """
    Read-only prerequisite checklist for a promotion scope. Groups currently-enrolled grades
    by transition type and reports live progress against the exact requirement
    _readiness_for_student enforces for that type — reusing _determine_transition and
    results_finalized_for_year rather than re-deriving them, so this can never show a
    different picture than what a readiness check or a promotion run will actually do.
    """
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

        grade_id = request.query_params.get('grade_id')
        scope_grade_name = None
        if grade_id:
            grade_obj = GradeLevel.objects.filter(id=grade_id).first()
            if grade_obj is None:
                return Response({"error": "Grade not found."}, status=status.HTTP_404_NOT_FOUND)
            scope_grade_name = grade_obj.name

        students_qs = StudentExtra.objects.filter(status=True).exclude(
            enrollment_state__in=['Graduated', 'Expelled', 'Transferred']
        ).select_related('cl__grade__tier')
        if grade_id:
            students_qs = students_qs.filter(cl__grade_id=grade_id)

        grade_ids = set(students_qs.exclude(cl__isnull=True).values_list('cl__grade_id', flat=True))
        grades = GradeLevel.objects.filter(id__in=grade_ids).select_related('tier')

        plain_grade_names = []
        exam_buckets = {}  # (transition_type, exam_code) -> {'grade_names': [...], 'grade_ids': set()}

        for grade in grades:
            transition_type, exam_code, _next_grade = _determine_transition(grade)
            if transition_type == 'plain':
                plain_grade_names.append(grade.name)
            else:
                key = (transition_type, exam_code)
                bucket = exam_buckets.setdefault(key, {'grade_names': [], 'grade_ids': set()})
                bucket['grade_names'].append(grade.name)
                bucket['grade_ids'].add(grade.id)

        requirement_groups = []

        if plain_grade_names:
            terms = list(ExamTerm.objects.filter(academic_year=academic_year).order_by('start_date'))
            finalized_count = sum(1 for t in terms if t.results_finalized)
            satisfied = bool(terms) and finalized_count == len(terms)
            requirement_groups.append({
                'transition_type': 'plain',
                'exam_code': None,
                'grade_names': sorted(plain_grade_names),
                'requirement': f'Results finalized for {academic_year.year}',
                'satisfied': satisfied,
                'detail': (
                    f'{finalized_count} of {len(terms)} term(s) finalized' if terms
                    else 'No terms configured for this academic year.'
                ),
                'terms': [
                    {'id': t.id, 'name': t.name, 'results_finalized': t.results_finalized}
                    for t in terms
                ],
            })

        for (transition_type, exam_code), bucket in sorted(
            exam_buckets.items(), key=lambda kv: (kv[0][0], kv[0][1] or '')
        ):
            bucket_students = students_qs.filter(cl__grade_id__in=bucket['grade_ids'])
            total_count = bucket_students.count()
            recorded_count = NationalExamRecord.objects.filter(
                exam_code=exam_code, academic_year=academic_year, student__in=bucket_students,
            ).count()
            requirement_groups.append({
                'transition_type': transition_type,
                'exam_code': exam_code,
                'grade_names': sorted(bucket['grade_names']),
                'requirement': f'{exam_code} recorded',
                'satisfied': total_count > 0 and recorded_count == total_count,
                'detail': f'{recorded_count} of {total_count} student(s) recorded',
            })

        return Response({
            'scope': {'academic_year': academic_year.year, 'grade_name': scope_grade_name},
            'requirement_groups': requirement_groups,
        })
```

- [ ] **Step 4: Add the URL route**

In `schoolmanagement/Urls/urls.py`, find the existing line:

```python
    path('api/promotion/readiness/', promotion_views.PromotionReadinessAPIView.as_view(), name='promotion_readiness'),
```

Add immediately after it:

```python
    path('api/promotion/prerequisites/', promotion_views.PromotionPrerequisitesAPIView.as_view(), name='promotion_prerequisites'),
```

(If the exact surrounding line differs, add the new route directly below whichever line registers `api/promotion/readiness/` — it must sit in the same `api/promotion/...` route group.)

- [ ] **Step 5: Run the tests to verify they pass**

```bash
DB_NAME=school_db_task1check ./venv/bin/python manage.py test school.tests.test_promotion_readiness --noinput -v 2
```

Expected: PASS — all tests in the file, including the new `PromotionPrerequisitesAPIViewTests` class.

- [ ] **Step 6: Run the full promotion test suite as a regression check**

```bash
DB_NAME=school_db_task1check ./venv/bin/python manage.py test school.tests.test_promotion school.tests.test_promotion_readiness --noinput -v 2
./venv/bin/python manage.py check
```

Expected: all existing tests still PASS, `System check identified no issues`.

- [ ] **Step 7: Commit**

```bash
git add school/views/promotion_views.py schoolmanagement/Urls/urls.py school/tests/test_promotion_readiness.py
git commit -m "feat(promotion): add prerequisites endpoint for live gating checklist"
```

---

### Task 2: Readiness row transition-preview fields

**Files:**
- Modify: `school/views/promotion_views.py:356-364` (the `rows.append(...)` block inside `PromotionReadinessAPIView.get`)
- Test: `school/tests/test_promotion_readiness.py` (extend `PromotionReadinessAPIViewTests`)

**Interfaces:**
- Consumes: `_readiness_for_student`'s existing return dict (already has `next_grade_name` computed on every path; `exam_code` is available as a local variable inside `_determine_transition`'s unpacked tuple, not on the readiness dict itself — see Step 3 for the actual approach).
- Produces: each row in `GET /api/promotion/readiness/`'s `students` list gains two new keys: `next_grade_name: string | null` and `exam_code: string | null`. Task 4 (frontend) reads both.

- [ ] **Step 1: Write the failing test**

Append this test method to the existing `PromotionReadinessAPIViewTests` class in `school/tests/test_promotion_readiness.py` (add it as a new method inside that class, e.g. right after `test_graduated_student_is_excluded_from_scope`):

```python
    def test_ready_row_includes_transition_preview_fields(self):
        response = self._get(f'academic_year_id={self.ready_year.id}&grade_id={self.g1.id}')
        data = response.data
        row = next(r for r in data['students'] if r['student_id'] == self.ready_student.id)
        self.assertEqual(row['next_grade_name'], 'Grade 2PRAV')
        self.assertIsNone(row['exam_code'])
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
DB_NAME=school_db_task2check ./venv/bin/python manage.py test school.tests.test_promotion_readiness.PromotionReadinessAPIViewTests.test_ready_row_includes_transition_preview_fields --noinput -v 2
```

Expected: FAIL with a `KeyError: 'next_grade_name'`.

- [ ] **Step 3: Add the two fields to the row dict**

In `school/views/promotion_views.py`, find this block inside `PromotionReadinessAPIView.get` (around line 354-364):

```python
        for student in students_qs:
            readiness = _readiness_for_student(student, academic_year, results_finalized=results_finalized)
            rows.append({
                'student_id': student.id,
                'name': student.get_name,
                'grade_name': student.cl.grade.name if student.cl_id else None,
                'transition_type': readiness['transition_type'],
                'requirement': readiness['requirement'],
                'ready': readiness['ready'],
                'reason': readiness['reason'],
            })
```

Replace it with:

```python
        for student in students_qs:
            readiness = _readiness_for_student(student, academic_year, results_finalized=results_finalized)
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

(`readiness['next_grade_name']` is already set on every return path inside `_readiness_for_student`. `readiness['_transition']` is the private `(transition_type, exam_code, next_grade)` tuple also set on every return path — index `[1]` is `exam_code`. This is the one place in the codebase allowed to read `_transition`, since it's reading, not re-deriving, and the docstring's warning is specifically about not letting `_transition` leak into a JSON response — it isn't leaking here, only its `exam_code` element is copied out as its own named field.)

- [ ] **Step 4: Run the test to verify it passes**

```bash
DB_NAME=school_db_task2check ./venv/bin/python manage.py test school.tests.test_promotion_readiness.PromotionReadinessAPIViewTests --noinput -v 2
```

Expected: PASS — all tests in `PromotionReadinessAPIViewTests`, including the new one.

- [ ] **Step 5: Run the full promotion test suite as a regression check**

```bash
DB_NAME=school_db_task2check ./venv/bin/python manage.py test school.tests.test_promotion school.tests.test_promotion_readiness --noinput -v 2
./venv/bin/python manage.py check
```

Expected: all tests PASS, system check clean.

- [ ] **Step 6: Commit**

```bash
git add school/views/promotion_views.py school/tests/test_promotion_readiness.py
git commit -m "feat(promotion): expose transition preview fields on readiness rows"
```

---

### Task 3: `ProcessStepCard` shared frontend component

**Files:**
- Create: `frontend/src/components/results/ProcessStepCard.tsx`

**Interfaces:**
- Produces: `export default function ProcessStepCard({ step, title, subheader, locked, lockedReason, children }: ProcessStepCardProps)` where:
  ```ts
  interface ProcessStepCardProps {
    step: number;
    title: string;
    subheader?: string;
    locked: boolean;
    lockedReason?: string;
    children: React.ReactNode;
  }
  ```
  When `locked` is `true`, renders an `Alert` with `lockedReason` (or a generic fallback) instead of `children`. Task 4 imports this as `import ProcessStepCard from './ProcessStepCard';` and wraps Steps 1-3 with it.

- [ ] **Step 1: Create the component**

```tsx
import { Alert, Avatar, Card, CardContent, CardHeader } from '@mui/material';
import { Lock } from 'lucide-react';
import type { ReactNode } from 'react';

interface ProcessStepCardProps {
  step: number;
  title: string;
  subheader?: string;
  locked: boolean;
  lockedReason?: string;
  children: ReactNode;
}

export default function ProcessStepCard({ step, title, subheader, locked, lockedReason, children }: ProcessStepCardProps) {
  return (
    <Card variant="outlined" sx={{ opacity: locked ? 0.7 : 1, transition: 'opacity 0.2s' }}>
      <CardHeader
        avatar={
          <Avatar sx={{ width: 32, height: 32, fontSize: 14, bgcolor: locked ? 'grey.400' : 'primary.main' }}>
            {step}
          </Avatar>
        }
        title={title}
        subheader={subheader}
      />
      <CardContent>
        {locked
          ? <Alert severity="info" icon={<Lock size={18} />}>{lockedReason ?? 'Complete the previous step first.'}</Alert>
          : children}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd frontend && npx tsc -b --noEmit 2>&1 | grep -i "ProcessStepCard"
```

Expected: no output (no errors referencing this new file). It isn't imported anywhere yet, so this only confirms the file itself is syntactically and structurally valid TypeScript.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/results/ProcessStepCard.tsx
git commit -m "feat(promotion): add ProcessStepCard shared component"
```

---

### Task 4: `PromotionPanel.tsx` full restructure

**Depends on:** Task 1 (prerequisites endpoint shape), Task 2 (readiness row fields), Task 3 (`ProcessStepCard`). Read all three "Produces" sections above before starting — this task's code assumes those exact shapes.

**Files:**
- Modify (full rewrite): `frontend/src/components/results/PromotionPanel.tsx`

**Interfaces:**
- Consumes: `GET /api/promotion/prerequisites/` (Task 1's exact response shape), `next_grade_name`/`exam_code` on readiness rows (Task 2), `ProcessStepCard` (Task 3).
- Produces: no new exports consumed elsewhere — `PromotionPanel` is a page-level component. No changes to how it's imported/mounted (verify with `grep -rn "PromotionPanel" frontend/src --include=*.tsx | grep -v PromotionPanel.tsx` before starting, to confirm the mounting site is unaffected).

- [ ] **Step 1: Confirm the mounting site is unaffected**

```bash
grep -rn "PromotionPanel" frontend/src --include=*.tsx | grep -v "components/results/PromotionPanel.tsx"
```

This is a read-only sanity check — the component's default export and file path aren't changing, so whatever imports it today keeps working unmodified. No action needed unless this turns up something unexpected (in which case stop and report before proceeding).

- [ ] **Step 2: Replace the entire file**

Replace the full contents of `frontend/src/components/results/PromotionPanel.tsx` with:

```tsx
import { useEffect, useRef, useState } from 'react';
import {
  Box, Card, CardContent, CardHeader, Button, TextField, MenuItem, Alert,
  CircularProgress, Stack, Typography, Table, TableHead, TableBody, TableRow, TableCell,
  Chip, Autocomplete, Switch, FormControlLabel,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
} from '@mui/material';
import { GraduationCap, CheckCircle2, Download } from 'lucide-react';
import api from '../../libs/axiosInstance';
import { pollJob } from '../../libs/pollJob';
import { assignmentService } from '../../libs/assignmentService';
import ProcessStepCard from './ProcessStepCard';

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
  next_grade_name: string | null;
  exam_code: string | null;
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

interface StudentOption {
  id: number;
  name: string;
}

interface StreamOption {
  id: number;
  label: string;
}

interface TermStatus {
  id: number;
  name: string;
  results_finalized: boolean;
}

interface RequirementGroup {
  transition_type: 'plain' | 'exam_gated' | 'exit';
  exam_code: string | null;
  grade_names: string[];
  requirement: string;
  satisfied: boolean;
  detail: string;
  terms?: TermStatus[];
}

interface PrerequisitesResponse {
  scope: { academic_year: string; grade_name: string | null };
  requirement_groups: RequirementGroup[];
}

function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const escape = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map((row) => row.map(escape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

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
        <TableHead>
          <TableRow>
            <TableCell>Student</TableCell>
            {isReadinessRows && <TableCell>Transition</TableCell>}
            <TableCell>{isReadinessRows ? 'Requirement' : 'Outcome'}</TableCell>
            <TableCell>{isReadinessRows ? 'Status' : 'Detail'}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {isReadinessRows
            ? (rows as ReadinessRow[]).map((row) => (
                <TableRow key={row.student_id}>
                  <TableCell>
                    {row.name} <Typography component="span" variant="caption" color="text.secondary">({row.grade_name ?? '—'})</Typography>
                  </TableCell>
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
    </Stack>
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

  const [students, setStudents] = useState<StudentOption[]>([]);
  const [streams, setStreams] = useState<StreamOption[]>([]);

  useEffect(() => {
    api.get('/api/academic-hub/').then((res) => {
      const classes = res.data?.data?.classes ?? [];
      setStreams(classes.flatMap((c: any) =>
        (c.streams ?? []).map((s: any) => ({ id: s.id, label: `${c.grade_name} · ${s.name}` }))
      ));
    });
    api.get('/api/approved-users/students/').then((res) => {
      setStudents((res.data?.data ?? []).map((s: any) => ({ id: s.id, name: s.name })));
    }).catch(() => setStudents([]));
  }, []);

  // --- Working Scope: shared by the Requirements / Check Readiness / Run Promotion steps. ---
  const [scopeYearId, setScopeYearId] = useState('');
  const [scopeGradeId, setScopeGradeId] = useState('');

  const [prerequisites, setPrerequisites] = useState<PrerequisitesResponse | null>(null);
  const [prereqLoading, setPrereqLoading] = useState(false);
  const [prereqError, setPrereqError] = useState<string | null>(null);
  const [finalizingTermId, setFinalizingTermId] = useState<number | null>(null);

  const fetchPrerequisites = async (yearId: string, gradeId: string) => {
    if (!yearId) {
      setPrerequisites(null);
      return;
    }
    setPrereqLoading(true);
    setPrereqError(null);
    try {
      const params = new URLSearchParams({ academic_year_id: yearId });
      if (gradeId) params.set('grade_id', gradeId);
      const res = await api.get(`/api/promotion/prerequisites/?${params.toString()}`);
      setPrerequisites(res.data);
    } catch (err: any) {
      setPrereqError(err.response?.data?.error || 'Failed to load promotion requirements.');
      setPrerequisites(null);
    } finally {
      setPrereqLoading(false);
    }
  };

  useEffect(() => {
    fetchPrerequisites(scopeYearId, scopeGradeId);
    setReadiness(null);
    setPromoteResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeYearId, scopeGradeId]);

  const handleFinalizeTerm = async (termId: number, finalized: boolean) => {
    setFinalizingTermId(termId);
    try {
      await api.post(`/api/promotion/finalize-term/${termId}/`, { finalized });
      await fetchPrerequisites(scopeYearId, scopeGradeId);
    } catch (err: any) {
      setPrereqError(err.response?.data?.error || 'Failed to update finalization state.');
    } finally {
      setFinalizingTermId(null);
    }
  };

  const noStudentsInScope = prerequisites !== null && prerequisites.requirement_groups.length === 0;
  const allRequirementsSatisfied = prerequisites !== null
    && prerequisites.requirement_groups.length > 0
    && prerequisites.requirement_groups.every((g) => g.satisfied);
  const unmetRequirements = prerequisites?.requirement_groups.filter((g) => !g.satisfied) ?? [];

  const step2Locked = !scopeYearId || prereqLoading || noStudentsInScope || !allRequirementsSatisfied;
  const step2LockedReason = !scopeYearId
    ? 'Select an academic year above to begin.'
    : prereqLoading
      ? 'Checking requirements…'
      : noStudentsInScope
        ? 'No enrolled students in this scope.'
        : `Complete Step 1 first: ${unmetRequirements.map((g) => g.requirement).join('; ')}`;

  const [checkingReadiness, setCheckingReadiness] = useState(false);
  const [readiness, setReadiness] = useState<ReadinessResponse | null>(null);
  const [readinessError, setReadinessError] = useState<string | null>(null);
  const [promoting, setPromoting] = useState(false);
  const [promoteResult, setPromoteResult] = useState<PromotionResult | null>(null);
  const [promoteError, setPromoteError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleCheckReadiness = async () => {
    if (!scopeYearId) return;
    setCheckingReadiness(true);
    setReadinessError(null);
    setPromoteResult(null);
    try {
      const params = new URLSearchParams({ academic_year_id: scopeYearId });
      if (scopeGradeId) params.set('grade_id', scopeGradeId);
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
    if (!scopeYearId || !readiness) return;
    setPromoting(true);
    setPromoteError(null);
    setPromoteResult(null);
    try {
      const response = await api.post('/api/promotion/promote-students/', {
        academic_year_id: scopeYearId,
        grade_id: scopeGradeId || undefined,
      });
      const result = await pollJob<PromotionResult>(response.data.job_id);
      setPromoteResult(result);
      setReadiness(null);
    } catch (err: any) {
      setPromoteError(err.response?.data?.error || err.message || 'Failed to run bulk promotion.');
    } finally {
      setPromoting(false);
    }
  };

  const step3Locked = !readiness || readiness.summary.ready === 0;
  const step3LockedReason = !readiness
    ? 'Run "Check Readiness" in Step 2 first.'
    : 'No students are currently ready to promote.';

  const nameById = Object.fromEntries((readiness?.students ?? []).map((row) => [row.student_id, row.name]));

  const exportReadinessCsv = () => {
    if (!readiness) return;
    downloadCsv(
      `promotion-readiness-${scopeYearId}.csv`,
      ['Student', 'Grade', 'Transition', 'Requirement', 'Ready', 'Reason'],
      readiness.students.map((r) => [
        r.name,
        r.grade_name ?? '',
        r.transition_type === 'exit' ? 'Graduates' : (r.next_grade_name ?? ''),
        r.requirement ?? '',
        r.ready ? 'Yes' : 'No',
        r.reason ?? '',
      ]),
    );
  };

  const exportOutcomeCsv = () => {
    if (!promoteResult) return;
    downloadCsv(
      `promotion-outcomes-${scopeYearId}.csv`,
      ['Student', 'Outcome', 'Detail'],
      promoteResult.outcomes.map((o) => [nameById[o.student_id] ?? `Student #${o.student_id}`, o.outcome, o.detail]),
    );
  };

  const examSectionRef = useRef<HTMLDivElement>(null);

  const [singleStudent, setSingleStudent] = useState<StudentOption | null>(null);
  const [singleYearId, setSingleYearId] = useState('');
  const [singleReadiness, setSingleReadiness] = useState<ReadinessRow | null>(null);
  const [singleChecking, setSingleChecking] = useState(false);
  const [singlePromoting, setSinglePromoting] = useState(false);
  const [singleResult, setSingleResult] = useState<PromotionOutcome | null>(null);
  const [singleError, setSingleError] = useState<string | null>(null);

  const [bulkExamMode, setBulkExamMode] = useState(false);
  const [examStudent, setExamStudent] = useState<StudentOption | null>(null);
  const [examStreamId, setExamStreamId] = useState('');
  const [examCode, setExamCode] = useState('KJSEA');
  const [examYearId, setExamYearId] = useState('');
  const [destination, setDestination] = useState('');
  const [recordingExam, setRecordingExam] = useState(false);
  const [examMsg, setExamMsg] = useState<string | null>(null);
  const [examFailed, setExamFailed] = useState(false);

  useEffect(() => {
    if (scopeYearId) {
      setSingleYearId((prev) => prev || scopeYearId);
      setExamYearId((prev) => prev || scopeYearId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeYearId]);

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
        if (studentIds.length === 0) {
          setExamMsg('That stream has no active students.');
          setExamFailed(true);
          return;
        }
        const results = await Promise.allSettled(studentIds.map((id) =>
          api.post(`/api/promotion/national-exam/${id}/`, { exam_code: examCode, academic_year_id: examYearId, destination })
        ));
        const succeeded = results.filter((r) => r.status === 'fulfilled').length;
        const failed = results.length - succeeded;
        if (failed === 0) {
          setExamMsg(`Recorded ${examCode} for ${succeeded} student(s).`);
        } else {
          setExamMsg(`Recorded ${examCode} for ${succeeded} of ${results.length} student(s) — ${failed} failed.`);
          setExamFailed(true);
        }
      } else {
        if (!examStudent) return;
        await api.post(`/api/promotion/national-exam/${examStudent.id}/`, { exam_code: examCode, academic_year_id: examYearId, destination });
        setExamMsg('Exam record saved.');
      }
      await fetchPrerequisites(scopeYearId, scopeGradeId);
    } catch (err: any) {
      setExamMsg(err.response?.data?.error || 'Failed to save exam record(s).');
      setExamFailed(true);
    } finally {
      setRecordingExam(false);
    }
  };

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
        <CardHeader
          title="Working Scope"
          subheader="Every step below applies to this academic year (and grade, if narrowed) until you change it."
        />
        <CardContent>
          <Stack direction="row" spacing={2}>
            <TextField
              select label="Academic Year" value={scopeYearId}
              onChange={(e) => setScopeYearId(e.target.value)}
              size="small" sx={{ minWidth: 160 }}
            >
              {academicYears.map((y) => <MenuItem key={y.id} value={y.id}>{y.year}</MenuItem>)}
            </TextField>
            <TextField
              select label="Grade (optional — whole school if blank)" value={scopeGradeId}
              onChange={(e) => setScopeGradeId(e.target.value)}
              size="small" sx={{ minWidth: 220 }}
            >
              <MenuItem value="">Whole school</MenuItem>
              {grades.map((g) => <MenuItem key={g.id} value={g.id}>{g.grade_name}</MenuItem>)}
            </TextField>
          </Stack>
        </CardContent>
      </Card>

      <ProcessStepCard
        step={1}
        title="Requirements"
        subheader="What must be true before this scope can be checked for readiness."
        locked={false}
      >
        {!scopeYearId && <Alert severity="info">Select an academic year above to see requirements.</Alert>}
        {prereqLoading && <CircularProgress size={20} />}
        {prereqError && <Alert severity="error">{prereqError}</Alert>}
        {prerequisites && noStudentsInScope && <Alert severity="info">No enrolled students in this scope.</Alert>}
        {prerequisites && prerequisites.requirement_groups.length > 0 && (
          <Stack spacing={2}>
            {prerequisites.requirement_groups.map((group) => (
              <Box key={`${group.transition_type}-${group.exam_code ?? 'none'}`}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
                  {group.satisfied
                    ? <Chip size="small" color="success" label="Satisfied" />
                    : <Chip size="small" color="warning" label="Not yet" />}
                  <Typography variant="body2" fontWeight={600}>{group.requirement}</Typography>
                  <Typography variant="caption" color="text.secondary">({group.grade_names.join(', ')})</Typography>
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ ml: 0.5, mb: 1 }}>{group.detail}</Typography>
                {group.terms && (
                  <Table size="small">
                    <TableBody>
                      {group.terms.map((term) => (
                        <TableRow key={term.id}>
                          <TableCell>{term.name}</TableCell>
                          <TableCell>
                            {term.results_finalized
                              ? <Chip size="small" color="success" label="Finalized" />
                              : <Chip size="small" variant="outlined" label="Not finalized" />}
                          </TableCell>
                          <TableCell align="right">
                            <Button
                              size="small"
                              variant={term.results_finalized ? 'outlined' : 'contained'}
                              disabled={finalizingTermId === term.id}
                              onClick={() => handleFinalizeTerm(term.id, !term.results_finalized)}
                            >
                              {finalizingTermId === term.id
                                ? <CircularProgress size={16} />
                                : term.results_finalized ? 'Un-finalize' : 'Finalize'}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
                {!group.terms && !group.satisfied && (
                  <Button
                    size="small" variant="outlined"
                    onClick={() => examSectionRef.current?.scrollIntoView({ behavior: 'smooth' })}
                  >
                    Go to National Exam Recording
                  </Button>
                )}
              </Box>
            ))}
          </Stack>
        )}
      </ProcessStepCard>

      <ProcessStepCard
        step={2}
        title="Check Readiness"
        subheader="Confirms exactly who's ready before anything is run."
        locked={step2Locked}
        lockedReason={step2LockedReason}
      >
        <Stack spacing={2}>
          <Box>
            <Button variant="outlined" disabled={checkingReadiness} onClick={handleCheckReadiness}>
              {checkingReadiness ? <CircularProgress size={20} /> : 'Check Readiness'}
            </Button>
          </Box>
          {readinessError && <Alert severity="error">{readinessError}</Alert>}
          {readiness && (
            <>
              <Stack direction="row" spacing={1}>
                <Chip color="success" label={`${readiness.summary.ready} ready`} />
                {Object.entries(readiness.summary.by_reason).map(([reason, count]) => (
                  <Chip key={reason} color="warning" label={`${count} blocked: ${reason}`} />
                ))}
              </Stack>
              <ReadinessTable rows={readiness.students} onExport={exportReadinessCsv} />
            </>
          )}
        </Stack>
      </ProcessStepCard>

      <ProcessStepCard
        step={3}
        title="Run Promotion"
        subheader="Promotes every ready student in this scope. Held students are skipped, never force-promoted."
        locked={step3Locked}
        lockedReason={step3LockedReason}
      >
        <Stack spacing={2}>
          <Box>
            <Button variant="contained" color="primary" disabled={promoting} onClick={() => setConfirmOpen(true)}>
              {promoting ? <CircularProgress size={20} /> : 'Run Promotion'}
            </Button>
          </Box>
          {promoteError && <Alert severity="error">{promoteError}</Alert>}
          {promoteResult && (
            <>
              <Alert severity="success" icon={<CheckCircle2 size={20} />}>
                <Typography variant="body2">{promoteResult.message}</Typography>
              </Alert>
              <ReadinessTable rows={promoteResult.outcomes} nameById={nameById} onExport={exportOutcomeCsv} />
            </>
          )}
        </Stack>
      </ProcessStepCard>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>Confirm Promotion Run</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This will promote {readiness?.summary.ready ?? 0} student(s)
            {readiness && readiness.summary.blocked > 0 ? ` and skip ${readiness.summary.blocked} held student(s)` : ''}
            {' '}for {academicYears.find((y) => String(y.id) === scopeYearId)?.year ?? 'the selected year'}.
            This cannot be undone from this panel. Continue?
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
          <Button variant="contained" color="primary" onClick={() => { setConfirmOpen(false); handlePromote(); }}>
            Run Promotion
          </Button>
        </DialogActions>
      </Dialog>

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
    </Stack>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
cd frontend && npx tsc -b --noEmit 2>&1 | grep -iE "PromotionPanel|ProcessStepCard"
```

Expected: no output.

- [ ] **Step 4: Manual QA** (no frontend test suite exists in this repo — this is the verification step)

Start the frontend dev server and the backend, log in as an admin, and walk through:
1. Selecting an academic year with an unfinalized term and a plain-transition grade in scope → Step 1 shows "Not yet" with the real term list and a "Finalize" button; clicking it flips the term to finalized and the checklist updates live without a page reload.
2. Once all Step 1 groups show "Satisfied", Step 2 unlocks (no longer dimmed, no lock `Alert`).
3. Running "Check Readiness" populates the table with a "Transition" column showing `→ <next grade>` or `Graduates (<exam code>)`.
4. With zero ready students, Step 3 stays locked even though Step 2 has run.
5. With at least one ready student, clicking "Run Promotion" opens the confirmation dialog with the correct counts before anything happens; Cancel does nothing; confirming runs the existing bulk-promote flow.
6. The "Export CSV" button on both the readiness table and the outcome table downloads a well-formed `.csv` file.
7. Selecting an exam-gated grade with some but not all students recorded shows the "Go to National Exam Recording" button in Step 1, and clicking it scrolls to that section.
8. Switching the Working Scope's grade dropdown resets Step 2/3 state (no stale readiness/outcome data shown for the old scope).

Report the outcome of this manual pass explicitly — do not claim this task complete without having actually run it.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/results/PromotionPanel.tsx
git commit -m "feat(promotion): restructure PromotionPanel into a gated, scoped process"
```

## Plan Self-Review Notes

- **Spec coverage:** Working Scope selector (Task 4), Step 1 Requirements checklist replacing the standalone Finalize Term card (Task 4, backed by Task 1's endpoint), Step 2 gated Check Readiness with Current→Next column (Task 4, backed by Task 2's fields), Step 3 gated Run Promotion with confirmation dialog (Task 4), CSV export on both tables (Task 4), `ProcessStepCard` shared component (Task 3) — all spec sections have a task. The spec's explicit non-goals (no changes to `_readiness_for_student`/`_determine_transition`/`_promote_student`/`PromoteStudentsAPIView`/`RecordNationalExamAPIView`/`FinalizeTermAPIView` internals, no audit-log feed, no scheduler) are respected — Task 2 only adds two keys to an already-fully-computed dict, and Task 1 is a new, separate, read-only view.
- **Type consistency:** `RequirementGroup`/`PrerequisitesResponse`/`TermStatus` (Task 4) match the exact JSON shape `PromotionPrerequisitesAPIView` (Task 1) returns. `ReadinessRow`'s new `next_grade_name`/`exam_code` fields (Task 4) match the two keys added in Task 2. `ProcessStepCardProps` (Task 3) matches how Task 4 calls `<ProcessStepCard step={...} title={...} subheader={...} locked={...} lockedReason={...}>`.
