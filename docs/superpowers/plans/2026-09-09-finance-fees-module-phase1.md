# Finance — Fees Module (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current finance stub (`apps/finance/`, one read-only endpoint over `StudentExtra.fee`/`TeacherExtra.salary`) with a real, persisted student-fees ledger: configurable fee structures with optional items, audited adjustments/scholarships, sequential invoices and payments with formal PDF documents, a per-student running-balance ledger, a real fee-clearance gate wired into report-card release and student promotion, super-admin-only hard delete, full audit logging, and the admin/parent-facing frontend to drive it.

**Architecture:** Everything lives in `apps/finance/` (already scaffolded, already in `INSTALLED_APPS`). Models split by concern (`models_shared.py`, `models_fees.py`); business logic in `services_shared.py`/`services_fees.py`/`services_documents.py`/`services_reports.py`; views stay thin (`views_fees.py`) and call services. Bulk invoice generation is a Celery task in `orchestration/tasks.py` (the existing composition root) routed to the `bulk_ops` queue via the existing `dispatch_background_job` helper. Every ledger-affecting write happens inside one `transaction.atomic()` block that also writes the audit log row, so a write and its audit trail can never diverge.

**Tech Stack:** Django 6 / DRF, Celery (`bulk_ops` queue), Postgres, WeasyPrint (new dependency, for PDF generation), React 19 / TS / MUI (frontend, admin dashboard convention).

**Spec:** `docs/superpowers/specs/2026-09-09-finance-subsystem-design.md`

## Global Constraints

- Money is whole-KES `IntegerField`/`PositiveIntegerField` (no decimal subunits) — matches the existing convention on `StudentExtra.fee`/`TeacherExtra.salary`. Signed `IntegerField` only where a value can legitimately be negative (ledger entry amounts, adjustment amounts).
- **Never run `makemigrations`/`migrate`.** Each task that changes models ends with the exact migration commands the user must run themselves — do not run them, do not claim they were run.
- **No edit, no delete UI, ever, for financial records.** `Invoice`/`Payment` are immutable after creation except for status transitions and the `voided_*` fields — enforced at the model/service layer, not just hidden in the frontend. The only user-facing destructive-looking action is "Void", which requires a reason and never removes the row.
- **Hard delete is Django-admin-only**, gated on `request.user.is_superuser` (Django's real superuser flag — there is no separate "SUPER_ADMIN" RBAC tier in this codebase, so this is the correct, already-existing mechanism) AND the target record must already be voided. It is never exposed as an API action reachable from the Finance Hub UI.
- **Every financial write's audit log entry is written inside the same `transaction.atomic()` block as the write itself**, via the existing `apps.core.services.write_audit_log()` / `SystemAuditLog`. `module='finance'` on every call. No new audit infrastructure.
- FK references to models in other apps use app-label-qualified strings (`'academics.GradeLevel'`, `'academics.ExamTerm'`, `'identity.StudentExtra'`), per this repo's established modular-monolith convention — never a cross-app Python import of a model class.
- Concurrent ledger-affecting writes for the same student are serialized with `select_for_update()` on that student's `StudentExtra` row inside `transaction.atomic()`.
- Tests use plain Django `TestCase` with `RequestFactory`/`APIRequestFactory` calling `View.as_view()(request)` directly (request.user set manually) — **not** pytest, **not** DRF `APIClient` with session login. This matches every existing test in `school/tests/`. New test files live under `apps/finance/tests/`.
- WeasyPrint is a new dependency — add it to `requirements.txt` in the relevant task, but do not run `pip install` yourself; the user installs dependencies themselves.
- RBAC permissions are seeded via `python manage.py seed_rbac` (a management command, not a migration) — add new permission codes to the existing `PERMISSIONS` list in `school/management/commands/seed_rbac.py`; the user re-runs the command themselves.

---

## File Structure

```
apps/finance/
  models_shared.py        CashAccount, DocumentSequenceCounter, ImmutableFinancialRecordMixin,
                           FinancialRecordImmutableError
  models_fees.py           FeeCategory, FeeStructure, FeeStructureItem, StudentFeeItemEnrollment,
                           StudentFeeAdjustment, Invoice, InvoiceLineItem, Payment, Receipt,
                           StudentFeeLedgerEntry
  services_shared.py       next_document_number()
  services_fees.py         post_ledger_entry, generate_invoice_for_student,
                           generate_invoices_for_structure, record_payment, void_invoice,
                           void_payment, create_adjustment, is_fees_clear (real impl, replaces stub),
                           hard_delete_financial_record
  services_documents.py    render_invoice_pdf, render_receipt_pdf
  services_reports.py      fee KPI / trend / category-breakdown / aging queries
  serializers_fees.py
  views_fees.py
  urls.py                  (extend existing file)
  admin.py                 (extend existing file)
  tests/
    __init__.py
    test_models_shared.py
    test_ledger.py
    test_invoicing.py
    test_payments.py
    test_void_and_immutability.py
    test_fee_clearance.py
    test_hard_delete.py
    test_views_fees.py
    test_reports.py
orchestration/tasks.py               + generate_invoices_for_structure_task (bulk_ops queue)
apps/core/models.py                  + HARD_DELETE action choice (migration noted, not run)
school/management/commands/seed_rbac.py   + finance.* permission codes, Finance Officer role
school/views/results_views.py        + fee-clearance check in StudentReportCardAPIView.get()
school/views/promotion_views.py      + fee-clearance check in _promote_student()
requirements.txt                     + weasyprint
frontend/src/libs/financeApi.ts      new — typed API client for fee endpoints
frontend/src/components/Finance/FeeStructuresPage.tsx    new
frontend/src/components/Finance/InvoicesPage.tsx         new
frontend/src/components/Finance/PaymentsPage.tsx         new
frontend/src/components/Finance/StudentFeeStatementPage.tsx  new
frontend/src/components/Finance/FinanceHub.tsx           modified (fees tab -&gt; real ledger balance)
frontend/src/components/action routes/ManageEnrollments.tsx  modified (real fee_balance)
frontend/src/App.tsx                 modified (register new routes)
```

---

### Task 1: Shared models — immutability mixin, document numbering, CashAccount

**Files:**
- Create: `apps/finance/models_shared.py`
- Create: `apps/finance/services_shared.py`
- Modify: `apps/finance/admin.py`
- Test: `apps/finance/tests/__init__.py` (empty), `apps/finance/tests/test_models_shared.py`

**Interfaces:**
- Produces: `ImmutableFinancialRecordMixin` (abstract model, `PROTECTED_FIELDS: tuple[str, ...] = ()` class attr, overridden `save()`), `FinancialRecordImmutableError(Exception)`, `CashAccount` model, `DocumentSequenceCounter` model, `next_document_number(document_type: str, year: int | None = None) -> str` in `services_shared.py`.

- [ ] **Step 1: Write the failing tests**

```python
# apps/finance/tests/test_models_shared.py
from django.test import TestCase
from apps.finance.models_shared import (
    CashAccount, DocumentSequenceCounter, ImmutableFinancialRecordMixin,
    FinancialRecordImmutableError,
)
from apps.finance.services_shared import next_document_number
from django.db import models


class _DummyImmutable(ImmutableFinancialRecordMixin, models.Model):
    """Test-only concrete model to exercise the mixin without touching real finance models."""
    amount = models.IntegerField()
    note = models.CharField(max_length=50, default='')
    PROTECTED_FIELDS = ('amount',)

    class Meta:
        app_label = 'finance'


class ImmutableFinancialRecordMixinTests(TestCase):
    def test_protected_field_cannot_change_after_creation(self):
        obj = _DummyImmutable.objects.create(amount=100)
        obj.amount = 200
        with self.assertRaises(FinancialRecordImmutableError):
            obj.save()

    def test_unprotected_field_can_change_after_creation(self):
        obj = _DummyImmutable.objects.create(amount=100)
        obj.note = 'updated'
        obj.save()
        obj.refresh_from_db()
        self.assertEqual(obj.note, 'updated')

    def test_protected_field_is_free_to_set_on_creation(self):
        obj = _DummyImmutable.objects.create(amount=100)
        self.assertEqual(obj.amount, 100)


class NextDocumentNumberTests(TestCase):
    def test_first_number_for_a_type_and_year_is_one(self):
        number = next_document_number('INV', year=2026)
        self.assertEqual(number, 'INV-2026-000001')

    def test_numbers_increment_and_never_collide(self):
        first = next_document_number('INV', year=2026)
        second = next_document_number('INV', year=2026)
        self.assertNotEqual(first, second)
        self.assertEqual(second, 'INV-2026-000002')

    def test_different_document_types_have_independent_sequences(self):
        next_document_number('INV', year=2026)
        receipt_number = next_document_number('RCPT', year=2026)
        self.assertEqual(receipt_number, 'RCPT-2026-000001')

    def test_different_years_have_independent_sequences(self):
        next_document_number('INV', year=2026)
        number_2027 = next_document_number('INV', year=2027)
        self.assertEqual(number_2027, 'INV-2027-000001')


class CashAccountTests(TestCase):
    def test_can_create_cash_account(self):
        account = CashAccount.objects.create(name='Main Bank Account', account_type='bank')
        self.assertEqual(str(account), 'Main Bank Account')
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python manage.py test apps.finance.tests.test_models_shared -v 2`
Expected: FAIL — `ModuleNotFoundError: No module named 'apps.finance.models_shared'`

- [ ] **Step 3: Implement `apps/finance/models_shared.py`**

```python
"""Shared building blocks for the finance app: the immutability guard every
financial record uses, and the physical cash/bank accounts payments and GL
entries can reference. Kept separate from models_fees.py because
models_payroll.py and models_gl.py (later phases) both need these too."""
from django.db import models


class FinancialRecordImmutableError(Exception):
    """Raised when code tries to change a protected field on an already-created
    financial record. Correcting a mistake means voiding the record and creating
    a new one — see the Finance Subsystem Design spec, section 4.5."""


class ImmutableFinancialRecordMixin(models.Model):
    """Abstract base that blocks edits to a subclass's PROTECTED_FIELDS once the
    row already has a primary key. Status fields and void_* fields are deliberately
    left out of PROTECTED_FIELDS by each subclass, since those ARE allowed to change
    (a status transition, or voiding). This is a backend-layer guarantee — it runs
    regardless of what the frontend sends."""
    PROTECTED_FIELDS: tuple = ()

    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        if self.pk is not None and self.PROTECTED_FIELDS:
            db_row = type(self).objects.filter(pk=self.pk).values(*self.PROTECTED_FIELDS).first()
            if db_row is not None:
                for field_name in self.PROTECTED_FIELDS:
                    if getattr(self, field_name) != db_row[field_name]:
                        raise FinancialRecordImmutableError(
                            f"{type(self).__name__}.{field_name} cannot be changed after "
                            f"creation (record pk={self.pk}). Void this record and create "
                            f"a new one instead."
                        )
        super().save(*args, **kwargs)


class CashAccount(models.Model):
    """Where money physically sits. Seeded with a small default set (see the
    seed_finance_cash_accounts management command in a later task) even without
    detailed requirements yet — Payment and (in a later phase) GeneralLedgerEntry
    both reference it optionally."""
    ACCOUNT_TYPE_CHOICES = [
        ('bank', 'Bank Account'),
        ('petty_cash', 'Petty Cash'),
        ('mobile_money', 'Mobile Money'),
    ]
    name = models.CharField(max_length=100, unique=True)
    account_type = models.CharField(max_length=20, choices=ACCOUNT_TYPE_CHOICES)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = 'finance_cashaccount'

    def __str__(self):
        return self.name


class DocumentSequenceCounter(models.Model):
    """Backing store for next_document_number() in services_shared.py. One row
    per (document_type, year); last_number is incremented under select_for_update
    so concurrent requests can never generate the same number."""
    document_type = models.CharField(max_length=20)
    year = models.PositiveIntegerField()
    last_number = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = 'finance_documentsequencecounter'
        unique_together = [('document_type', 'year')]
```

- [ ] **Step 4: Implement `apps/finance/services_shared.py`**

```python
"""Cross-cutting finance services usable by every finance sub-module (fees now,
payroll/GL in later phases)."""
from django.db import transaction
from django.utils import timezone

from apps.finance.models_shared import DocumentSequenceCounter


def next_document_number(document_type: str, year: int | None = None) -> str:
    """Atomically allocate the next sequential number for a document type
    (e.g. 'INV', 'RCPT', 'PAYSLIP') in the given year, formatted as
    '{document_type}-{year}-{number:06d}'. Numbers are never reused, including
    after a document is voided — the counter only ever goes up."""
    year = year or timezone.now().year
    with transaction.atomic():
        counter, _ = DocumentSequenceCounter.objects.select_for_update().get_or_create(
            document_type=document_type, year=year,
        )
        counter.last_number += 1
        counter.save(update_fields=['last_number'])
        return f"{document_type}-{year}-{counter.last_number:06d}"
```

- [ ] **Step 5: Register `CashAccount` in `apps/finance/admin.py`**

Replace the file's current empty-stub content with:

```python
from django.contrib import admin

from apps.finance.models_shared import CashAccount


@admin.register(CashAccount)
class CashAccountAdmin(admin.ModelAdmin):
    list_display = ['name', 'account_type', 'is_active']
    list_filter = ['account_type', 'is_active']
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `python manage.py test apps.finance.tests.test_models_shared -v 2`
Expected: PASS (5 tests)

- [ ] **Step 7: State the migration the user needs to run**

```text
Migration required:
python manage.py makemigrations finance
python manage.py migrate
```

- [ ] **Step 8: Commit**

```bash
git add apps/finance/models_shared.py apps/finance/services_shared.py apps/finance/admin.py apps/finance/tests/__init__.py apps/finance/tests/test_models_shared.py
git commit -m "feat(finance): add immutability mixin, cash accounts, sequential document numbering"
```

---

### Task 2: FeeCategory (admin-editable config)

**Files:**
- Create: `apps/finance/models_fees.py` (this task adds `FeeCategory` only; later tasks extend this same file)
- Modify: `apps/finance/admin.py`
- Test: `apps/finance/tests/test_models_shared.py` -&gt; new file `apps/finance/tests/test_fee_category.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: `FeeCategory` model (`id`, `name`, `description`), importable as `from apps.finance.models_fees import FeeCategory`. Later tasks' `FeeStructureItem.category` and `StudentFeeAdjustment.category` FK to this.

- [ ] **Step 1: Write the failing test**

```python
# apps/finance/tests/test_fee_category.py
from django.db import IntegrityError
from django.test import TestCase

from apps.finance.models_fees import FeeCategory


class FeeCategoryTests(TestCase):
    def test_can_create_category(self):
        category = FeeCategory.objects.create(name='Tuition', description='Core tuition fee')
        self.assertEqual(str(category), 'Tuition')

    def test_name_must_be_unique(self):
        FeeCategory.objects.create(name='Transport')
        with self.assertRaises(IntegrityError):
            FeeCategory.objects.create(name='Transport')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python manage.py test apps.finance.tests.test_fee_category -v 2`
Expected: FAIL — `ModuleNotFoundError: No module named 'apps.finance.models_fees'`

- [ ] **Step 3: Implement `apps/finance/models_fees.py` (FeeCategory only for now)**

```python
"""Fee-domain models: categories, structures, invoicing, payments, and the
per-student ledger. See docs/superpowers/specs/2026-09-09-finance-subsystem-design.md
section 4 for the full design this file implements."""
from django.db import models


class FeeCategory(models.Model):
    """Admin-editable fee category (Tuition, Transport, Boarding, Exam, Activity,
    etc.) — a real DB table, not an enum, following this repo's DB-first config
    convention (see SubjectQuota/GradingRule). Used both as fee-structure line
    items and as a reporting dimension."""
    name = models.CharField(max_length=100, unique=True)
    description = models.CharField(max_length=255, blank=True)

    class Meta:
        db_table = 'finance_feecategory'
        verbose_name_plural = 'Fee categories'

    def __str__(self):
        return self.name
```

- [ ] **Step 4: Register in `apps/finance/admin.py`**

Add to the existing file (do not remove the `CashAccountAdmin` registration from Task 1):

```python
from apps.finance.models_fees import FeeCategory


@admin.register(FeeCategory)
class FeeCategoryAdmin(admin.ModelAdmin):
    list_display = ['name', 'description']
    search_fields = ['name']
```

- [ ] **Step 5: Run test to verify it passes**

Run: `python manage.py test apps.finance.tests.test_fee_category -v 2`
Expected: PASS (2 tests)

- [ ] **Step 6: State the migration**

```text
Migration required:
python manage.py makemigrations finance
python manage.py migrate
```

- [ ] **Step 7: Commit**

```bash
git add apps/finance/models_fees.py apps/finance/admin.py apps/finance/tests/test_fee_category.py
git commit -m "feat(finance): add FeeCategory config model"
```

---

### Task 3: Fee structures — FeeStructure, FeeStructureItem, StudentFeeItemEnrollment

**Files:**
- Modify: `apps/finance/models_fees.py`
- Modify: `apps/finance/admin.py`
- Test: `apps/finance/tests/test_fee_structures.py`

**Interfaces:**
- Consumes: `FeeCategory` (Task 2).
- Produces: `FeeStructure` (`grade_level`, `term`, `name`, `status`), `FeeStructureItem` (`fee_structure`, `category`, `amount`, `is_optional`), `StudentFeeItemEnrollment` (`student`, `fee_structure_item`). Later tasks (invoice generation) query these directly.

- [ ] **Step 1: Write the failing tests**

```python
# apps/finance/tests/test_fee_structures.py
from django.contrib.auth.models import User
from django.db import IntegrityError
from django.test import TestCase

from apps.academics.models import AcademicYear, ExamTerm, GradeLevel, Curriculum, Tier
from apps.identity.models import StudentExtra
from apps.finance.models_fees import FeeCategory, FeeStructure, FeeStructureItem, StudentFeeItemEnrollment


class FeeStructureTestData:
    """Shared setup — minimal real objects for the academics FKs FeeStructure needs."""

    @classmethod
    def setUpTestData(cls):
        cls.curriculum = Curriculum.objects.create(name='CBC')
        cls.tier = Tier.objects.create(name='Junior School', curriculum=cls.curriculum)
        cls.grade = GradeLevel.objects.create(
            name='Grade 7', numeric_order=7, curriculum_type='CBC',
            curriculum=cls.curriculum, tier=cls.tier,
        )
        cls.year = AcademicYear.objects.create(year='2026', is_active=True)
        cls.term = ExamTerm.objects.create(
            name='Term 2', academic_year=cls.year,
            start_date='2026-05-01', end_date='2026-08-01',
        )
        cls.tuition = FeeCategory.objects.create(name='Tuition')
        cls.transport = FeeCategory.objects.create(name='Transport')


class FeeStructureTests(FeeStructureTestData, TestCase):
    def test_can_create_structure_for_grade_and_term(self):
        structure = FeeStructure.objects.create(
            grade_level=self.grade, term=self.term, name='Grade 7 - Term 2 2026',
        )
        self.assertEqual(structure.status, 'draft')

    def test_only_one_structure_per_grade_and_term(self):
        FeeStructure.objects.create(grade_level=self.grade, term=self.term, name='First')
        with self.assertRaises(IntegrityError):
            FeeStructure.objects.create(grade_level=self.grade, term=self.term, name='Duplicate')


class FeeStructureItemTests(FeeStructureTestData, TestCase):
    def setUp(self):
        self.structure = FeeStructure.objects.create(
            grade_level=self.grade, term=self.term, name='Grade 7 - Term 2 2026',
        )

    def test_mandatory_item_defaults_not_optional(self):
        item = FeeStructureItem.objects.create(
            fee_structure=self.structure, category=self.tuition, amount=15000,
        )
        self.assertFalse(item.is_optional)

    def test_optional_item_flag(self):
        item = FeeStructureItem.objects.create(
            fee_structure=self.structure, category=self.transport, amount=3000, is_optional=True,
        )
        self.assertTrue(item.is_optional)


class StudentFeeItemEnrollmentTests(FeeStructureTestData, TestCase):
    def setUp(self):
        self.structure = FeeStructure.objects.create(
            grade_level=self.grade, term=self.term, name='Grade 7 - Term 2 2026',
        )
        self.transport_item = FeeStructureItem.objects.create(
            fee_structure=self.structure, category=self.transport, amount=3000, is_optional=True,
        )
        user = User.objects.create_user(username='student_a', password='x')
        self.student = StudentExtra.objects.create(user=user)

    def test_can_enroll_student_in_optional_item(self):
        enrollment = StudentFeeItemEnrollment.objects.create(
            student=self.student, fee_structure_item=self.transport_item,
        )
        self.assertEqual(enrollment.student, self.student)

    def test_duplicate_enrollment_rejected(self):
        StudentFeeItemEnrollment.objects.create(
            student=self.student, fee_structure_item=self.transport_item,
        )
        with self.assertRaises(IntegrityError):
            StudentFeeItemEnrollment.objects.create(
                student=self.student, fee_structure_item=self.transport_item,
            )
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python manage.py test apps.finance.tests.test_fee_structures -v 2`
Expected: FAIL — `ImportError: cannot import name 'FeeStructure' from 'apps.finance.models_fees'`

- [ ] **Step 3: Append to `apps/finance/models_fees.py`**

```python
class FeeStructure(models.Model):
    """One per (grade, term) — a named template ('Grade 7 - Term 2 2026'). The
    unique_together below is the DB-enforced version of the spec's business rule
    'only one structure per grade/term'."""
    STATUS_CHOICES = [('draft', 'Draft'), ('active', 'Active')]

    grade_level = models.ForeignKey('academics.GradeLevel', on_delete=models.PROTECT, related_name='fee_structures')
    term = models.ForeignKey('academics.ExamTerm', on_delete=models.PROTECT, related_name='fee_structures')
    name = models.CharField(max_length=150)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='draft')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'finance_feestructure'
        unique_together = [('grade_level', 'term')]

    def __str__(self):
        return self.name


class FeeStructureItem(models.Model):
    """One line item on a FeeStructure. Mandatory items (is_optional=False) apply
    to every student in the grade automatically when invoices are generated;
    optional items only apply to students with a StudentFeeItemEnrollment row."""
    fee_structure = models.ForeignKey(FeeStructure, on_delete=models.CASCADE, related_name='items')
    category = models.ForeignKey(FeeCategory, on_delete=models.PROTECT, related_name='structure_items')
    amount = models.PositiveIntegerField()
    is_optional = models.BooleanField(default=False)

    class Meta:
        db_table = 'finance_feestructureitem'
        unique_together = [('fee_structure', 'category')]

    def __str__(self):
        return f"{self.fee_structure.name} - {self.category.name}: {self.amount}"


class StudentFeeItemEnrollment(models.Model):
    """The opt-in roster for optional FeeStructureItems — e.g. which students are
    enrolled in 'Transport' this term. Admin manages this as a checklist per
    optional item. A duplicate enrollment for the same (student, item) is a
    data-entry mistake, blocked at the DB level."""
    student = models.ForeignKey('identity.StudentExtra', on_delete=models.CASCADE, related_name='fee_item_enrollments')
    fee_structure_item = models.ForeignKey(FeeStructureItem, on_delete=models.CASCADE, related_name='enrollments')
    enrolled_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'finance_studentfeeitemenrollment'
        unique_together = [('student', 'fee_structure_item')]
```

- [ ] **Step 4: Append to `apps/finance/admin.py`**

```python
from apps.finance.models_fees import FeeStructure, FeeStructureItem, StudentFeeItemEnrollment


class FeeStructureItemInline(admin.TabularInline):
    model = FeeStructureItem
    extra = 1


@admin.register(FeeStructure)
class FeeStructureAdmin(admin.ModelAdmin):
    list_display = ['name', 'grade_level', 'term', 'status']
    list_filter = ['status', 'grade_level', 'term']
    inlines = [FeeStructureItemInline]


@admin.register(StudentFeeItemEnrollment)
class StudentFeeItemEnrollmentAdmin(admin.ModelAdmin):
    list_display = ['student', 'fee_structure_item', 'enrolled_at']
    list_filter = ['fee_structure_item__fee_structure']
    autocomplete_fields = ['student']
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `python manage.py test apps.finance.tests.test_fee_structures -v 2`
Expected: PASS (6 tests)

- [ ] **Step 6: State the migration**

```text
Migration required:
python manage.py makemigrations finance
python manage.py migrate
```

- [ ] **Step 7: Commit**

```bash
git add apps/finance/models_fees.py apps/finance/admin.py apps/finance/tests/test_fee_structures.py
git commit -m "feat(finance): add FeeStructure, FeeStructureItem, StudentFeeItemEnrollment"
```

---

### Task 4: StudentFeeLedgerEntry + post_ledger_entry (the ledger core)

This is the single most important piece of the module — every other financial
event (invoice, payment, adjustment) posts through this one function, and this
is where concurrent-payment correctness is enforced.

**Files:**
- Modify: `apps/finance/models_fees.py`
- Create: `apps/finance/services_fees.py`
- Modify: `apps/finance/admin.py`
- Test: `apps/finance/tests/test_ledger.py`

**Interfaces:**
- Consumes: `next_document_number` is NOT used here (no numbering on ledger entries).
- Produces: `StudentFeeLedgerEntry` model. `post_ledger_entry(*, student, entry_type, amount, reference, description, date=None) -> StudentFeeLedgerEntry` in `services_fees.py` — every later task (invoicing, payments, adjustments, void) calls this exact function with this exact signature. `entry_type` is one of `'charge'`, `'payment'`, `'adjustment'`. Sign convention: charges are positive (increase balance owed), payments and reductions are negative (decrease balance owed) — callers pass the signed amount, this function does not flip signs itself.

- [ ] **Step 1: Write the failing tests**

```python
# apps/finance/tests/test_ledger.py
import threading

from django.contrib.auth.models import User
from django.test import TestCase, TransactionTestCase

from apps.identity.models import StudentExtra
from apps.finance.models_fees import StudentFeeLedgerEntry, FeeCategory
from apps.finance.services_fees import post_ledger_entry


class LedgerTestData:
    @classmethod
    def _make_student(cls, username):
        user = User.objects.create_user(username=username, password='x')
        return StudentExtra.objects.create(user=user)


class PostLedgerEntryTests(LedgerTestData, TestCase):
    def setUp(self):
        self.student = self._make_student('ledger_student_a')
        self.category = FeeCategory.objects.create(name='Tuition')

    def test_first_charge_sets_running_balance_to_charge_amount(self):
        entry = post_ledger_entry(
            student=self.student, entry_type='charge', amount=15000,
            reference=self.category, description='Test charge',
        )
        self.assertEqual(entry.running_balance, 15000)

    def test_payment_reduces_running_balance(self):
        post_ledger_entry(
            student=self.student, entry_type='charge', amount=15000,
            reference=self.category, description='Charge',
        )
        payment_entry = post_ledger_entry(
            student=self.student, entry_type='payment', amount=-5000,
            reference=self.category, description='Payment',
        )
        self.assertEqual(payment_entry.running_balance, 10000)

    def test_entries_are_ordered_and_immutable_history(self):
        post_ledger_entry(student=self.student, entry_type='charge', amount=1000, reference=self.category, description='a')
        post_ledger_entry(student=self.student, entry_type='charge', amount=2000, reference=self.category, description='b')
        balances = list(
            StudentFeeLedgerEntry.objects.filter(student=self.student).order_by('id').values_list('running_balance', flat=True)
        )
        self.assertEqual(balances, [1000, 3000])

    def test_different_students_have_independent_balances(self):
        other_student = self._make_student('ledger_student_b')
        post_ledger_entry(student=self.student, entry_type='charge', amount=5000, reference=self.category, description='a')
        entry = post_ledger_entry(student=other_student, entry_type='charge', amount=9000, reference=self.category, description='b')
        self.assertEqual(entry.running_balance, 9000)


class ConcurrentPaymentTests(LedgerTestData, TransactionTestCase):
    """TransactionTestCase (not TestCase) is required here — select_for_update()
    row locking only takes effect against real, committed transactions running
    in separate threads; TestCase wraps each test in one outer transaction that
    would hide any race."""

    def test_concurrent_postings_never_lose_an_update(self):
        student = self._make_student('ledger_concurrent_student')
        category = FeeCategory.objects.create(name='Tuition')
        post_ledger_entry(student=student, entry_type='charge', amount=100000, reference=category, description='opening charge')

        errors = []

        def make_payment():
            try:
                post_ledger_entry(student=student, entry_type='payment', amount=-1000, reference=category, description='concurrent payment')
            except Exception as exc:  # noqa: BLE001 - surfaced via `errors` below
                errors.append(exc)

        threads = [threading.Thread(target=make_payment) for _ in range(10)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        self.assertEqual(errors, [])
        final_entry = StudentFeeLedgerEntry.objects.filter(student=student).order_by('-id').first()
        self.assertEqual(final_entry.running_balance, 100000 - 10 * 1000)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python manage.py test apps.finance.tests.test_ledger -v 2`
Expected: FAIL — `ImportError: cannot import name 'StudentFeeLedgerEntry'`

- [ ] **Step 3: Append `StudentFeeLedgerEntry` to `apps/finance/models_fees.py`**

```python
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType


class StudentFeeLedgerEntry(models.Model):
    """The authoritative record of what a student currently owes — a real
    subsidiary accounts-receivable ledger, one per student (spec section 4.6).
    Never write to this table directly; always go through
    services_fees.post_ledger_entry(), which is the only thing that computes
    running_balance correctly under concurrent writes."""
    ENTRY_TYPE_CHOICES = [
        ('charge', 'Charge'),
        ('payment', 'Payment'),
        ('adjustment', 'Adjustment'),
    ]
    student = models.ForeignKey('identity.StudentExtra', on_delete=models.PROTECT, related_name='fee_ledger_entries')
    entry_type = models.CharField(max_length=10, choices=ENTRY_TYPE_CHOICES)
    amount = models.IntegerField(help_text='Signed: positive increases the balance owed, negative decreases it.')
    running_balance = models.IntegerField()
    content_type = models.ForeignKey(ContentType, on_delete=models.PROTECT)
    object_id = models.PositiveIntegerField()
    reference = GenericForeignKey('content_type', 'object_id')
    description = models.CharField(max_length=255)
    date = models.DateField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'finance_studentfeeledgerentry'
        indexes = [models.Index(fields=['student', 'date'])]
        ordering = ['id']

    def __str__(self):
        return f"{self.student} {self.entry_type} {self.amount} (bal {self.running_balance})"
```

- [ ] **Step 4: Create `apps/finance/services_fees.py` with `post_ledger_entry`**

```python
"""Fee-domain business logic. Every function here that touches the ledger runs
inside transaction.atomic() and locks the affected student's StudentExtra row
with select_for_update() first, per the Finance Subsystem Design spec section 11."""
from django.db import transaction
from django.utils import timezone

from apps.finance.models_fees import StudentFeeLedgerEntry
from apps.identity.models import StudentExtra


def post_ledger_entry(*, student, entry_type, amount, reference, description, date=None):
    """Write one row to a student's fee ledger and return it. `amount` must
    already be signed correctly by the caller (charges positive, payments and
    reductions negative) — this function does not infer sign from entry_type.
    Locks the student's StudentExtra row for the duration of the transaction so
    two concurrent postings for the same student can never read the same
    "previous balance" and silently lose one of the updates."""
    with transaction.atomic():
        locked_student = StudentExtra.objects.select_for_update().get(pk=student.pk)
        last_entry = (
            StudentFeeLedgerEntry.objects.filter(student=locked_student).order_by('-id').first()
        )
        previous_balance = last_entry.running_balance if last_entry else 0
        return StudentFeeLedgerEntry.objects.create(
            student=locked_student,
            entry_type=entry_type,
            amount=amount,
            running_balance=previous_balance + amount,
            reference=reference,
            description=description,
            date=date or timezone.now().date(),
        )
```

- [ ] **Step 5: Register in `apps/finance/admin.py`**

```python
from apps.finance.models_fees import StudentFeeLedgerEntry


@admin.register(StudentFeeLedgerEntry)
class StudentFeeLedgerEntryAdmin(admin.ModelAdmin):
    list_display = ['student', 'entry_type', 'amount', 'running_balance', 'date']
    list_filter = ['entry_type', 'date']
    autocomplete_fields = ['student']
    # Deliberately no add/edit/delete permissions beyond Django superuser default —
    # this table is written only through post_ledger_entry(), never through the admin form.
    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `python manage.py test apps.finance.tests.test_ledger -v 2`
Expected: PASS (5 tests)

- [ ] **Step 7: State the migration**

```text
Migration required:
python manage.py makemigrations finance
python manage.py migrate
```

- [ ] **Step 8: Commit**

```bash
git add apps/finance/models_fees.py apps/finance/services_fees.py apps/finance/admin.py apps/finance/tests/test_ledger.py
git commit -m "feat(finance): add StudentFeeLedgerEntry and the post_ledger_entry ledger core"
```

---

### Task 5: StudentFeeAdjustment — scholarships, discounts, penalties, corrections

**Files:**
- Modify: `apps/finance/models_fees.py`
- Modify: `apps/finance/services_fees.py`
- Modify: `apps/finance/admin.py`
- Test: `apps/finance/tests/test_adjustments.py`

**Interfaces:**
- Consumes: `post_ledger_entry` (Task 4), `FeeCategory` (Task 2).
- Produces: `StudentFeeAdjustment` model. `create_adjustment(*, student, adjustment_type, amount, reason, requested_by, category=None, approved_by=None) -> StudentFeeAdjustment` in `services_fees.py`.

- [ ] **Step 1: Write the failing tests**

```python
# apps/finance/tests/test_adjustments.py
from django.contrib.auth.models import User
from django.core.exceptions import ValidationError
from django.test import TestCase

from apps.identity.models import StudentExtra
from apps.finance.models_fees import StudentFeeLedgerEntry
from apps.finance.services_fees import create_adjustment


class AdjustmentTests(TestCase):
    def setUp(self):
        student_user = User.objects.create_user(username='adj_student', password='x')
        self.student = StudentExtra.objects.create(user=student_user)
        self.requester = User.objects.create_user(username='adj_requester', password='x')
        self.approver = User.objects.create_user(username='adj_approver', password='x')

    def test_positive_correction_does_not_require_approval(self):
        adjustment = create_adjustment(
            student=self.student, adjustment_type='correction', amount=500,
            reason='Data entry fix', requested_by=self.requester,
        )
        self.assertIsNone(adjustment.approved_by)
        entry = StudentFeeLedgerEntry.objects.get()
        self.assertEqual(entry.amount, 500)

    def test_negative_scholarship_requires_approval(self):
        with self.assertRaises(ValidationError):
            create_adjustment(
                student=self.student, adjustment_type='scholarship', amount=-3000,
                reason='Merit scholarship', requested_by=self.requester,
            )

    def test_negative_scholarship_with_approval_succeeds_and_posts_negative_ledger_entry(self):
        adjustment = create_adjustment(
            student=self.student, adjustment_type='scholarship', amount=-3000,
            reason='Merit scholarship', requested_by=self.requester, approved_by=self.approver,
        )
        self.assertEqual(adjustment.approved_by, self.approver)
        entry = StudentFeeLedgerEntry.objects.get()
        self.assertEqual(entry.amount, -3000)
        self.assertEqual(entry.running_balance, -3000)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python manage.py test apps.finance.tests.test_adjustments -v 2`
Expected: FAIL — `ImportError: cannot import name 'create_adjustment'`

- [ ] **Step 3: Append `StudentFeeAdjustment` to `apps/finance/models_fees.py`**

```python
class StudentFeeAdjustment(models.Model):
    """A discount, scholarship, bursary, penalty, or correction applied to a
    student's fee account — spec section 4.4. A negative/waiving amount
    (discount, scholarship, bursary) requires approved_by to be set; this is
    enforced in create_adjustment(), not here, since the model layer can't
    know who is allowed to approve."""
    ADJUSTMENT_TYPE_CHOICES = [
        ('discount', 'Discount'),
        ('scholarship', 'Scholarship'),
        ('bursary', 'Bursary'),
        ('penalty', 'Penalty'),
        ('correction', 'Correction'),
    ]
    student = models.ForeignKey('identity.StudentExtra', on_delete=models.PROTECT, related_name='fee_adjustments')
    category = models.ForeignKey(FeeCategory, on_delete=models.PROTECT, null=True, blank=True, related_name='adjustments')
    adjustment_type = models.CharField(max_length=15, choices=ADJUSTMENT_TYPE_CHOICES)
    amount = models.IntegerField(help_text='Signed: negative waives/reduces the balance, positive adds to it.')
    reason = models.TextField()
    requested_by = models.ForeignKey('auth.User', on_delete=models.PROTECT, related_name='+')
    approved_by = models.ForeignKey('auth.User', on_delete=models.PROTECT, null=True, blank=True, related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'finance_studentfeeadjustment'
```

- [ ] **Step 4: Append `create_adjustment` to `apps/finance/services_fees.py`**

```python
from django.core.exceptions import ValidationError

from apps.finance.models_fees import StudentFeeAdjustment
from apps.core.services import write_audit_log


def create_adjustment(*, student, adjustment_type, amount, reason, requested_by, category=None, approved_by=None):
    """Create a StudentFeeAdjustment and post it to the student's ledger.
    Any negative amount (a discount/scholarship/bursary that waives fees) must
    carry an approver — this is an audit requirement, not optional, per spec
    section 4.4."""
    if amount < 0 and approved_by is None:
        raise ValidationError(
            f"A negative adjustment ({adjustment_type}) of {amount} requires an approver."
        )
    with transaction.atomic():
        adjustment = StudentFeeAdjustment.objects.create(
            student=student, category=category, adjustment_type=adjustment_type,
            amount=amount, reason=reason, requested_by=requested_by, approved_by=approved_by,
        )
        post_ledger_entry(
            student=student, entry_type='adjustment', amount=amount,
            reference=adjustment, description=f"{adjustment.get_adjustment_type_display()}: {reason}",
        )
        write_audit_log(
            operator_id=requested_by.id, action_type='APPROVE' if approved_by else 'CREATE',
            module='finance',
            description=(
                f"{adjustment.get_adjustment_type_display()} of {amount} for student "
                f"{student.id}: {reason}" + (f" (approved by {approved_by.username})" if approved_by else '')
            ),
        )
        return adjustment
```

- [ ] **Step 5: Register in `apps/finance/admin.py`**

```python
from apps.finance.models_fees import StudentFeeAdjustment


@admin.register(StudentFeeAdjustment)
class StudentFeeAdjustmentAdmin(admin.ModelAdmin):
    list_display = ['student', 'adjustment_type', 'amount', 'requested_by', 'approved_by', 'created_at']
    list_filter = ['adjustment_type']
    autocomplete_fields = ['student']
    # Created only via create_adjustment() so the ledger stays in sync — no direct add/edit here.
    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `python manage.py test apps.finance.tests.test_adjustments -v 2`
Expected: PASS (3 tests)

- [ ] **Step 7: State the migration**

```text
Migration required:
python manage.py makemigrations finance
python manage.py migrate
```

- [ ] **Step 8: Commit**

```bash
git add apps/finance/models_fees.py apps/finance/services_fees.py apps/finance/admin.py apps/finance/tests/test_adjustments.py
git commit -m "feat(finance): add StudentFeeAdjustment with approval-required negative amounts"
```

---

### Task 6: Invoice + InvoiceLineItem (immutable, void-and-reissue only)

**Files:**
- Modify: `apps/finance/models_fees.py`
- Modify: `apps/finance/admin.py`
- Test: `apps/finance/tests/test_invoice_model.py`

**Interfaces:**
- Consumes: `ImmutableFinancialRecordMixin` (Task 1), `FeeStructure`/`FeeCategory` (Tasks 2-3).
- Produces: `Invoice` (`student`, `fee_structure`, `total`, `status`, `invoice_number`, `issued_at`, `voided_at`, `voided_by`, `void_reason`), `InvoiceLineItem` (`invoice`, `category`, `description`, `amount`). Task 9 (`generate_invoice_for_student`) creates these.

- [ ] **Step 1: Write the failing tests**

```python
# apps/finance/tests/test_invoice_model.py
from django.contrib.auth.models import User
from django.db import IntegrityError
from django.test import TestCase

from apps.academics.models import AcademicYear, ExamTerm, GradeLevel, Curriculum, Tier
from apps.identity.models import StudentExtra
from apps.finance.models_fees import FeeCategory, FeeStructure, Invoice, InvoiceLineItem
from apps.finance.models_shared import FinancialRecordImmutableError


class InvoiceTestData(TestCase):
    def setUp(self):
        curriculum = Curriculum.objects.create(name='CBC')
        tier = Tier.objects.create(name='Junior School', curriculum=curriculum)
        grade = GradeLevel.objects.create(name='Grade 7', numeric_order=7, curriculum_type='CBC', curriculum=curriculum, tier=tier)
        year = AcademicYear.objects.create(year='2026', is_active=True)
        term = ExamTerm.objects.create(name='Term 2', academic_year=year, start_date='2026-05-01', end_date='2026-08-01')
        self.structure = FeeStructure.objects.create(grade_level=grade, term=term, name='Grade 7 - Term 2 2026')
        self.category = FeeCategory.objects.create(name='Tuition')
        user = User.objects.create_user(username='invoice_student', password='x')
        self.student = StudentExtra.objects.create(user=user)


class InvoiceModelTests(InvoiceTestData):
    def test_can_create_invoice(self):
        invoice = Invoice.objects.create(
            student=self.student, fee_structure=self.structure, total=15000,
            invoice_number='INV-2026-000001',
        )
        self.assertEqual(invoice.status, 'unpaid')

    def test_total_cannot_be_changed_after_creation(self):
        invoice = Invoice.objects.create(
            student=self.student, fee_structure=self.structure, total=15000,
            invoice_number='INV-2026-000002',
        )
        invoice.total = 99999
        with self.assertRaises(FinancialRecordImmutableError):
            invoice.save()

    def test_status_can_be_changed_after_creation(self):
        invoice = Invoice.objects.create(
            student=self.student, fee_structure=self.structure, total=15000,
            invoice_number='INV-2026-000003',
        )
        invoice.status = 'paid'
        invoice.save()
        invoice.refresh_from_db()
        self.assertEqual(invoice.status, 'paid')

    def test_invoice_number_must_be_unique(self):
        Invoice.objects.create(student=self.student, fee_structure=self.structure, total=1000, invoice_number='INV-2026-000004')
        with self.assertRaises(IntegrityError):
            Invoice.objects.create(student=self.student, fee_structure=self.structure, total=2000, invoice_number='INV-2026-000004')

    def test_a_second_non_voided_invoice_for_same_student_and_structure_is_rejected(self):
        Invoice.objects.create(student=self.student, fee_structure=self.structure, total=1000, invoice_number='INV-2026-000005')
        with self.assertRaises(IntegrityError):
            Invoice.objects.create(student=self.student, fee_structure=self.structure, total=1000, invoice_number='INV-2026-000006')

    def test_a_replacement_invoice_is_allowed_once_the_first_is_voided(self):
        from django.utils import timezone
        first = Invoice.objects.create(student=self.student, fee_structure=self.structure, total=1000, invoice_number='INV-2026-000007')
        first.status = 'voided'
        first.voided_at = timezone.now()
        first.void_reason = 'test void'
        first.save()
        replacement = Invoice.objects.create(student=self.student, fee_structure=self.structure, total=1000, invoice_number='INV-2026-000008')
        self.assertIsNotNone(replacement.pk)


class InvoiceLineItemTests(InvoiceTestData):
    def test_can_add_line_item(self):
        invoice = Invoice.objects.create(student=self.student, fee_structure=self.structure, total=15000, invoice_number='INV-2026-000009')
        line = InvoiceLineItem.objects.create(invoice=invoice, category=self.category, description='Tuition', amount=15000)
        self.assertEqual(line.invoice, invoice)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python manage.py test apps.finance.tests.test_invoice_model -v 2`
Expected: FAIL — `ImportError: cannot import name 'Invoice'`

- [ ] **Step 3: Append `Invoice` and `InvoiceLineItem` to `apps/finance/models_fees.py`**

Add the import at the top of the file alongside the existing ones:

```python
from apps.finance.models_shared import ImmutableFinancialRecordMixin
```

Then append:

```python
class Invoice(ImmutableFinancialRecordMixin, models.Model):
    """A formal, sequentially-numbered bill to a student for one FeeStructure,
    snapshotting its line items at generation time (see InvoiceLineItem below)
    so a later FeeStructure edit never retroactively changes an issued invoice.
    Financial fields are immutable after creation (spec section 4.5) — the only
    permitted changes are `status` transitions and the void_* fields."""
    STATUS_CHOICES = [
        ('unpaid', 'Unpaid'),
        ('partially_paid', 'Partially Paid'),
        ('paid', 'Paid'),
        ('overdue', 'Overdue'),
        ('voided', 'Voided'),
    ]
    PROTECTED_FIELDS = ('student_id', 'fee_structure_id', 'total', 'invoice_number')

    student = models.ForeignKey('identity.StudentExtra', on_delete=models.PROTECT, related_name='invoices')
    fee_structure = models.ForeignKey(FeeStructure, on_delete=models.PROTECT, related_name='invoices')
    total = models.PositiveIntegerField()
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default='unpaid')
    invoice_number = models.CharField(max_length=30, unique=True)
    issued_at = models.DateTimeField(auto_now_add=True)
    voided_at = models.DateTimeField(null=True, blank=True)
    voided_by = models.ForeignKey('auth.User', on_delete=models.PROTECT, null=True, blank=True, related_name='+')
    void_reason = models.TextField(blank=True)

    class Meta:
        db_table = 'finance_invoice'
        constraints = [
            models.UniqueConstraint(
                fields=['student', 'fee_structure'],
                condition=~models.Q(status='voided'),
                name='uniq_active_invoice_per_student_structure',
            ),
        ]

    def __str__(self):
        return self.invoice_number


class InvoiceLineItem(models.Model):
    """A snapshot of one charge on an Invoice at the moment it was generated —
    category, description, and amount are copied in, not referenced live, so
    editing a FeeStructureItem later never changes history."""
    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name='line_items')
    category = models.ForeignKey(FeeCategory, on_delete=models.PROTECT, related_name='+')
    description = models.CharField(max_length=255)
    amount = models.PositiveIntegerField()

    class Meta:
        db_table = 'finance_invoicelineitem'
