import { useEffect, useMemo, useState } from 'react';
import { CircleDollarSign, Banknote, Wallet, TrendingUp, TrendingDown, Search, Users, GraduationCap, PieChart, Layers, FileText, Receipt, PiggyBank, ShieldCheck, ShieldOff, ClipboardCheck, FilePlus, Percent, CalendarClock } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useTheme } from '@mui/material/styles';
import {
  Switch, TextField, Button, Dialog, DialogTitle, DialogContent, DialogActions,
  Select, MenuItem, FormControl, FormHelperText, InputLabel, Autocomplete, Chip, CircularProgress,
  Radio, RadioGroup, FormControlLabel,
} from '@mui/material';
import toast from 'react-hot-toast';
import { useNavigate, useOutletContext } from 'react-router-dom';
import api from '../../libs/axiosInstance';
import {
  getStudentBalanceAging, getFeeKpiTiles, type FeeKpiTiles,
  getFeeClearancePolicy, updateFeeClearancePolicy, type FeeClearancePolicy,
  listClearanceOverrides, grantClearanceOverride, revokeClearanceOverride, type ClearanceOverride,
  searchStudents, type StudentLookupOption, listExamTermOptions, type ExamTermOption,
  listAdjustments, decideAdjustment, createAdjustment, listFeeCategories, type FeeCategory, type StudentFeeAdjustment,
  listGradeLevelOptions, type GradeLevelOption,
  listDiscountTypes, createDiscountType, updateDiscountType, type DiscountType,
  listDiscountRules, createDiscountRule, previewDiscountRule, updateDiscountRule, applyDiscountRule,
  type DiscountRule, type DiscountRuleTarget, type DiscountRulePreview, type DiscountRuleApplyResult,
} from '../../libs/financeApi';
import type { DashboardContextType } from '../../layouts/DashboardLayouts';
import { INCOME_CATEGORIES, EXPENSE_CATEGORIES, MOCK_FINANCE_BREAKDOWN } from './financeCategories';
import { AdjustmentStatusChip } from './AdjustmentStatusChip';

// Both the service-layer 400/403 shape (`{error: "..."}`) and a DRF serializer-validation
// 400 (`{field: ["..."]}`) are real possibilities from the clearance-policy/override
// endpoints -- same extraction helper as InvoicesPage.tsx/PaymentsPage.tsx use for their
// void dialogs, copied here rather than shared since neither file currently exports it.
function extractErrorMessage(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: Record<string, unknown> } })?.response?.data;
  if (!data) return fallback;
  if (typeof data.error === 'string') return data.error;
  if (typeof data.detail === 'string') return data.detail;
  const firstKey = Object.keys(data)[0];
  const firstValue = firstKey ? data[firstKey] : undefined;
  if (Array.isArray(firstValue) && typeof firstValue[0] === 'string') return firstValue[0];
  return fallback;
}

const GATE_LABELS: Record<ClearanceOverride['gate'], string> = {
  report_card: 'Report Card', promotion: 'Promotion',
};

/** Fee-clearance policy switches + grace threshold (spec 4.9). Renders only for a
 * finance.view holder (implied by reaching this page, but checked anyway per this
 * codebase's double-gating convention -- see CurriculumHub.tsx's canEdit/canArchive);
 * every control is disabled (not hidden) without finance.edit. */
