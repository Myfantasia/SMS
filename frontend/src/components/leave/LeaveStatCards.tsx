import { Clock, CheckCircle2, XCircle, CalendarRange } from 'lucide-react';
import type { LeaveStats } from '../../libs/types';

interface LeaveStatCardsProps {
  stats: LeaveStats;
  totalLabel?: string;
}

export default function LeaveStatCards({ stats, totalLabel = 'Total Applications' }: LeaveStatCardsProps) {
  const cards = [
    { label: 'Awaiting Decision', value: stats.pending, icon: Clock, accent: 'text-amber-600 bg-amber-50' },
    { label: 'Approved', value: stats.approved, icon: CheckCircle2, accent: 'text-emerald-600 bg-emerald-50' },
    { label: 'Rejected', value: stats.rejected, icon: XCircle, accent: 'text-rose-600 bg-rose-50' },
    { label: totalLabel, value: stats.total, icon: CalendarRange, accent: 'text-blue-600 bg-blue-50' },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => (
        <div key={card.label} className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 flex items-center gap-4">
          <div className={`p-3 rounded-xl ${card.accent}`}>
            <card.icon className="w-5 h-5" />
          </div>
          <div>
            <p className="text-2xl font-extrabold text-slate-800 leading-none">{card.value}</p>
            <p className="text-xs font-semibold text-slate-500 mt-1">{card.label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