```

- [ ] **Step 4: Register in `apps/finance/admin.py`**

```python
from apps.finance.models_fees import Invoice, InvoiceLineItem


class InvoiceLineItemInline(admin.TabularInline):
    model = InvoiceLineItem
    extra = 0
    can_delete = False

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(Invoice)
class InvoiceAdmin(admin.ModelAdmin):
    list_display = ['invoice_number', 'student', 'fee_structure', 'total', 'status', 'issued_at']
    list_filter = ['status', 'fee_structure']
    search_fields = ['invoice_number']
    autocomplete_fields = ['student']
    inlines = [InvoiceLineItemInline]
    # Generated only through services_fees.generate_invoice_for_student() — no manual add.
    def has_add_permission(self, request):
        return False
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `python manage.py test apps.finance.tests.test_invoice_model -v 2`
Expected: PASS (7 tests)

- [ ] **Step 6: State the migration**

```text
Migration required:
python manage.py makemigrations finance
python manage.py migrate
```

- [ ] **Step 7: Commit**

```bash
git add apps/finance/models_fees.py apps/finance/admin.py apps/finance/tests/test_invoice_model.py
git commit -m "feat(finance): add immutable Invoice and InvoiceLineItem models"
```

---

### Task 7: Payment + Receipt (immutable, synchronous receipt generation)

**Files:**
- Modify: `apps/finance/models_fees.py`
- Modify: `apps/finance/admin.py`
- Test: `apps/finance/tests/test_payment_model.py`

**Interfaces:**
- Consumes: `ImmutableFinancialRecordMixin` (Task 1), `CashAccount` (Task 1), `Invoice` (Task 6).
- Produces: `Payment` (`student`, `invoice`, `amount`, `method`, `reference`, `status`, `recorded_by`, `cash_account`, `date`, void fields), `Receipt` (`payment` 1:1, `receipt_number`, `generated_at`). Task 11 (`record_payment`) creates these.

- [ ] **Step 1: Write the failing tests**

