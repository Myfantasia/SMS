import { Clock, CheckCircle2, XCircle } from 'lucide-react';
import type { LeaveStatus } from '../../libs/types';

interface LeaveStatusBadgeProps {
  status: LeaveStatus;
}

const STATUS_STYLES: Record<LeaveStatus, { classes: string; icon: typeof Clock }> = {
  Pending: { classes: 'bg-amber-100 text-amber-700 border-amber-200', icon: Clock },
  Approved: { classes: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: CheckCircle2 },
  Rejected: { classes: 'bg-rose-100 text-rose-700 border-rose-200', icon: XCircle },
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
