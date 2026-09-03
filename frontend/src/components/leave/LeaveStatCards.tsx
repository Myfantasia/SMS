import { Clock, CheckCircle2, XCircle, CalendarRange } from 'lucide-react';
import type { LeaveStats } from '../../libs/types';

interface LeaveStatCardsProps {
  stats: LeaveStats;
  totalLabel?: string;
}

export default function LeaveStatCards({ stats, totalLabel = 'Total Applications' }: LeaveStatCardsProps) {
  const cards = [
    { label: 'Awaiting Decision', value: stats.pending, icon: Clock, accent: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10' },
    { label: 'Approved', value: stats.approved, icon: CheckCircle2, accent: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10' },
    { label: 'Rejected', value: stats.rejected, icon: XCircle, accent: 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10' },
    { label: totalLabel, value: stats.total, icon: CalendarRange, accent: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10' },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => (
        <div key={card.label} className="bg-white dark:bg-slate-900 rounded-2xl p-5 shadow-sm dark:shadow-none border border-slate-100 dark:border-slate-700 flex items-center gap-4">
          <div className={`p-3 rounded-xl ${card.accent}`}>
            <card.icon className="w-5 h-5" />
          </div>
          <div>
            <p className="text-2xl font-extrabold text-slate-800 dark:text-slate-100 leading-none">{card.value}</p>
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mt-1">{card.label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