```python
# apps/finance/tests/test_payment_model.py
from django.contrib.auth.models import User
from django.db import IntegrityError
from django.test import TestCase

from apps.identity.models import StudentExtra
from apps.finance.models_fees import Payment, Receipt
from apps.finance.models_shared import FinancialRecordImmutableError


class PaymentModelTests(TestCase):
    def setUp(self):
        student_user = User.objects.create_user(username='payment_student', password='x')
        self.student = StudentExtra.objects.create(user=student_user)
        self.recorder = User.objects.create_user(username='payment_recorder', password='x')

    def test_can_create_manual_payment(self):
        payment = Payment.objects.create(
            student=self.student, amount=5000, method='cash', reference='RCPT-manual-1',
            status='confirmed', recorded_by=self.recorder, date='2026-09-09',
        )
        self.assertEqual(payment.status, 'confirmed')

    def test_amount_cannot_be_changed_after_creation(self):
        payment = Payment.objects.create(
            student=self.student, amount=5000, method='cash', reference='RCPT-manual-2',
            status='confirmed', recorded_by=self.recorder, date='2026-09-09',
        )
        payment.amount = 99999
        with self.assertRaises(FinancialRecordImmutableError):
            payment.save()

    def test_status_can_change_to_failed_after_creation(self):
        payment = Payment.objects.create(
            student=self.student, amount=5000, method='mpesa', reference='RCPT-manual-3',
            status='pending', recorded_by=self.recorder, date='2026-09-09',
        )
        payment.status = 'failed'
        payment.save()
        payment.refresh_from_db()
        self.assertEqual(payment.status, 'failed')


class ReceiptModelTests(TestCase):
    def setUp(self):
        student_user = User.objects.create_user(username='receipt_student', password='x')
        student = StudentExtra.objects.create(user=student_user)
        recorder = User.objects.create_user(username='receipt_recorder', password='x')
        self.payment = Payment.objects.create(
            student=student, amount=5000, method='cash', reference='RCPT-manual-4',
            status='confirmed', recorded_by=recorder, date='2026-09-09',
        )

    def test_can_create_receipt_for_payment(self):
        receipt = Receipt.objects.create(payment=self.payment, receipt_number='RCPT-2026-000001')
        self.assertEqual(receipt.payment, self.payment)

    def test_receipt_number_must_be_unique(self):
        Receipt.objects.create(payment=self.payment, receipt_number='RCPT-2026-000002')
        student_user = User.objects.create_user(username='receipt_student_2', password='x')
        student2 = StudentExtra.objects.create(user=student_user)
        payment2 = Payment.objects.create(
            student=student2, amount=100, method='cash', reference='x',
            status='confirmed', recorded_by=self.payment.recorded_by, date='2026-09-09',
        )
        with self.assertRaises(IntegrityError):
            Receipt.objects.create(payment=payment2, receipt_number='RCPT-2026-000002')

    def test_only_one_receipt_per_payment(self):
        Receipt.objects.create(payment=self.payment, receipt_number='RCPT-2026-000003')
        with self.assertRaises(IntegrityError):
            Receipt.objects.create(payment=self.payment, receipt_number='RCPT-2026-000004')
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python manage.py test apps.finance.tests.test_payment_model -v 2`
Expected: FAIL — `ImportError: cannot import name 'Payment'`

- [ ] **Step 3: Append `Payment` and `Receipt` to `apps/finance/models_fees.py`**

```python
from apps.finance.models_shared import CashAccount


class Payment(ImmutableFinancialRecordMixin, models.Model):
    """A recorded payment against a student's fee account. `invoice` is nullable
    because a payment can be applied against a student's overall balance rather
    than one specific invoice. `method` stays a fixed choice list, not a
    DB-configurable table — there is no real payment-gateway integration to
    model against yet (spec section 9); `status` is reserved for that future
    gateway path (pending/failed), manual entries are always 'confirmed'
    immediately."""
    METHOD_CHOICES = [
        ('cash', 'Cash'),
        ('bank_transfer', 'Bank Transfer'),
        ('mpesa', 'M-Pesa'),
        ('cheque', 'Cheque'),
        ('other', 'Other'),
    ]
    STATUS_CHOICES = [
        ('confirmed', 'Confirmed'),
        ('pending', 'Pending'),
        ('failed', 'Failed'),
    ]
    PROTECTED_FIELDS = ('student_id', 'invoice_id', 'amount', 'method', 'reference', 'date')

    student = models.ForeignKey('identity.StudentExtra', on_delete=models.PROTECT, related_name='payments')
    invoice = models.ForeignKey(Invoice, on_delete=models.PROTECT, null=True, blank=True, related_name='payments')
    amount = models.PositiveIntegerField()
    method = models.CharField(max_length=15, choices=METHOD_CHOICES)
    reference = models.CharField(max_length=100, blank=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='confirmed')
    recorded_by = models.ForeignKey('auth.User', on_delete=models.PROTECT, related_name='+')
    cash_account = models.ForeignKey(CashAccount, on_delete=models.PROTECT, null=True, blank=True, related_name='payments')
    date = models.DateField()
    voided_at = models.DateTimeField(null=True, blank=True)
    voided_by = models.ForeignKey('auth.User', on_delete=models.PROTECT, null=True, blank=True, related_name='+')
    void_reason = models.TextField(blank=True)

    class Meta:
        db_table = 'finance_payment'
        indexes = [models.Index(fields=['student', 'date'])]

    def __str__(self):
        return f"{self.student} - {self.amount} ({self.method})"


class Receipt(models.Model):
    """1:1 with a confirmed Payment. Generated synchronously the instant the
    payment is confirmed — a single row, no Celery needed."""
    payment = models.OneToOneField(Payment, on_delete=models.PROTECT, related_name='receipt')
    receipt_number = models.CharField(max_length=30, unique=True)
    generated_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'finance_receipt'

    def __str__(self):
        return self.receipt_number
```

- [ ] **Step 4: Register in `apps/finance/admin.py`**

```python
from apps.finance.models_fees import Payment, Receipt


@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
    list_display = ['student', 'amount', 'method', 'status', 'date', 'recorded_by']
    list_filter = ['method', 'status']
    autocomplete_fields = ['student']
    def has_add_permission(self, request):
        return False


@admin.register(Receipt)
class ReceiptAdmin(admin.ModelAdmin):
    list_display = ['receipt_number', 'payment', 'generated_at']
    def has_add_permission(self, request):
        return False
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `python manage.py test apps.finance.tests.test_payment_model -v 2`
Expected: PASS (6 tests)

- [ ] **Step 6: State the migration**

```text
Migration required:
python manage.py makemigrations finance
python manage.py migrate
```

- [ ] **Step 7: Commit**

```bash
git add apps/finance/models_fees.py apps/finance/admin.py apps/finance/tests/test_payment_model.py
git commit -m "feat(finance): add immutable Payment and Receipt models"
```

---

### Task 8: generate_invoice_for_student (single-student invoicing)

**Files:**
- Modify: `apps/finance/services_fees.py`
- Test: `apps/finance/tests/test_invoicing.py`

**Interfaces:**
- Consumes: `next_document_number` (Task 1), `post_ledger_entry` (Task 4), `Invoice`/`InvoiceLineItem`/`FeeStructure`/`FeeStructureItem`/`StudentFeeItemEnrollment` (Tasks 3, 6), `write_audit_log` from `apps.core.services`.
- Produces: `generate_invoice_for_student(*, student, fee_structure, operator) -> Invoice` in `services_fees.py`. Task 9 (bulk generation) calls this once per student.

- [ ] **Step 1: Write the failing tests**

```python
# apps/finance/tests/test_invoicing.py
from django.contrib.auth.models import User
from django.test import TestCase

from apps.academics.models import AcademicYear, ExamTerm, GradeLevel, Curriculum, Tier
from apps.identity.models import StudentExtra
from apps.finance.models_fees import (
    FeeCategory, FeeStructure, FeeStructureItem, StudentFeeItemEnrollment,
    StudentFeeLedgerEntry,
)
from apps.finance.services_fees import generate_invoice_for_student


class InvoicingTestData(TestCase):
    def setUp(self):
        curriculum = Curriculum.objects.create(name='CBC')
        tier = Tier.objects.create(name='Junior School', curriculum=curriculum)
        self.grade = GradeLevel.objects.create(name='Grade 7', numeric_order=7, curriculum_type='CBC', curriculum=curriculum, tier=tier)
        year = AcademicYear.objects.create(year='2026', is_active=True)
        term = ExamTerm.objects.create(name='Term 2', academic_year=year, start_date='2026-05-01', end_date='2026-08-01')
        self.structure = FeeStructure.objects.create(grade_level=self.grade, term=term, name='Grade 7 - Term 2 2026')
        self.tuition_category = FeeCategory.objects.create(name='Tuition')
        self.transport_category = FeeCategory.objects.create(name='Transport')
        self.tuition_item = FeeStructureItem.objects.create(
            fee_structure=self.structure, category=self.tuition_category, amount=15000, is_optional=False,
        )
        self.transport_item = FeeStructureItem.objects.create(
            fee_structure=self.structure, category=self.transport_category, amount=3000, is_optional=True,
        )
        self.operator = User.objects.create_user(username='invoicing_operator', password='x')
        student_user = User.objects.create_user(username='invoicing_student', password='x')
        self.student = StudentExtra.objects.create(user=student_user)


class GenerateInvoiceForStudentTests(InvoicingTestData):
    def test_mandatory_item_always_included(self):
        invoice = generate_invoice_for_student(student=self.student, fee_structure=self.structure, operator=self.operator)
        self.assertEqual(invoice.total, 15000)
        self.assertEqual(invoice.line_items.count(), 1)

    def test_optional_item_excluded_unless_enrolled(self):
        invoice = generate_invoice_for_student(student=self.student, fee_structure=self.structure, operator=self.operator)
        categories = set(invoice.line_items.values_list('category__name', flat=True))
        self.assertNotIn('Transport', categories)

    def test_optional_item_included_when_enrolled(self):
        StudentFeeItemEnrollment.objects.create(student=self.student, fee_structure_item=self.transport_item)
        invoice = generate_invoice_for_student(student=self.student, fee_structure=self.structure, operator=self.operator)
        self.assertEqual(invoice.total, 18000)
        categories = set(invoice.line_items.values_list('category__name', flat=True))
        self.assertIn('Transport', categories)

    def test_invoice_number_is_generated(self):
        invoice = generate_invoice_for_student(student=self.student, fee_structure=self.structure, operator=self.operator)
        self.assertTrue(invoice.invoice_number.startswith('INV-'))

    def test_generation_posts_exactly_one_charge_to_the_ledger(self):
        generate_invoice_for_student(student=self.student, fee_structure=self.structure, operator=self.operator)
        entries = StudentFeeLedgerEntry.objects.filter(student=self.student, entry_type='charge')
        self.assertEqual(entries.count(), 1)
        self.assertEqual(entries.first().amount, 15000)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python manage.py test apps.finance.tests.test_invoicing -v 2`
Expected: FAIL — `ImportError: cannot import name 'generate_invoice_for_student'`

- [ ] **Step 3: Append to `apps/finance/services_fees.py`**

Add these imports at the top alongside the existing ones:

```python
from apps.finance.models_fees import Invoice, InvoiceLineItem, StudentFeeItemEnrollment
from apps.finance.services_shared import next_document_number
```

Then append:

```python
def generate_invoice_for_student(*, student, fee_structure, operator):
    """Create one Invoice for `student` against `fee_structure`: every mandatory
    FeeStructureItem, plus any optional item the student has a
    StudentFeeItemEnrollment row for. Snapshots line items into
    InvoiceLineItem so a later edit to the FeeStructure never changes this
    invoice retroactively (spec section 4.5)."""
    enrolled_item_ids = set(
        StudentFeeItemEnrollment.objects.filter(student=student, fee_structure_item__fee_structure=fee_structure)
        .values_list('fee_structure_item_id', flat=True)
    )
    applicable_items = [
        item for item in fee_structure.items.select_related('category')
        if not item.is_optional or item.pk in enrolled_item_ids
    ]
    total = sum(item.amount for item in applicable_items)

    with transaction.atomic():
        invoice = Invoice.objects.create(
            student=student, fee_structure=fee_structure, total=total,
            invoice_number=next_document_number('INV'),
        )
        InvoiceLineItem.objects.bulk_create([
            InvoiceLineItem(
                invoice=invoice, category=item.category,
                description=item.category.name, amount=item.amount,
            )
            for item in applicable_items
        ])
        post_ledger_entry(
            student=student, entry_type='charge', amount=total,
            reference=invoice, description=f"Invoice {invoice.invoice_number} ({fee_structure.name})",
        )
        write_audit_log(
            operator_id=operator.id if operator else None, action_type='CREATE', module='finance',
            description=f"Generated invoice {invoice.invoice_number} for student {student.id} "
                         f"({fee_structure.name}), total {total}.",
        )
        return invoice
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python manage.py test apps.finance.tests.test_invoicing -v 2`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/finance/services_fees.py apps/finance/tests/test_invoicing.py
git commit -m "feat(finance): add generate_invoice_for_student (mandatory + optional items)"
```

---

### Task 9: Bulk invoice generation — Celery task on `bulk_ops`, dispatch view

Mirrors `promote_students_task` / `PromoteStudentsAPIView.post` exactly (`orchestration/tasks.py:371-402`, `school/views/promotion_views.py:329-384`) — same lock-key, `dispatch_background_job`, `_mark_running`/`_mark_success`/`_mark_failure` shape.

**Files:**
- Modify: `apps/finance/services_fees.py`
- Modify: `orchestration/tasks.py`
- Modify: `apps/finance/views.py` (currently just `FinanceOverviewAPI` — add the new view alongside it)
- Modify: `apps/finance/urls.py`
- Test: `apps/finance/tests/test_bulk_invoice_generation.py`

**Interfaces:**
- Consumes: `generate_invoice_for_student` (Task 8), `dispatch_background_job`/`is_worker_available` from `school.jobs`, `_acquire_lock_or_retry`/`_mark_running`/`_mark_success`/`_mark_failure` from `orchestration.tasks`.
- Produces: `generate_invoices_for_structure(*, fee_structure, operator) -> list[Invoice]` in `services_fees.py`. `generate_invoices_for_structure_task` Celery task. `ActivateFeeStructureAPIView` (`POST /api/finance/fee-structures/&lt;id&gt;/activate/`).

- [ ] **Step 1: Write the failing tests**

```python
# apps/finance/tests/test_bulk_invoice_generation.py
from unittest import mock

from django.contrib.auth.models import User
from django.test import TestCase, RequestFactory

from apps.academics.models import AcademicYear, ExamTerm, GradeLevel, ClassStream, Curriculum, Tier
from apps.identity.models import StudentExtra
from apps.finance.models_fees import FeeCategory, FeeStructure, FeeStructureItem, Invoice
from apps.finance.services_fees import generate_invoices_for_structure
from apps.finance.views import ActivateFeeStructureAPIView


class BulkInvoiceGenerationTestData(TestCase):
    def setUp(self):
        curriculum = Curriculum.objects.create(name='CBC')
        tier = Tier.objects.create(name='Junior School', curriculum=curriculum)
        self.grade = GradeLevel.objects.create(name='Grade 7', numeric_order=7, curriculum_type='CBC', curriculum=curriculum, tier=tier)
        self.stream = ClassStream.objects.create(name='7 Blue', grade=self.grade)
        year = AcademicYear.objects.create(year='2026', is_active=True)
        term = ExamTerm.objects.create(name='Term 2', academic_year=year, start_date='2026-05-01', end_date='2026-08-01')
        self.structure = FeeStructure.objects.create(grade_level=self.grade, term=term, name='Grade 7 - Term 2 2026')
        FeeStructureItem.objects.create(fee_structure=self.structure, category=FeeCategory.objects.create(name='Tuition'), amount=15000)
        self.operator = User.objects.create_user(username='bulk_operator', password='x', is_staff=True)

        self.students = []
        for i in range(3):
            user = User.objects.create_user(username=f'bulk_student_{i}', password='x')
            self.students.append(StudentExtra.objects.create(user=user, cl=self.stream, status=True))


class GenerateInvoicesForStructureTests(BulkInvoiceGenerationTestData):
    def test_generates_one_invoice_per_student_in_grade(self):
        invoices = generate_invoices_for_structure(fee_structure=self.structure, operator=self.operator)
        self.assertEqual(len(invoices), 3)
        self.assertEqual(Invoice.objects.filter(fee_structure=self.structure).count(), 3)

    def test_running_twice_does_not_duplicate_active_invoices(self):
        generate_invoices_for_structure(fee_structure=self.structure, operator=self.operator)
        second_run = generate_invoices_for_structure(fee_structure=self.structure, operator=self.operator)
        self.assertEqual(len(second_run), 0)
        self.assertEqual(Invoice.objects.filter(fee_structure=self.structure).count(), 3)

    def test_students_outside_the_grade_are_not_invoiced(self):
        other_grade = GradeLevel.objects.create(name='Grade 8', numeric_order=8, curriculum_type='CBC', curriculum=self.grade.curriculum, tier=self.grade.tier)
        other_stream = ClassStream.objects.create(name='8 Blue', grade=other_grade)
        other_user = User.objects.create_user(username='other_grade_student', password='x')
        StudentExtra.objects.create(user=other_user, cl=other_stream, status=True)

        invoices = generate_invoices_for_structure(fee_structure=self.structure, operator=self.operator)
        self.assertEqual(len(invoices), 3)


class ActivateFeeStructureAPIViewTests(BulkInvoiceGenerationTestData):
    def setUp(self):
        super().setUp()
        self.factory = RequestFactory()

    def _post(self, user):
        request = self.factory.post(f'/api/finance/fee-structures/{self.structure.id}/activate/')
        request.user = user
        return ActivateFeeStructureAPIView.as_view()(request, structure_id=self.structure.id)

    @mock.patch('school.jobs.is_worker_available', return_value=True)
    def test_activation_queues_a_job_when_worker_available(self, mock_worker):
        response = self._post(self.operator)
        self.assertEqual(response.status_code, 202)
        self.assertIn('job_id', response.data)
        self.structure.refresh_from_db()
        self.assertEqual(self.structure.status, 'active')

    @mock.patch('school.jobs.is_worker_available', return_value=False)
    def test_activation_returns_503_when_no_worker_available(self, mock_worker):
        response = self._post(self.operator)
        self.assertEqual(response.status_code, 503)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python manage.py test apps.finance.tests.test_bulk_invoice_generation -v 2`
Expected: FAIL — `ImportError: cannot import name 'generate_invoices_for_structure'`

- [ ] **Step 3: Append `generate_invoices_for_structure` to `apps/finance/services_fees.py`**

Add this import at the top: `from apps.identity.models import StudentExtra` (already imported for `post_ledger_entry` — check before adding a duplicate).

```python
def generate_invoices_for_structure(*, fee_structure, operator):
    """Bulk-generate invoices for every eligible student in fee_structure's
    grade. Idempotent by construction: students who already have a
    non-voided invoice for this structure are skipped, so re-running this
    (e.g. a double-submit) never creates duplicates — the caller doesn't need
    to catch IntegrityError from the UniqueConstraint on Invoice."""
    already_invoiced_student_ids = set(
        Invoice.objects.filter(fee_structure=fee_structure)
        .exclude(status='voided')
        .values_list('student_id', flat=True)
    )
    students = StudentExtra.objects.filter(
        cl__grade=fee_structure.grade_level, cl__is_deleted=False,
        status=True, deleted_at__isnull=True,
    ).exclude(id__in=already_invoiced_student_ids)
    return [
        generate_invoice_for_student(student=student, fee_structure=fee_structure, operator=operator)
        for student in students
    ]
```

- [ ] **Step 4: Add the Celery task to `orchestration/tasks.py`**

Append near the other bulk tasks (after `promote_students_task`), following the exact same shape:

```python
@shared_task(bind=True)
def generate_invoices_for_structure_task(self, job_id, fee_structure_id, operator_id, lock_key):
    from django.contrib.auth.models import User
    from apps.finance.models_fees import FeeStructure
    from apps.finance import services_fees as finance_services

    if not _acquire_lock_or_retry(self, job_id, lock_key):
        return

    _mark_running(job_id)
    try:
        with transaction.atomic():
            fee_structure = FeeStructure.objects.select_for_update().get(id=fee_structure_id)
            operator = User.objects.filter(id=operator_id).first()
            invoices = finance_services.generate_invoices_for_structure(fee_structure=fee_structure, operator=operator)
            core_services.write_audit_log(
                operator_id=operator_id, action_type='CREATE', module='finance',
                description=f"Bulk-generated {len(invoices)} invoice(s) for fee structure '{fee_structure.name}'.",
            )
        _mark_success(job_id, {
            'message': f"{len(invoices)} invoice(s) generated for '{fee_structure.name}'.",
            'invoice_count': len(invoices),
        })
    except Exception as e:
        _mark_failure(job_id, str(e))
    finally:
        cache.delete(lock_key)
```

- [ ] **Step 5: Add `ActivateFeeStructureAPIView` to `apps/finance/views.py`**

Add alongside the existing `FinanceOverviewAPI` (do not remove it):

```python
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.authentication import SessionAuthentication

from school.rbac import HasModulePermission
from school.jobs import dispatch_background_job
from apps.finance.models_fees import FeeStructure
from orchestration.tasks import generate_invoices_for_structure_task


class ActivateFeeStructureAPIView(APIView):
    """Sets a FeeStructure to 'active' and dispatches bulk invoice generation
    for every eligible student in its grade, on the bulk_ops queue — mirrors
    PromoteStudentsAPIView's dispatch pattern exactly."""
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_edit_permission = 'finance.edit'

    def post(self, request, structure_id):
        fee_structure = FeeStructure.objects.filter(id=structure_id).first()
        if fee_structure is None:
            return Response({"error": "Fee structure not found."}, status=status.HTTP_404_NOT_FOUND)

        fee_structure.status = 'active'
        fee_structure.save(update_fields=['status'])

        # Scoped per fee structure — a double-submit on the same structure shares
        # one lock rather than racing to generate duplicate invoices.
        lock_key = f"finance_generate_invoices_lock_structure_{structure_id}"

        job, error_response = dispatch_background_job(
            job_type='generate_invoices_for_structure',
            task=generate_invoices_for_structure_task,
            task_args=(structure_id, request.user.id, lock_key),
            operator=request.user,
        )
        if error_response is not None:
            return error_response

        return Response({"status": "queued", "job_id": str(job.id)}, status=status.HTTP_202_ACCEPTED)
```

- [ ] **Step 6: Add the URL to `apps/finance/urls.py`**

```python
from apps.finance.views import ActivateFeeStructureAPIView

urlpatterns += [
    path('api/finance/fee-structures/<int:structure_id>/activate/', ActivateFeeStructureAPIView.as_view(), name='api_activate_fee_structure'),
]
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `python manage.py test apps.finance.tests.test_bulk_invoice_generation -v 2`
Expected: PASS (5 tests)

- [ ] **Step 8: Commit**

```bash
git add apps/finance/services_fees.py orchestration/tasks.py apps/finance/views.py apps/finance/urls.py apps/finance/tests/test_bulk_invoice_generation.py
git commit -m "feat(finance): bulk invoice generation on activate, via bulk_ops Celery queue"
```

---

### Task 10: record_payment (payment posting, invoice status, synchronous receipt)

**Files:**
- Modify: `apps/finance/services_fees.py`
- Test: `apps/finance/tests/test_payments.py`

**Interfaces:**
- Consumes: `post_ledger_entry` (Task 4), `next_document_number` (Task 1), `Payment`/`Receipt`/`Invoice` (Tasks 6-7).
- Produces: `record_payment(*, student, amount, method, recorded_by, invoice=None, reference='', cash_account=None, date=None) -> tuple[Payment, Receipt]` in `services_fees.py`.

- [ ] **Step 1: Write the failing tests**

```python
# apps/finance/tests/test_payments.py
from django.contrib.auth.models import User
from django.test import TestCase

from apps.academics.models import AcademicYear, ExamTerm, GradeLevel, Curriculum, Tier
from apps.identity.models import StudentExtra
from apps.finance.models_fees import FeeCategory, FeeStructure, StudentFeeLedgerEntry
from apps.finance.services_fees import generate_invoice_for_student, record_payment