function FeeClearancePolicyCard({ permissions }: { permissions: string[] }) {
  const canView = permissions.includes('finance.view');
  const canEdit = permissions.includes('finance.edit');
  const [policy, setPolicy] = useState<FeeClearancePolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [graceThresholdInput, setGraceThresholdInput] = useState('0');

  useEffect(() => {
    if (!canView) {
      setLoading(false);
      return;
    }
    getFeeClearancePolicy()
      .then((res) => {
        setPolicy(res.data);
        setGraceThresholdInput(String(res.data.grace_threshold));
      })
      .catch(() => toast.error('Failed to load the fee-clearance policy.'))
      .finally(() => setLoading(false));
  }, [canView]);

  if (!canView) return null;

  const save = async (patch: Partial<Pick<FeeClearancePolicy, 'block_report_cards' | 'block_promotion' | 'grace_threshold'>>) => {
    setSaving(true);
    try {
      const res = await updateFeeClearancePolicy(patch);
      setPolicy(res.data);
      setGraceThresholdInput(String(res.data.grace_threshold));
      toast.success('Fee-clearance policy updated.');
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Failed to update the fee-clearance policy.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm dark:shadow-none space-y-4">
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10">
          <ShieldCheck className="w-5 h-5" strokeWidth={2.5} />
        </div>
        <div>
          <h2 className="text-base font-bold text-slate-800 dark:text-slate-100">Fee Clearance Policy</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Controls whether an unpaid balance blocks report cards or promotion.</p>
        </div>
      </div>
      {loading || !policy ? (
        <div className="py-6 flex justify-center"><CircularProgress size={24} /></div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-600 dark:text-slate-300">Block report cards for unpaid balances</span>
            <Switch
              checked={policy.block_report_cards} disabled={!canEdit || saving}
              onChange={(e) => save({ block_report_cards: e.target.checked })}
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-600 dark:text-slate-300">Block promotion for unpaid balances</span>
            <Switch
              checked={policy.block_promotion} disabled={!canEdit || saving}
              onChange={(e) => save({ block_promotion: e.target.checked })}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-slate-600 dark:text-slate-300">Grace threshold (KES)</span>
            <TextField
              size="small" type="number" value={graceThresholdInput} disabled={!canEdit || saving}
              onChange={(e) => setGraceThresholdInput(e.target.value)}
              onBlur={() => {
                const value = Number(graceThresholdInput);
                if (!Number.isFinite(value) || value < 0) {
                  toast.error('Grace threshold must be a non-negative number.');
                  setGraceThresholdInput(String(policy.grace_threshold));
                  return;
                }
                if (value !== policy.grace_threshold) save({ grace_threshold: Math.trunc(value) });
              }}
              sx={{ width: 140 }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** Grant/revoke fee-clearance overrides (spec 4.9). Gated on finance.override_clearance
 * for the whole card -- listing itself only needs finance.view, but this card's purpose
 * (granting/revoking) needs the override permission, so the card isn't worth showing to
 * someone who could only ever see it, not use it. */
function ClearanceOverridesCard() {
  const [overrides, setOverrides] = useState<ClearanceOverride[]>([]);
  const [loading, setLoading] = useState(true);
  const [studentQuery, setStudentQuery] = useState('');
  const [studentOptions, setStudentOptions] = useState<StudentLookupOption[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<StudentLookupOption | null>(null);
  const [gate, setGate] = useState<ClearanceOverride['gate']>('report_card');
  const [terms, setTerms] = useState<ExamTermOption[]>([]);
  const [selectedTermId, setSelectedTermId] = useState<number | ''>('');
  // No academic-year lookup exists in financeApi.ts (only grade/term lookups from Task
  // 21a) -- a plain numeric id field is the minimal fallback the brief allows for this case.
  const [academicYearId, setAcademicYearId] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<ClearanceOverride | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [revoking, setRevoking] = useState(false);

  const load = () => {
    listClearanceOverrides()
      .then((res) => setOverrides(res.data.filter((o) => !o.revoked_at)))
      .catch(() => toast.error('Failed to load clearance overrides.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    listExamTermOptions().then((res) => setTerms(res.data)).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const q = studentQuery.trim();
    if (q.length < 2) {
      setStudentOptions([]);
      return;
    }
    const handle = setTimeout(() => {
      searchStudents(q).then((res) => setStudentOptions(res.data)).catch(() => undefined);
    }, 300);
    return () => clearTimeout(handle);
  }, [studentQuery]);

  const resetForm = () => {
    setSelectedStudent(null);
    setStudentQuery('');
    setGate('report_card');
    setSelectedTermId('');
    setAcademicYearId('');
    setReason('');
  };

  const handleGrant = async () => {
    if (!selectedStudent) {
      toast.error('Select a student.');
      return;
    }
    if (!reason.trim()) {
      toast.error('A reason is required.');
      return;
    }
    if (gate === 'report_card' && !selectedTermId) {
      toast.error('Select a term for a report-card override.');
      return;
    }
    if (gate === 'promotion' && !academicYearId.trim()) {
      toast.error('Enter an academic year id for a promotion override.');
      return;
    }
    setSubmitting(true);
    try {
      await grantClearanceOverride({
        student: selectedStudent.id,
        gate,
        reason: reason.trim(),
        term: gate === 'report_card' ? Number(selectedTermId) : undefined,
        academic_year: gate === 'promotion' ? Number(academicYearId) : undefined,
      });
      toast.success('Override granted.');
      resetForm();
      load();
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Failed to grant the override.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    if (!revokeReason.trim()) {
      toast.error('A revoke reason is required.');
      return;
    }
    setRevoking(true);
    try {
      await revokeClearanceOverride(revokeTarget.id, revokeReason.trim());
      toast.success('Override revoked.');
      setRevokeTarget(null);
      setRevokeReason('');
      load();
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Failed to revoke the override.'));
    } finally {
      setRevoking(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm dark:shadow-none space-y-4">
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10">
          <ShieldOff className="w-5 h-5" strokeWidth={2.5} />
        </div>
        <div>
          <h2 className="text-base font-bold text-slate-800 dark:text-slate-100">Fee Clearance Overrides</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Let one student through a blocked gate despite an unpaid balance.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Autocomplete
          size="small"
          options={studentOptions}
          getOptionLabel={(o) => `${o.name} (${o.roll})`}
          value={selectedStudent}
          onChange={(_, value) => setSelectedStudent(value)}
          inputValue={studentQuery}
          onInputChange={(_, value) => setStudentQuery(value)}
          renderInput={(params) => <TextField {...params} label="Student" placeholder="Search by name or roll" />}
        />
        <FormControl size="small">
          <InputLabel id="clearance-gate-label">Gate</InputLabel>
          <Select
            labelId="clearance-gate-label" label="Gate" value={gate}
            onChange={(e) => setGate(e.target.value as ClearanceOverride['gate'])}
          >
            <MenuItem value="report_card">Report Card</MenuItem>
            <MenuItem value="promotion">Promotion</MenuItem>
          </Select>
        </FormControl>
        {gate === 'report_card' ? (
          <FormControl size="small">
            <InputLabel id="clearance-term-label">Term</InputLabel>
            <Select
              labelId="clearance-term-label" label="Term" value={selectedTermId}
              onChange={(e) => setSelectedTermId(e.target.value as number)}
            >
              {terms.map((t) => <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>)}
            </Select>
          </FormControl>
        ) : (
          <TextField
            size="small" type="number" label="Academic year id" value={academicYearId}
            onChange={(e) => setAcademicYearId(e.target.value)}
            helperText="No academic-year lookup exists yet — enter the id directly."
          />
        )}
        <TextField
          size="small" label="Reason (required)" value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <Button variant="contained" onClick={handleGrant} disabled={submitting}>
        {submitting ? 'Granting...' : 'Grant Override'}
      </Button>

      <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
        {loading ? (
          <div className="py-4 flex justify-center"><CircularProgress size={20} /></div>
        ) : overrides.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500 py-2">No active overrides.</p>
        ) : (
          <div className="space-y-2 mt-2">
            {overrides.map((o) => (
              <div key={o.id} className="flex items-center justify-between gap-3 text-sm py-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <Chip label={GATE_LABELS[o.gate]} size="small" />
                  <span className="text-slate-600 dark:text-slate-300 truncate">Student #{o.student} — {o.reason}</span>
                </div>
                <Button size="small" color="error" onClick={() => setRevokeTarget(o)}>Revoke</Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={!!revokeTarget} onClose={() => (!revoking && setRevokeTarget(null))}>
        <DialogTitle>Revoke override</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth multiline minRows={2} label="Reason (required)" value={revokeReason}
            onChange={(e) => setRevokeReason(e.target.value)} autoFocus
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRevokeTarget(null)} disabled={revoking}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleRevoke} disabled={revoking}>
            {revoking ? 'Revoking...' : 'Confirm Revoke'}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}

const ADJUSTMENT_TYPE_LABELS: Record<StudentFeeAdjustment['adjustment_type'], string> = {
  discount: 'Discount', scholarship: 'Scholarship', bursary: 'Bursary', penalty: 'Penalty', correction: 'Correction',
};

/** Pending fee-adjustment approvals queue (spec 4.10). Visible to finance.view, matching the
 * list endpoint. Approve/Reject are hidden (not disabled) unless the viewer holds
 * finance.approve_adjustment AND is not the requester -- client-side defense in depth only;
 * the backend enforces both. The serializer exposes requested_by as a user id only, so the
 * requester is shown as "Requester #<id>" (no user-name lookup endpoint exists). */
function PendingAdjustmentsCard({ permissions, userId, refreshKey, onDecided }: {
  permissions: string[]; userId: number | null; refreshKey: number; onDecided: () => void;
}) {
  const canView = permissions.includes('finance.view');
  const canApprove = permissions.includes('finance.approve_adjustment');
  const [rows, setRows] = useState<StudentFeeAdjustment[]>([]);
  const [loading, setLoading] = useState(true);
  const [localRefresh, setLocalRefresh] = useState(0);
  const [decision, setDecision] = useState<{ row: StudentFeeAdjustment; approve: boolean } | null>(null);
  const [note, setNote] = useState('');
  const [deciding, setDeciding] = useState(false);

  useEffect(() => {
    if (!canView) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    listAdjustments({ status: 'pending' })
      .then((res) => { if (active) setRows(res.data); })
      .catch(() => toast.error('Failed to load pending adjustments.'))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [canView, refreshKey, localRefresh]);

  if (!canView) return null;

  const handleDecide = async () => {
    if (!decision) return;
    setDeciding(true);
    try {
      await decideAdjustment(decision.row.id, decision.approve, note.trim() || undefined);
      toast.success(decision.approve ? 'Adjustment approved.' : 'Adjustment rejected.');
      setDecision(null);
      setNote('');
      setLocalRefresh((n) => n + 1);
      onDecided();
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Failed to record the decision.'));
      // A 400 usually means someone already decided this row -- refresh so it drops off.
      setLocalRefresh((n) => n + 1);
    } finally {
      setDeciding(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm dark:shadow-none space-y-4">
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-500/10">
          <ClipboardCheck className="w-5 h-5" strokeWidth={2.5} />
        </div>
        <div>
          <h2 className="text-base font-bold text-slate-800 dark:text-slate-100">Pending Approvals</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Fee adjustments waiting for a second person to approve or reject them.</p>
        </div>
      </div>

      {loading ? (
        <div className="py-6 flex justify-center"><CircularProgress size={24} /></div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-400 dark:text-slate-500 py-2">No adjustments awaiting approval.</p>
      ) : (
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map((row) => (
            <div key={row.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Student #{row.student}</span>
                  <Chip label={ADJUSTMENT_TYPE_LABELS[row.adjustment_type]} size="small" variant="outlined" />
                  <AdjustmentStatusChip status={row.status} />
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  KES {Number(row.amount).toLocaleString()} — {row.reason}
                </p>
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  Requester #{row.requested_by} · {new Date(row.created_at).toLocaleDateString()}
                </p>
              </div>
              {canApprove && userId !== null && row.requested_by !== userId && (
                <div className="flex gap-2 shrink-0">
                  <Button size="small" color="error" onClick={() => { setNote(''); setDecision({ row, approve: false }); }}>
                    Reject
                  </Button>
                  <Button size="small" variant="contained" color="success" onClick={() => { setNote(''); setDecision({ row, approve: true }); }}>
                    Approve
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!decision} onClose={() => (!deciding && setDecision(null))}>
        <DialogTitle>{decision?.approve ? 'Approve adjustment' : 'Reject adjustment'}</DialogTitle>
        <DialogContent>
          {decision && (
            <p className="text-sm text-slate-600 dark:text-slate-300 mb-3">
              Student #{decision.row.student} · KES {Number(decision.row.amount).toLocaleString()} — {decision.row.reason}
            </p>
          )}
          <TextField
            fullWidth multiline minRows={2} label="Note (optional)" value={note}
            onChange={(e) => setNote(e.target.value)} autoFocus
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDecision(null)} disabled={deciding}>Cancel</Button>
          <Button
            variant="contained" color={decision?.approve ? 'success' : 'error'}
            onClick={handleDecide} disabled={deciding}
          >
            {deciding ? 'Saving...' : decision?.approve ? 'Confirm Approve' : 'Confirm Reject'}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}

/** Request a fee adjustment (spec 4.10). Gated on finance.edit (matches createAdjustment's
 * backend permission). No approver field: the backend routes negative amounts to pending
 * and positive amounts straight to approved. */
function RequestAdjustmentCard({ permissions, onSubmitted, typesVersion }: { permissions: string[]; onSubmitted: () => void; typesVersion: number }) {
  const canEdit = permissions.includes('finance.edit');
  const [studentQuery, setStudentQuery] = useState('');
  const [studentOptions, setStudentOptions] = useState<StudentLookupOption[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<StudentLookupOption | null>(null);
  const [categories, setCategories] = useState<FeeCategory[]>([]);
  const [categoryId, setCategoryId] = useState<number | ''>('');
  const [discountTypes, setDiscountTypes] = useState<DiscountType[]>([]);
  const [discountTypeId, setDiscountTypeId] = useState<number | ''>('');
  const [adjustmentType, setAdjustmentType] = useState<StudentFeeAdjustment['adjustment_type']>('discount');
  const [amountInput, setAmountInput] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!canEdit) return;
    listFeeCategories().then((res) => setCategories(res.data)).catch(() => undefined);
    listDiscountTypes({ active: true }).then((res) => setDiscountTypes(res.data)).catch(() => undefined);
  }, [canEdit, typesVersion]);

  useEffect(() => {
    const q = studentQuery.trim();
    if (q.length < 2) {
      setStudentOptions([]);
      return;
    }
    const handle = setTimeout(() => {
      searchStudents(q).then((res) => setStudentOptions(res.data)).catch(() => undefined);
    }, 300);
    return () => clearTimeout(handle);
  }, [studentQuery]);

  if (!canEdit) return null;

  const resetForm = () => {
    setSelectedStudent(null);
    setStudentQuery('');
    setCategoryId('');
    setDiscountTypeId('');
    setAdjustmentType('discount');
    setAmountInput('');
    setReason('');
  };

  const handleSubmit = async () => {
    if (!selectedStudent) {
      toast.error('Select a student.');
      return;
    }
    const amount = Number(amountInput);
    if (!amountInput.trim() || !Number.isFinite(amount) || amount === 0) {
      toast.error('Enter a non-zero amount.');
      return;
    }
    if (!reason.trim()) {
      toast.error('A reason is required.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await createAdjustment({
        student: selectedStudent.id,
        category: categoryId === '' ? null : categoryId,
        discount_type: discountTypeId === '' ? null : discountTypeId,
        adjustment_type: adjustmentType,
        amount,
        reason: reason.trim(),
      });
      if (res.data.status === 'pending') {
        toast.success('Adjustment submitted. It is awaiting approval.');
      } else {
        toast.success('Adjustment posted.');
      }
      resetForm();
      onSubmitted();
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Failed to submit the adjustment.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm dark:shadow-none space-y-4">
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-500/10">
          <FilePlus className="w-5 h-5" strokeWidth={2.5} />
        </div>
        <div>
          <h2 className="text-base font-bold text-slate-800 dark:text-slate-100">Request Fee Adjustment</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Discounts, scholarships, bursaries, penalties or corrections on a student's account.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Autocomplete
          size="small"
          options={studentOptions}
          getOptionLabel={(o) => `${o.name} (${o.roll})`}
          value={selectedStudent}
          onChange={(_, value) => setSelectedStudent(value)}
          inputValue={studentQuery}
          onInputChange={(_, value) => setStudentQuery(value)}
          renderInput={(params) => <TextField {...params} label="Student" placeholder="Search by name or roll" />}
        />
        <FormControl size="small">
          <InputLabel id="adjustment-type-label">Adjustment type</InputLabel>
          <Select
            labelId="adjustment-type-label" label="Adjustment type" value={adjustmentType}
            onChange={(e) => setAdjustmentType(e.target.value as StudentFeeAdjustment['adjustment_type'])}
          >
            {(Object.keys(ADJUSTMENT_TYPE_LABELS) as StudentFeeAdjustment['adjustment_type'][]).map((t) => (
              <MenuItem key={t} value={t}>{ADJUSTMENT_TYPE_LABELS[t]}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small">
          <InputLabel id="adjustment-category-label">Fee category (optional)</InputLabel>
          <Select
            labelId="adjustment-category-label" label="Fee category (optional)" value={categoryId}
            onChange={(e) => setCategoryId(e.target.value as number | '')}
          >
            <MenuItem value="">All categories</MenuItem>
            {categories.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small">
          <InputLabel id="adjustment-discount-type-label">Discount type (optional)</InputLabel>
          <Select
            labelId="adjustment-discount-type-label" label="Discount type (optional)" value={discountTypeId}
            onChange={(e) => setDiscountTypeId(e.target.value as number | '')}
          >
            <MenuItem value="">No discount type</MenuItem>
            {discountTypes.map((t) => <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>)}
          </Select>
          {discountTypeId !== '' && (() => {
            const chosen = discountTypes.find((t) => t.id === discountTypeId);
            if (!chosen) return null;
            return (
              <FormHelperText>
                Type value: {chosen.kind === 'percentage' ? `${Number(chosen.value)}%` : `KES ${Number(chosen.value).toLocaleString()}`}. Enter the amount for this student.
              </FormHelperText>
            );
          })()}
        </FormControl>
        <TextField
          size="small" type="number" label="Amount (KES)" value={amountInput}
          onChange={(e) => setAmountInput(e.target.value)}
          helperText="Negative amounts need approval before they post."
        />
        <TextField
          size="small" label="Reason (required)" value={reason} className="sm:col-span-2"
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <Button variant="contained" onClick={handleSubmit} disabled={submitting}>
        {submitting ? 'Submitting...' : 'Submit Adjustment'}
      </Button>
    </div>
  );
}

const DISCOUNT_KIND_LABELS: Record<DiscountType['kind'], string> = { fixed: 'Fixed amount', percentage: 'Percentage' };

type RuleTargetKind = 'grade' | 'stream' | 'students';

const formatKes = (value: number | string) => `KES ${Math.abs(Number(value)).toLocaleString()}`;

/** Target fields for a saved rule, sending only the one that is set (the service
 * rejects a rule with more than one target). */
function ruleTargetPayload(rule: DiscountRule): DiscountRuleTarget {
  if (rule.grade_level) return { grade_level: rule.grade_level };
  if (rule.class_stream) return { class_stream: rule.class_stream };
  return { student_ids: rule.student_ids };
}

/** Per-student preview lines. A zero amount means apply will skip that student. */
function PreviewSummary({ preview }: { preview: DiscountRulePreview }) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        {preview.count} student{preview.count === 1 ? '' : 's'} · total discount {formatKes(preview.total_amount)}
      </p>
      {preview.count === 0 ? (
        <p className="text-sm text-slate-400 dark:text-slate-500">No students match this target.</p>
      ) : (
        <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 rounded-lg border border-slate-100 dark:border-slate-800">
          {preview.students.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm">
              <span className="truncate text-slate-700 dark:text-slate-200">{s.name}</span>
              <span className={`shrink-0 font-semibold ${Number(s.amount) === 0 ? 'text-slate-400 dark:text-slate-500' : 'text-slate-700 dark:text-slate-200'}`}>
                {Number(s.amount) === 0 ? 'Skipped (no amount)' : formatKes(s.amount)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Admin-defined discount types (spec 4.12). Listing needs finance.view; create and
 * activate/deactivate need finance.edit, and those controls are not rendered otherwise. */
function DiscountTypesCard({ permissions, onTypesChanged }: { permissions: string[]; onTypesChanged: () => void }) {
  const canView = permissions.includes('finance.view');
  const canEdit = permissions.includes('finance.edit');
  const [types, setTypes] = useState<DiscountType[]>([]);
  const [categories, setCategories] = useState<FeeCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<DiscountType['kind']>('fixed');
  const [valueInput, setValueInput] = useState('');
  const [categoryId, setCategoryId] = useState<number | ''>('');
  const [submitting, setSubmitting] = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  useEffect(() => {
    if (!canView) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    listDiscountTypes(includeInactive ? undefined : { active: true })
      .then((res) => { if (active) setTypes(res.data); })
      .catch(() => toast.error('Failed to load discount types.'))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [canView, includeInactive, refresh]);

  useEffect(() => {
    if (!canView) return;
    listFeeCategories().then((res) => setCategories(res.data)).catch(() => undefined);
  }, [canView]);

  if (!canView) return null;

  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Enter a name for the discount type.');
      return;
    }
    const value = Number(valueInput);
    if (!valueInput.trim() || !Number.isFinite(value)) {
      toast.error('Enter a value.');
      return;
    }
    if (kind === 'percentage' && (value < 0 || value > 100)) {
      toast.error('A percentage must be between 0 and 100.');
      return;
    }
    if (kind === 'fixed' && value < 0) {
      toast.error('A fixed amount cannot be negative.');
      return;
    }
    setSubmitting(true);
    try {
      await createDiscountType({ name: trimmed, kind, value, category: categoryId === '' ? null : categoryId });
      toast.success('Discount type created.');
      setName('');
      setValueInput('');
      setCategoryId('');
      { setRefresh((n) => n + 1); onTypesChanged(); }
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Failed to create the discount type.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggle = async (row: DiscountType) => {
    setTogglingId(row.id);
    try {
      await updateDiscountType(row.id, { active: !row.active });
      toast.success(row.active ? 'Discount type deactivated.' : 'Discount type reactivated.');
      { setRefresh((n) => n + 1); onTypesChanged(); }
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Failed to update the discount type.'));
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm dark:shadow-none space-y-4">
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10">
          <Percent className="w-5 h-5" strokeWidth={2.5} />
        </div>
        <div>
          <h2 className="text-base font-bold text-slate-800 dark:text-slate-100">Discount Types</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Named discounts the school can grant, as a fixed amount or a percentage of fees.</p>
        </div>
      </div>

      {canEdit && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <TextField size="small" label="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <FormControl size="small">
            <InputLabel id="discount-kind-label">Kind</InputLabel>
            <Select
              labelId="discount-kind-label" label="Kind" value={kind}
              onChange={(e) => setKind(e.target.value as DiscountType['kind'])}
            >
              <MenuItem value="fixed">Fixed amount</MenuItem>
              <MenuItem value="percentage">Percentage</MenuItem>
            </Select>
          </FormControl>
          <TextField
            size="small" type="number" label={kind === 'percentage' ? 'Value (%)' : 'Value (KES)'}
            value={valueInput} onChange={(e) => setValueInput(e.target.value)}
            helperText={kind === 'percentage' ? 'Between 0 and 100.' : 'Zero or more. Zero means the amount is set per rule.'}
          />
          <FormControl size="small">
            <InputLabel id="discount-category-label">Fee category (optional)</InputLabel>
            <Select
              labelId="discount-category-label" label="Fee category (optional)" value={categoryId}
              onChange={(e) => setCategoryId(e.target.value as number | '')}
            >
              <MenuItem value="">All categories</MenuItem>
              {categories.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
            </Select>
          </FormControl>
          <div className="sm:col-span-2">
            <Button variant="contained" onClick={handleCreate} disabled={submitting}>
              {submitting ? 'Creating...' : 'Create Discount Type'}
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-600 dark:text-slate-300">Show inactive types</span>
        <Switch checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
      </div>

      <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
        {loading ? (
          <div className="py-6 flex justify-center"><CircularProgress size={24} /></div>
        ) : types.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500 py-2">No discount types yet.</p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {types.map((t) => (
              <div key={t.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{t.name}</span>
                    <Chip label={DISCOUNT_KIND_LABELS[t.kind]} size="small" variant="outlined" />
                    <Chip label={t.active ? 'Active' : 'Inactive'} size="small" color={t.active ? 'success' : 'default'} />
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {t.kind === 'percentage' ? `${Number(t.value)}%` : formatKes(t.value)}
                    {t.category !== null && ` · ${categoryNameById.get(t.category) ?? `Category #${t.category}`}`}
                  </p>
                </div>
                {canEdit && (
                  <Button
                    size="small" color={t.active ? 'error' : 'success'}
                    disabled={togglingId === t.id} onClick={() => handleToggle(t)}
                  >
                    {t.active ? 'Deactivate' : 'Reactivate'}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Preview (finance.view) and, for a finance.edit holder on an active rule, apply. The
 * preview runs on open and again on "Refresh preview"; Confirm Apply is enabled only when
 * the preview on screen was made with the same amount that apply will send. */
function RuleDialog({ rule, mode, typeName, kind, termName, targetLabel, onClose, onApplied }: {
  rule: DiscountRule; mode: 'preview' | 'apply'; typeName: string; kind: DiscountType['kind'] | undefined;
  termName: string; targetLabel: string; onClose: () => void; onApplied: () => void;
}) {
  const [amountInput, setAmountInput] = useState('');
  const [preview, setPreview] = useState<{ signature: string; data: DiscountRulePreview } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<DiscountRuleApplyResult | null>(null);

  const amountValue = amountInput.trim() ? Number(amountInput) : undefined;
  const amountValid = amountValue === undefined || (Number.isInteger(amountValue) && amountValue > 0);
  const signature = String(amountValue ?? 'default');
  const previewCurrent = preview !== null && preview.signature === signature;

  const runPreview = async () => {
    if (!amountValid) {
      toast.error('Amount must be a positive whole number.');
      return;
    }
    setPreviewing(true);
    try {
      const res = await previewDiscountRule({
        discount_type: rule.discount_type, term: rule.term, ...ruleTargetPayload(rule), amount: amountValue,
      });
      setPreview({ signature, data: res.data });
    } catch (err) {
      setPreview(null);
      toast.error(extractErrorMessage(err, 'Failed to preview the rule.'));
    } finally {
      setPreviewing(false);
    }
  };

  useEffect(() => {
    runPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleApply = async () => {
    if (!previewCurrent) return;
    setApplying(true);
    try {
      const res = await applyDiscountRule(rule.id, amountValue);
      setResult(res.data);
      toast.success(`Applied: ${res.data.created_count} created, ${res.data.skipped_count} skipped.`);
      onApplied();
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Failed to apply the rule.'));
    } finally {
      setApplying(false);
    }
  };

  const canConfirm = mode === 'apply' && !result;

  return (
    <Dialog open onClose={() => (!applying && onClose())} fullWidth maxWidth="sm">
      <DialogTitle>{mode === 'apply' ? 'Apply discount rule' : 'Preview discount rule'}</DialogTitle>
      <DialogContent className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {typeName} · {termName} · {targetLabel}
        </p>
        {kind === 'fixed' && (
          <TextField
            size="small" type="number" label="Amount (KES, optional)" value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            helperText="Optional. Overrides the type's value for this apply. Required when a fixed type has no set value."
          />
        )}
        <div>
          <Button size="small" onClick={runPreview} disabled={previewing || applying}>Refresh preview</Button>
        </div>
        {previewing ? (
          <div className="py-4 flex justify-center"><CircularProgress size={22} /></div>
        ) : previewCurrent && preview ? (
          <PreviewSummary preview={preview.data} />
        ) : (
          <p className="text-sm text-slate-400 dark:text-slate-500">Preview not loaded for this amount. Refresh the preview to continue.</p>
        )}
        {result && (
          <div className="rounded-lg bg-emerald-50 dark:bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-400">
            Created {result.created_count}, skipped {result.skipped_count}. Waivers stay pending until approved.
          </div>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={applying}>{result ? 'Close' : 'Cancel'}</Button>
        {canConfirm && (
          <Button
            variant="contained" color="success"
            onClick={handleApply} disabled={!previewCurrent || previewing || applying}
          >
            {applying ? 'Applying...' : 'Confirm Apply'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

/** Term-start discount rules (spec 4.12). Listing and preview need finance.view. Creating
 * and applying need finance.edit; the create form is not rendered without it, and Apply
 * is hidden on rows (and in the dialog) for view-only users. Save is enabled only after a
 * preview of the same form inputs; creating a rule discounts nobody, apply does that. */
function DiscountRulesCard({ permissions, typesVersion }: { permissions: string[]; typesVersion: number }) {
  const canView = permissions.includes('finance.view');
  const canEdit = permissions.includes('finance.edit');
  const [rules, setRules] = useState<DiscountRule[]>([]);
  const [types, setTypes] = useState<DiscountType[]>([]);
  const [terms, setTerms] = useState<ExamTermOption[]>([]);
  const [grades, setGrades] = useState<GradeLevelOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [dialog, setDialog] = useState<{ rule: DiscountRule; mode: 'preview' | 'apply' } | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  const [typeId, setTypeId] = useState<number | ''>('');
  const [termId, setTermId] = useState<number | ''>('');
  const [targetKind, setTargetKind] = useState<RuleTargetKind>('grade');
  const [gradeId, setGradeId] = useState<number | ''>('');
  const [streamInput, setStreamInput] = useState('');
  const [studentQuery, setStudentQuery] = useState('');
  const [studentOptions, setStudentOptions] = useState<StudentLookupOption[]>([]);
  const [students, setStudents] = useState<StudentLookupOption[]>([]);
  const [amountInput, setAmountInput] = useState('');
  const [formPreview, setFormPreview] = useState<{ signature: string; data: DiscountRulePreview } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!canView) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    listDiscountRules()
      .then((res) => { if (active) setRules(res.data); })
      .catch(() => toast.error('Failed to load discount rules.'))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [canView, refresh]);

  useEffect(() => {
    if (!canView) return;
    listDiscountTypes().then((res) => setTypes(res.data)).catch(() => undefined);
    listExamTermOptions().then((res) => setTerms(res.data)).catch(() => undefined);
    listGradeLevelOptions().then((res) => setGrades(res.data)).catch(() => undefined);
  }, [canView, refresh, typesVersion]);

  useEffect(() => {
    const q = studentQuery.trim();
    if (q.length < 2) {
      setStudentOptions([]);
      return;
    }
    const handle = setTimeout(() => {
      searchStudents(q).then((res) => setStudentOptions(res.data)).catch(() => undefined);
    }, 300);
    return () => clearTimeout(handle);
  }, [studentQuery]);

  if (!canView) return null;

  const activeTypes = types.filter((t) => t.active);
  const typeById = new Map(types.map((t) => [t.id, t]));
  const termNameById = new Map(terms.map((t) => [t.id, t.name]));
  const gradeNameById = new Map(grades.map((g) => [g.id, g.name]));

  const describeTarget = (rule: DiscountRule) => {
    if (rule.grade_level) return gradeNameById.get(rule.grade_level) ?? `Grade #${rule.grade_level}`;
    if (rule.class_stream) return `Stream #${rule.class_stream}`;
    const count = rule.student_ids.length;
    return `${count} student${count === 1 ? '' : 's'}`;
  };

  // The form's inputs as one string: a preview counts only while this string is unchanged.
  const formSignature = JSON.stringify({
    typeId, termId, targetKind, gradeId, stream: streamInput.trim(),
    students: students.map((s) => s.id).sort((a, b) => a - b), amount: amountInput.trim(),
  });
  const formPreviewCurrent = formPreview !== null && formPreview.signature === formSignature;

  const formError = (): string | null => {
    if (typeId === '') return 'Select a discount type.';
    if (termId === '') return 'Select a term.';
    if (targetKind === 'grade' && gradeId === '') return 'Select a grade level.';
    if (targetKind === 'stream' && (!Number.isInteger(Number(streamInput)) || Number(streamInput) <= 0)) {
      return 'Enter a class stream id.';
    }
    if (targetKind === 'students' && students.length === 0) return 'Select at least one student.';
    if (amountInput.trim() && !(Number.isInteger(Number(amountInput)) && Number(amountInput) > 0)) {
      return 'Amount must be a positive whole number.';
    }
    return null;
  };

  const formTarget = (): DiscountRuleTarget => {
    if (targetKind === 'grade') return { grade_level: Number(gradeId) };
    if (targetKind === 'stream') return { class_stream: Number(streamInput) };
    return { student_ids: students.map((s) => s.id) };
  };

  const resetForm = () => {
    setTypeId('');
    setTermId('');
    setTargetKind('grade');
    setGradeId('');
    setStreamInput('');
    setStudents([]);
    setStudentQuery('');
    setAmountInput('');
    setFormPreview(null);
  };

  const handleFormPreview = async () => {
    const error = formError();
    if (error) {
      toast.error(error);
      return;
    }
    const signature = formSignature;
    setPreviewing(true);
    try {
      const res = await previewDiscountRule({
        discount_type: Number(typeId), term: Number(termId), ...formTarget(),
        amount: amountInput.trim() ? Number(amountInput) : undefined,
      });
      setFormPreview({ signature, data: res.data });
    } catch (err) {
      setFormPreview(null);
      toast.error(extractErrorMessage(err, 'Failed to preview the rule.'));
    } finally {
      setPreviewing(false);
    }
  };

  const handleSave = async () => {
    if (!formPreviewCurrent) return;
    // The academic year comes from the chosen term (ExamTermOption.academic_year_id); the
    // rule create endpoint requires it and rejects a term from another year.
    const term = terms.find((t) => t.id === Number(termId));
    if (!term) return;
    setSaving(true);
    try {
      await createDiscountRule({
        discount_type: Number(typeId), academic_year: term.academic_year_id, term: term.id, ...formTarget(),
      });
      toast.success('Discount rule saved. Apply it from the list when you are ready.');
      resetForm();
      setRefresh((n) => n + 1);
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Failed to save the rule.'));
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (rule: DiscountRule) => {
    setTogglingId(rule.id);
    try {
      await updateDiscountRule(rule.id, { active: !rule.active });
      toast.success(rule.active ? 'Discount rule deactivated.' : 'Discount rule reactivated.');
      setRefresh((n) => n + 1);
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Failed to update the discount rule.'));
    } finally {
      setTogglingId(null);
    }
  };

  const dialogRule = dialog?.rule ?? null;

  return (
    <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm dark:shadow-none space-y-4">
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10">
          <CalendarClock className="w-5 h-5" strokeWidth={2.5} />
        </div>
        <div>
          <h2 className="text-base font-bold text-slate-800 dark:text-slate-100">Term-Start Discount Rules</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Preview who a discount would cover, then apply it. Nothing is discounted until you apply.</p>
        </div>
      </div>

      {canEdit && (
        <div className="rounded-xl border border-slate-100 dark:border-slate-800 p-4 space-y-3">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">New rule</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormControl size="small">
              <InputLabel id="rule-type-label">Discount type</InputLabel>
              <Select
                labelId="rule-type-label" label="Discount type" value={typeId}
                onChange={(e) => setTypeId(e.target.value as number | '')}
              >
                {activeTypes.map((t) => <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl size="small">
              <InputLabel id="rule-term-label">Term</InputLabel>
              <Select
                labelId="rule-term-label" label="Term" value={termId}
                onChange={(e) => setTermId(e.target.value as number | '')}
              >
                {terms.map((t) => <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>)}
              </Select>
            </FormControl>
            <div className="sm:col-span-2">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Applies to</p>
              <RadioGroup row value={targetKind} onChange={(e) => setTargetKind(e.target.value as RuleTargetKind)}>
                <FormControlLabel value="grade" control={<Radio size="small" />} label="Grade level" />
                <FormControlLabel value="stream" control={<Radio size="small" />} label="Class stream" />
                <FormControlLabel value="students" control={<Radio size="small" />} label="Specific students" />
              </RadioGroup>
            </div>
            <div className="sm:col-span-2">
              {targetKind === 'grade' && (
                <FormControl size="small" fullWidth>
                  <InputLabel id="rule-grade-label">Grade level</InputLabel>
                  <Select
                    labelId="rule-grade-label" label="Grade level" value={gradeId}
                    onChange={(e) => setGradeId(e.target.value as number | '')}
                  >
                    {grades.map((g) => <MenuItem key={g.id} value={g.id}>{g.name}</MenuItem>)}
                  </Select>
                </FormControl>
              )}
              {targetKind === 'stream' && (
                <TextField
                  size="small" fullWidth type="number" label="Class stream id" value={streamInput}
                  onChange={(e) => setStreamInput(e.target.value)}
                  helperText="Enter the stream's id. Finance has no stream lookup yet."
                />
              )}
              {targetKind === 'students' && (
                <Autocomplete
                  multiple size="small" options={studentOptions} value={students}
                  getOptionLabel={(o) => `${o.name} (${o.roll})`}
                  isOptionEqualToValue={(a, b) => a.id === b.id}
                  filterSelectedOptions
                  onChange={(_, value) => setStudents(value)}
                  inputValue={studentQuery}
                  onInputChange={(_, value) => setStudentQuery(value)}
                  renderInput={(params) => <TextField {...params} label="Students" placeholder="Search by name or roll" />}
                />
              )}
            </div>
            <TextField
              size="small" type="number" label="Amount (KES, optional)" value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              helperText="Optional. Overrides the type's value. Required when a fixed type has no set value."
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outlined" onClick={handleFormPreview} disabled={previewing || saving}>
              {previewing ? 'Previewing...' : 'Preview'}
            </Button>
            <Button variant="contained" onClick={handleSave} disabled={!formPreviewCurrent || saving || previewing}>
              {saving ? 'Saving...' : 'Save Rule'}
            </Button>
          </div>
          {formPreview && !formPreviewCurrent && (
            <p className="text-xs text-amber-600 dark:text-amber-400">The inputs changed since the last preview. Preview again before saving.</p>
          )}
          {formPreviewCurrent && formPreview && <PreviewSummary preview={formPreview.data} />}
        </div>
      )}

      <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
        {loading ? (
          <div className="py-6 flex justify-center"><CircularProgress size={24} /></div>
        ) : rules.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500 py-2">No discount rules yet.</p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {rules.map((rule) => (
              <div key={rule.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                      {typeById.get(rule.discount_type)?.name ?? `Type #${rule.discount_type}`}
                    </span>
                    <Chip label={termNameById.get(rule.term) ?? `Term #${rule.term}`} size="small" variant="outlined" />
                    <Chip label={rule.active ? 'Active' : 'Inactive'} size="small" color={rule.active ? 'success' : 'default'} />
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {describeTarget(rule)} · created {new Date(rule.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0 flex-wrap">
                  <Button size="small" onClick={() => setDialog({ rule, mode: 'preview' })}>Preview</Button>
                  {canEdit && rule.active && (
                    <Button size="small" variant="contained" color="success" onClick={() => setDialog({ rule, mode: 'apply' })}>
                      Apply
                    </Button>
                  )}
                  {canEdit && (
                    <Button size="small" disabled={togglingId === rule.id} onClick={() => handleToggle(rule)}>
                      {rule.active ? 'Deactivate' : 'Reactivate'}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {dialogRule && dialog && (
        <RuleDialog
          rule={dialogRule} mode={dialog.mode}
          typeName={typeById.get(dialogRule.discount_type)?.name ?? `Type #${dialogRule.discount_type}`}
          kind={typeById.get(dialogRule.discount_type)?.kind}
          termName={termNameById.get(dialogRule.term) ?? `Term #${dialogRule.term}`}
          targetLabel={describeTarget(dialogRule)}
          onClose={() => setDialog(null)}
          onApplied={() => setRefresh((n) => n + 1)}
        />
      )}
    </div>
  );
}

interface StudentFeeRow {
  id: number;
  name: string;
  class_name: string;
  fee: number;
}

interface TeacherSalaryRow {
  id: number;
  name: string;
  subjects: string;
  salary: number;
}

interface FinanceData {
  total_revenue: number;
  total_salary_expense: number;
  net: number;
  students: StudentFeeRow[];
  teachers: TeacherSalaryRow[];
}

type Tab = 'fees' | 'salaries' | 'breakdown';

// Shared bar chart for the Income & Expense breakdown tab -- category on the Y axis,
// amount on the X axis, one themed color per side (emerald for income, red for expense).
function BreakdownChart({ categories, amounts, color }: { categories: typeof INCOME_CATEGORIES; amounts: Record<string, number>; color: string }) {
  const theme = useTheme();
  const chartData = categories.map((c) => ({ name: c.label, amount: amounts[c.key] || 0 }));
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={chartData} layout="vertical" margin={{ left: 24 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} horizontal={false} />
        <XAxis type="number" axisLine={false} tick={{ fill: theme.palette.text.secondary, fontSize: 11 }} tickLine={false} />
        <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} width={140} tick={{ fill: theme.palette.text.secondary, fontSize: 11 }} />
        <Tooltip
          cursor={{ fill: theme.palette.action.hover }}
          contentStyle={{ background: theme.palette.background.paper, border: `1px solid ${theme.palette.divider}`, color: theme.palette.text.primary }}
          formatter={(value) => [`$${Number(value ?? 0).toLocaleString()}`, 'Amount']}
        />
        <Bar dataKey="amount" fill={color} radius={[0, 4, 4, 0]} barSize={16} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export default function FinanceHub() {
  const navigate = useNavigate();
  const { permissions, userId } = useOutletContext<DashboardContextType>();
  // Role-appropriate base path — this component is mounted under both
  // /admin-dashboard and /staff-dashboard (Finance Officers use the latter).
  const basePath = '/' + (window.location.pathname.split('/')[1] || 'admin-dashboard');
  const [data, setData] = useState<FinanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('fees');
  const [searchTerm, setSearchTerm] = useState('');
  const [balancesByStudent, setBalancesByStudent] = useState<Record<number, number>>({});
  const [balancesLoaded, setBalancesLoaded] = useState(false);
  const [balancesUnavailable, setBalancesUnavailable] = useState(false);
  const [kpiTiles, setKpiTiles] = useState<FeeKpiTiles | null>(null);
  const [adjustmentRefresh, setAdjustmentRefresh] = useState(0);
  const [typesVersion, setTypesVersion] = useState(0);

  useEffect(() => {
    api.get('/api/finance-overview/')
      .then((res) => {
        if (res.data?.status === 'success') setData(res.data.data);
      })
      .catch((err) => console.error("Failed to fetch finance overview", err))
      .finally(() => setLoading(false));

    // Real ledger balances (finance.view). Aging lists only students owing a positive
    // balance (credits/overpayments are not listed here), so a missing row means nothing owed. A failure (e.g. 403) is flagged so the
    // column shows "—" instead of a misleading 0 owed.
    getStudentBalanceAging()
      .then((res) => {
        const map: Record<number, number> = {};
        for (const row of res.data as { student_id: number; balance: number }[]) {
          map[row.student_id] = row.balance;
        }
        setBalancesByStudent(map);
        setBalancesLoaded(true);
      })
      .catch((err) => {
        console.error("Failed to fetch student fee balances", err);
        setBalancesUnavailable(true);
      });

    // School-wide credit owed to students (Task 26, spec 4.8) -- a separate figure
    // from the per-student "Balance Owed" column above (Task 23) and from a
    // student's own statement page (Task 24): this is the aggregate total_credit
    // from fee_kpi_tiles(). A failure here just leaves the tile unrendered.
    getFeeKpiTiles()
      .then((res) => setKpiTiles(res.data))
      .catch((err) => console.error("Failed to fetch fee KPI tiles", err));
  }, []);

  const filteredStudents = useMemo(() => {
    if (!data) return [];
    const q = searchTerm.trim().toLowerCase();
    if (!q) return data.students;
    return data.students.filter((s) => s.name.toLowerCase().includes(q) || s.class_name.toLowerCase().includes(q));
  }, [data, searchTerm]);

  const filteredTeachers = useMemo(() => {
    if (!data) return [];
    const q = searchTerm.trim().toLowerCase();
    if (!q) return data.teachers;
    return data.teachers.filter((t) => t.name.toLowerCase().includes(q) || t.subjects.toLowerCase().includes(q));
  }, [data, searchTerm]);

  const mockIncomeTotal = useMemo(
    () => INCOME_CATEGORIES.reduce((sum, c) => sum + (MOCK_FINANCE_BREAKDOWN.income[c.key] || 0), 0), []
  );
  const mockExpenseTotal = useMemo(
    () => EXPENSE_CATEGORIES.reduce((sum, c) => sum + (MOCK_FINANCE_BREAKDOWN.expense[c.key] || 0), 0), []
  );

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto space-y-6 animate-pulse">
        <div className="h-12 w-80 bg-slate-200 dark:bg-slate-800 rounded-2xl"></div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => <div key={i} className="h-28 bg-slate-200 dark:bg-slate-800 rounded-2xl"></div>)}
        </div>
        <div className="h-80 bg-slate-200 dark:bg-slate-800 rounded-2xl"></div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-8 text-center text-slate-400 dark:text-slate-500 text-sm">
        Couldn't load finance data. Please refresh the page.
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-2xl text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10">
          <CircleDollarSign className="w-7 h-7" strokeWidth={2.5} />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800 dark:text-slate-100">Fees & Salary</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">A live snapshot of student fees and staff salaries on record.</p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm dark:shadow-none flex items-center gap-5">
          <div className="p-4 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-2xl"><Banknote className="w-7 h-7" strokeWidth={2.5} /></div>
          <div className="flex flex-col">
            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">Total Fee Revenue</span>
            <span className="text-3xl font-extrabold text-slate-800 dark:text-slate-100 leading-none">${data.total_revenue.toLocaleString()}</span>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm dark:shadow-none flex items-center gap-5">
          <div className="p-4 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 rounded-2xl"><Wallet className="w-7 h-7" strokeWidth={2.5} /></div>
          <div className="flex flex-col">
            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">Total Salary Expense</span>
            <span className="text-3xl font-extrabold text-slate-800 dark:text-slate-100 leading-none">${data.total_salary_expense.toLocaleString()}</span>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm dark:shadow-none flex items-center gap-5">
          <div className={`p-4 rounded-2xl ${data.net >= 0 ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400' : 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400'}`}><TrendingUp className="w-7 h-7" strokeWidth={2.5} /></div>
          <div className="flex flex-col">
            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">Net</span>
            <span className="text-3xl font-extrabold text-slate-800 dark:text-slate-100 leading-none">${data.net.toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* Tabs + Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl w-fit">
          <button
            onClick={() => setActiveTab('fees')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all flex items-center gap-2 ${activeTab === 'fees' ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
          >
            <GraduationCap className="w-4 h-4" /> Student Fees
          </button>
          <button
            onClick={() => setActiveTab('salaries')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all flex items-center gap-2 ${activeTab === 'salaries' ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
          >
            <Users className="w-4 h-4" /> Staff Salaries
          </button>
          <button
            onClick={() => setActiveTab('breakdown')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all flex items-center gap-2 ${activeTab === 'breakdown' ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
          >
            <PieChart className="w-4 h-4" /> Income & Expense
          </button>
        </div>

        {activeTab !== 'breakdown' && (
          <div className="flex items-center gap-2 rounded-full ring-1 ring-slate-200 dark:ring-slate-700 px-3 py-2 bg-white dark:bg-slate-800 focus-within:ring-2 focus-within:ring-blue-500 dark:focus-within:ring-blue-400 transition-all w-full sm:w-72">
            <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" />
            <input
              type="text"
              placeholder={activeTab === 'fees' ? "Search by student or class..." : "Search by teacher or subject..."}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-transparent outline-none text-sm text-slate-700 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500"
            />
          </div>
        )}
      </div>

      {activeTab === 'fees' && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <button
            onClick={() => navigate(`${basePath}/finance/fee-structures`)}
            className="flex items-center gap-2 text-sm font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors w-max"
          >
            <Layers className="w-4 h-4" /> Manage Fee Structures
          </button>
          <button
            onClick={() => navigate(`${basePath}/finance/invoices`)}
            className="flex items-center gap-2 text-sm font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors w-max"
          >
            <FileText className="w-4 h-4" /> Invoices
          </button>
          <button
            onClick={() => navigate(`${basePath}/finance/payments`)}
            className="flex items-center gap-2 text-sm font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors w-max"
          >
            <Receipt className="w-4 h-4" /> Payments
          </button>
          {kpiTiles && (
            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-600 dark:text-emerald-400 ml-auto">
              <PiggyBank className="w-4 h-4" />
              Credit Owed to Students: KES {kpiTiles.total_credit.toLocaleString()}
            </div>
          )}
        </div>
      )}

      {activeTab === 'fees' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <FeeClearancePolicyCard permissions={permissions} />
            {permissions.includes('finance.override_clearance') && <ClearanceOverridesCard />}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <RequestAdjustmentCard permissions={permissions} typesVersion={typesVersion} onSubmitted={() => setAdjustmentRefresh((n) => n + 1)} />
            <PendingAdjustmentsCard
              permissions={permissions} userId={userId} refreshKey={adjustmentRefresh}
              onDecided={() => setAdjustmentRefresh((n) => n + 1)}
            />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <DiscountTypesCard permissions={permissions} onTypesChanged={() => setTypesVersion((n) => n + 1)} />
            <DiscountRulesCard permissions={permissions} typesVersion={typesVersion} />
          </div>
        </div>
      )}

      {/* Content */}
      {activeTab === 'breakdown' ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              A categorized view of where money comes in and goes out. Set up with realistic school line items now, so plugging in a real finance ledger later is a data swap, not a redesign.
            </p>
            <span className="shrink-0 ml-4 text-[10px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 px-2 py-1 rounded-full">Sample data</span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm dark:shadow-none p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-bold text-sm">
                  <TrendingUp className="w-4 h-4" /> Income Breakdown
                </div>
                <span className="text-sm font-extrabold text-slate-700 dark:text-slate-200">${mockIncomeTotal.toLocaleString()}</span>
              </div>
              <BreakdownChart categories={INCOME_CATEGORIES} amounts={MOCK_FINANCE_BREAKDOWN.income} color="#10b981" />
            </div>
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm dark:shadow-none p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-red-600 dark:text-red-400 font-bold text-sm">
                  <TrendingDown className="w-4 h-4" /> Expense Breakdown
                </div>
                <span className="text-sm font-extrabold text-slate-700 dark:text-slate-200">${mockExpenseTotal.toLocaleString()}</span>
              </div>
              <BreakdownChart categories={EXPENSE_CATEGORIES} amounts={MOCK_FINANCE_BREAKDOWN.expense} color="#ef4444" />
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm dark:shadow-none overflow-hidden">
          <div className="overflow-x-auto">
            {activeTab === 'fees' ? (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800 text-slate-400 dark:text-slate-500 uppercase text-[11px] tracking-wider">
                    <th className="py-3 px-5 font-bold">Student</th>
                    <th className="py-3 px-5 font-bold">Class</th>
                    <th className="py-3 px-5 font-bold text-right">Balance Owed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                  {filteredStudents.length === 0 ? (
                    <tr><td colSpan={3} className="py-10 text-center text-slate-400 dark:text-slate-500 text-sm">No students match your search.</td></tr>
                  ) : filteredStudents.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/60 transition-colors">
                      <td className="py-3 px-5">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 flex items-center justify-center font-bold text-xs shrink-0">
                            {s.name.charAt(0).toUpperCase()}
                          </div>
                          <span className="font-semibold text-slate-800 dark:text-slate-200">{s.name}</span>
                        </div>
                      </td>
                      <td className="py-3 px-5 text-slate-500 dark:text-slate-400">{s.class_name}</td>
                      <td className="py-3 px-5 text-right font-bold text-slate-700 dark:text-slate-200">{balancesUnavailable || !balancesLoaded ? '—' : `KES ${(balancesByStudent[s.id] ?? 0).toLocaleString()}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800 text-slate-400 dark:text-slate-500 uppercase text-[11px] tracking-wider">
                    <th className="py-3 px-5 font-bold">Teacher</th>
                    <th className="py-3 px-5 font-bold">Subjects</th>
                    <th className="py-3 px-5 font-bold text-right">Salary</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                  {filteredTeachers.length === 0 ? (
                    <tr><td colSpan={3} className="py-10 text-center text-slate-400 dark:text-slate-500 text-sm">No teachers match your search.</td></tr>
                  ) : filteredTeachers.map((t) => (
                    <tr key={t.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/60 transition-colors">
                      <td className="py-3 px-5">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-purple-100 dark:bg-purple-500/10 text-purple-700 dark:text-purple-400 flex items-center justify-center font-bold text-xs shrink-0">
                            {t.name.charAt(0).toUpperCase()}
                          </div>
                          <span className="font-semibold text-slate-800 dark:text-slate-200">{t.name}</span>
                        </div>
                      </td>
                      <td className="py-3 px-5 text-slate-500 dark:text-slate-400">{t.subjects}</td>
                      <td className="py-3 px-5 text-right font-bold text-slate-700 dark:text-slate-200">${t.salary.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
