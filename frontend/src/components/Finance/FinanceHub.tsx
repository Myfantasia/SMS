import { useEffect, useMemo, useState } from 'react';
import { CircleDollarSign, Banknote, Wallet, TrendingUp, TrendingDown, Search, Users, GraduationCap, PieChart, Layers, FileText, Receipt, PiggyBank, ShieldCheck, ShieldOff } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useTheme } from '@mui/material/styles';
import {
  Switch, TextField, Button, Dialog, DialogTitle, DialogContent, DialogActions,
  Select, MenuItem, FormControl, InputLabel, Autocomplete, Chip, CircularProgress,
} from '@mui/material';
import toast from 'react-hot-toast';
import { useNavigate, useOutletContext } from 'react-router-dom';
import api from '../../libs/axiosInstance';
import {
  getStudentBalanceAging, getFeeKpiTiles, type FeeKpiTiles,
  getFeeClearancePolicy, updateFeeClearancePolicy, type FeeClearancePolicy,
  listClearanceOverrides, grantClearanceOverride, revokeClearanceOverride, type ClearanceOverride,
  searchStudents, type StudentLookupOption, listExamTermOptions, type ExamTermOption,
} from '../../libs/financeApi';
import type { DashboardContextType } from '../../layouts/DashboardLayouts';
import { INCOME_CATEGORIES, EXPENSE_CATEGORIES, MOCK_FINANCE_BREAKDOWN } from './financeCategories';

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
  const { permissions } = useOutletContext<DashboardContextType>();
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <FeeClearancePolicyCard permissions={permissions} />
          {permissions.includes('finance.override_clearance') && <ClearanceOverridesCard />}
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
