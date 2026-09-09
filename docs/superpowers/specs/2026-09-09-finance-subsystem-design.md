# Finance subsystem design

**Status**: approved for spec, pending implementation plan
**Author**: brainstormed with Claude Code, 2026-09-09
**Scope**: replaces the current stub `apps/finance/` (one read-only endpoint over two scalar fields) and the mock data in `frontend/src/components/Finance/` with a real accounting subsystem covering student fees, staff payroll, and general school income/expense.

## 1. Goals

- Track "all the accounts happening in the system": student fee accounts, staff payroll, and general school income/expense, each backed by real persisted records — no mock/sample data anywhere except the payment-method choice list (see §9).
- Generate formal, sequentially-numbered, branded PDF documents: invoices, receipts, payslips.
- Give every student a real running-balance ledger (a subsidiary accounts-receivable ledger, one per student).
- Gate report-card release and student promotion on fee clearance, via one reusable, generic check — designed so more gated features can be added later without new plumbing.
- Support optional/elective fee items (not every student pays for every extra) and formal, audited scholarships/discounts/penalties.
- Stay consistent with this repo's existing conventions: modular-monolith app boundaries (`apps/finance/`), DB-first config over hardcoding (`FeeCategory`, `SalaryComponent`, `GLCategory` are admin-editable tables, not enums), the `bulk_ops` Celery queue for bulk generation, `transaction.atomic()` + `select_for_update()` for ledger correctness, existing RBAC (`Role`/`Permission`), and the existing messaging event bus for notifications.

## 2. Non-goals (explicitly deferred)

- **Online payment gateway integration** (M-Pesa STK push, card processing). The `Payment` model is shaped to support it later (`status` of pending/confirmed/failed, a `gateway_reference` field) but no gateway is wired up. Manual recording only for now.
- **A full formal Balance Sheet** (Assets/Liabilities/Equity). The three-independent-ledgers architecture (chosen over a shared double-entry chart of accounts) doesn't structurally produce one — see §3 for the tradeoff. An Income Statement (income − expenses across all three modules) is in scope; a Balance Sheet is not.
- **Multi-currency.** Single currency throughout (KES), no FX handling.
- **Multi-tenancy / school scoping.** Per the sms-orient roadmap, tenant scoping is being rolled out entity-by-entity starting with Curriculum Hub; finance is not next in that queue. No `school` FK on any model here.
- **Automatic tax/statutory computation** (PAYE, NHIF/SHA formulas). `SalaryComponent` amounts are entered per staff member, not computed by a rules engine — the actual Kenyan statutory rules aren't decided yet. The model leaves room for a future rule engine without a schema change.
- **A general clubs/activities-management system.** The optional-fee-item roster (§4.3) is scoped to finance only, not a broader extracurricular-activities feature.

## 3. Architecture

**Three independent ledgers, not a shared double-entry core.** Each module (Fees, Payroll, General Ledger) owns its own self-contained records; there is no shared `Account`/`Transaction`/`Entry` chart of accounts. A thin, read-only `services_reports.py` aggregates across the three for dashboard KPIs and the income statement — it never writes across module boundaries. This trades away a clean formal Balance Sheet (§2) for simpler, more isolated modules that don't require a shared chart-of-accounts model to get right on the first pass.

**App placement** — everything lives in the already-scaffolded `apps/finance/` (registered in `INSTALLED_APPS`, has a real `urls.py` already wired into the root urlconf):

```
apps/finance/
  models_fees.py       FeeCategory, FeeStructure, FeeStructureItem,
                        StudentFeeItemEnrollment, StudentFeeAdjustment,
                        Invoice, Payment, Receipt, StudentFeeLedgerEntry
  models_payroll.py     SalaryComponent, StaffSalaryProfile,
                        PayrollRun, PayrollEntry, Payslip
  models_gl.py          GLCategory, GeneralLedgerEntry, Vendor, Budget
  models_shared.py      CashAccount, FinancialPeriod (term-closing)
  services_fees.py      invoice generation, payment posting, is_fees_clear()
  services_payroll.py   payroll run processing, payslip generation
  services_gl.py        GL entry posting, budget comparison
  services_reports.py   cross-module KPI/report queries (read-only)
  services_documents.py PDF generation (invoice/receipt/payslip), WeasyPrint
```

