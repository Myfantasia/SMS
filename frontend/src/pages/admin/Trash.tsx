import { useEffect, useState } from 'react';
import api from '../../libs/axiosInstance';
import { Trash2, RotateCcw, AlertTriangle } from 'lucide-react';

const ENTITY_TABS: { key: string; label: string }[] = [
  { key: 'users-students', label: 'Students' },
  { key: 'users-teachers', label: 'Teachers' },
  { key: 'users-parents', label: 'Parents' },
  { key: 'users-staff', label: 'Staff' },
  { key: 'class-streams', label: 'Class Streams' },
  { key: 'subjects', label: 'Subjects' },
  { key: 'leave-requests', label: 'Leave Requests' },
  { key: 'roles', label: 'Roles' },
  { key: 'events', label: 'Events' },
  { key: 'notices', label: 'Notices' },
  { key: 'assignments', label: 'Assignments' },
];

interface TrashRow {
  id: number;
  label: string;
  deleted_at: string | null;
  deleted_by: string | null;
  auto_purge: boolean;
  purge_at: string | null;
}

function daysLeft(purgeAt: string | null): string {
  if (!purgeAt) return 'Kept indefinitely — restore or delete manually';
  const diffMs = new Date(purgeAt).getTime() - Date.now();
  const days = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  return `${days} day${days === 1 ? '' : 's'} left`;
}

export default function Trash() {
  const [activeTab, setActiveTab] = useState(ENTITY_TABS[0].key);
  const [rows, setRows] = useState<TrashRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get(`/api/trash/${activeTab}/`)
      .then(res => setRows(res.data.data))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [activeTab]);

  const restore = async (id: number) => {
    await api.post(`/api/trash/${activeTab}/${id}/restore/`, {});
    setRows(rows.filter(r => r.id !== id));
  };

  const purge = async (id: number) => {
    if (!window.confirm('Permanently delete this item? This cannot be undone.')) return;
    await api.post(`/api/trash/${activeTab}/${id}/purge/`, {});
    setRows(rows.filter(r => r.id !== id));
  };

  return (
    <div className="p-6 bg-slate-50 dark:bg-slate-950 min-h-screen">
      <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-4 flex items-center gap-2">
        <Trash2 className="w-6 h-6" /> Trash
      </h1>

      <div className="flex gap-2 mb-4 flex-wrap">
        {ENTITY_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-colors ${
              activeTab === tab.key
                ? 'bg-blue-600 text-white'
                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-700 overflow-hidden">
        {loading ? (
          <div className="p-6 text-slate-400 text-sm">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-slate-400 text-sm">Nothing in Trash for this category.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
              <tr>
                <th className="text-left px-4 py-2">Item</th>
                <th className="text-left px-4 py-2">Deleted by</th>
                <th className="text-left px-4 py-2">Status</th>
                <th className="text-right px-4 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id} className="border-t border-slate-100 dark:border-slate-700">
                  <td className="px-4 py-2 text-slate-800 dark:text-slate-100">{row.label}</td>
                  <td className="px-4 py-2 text-slate-500 dark:text-slate-400">{row.deleted_by ?? '—'}</td>
                  <td className="px-4 py-2 text-slate-500 dark:text-slate-400">
                    <span className="inline-flex items-center gap-1">
                      {!row.auto_purge && <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />}
                      {daysLeft(row.purge_at)}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right space-x-2">
                    <button onClick={() => restore(row.id)} className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 hover:text-emerald-700">
                      <RotateCcw className="w-3.5 h-3.5" /> Restore
                    </button>
                    <button onClick={() => purge(row.id)} className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 hover:text-red-700">
                      <Trash2 className="w-3.5 h-3.5" /> Delete Forever
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
