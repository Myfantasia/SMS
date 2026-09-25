import { useEffect, useRef, useState } from 'react';
import {
  Card, CardContent, Table, TableHead, TableRow, TableCell, TableBody, Chip,
  Button, TextField, Select, MenuItem, Dialog, DialogTitle, DialogContent, DialogActions, CircularProgress,
} from '@mui/material';
import toast from 'react-hot-toast';
import { Wallet, ArrowLeft, Search, X, Receipt as ReceiptIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import SearchableSelect, { type SearchableSelectOption } from '../common/SearchableSelect';
import {
  listPayments, recordPayment, voidPayment, receiptPdfUrl,
  listInvoices, searchStudents,
  type Payment, type Invoice, type StudentLookupOption,
} from '../../libs/financeApi';

// Both the service-layer 400/403 shape (`{error: "..."}`, from `_service_error_response`
// in apps/finance/views.py) and a DRF serializer-validation 400 (`{field: ["..."]}`, from
// PaymentCreateSerializer/VoidSerializer's own is_valid(raise_exception=True)) are real
// possibilities here — this surfaces whichever one the server actually sent instead of a
// made-up message.
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

const METHODS: { value: Payment['method']; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'mpesa', label: 'M-Pesa' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'other', label: 'Other' },
];

export default function PaymentsPage() {
  const navigate = useNavigate();

  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [paymentsError, setPaymentsError] = useState(false);

  // Student search box is a bespoke debounced combobox, not SearchableSelect: SearchableSelect
  // only ever client-filters an `options` list it's already holding — it has no hook to surface
  // its own keystrokes to a caller, so there's no way to drive a server-side lookup through it.
  // Debounce pattern (250ms, 2-char minimum, cleared on unmount/change) matches
  // AddUserModal.tsx's parent-student search — see its `studentQuery`/`debounceRef` effect.
  const [studentQuery, setStudentQuery] = useState('');
  const [studentResults, setStudentResults] = useState<StudentLookupOption[] | null>(null);
  const [studentSearching, setStudentSearching] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<StudentLookupOption | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Cheap, session-only name resolution for the payments table's "Student" column (point 4's
  // tradeoff): Payment only carries a numeric student id, and there's no batch-by-ids lookup
  // endpoint — only the debounced text search above. Fetching every distinct student on the
  // table individually would be an N+1 call on every page load, so instead this just remembers
  // names already seen this session (via search results or a just-recorded payment) and falls
  // back to "Student #<id>" for anyone not yet looked up. Good enough for Phase 1 scale; a real
  // fix would need a dedicated by-ids lookup endpoint.
  const [studentNameCache, setStudentNameCache] = useState<Record<number, string>>({});

  const [studentInvoices, setStudentInvoices] = useState<Invoice[]>([]);
  const [studentInvoicesLoading, setStudentInvoicesLoading] = useState(false);
  const [studentInvoicesError, setStudentInvoicesError] = useState(false);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState('');

  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<Payment['method']>('cash');
  const [reference, setReference] = useState('');
  const [recording, setRecording] = useState(false);

  const [voidTarget, setVoidTarget] = useState<Payment | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voiding, setVoiding] = useState(false);

  const loadPayments = () => {
    listPayments()
      .then((res) => {
        setPayments(res.data);
        setPaymentsError(false);
      })
      .catch(() => {
        setPaymentsError(true);
        toast.error('Failed to load payments.');
      });
  };

  useEffect(() => {
    listPayments()
      .then((res) => {
        setPayments(res.data);
        setPaymentsError(false);
      })
      .catch(() => {
        setPaymentsError(true);
        toast.error('Failed to load payments.');
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const trimmed = studentQuery.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (trimmed.length < 2) {
      setStudentResults(null);
      setStudentSearching(false);
      return;
    }
    setStudentSearching(true);
    debounceRef.current = setTimeout(() => {
      searchStudents(trimmed)
        .then((res) => {
          setStudentResults(res.data);
          setStudentNameCache((prev) => {
            const next = { ...prev };
            res.data.forEach((s) => { next[s.id] = s.name; });
            return next;
          });
        })
        .catch(() => setStudentResults([]))
        .finally(() => setStudentSearching(false));
    }, 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [studentQuery]);

  useEffect(() => {
    setSelectedInvoiceId('');
    if (!selectedStudent) {
      setStudentInvoices([]);
      setStudentInvoicesError(false);
      return;
    }
    setStudentInvoicesLoading(true);
    listInvoices({ student_id: selectedStudent.id })
      .then((res) => {
        setStudentInvoices(res.data.filter((inv) => inv.status !== 'voided'));
        setStudentInvoicesError(false);
      })
      .catch(() => {
        setStudentInvoices([]);
        setStudentInvoicesError(true);
      })
      .finally(() => setStudentInvoicesLoading(false));
  }, [selectedStudent]);

  const pickStudent = (s: StudentLookupOption) => {
    setSelectedStudent(s);
    setStudentNameCache((prev) => ({ ...prev, [s.id]: s.name }));
    setStudentQuery('');
    setStudentResults(null);
  };

  const clearStudent = () => {
    setSelectedStudent(null);
    setStudentQuery('');
    setStudentResults(null);
  };

  const invoiceOptions: SearchableSelectOption[] = [
    { value: '', label: 'Apply to overall balance (no invoice)' },
    ...studentInvoices.map((inv) => ({
      value: String(inv.id),
      label: `${inv.invoice_number} — ${inv.status} — KES ${inv.total.toLocaleString()}`,
    })),
  ];

  const handleRecord = async () => {
    if (!selectedStudent) {
      toast.error('Select a student.');
      return;
    }
    const numericAmount = Number(amount);
    if (!amount.trim() || !Number.isInteger(numericAmount) || numericAmount <= 0) {
      toast.error('Amount must be a positive whole number of KES.');
      return;
    }
    setRecording(true);
    try {
      await recordPayment({
        student: selectedStudent.id,
        invoice: selectedInvoiceId ? Number(selectedInvoiceId) : null,
        amount: numericAmount,
        method,
        reference: reference.trim(),
        date: new Date().toISOString().slice(0, 10),
      });
      toast.success('Payment recorded and receipt generated.');
      setStudentNameCache((prev) => ({ ...prev, [selectedStudent.id]: selectedStudent.name }));
      clearStudent();
      setAmount('');
      setReference('');
      setMethod('cash');
      loadPayments();
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Failed to record payment.'));
    } finally {
      setRecording(false);
    }
  };

  const handleVoid = async () => {
    if (!voidTarget) return;
    if (!voidReason.trim()) {
      toast.error('A void reason is required.');
      return;
    }
    setVoiding(true);
    try {
      await voidPayment(voidTarget.id, voidReason.trim());
      toast.success('Payment voided.');
      setVoidTarget(null);
      setVoidReason('');
      loadPayments();
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Failed to void payment.'));
    } finally {
      setVoiding(false);
    }
  };

  if (loading) {
    return (
      <div className="p-16 flex flex-col items-center justify-center gap-3 text-slate-500 dark:text-slate-400">
        <CircularProgress size={32} />
        <span className="text-sm">Loading payments...</span>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-4">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-sm font-medium text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors w-max"
      >
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      <div className="flex items-center gap-4">
        <div className="p-3 rounded-2xl text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10">
          <Wallet className="w-6 h-6" strokeWidth={2.5} />
        </div>
        <div>
          <h1 className="text-xl font-extrabold text-slate-800 dark:text-slate-100">Payments</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Record a manual payment against a student's balance or a specific invoice, and issue its receipt.
          </p>
        </div>
      </div>

      <Card className="dark:bg-slate-900" sx={{ bgcolor: 'background.paper' }}>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-3 items-start">
            <div className="w-64 shrink-0">
              <label className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-1">Student</label>
              {selectedStudent ? (
                <div className="flex items-center gap-2 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-sm">
                  <span className="flex-1 truncate font-semibold text-slate-800 dark:text-slate-100">
                    {selectedStudent.name} <span className="font-normal text-slate-400 dark:text-slate-500">{selectedStudent.roll}</span>
                  </span>
                  <button type="button" onClick={clearStudent} className="text-slate-400 hover:text-red-500 transition-colors shrink-0">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <div className="flex items-center gap-2 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-800">
                    <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" />
                    <input
                      type="text"
                      value={studentQuery}
                      onChange={(e) => setStudentQuery(e.target.value)}
                      placeholder="Search name or roll…"
                      className="w-full bg-transparent outline-none text-sm text-slate-700 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                    />
                  </div>
                  {studentQuery.trim().length >= 2 && (
                    <div className="absolute left-0 right-0 mt-1 z-50 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg dark:shadow-none overflow-hidden max-h-60 overflow-y-auto">
                      {studentSearching ? (
                        <div className="px-3 py-4 text-xs text-slate-400 dark:text-slate-500 text-center">Searching...</div>
                      ) : !studentResults || studentResults.length === 0 ? (
                        <div className="px-3 py-4 text-xs text-slate-400 dark:text-slate-500 text-center">No students match.</div>
                      ) : (
                        studentResults.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => pickStudent(s)}
                            className="w-full text-left px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                          >
                            <span className="font-medium">{s.name}</span>
                            <span className="ml-1.5 text-xs text-slate-400 dark:text-slate-500">{s.roll}</span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="w-72 shrink-0">
              <label className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-1">Invoice (optional)</label>
              {studentInvoicesError ? (
                <p className="text-xs text-red-500 dark:text-red-400 py-2">Couldn't load this student's invoices.</p>
              ) : (
                <SearchableSelect
                  options={invoiceOptions}
                  value={selectedInvoiceId}
                  onChange={setSelectedInvoiceId}
                  placeholder={studentInvoicesLoading ? 'Loading invoices...' : 'Apply to overall balance'}
                  searchPlaceholder="Search invoices…"
                  emptyMessage="No open invoices for this student."
                  disabled={!selectedStudent || studentInvoicesLoading}
                />
              )}
            </div>

            <TextField
              label="Amount (KES)" type="number" value={amount}
              onChange={(e) => setAmount(e.target.value)} size="small"
              slotProps={{ htmlInput: { min: 1, step: 1 } }}
            />
            <Select value={method} onChange={(e) => setMethod(e.target.value as Payment['method'])} size="small">
              {METHODS.map((m) => <MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>)}
            </Select>
            <TextField
              label="Reference (optional)" value={reference}
              onChange={(e) => setReference(e.target.value)} size="small"
            />
          </div>
          <div>
            <Button variant="contained" onClick={handleRecord} disabled={recording}>
              {recording ? 'Recording...' : 'Record Payment'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="dark:bg-slate-900" sx={{ bgcolor: 'background.paper' }}>
        <CardContent>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Student</TableCell>
                <TableCell>Amount</TableCell>
                <TableCell>Method</TableCell>
                <TableCell>Date</TableCell>
                <TableCell>Receipt</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {paymentsError ? (
                <TableRow>
                  <TableCell colSpan={7}>
                    <p className="py-8 text-center text-sm text-red-500 dark:text-red-400">
                      Couldn't load payments — try refreshing the page.
                    </p>
                  </TableCell>
                </TableRow>
              ) : payments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7}>
                    <p className="py-8 text-center text-sm text-slate-400 dark:text-slate-500">
                      No payments recorded yet — use the form above to record one.
                    </p>
                  </TableCell>
                </TableRow>
              ) : payments.map((payment) => (
                <TableRow key={payment.id}>
                  <TableCell>{studentNameCache[payment.student] ?? `Student #${payment.student}`}</TableCell>
                  <TableCell>KES {payment.amount.toLocaleString()}</TableCell>
                  <TableCell>{METHODS.find((m) => m.value === payment.method)?.label ?? payment.method}</TableCell>
                  <TableCell>{payment.date}</TableCell>
                  <TableCell>
                    {payment.receipt_id != null ? (
                      <a
                        href={receiptPdfUrl(payment.receipt_id)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-sm font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
                      >
                        <ReceiptIcon className="w-3.5 h-3.5" /> {payment.receipt_number ?? 'Receipt'}
                      </a>
                    ) : (
                      <span className="text-xs text-slate-400 dark:text-slate-500">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {payment.is_voided
                      ? <Chip label="Voided" color="error" size="small" />
                      : <Chip label={payment.status} color={payment.status === 'confirmed' ? 'success' : 'default'} size="small" />}
                  </TableCell>
                  <TableCell>
                    {!payment.is_voided && (
                      <Button size="small" color="error" onClick={() => setVoidTarget(payment)}>Void</Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!voidTarget} onClose={() => (!voiding && setVoidTarget(null))}>
        <DialogTitle>Void payment</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth multiline minRows={2} label="Reason (required)" value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)} autoFocus
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setVoidTarget(null)} disabled={voiding}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleVoid} disabled={voiding}>
            {voiding ? 'Voiding...' : 'Confirm Void'}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
