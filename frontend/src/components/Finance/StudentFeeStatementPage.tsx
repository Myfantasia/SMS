import { useEffect, useState } from 'react';
import { Card, CardContent, Table, TableHead, TableRow, TableCell, TableBody, Chip, CircularProgress } from '@mui/material';
import { Wallet } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../libs/axiosInstance';
import { getMyFeeLedger, getStudentLedger } from '../../libs/financeApi';
import type { LedgerEntry } from '../../libs/financeApi';

const ENTRY_TYPE_COLOR: Record<LedgerEntry['entry_type'], 'default' | 'success' | 'warning'> = {
  charge: 'warning', payment: 'success', adjustment: 'default',
};

interface Props {
  /** Pass a specific child's id for a parent viewing one of their children;
   * omit it for a student viewing their own statement (resolved server-side
   * by `MyFeeLedgerAPIView`, mirroring studentAssignmentService.ts's
   * student-board convention). */
  studentId?: number;
}

/** Read-only fee ledger/statement — mounted directly on the student dashboard
 * (own statement) and wrapped by `ParentFeeStatementPage` below on the parent
 * dashboard (one statement per selected child). */
export default function StudentFeeStatementPage({ studentId }: Props) {
  const [balance, setBalance] = useState<number | null>(null);
  const [creditBalance, setCreditBalance] = useState(0);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const request = studentId ? getStudentLedger(studentId) : getMyFeeLedger();
    request
      .then((res) => {
        setBalance(res.data.balance);
        setCreditBalance(res.data.credit_balance ?? 0);
        setEntries(res.data.entries);
      })
      .catch(() => toast.error('Failed to load the fee statement.'))
      .finally(() => setLoading(false));
  }, [studentId]);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <CircularProgress />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-2xl text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10">
          <Wallet className="w-7 h-7" strokeWidth={2.5} />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800 dark:text-slate-100">Fee Statement</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Your fee ledger and current balance.</p>
        </div>
      </div>

      <Card>
        <CardContent>
          {creditBalance > 0 ? (
            <>
              <div className="text-sm text-slate-500 dark:text-slate-400">Credit Balance</div>
              <div className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">
                KES {creditBalance.toLocaleString()}
              </div>
              <div className="text-sm text-emerald-600 dark:text-emerald-400 mt-1">
                Carried forward to next term.
              </div>
            </>
          ) : (
            <>
              <div className="text-sm text-slate-500 dark:text-slate-400">Current Balance</div>
              <div className={`text-3xl font-bold ${(balance ?? 0) > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                KES {(balance ?? 0).toLocaleString()}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          {entries.length === 0 ? (
            <div className="text-center text-slate-400 dark:text-slate-500 text-sm py-8">
              No ledger entries yet.
            </div>
          ) : (
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Date</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Description</TableCell>
                  <TableCell align="right">Amount</TableCell>
                  <TableCell align="right">Balance</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>{entry.date}</TableCell>
                    <TableCell><Chip label={entry.entry_type} size="small" color={ENTRY_TYPE_COLOR[entry.entry_type]} /></TableCell>
                    <TableCell>{entry.description}</TableCell>
                    <TableCell align="right">KES {entry.amount.toLocaleString()}</TableCell>
                    <TableCell align="right">KES {entry.running_balance.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface ChildOption {
  id: number;
  name: string;
  class_name: string;
}

/** Parent-facing wrapper. There is no shared "selected child" context/route param
 * anywhere in the parent dashboard yet (checked ParentDashboard.tsx and
 * ResultsHub.tsx's `role="parent"` branch, which is a static placeholder) --
 * the one real precedent is ParentAssignments.tsx, which independently fetches
 * `/api/parent/dashboard-overview/` for the children list and keeps the
 * selected child as local component state with a switcher UI when there's more
 * than one child. This mirrors that exact pattern rather than inventing a new one. */
export function ParentFeeStatementPage() {
  const [children, setChildren] = useState<ChildOption[]>([]);
  const [selectedChild, setSelectedChild] = useState<number | null>(null);
  const [loadingChildren, setLoadingChildren] = useState(true);

  useEffect(() => {
    api.get('/api/parent/dashboard-overview/')
      .then((res) => {
        const kids: ChildOption[] = (res.data?.data?.children || []).map((c: any) => ({ id: c.id, name: c.name, class_name: c.class_name }));
        setChildren(kids);
        if (kids.length > 0) setSelectedChild(kids[0].id);
      })
      .catch((err) => {
        console.error('Failed to fetch children', err);
        toast.error("Failed to load your children's profiles.");
      })
      .finally(() => setLoadingChildren(false));
  }, []);

  if (loadingChildren) {
    return (
      <div className="flex justify-center py-16">
        <CircularProgress />
      </div>
    );
  }

  if (children.length === 0) {
    return (
      <div className="max-w-5xl mx-auto bg-white dark:bg-slate-900 p-8 rounded-2xl border border-slate-100 dark:border-slate-700 text-center text-slate-400 dark:text-slate-500 text-sm">
        No linked student profiles yet. Contact the school office if this looks wrong.
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      {children.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          {children.map((child) => (
            <button
              key={child.id}
              onClick={() => setSelectedChild(child.id)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-colors ${selectedChild === child.id ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
            >
              {child.name}
            </button>
          ))}
        </div>
      )}
      {selectedChild && <StudentFeeStatementPage studentId={selectedChild} />}
    </div>
  );
}
