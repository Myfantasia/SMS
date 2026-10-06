import { useEffect, useState } from 'react';
import {
  Card, CardContent, Table, TableHead, TableRow, TableCell, TableBody, Chip,
  Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField, CircularProgress,
} from '@mui/material';
import toast from 'react-hot-toast';
import { FileText, Receipt, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { listInvoices, voidInvoice, invoicePdfUrl, type Invoice } from '../../libs/financeApi';

const STATUS_COLOR: Record<Invoice['status'], 'default' | 'success' | 'warning' | 'error'> = {
  unpaid: 'default', partially_paid: 'warning', paid: 'success', overdue: 'error', voided: 'default',
};

// Both the service-layer 400/403 shape (`{error: "..."}`, from `_service_error_response`
// in apps/finance/views.py) and a DRF serializer-validation 400 (`{field: ["..."]}`, from
// VoidSerializer's own is_valid(raise_exception=True)) are real possibilities here — this
// surfaces whichever one the server actually sent instead of a made-up message.
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

export default function InvoicesPage() {
  const navigate = useNavigate();

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [invoicesError, setInvoicesError] = useState(false);
  const [voidTarget, setVoidTarget] = useState<Invoice | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voiding, setVoiding] = useState(false);

  const load = () => {
    listInvoices()
      .then((res) => {
        setInvoices(res.data);
        setInvoicesError(false);
      })
      .catch(() => {
        setInvoicesError(true);
        toast.error('Failed to load invoices.');
      });
  };

  useEffect(() => {
    listInvoices()
      .then((res) => {
        setInvoices(res.data);
        setInvoicesError(false);
      })
      .catch(() => {
        setInvoicesError(true);
        toast.error('Failed to load invoices.');
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleVoid = async () => {
    if (!voidTarget) return;
    if (!voidReason.trim()) {
      toast.error('A void reason is required.');
      return;
    }
    setVoiding(true);
    try {
      await voidInvoice(voidTarget.id, voidReason.trim());
      toast.success(`Invoice ${voidTarget.invoice_number} voided.`);
      setVoidTarget(null);
      setVoidReason('');
      load();
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Failed to void invoice.'));
    } finally {
      setVoiding(false);
    }
  };

  if (loading) {
    return (
      <div className="p-16 flex flex-col items-center justify-center gap-3 text-slate-500 dark:text-slate-400">
        <CircularProgress size={32} />
        <span className="text-sm">Loading invoices...</span>
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
          <FileText className="w-6 h-6" strokeWidth={2.5} />
        </div>
        <div>
          <h1 className="text-xl font-extrabold text-slate-800 dark:text-slate-100">Invoices</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Every invoice on record. Voiding is the only correction path — there is no edit; generate a fresh invoice after voiding.
          </p>
        </div>
      </div>

      <Card className="dark:bg-slate-900" sx={{ bgcolor: 'background.paper' }}>
        <CardContent>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Invoice #</TableCell>
                <TableCell>Total</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Issued</TableCell>
                <TableCell>Credit Applied</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {invoicesError ? (
                <TableRow>
                  <TableCell colSpan={6}>
                    <p className="py-8 text-center text-sm text-red-500 dark:text-red-400">
                      Couldn't load invoices — try refreshing the page.
                    </p>
                  </TableCell>
                </TableRow>
              ) : invoices.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6}>
                    <p className="py-8 text-center text-sm text-slate-400 dark:text-slate-500">
                      No invoices yet — activate a fee structure to generate some.
                    </p>
                  </TableCell>
                </TableRow>
              ) : invoices.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell>{invoice.invoice_number}</TableCell>
                  <TableCell>KES {invoice.total.toLocaleString()}</TableCell>
                  <TableCell><Chip label={invoice.status} color={STATUS_COLOR[invoice.status]} size="small" /></TableCell>
                  <TableCell>{new Date(invoice.issued_at).toLocaleDateString()}</TableCell>
                  <TableCell>
                    {invoice.credit_applied > 0 ? (
                      `KES ${invoice.credit_applied.toLocaleString()}`
                    ) : (
                      <span className="text-xs text-slate-400 dark:text-slate-500">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <a
                        href={invoicePdfUrl(invoice.id)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-sm font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
                      >
                        <Receipt className="w-3.5 h-3.5" /> PDF
                      </a>
                      {invoice.status !== 'voided' && (
                        <Button size="small" color="error" onClick={() => setVoidTarget(invoice)}>Void</Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!voidTarget} onClose={() => (!voiding && setVoidTarget(null))}>
        <DialogTitle>Void invoice {voidTarget?.invoice_number}</DialogTitle>
        <DialogContent>
          {/* No "edit" option exists here by design — the only correction path is void, then generate a fresh invoice. */}
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