class PaymentTestData(TestCase):
    def setUp(self):
        curriculum = Curriculum.objects.create(name='CBC')
        tier = Tier.objects.create(name='Junior School', curriculum=curriculum)
        grade = GradeLevel.objects.create(name='Grade 7', numeric_order=7, curriculum_type='CBC', curriculum=curriculum, tier=tier)
        year = AcademicYear.objects.create(year='2026', is_active=True)
        term = ExamTerm.objects.create(name='Term 2', academic_year=year, start_date='2026-05-01', end_date='2026-08-01')
        structure = FeeStructure.objects.create(grade_level=grade, term=term, name='Grade 7 - Term 2 2026')
        FeeStructureItem_amount = 15000
        from apps.finance.models_fees import FeeStructureItem
        FeeStructureItem.objects.create(fee_structure=structure, category=FeeCategory.objects.create(name='Tuition'), amount=FeeStructureItem_amount)
        self.operator = User.objects.create_user(username='payment_test_operator', password='x')
        student_user = User.objects.create_user(username='payment_test_student', password='x')
        self.student = StudentExtra.objects.create(user=student_user)
        self.invoice = generate_invoice_for_student(student=self.student, fee_structure=structure, operator=self.operator)


class RecordPaymentTests(PaymentTestData):
    def test_full_payment_marks_invoice_paid(self):
        payment, receipt = record_payment(
            student=self.student, amount=15000, method='cash',
            recorded_by=self.operator, invoice=self.invoice, date='2026-09-09',
        )
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.status, 'paid')
        self.assertIsNotNone(receipt.receipt_number)

    def test_partial_payment_marks_invoice_partially_paid(self):
        record_payment(
            student=self.student, amount=5000, method='cash',
            recorded_by=self.operator, invoice=self.invoice, date='2026-09-09',
        )
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.status, 'partially_paid')

    def test_payment_reduces_ledger_running_balance(self):
        record_payment(
            student=self.student, amount=5000, method='cash',
            recorded_by=self.operator, invoice=self.invoice, date='2026-09-09',
        )
        latest_entry = StudentFeeLedgerEntry.objects.filter(student=self.student).order_by('-id').first()
        self.assertEqual(latest_entry.running_balance, 10000)

    def test_receipt_is_generated_synchronously(self):
        payment, receipt = record_payment(
            student=self.student, amount=15000, method='cash',
            recorded_by=self.operator, invoice=self.invoice, date='2026-09-09',
        )
        self.assertEqual(receipt.payment, payment)
        self.assertTrue(receipt.receipt_number.startswith('RCPT-'))

    def test_payment_without_invoice_applies_to_overall_balance(self):
        payment, receipt = record_payment(
            student=self.student, amount=1000, method='cash',
            recorded_by=self.operator, invoice=None, date='2026-09-09',
        )
        self.assertIsNone(payment.invoice)
        latest_entry = StudentFeeLedgerEntry.objects.filter(student=self.student).order_by('-id').first()
        self.assertEqual(latest_entry.running_balance, 14000)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python manage.py test apps.finance.tests.test_payments -v 2`
Expected: FAIL — `ImportError: cannot import name 'record_payment'`

- [ ] **Step 3: Append to `apps/finance/services_fees.py`**

Add this import at the top: `from django.db.models import Sum` and `from apps.finance.models_fees import Payment, Receipt`.

```python
def _recalculate_invoice_status(invoice):
    """An invoice's status is derived from its non-voided payments, not stored
    independently — recomputed here after every payment against it."""
    paid_amount = (
        Payment.objects.filter(invoice=invoice, voided_at__isnull=True, status='confirmed')
        .aggregate(total=Sum('amount'))['total'] or 0
    )
    if paid_amount >= invoice.total:
        invoice.status = 'paid'
    elif paid_amount > 0:
        invoice.status = 'partially_paid'
    else:
        invoice.status = 'unpaid'
    invoice.save(update_fields=['status'])


def record_payment(*, student, amount, method, recorded_by, invoice=None, reference='', cash_account=None, date=None):
    """Record a manual payment: create the Payment (always 'confirmed' for
    manual entries, per spec section 9), post a negative ledger entry, update
    the invoice's status if one was supplied, generate the Receipt
    synchronously, and audit-log the action — all inside one transaction."""
    with transaction.atomic():
        payment = Payment.objects.create(
            student=student, invoice=invoice, amount=amount, method=method,
            reference=reference, status='confirmed', recorded_by=recorded_by,
            cash_account=cash_account, date=date or timezone.now().date(),
        )
        post_ledger_entry(
            student=student, entry_type='payment', amount=-amount,
            reference=payment, description=f"Payment received ({method})" + (f" for {invoice.invoice_number}" if invoice else ''),
        )
        if invoice is not None:
            _recalculate_invoice_status(invoice)
        receipt = Receipt.objects.create(payment=payment, receipt_number=next_document_number('RCPT'))
        write_audit_log(
            operator_id=recorded_by.id, action_type='CREATE', module='finance',
            description=f"Recorded payment of {amount} ({method}) for student {student.id}"
                         + (f" against invoice {invoice.invoice_number}" if invoice else '') + f"; receipt {receipt.receipt_number}.",
        )
        return payment, receipt
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python manage.py test apps.finance.tests.test_payments -v 2`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/finance/services_fees.py apps/finance/tests/test_payments.py
git commit -m "feat(finance): add record_payment with invoice-status recalculation and synchronous receipts"
```

---

### Task 11: void_invoice / void_payment — void-and-reissue, never edit or delete

**Files:**
- Modify: `apps/finance/services_fees.py`
- Test: `apps/finance/tests/test_void.py`

**Interfaces:**
- Consumes: `post_ledger_entry`, `_recalculate_invoice_status` (Task 10), `write_audit_log`.
- Produces: `void_invoice(*, invoice, voided_by, reason) -> Invoice`, `void_payment(*, payment, voided_by, reason) -> Payment` in `services_fees.py`.

- [ ] **Step 1: Write the failing tests**

```python
# apps/finance/tests/test_void.py
from django.contrib.auth.models import User
from django.core.exceptions import ValidationError
from django.test import TestCase

from apps.academics.models import AcademicYear, ExamTerm, GradeLevel, Curriculum, Tier
from apps.identity.models import StudentExtra
from apps.finance.models_fees import FeeCategory, FeeStructure, FeeStructureItem, StudentFeeLedgerEntry
from apps.finance.services_fees import generate_invoice_for_student, record_payment, void_invoice, void_payment


class VoidTestData(TestCase):
    def setUp(self):
        curriculum = Curriculum.objects.create(name='CBC')
        tier = Tier.objects.create(name='Junior School', curriculum=curriculum)
        grade = GradeLevel.objects.create(name='Grade 7', numeric_order=7, curriculum_type='CBC', curriculum=curriculum, tier=tier)
        year = AcademicYear.objects.create(year='2026', is_active=True)
        term = ExamTerm.objects.create(name='Term 2', academic_year=year, start_date='2026-05-01', end_date='2026-08-01')
        structure = FeeStructure.objects.create(grade_level=grade, term=term, name='Grade 7 - Term 2 2026')
        FeeStructureItem.objects.create(fee_structure=structure, category=FeeCategory.objects.create(name='Tuition'), amount=15000)
        self.operator = User.objects.create_user(username='void_test_operator', password='x')
        student_user = User.objects.create_user(username='void_test_student', password='x')
        self.student = StudentExtra.objects.create(user=student_user)
        self.invoice = generate_invoice_for_student(student=self.student, fee_structure=structure, operator=self.operator)


class VoidInvoiceTests(VoidTestData):
    def test_void_sets_fields_and_reverses_ledger_charge(self):
        void_invoice(invoice=self.invoice, voided_by=self.operator, reason='Duplicate generation')
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.status, 'voided')
        self.assertIsNotNone(self.invoice.voided_at)
        latest_entry = StudentFeeLedgerEntry.objects.filter(student=self.student).order_by('-id').first()
        self.assertEqual(latest_entry.running_balance, 0)

    def test_void_without_reason_is_rejected(self):
        with self.assertRaises(ValidationError):
            void_invoice(invoice=self.invoice, voided_by=self.operator, reason='   ')

    def test_double_void_is_rejected(self):
        void_invoice(invoice=self.invoice, voided_by=self.operator, reason='First void')
        with self.assertRaises(ValidationError):
            void_invoice(invoice=self.invoice, voided_by=self.operator, reason='Second void')

    def test_original_voided_invoice_remains_in_the_database(self):
        void_invoice(invoice=self.invoice, voided_by=self.operator, reason='Duplicate generation')
        from apps.finance.models_fees import Invoice
        self.assertTrue(Invoice.objects.filter(pk=self.invoice.pk).exists())


class VoidPaymentTests(VoidTestData):
    def setUp(self):
        super().setUp()
        self.payment, self.receipt = record_payment(
            student=self.student, amount=5000, method='cash',
            recorded_by=self.operator, invoice=self.invoice, date='2026-09-09',
        )

    def test_void_reverses_ledger_and_invoice_status(self):
        void_payment(payment=self.payment, voided_by=self.operator, reason='Wrong student credited')
        self.payment.refresh_from_db()
        self.invoice.refresh_from_db()
        self.assertIsNotNone(self.payment.voided_at)
        self.assertEqual(self.invoice.status, 'unpaid')
        latest_entry = StudentFeeLedgerEntry.objects.filter(student=self.student).order_by('-id').first()
        self.assertEqual(latest_entry.running_balance, 15000)

    def test_void_without_reason_is_rejected(self):
        with self.assertRaises(ValidationError):
            void_payment(payment=self.payment, voided_by=self.operator, reason='')
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python manage.py test apps.finance.tests.test_void -v 2`
Expected: FAIL — `ImportError: cannot import name 'void_invoice'`

- [ ] **Step 3: Append to `apps/finance/services_fees.py`**

```python
def void_invoice(*, invoice, voided_by, reason):
    """Void an invoice: never edit or delete it. Sets the void_* fields,
    posts a correcting negative charge to the student's ledger reversing the
    original amount, and audit-logs the action. Reusing the existing 'DELETE'
    ACTION_CHOICES value ('Soft Deleted Resource') for this — no VOID choice
    exists yet and this is conceptually the soft-delete case that choice
    already describes."""
    if not reason or not reason.strip():
        raise ValidationError("A void reason is required.")
    with transaction.atomic():
        if invoice.status == 'voided':
            raise ValidationError(f"Invoice {invoice.invoice_number} is already voided.")
        invoice.status = 'voided'
        invoice.voided_at = timezone.now()
        invoice.voided_by = voided_by
        invoice.void_reason = reason
        invoice.save(update_fields=['status', 'voided_at', 'voided_by', 'void_reason'])
        post_ledger_entry(
            student=invoice.student, entry_type='charge', amount=-invoice.total,
            reference=invoice, description=f"Void of invoice {invoice.invoice_number}: {reason}",
        )
        write_audit_log(
            operator_id=voided_by.id, action_type='DELETE', module='finance',
            description=f"Voided invoice {invoice.invoice_number} ({invoice.total}): {reason}",
        )
        return invoice


def void_payment(*, payment, voided_by, reason):
    """Void a payment: reverses its ledger effect with a positive correcting
    entry, recalculates its invoice's status if it had one, and audit-logs
    the action. The payment row itself is kept, marked voided — never
    deleted."""
    if not reason or not reason.strip():
        raise ValidationError("A void reason is required.")
    with transaction.atomic():
        if payment.voided_at is not None:
            raise ValidationError(f"Payment {payment.pk} is already voided.")
        payment.voided_at = timezone.now()
        payment.voided_by = voided_by
        payment.void_reason = reason
        payment.save(update_fields=['voided_at', 'voided_by', 'void_reason'])
        post_ledger_entry(
            student=payment.student, entry_type='payment', amount=payment.amount,
            reference=payment, description=f"Void of payment {payment.pk}: {reason}",
        )
        if payment.invoice is not None:
            _recalculate_invoice_status(payment.invoice)
        write_audit_log(
            operator_id=voided_by.id, action_type='DELETE', module='finance',
            description=f"Voided payment {payment.pk} ({payment.amount}, {payment.method}): {reason}",
        )
        return payment
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python manage.py test apps.finance.tests.test_void -v 2`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/finance/services_fees.py apps/finance/tests/test_void.py
git commit -m "feat(finance): add void_invoice and void_payment (void-and-reissue, never edit/delete)"
```

---

### Task 12: is_fees_clear — real implementation, replacing the no-op stub

The existing `apps/finance/services.py` has exactly one function today:
`is_fees_clear(*, student_id, term_id) -> Optional[bool]`, which always returns
`None` (a documented placeholder). This task makes it real and keeps
`apps.finance.services.is_fees_clear` importable unchanged, so any existing or
future call site doesn't need to know the implementation moved.

**Files:**
- Modify: `apps/finance/services_fees.py`
- Modify: `apps/finance/services.py`
- Test: `apps/finance/tests/test_fee_clearance.py`

**Interfaces:**
- Consumes: `StudentFeeLedgerEntry` (Task 4).
- Produces: `is_fees_clear(*, student_id, term_id=None, grace_threshold=0) -> Optional[bool]` in `services_fees.py`, re-exported from `services.py`. Tasks 18-19 (report-card and promotion gates) both call `from apps.finance.services import is_fees_clear`.

- [ ] **Step 1: Write the failing tests**

```python
# apps/finance/tests/test_fee_clearance.py
from django.contrib.auth.models import User
from django.test import TestCase

from apps.identity.models import StudentExtra
from apps.finance.models_fees import FeeCategory
from apps.finance.services_fees import is_fees_clear, post_ledger_entry


class FeeClearanceTests(TestCase):
    def setUp(self):
        student_user = User.objects.create_user(username='clearance_student', password='x')
        self.student = StudentExtra.objects.create(user=student_user)
        self.category = FeeCategory.objects.create(name='Tuition')

    def test_zero_balance_is_clear(self):
        self.assertTrue(is_fees_clear(student_id=self.student.id, term_id=1))

    def test_no_ledger_history_at_all_is_clear(self):
        # A student with no invoices/payments yet has an implicit balance of 0.
        other_user = User.objects.create_user(username='clearance_student_fresh', password='x')
        other_student = StudentExtra.objects.create(user=other_user)
        self.assertTrue(is_fees_clear(student_id=other_student.id, term_id=1))

    def test_positive_balance_is_not_clear(self):
        post_ledger_entry(student=self.student, entry_type='charge', amount=15000, reference=self.category, description='Charge')
        self.assertFalse(is_fees_clear(student_id=self.student.id, term_id=1))

    def test_balance_exactly_at_grace_threshold_is_clear(self):
        post_ledger_entry(student=self.student, entry_type='charge', amount=500, reference=self.category, description='Charge')
        self.assertTrue(is_fees_clear(student_id=self.student.id, term_id=1, grace_threshold=500))

    def test_balance_one_above_grace_threshold_is_not_clear(self):
        post_ledger_entry(student=self.student, entry_type='charge', amount=501, reference=self.category, description='Charge')
        self.assertFalse(is_fees_clear(student_id=self.student.id, term_id=1, grace_threshold=500))

    def test_unknown_student_returns_none(self):
        self.assertIsNone(is_fees_clear(student_id=999999, term_id=1))

    def test_reexported_from_services_module(self):
        from apps.finance.services import is_fees_clear as reexported
        self.assertTrue(reexported(student_id=self.student.id, term_id=1))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python manage.py test apps.finance.tests.test_fee_clearance -v 2`
Expected: FAIL — `ImportError: cannot import name 'is_fees_clear' from 'apps.finance.services_fees'`

- [ ] **Step 3: Append to `apps/finance/services_fees.py`**

```python
def is_fees_clear(*, student_id, term_id=None, grace_threshold=0):
    """Real implementation, replacing the previous always-None stub in
    services.py. Checks the student's OVERALL account balance, not scoped to
    a single term — a student carrying an unpaid balance from an earlier term
    should not read as 'clear' just because the current term's charges happen
    to be settled, so this deliberately does not filter ledger entries by
    term_id. term_id is still accepted (both gate call sites pass one, per
    spec section 4.7) so a future per-term clearance policy has a seam to add
    without changing every call site. Returns True if balance <= grace_threshold,
    False otherwise, or None if student_id doesn't correspond to a real student."""
    if not StudentExtra.objects.filter(pk=student_id).exists():
        return None
    latest_entry = StudentFeeLedgerEntry.objects.filter(student_id=student_id).order_by('-id').first()
    balance = latest_entry.running_balance if latest_entry else 0
    return balance <= grace_threshold
```

Also add this import at the top if not already present: `from apps.finance.models_fees import StudentFeeLedgerEntry` (it is — added in Task 4; just confirm, don't duplicate).

- [ ] **Step 4: Replace the stub in `apps/finance/services.py`**

Replace the entire current file content with:

```python
"""Backward-compatible re-export. The real is_fees_clear() implementation now
lives in services_fees.py alongside the rest of the fee-domain logic it
depends on (StudentFeeLedgerEntry) — this file exists so
`from apps.finance.services import is_fees_clear` keeps working unchanged for
any existing or future caller (e.g. results/promotion gates)."""
from apps.finance.services_fees import is_fees_clear  # noqa: F401
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `python manage.py test apps.finance.tests.test_fee_clearance -v 2`
Expected: PASS (7 tests)

- [ ] **Step 6: Commit**

```bash
git add apps/finance/services_fees.py apps/finance/services.py apps/finance/tests/test_fee_clearance.py
git commit -m "feat(finance): implement real is_fees_clear, replacing the always-None stub"
```

---

### Task 13: hard_delete_financial_record — super-admin only, requires already-voided

**Files:**
- Modify: `apps/core/models.py` (add `HARD_DELETE` to `SystemAuditLog.ACTION_CHOICES`)
- Modify: `apps/finance/services_fees.py`
- Test: `apps/finance/tests/test_hard_delete.py`

**Interfaces:**
- Consumes: `Invoice`/`Payment` (Tasks 6-7), `write_audit_log`.
- Produces: `hard_delete_financial_record(*, model_class, pk, operator) -> None` in `services_fees.py`. Reachable only from Django admin (no API endpoint — see Global Constraints).

- [ ] **Step 1: Write the failing tests**

```python
# apps/finance/tests/test_hard_delete.py
from django.contrib.auth.models import User
from django.core.exceptions import PermissionDenied, ValidationError
from django.test import TestCase

from apps.academics.models import AcademicYear, ExamTerm, GradeLevel, Curriculum, Tier
from apps.identity.models import StudentExtra
from apps.finance.models_fees import FeeCategory, FeeStructure, FeeStructureItem, Invoice
from apps.finance.services_fees import generate_invoice_for_student, void_invoice, hard_delete_financial_record
from apps.core.models import SystemAuditLog


class HardDeleteTestData(TestCase):
    def setUp(self):
        curriculum = Curriculum.objects.create(name='CBC')
        tier = Tier.objects.create(name='Junior School', curriculum=curriculum)
        grade = GradeLevel.objects.create(name='Grade 7', numeric_order=7, curriculum_type='CBC', curriculum=curriculum, tier=tier)
        year = AcademicYear.objects.create(year='2026', is_active=True)
        term = ExamTerm.objects.create(name='Term 2', academic_year=year, start_date='2026-05-01', end_date='2026-08-01')
        structure = FeeStructure.objects.create(grade_level=grade, term=term, name='Grade 7 - Term 2 2026')
        FeeStructureItem.objects.create(fee_structure=structure, category=FeeCategory.objects.create(name='Tuition'), amount=15000)
        self.superuser = User.objects.create_user(username='hard_delete_superuser', password='x', is_superuser=True)
        self.regular_admin = User.objects.create_user(username='hard_delete_regular_admin', password='x', is_staff=True)
        student_user = User.objects.create_user(username='hard_delete_student', password='x')
        self.student = StudentExtra.objects.create(user=student_user)
        self.invoice = generate_invoice_for_student(student=self.student, fee_structure=structure, operator=self.superuser)


class HardDeleteFinancialRecordTests(HardDeleteTestData):
    def test_non_superuser_is_rejected(self):
        void_invoice(invoice=self.invoice, voided_by=self.superuser, reason='test')
        with self.assertRaises(PermissionDenied):
            hard_delete_financial_record(model_class=Invoice, pk=self.invoice.pk, operator=self.regular_admin)
        self.assertTrue(Invoice.objects.filter(pk=self.invoice.pk).exists())

    def test_non_voided_record_is_rejected_even_for_superuser(self):
        with self.assertRaises(ValidationError):
            hard_delete_financial_record(model_class=Invoice, pk=self.invoice.pk, operator=self.superuser)
        self.assertTrue(Invoice.objects.filter(pk=self.invoice.pk).exists())

    def test_superuser_can_hard_delete_a_voided_invoice(self):
        void_invoice(invoice=self.invoice, voided_by=self.superuser, reason='test')
        hard_delete_financial_record(model_class=Invoice, pk=self.invoice.pk, operator=self.superuser)
        self.assertFalse(Invoice.objects.filter(pk=self.invoice.pk).exists())

    def test_hard_delete_writes_an_audit_log_entry(self):
        void_invoice(invoice=self.invoice, voided_by=self.superuser, reason='test')
        invoice_pk = self.invoice.pk
        hard_delete_financial_record(model_class=Invoice, pk=invoice_pk, operator=self.superuser)
        self.assertTrue(
            SystemAuditLog.objects.filter(action_type='HARD_DELETE', module='finance', description__icontains=str(invoice_pk)).exists()
        )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python manage.py test apps.finance.tests.test_hard_delete -v 2`
Expected: FAIL — `django.core.exceptions.ValidationError: ['Value ... is not a valid choice.']` (once the test gets as far as writing the audit log) or an `ImportError` on `hard_delete_financial_record` — whichever surfaces first.

- [ ] **Step 3: Add `HARD_DELETE` to `apps/core/models.py`**

Find `SystemAuditLog.ACTION_CHOICES` (currently `CREATE`, `UPDATE`, `DELETE`, `RESTORE`, `SIMULATION`, `EXECUTION`, `APPROVE`, `REJECT`, `PROMOTE`, `AUTH_SUCCESS`, `AUTH_FAILURE`) and add one entry:

```python
    ACTION_CHOICES = [
        ('CREATE', 'Created Resource'),
        ('UPDATE', 'Modified Settings / Rules'),
        ('DELETE', 'Soft Deleted Resource'),
        ('RESTORE', 'Restored Soft Deleted Resource'),
        ('SIMULATION', 'Executed Allocation Simulation'),
        ('EXECUTION', 'Committed Live Allocation Splits'),
        ('APPROVE', 'Approved Pending Account'),
        ('REJECT', 'Rejected Pending Account'),
        ('PROMOTE', 'Promoted or Graduated Student'),
        ('AUTH_SUCCESS', 'Authentication Succeeded'),
        ('AUTH_FAILURE', 'Authentication Failed'),
        ('HARD_DELETE', 'Permanently Deleted Resource'),
    ]
```

- [ ] **Step 4: Append to `apps/finance/services_fees.py`**

Add this import at the top: `from django.core.exceptions import PermissionDenied` (alongside the existing `ValidationError` import).

```python
def hard_delete_financial_record(*, model_class, pk, operator):
    """Permanently remove a financial record. Deliberately narrow: only a real
    Django superuser (there is no separate 'SUPER_ADMIN' RBAC tier in this
    codebase — is_superuser is the correct, already-existing mechanism) may
    call this, and only on a record that has already been voided (defense in
    depth: you can't hard-delete something that was never flagged as wrong).
    Not reachable from any API endpoint — Django admin action only, per spec
    section 7.5."""
    if not operator.is_superuser:
        raise PermissionDenied("Only a superuser may hard-delete a financial record.")
    with transaction.atomic():
        obj = model_class.objects.select_for_update().get(pk=pk)
        if getattr(obj, 'voided_at', None) is None:
            raise ValidationError(
                f"{model_class.__name__} {pk} must be voided before it can be hard-deleted."
            )
        description = f"Hard-deleted {model_class.__name__} {pk} (was voided: {obj.void_reason})"
        obj.delete()
        write_audit_log(
            operator_id=operator.id, action_type='HARD_DELETE', module='finance',
            description=description,
        )
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `python manage.py test apps.finance.tests.test_hard_delete -v 2`
Expected: PASS (4 tests)

- [ ] **Step 6: State the migration**

```text
Migration required:
python manage.py makemigrations core
python manage.py migrate
```

- [ ] **Step 7: Wire the Django admin action (no API endpoint)**

In `apps/finance/admin.py`, add a custom admin action to `InvoiceAdmin` and `PaymentAdmin` (both already registered in Tasks 6-7) that calls `hard_delete_financial_record` instead of relying on Django's default bulk-delete action:

```python
from django.contrib import messages
from django.core.exceptions import PermissionDenied, ValidationError

