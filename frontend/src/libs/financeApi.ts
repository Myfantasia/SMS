// Shared finance API client — consumed by Task 21 (Fee Structures admin page) and every
// later finance frontend task (22-24: invoices, payments, ledger/reports). Types and
// endpoint paths below are verified directly against apps/finance/urls.py,
// apps/finance/serializers_fees.py and apps/finance/views.py as of Task 21a/21b — not
// guessed from the original spec.
import api, { API_BASE_URL } from './axiosInstance';

// --- Lookups (Task 21a) ---------------------------------------------------------------
// Finance-scoped picklists so a Finance Officer (who does not hold classes.view/exams.view)
// can still populate the Fee Structure form's grade/term dropdowns.

export interface GradeLevelOption {
  id: number;
  name: string;
}

export interface ExamTermOption {
  id: number;
  name: string;
  academic_year_id: number;
}

export const listGradeLevelOptions = () =>
  api.get<GradeLevelOption[]>('/api/finance/lookups/grades/');
export const listExamTermOptions = (academicYearId?: number) =>
  api.get<ExamTermOption[]>('/api/finance/lookups/terms/', {
    params: academicYearId ? { academic_year_id: academicYearId } : {},
  });

// Task 22b: student picklist for the payment-recording form. `q` must be >= 2 chars
// (StudentLookupQuerySerializer) or the backend 400s — callers debounce and gate on
// length client-side before calling this. Scoped to currently-enrolled students, capped
// at 8 results server-side.
export interface StudentLookupOption {
  id: number;
  name: string;
  roll: string;
}

export const searchStudents = (q: string) =>
  api.get<StudentLookupOption[]>('/api/finance/lookups/students/', { params: { q } });

// --- Fee categories / structures (Task 15) --------------------------------------------

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

export const listFeeCategories = () => api.get<FeeCategory[]>('/api/finance/fee-categories/');
export const createFeeCategory = (data: { name: string; description?: string }) =>
  api.post<FeeCategory>('/api/finance/fee-categories/', data);

export const listFeeStructures = () => api.get<FeeStructure[]>('/api/finance/fee-structures/');
export const createFeeStructure = (data: { grade_level: number; term: number; name: string }) =>
  api.post<FeeStructure>('/api/finance/fee-structures/', data);
export const getFeeStructure = (structureId: number) =>
  api.get<FeeStructureDetail>(`/api/finance/fee-structures/${structureId}/`);

// 202 on success ({status: 'queued', job_id}); the view can also return 404 (structure
// not found) or 503 ({error: '...'}) when no Celery worker is consuming the bulk_ops
// queue — see school/jobs.py dispatch_background_job. Callers must branch on these.
export const activateFeeStructure = (structureId: number) =>
  api.post<{ status: string; job_id: string }>(`/api/finance/fee-structures/${structureId}/activate/`);

// PUT replaces the whole optional-item enrollment roster; unknown ids are echoed back
// in ignored_student_ids rather than failing the request.
export const setFeeItemEnrollment = (itemId: number, studentIds: number[]) =>
  api.put<{ status: string; enrolled_count: number; ignored_student_ids: number[] }>(
    `/api/finance/fee-structure-items/${itemId}/enrollments/`, { student_ids: studentIds },
  );

// --- Invoices --------------------------------------------------------------------------

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
  voided_at: string | null;
  void_reason: string;
  line_items: InvoiceLineItem[];
  credit_applied: number;
}

export interface InvoiceDetail extends Invoice {
  payments: Payment[];
}

export const listInvoices = (params?: { student_id?: number; fee_structure_id?: number; status?: Invoice['status'] }) =>
  api.get<Invoice[]>('/api/finance/invoices/', { params });
export const getInvoice = (invoiceId: number) =>
  api.get<InvoiceDetail>(`/api/finance/invoices/${invoiceId}/`);
export const voidInvoice = (invoiceId: number, reason: string) =>
  api.post<Invoice>(`/api/finance/invoices/${invoiceId}/void/`, { reason });

// --- Payments ----------------------------------------------------------------------------

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
  receipt_id: number | null;
  is_voided: boolean;
  voided_at: string | null;
  void_reason: string;
}

export const listPayments = (studentId?: number) =>
  api.get<Payment[]>('/api/finance/payments/', { params: studentId ? { student_id: studentId } : {} });
export const recordPayment = (data: {
  student: number; invoice?: number | null; amount: number; method: Payment['method']; reference?: string; date?: string | null;
}) => api.post<Payment>('/api/finance/payments/', data);
export const voidPayment = (paymentId: number, reason: string) =>
  api.post<Payment>(`/api/finance/payments/${paymentId}/void/`, { reason });

// --- Adjustments -------------------------------------------------------------------------

export interface StudentFeeAdjustment {
  id: number;
  student: number;
  category: number | null;
  adjustment_type: 'discount' | 'scholarship' | 'bursary' | 'penalty' | 'correction';
  amount: number;
  reason: string;
  requested_by: number;
  approved_by: number | null;
  created_at: string;
}

