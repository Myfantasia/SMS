import { Clock, CheckCircle2, XCircle } from 'lucide-react';
import type { LeaveStatus } from '../../libs/types';

interface LeaveStatusBadgeProps {
  status: LeaveStatus;
}

const STATUS_STYLES: Record<LeaveStatus, { classes: string; icon: typeof Clock }> = {
  Pending: { classes: 'bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/40', icon: Clock },
  Approved: { classes: 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/40', icon: CheckCircle2 },
  Rejected: { classes: 'bg-rose-100 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-500/40', icon: XCircle },
};

export default function LeaveStatusBadge({ status }: LeaveStatusBadgeProps) {
  const config = STATUS_STYLES[status] ?? STATUS_STYLES.Pending;
  const Icon = config.icon;

  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 text-[11px] font-black rounded-full border uppercase tracking-widest ${config.classes}`}>
      <Icon className="w-3.5 h-3.5" />
      {status}
    </span>
  );
}