from apps.finance.services_fees import hard_delete_financial_record


def hard_delete_selected(self, request, queryset):
    for obj in queryset:
        try:
            hard_delete_financial_record(model_class=type(obj), pk=obj.pk, operator=request.user)
        except (PermissionDenied, ValidationError) as exc:
            self.message_user(request, f"{obj}: {exc}", level=messages.ERROR)
            return
    self.message_user(request, f"Hard-deleted {queryset.count()} record(s).", level=messages.SUCCESS)


hard_delete_selected.short_description = "Hard delete (superuser only, must already be voided)"
```

Add `actions = [hard_delete_selected]` to `InvoiceAdmin` and `PaymentAdmin`, and remove Django's default delete permission from both so the only way to remove a row is through this action:

```python
    def has_delete_permission(self, request, obj=None):
        return False
```

- [ ] **Step 8: Commit**

```bash
git add apps/core/models.py apps/finance/services_fees.py apps/finance/admin.py apps/finance/tests/test_hard_delete.py
git commit -m "feat(finance): add super-admin-only hard delete, gated on already-voided records"
```

---

### Task 14: RBAC permissions — finance.* codes and a Finance Officer role

`school/management/commands/seed_rbac.py` already has `('finance.view', 'View fees & salary overview', 'Finance')` (line 47, used by the existing `FinanceOverviewAPI`). This task adds the rest of the codes this module needs and a bundled role. The user re-runs `python manage.py seed_rbac` themselves — this task does not run it.

**Files:**
- Modify: `school/management/commands/seed_rbac.py`
- Test: `apps/finance/tests/test_rbac_seeding.py`

**Interfaces:**
- Consumes: `Permission`/`Role` (`apps/identity/models.py`).
- Produces: new permission codes `finance.edit`, `finance.record_payment`, `finance.void`, `finance.approve_adjustment`; a `Finance Officer` role bundling them plus `finance.view`.

- [ ] **Step 1: Write the failing test**

```python
# apps/finance/tests/test_rbac_seeding.py
from django.core.management import call_command
from django.test import TestCase

from apps.identity.models import Permission, Role


class FinanceRBACSeedingTests(TestCase):
    def test_seed_rbac_creates_finance_permission_codes(self):
        call_command('seed_rbac')
        expected_codes = {'finance.view', 'finance.edit', 'finance.record_payment', 'finance.void', 'finance.approve_adjustment'}
        actual_codes = set(Permission.objects.filter(code__in=expected_codes).values_list('code', flat=True))
        self.assertEqual(actual_codes, expected_codes)

    def test_seed_rbac_creates_finance_officer_role_with_all_finance_permissions(self):
        call_command('seed_rbac')
        role = Role.objects.get(name='Finance Officer')
        codes = set(role.permissions.values_list('code', flat=True))
        self.assertEqual(
            codes,
            {'finance.view', 'finance.edit', 'finance.record_payment', 'finance.void', 'finance.approve_adjustment'},
        )

    def test_seed_rbac_is_safe_to_run_twice(self):
        call_command('seed_rbac')
        call_command('seed_rbac')
        self.assertEqual(Permission.objects.filter(code='finance.edit').count(), 1)
        self.assertEqual(Role.objects.filter(name='Finance Officer').count(), 1)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python manage.py test apps.finance.tests.test_rbac_seeding -v 2`
Expected: FAIL — `Permission.DoesNotExist` / the four new codes aren't present yet.

- [ ] **Step 3: Add the new permission codes to `PERMISSIONS` in `seed_rbac.py`**

Find the existing `('finance.view', 'View fees & salary overview', 'Finance')` line and add these four immediately after it:

```python
    ('finance.edit', 'Create and edit fee structures', 'Finance'),
    ('finance.record_payment', 'Record a payment against a student fee account', 'Finance'),
    ('finance.void', 'Void an invoice or payment', 'Finance'),
    ('finance.approve_adjustment', 'Approve a discount, scholarship, bursary, or penalty', 'Finance'),
```

- [ ] **Step 4: Add a `Finance Officer` role**

Find where other non-Admin roles are created in the same command (search for `Role.objects.update_or_create` or similar in the file) and add, following that exact pattern:

```python
    finance_officer_role, _ = Role.objects.update_or_create(
        name='Finance Officer', defaults={'description': 'Manages student fee accounts: structures, invoices, payments, adjustments.'},
    )
    finance_officer_role.permissions.set(
        Permission.objects.filter(code__in=[
            'finance.view', 'finance.edit', 'finance.record_payment', 'finance.void', 'finance.approve_adjustment',
        ])
    )
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `python manage.py test apps.finance.tests.test_rbac_seeding -v 2`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add school/management/commands/seed_rbac.py apps/finance/tests/test_rbac_seeding.py
git commit -m "feat(finance): seed finance.* RBAC permissions and a Finance Officer role"
```

- [ ] **Step 7: Tell the user to re-run the seeding command**

```text
RBAC seeding required (not a migration, but also not run automatically):
python manage.py seed_rbac
```

---

### Task 15: API — fee configuration &amp; structure endpoints

Follows the existing `apps/finance/views.py` style (plain `APIView` + `HasModulePermission`/`rbac_view_permission`/`rbac_edit_permission`, not `ModelViewSet` — this app already established that convention with `FinanceOverviewAPI`).

**Files:**
- Create: `apps/finance/serializers_fees.py`
- Modify: `apps/finance/views.py`
- Modify: `apps/finance/urls.py`
- Test: `apps/finance/tests/test_views_fee_structures.py`

**Interfaces:**
- Consumes: `FeeCategory`/`FeeStructure`/`FeeStructureItem`/`StudentFeeItemEnrollment` (Tasks 2-3).
- Produces: `FeeCategoryListCreateAPIView`, `FeeStructureListCreateAPIView`, `FeeStructureDetailAPIView` (includes nested items), `StudentFeeItemEnrollmentSetAPIView` (replace-the-roster-for-one-item endpoint). Routes under `/api/finance/fee-categories/`, `/api/finance/fee-structures/`, `/api/finance/fee-structures/&lt;id&gt;/`, `/api/finance/fee-structure-items/&lt;item_id&gt;/enrollments/`.

- [ ] **Step 1: Write the failing tests**

```python
# apps/finance/tests/test_views_fee_structures.py
import json

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIRequestFactory

from apps.academics.models import AcademicYear, ExamTerm, GradeLevel, Curriculum, Tier
from apps.identity.models import Permission, Role, UserRole, StudentExtra
from apps.finance.models_fees import FeeCategory, FeeStructure, FeeStructureItem
from apps.finance.views import (
    FeeCategoryListCreateAPIView, FeeStructureListCreateAPIView,
    FeeStructureDetailAPIView, StudentFeeItemEnrollmentSetAPIView,
)


class FinanceAPITestData(TestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        curriculum = Curriculum.objects.create(name='CBC')
        tier = Tier.objects.create(name='Junior School', curriculum=curriculum)
        self.grade = GradeLevel.objects.create(name='Grade 7', numeric_order=7, curriculum_type='CBC', curriculum=curriculum, tier=tier)
        year = AcademicYear.objects.create(year='2026', is_active=True)
        self.term = ExamTerm.objects.create(name='Term 2', academic_year=year, start_date='2026-05-01', end_date='2026-08-01')

        view_perm, _ = Permission.objects.get_or_create(code='finance.view', defaults={'label': 'View', 'module': 'Finance'})
        edit_perm, _ = Permission.objects.get_or_create(code='finance.edit', defaults={'label': 'Edit', 'module': 'Finance'})
        role, _ = Role.objects.get_or_create(name='Finance Officer Test Role')
        role.permissions.set([view_perm, edit_perm])
        self.finance_user = User.objects.create_user(username='finance_officer_test', password='x')
        UserRole.objects.create(user=self.finance_user, role=role)

        self.plain_user = User.objects.create_user(username='no_permission_user', password='x')


class FeeCategoryAPITests(FinanceAPITestData):
    def test_finance_officer_can_create_category(self):
        request = self.factory.post('/api/finance/fee-categories/', {'name': 'Boarding', 'description': 'Boarding fee'})
        request.user = self.finance_user
        response = FeeCategoryListCreateAPIView.as_view()(request)
        self.assertEqual(response.status_code, 201)
        self.assertTrue(FeeCategory.objects.filter(name='Boarding').exists())

    def test_user_without_permission_cannot_create_category(self):
        request = self.factory.post('/api/finance/fee-categories/', {'name': 'Boarding'})
        request.user = self.plain_user
        response = FeeCategoryListCreateAPIView.as_view()(request)
        self.assertEqual(response.status_code, 403)

    def test_can_list_categories(self):
        FeeCategory.objects.create(name='Tuition')
        request = self.factory.get('/api/finance/fee-categories/')
        request.user = self.finance_user
        response = FeeCategoryListCreateAPIView.as_view()(request)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)


class FeeStructureAPITests(FinanceAPITestData):
    def test_can_create_structure(self):
        request = self.factory.post('/api/finance/fee-structures/', {
            'grade_level': self.grade.id, 'term': self.term.id, 'name': 'Grade 7 - Term 2 2026',
        })
        request.user = self.finance_user
        response = FeeStructureListCreateAPIView.as_view()(request)
        self.assertEqual(response.status_code, 201)

    def test_detail_view_includes_items(self):
        structure = FeeStructure.objects.create(grade_level=self.grade, term=self.term, name='Grade 7 - Term 2 2026')
        FeeStructureItem.objects.create(fee_structure=structure, category=FeeCategory.objects.create(name='Tuition'), amount=15000)
        request = self.factory.get(f'/api/finance/fee-structures/{structure.id}/')
        request.user = self.finance_user
        response = FeeStructureDetailAPIView.as_view()(request, structure_id=structure.id)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data['items']), 1)


class StudentFeeItemEnrollmentSetAPITests(FinanceAPITestData):
    def test_can_replace_the_enrollment_roster_for_an_item(self):
        structure = FeeStructure.objects.create(grade_level=self.grade, term=self.term, name='Grade 7 - Term 2 2026')
        transport_item = FeeStructureItem.objects.create(
            fee_structure=structure, category=FeeCategory.objects.create(name='Transport'), amount=3000, is_optional=True,
        )
        student_user = User.objects.create_user(username='enrollment_test_student', password='x')
        student = StudentExtra.objects.create(user=student_user)

        request = self.factory.put(
            f'/api/finance/fee-structure-items/{transport_item.id}/enrollments/',
            {'student_ids': [student.id]}, format='json',
        )
        request.user = self.finance_user
        response = StudentFeeItemEnrollmentSetAPIView.as_view()(request, item_id=transport_item.id)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(transport_item.enrollments.count(), 1)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python manage.py test apps.finance.tests.test_views_fee_structures -v 2`
Expected: FAIL — `ImportError: cannot import name 'FeeCategoryListCreateAPIView'`

- [ ] **Step 3: Create `apps/finance/serializers_fees.py`**

```python
from rest_framework import serializers

from apps.finance.models_fees import FeeCategory, FeeStructure, FeeStructureItem


class FeeCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = FeeCategory
        fields = ['id', 'name', 'description']


class FeeStructureItemSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source='category.name', read_only=True)

    class Meta:
        model = FeeStructureItem
        fields = ['id', 'category', 'category_name', 'amount', 'is_optional']


class FeeStructureSerializer(serializers.ModelSerializer):
    class Meta:
        model = FeeStructure
        fields = ['id', 'grade_level', 'term', 'name', 'status', 'created_at']
        read_only_fields = ['status', 'created_at']


class FeeStructureDetailSerializer(FeeStructureSerializer):
    items = FeeStructureItemSerializer(many=True, read_only=True)

    class Meta(FeeStructureSerializer.Meta):
        fields = FeeStructureSerializer.Meta.fields + ['items']
```

- [ ] **Step 4: Append views to `apps/finance/views.py`**

```python
from rest_framework.generics import ListCreateAPIView

from apps.finance.models_fees import FeeCategory, FeeStructure, StudentFeeItemEnrollment
from apps.finance.serializers_fees import FeeCategorySerializer, FeeStructureSerializer, FeeStructureDetailSerializer
from apps.identity.models import StudentExtra


class FeeCategoryListCreateAPIView(ListCreateAPIView):
    queryset = FeeCategory.objects.all().order_by('name')
    serializer_class = FeeCategorySerializer
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'finance.view'
    rbac_edit_permission = 'finance.edit'


class FeeStructureListCreateAPIView(ListCreateAPIView):
    queryset = FeeStructure.objects.all().select_related('grade_level', 'term').order_by('-created_at')
    serializer_class = FeeStructureSerializer
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'finance.view'
    rbac_edit_permission = 'finance.edit'