export const createAdjustment = (data: {
  student: number; category?: number | null; adjustment_type: StudentFeeAdjustment['adjustment_type'];
  amount: number; reason: string; approved_by?: number | null;
}) => api.post<StudentFeeAdjustment>('/api/finance/adjustments/', data);

// --- Ledger / clearance ------------------------------------------------------------------

export interface LedgerEntry {
  id: number;
  entry_type: 'charge' | 'payment' | 'adjustment';
  amount: number;
  running_balance: number;
  description: string;
  date: string;
}

export const getStudentLedger = (studentId: number, params?: { limit?: number; offset?: number }) =>
  api.get<{ balance: number; credit_balance: number; entries: LedgerEntry[] }>(
    `/api/finance/students/${studentId}/ledger/`, { params },
  );
// The logged-in student's own ledger, resolved server-side by MyFeeLedgerAPIView (Task 24) --
// same response shape as getStudentLedger, no id needed.
export const getMyFeeLedger = (params?: { limit?: number; offset?: number }) =>
  api.get<{ balance: number; credit_balance: number; entries: LedgerEntry[] }>(
    '/api/finance/students/me/ledger/', { params },
  );
export const getFeeClearanceStatus = (studentId: number, termId?: number, graceThreshold?: number) =>
  api.get<{ is_clear: boolean | null; credit_balance: number; blocked_report_card: boolean; blocked_promotion: boolean }>(
    `/api/finance/students/${studentId}/fee-clearance/`,
    { params: { term_id: termId, grace_threshold: graceThreshold } },
  );
// The logged-in student's own clearance status, resolved server-side by
// MyFeeClearanceStatusAPIView (Task 29 follow-up) -- same response shape as
// getFeeClearanceStatus, no id needed. Lets the own-statement view (no studentId
// prop) show the same blocked-gate badge a parent viewing a child already gets.
export const getMyFeeClearanceStatus = (termId?: number, graceThreshold?: number) =>
  api.get<{ is_clear: boolean | null; credit_balance: number; blocked_report_card: boolean; blocked_promotion: boolean }>(
    '/api/finance/students/me/fee-clearance/',
    { params: { term_id: termId, grace_threshold: graceThreshold } },
  );

// --- Fee-clearance policy + overrides (Task 28/29, spec 4.9) ---------------------------

export interface FeeClearancePolicy {
  block_report_cards: boolean;
  block_promotion: boolean;
  grace_threshold: number;
  updated_at: string;
  updated_by: number | null;
}

export const getFeeClearancePolicy = () =>
  api.get<FeeClearancePolicy>('/api/finance/fee-clearance-policy/');
export const updateFeeClearancePolicy = (patch: {
  block_report_cards?: boolean; block_promotion?: boolean; grace_threshold?: number;
}) => api.patch<FeeClearancePolicy>('/api/finance/fee-clearance-policy/', patch);

export interface ClearanceOverride {
  id: number;
  student: number;
  gate: 'report_card' | 'promotion';
  term: number | null;
  academic_year: number | null;
  reason: string;
  granted_by: number;
  created_at: string;
  revoked_at: string | null;
  revoked_by: number | null;
  revoke_reason: string;
}

export const listClearanceOverrides = (params?: { student_id?: number; gate?: ClearanceOverride['gate'] }) =>
  api.get<ClearanceOverride[]>('/api/finance/clearance-overrides/', { params });
export const grantClearanceOverride = (data: {
  student: number; gate: ClearanceOverride['gate']; term?: number; academic_year?: number; reason: string;
}) => api.post<ClearanceOverride>('/api/finance/clearance-overrides/', data);
export const revokeClearanceOverride = (overrideId: number, reason: string) =>
  api.post<ClearanceOverride>(`/api/finance/clearance-overrides/${overrideId}/revoke/`, { reason });

// --- Documents ---------------------------------------------------------------------------
// Used as direct <a href>/window.open targets, not fetched via axios — the endpoints
// return raw PDF bytes (inline Content-Disposition). A plain relative path would resolve
// against the Vite dev server's own origin (5173), not Django's (8000), and 404 — so
// these are prefixed with the same backend origin axiosInstance.ts uses.
export const invoicePdfUrl = (invoiceId: number) => `${API_BASE_URL}/api/finance/invoices/${invoiceId}/pdf/`;
export const receiptPdfUrl = (receiptId: number) => `${API_BASE_URL}/api/finance/receipts/${receiptId}/pdf/`;

// --- Reports -----------------------------------------------------------------------------

export interface FeeKpiTiles {
  outstanding_ar: number;
  total_credit: number;
  unpaid_invoice_count: number;
  overdue_count: number;
  collections_30d: number;
}

export const getFeeKpiTiles = () => api.get<FeeKpiTiles>('/api/finance/reports/kpi-tiles/');
export const getCollectionsTrend = (days = 30) => api.get('/api/finance/reports/collections-trend/', { params: { days } });
export const getFeeCategoryBreakdown = () => api.get('/api/finance/reports/category-breakdown/');
export const getStudentBalanceAging = () => api.get('/api/finance/reports/student-aging/');
