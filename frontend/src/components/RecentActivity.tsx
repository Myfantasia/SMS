import { useEffect, useState, type ReactNode } from 'react';
import { Plus, Pencil, Minus, Settings, Lock, History, AlertCircle, Loader2 } from 'lucide-react';
import api from '../libs/axiosInstance';

interface AuditLogEntry {
  id: number;
  user_name: string;
  action: string;
  target_type: string;
  details: string;
  timestamp: string;
}

// Maps the backend's raw SystemAuditLog.action_type enum to an icon + color family.
function getActionStyle(action: string): { icon: ReactNode; chip: string } {
  if (['CREATE', 'APPROVE', 'RESTORE'].includes(action)) {
    return { icon: <Plus className="w-3.5 h-3.5" strokeWidth={3} />, chip: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' };
  }
  if (action === 'UPDATE') {
    return { icon: <Pencil className="w-3.5 h-3.5" strokeWidth={2.5} />, chip: 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400' };
  }
  if (['DELETE', 'REJECT'].includes(action)) {
    return { icon: <Minus className="w-3.5 h-3.5" strokeWidth={3} />, chip: 'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400' };
  }
  if (['SIMULATION', 'EXECUTION', 'PROMOTE'].includes(action)) {
    return { icon: <Settings className="w-3.5 h-3.5" strokeWidth={2.5} />, chip: 'bg-slate-100 dark:bg-slate-500/10 text-slate-500 dark:text-slate-400' };
  }
  if (action.startsWith('AUTH_')) {
    return { icon: <Lock className="w-3.5 h-3.5" strokeWidth={2.5} />, chip: 'bg-slate-100 dark:bg-slate-500/10 text-slate-500 dark:text-slate-400' };
  }
  return { icon: <History className="w-3.5 h-3.5" strokeWidth={2.5} />, chip: 'bg-slate-100 dark:bg-slate-500/10 text-slate-500 dark:text-slate-400' };
}

// Backend sends '%Y-%m-%d %H:%M:%S' (space-separated, no timezone) -- swap in a 'T'
// so Date can parse it reliably as local time instead of relying on browser-specific fallback parsing.
function relativeTime(timestamp: string): string {
  const then = new Date(timestamp.replace(' ', 'T')).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = Date.now() - then;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp.replace(' ', 'T')).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function RecentActivity() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.get('/api/timetable/audit-logs/?page_size=6')
      .then((res) => {
        if (res.data.status === 'success') {
          setEntries(res.data.data);
        } else {
          setError(true);
        }
      })
      .catch((err) => {
        console.error('Failed to fetch recent activity', err);
        setError(true);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl w-full p-4 border border-slate-100 dark:border-slate-700 shadow-sm dark:shadow-none flex flex-col">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-lg font-bold text-slate-700 dark:text-slate-100">Recent Activity</h1>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-slate-400 dark:text-slate-500 gap-2 py-8">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading...
        </div>
      ) : error ? (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 gap-2 text-center px-4 py-8">
          <AlertCircle className="w-8 h-8 text-slate-300 dark:text-slate-600" />
          <p className="text-sm">Couldn't load recent activity.</p>
        </div>
      ) : entries.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 gap-2 text-center px-4 py-8">
          <History className="w-8 h-8 text-slate-300 dark:text-slate-600" />
          <p className="text-sm">No activity recorded yet.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {entries.map((entry) => {
            const { icon, chip } = getActionStyle(entry.action);
            return (
              <div key={entry.id} className="flex items-start gap-3 py-2 px-1 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors">
                <div className={`shrink-0 p-1.5 rounded-full mt-0.5 ${chip}`}>{icon}</div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-700 dark:text-slate-200 leading-snug">
                    <span className="font-bold">{entry.user_name}</span>{' '}
                    <span className="text-slate-500 dark:text-slate-400">{entry.details || entry.action.toLowerCase()}</span>
                  </p>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500">{relativeTime(entry.timestamp)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