class FeeStructureDetailAPIView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'finance.view'

    def get(self, request, structure_id):
        structure = FeeStructure.objects.filter(id=structure_id).prefetch_related('items__category').first()
        if structure is None:
            return Response({"error": "Fee structure not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(FeeStructureDetailSerializer(structure).data)


class StudentFeeItemEnrollmentSetAPIView(APIView):
    """PUT replaces the entire enrollment roster for one optional
    FeeStructureItem with the given student_ids — the "checklist" UI action
    from spec section 4.3."""
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_edit_permission = 'finance.edit'

    def put(self, request, item_id):
        student_ids = request.data.get('student_ids', [])
        valid_student_ids = list(StudentExtra.objects.filter(id__in=student_ids).values_list('id', flat=True))
        StudentFeeItemEnrollment.objects.filter(fee_structure_item_id=item_id).exclude(student_id__in=valid_student_ids).delete()
        existing_ids = set(
            StudentFeeItemEnrollment.objects.filter(fee_structure_item_id=item_id).values_list('student_id', flat=True)
        )
        StudentFeeItemEnrollment.objects.bulk_create([
            StudentFeeItemEnrollment(student_id=student_id, fee_structure_item_id=item_id)
            for student_id in valid_student_ids if student_id not in existing_ids
        ])
        return Response({"status": "ok", "enrolled_count": len(valid_student_ids)})
```

- [ ] **Step 5: Append routes to `apps/finance/urls.py`**

```python
from apps.finance.views import (
    FeeCategoryListCreateAPIView, FeeStructureListCreateAPIView,
    FeeStructureDetailAPIView, StudentFeeItemEnrollmentSetAPIView,
)

urlpatterns += [
    path('api/finance/fee-categories/', FeeCategoryListCreateAPIView.as_view(), name='api_fee_categories'),
    path('api/finance/fee-structures/', FeeStructureListCreateAPIView.as_view(), name='api_fee_structures'),
    path('api/finance/fee-structures/<int:structure_id>/', FeeStructureDetailAPIView.as_view(), name='api_fee_structure_detail'),
    path('api/finance/fee-structure-items/<int:item_id>/enrollments/', StudentFeeItemEnrollmentSetAPIView.as_view(), name='api_fee_structure_item_enrollments'),
]
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `python manage.py test apps.finance.tests.test_views_fee_structures -v 2`
Expected: PASS (5 tests)

- [ ] **Step 7: Commit**

```bash
git add apps/finance/serializers_fees.py apps/finance/views.py apps/finance/urls.py apps/finance/tests/test_views_fee_structures.py
git commit -m "feat(finance): add fee category/structure/enrollment API endpoints"
```

---

### Task 16: API — invoices, payments, void, adjustments, student ledger statement, fee-clear status

**Files:**
- Modify: `apps/finance/serializers_fees.py`
- Modify: `apps/finance/views.py`
- Modify: `apps/finance/urls.py`
- Test: `apps/finance/tests/test_views_invoices_payments.py`

**Interfaces:**
- Consumes: `generate_invoice_for_student`, `record_payment`, `void_invoice`, `void_payment`, `create_adjustment`, `is_fees_clear` (Tasks 8, 10-12).
- Produces: `InvoiceListAPIView`, `InvoiceDetailAPIView`, `PaymentListCreateAPIView`, `VoidInvoiceAPIView`, `VoidPaymentAPIView`, `StudentFeeAdjustmentCreateAPIView`, `StudentFeeLedgerStatementAPIView`, `FeeClearanceStatusAPIView`.

- [ ] **Step 1: Write the failing tests**

```python
# apps/finance/tests/test_views_invoices_payments.py
from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIRequestFactory

from apps.academics.models import AcademicYear, ExamTerm, GradeLevel, Curriculum, Tier
from apps.identity.models import Permission, Role, UserRole, StudentExtra
from apps.finance.models_fees import FeeCategory, FeeStructure, FeeStructureItem
from apps.finance.services_fees import generate_invoice_for_student
from apps.finance.views import (
    InvoiceListAPIView, PaymentListCreateAPIView, VoidInvoiceAPIView,
    StudentFeeAdjustmentCreateAPIView, StudentFeeLedgerStatementAPIView, FeeClearanceStatusAPIView,
)


class InvoicePaymentAPITestData(TestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        curriculum = Curriculum.objects.create(name='CBC')
        tier = Tier.objects.create(name='Junior School', curriculum=curriculum)
        grade = GradeLevel.objects.create(name='Grade 7', numeric_order=7, curriculum_type='CBC', curriculum=curriculum, tier=tier)
        year = AcademicYear.objects.create(year='2026', is_active=True)
        term = ExamTerm.objects.create(name='Term 2', academic_year=year, start_date='2026-05-01', end_date='2026-08-01')
        structure = FeeStructure.objects.create(grade_level=grade, term=term, name='Grade 7 - Term 2 2026')
        FeeStructureItem.objects.create(fee_structure=structure, category=FeeCategory.objects.create(name='Tuition'), amount=15000)

        for code in ['finance.view', 'finance.edit', 'finance.record_payment', 'finance.void', 'finance.approve_adjustment']:
            Permission.objects.get_or_create(code=code, defaults={'label': code, 'module': 'Finance'})
        role, _ = Role.objects.get_or_create(name='Finance Officer Test Role 2')
        role.permissions.set(Permission.objects.filter(code__startswith='finance.'))
        self.finance_user = User.objects.create_user(username='finance_officer_test_2', password='x')
        UserRole.objects.create(user=self.finance_user, role=role)

        student_user = User.objects.create_user(username='invoice_payment_student', password='x')
        self.student = StudentExtra.objects.create(user=student_user)
        self.invoice = generate_invoice_for_student(student=self.student, fee_structure=structure, operator=self.finance_user)


class InvoiceListAPITests(InvoicePaymentAPITestData):
    def test_can_list_invoices_for_a_student(self):
        request = self.factory.get(f'/api/finance/invoices/?student_id={self.student.id}')
        request.user = self.finance_user
        response = InvoiceListAPIView.as_view()(request)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)


class PaymentCreateAPITests(InvoicePaymentAPITestData):
    def test_can_record_a_payment(self):
        request = self.factory.post('/api/finance/payments/', {
            'student': self.student.id, 'invoice': self.invoice.id, 'amount': 5000,
            'method': 'cash', 'date': '2026-09-09',
        }, format='json')
        request.user = self.finance_user
        response = PaymentListCreateAPIView.as_view()(request)
        self.assertEqual(response.status_code, 201)
        self.assertIn('receipt_number', response.data)


class VoidInvoiceAPITests(InvoicePaymentAPITestData):
    def test_can_void_an_invoice_with_a_reason(self):
        request = self.factory.post(f'/api/finance/invoices/{self.invoice.id}/void/', {'reason': 'Duplicate'}, format='json')
        request.user = self.finance_user
        response = VoidInvoiceAPIView.as_view()(request, invoice_id=self.invoice.id)
        self.assertEqual(response.status_code, 200)
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.status, 'voided')

    def test_void_without_reason_returns_400(self):
        request = self.factory.post(f'/api/finance/invoices/{self.invoice.id}/void/', {'reason': ''}, format='json')
        request.user = self.finance_user
        response = VoidInvoiceAPIView.as_view()(request, invoice_id=self.invoice.id)
        self.assertEqual(response.status_code, 400)


class AdjustmentAPITests(InvoicePaymentAPITestData):
    def test_positive_adjustment_needs_no_approver(self):
        request = self.factory.post('/api/finance/adjustments/', {
            'student': self.student.id, 'adjustment_type': 'correction', 'amount': 500, 'reason': 'fix',
        }, format='json')
        request.user = self.finance_user
        response = StudentFeeAdjustmentCreateAPIView.as_view()(request)
        self.assertEqual(response.status_code, 201)

    def test_negative_adjustment_without_approver_returns_400(self):
        request = self.factory.post('/api/finance/adjustments/', {
            'student': self.student.id, 'adjustment_type': 'scholarship', 'amount': -1000, 'reason': 'merit',
        }, format='json')
        request.user = self.finance_user
        response = StudentFeeAdjustmentCreateAPIView.as_view()(request)
        self.assertEqual(response.status_code, 400)


class StudentLedgerStatementAPITests(InvoicePaymentAPITestData):
    def test_returns_ledger_history_and_balance(self):
        request = self.factory.get(f'/api/finance/students/{self.student.id}/ledger/')
        request.user = self.finance_user
        response = StudentFeeLedgerStatementAPIView.as_view()(request, student_id=self.student.id)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['balance'], 15000)
        self.assertEqual(len(response.data['entries']), 1)


class FeeClearanceStatusAPITests(InvoicePaymentAPITestData):
    def test_returns_not_clear_when_balance_owed(self):
        request = self.factory.get(f'/api/finance/students/{self.student.id}/fee-clearance/?term_id=1')
        request.user = self.finance_user
        response = FeeClearanceStatusAPIView.as_view()(request, student_id=self.student.id)
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data['is_clear'])
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python manage.py test apps.finance.tests.test_views_invoices_payments -v 2`
Expected: FAIL — `ImportError: cannot import name 'InvoiceListAPIView'`

- [ ] **Step 3: Append serializers to `apps/finance/serializers_fees.py`**

```python
from apps.finance.models_fees import Invoice, InvoiceLineItem, Payment, StudentFeeAdjustment, StudentFeeLedgerEntry


class InvoiceLineItemReadSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source='category.name', read_only=True)

    class Meta:
        model = InvoiceLineItem
        fields = ['id', 'category_name', 'description', 'amount']


class InvoiceSerializer(serializers.ModelSerializer):
    line_items = InvoiceLineItemReadSerializer(many=True, read_only=True)

    class Meta:
        model = Invoice
        fields = ['id', 'student', 'fee_structure', 'total', 'status', 'invoice_number', 'issued_at', 'line_items']
        read_only_fields = ['total', 'status', 'invoice_number', 'issued_at']


class PaymentSerializer(serializers.ModelSerializer):
    receipt_number = serializers.CharField(source='receipt.receipt_number', read_only=True)

    class Meta:
        model = Payment
        fields = ['id', 'student', 'invoice', 'amount', 'method', 'reference', 'status', 'date', 'receipt_number']
        read_only_fields = ['status', 'receipt_number']


class StudentFeeAdjustmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = StudentFeeAdjustment
        fields = ['id', 'student', 'category', 'adjustment_type', 'amount', 'reason', 'approved_by', 'created_at']
        read_only_fields = ['created_at']


class StudentFeeLedgerEntrySerializer(serializers.ModelSerializer):
    class Meta:
        model = StudentFeeLedgerEntry
        fields = ['id', 'entry_type', 'amount', 'running_balance', 'description', 'date']
```

- [ ] **Step 4: Append views to `apps/finance/views.py`**

```python
from django.core.exceptions import ValidationError as DjangoValidationError

from apps.finance.models_fees import Invoice, Payment, StudentFeeLedgerEntry
from apps.finance.serializers_fees import (
    InvoiceSerializer, PaymentSerializer, StudentFeeAdjustmentSerializer, StudentFeeLedgerEntrySerializer,
)
from apps.finance.services_fees import record_payment, void_invoice, void_payment, create_adjustment, is_fees_clear


class InvoiceListAPIView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'finance.view'

    def get(self, request):
        invoices = Invoice.objects.all().select_related('fee_structure')
        student_id = request.query_params.get('student_id')
        if student_id:
            invoices = invoices.filter(student_id=student_id)
        return Response(InvoiceSerializer(invoices.order_by('-issued_at'), many=True).data)


class PaymentListCreateAPIView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'finance.view'
    rbac_edit_permission = 'finance.record_payment'

    def get(self, request):
        payments = Payment.objects.all()
        student_id = request.query_params.get('student_id')
        if student_id:
            payments = payments.filter(student_id=student_id)
        return Response(PaymentSerializer(payments.order_by('-date'), many=True).data)

    def post(self, request):
        invoice = Invoice.objects.filter(id=request.data.get('invoice')).first() if request.data.get('invoice') else None
        student = StudentExtra.objects.filter(id=request.data.get('student')).first()
        if student is None:
            return Response({"error": "student is required and must exist."}, status=status.HTTP_400_BAD_REQUEST)
        payment, receipt = record_payment(
            student=student, amount=request.data.get('amount'), method=request.data.get('method'),
            recorded_by=request.user, invoice=invoice, reference=request.data.get('reference', ''),
            date=request.data.get('date'),
        )
        data = PaymentSerializer(payment).data
        data['receipt_number'] = receipt.receipt_number
        return Response(data, status=status.HTTP_201_CREATED)


class VoidInvoiceAPIView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_edit_permission = 'finance.void'

    def post(self, request, invoice_id):
        invoice = Invoice.objects.filter(id=invoice_id).first()
        if invoice is None:
            return Response({"error": "Invoice not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            void_invoice(invoice=invoice, voided_by=request.user, reason=request.data.get('reason', ''))
        except DjangoValidationError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(InvoiceSerializer(invoice).data)


class VoidPaymentAPIView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_edit_permission = 'finance.void'

    def post(self, request, payment_id):
        payment = Payment.objects.filter(id=payment_id).first()
        if payment is None:
            return Response({"error": "Payment not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            void_payment(payment=payment, voided_by=request.user, reason=request.data.get('reason', ''))
        except DjangoValidationError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(PaymentSerializer(payment).data)


class StudentFeeAdjustmentCreateAPIView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_edit_permission = 'finance.approve_adjustment'

    def post(self, request):
        student = StudentExtra.objects.filter(id=request.data.get('student')).first()
        if student is None:
            return Response({"error": "student is required and must exist."}, status=status.HTTP_400_BAD_REQUEST)
        approved_by = None
        if request.data.get('approved_by'):
            approved_by = User.objects.filter(id=request.data['approved_by']).first()
        try:
            adjustment = create_adjustment(
                student=student, adjustment_type=request.data.get('adjustment_type'),
                amount=request.data.get('amount'), reason=request.data.get('reason', ''),
                requested_by=request.user, category_id=request.data.get('category'), approved_by=approved_by,
            )
        except DjangoValidationError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(StudentFeeAdjustmentSerializer(adjustment).data, status=status.HTTP_201_CREATED)


class StudentFeeLedgerStatementAPIView(APIView):
    """Powers both the admin student-ledger view and the parent/student
    read-only fee statement page (Task 21)."""
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request, student_id):
        if not (_is_admin(request.user) or user_has_permission(request.user, 'finance.view')
                or getattr(request.user, 'studentextra', None) and request.user.studentextra.id == student_id):
            return Response({"error": "Not authorized to view this student's fee ledger."}, status=status.HTTP_403_FORBIDDEN)
        entries = StudentFeeLedgerEntry.objects.filter(student_id=student_id).order_by('-id')
        balance = entries.first().running_balance if entries.exists() else 0
        return Response({
            "balance": balance,
            "entries": StudentFeeLedgerEntrySerializer(entries, many=True).data,
        })


class FeeClearanceStatusAPIView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'finance.view'

    def get(self, request, student_id):
        term_id = request.query_params.get('term_id')
        grace_threshold = int(request.query_params.get('grace_threshold', 0))
        is_clear = is_fees_clear(student_id=student_id, term_id=term_id, grace_threshold=grace_threshold)
        return Response({"is_clear": is_clear})
```

Note: this requires `FeeCategory` to be importable in `services_fees.py` — add `from apps.finance.models_fees import FeeCategory` to that file's imports now if the module doesn't already reference it directly (it may already be implicitly available via `from apps.finance.models_fees import *`-style grouped imports from earlier tasks; check before adding a duplicate).

Also, `create_adjustment` in Task 5 takes `category=None` (a `FeeCategory` instance), not `category_id` — update that function's signature in `services_fees.py` right now to accept `category_id=None` and resolve it internally, since the view layer only has an id from JSON, not an instance:

```python
def create_adjustment(*, student, adjustment_type, amount, reason, requested_by, category_id=None, approved_by=None):
    category = FeeCategory.objects.filter(id=category_id).first() if category_id else None
    ...  # rest of the function body from Task 5 is unchanged below this line
```

Also update the two call sites in `apps/finance/tests/test_adjustments.py` (Task 5) that pass `category=...` — they don't pass `category` at all in that test file, so no change needed there; this is only a heads-up in case a future task calls it with the old keyword.

- [ ] **Step 5: Append imports needed by the new views**

At the top of `apps/finance/views.py`, ensure these are present (some already are from earlier tasks): `from django.contrib.auth.models import User`, `from school.rbac import user_has_permission` (for the ledger statement's self-access check — `_is_admin` should already be imported since `FinanceOverviewAPI` uses it).

- [ ] **Step 6: Append routes to `apps/finance/urls.py`**

```python
from apps.finance.views import (
    InvoiceListAPIView, PaymentListCreateAPIView, VoidInvoiceAPIView, VoidPaymentAPIView,
    StudentFeeAdjustmentCreateAPIView, StudentFeeLedgerStatementAPIView, FeeClearanceStatusAPIView,
)

urlpatterns += [
    path('api/finance/invoices/', InvoiceListAPIView.as_view(), name='api_invoices'),
    path('api/finance/invoices/<int:invoice_id>/void/', VoidInvoiceAPIView.as_view(), name='api_void_invoice'),
    path('api/finance/payments/', PaymentListCreateAPIView.as_view(), name='api_payments'),
    path('api/finance/payments/<int:payment_id>/void/', VoidPaymentAPIView.as_view(), name='api_void_payment'),
    path('api/finance/adjustments/', StudentFeeAdjustmentCreateAPIView.as_view(), name='api_fee_adjustments'),
    path('api/finance/students/<int:student_id>/ledger/', StudentFeeLedgerStatementAPIView.as_view(), name='api_student_fee_ledger'),
    path('api/finance/students/<int:student_id>/fee-clearance/', FeeClearanceStatusAPIView.as_view(), name='api_fee_clearance_status'),
]
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `python manage.py test apps.finance.tests.test_views_invoices_payments -v 2`
Expected: PASS (7 tests)

- [ ] **Step 8: Run the full finance test suite so far to confirm nothing broke**

Run: `python manage.py test apps.finance -v 2`
Expected: PASS (all tests from Tasks 1-16)

- [ ] **Step 9: Commit**

```bash
git add apps/finance/serializers_fees.py apps/finance/views.py apps/finance/urls.py apps/finance/services_fees.py apps/finance/tests/test_views_invoices_payments.py
git commit -m "feat(finance): add invoice/payment/void/adjustment/ledger-statement/fee-clearance API endpoints"
```

---

### Task 17: PDF generation (WeasyPrint) — invoice and receipt documents

**No PDF library exists anywhere in this repo today** (confirmed by repo-wide grep) — this task establishes the first one. There is also no existing school-name/logo/branding config model anywhere in the codebase, so the templates below stay deliberately minimal/generic (invoice number, student, line items, total) rather than inventing a fake school name or logo — add real branding later, once a real config source for it exists, instead of hardcoding one now.

**Files:**
- Modify: `requirements.txt` (add `weasyprint`, do not `pip install` — user installs)
- Create: `apps/finance/services_documents.py`
- Create: `apps/finance/templates/finance/invoice_pdf.html`
- Create: `apps/finance/templates/finance/receipt_pdf.html`
- Modify: `apps/finance/views.py`
- Modify: `apps/finance/urls.py`
- Test: `apps/finance/tests/test_documents.py`

**Interfaces:**
- Produces: `render_invoice_pdf(invoice) -> bytes`, `render_receipt_pdf(receipt) -> bytes` in `services_documents.py`. `InvoicePDFAPIView`, `ReceiptPDFAPIView` download endpoints.

- [ ] **Step 1: Add `weasyprint` to `requirements.txt`**

Add this line (do not run `pip install` — tell the user to run it):

```text
weasyprint>=62.0
```

```text
Dependency install required (not run automatically):
pip install -r requirements.txt
```

- [ ] **Step 2: Write the failing tests**

```python
# apps/finance/tests/test_documents.py
from django.contrib.auth.models import User
from django.test import TestCase

from apps.academics.models import AcademicYear, ExamTerm, GradeLevel, Curriculum, Tier
from apps.identity.models import StudentExtra
from apps.finance.models_fees import FeeCategory, FeeStructure, FeeStructureItem
from apps.finance.services_fees import generate_invoice_for_student, record_payment
from apps.finance.services_documents import render_invoice_pdf, render_receipt_pdf


class DocumentGenerationTests(TestCase):
    def setUp(self):
        curriculum = Curriculum.objects.create(name='CBC')
        tier = Tier.objects.create(name='Junior School', curriculum=curriculum)
        grade = GradeLevel.objects.create(name='Grade 7', numeric_order=7, curriculum_type='CBC', curriculum=curriculum, tier=tier)
        year = AcademicYear.objects.create(year='2026', is_active=True)
        term = ExamTerm.objects.create(name='Term 2', academic_year=year, start_date='2026-05-01', end_date='2026-08-01')
        structure = FeeStructure.objects.create(grade_level=grade, term=term, name='Grade 7 - Term 2 2026')
        FeeStructureItem.objects.create(fee_structure=structure, category=FeeCategory.objects.create(name='Tuition'), amount=15000)
        operator = User.objects.create_user(username='pdf_test_operator', password='x')
        student_user = User.objects.create_user(username='pdf_test_student', password='x')
        student = StudentExtra.objects.create(user=student_user)
        self.invoice = generate_invoice_for_student(student=student, fee_structure=structure, operator=operator)
        _, self.receipt = record_payment(student=student, amount=15000, method='cash', recorded_by=operator, invoice=self.invoice, date='2026-09-09')

    def test_render_invoice_pdf_returns_pdf_bytes(self):
        pdf_bytes = render_invoice_pdf(self.invoice)
        self.assertTrue(pdf_bytes.startswith(b'%PDF'))

    def test_render_receipt_pdf_returns_pdf_bytes(self):
        pdf_bytes = render_receipt_pdf(self.receipt)
        self.assertTrue(pdf_bytes.startswith(b'%PDF'))
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `python manage.py test apps.finance.tests.test_documents -v 2`
Expected: FAIL — `ModuleNotFoundError: No module named 'apps.finance.services_documents'` (and, until the user runs `pip install`, `ModuleNotFoundError: No module named 'weasyprint'` — this task's tests cannot pass until that install happens; call this out to the user rather than treating it as a bug in the code)

- [ ] **Step 4: Create the two templates**

```html
<!-- apps/finance/templates/finance/invoice_pdf.html -->
<!DOCTYPE html>
<html>
<head>
<style>
  body { font-family: sans-serif; font-size: 12px; color: #1a1a1a; }
  h1 { font-size: 18px; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
  .total-row td { font-weight: bold; }
</style>
</head>
<body>
  <h1>Invoice {{ invoice.invoice_number }}</h1>
  <p>Student: {{ invoice.student.user.get_full_name }}</p>
  <p>Issued: {{ invoice.issued_at|date:"Y-m-d" }}</p>
  <table>
    <thead><tr><th>Category</th><th>Description</th><th>Amount</th></tr></thead>
    <tbody>
      {% for item in line_items %}
      <tr><td>{{ item.category.name }}</td><td>{{ item.description }}</td><td>{{ item.amount }}</td></tr>
      {% endfor %}
      <tr class="total-row"><td colspan="2">Total</td><td>{{ invoice.total }}</td></tr>
    </tbody>
  </table>
</body>
</html>
```

```html
<!-- apps/finance/templates/finance/receipt_pdf.html -->
<!DOCTYPE html>
<html>
<head>
<style>
  body { font-family: sans-serif; font-size: 12px; color: #1a1a1a; }
  h1 { font-size: 18px; }
</style>
</head>
<body>
  <h1>Receipt {{ receipt.receipt_number }}</h1>
  <p>Student: {{ payment.student.user.get_full_name }}</p>
  <p>Amount received: {{ payment.amount }}</p>
  <p>Method: {{ payment.get_method_display }}</p>
  <p>Date: {{ payment.date|date:"Y-m-d" }}</p>
  {% if payment.invoice %}<p>Applied to invoice: {{ payment.invoice.invoice_number }}</p>{% endif %}
</body>
</html>
```

- [ ] **Step 5: Create `apps/finance/services_documents.py`**

```python
"""PDF generation for formal finance documents. No school-name/logo branding
config exists anywhere in this codebase yet, so these templates stay
deliberately minimal (invoice/receipt number, student, line items, total)
rather than inventing a fake school name or logo — add real branding once a
real config source for it exists."""
from django.template.loader import render_to_string
from weasyprint import HTML


def render_invoice_pdf(invoice):
    html_string = render_to_string('finance/invoice_pdf.html', {
        'invoice': invoice, 'line_items': invoice.line_items.select_related('category').all(),
    })
    return HTML(string=html_string).write_pdf()


def render_receipt_pdf(receipt):
    html_string = render_to_string('finance/receipt_pdf.html', {
        'receipt': receipt, 'payment': receipt.payment,
    })
    return HTML(string=html_string).write_pdf()
```

- [ ] **Step 6: Add download views to `apps/finance/views.py`**

```python
from django.http import HttpResponse

from apps.finance.services_documents import render_invoice_pdf, render_receipt_pdf
from apps.finance.models_fees import Receipt


class InvoicePDFAPIView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'finance.view'

    def get(self, request, invoice_id):
        invoice = Invoice.objects.filter(id=invoice_id).first()
        if invoice is None:
            return Response({"error": "Invoice not found."}, status=status.HTTP_404_NOT_FOUND)
        pdf_bytes = render_invoice_pdf(invoice)
        response = HttpResponse(pdf_bytes, content_type='application/pdf')
        response['Content-Disposition'] = f'inline; filename="{invoice.invoice_number}.pdf"'
        return response


class ReceiptPDFAPIView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'finance.view'

    def get(self, request, receipt_id):
        receipt = Receipt.objects.filter(id=receipt_id).first()
        if receipt is None:
            return Response({"error": "Receipt not found."}, status=status.HTTP_404_NOT_FOUND)
        pdf_bytes = render_receipt_pdf(receipt)
        response = HttpResponse(pdf_bytes, content_type='application/pdf')
        response['Content-Disposition'] = f'inline; filename="{receipt.receipt_number}.pdf"'
        return response
```

- [ ] **Step 7: Add routes to `apps/finance/urls.py`**

```python
from apps.finance.views import InvoicePDFAPIView, ReceiptPDFAPIView

urlpatterns += [
    path('api/finance/invoices/<int:invoice_id>/pdf/', InvoicePDFAPIView.as_view(), name='api_invoice_pdf'),
    path('api/finance/receipts/<int:receipt_id>/pdf/', ReceiptPDFAPIView.as_view(), name='api_receipt_pdf'),
]
```

- [ ] **Step 8: Run tests to verify they pass (after the user has installed weasyprint)**

Run: `python manage.py test apps.finance.tests.test_documents -v 2`
Expected: PASS (2 tests) — but only after `pip install -r requirements.txt` has actually been run; do not treat a `ModuleNotFoundError: weasyprint` here as a code defect.

- [ ] **Step 9: Commit**

```bash
git add requirements.txt apps/finance/services_documents.py apps/finance/templates apps/finance/views.py apps/finance/urls.py apps/finance/tests/test_documents.py
git commit -m "feat(finance): add WeasyPrint-based invoice and receipt PDF generation"
```

---

### Task 18: Reporting — KPI tiles, collections trend, category breakdown, aging list

All read-only, no new stored aggregates beyond `StudentFeeLedgerEntry.running_balance` — per spec section 8. Uses Postgres's `.distinct(field)` (already used elsewhere in this codebase, e.g. `StudentExtra`'s GIN trigram index note) to get each student's latest ledger entry efficiently.

**Files:**
- Create: `apps/finance/services_reports.py`
- Modify: `apps/finance/views.py`
- Modify: `apps/finance/urls.py`
- Test: `apps/finance/tests/test_reports.py`

**Interfaces:**
- Produces: `fee_kpi_tiles()`, `collections_trend(days=30)`, `fee_category_breakdown()`, `student_balance_aging()` in `services_reports.py`. `FeeKPITilesAPIView`, `CollectionsTrendAPIView`, `FeeCategoryBreakdownAPIView`, `StudentBalanceAgingAPIView`.

- [ ] **Step 1: Write the failing tests**

```python
# apps/finance/tests/test_reports.py
from django.contrib.auth.models import User
from django.test import TestCase

from apps.academics.models import AcademicYear, ExamTerm, GradeLevel, Curriculum, Tier
from apps.identity.models import StudentExtra
from apps.finance.models_fees import FeeCategory, FeeStructure, FeeStructureItem
from apps.finance.services_fees import generate_invoice_for_student, record_payment
from apps.finance.services_reports import fee_kpi_tiles, collections_trend, fee_category_breakdown, student_balance_aging


class ReportsTestData(TestCase):
    def setUp(self):
        curriculum = Curriculum.objects.create(name='CBC')
        tier = Tier.objects.create(name='Junior School', curriculum=curriculum)
        grade = GradeLevel.objects.create(name='Grade 7', numeric_order=7, curriculum_type='CBC', curriculum=curriculum, tier=tier)
        year = AcademicYear.objects.create(year='2026', is_active=True)
        term = ExamTerm.objects.create(name='Term 2', academic_year=year, start_date='2026-05-01', end_date='2026-08-01')
        structure = FeeStructure.objects.create(grade_level=grade, term=term, name='Grade 7 - Term 2 2026')
        self.category = FeeCategory.objects.create(name='Tuition')
        FeeStructureItem.objects.create(fee_structure=structure, category=self.category, amount=15000)
        self.operator = User.objects.create_user(username='reports_operator', password='x')
        student_user = User.objects.create_user(username='reports_student', password='x')
        self.student = StudentExtra.objects.create(user=student_user)
        self.invoice = generate_invoice_for_student(student=self.student, fee_structure=structure, operator=self.operator)
        record_payment(student=self.student, amount=5000, method='cash', recorded_by=self.operator, invoice=self.invoice, date='2026-09-09')


class FeeKPITilesTests(ReportsTestData):
    def test_outstanding_ar_reflects_unpaid_balance(self):
        kpis = fee_kpi_tiles()
        self.assertEqual(kpis['outstanding_ar'], 10000)

    def test_unpaid_invoice_count_includes_partially_paid(self):
        kpis = fee_kpi_tiles()
        self.assertEqual(kpis['unpaid_invoice_count'], 1)

    def test_collections_30d_includes_recent_payment(self):
        kpis = fee_kpi_tiles()
        self.assertEqual(kpis['collections_30d'], 5000)


class CollectionsTrendTests(ReportsTestData):
    def test_trend_includes_todays_payment(self):
        trend = collections_trend(days=30)
        self.assertEqual(len(trend), 1)
        self.assertEqual(trend[0]['total'], 5000)


class FeeCategoryBreakdownTests(ReportsTestData):
    def test_breakdown_groups_by_category(self):
        breakdown = fee_category_breakdown()
        self.assertEqual(breakdown[0]['category__name'], 'Tuition')
        self.assertEqual(breakdown[0]['total'], 15000)


class StudentBalanceAgingTests(ReportsTestData):
    def test_student_with_positive_balance_is_listed(self):
        aging = student_balance_aging()
        self.assertEqual(len(aging), 1)
        self.assertEqual(aging[0]['balance'], 10000)

    def test_student_with_zero_balance_is_not_listed(self):
        record_payment(student=self.student, amount=10000, method='cash', recorded_by=self.operator, invoice=self.invoice, date='2026-09-09')
        aging = student_balance_aging()
        self.assertEqual(len(aging), 0)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python manage.py test apps.finance.tests.test_reports -v 2`
Expected: FAIL — `ModuleNotFoundError: No module named 'apps.finance.services_reports'`

- [ ] **Step 3: Create `apps/finance/services_reports.py`**

```python
"""Read-only cross-cutting fee reporting. Every function here only reads —
never writes across module boundaries, per spec section 3."""
from datetime import timedelta

from django.db.models import Sum
from django.utils import timezone

from apps.finance.models_fees import Invoice, InvoiceLineItem, Payment, StudentFeeLedgerEntry


def _latest_ledger_entry_per_student():
    """One row per student: their most recent StudentFeeLedgerEntry, i.e. their
    current balance. Uses Postgres's DISTINCT ON via .distinct(field) —
    already the established pattern in this codebase for this kind of
    'latest row per group' query."""
    return StudentFeeLedgerEntry.objects.order_by('student_id', '-id').distinct('student_id').select_related('student__user')


def fee_kpi_tiles():
    latest_entries = list(_latest_ledger_entry_per_student())
    outstanding_ar = sum(e.running_balance for e in latest_entries if e.running_balance > 0)
    unpaid_invoice_count = Invoice.objects.exclude(status__in=['paid', 'voided']).count()
    overdue_count = Invoice.objects.filter(status='overdue').count()
    thirty_days_ago = timezone.now().date() - timedelta(days=30)
    collections_30d = Payment.objects.filter(
        voided_at__isnull=True, status='confirmed', date__gte=thirty_days_ago,
    ).aggregate(total=Sum('amount'))['total'] or 0
    return {
        'outstanding_ar': outstanding_ar,
        'unpaid_invoice_count': unpaid_invoice_count,
        'overdue_count': overdue_count,
        'collections_30d': collections_30d,
    }


def collections_trend(days=30):
    since = timezone.now().date() - timedelta(days=days)
    rows = (
        Payment.objects.filter(voided_at__isnull=True, status='confirmed', date__gte=since)
        .values('date').annotate(total=Sum('amount')).order_by('date')
    )
    return list(rows)


def fee_category_breakdown():
    rows = (
        InvoiceLineItem.objects.exclude(invoice__status='voided')
        .values('category__name').annotate(total=Sum('amount')).order_by('-total')
    )
    return list(rows)


def student_balance_aging():
    today = timezone.now().date()
    rows = []
    for entry in _latest_ledger_entry_per_student():
        if entry.running_balance > 0:
            rows.append({
                'student_id': entry.student_id,
                'student_name': entry.student.user.get_full_name(),
                'balance': entry.running_balance,
                'days_since_last_activity': (today - entry.date).days,
            })
    return sorted(rows, key=lambda row: -row['days_since_last_activity'])
```

- [ ] **Step 4: Add views to `apps/finance/views.py`**

```python
from apps.finance import services_reports


class FeeKPITilesAPIView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'finance.view'

    def get(self, request):
        return Response(services_reports.fee_kpi_tiles())


class CollectionsTrendAPIView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'finance.view'

    def get(self, request):
        days = int(request.query_params.get('days', 30))
        return Response(services_reports.collections_trend(days=days))


class FeeCategoryBreakdownAPIView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'finance.view'

    def get(self, request):
        return Response(services_reports.fee_category_breakdown())


class StudentBalanceAgingAPIView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'finance.view'

    def get(self, request):
        return Response(services_reports.student_balance_aging())
```

- [ ] **Step 5: Add routes to `apps/finance/urls.py`**

```python
from apps.finance.views import (
    FeeKPITilesAPIView, CollectionsTrendAPIView, FeeCategoryBreakdownAPIView, StudentBalanceAgingAPIView,
)

urlpatterns += [
    path('api/finance/reports/kpi-tiles/', FeeKPITilesAPIView.as_view(), name='api_fee_kpi_tiles'),
    path('api/finance/reports/collections-trend/', CollectionsTrendAPIView.as_view(), name='api_collections_trend'),
    path('api/finance/reports/category-breakdown/', FeeCategoryBreakdownAPIView.as_view(), name='api_fee_category_breakdown'),
    path('api/finance/reports/student-aging/', StudentBalanceAgingAPIView.as_view(), name='api_student_balance_aging'),
]
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `python manage.py test apps.finance.tests.test_reports -v 2`
Expected: PASS (6 tests)

- [ ] **Step 7: Commit**

```bash
git add apps/finance/services_reports.py apps/finance/views.py apps/finance/urls.py apps/finance/tests/test_reports.py
git commit -m "feat(finance): add fee reporting — KPI tiles, collections trend, category breakdown, aging"
```

---

### Task 19: Report-card gate — wire `is_fees_clear()` into `StudentReportCardAPIView`

`StudentReportCardAPIView.get()` at `school/views/results_views.py:403-490` already blocks students/parents from seeing an unpublished report card (lines 488-490). This task adds the same shape of check for fee clearance, right after it, and starts actually using the dormant `StudentTermResult.results_withheld` field (`apps/results/models.py:73`) that's been defined but never read or written anywhere in the codebase — this is exactly the field it was meant for.

**Files:**
- Modify: `school/views/results_views.py`
- Test: `school/tests/test_report_card_fee_gate.py`

**Interfaces:**
- Consumes: `is_fees_clear` from `apps.finance.services` (Task 12).

- [ ] **Step 1: Write the failing tests**

```python
# school/tests/test_report_card_fee_gate.py
from django.test import TestCase
from rest_framework.test import APIRequestFactory

from apps.results.models import StudentTermResult
from apps.finance.services_fees import post_ledger_entry
from apps.finance.models_fees import FeeCategory
from school.tests.base import ExamTestDataMixin
from school.views.results_views import StudentReportCardAPIView


class ReportCardFeeGateTests(ExamTestDataMixin, TestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        self.view = StudentReportCardAPIView.as_view()
        self.term_summary = StudentTermResult.objects.create(
            student=self.student, term=self.term, class_stream=self.stream_cbc,
            total_marks=805.67, mean_marks=72.73, mean_grade='EE',
            stream_position=1, is_published=True,
        )
        self.category = FeeCategory.objects.create(name='Tuition')

    def _get(self, user, search=''):
        request = self.factory.get('/api/results/report-card/', {'search': search})
        request.user = user
        return self.view(request)

    def test_student_with_outstanding_balance_is_blocked(self):
        post_ledger_entry(student=self.student, entry_type='charge', amount=15000, reference=self.category, description='Term fee')
        response = self._get(self.student_user, search=self.student.roll)
        self.assertEqual(response.status_code, 403)
        self.term_summary.refresh_from_db()
        self.assertTrue(self.term_summary.results_withheld)

    def test_student_with_zero_balance_can_view(self):
        response = self._get(self.student_user, search=self.student.roll)
        self.assertEqual(response.status_code, 200)

    def test_admin_can_view_regardless_of_balance(self):
        post_ledger_entry(student=self.student, entry_type='charge', amount=15000, reference=self.category, description='Term fee')
        response = self._get(self.admin_user, search=self.student.roll)
        self.assertEqual(response.status_code, 200)

    def test_results_withheld_clears_once_balance_is_settled(self):
        post_ledger_entry(student=self.student, entry_type='charge', amount=15000, reference=self.category, description='Term fee')
        self._get(self.student_user, search=self.student.roll)
        self.term_summary.refresh_from_db()
        self.assertTrue(self.term_summary.results_withheld)

        post_ledger_entry(student=self.student, entry_type='payment', amount=-15000, reference=self.category, description='Payment')
        response = self._get(self.student_user, search=self.student.roll)
        self.assertEqual(response.status_code, 200)
        self.term_summary.refresh_from_db()
        self.assertFalse(self.term_summary.results_withheld)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python manage.py test school.tests.test_report_card_fee_gate -v 2`
Expected: FAIL — first test gets 200 instead of 403 (no gate wired up yet).

- [ ] **Step 3: Add the fee-clearance check to `school/views/results_views.py`**

Add this import near the top of the file, alongside the other imports:

```python
from apps.finance.services import is_fees_clear
```

Then modify the existing block at lines 488-490 (`if not is_staff and not term_summary.is_published: ...`) to add the fee check immediately after it:

```python
        if not is_staff and not term_summary.is_published:
            return Response({"error": "This terminal report card is currently pending administrative verification."},
                            status=status.HTTP_403_FORBIDDEN)

        if not is_staff:
            fees_clear = is_fees_clear(student_id=student.id, term_id=term_summary.term_id)
            if fees_clear is False:
                if not term_summary.results_withheld:
                    term_summary.results_withheld = True
                    term_summary.save(update_fields=['results_withheld'])
                return Response(
                    {"error": "This report card is withheld pending fee clearance. Please contact the finance office."},
                    status=status.HTTP_403_FORBIDDEN,
                )
            elif term_summary.results_withheld:
                term_summary.results_withheld = False
                term_summary.save(update_fields=['results_withheld'])
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python manage.py test school.tests.test_report_card_fee_gate -v 2`
Expected: PASS (4 tests)

- [ ] **Step 5: Run the pre-existing report-card permission tests to confirm no regression**

Run: `python manage.py test school.tests.test_report_card_permissions -v 2`
Expected: PASS (unchanged — those tests use students with no finance activity at all, so `is_fees_clear` returns `True` for them and the new check is a no-op)

- [ ] **Step 6: Commit**

```bash
git add school/views/results_views.py school/tests/test_report_card_fee_gate.py
git commit -m "feat(finance): gate report-card viewing on fee clearance, using the dormant results_withheld field"
```

---

### Task 20: Promotion gate — wire `is_fees_clear()` into `_promote_student`

`_promote_student` (`school/views/promotion_views.py:203-246`) already returns a non-raising `'held'` outcome when a student isn't ready for other reasons (line 215-216: `if not readiness['ready']: return {..., 'outcome': 'held', ...}`). This task adds the same shape of check for fee clearance, immediately after it and before the transition proceeds — so both the single-student path and the bulk `promote_students_task` Celery path (which calls this same function per student) get the gate automatically.

**Files:**
- Modify: `school/views/promotion_views.py`
- Test: `school/tests/test_promotion_fee_gate.py`

**Interfaces:**
- Consumes: `is_fees_clear` from `apps.finance.services` (Task 12).

- [ ] **Step 1: Write the failing tests**

Mirrors the exact fixture shape of `PromoteStudentTests.test_plain_promotion_succeeds_when_results_finalized` in `school/tests/test_promotion.py:337-350`.

```python
# school/tests/test_promotion_fee_gate.py
from django.contrib.auth.models import User
from django.test import TestCase

from apps.academics.models import AcademicYear, ClassStream, Curriculum, ExamTerm, GradeLevel, Tier
from apps.identity.models import StudentExtra
from apps.finance.models_fees import FeeCategory
from apps.finance.services_fees import post_ledger_entry
from school.views.promotion_views import _promote_student


class PromotionFeeGateTests(TestCase):
    def setUp(self):
        self.curriculum = Curriculum.objects.create(code='CBC7FG', name='CBC (fee gate test)')
        self.year = AcademicYear.objects.create(year='2093')
        tier = Tier.objects.create(curriculum=self.curriculum, name='Lower Primary', code='LP7FG')
        self.g1 = GradeLevel.objects.create(name='Grade 1FG', numeric_order=1, curriculum=self.curriculum, tier=tier)
        self.g2 = GradeLevel.objects.create(name='Grade 2FG', numeric_order=2, curriculum=self.curriculum, tier=tier)
        self.stream = ClassStream.objects.create(name='Central', grade=self.g1)
        user = User.objects.create_user(username='fee_gate_promo_student', password='x')
        self.student = StudentExtra.objects.create(user=user, roll='FG01', cl=self.stream, status=True)
        ExamTerm.objects.create(name='Term 1', academic_year=self.year, start_date='2093-01-01', end_date='2093-04-01', results_finalized=True)
        self.category = FeeCategory.objects.create(name='Tuition')

    def test_promotion_held_when_fees_outstanding(self):
        post_ledger_entry(student=self.student, entry_type='charge', amount=15000, reference=self.category, description='Term fee')
        result = _promote_student(self.student, self.year)
        self.assertEqual(result['outcome'], 'held')
        self.assertIn('fee', result['detail'].lower())
        self.student.refresh_from_db()
        self.assertEqual(self.student.cl_id, self.stream.id)

    def test_promotion_succeeds_once_fees_are_cleared(self):
        post_ledger_entry(student=self.student, entry_type='charge', amount=15000, reference=self.category, description='Term fee')
        post_ledger_entry(student=self.student, entry_type='payment', amount=-15000, reference=self.category, description='Payment')
        result = _promote_student(self.student, self.year)
        self.assertEqual(result['outcome'], 'promoted')
        self.student.refresh_from_db()
        self.assertEqual(self.student.cl.grade_id, self.g2.id)

    def test_promotion_succeeds_when_student_has_no_finance_history_at_all(self):
        result = _promote_student(self.student, self.year)
        self.assertEqual(result['outcome'], 'promoted')
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python manage.py test school.tests.test_promotion_fee_gate -v 2`
Expected: FAIL — `test_promotion_held_when_fees_outstanding` gets `outcome == 'promoted'` instead of `'held'` (no gate wired up yet).

- [ ] **Step 3: Add the fee-clearance check to `school/views/promotion_views.py`**

Add this import near the top of the file, alongside the other imports:

```python
from apps.finance.services import is_fees_clear
```

Then modify `_promote_student` (lines 214-217) to add the fee check immediately after the existing readiness check:

```python
    readiness = _readiness_for_student(student, academic_year)
    if not readiness['ready']:
        return {'student_id': student.id, 'outcome': 'held', 'detail': readiness['reason']}

    # term_id is currently unused by is_fees_clear's implementation (it checks the
    # student's whole-account balance, not a single term — see services_fees.py) —
    # academic_year.id is passed for interface consistency with the report-card gate,
    # which does have a real per-term value available.
    fees_clear = is_fees_clear(student_id=student.id, term_id=academic_year.id)
    if fees_clear is False:
        return {
            'student_id': student.id, 'outcome': 'held',
            'detail': 'Held: outstanding fee balance must be cleared before promotion.',
        }

    transition_type, exam_code, next_grade = readiness['_transition']
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python manage.py test school.tests.test_promotion_fee_gate -v 2`
Expected: PASS (3 tests)

- [ ] **Step 5: Run the pre-existing promotion tests to confirm no regression**

Run: `python manage.py test school.tests.test_promotion school.tests.test_promotion_events school.tests.test_promotion_readiness -v 2`
Expected: PASS (unchanged — those tests use students with no finance activity at all, so `is_fees_clear` returns `True` and the new check is a no-op)

- [ ] **Step 6: Commit**

```bash
git add school/views/promotion_views.py school/tests/test_promotion_fee_gate.py
git commit -m "feat(finance): gate student promotion on fee clearance"
```

---

### Task 21: Frontend — finance API client + Fee Structures admin page

No frontend test suite exists anywhere in this repo (confirmed by research) — this and the remaining frontend tasks are manually verified (dev server + browser), matching the existing convention for this codebase; there is no test step to automate.

**Files:**
- Create: `frontend/src/libs/financeApi.ts`
- Create: `frontend/src/components/Finance/FeeStructuresPage.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `api` default export from `frontend/src/libs/axiosInstance.ts`.
- Produces: typed helper functions in `financeApi.ts` (`listFeeCategories`, `createFeeCategory`, `listFeeStructures`, `createFeeStructure`, `getFeeStructure`, `activateFeeStructure`, `setFeeItemEnrollment`) that every later frontend task imports from.

- [ ] **Step 1: Create `frontend/src/libs/financeApi.ts`**

```typescript
import api from './axiosInstance';

export interface FeeCategory {
  id: number;
  name: string;
  description: string;
}

export interface FeeStructureItem {
  id: number;
  category: number;
  category_name: string;
  amount: number;
  is_optional: boolean;
}

export interface FeeStructure {
  id: number;
  grade_level: number;
  term: number;
  name: string;
  status: 'draft' | 'active';
  created_at: string;
}

export interface FeeStructureDetail extends FeeStructure {
  items: FeeStructureItem[];
}

export interface InvoiceLineItem {
  id: number;
  category_name: string;
  description: string;
  amount: number;
}

export interface Invoice {
  id: number;
  student: number;
  fee_structure: number;
  total: number;
  status: 'unpaid' | 'partially_paid' | 'paid' | 'overdue' | 'voided';
  invoice_number: string;
  issued_at: string;
  line_items: InvoiceLineItem[];
}

export interface Payment {
  id: number;
  student: number;
  invoice: number | null;
  amount: number;
  method: 'cash' | 'bank_transfer' | 'mpesa' | 'cheque' | 'other';
  reference: string;
  status: 'confirmed' | 'pending' | 'failed';
  date: string;
  receipt_number: string | null;
}

export interface LedgerEntry {
  id: number;
  entry_type: 'charge' | 'payment' | 'adjustment';
  amount: number;
  running_balance: number;
  description: string;
  date: string;
}

export const listFeeCategories = () => api.get<FeeCategory[]>('/api/finance/fee-categories/');
export const createFeeCategory = (data: { name: string; description?: string }) =>
  api.post<FeeCategory>('/api/finance/fee-categories/', data);

export const listFeeStructures = () => api.get<FeeStructure[]>('/api/finance/fee-structures/');
export const createFeeStructure = (data: { grade_level: number; term: number; name: string }) =>
  api.post<FeeStructure>('/api/finance/fee-structures/', data);
export const getFeeStructure = (structureId: number) =>
  api.get<FeeStructureDetail>(`/api/finance/fee-structures/${structureId}/`);
export const activateFeeStructure = (structureId: number) =>
  api.post<{ status: string; job_id: string }>(`/api/finance/fee-structures/${structureId}/activate/`);
export const setFeeItemEnrollment = (itemId: number, studentIds: number[]) =>
  api.put<{ status: string; enrolled_count: number }>(
    `/api/finance/fee-structure-items/${itemId}/enrollments/`, { student_ids: studentIds },
  );

export const listInvoices = (studentId?: number) =>
  api.get<Invoice[]>('/api/finance/invoices/', { params: studentId ? { student_id: studentId } : {} });
export const voidInvoice = (invoiceId: number, reason: string) =>
  api.post<Invoice>(`/api/finance/invoices/${invoiceId}/void/`, { reason });

export const listPayments = (studentId?: number) =>
  api.get<Payment[]>('/api/finance/payments/', { params: studentId ? { student_id: studentId } : {} });
export const recordPayment = (data: {
  student: number; invoice?: number | null; amount: number; method: Payment['method']; reference?: string; date: string;
}) => api.post<Payment>('/api/finance/payments/', data);
export const voidPayment = (paymentId: number, reason: string) =>
  api.post<Payment>(`/api/finance/payments/${paymentId}/void/`, { reason });

export const getStudentLedger = (studentId: number) =>
  api.get<{ balance: number; entries: LedgerEntry[] }>(`/api/finance/students/${studentId}/ledger/`);
export const getFeeClearanceStatus = (studentId: number, termId?: number) =>
  api.get<{ is_clear: boolean | null }>(
    `/api/finance/students/${studentId}/fee-clearance/`, { params: termId ? { term_id: termId } : {} },
  );

export const invoicePdfUrl = (invoiceId: number) => `/api/finance/invoices/${invoiceId}/pdf/`;
export const receiptPdfUrl = (receiptId: number) => `/api/finance/receipts/${receiptId}/pdf/`;

export const getFeeKpiTiles = () => api.get('/api/finance/reports/kpi-tiles/');
export const getCollectionsTrend = (days = 30) => api.get('/api/finance/reports/collections-trend/', { params: { days } });
export const getFeeCategoryBreakdown = () => api.get('/api/finance/reports/category-breakdown/');
export const getStudentBalanceAging = () => api.get('/api/finance/reports/student-aging/');
```

- [ ] **Step 2: Create `frontend/src/components/Finance/FeeStructuresPage.tsx`**

```tsx
import { useEffect, useState } from 'react';
import {
  Card, CardContent, Button, TextField, Select, MenuItem, Table, TableHead,
  TableRow, TableCell, TableBody, Chip, CircularProgress,
} from '@mui/material';
import toast from 'react-hot-toast';
import api from '../../libs/axiosInstance';
import {
  listFeeStructures, createFeeStructure, activateFeeStructure, FeeStructure,
} from '../../libs/financeApi';

interface GradeLevelOption { id: number; name: string; }
interface ExamTermOption { id: number; name: string; }

export default function FeeStructuresPage() {
  const [structures, setStructures] = useState<FeeStructure[]>([]);
  const [grades, setGrades] = useState<GradeLevelOption[]>([]);
  const [terms, setTerms] = useState<ExamTermOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [gradeId, setGradeId] = useState<number | ''>('');
  const [termId, setTermId] = useState<number | ''>('');
  const [activatingId, setActivatingId] = useState<number | null>(null);

  const loadStructures = () => {
    listFeeStructures().then((res) => setStructures(res.data)).catch(() => toast.error('Failed to load fee structures.'));
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([
      listFeeStructures(),
      api.get<GradeLevelOption[]>('/api/academics/grade-levels/'),
      api.get<ExamTermOption[]>('/api/academics/exam-terms/'),
    ])
      .then(([structuresRes, gradesRes, termsRes]) => {
        setStructures(structuresRes.data);
        setGrades(gradesRes.data);
        setTerms(termsRes.data);
      })
      .catch(() => toast.error('Failed to load fee structures.'))
      .finally(() => setLoading(false));
  }, []);

  const handleCreate = async () => {
    if (!name || !gradeId || !termId) {
      toast.error('Name, grade, and term are all required.');
      return;
    }
    try {
      await createFeeStructure({ name, grade_level: gradeId, term: termId });
      toast.success('Fee structure created.');
      setName('');
      setGradeId('');
      setTermId('');
      loadStructures();
    } catch {
      toast.error('Failed to create fee structure — it may already exist for this grade/term.');
    }
  };

  const handleActivate = async (structureId: number) => {
    setActivatingId(structureId);
    try {
      await activateFeeStructure(structureId);
      toast.success('Activated — invoices are being generated in the background.');
      loadStructures();
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to activate fee structure.');
    } finally {
      setActivatingId(null);
    }
  };

  if (loading) return <CircularProgress />;

  return (
    <div className="p-4 space-y-4">
      <Card>
        <CardContent className="flex flex-wrap gap-3 items-center">
          <TextField label="Structure name" value={name} onChange={(e) => setName(e.target.value)} size="small" />
          <Select value={gradeId} onChange={(e) => setGradeId(Number(e.target.value))} displayEmpty size="small">
            <MenuItem value="">Select grade</MenuItem>
            {grades.map((g) => <MenuItem key={g.id} value={g.id}>{g.name}</MenuItem>)}
          </Select>
          <Select value={termId} onChange={(e) => setTermId(Number(e.target.value))} displayEmpty size="small">
            <MenuItem value="">Select term</MenuItem>
            {terms.map((t) => <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>)}
          </Select>
          <Button variant="contained" onClick={handleCreate}>Create Structure</Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell><TableCell>Status</TableCell><TableCell>Action</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {structures.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>{s.name}</TableCell>
                  <TableCell><Chip label={s.status} color={s.status === 'active' ? 'success' : 'default'} size="small" /></TableCell>
                  <TableCell>
                    {s.status === 'draft' && (
                      <Button size="small" disabled={activatingId === s.id} onClick={() => handleActivate(s.id)}>
                        {activatingId === s.id ? 'Activating...' : 'Activate & Generate Invoices'}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
```

**Note on `/api/academics/grade-levels/` and `/api/academics/exam-terms/`**: these two lookup endpoints are assumed to already exist somewhere in the academics API surface (grade/term dropdowns are a basic need used all over this app — e.g. the class/exam admin pages). Before wiring this page in, grep the frontend for how an existing admin page (e.g. the class-management or exam-term admin screens) fetches its grade/term dropdown options, and use those exact existing endpoint paths instead if they differ from the placeholders above — do not invent a second, redundant lookup endpoint if one is already exposed.

- [ ] **Step 3: Register the route in `frontend/src/App.tsx`**

Add the import near the other Finance-related imports:

```tsx
import FeeStructuresPage from './components/Finance/FeeStructuresPage';
```

Add the route inside the admin `DashboardLayout` route group, alongside the existing `<Route path="finance" element={<FinanceHub />} />`:

```tsx
<Route path="finance/fee-structures" element={<FeeStructuresPage />} />
```

- [ ] **Step 4: Manually verify**

Run the dev server (`python manage.py runserver` + `pnpm dev` in `frontend/`), log in as an admin/Finance Officer, navigate to `/admin-dashboard/finance/fee-structures`, create a structure, add items via Django admin (Task 3's inline), and activate it — confirm invoices appear (Task 9's endpoint) once a Celery worker is running.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/libs/financeApi.ts frontend/src/components/Finance/FeeStructuresPage.tsx frontend/src/App.tsx
git commit -m "feat(finance): add finance API client and Fee Structures admin page"
```

---

### Task 22: Frontend — Invoices and Payments admin pages

**Files:**
- Create: `frontend/src/components/Finance/InvoicesPage.tsx`
- Create: `frontend/src/components/Finance/PaymentsPage.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `listInvoices`, `voidInvoice`, `invoicePdfUrl`, `listPayments`, `recordPayment`, `voidPayment`, `receiptPdfUrl` from `financeApi.ts` (Task 21).

- [ ] **Step 1: Create `frontend/src/components/Finance/InvoicesPage.tsx`**

```tsx
import { useEffect, useState } from 'react';
import {
  Card, CardContent, Table, TableHead, TableRow, TableCell, TableBody, Chip,
  Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField, CircularProgress,
} from '@mui/material';
import toast from 'react-hot-toast';
import { listInvoices, voidInvoice, invoicePdfUrl, Invoice } from '../../libs/financeApi';

const STATUS_COLOR: Record<Invoice['status'], 'default' | 'success' | 'warning' | 'error'> = {
  unpaid: 'default', partially_paid: 'warning', paid: 'success', overdue: 'error', voided: 'default',
};

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [voidTarget, setVoidTarget] = useState<Invoice | null>(null);
  const [voidReason, setVoidReason] = useState('');

  const load = () => {
    setLoading(true);
    listInvoices().then((res) => setInvoices(res.data)).catch(() => toast.error('Failed to load invoices.')).finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleVoid = async () => {
    if (!voidTarget) return;
    if (!voidReason.trim()) {
      toast.error('A void reason is required.');
      return;
    }
    try {
      await voidInvoice(voidTarget.id, voidReason);
      toast.success(`Invoice ${voidTarget.invoice_number} voided.`);
      setVoidTarget(null);
      setVoidReason('');
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to void invoice.');
    }
  };

  if (loading) return <CircularProgress />;

  return (
    <div className="p-4">
      <Card>
        <CardContent>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Invoice #</TableCell><TableCell>Total</TableCell>
                <TableCell>Status</TableCell><TableCell>Issued</TableCell><TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {invoices.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell>{invoice.invoice_number}</TableCell>
                  <TableCell>KES {invoice.total.toLocaleString()}</TableCell>
                  <TableCell><Chip label={invoice.status} color={STATUS_COLOR[invoice.status]} size="small" /></TableCell>
                  <TableCell>{new Date(invoice.issued_at).toLocaleDateString()}</TableCell>
                  <TableCell className="flex gap-2">
                    <Button size="small" href={invoicePdfUrl(invoice.id)} target="_blank" rel="noreferrer">PDF</Button>
                    {invoice.status !== 'voided' && (
                      <Button size="small" color="error" onClick={() => setVoidTarget(invoice)}>Void</Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!voidTarget} onClose={() => setVoidTarget(null)}>
        <DialogTitle>Void invoice {voidTarget?.invoice_number}</DialogTitle>
        <DialogContent>
          {/* No "edit" option exists here by design — the only correction path is void, then generate a fresh invoice. */}
          <TextField
            fullWidth multiline minRows={2} label="Reason (required)" value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)} autoFocus
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setVoidTarget(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleVoid}>Confirm Void</Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 2: Create `frontend/src/components/Finance/PaymentsPage.tsx`**

```tsx
import { useEffect, useState } from 'react';
import {
  Card, CardContent, Table, TableHead, TableRow, TableCell, TableBody, Chip,
  Button, TextField, Select, MenuItem, Dialog, DialogTitle, DialogContent, DialogActions, CircularProgress,
} from '@mui/material';
import toast from 'react-hot-toast';
import { listPayments, recordPayment, voidPayment, receiptPdfUrl, Payment } from '../../libs/financeApi';

export default function PaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [studentId, setStudentId] = useState('');
  const [invoiceId, setInvoiceId] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<Payment['method']>('cash');
  const [voidTarget, setVoidTarget] = useState<Payment | null>(null);
  const [voidReason, setVoidReason] = useState('');

  const load = () => {
    setLoading(true);
    listPayments().then((res) => setPayments(res.data)).catch(() => toast.error('Failed to load payments.')).finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleRecord = async () => {
    if (!studentId || !amount) {
      toast.error('Student and amount are required.');
      return;
    }
    try {
      await recordPayment({
        student: Number(studentId), invoice: invoiceId ? Number(invoiceId) : null,
        amount: Number(amount), method, date: new Date().toISOString().slice(0, 10),
      });
      toast.success('Payment recorded and receipt generated.');
      setStudentId('');
      setInvoiceId('');
      setAmount('');
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to record payment.');
    }
  };

  const handleVoid = async () => {
    if (!voidTarget) return;
    if (!voidReason.trim()) {
      toast.error('A void reason is required.');
      return;
    }
    try {
      await voidPayment(voidTarget.id, voidReason);
      toast.success('Payment voided.');
      setVoidTarget(null);
      setVoidReason('');
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to void payment.');
    }
  };

  if (loading) return <CircularProgress />;

  return (
    <div className="p-4 space-y-4">
      <Card>
        <CardContent className="flex flex-wrap gap-3 items-center">
          <TextField label="Student ID" value={studentId} onChange={(e) => setStudentId(e.target.value)} size="small" />
          <TextField label="Invoice ID (optional)" value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} size="small" />
          <TextField label="Amount (KES)" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} size="small" />
          <Select value={method} onChange={(e) => setMethod(e.target.value as Payment['method'])} size="small">
            <MenuItem value="cash">Cash</MenuItem>
            <MenuItem value="bank_transfer">Bank Transfer</MenuItem>
            <MenuItem value="mpesa">M-Pesa</MenuItem>
            <MenuItem value="cheque">Cheque</MenuItem>
            <MenuItem value="other">Other</MenuItem>
          </Select>
          <Button variant="contained" onClick={handleRecord}>Record Payment</Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Student</TableCell><TableCell>Amount</TableCell><TableCell>Method</TableCell>
                <TableCell>Date</TableCell><TableCell>Receipt</TableCell><TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {payments.map((payment) => (
                <TableRow key={payment.id}>
                  <TableCell>{payment.student}</TableCell>
                  <TableCell>KES {payment.amount.toLocaleString()}</TableCell>
                  <TableCell>{payment.method}</TableCell>
                  <TableCell>{payment.date}</TableCell>
                  <TableCell>
                    {payment.receipt_number && (
                      <Button size="small" href={receiptPdfUrl(payment.id)} target="_blank" rel="noreferrer">
                        {payment.receipt_number}
                      </Button>
                    )}
                  </TableCell>
                  <TableCell>
                    {payment.status === 'confirmed' && (
                      <Button size="small" color="error" onClick={() => setVoidTarget(payment)}>Void</Button>
                    )}
                    {payment.status === 'failed' && <Chip label="Voided" size="small" />}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!voidTarget} onClose={() => setVoidTarget(null)}>
        <DialogTitle>Void payment</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth multiline minRows={2} label="Reason (required)" value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)} autoFocus
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setVoidTarget(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleVoid}>Confirm Void</Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 3: Register both routes in `frontend/src/App.tsx`**

```tsx
import InvoicesPage from './components/Finance/InvoicesPage';
import PaymentsPage from './components/Finance/PaymentsPage';
```

```tsx
<Route path="finance/invoices" element={<InvoicesPage />} />
<Route path="finance/payments" element={<PaymentsPage />} />
```

- [ ] **Step 4: Manually verify**

Log in as an admin/Finance Officer, navigate to `/admin-dashboard/finance/invoices` and `/admin-dashboard/finance/payments`. Record a payment against an invoice generated in Task 21's verification pass, confirm a receipt number and PDF link appear, then void it and confirm the invoice's status reverts and the voided payment can't be voided again.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Finance/InvoicesPage.tsx frontend/src/components/Finance/PaymentsPage.tsx frontend/src/App.tsx
git commit -m "feat(finance): add Invoices and Payments admin pages with void-only workflow"
```

---

### Task 23: Real balances — FinanceHub's fees tab and ManageEnrollments' fee_balance

Two real fake-data call sites, fixed together since they're the same underlying problem (a hardcoded/raw number standing in for a real ledger balance). The "Income & Expense" tab in `FinanceHub.tsx` stays mock in this phase — it's General Ledger data (Phase 3), not Fees.

**Files:**
- Modify: `frontend/src/components/Finance/FinanceHub.tsx`
- Modify: `school/views/class_views.py`
- Test: `apps/finance/tests/test_class_views_fee_balance.py`

**Interfaces:**
- Consumes: `getStudentBalanceAging` (frontend, Task 21/18), `StudentFeeLedgerEntry` (backend, Task 4).

- [ ] **Step 1: Write the failing backend test**

```python
# apps/finance/tests/test_class_views_fee_balance.py
from django.contrib.auth.models import User
from django.test import TestCase, RequestFactory

from apps.academics.models import ClassStream, Curriculum, GradeLevel, Tier
from apps.identity.models import StudentExtra
from apps.finance.models_fees import FeeCategory
from apps.finance.services_fees import post_ledger_entry
from school.views.class_views import class_enrollment_dashboard


class ClassEnrollmentDashboardFeeBalanceTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        curriculum = Curriculum.objects.create(name='CBC FB')
        tier = Tier.objects.create(name='Junior FB', curriculum=curriculum)
        grade = GradeLevel.objects.create(name='Grade 7FB', numeric_order=7, curriculum_type='CBC', curriculum=curriculum, tier=tier)
        self.stream = ClassStream.objects.create(name='7FB Blue', grade=grade)
        self.admin = User.objects.create_user(username='fee_balance_admin', password='x', is_superuser=True, is_staff=True)
        user = User.objects.create_user(username='fee_balance_student', password='x')
        self.student = StudentExtra.objects.create(user=user, cl=self.stream, enrollment_state='Active')
        self.category = FeeCategory.objects.create(name='Tuition')

    def _get(self):
        request = self.factory.get(f'/api/classes/{self.stream.id}/enrollment-dashboard/')
        request.user = self.admin
        return class_enrollment_dashboard(request, self.stream.id)

    def test_active_student_with_no_finance_history_shows_zero_balance(self):
        response = self._get()
        row = next(r for r in response.data['active'] if r['id'] == self.student.id)
        self.assertEqual(row['fee_balance'], 0)

    def test_active_student_with_outstanding_charge_shows_real_balance(self):
        post_ledger_entry(student=self.student, entry_type='charge', amount=12000, reference=self.category, description='Term fee')
        response = self._get()
        row = next(r for r in response.data['active'] if r['id'] == self.student.id)
        self.assertEqual(row['fee_balance'], 12000)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python manage.py test apps.finance.tests.test_class_views_fee_balance -v 2`
Expected: FAIL — `test_active_student_with_outstanding_charge_shows_real_balance` gets a `fee_balance` computed from the mock `s.id % 2 == 0` formula instead of `12000`. (If the view function name or response shape found here differs slightly from `class_enrollment_dashboard`/`response.data['active']` shown in this task, adjust the test to match what's actually in `school/views/class_views.py` around line 515 — the important behavior under test is unchanged either way.)

- [ ] **Step 3: Fix `school/views/class_views.py`**

Add this import near the top of the file: `from apps.finance.models_fees import StudentFeeLedgerEntry`.

Replace lines 524-543 (the active-roster loop) with a version that looks up real balances in one query instead of iterating the mock formula per student:

```python
            # 1. ACTIVE ROSTER (Includes Suspended students since they keep their seat)
            active_students = StudentExtra.objects.filter(
                cl=stream,
                enrollment_state__in=['Active', 'Suspended']
            ).select_related('user')

            # One query for every active student's current balance, instead of N+1 —
            # same "latest ledger entry per student" pattern as apps/finance/services_reports.py.
            balances = dict(
                StudentFeeLedgerEntry.objects.filter(student__in=active_students)
                .order_by('student_id', '-id').distinct('student_id')
                .values_list('student_id', 'running_balance')
            )

            active_data = []
            for s in active_students:
                active_data.append({
                    'id': s.id,
                    'name': s.get_name,
                    'roll': s.roll,
                    'enrollment_state': s.enrollment_state,
                    'last_changed': s.last_enrollment_change.strftime(
                        '%d %b %Y') if s.last_enrollment_change else "N/A",
                    'fee_balance': balances.get(s.id, 0),
                    'subjects_assigned': True if s.id % 3 != 0 else False
                })
```

Replace line 561 (`'fee_balance': 0,  # Mock handling for exited users`) with a real lookup too — add this line right before the `exited_data = []` loop (after the `exited_students` queryset is built):

```python
            exited_balances = dict(
                StudentFeeLedgerEntry.objects.filter(student__in=exited_students)
                .order_by('student_id', '-id').distinct('student_id')
                .values_list('student_id', 'running_balance')
            )
```

and change the field itself to:

```python
                    'fee_balance': exited_balances.get(s.id, 0),
```

Note: `subjects_assigned` on line 542 (`True if s.id % 3 != 0 else False`) is a **separate**, unrelated mock — it is out of scope for this finance plan; leave it untouched.

- [ ] **Step 4: Run the test to verify it passes**

Run: `python manage.py test apps.finance.tests.test_class_views_fee_balance -v 2`
Expected: PASS (2 tests)

- [ ] **Step 5: Rewire `FinanceHub.tsx`'s fees tab to a real balance**

The frontend side of this needs no interface change at all — `ManageEnrollments.tsx` already reads `student.fee_balance` from the API response correctly; Step 3 just made that number real. `FinanceHub.tsx`'s fees tab is different: it displays `s.fee` (the raw `StudentExtra.fee` field via `FinanceOverviewAPI`), not a ledger balance. Change it to show real outstanding balance from Task 18's aging report.

Add the import at the top of `frontend/src/components/Finance/FinanceHub.tsx`:

```tsx
import { getStudentBalanceAging } from '../../libs/financeApi';
```

Add a new state variable alongside the existing `data`/`loading`/`activeTab`/`searchTerm` declarations:

```tsx
  const [balancesByStudent, setBalancesByStudent] = useState<Record<number, number>>({});
```

Replace the existing `useEffect` (lines 60-67) with a version that also loads real balances:

```tsx
  useEffect(() => {
    api.get('/api/finance-overview/')
      .then((res) => {
        if (res.data?.status === 'success') setData(res.data.data);
      })
      .catch((err) => console.error("Failed to fetch finance overview", err))
      .finally(() => setLoading(false));

    getStudentBalanceAging()
      .then((res) => {
        const map: Record<number, number> = {};
        for (const row of res.data as { student_id: number; balance: number }[]) {
          map[row.student_id] = row.balance;
        }
        setBalancesByStudent(map);
      })
      .catch((err) => console.error("Failed to fetch student fee balances", err));
  }, []);
```

Replace the fees-table header cell (line 226, `<th className="py-3 px-5 font-bold text-right">Fee</th>`) with:

```tsx
                    <th className="py-3 px-5 font-bold text-right">Balance Owed</th>
```

Replace the fees-table data cell (line 243, `<td className="py-3 px-5 text-right font-bold text-slate-700 dark:text-slate-200">${s.fee.toLocaleString()}</td>`) with:

```tsx
                      <td className="py-3 px-5 text-right font-bold text-slate-700 dark:text-slate-200">KES {(balancesByStudent[s.id] ?? 0).toLocaleString()}</td>
```

A student with no row in `balancesByStudent` has no outstanding ledger activity at all (fully cleared), so `?? 0` is the correct default — not a fallback-to-mock.

- [ ] **Step 6: Manually verify**

Reload `/admin-dashboard/finance` and confirm the "Student Fees" tab now shows "Balance Owed" sourced from real ledger data (0 for anyone with no invoices yet), and that `/admin-dashboard/classes/.../manage-enrollments` (or wherever `ManageEnrollments.tsx` is routed) shows a real, non-alternating balance per student.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/Finance/FinanceHub.tsx school/views/class_views.py apps/finance/tests/test_class_views_fee_balance.py
git commit -m "feat(finance): replace mock fee_balance/fee display with real ledger balances"
```

---

### Task 24: Student/parent read-only fee statement page

Mirrors the existing `studentAssignmentService.ts` convention exactly: "the logged-in student's own profile is resolved server-side, so no student_id is needed" (`/api/assignments/student/board/`, no id in the URL) — this task adds the finance equivalent, `/api/finance/students/me/ledger/`. Parents pass their child's id explicitly, mirroring `parentAssignmentService.ts`'s `student_id` param convention, reusing the by-id endpoint from Task 16 with one added authorization branch.

**Files:**
- Modify: `apps/finance/views.py` (extend `StudentFeeLedgerStatementAPIView`, add `MyFeeLedgerAPIView`)
- Modify: `apps/finance/urls.py`
- Create: `frontend/src/components/Finance/StudentFeeStatementPage.tsx`
- Modify: `frontend/src/App.tsx`
- Test: `apps/finance/tests/test_ledger_statement_authorization.py`

**Interfaces:**
- Produces: `MyFeeLedgerAPIView` (`GET /api/finance/students/me/ledger/`). Extends `StudentFeeLedgerStatementAPIView`'s authorization to also allow a parent viewing their own child's ledger.

- [ ] **Step 1: Write the failing tests**

```python
# apps/finance/tests/test_ledger_statement_authorization.py
from django.contrib.auth.models import Group, User
from django.test import TestCase
from rest_framework.test import APIRequestFactory

from apps.identity.models import StudentExtra, ParentExtra
from apps.finance.models_fees import FeeCategory
from apps.finance.services_fees import post_ledger_entry
from apps.finance.views import StudentFeeLedgerStatementAPIView, MyFeeLedgerAPIView


class LedgerStatementAuthorizationTests(TestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        student_user = User.objects.create_user(username='ledger_auth_student', password='x')
        self.student = StudentExtra.objects.create(user=student_user)
        self.category = FeeCategory.objects.create(name='Tuition')
        post_ledger_entry(student=self.student, entry_type='charge', amount=8000, reference=self.category, description='Term fee')

        parent_user = User.objects.create_user(username='ledger_auth_parent', password='x')
        self.parent = ParentExtra.objects.create(user=parent_user)
        self.parent.students.add(self.student)

        other_student_user = User.objects.create_user(username='ledger_auth_other_student', password='x')
        self.other_student = StudentExtra.objects.create(user=other_student_user)

    def test_student_can_view_own_ledger_by_id(self):
        request = self.factory.get(f'/api/finance/students/{self.student.id}/ledger/')
        request.user = self.student.user
        response = StudentFeeLedgerStatementAPIView.as_view()(request, student_id=self.student.id)
        self.assertEqual(response.status_code, 200)

    def test_student_cannot_view_someone_elses_ledger(self):
        request = self.factory.get(f'/api/finance/students/{self.other_student.id}/ledger/')
        request.user = self.student.user
        response = StudentFeeLedgerStatementAPIView.as_view()(request, student_id=self.other_student.id)
        self.assertEqual(response.status_code, 403)

    def test_parent_can_view_own_childs_ledger(self):
        request = self.factory.get(f'/api/finance/students/{self.student.id}/ledger/')
        request.user = self.parent.user
        response = StudentFeeLedgerStatementAPIView.as_view()(request, student_id=self.student.id)
        self.assertEqual(response.status_code, 200)

    def test_parent_cannot_view_a_non_child_students_ledger(self):
        request = self.factory.get(f'/api/finance/students/{self.other_student.id}/ledger/')
        request.user = self.parent.user
        response = StudentFeeLedgerStatementAPIView.as_view()(request, student_id=self.other_student.id)
        self.assertEqual(response.status_code, 403)

    def test_my_ledger_resolves_current_student_without_an_id(self):
        request = self.factory.get('/api/finance/students/me/ledger/')
        request.user = self.student.user
        response = MyFeeLedgerAPIView.as_view()(request)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['balance'], 8000)
```

If `ParentExtra` doesn't expose a `students` M2M/related accessor with those exact semantics, adjust the fixture to whatever the real field is called (check `apps/identity/models.py`'s `ParentExtra` definition — it's referenced this way already in `school/views/results_views.py`'s `parent_profile.students.filter(...)`, per Task 19's research, so this should match).

- [ ] **Step 2: Run tests to verify they fail**

Run: `python manage.py test apps.finance.tests.test_ledger_statement_authorization -v 2`
Expected: FAIL — `test_parent_can_view_own_childs_ledger` gets 403 (no parent branch yet); `ImportError` on `MyFeeLedgerAPIView`.

- [ ] **Step 3: Extend `StudentFeeLedgerStatementAPIView` and add `MyFeeLedgerAPIView` in `apps/finance/views.py`**

Replace the `get()` method's authorization line from Task 16 (`if not (_is_admin(request.user) or ...`) with:

```python
class StudentFeeLedgerStatementAPIView(APIView):
    """Powers both the admin student-ledger view and the parent/student
    read-only fee statement page."""
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request, student_id):
        user = request.user
        is_self = bool(getattr(user, 'studentextra', None)) and user.studentextra.id == student_id
        is_own_child = bool(getattr(user, 'parentextra', None)) and user.parentextra.students.filter(id=student_id).exists()
        if not (_is_admin(user) or user_has_permission(user, 'finance.view') or is_self or is_own_child):
            return Response({"error": "Not authorized to view this student's fee ledger."}, status=status.HTTP_403_FORBIDDEN)
        entries = StudentFeeLedgerEntry.objects.filter(student_id=student_id).order_by('-id')
        balance = entries.first().running_balance if entries.exists() else 0
        return Response({
            "balance": balance,
            "entries": StudentFeeLedgerEntrySerializer(entries, many=True).data,
        })


class MyFeeLedgerAPIView(APIView):
    """The logged-in student's own fee ledger, resolved server-side — no
    student_id in the URL, mirroring studentAssignmentService.ts's
    /api/assignments/student/board/ convention."""
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        student = getattr(request.user, 'studentextra', None)
        if student is None:
            return Response({"error": "This account has no student profile."}, status=status.HTTP_403_FORBIDDEN)
        entries = StudentFeeLedgerEntry.objects.filter(student=student).order_by('-id')
        balance = entries.first().running_balance if entries.exists() else 0
        return Response({
            "balance": balance,
            "entries": StudentFeeLedgerEntrySerializer(entries, many=True).data,
        })
```

- [ ] **Step 4: Add the route in `apps/finance/urls.py`**

```python
from apps.finance.views import MyFeeLedgerAPIView

urlpatterns += [
    path('api/finance/students/me/ledger/', MyFeeLedgerAPIView.as_view(), name='api_my_fee_ledger'),
]
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `python manage.py test apps.finance.tests.test_ledger_statement_authorization -v 2`
Expected: PASS (5 tests)

- [ ] **Step 6: Create `frontend/src/components/Finance/StudentFeeStatementPage.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { Card, CardContent, Table, TableHead, TableRow, TableCell, TableBody, Chip, CircularProgress } from '@mui/material';
import toast from 'react-hot-toast';
import api from '../../libs/axiosInstance';
import { LedgerEntry } from '../../libs/financeApi';

interface Props {
  /** Pass a specific child's id for a parent viewing one of their children;
   * omit it for a student viewing their own statement (resolved server-side). */
  studentId?: number;
}

export default function StudentFeeStatementPage({ studentId }: Props) {
  const [balance, setBalance] = useState<number | null>(null);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const url = studentId ? `/api/finance/students/${studentId}/ledger/` : '/api/finance/students/me/ledger/';
    api.get<{ balance: number; entries: LedgerEntry[] }>(url)
      .then((res) => {
        setBalance(res.data.balance);
        setEntries(res.data.entries);
      })
      .catch(() => toast.error('Failed to load your fee statement.'))
      .finally(() => setLoading(false));
  }, [studentId]);

  if (loading) return <CircularProgress />;

  return (
    <div className="p-4 space-y-4">
      <Card>
        <CardContent>
          <div className="text-sm text-slate-500">Current Balance</div>
          <div className={`text-3xl font-bold ${(balance ?? 0) > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
            KES {(balance ?? 0).toLocaleString()}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Date</TableCell><TableCell>Type</TableCell>
                <TableCell>Description</TableCell><TableCell align="right">Amount</TableCell>
                <TableCell align="right">Balance</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>{entry.date}</TableCell>
                  <TableCell><Chip label={entry.entry_type} size="small" /></TableCell>
                  <TableCell>{entry.description}</TableCell>
                  <TableCell align="right">KES {entry.amount.toLocaleString()}</TableCell>
                  <TableCell align="right">KES {entry.running_balance.toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 7: Register the route in `frontend/src/App.tsx`**

Add the import and route for the student-facing dashboard group (wherever the existing student dashboard routes are registered — find the `student-dashboard` route group the same way `finance` is registered for admin, per Task 21's research):

```tsx
import StudentFeeStatementPage from './components/Finance/StudentFeeStatementPage';
```

```tsx
<Route path="fees" element={<StudentFeeStatementPage />} />
```

- [ ] **Step 8: Manually verify**

Log in as a student with an outstanding invoice from earlier verification passes, navigate to the new fees page, confirm the balance and ledger history render. Log in as that student's parent (if a parent account/link exists in your test data) and confirm the same data is reachable by child id, and that a different, unrelated parent account is rejected.

- [ ] **Step 9: Run the entire finance-related test suite one final time**

Run: `python manage.py test apps.finance school.tests.test_report_card_fee_gate school.tests.test_promotion_fee_gate school.tests.test_report_card_permissions school.tests.test_promotion school.tests.test_promotion_events school.tests.test_promotion_readiness -v 2`
Expected: PASS — everything from Tasks 1-24, plus confirmation that Tasks 19-20's gates didn't regress the pre-existing report-card/promotion test suites.

- [ ] **Step 10: Commit**

```bash
git add apps/finance/views.py apps/finance/urls.py apps/finance/tests/test_ledger_statement_authorization.py frontend/src/components/Finance/StudentFeeStatementPage.tsx frontend/src/App.tsx
git commit -m "feat(finance): add parent/student read-only fee statement page and my-ledger endpoint"
```

---

## Plan self-review

**Spec coverage** — every section of `docs/superpowers/specs/2026-09-09-finance-subsystem-design.md` §4 (Fee module) plus the void/immutability/hard-delete/audit hardening from the later conversation turns is covered: FeeCategory (T2), FeeStructure/Items/optional enrollment (T3), ledger core (T4), adjustments/scholarships with approval (T5), Invoice/InvoiceLineItem (T6), Payment/Receipt (T7), invoicing (T8-9), payments (T10), void-and-reissue with no edit/delete (T11), fee clearance (T12), super-admin-only hard delete + audit (T13), RBAC (T14), API surface (T15-16), PDF generation (T17), reporting (T18), report-card gate (T19), promotion gate (T20), and the full frontend (T21-24). Explicitly out of scope per the spec's §2 non-goals (online payments, full balance sheet, multi-currency, multi-tenancy, automated statutory tax computation, general clubs/activities system) — none of that appears anywhere in this plan, by design.

**Placeholder scan** — no TBD/TODO markers; the two "adjust to match the real codebase" notes (Task 9's ClassStream field name — already verified as `grade`, not `grade_level`, and reflected correctly in the code — and Task 24's `ParentExtra.students` accessor name) are explicit, bounded verification steps for details this plan couldn't confirm from static research alone, not vague hand-waving.

**Type/signature consistency** — `post_ledger_entry`'s signature (Task 4) is used identically in Tasks 5, 8, 10, 11, 19, 20, 23. `is_fees_clear`'s signature (Task 12) matches its two consumers (Tasks 19, 20) and the pre-existing stub it replaces. `create_adjustment`'s signature was corrected in Task 16 (from `category=` to `category_id=`) with an explicit callout back to Task 5's original definition, rather than leaving two conflicting signatures across tasks.

**Scope check** — this plan covers Phase 1 (Fees) only, per the spec's phasing (§3) and the "Implementation Order" from your master prompt. Payroll, General Ledger, and the promotion-gate/period-closing cross-cutting phase are follow-on plans, each written the same way once this phase is implemented and reviewed.