FKs to other apps use app-label-qualified strings per this repo's established convention (`'identity.StudentExtra'`, `'academics.ExamTerm'`, `'academics.GradeLevel'`) — no cross-app model imports.

**Phasing** (each phase gets its own implementation plan via `writing-plans` once this spec is approved):
1. **Fees module** — full ledger, invoicing, payments, receipts, optional items, adjustments/scholarships, reporting, report-card gate.
2. **Payroll module** — salary components, profiles, runs, payslips.
3. **General Ledger module** — GL entries, categories, vendors, budgeting.
4. **Cross-cutting** — promotion gate wiring, term/year closing, notifications.
5. **Future** — online payment gateway integration (not scoped here).

## 4. Fee module

### 4.1 Configuration (admin-editable, DB-first)

- **`FeeCategory`** — name, description. E.g. Tuition, Transport, Boarding, Exam, Activity. Used both as fee-structure line items and as a reporting dimension.

### 4.2 Fee structures

- **`FeeStructure`** — `grade_level` FK (`academics.GradeLevel`), `term` FK (`academics.ExamTerm`), `name`, `status` (`draft`/`active`). One per grade/term.
- **`FeeStructureItem`** — `fee_structure` FK, `category` FK (`FeeCategory`), `amount`, `is_optional` (bool). Mandatory items apply to every student in the grade automatically; optional items only apply to students with an enrollment record.

### 4.3 Optional/elective items

- **`StudentFeeItemEnrollment`** — `student` FK, `fee_structure_item` FK. The opt-in roster: admin picks an optional item (e.g. "Swimming Club") and checks off which students are enrolled. Invoice generation includes every mandatory item for the student's grade plus any optional items they have an enrollment row for.

### 4.4 Adjustments (scholarships, discounts, penalties)

- **`StudentFeeAdjustment`** — `student` FK, `category` FK (`FeeCategory`, nullable), `adjustment_type` (`discount`/`scholarship`/`bursary`/`penalty`/`correction`), `amount` (signed), `reason` (text), `approved_by` FK (`auth.User`, **required** for any negative/waiving adjustment — an audit requirement, not optional). Posts a row to the student's ledger like any other entry.

### 4.5 Invoicing, payment, receipts

- **`Invoice`** — `student` FK, `fee_structure` FK, `total`, `status` (`unpaid`/`partially_paid`/`paid`/`overdue`/`voided`), `invoice_number` (sequential, e.g. `INV-2026-000123`, never reused), `issued_at`. Snapshots line items (mandatory + the student's enrolled optional items + adjustments) at generation time via a related `InvoiceLineItem` table, so a later `FeeStructure` edit never retroactively changes an already-issued invoice.
- **Generation**: bulk-generated when admin activates a `FeeStructure` (`status` → `active`) for a term — a Celery task on the existing `bulk_ops` queue (same shape as timetable/allocation bulk jobs: mutates many rows, needs `is_worker_available` 503-if-no-worker handling), generating one invoice per student in that grade.
- **`Payment`** — `student` FK, `invoice` FK (nullable — can apply against overall balance, not just one invoice), `amount`, `method` (choices: `cash`/`bank_transfer`/`mpesa`/`cheque`/`other` — see §9 on why this one field stays a simple choice list), `reference`, `status` (`confirmed` for all manual entries now; `pending`/`failed` reserved for a future gateway path), `recorded_by` FK, `cash_account` FK (`CashAccount`, §6.1), `date`.
- **`Receipt`** — 1:1 with a confirmed `Payment`, `receipt_number` (sequential, e.g. `RCPT-2026-000456`), generated synchronously the instant the payment is confirmed (no Celery needed — single row).
- **Immutable once created, void-and-reissue only**: an `Invoice` or `Payment`'s financial fields (amount, line items, method, date, student, category) can never be edited after creation — not by any role, not even the recording user seconds later. The only permitted mutations are status transitions (e.g. `unpaid` → `paid`) and the void fields themselves. Correcting a mistake means voiding the record and creating a fresh one; there is no "edit invoice" or "edit payment" form anywhere in the UI. This is a deliberate security/audit-trail property, not just a UI choice — enforced at the service layer (an update to a protected field after creation raises, regardless of what the frontend sends).
- **No delete button in the Finance Hub UI at all** — voiding is the only destructive-looking action a Finance Officer (or admin) ever sees, on both invoices and payments. Invoices and payments are never hard-deleted through normal use; a void sets `voided_at`/`voided_by`/`void_reason` and posts a correcting entry to the ledger, and the original numbered document is retained for audit. Hard deletion is a separate, narrow, super-admin-only capability that does not appear as a button in the Finance Hub itself — see §7.5.

### 4.6 Per-student ledger

- **`StudentFeeLedgerEntry`** — `student` FK, `entry_type` (`charge`/`payment`/`adjustment`), `amount`, `running_balance` (stored, updated transactionally with `select_for_update()` on the student to prevent concurrent-payment races), `reference` (generic FK to the `Invoice`/`Payment`/`StudentFeeAdjustment` that caused it), `date`, `description`. Every invoice generation, confirmed payment, and adjustment writes exactly one row here inside the same `transaction.atomic()` block. This is the single source of truth for what a student currently owes — nothing else sums invoices and payments separately.

### 4.7 Fee-payment gate

- **`is_fees_clear(student_id, term_id, grace_threshold=0)`** in `services_fees.py` — reads the student's latest `running_balance` for the term, real implementation replacing the current no-op stub. `grace_threshold` allows an admin-configured leeway (e.g. "clear" if balance ≤ 500).
- **Consumers** (both call this same function, no bespoke logic per consumer):
  1. Report card / exam results release (phase 4, first).
  2. Student promotion/graduation — a new check inside the existing `PromotionEvent` flow (phase 4, second).
- Designed so a third gated feature (e.g. transcript issuance) is one more call site later, not new logic.

## 5. Payroll module

- **`SalaryComponent`** — name, `is_allowance` / `is_deduction` (exactly one true). E.g. Base Salary, Housing Allowance, Transport Allowance, PAYE, NHIF/SHA, Loan Repayment. Admin-editable, no computation logic attached (§2).
- **`StaffSalaryProfile`** — one per staff member, keyed by `user` (`OneToOneField('auth.User')`, the same key both `TeacherExtra` and `StaffExtra` already hang off) rather than a generic relation, so the profile isn't tied to which staff subtype the user is. `on_school_payroll` (bool, defaults `True` when the user has a `StaffExtra` profile, `False` when they have a `TeacherExtra` profile — admin flips it on per privately-employed teacher, since TSC-paid teachers must be excluded from payroll runs entirely), and a set of `StaffSalaryComponentAmount` rows (component + current amount) representing their personal pay structure.
- **`PayrollRun`** — `name` (e.g. "September 2026"), `period_start`/`period_end`, `status` (`draft`/`processed`/`paid`). Bulk-generated (Celery, `bulk_ops` queue) for every `on_school_payroll=True` staff member.
- **`PayrollEntry`** — one per staff member per run: `gross_pay`, `net_pay`, a snapshot of component amounts at run time via `PayrollEntryLineItem` (so a later salary change never alters a past payslip), `paid_date`, `voided_at`/`voided_by`/`void_reason`.
- **`Payslip`** — 1:1 with a `PayrollEntry`, `payslip_number` (sequential), branded PDF, same generation convention as invoices/receipts.
- **Immutable, void-and-reissue only**: same rule as Fees (§4.5) — a `PayrollEntry`'s pay fields can't be edited after creation, and it's never hard-deleted through normal use even if a run was processed in error, and there's no delete button anywhere in the UI. Voiding sets the fields above; a correction is a new entry in the next run, not an edit to history. Hard deletion is super-admin-only — see §7.5.

## 6. General Ledger module

- **`GLCategory`** — name (Utilities, Supplies, Maintenance, Rent, Other Income, etc.), `is_income` / `is_expense`. Separate table from `FeeCategory` — different domain.
- **`GeneralLedgerEntry`** — `category` FK, `entry_type` (`income`/`expense`), `amount`, `date`, `description`, `vendor` FK (`Vendor`, nullable), `cash_account` FK (`CashAccount`, nullable), `recorded_by` FK, `voided_at`/`voided_by`/`void_reason`. Same immutable, void-and-reissue-only, no-delete-button, super-admin-only-hard-delete rules as Fees/Payroll (§4.5, §7.5).
- **`Vendor`** — name, contact info. Enables "how much did we pay this supplier this year" without depending on free-text description parsing.
- **`Budget`** — `gl_category` FK, `period` (term or year), `amount`. Reporting compares actual `GeneralLedgerEntry` totals per category against this.

## 7. Cross-cutting

### 7.1 CashAccount

`CashAccount` — name, `account_type` (`bank`/`petty_cash`/`mobile_money`), seeded with a small default set (Bank Account, Petty Cash, M-Pesa Till) even without detailed requirements yet, since `Payment` and `GeneralLedgerEntry` both reference it optionally. Enables a real cash-position report later; no reconciliation feature built now.

### 7.2 Term/year closing

- **`FinancialPeriod`** — wraps an `academics.ExamTerm` or `academics.AcademicYear`, `is_closed` (bool), `closed_by`, `closed_at`. Once closed, invoices/payments/payroll entries/GL entries dated within that period become immutable at the service layer (an explicit admin reopen is required to edit past-period records) — an accounting-integrity safeguard.

### 7.3 RBAC

New `Permission` rows under the existing `Role`/`Permission`/`UserRole` system (not a new auth mechanism): record payment, edit fee structure, run payroll, close financial period, approve negative adjustment, void invoice/payment. A `Finance Officer` role bundles the relevant set, assignable the same way any other role is today.

### 7.4 Notifications

Overdue-fee reminders and "payslip ready" notices publish through the existing messaging event bus (same pattern as `BackgroundJobCompletedEvent` → `apps.messaging.receivers`), replacing the `fee_reminders` field in `Notifications.tsx` currently hardcoded to 0.

### 7.5 Hard delete (super-admin only) and audit logging

- **Hard delete is a separate, deliberately narrow escape hatch from the void pattern (§4.5, §5, §6)** — normal Finance Officer / accountant use never deletes or edits a financial row, only voids it and creates a new one. A true hard delete (e.g. removing a genuinely erroneous duplicate that shouldn't even appear in history) is gated behind a new RBAC permission granted only to the `SUPER_ADMIN` tier — not the general `Finance Officer` role from §7.3 — and requires the target record to already be voided first (defense in depth: you can't hard-delete something that was never flagged as wrong). It has no button in the Finance Hub UI (§10) — it's a Django-admin-only action, deliberately harder to reach than anything a day-to-day user does.
- **Every financial action is audit-logged** through the existing `apps.core.services.write_audit_log()` / `SystemAuditLog` mechanism (the same "immutable operational ledger" already used for allocation splits, promotions, and approvals) — no new audit infrastructure. `module='finance'` on every call. Logged actions: invoice generation (bulk and per-student), payment recorded, payment/invoice/GL-entry/payroll-entry voided, adjustment approved, payroll run processed, financial period closed/reopened, fee structure activated, and hard delete.
- `SystemAuditLog.ACTION_CHOICES` (`apps/core/models.py`) needs one new entry — `('HARD_DELETE', 'Permanently Deleted Resource')` — since no existing choice distinguishes a true hard delete from a soft `DELETE`/void. This is a small additive migration on `apps.core`, called out here since implementation won't run it (§13).

## 8. Reporting

All read-only queries in `services_reports.py`, no new stored aggregates beyond `StudentFeeLedgerEntry.running_balance`:

- **KPI tiles**: outstanding accounts receivable, unpaid invoice count, overdue count, 30-day collections.
- **Collections trend chart**: payments over time — replaces `FinanceChart.tsx`'s mock data.
- **Fee-category breakdown**: income by `FeeCategory`.
- **Student balance/aging list**: searchable, sortable by how overdue.
- **Income statement**: total income (Fees + GL income) − total expense (Payroll + GL expense), scoped by period. This is the ceiling of formal financial statements in scope (§2).
- **Budget vs. actual**: per `GLCategory`, per period.

## 9. Payment methods — the one deliberately non-real piece

Everything in this subsystem is real, persisted data — no mock/sample arrays anywhere, replacing `MOCK_FINANCE_BREAKDOWN`/`INCOME_CATEGORIES`/`EXPENSE_CATEGORIES` in `financeCategories.tsx` entirely. The single exception: `Payment.method` is a fixed Django `choices` list (`cash`, `bank_transfer`, `mpesa`, `cheque`, `other`), not a DB-configurable table or real gateway integration, because there's no real payment-mode data or gateway access to model against yet. This is a narrow, explicit exception — not a precedent for mocking anything else in the design.

## 10. Frontend integration

- `FinanceHub.tsx`'s three tabs rewired to real endpoints; the current "Income & Expense" mock tab becomes real GL data.
- `FinanceChart.tsx` (dashboard home) switches from mock to real collections-trend + income-statement summary.
- New admin pages: Fee Structures, Invoices, Payments, Payroll Runs, GL Entries, Reports — following the MUI-for-admin-dashboard convention (`AssignSubjectsPage.tsx` pattern, `adminTheme.ts`), not raw Tailwind.
- New parent/staff read-only pages: own fee balance/ledger statement, own payslip history.
- `ManageEnrollments.tsx`'s hardcoded fake `fee_balance` (`school/views/class_views.py`) replaced with a real value from `StudentFeeLedgerEntry`.
- **No edit or delete controls for invoices, payments, GL entries, or payroll entries anywhere in the Finance Hub UI** — each of those list/detail views offers a "Void" action (with a required reason) and nothing that mutates amounts/line items in place. Voiding a record's UI flow ends by prompting to create its replacement, making void-and-reissue the obvious single path rather than something a user has to know to do in two separate steps.

## 11. Error handling & data integrity

- All ledger-affecting writes (invoice generation, payment posting, payroll processing, adjustments) run inside `transaction.atomic()`.
- Concurrent payments against the same student use `select_for_update()` on the student's ledger to serialize running-balance updates.
- Bulk invoice/payroll generation reuse the existing `is_worker_available` 503-if-no-Celery-worker pattern.
- No hard deletes on any numbered financial document through normal use — void pattern only (§4.5); hard delete is a separate super-admin-only path that requires the record already be voided (§7.5).
- Every create/void/hard-delete/approve/run/close action in the finance hub writes to `SystemAuditLog` via `write_audit_log()` (§7.5) — this should happen inside the same `transaction.atomic()` block as the underlying write, not as a best-effort afterthought, so an audit entry can never go missing for a write that succeeded.

## 12. Testing

Given this repo has real backend test coverage but zero frontend tests, new backend tests should cover:
- Running-balance correctness under concurrent payments.
- Invoice/receipt/payslip numbering — never collides, never reused after a void.
- `is_fees_clear()` at grace-threshold boundaries, and its two consumers (report card, promotion) correctly blocking/allowing.
- Optional-item invoice generation only includes enrolled students.
- Hard delete is rejected for non-voided records and for any non-super-admin operator; every finance action produces exactly one matching `SystemAuditLog` row.
- Financial-period closing correctly rejects edits to closed-period records.

## 13. Migration notes

No `makemigrations`/`migrate` will be run by Claude — per this repo's standing rule, the user runs migrations themselves. Each implementation phase's plan will state which migrations need to be generated and applied, but stop short of running them.
