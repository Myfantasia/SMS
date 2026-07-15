import { useState, useEffect } from 'react';
import { History, User, Calendar, Search, AlertCircle, RefreshCw, Layers, ChevronLeft, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../libs/axiosInstance';

interface AuditLogEntry {
  id: number;
  user_name: string;
  action: string;
  target_type: string;
  details: string;
  timestamp: string;
}

const ACTION_LABELS: Record<string, string> = {
  CREATE: 'Created Resource',
  UPDATE: 'Modified Settings / Rules',
  DELETE: 'Deleted Resource',
  RESTORE: 'Restored Resource',
  SIMULATION: 'Executed Simulation',
  EXECUTION: 'Committed Live Change',
};

const ACTION_COLORS: Record<string, string> = {
  CREATE: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  UPDATE: 'bg-purple-50 text-purple-700 border-purple-100',
  DELETE: 'bg-red-50 text-red-700 border-red-100',
  RESTORE: 'bg-blue-50 text-blue-700 border-blue-100',
  SIMULATION: 'bg-amber-50 text-amber-700 border-amber-100',
  EXECUTION: 'bg-indigo-50 text-indigo-700 border-indigo-100',
};

const PAGE_SIZE = 50;

export default function SettingsAuditLog() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [moduleFilter, setModuleFilter] = useState('');
  const [actionChoices, setActionChoices] = useState<string[]>([]);
  const [moduleChoices, setModuleChoices] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const fetchAuditLogs = async (targetPage: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchTerm) params.set('search', searchTerm);
      if (actionFilter) params.set('action', actionFilter);
      if (moduleFilter) params.set('module', moduleFilter);
      params.set('page', String(targetPage));
      params.set('page_size', String(PAGE_SIZE));

      const res = await api.get(`/api/timetable/audit-logs/?${params.toString()}`);
      const data = res.data;
      if (data.status === 'success') {
        setLogs(data.data);
        setTotalCount(data.total_count ?? data.data.length);
        setHasMore(Boolean(data.has_more));
        setPage(data.page ?? targetPage);
        if (data.action_choices) setActionChoices(data.action_choices);
        if (data.module_choices) setModuleChoices(data.module_choices);
      } else {
        toast.error(data.message || "Failed to load audit logging matrix.");
      }
    } catch (err) {
      console.error("Error connecting to event logging infrastructure:", err);
      toast.error("Network error pulling system change records.");
    } finally {
      setLoading(false);
    }
  };

  // Debounce free-text search so we don't hit the server on every keystroke; filter
  // dropdown changes and page changes still trigger immediately via the other effect.
  useEffect(() => {
    const timer = setTimeout(() => fetchAuditLogs(1), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm]);

  useEffect(() => {
    fetchAuditLogs(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionFilter, moduleFilter]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  if (loading && logs.length === 0) {
    return (
      <div className="space-y-6 max-w-5xl animate-pulse">
        <div className="h-16 bg-slate-200 rounded-xl"></div>
        <div className="h-80 bg-slate-200 rounded-xl"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl animate-fade-in">

      {/* Search and Advanced Filters Control Strip */}
      <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl flex flex-wrap gap-3 justify-between items-center shadow-sm">
        <div className="flex gap-3 flex-1 min-w-75 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search className="w-4 h-4 absolute left-3 top-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search by operator name or alteration details..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full border border-slate-300 rounded-lg pl-9 pr-4 py-2 text-sm bg-white outline-none focus:border-indigo-500 font-medium text-slate-700"
            />
          </div>
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-indigo-500 font-bold text-slate-700"
          >
            <option value="">All Actions</option>
            {actionChoices.map(a => (
              <option key={a} value={a}>{ACTION_LABELS[a] || a}</option>
            ))}
          </select>
          <select
            value={moduleFilter}
            onChange={(e) => setModuleFilter(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-indigo-500 font-bold text-slate-700"
          >
            <option value="">All Modules</option>
            {moduleChoices.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={() => fetchAuditLogs(page)}
          className="px-4 py-2 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold flex items-center gap-2 text-slate-600 transition shadow-sm"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Refresh Logs
        </button>
      </div>

      {/* Main Audit Records ledger */}
      {logs.length === 0 ? (
        <div className="border border-dashed border-slate-200 rounded-xl p-12 text-center text-slate-400 flex flex-col items-center justify-center gap-2">
          <AlertCircle className="w-8 h-8 text-slate-300" />
          <p className="text-sm font-bold">No historical change records match your search metrics.</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left border-collapse">
              <thead className="bg-slate-50 text-slate-600 font-bold uppercase text-xs border-b border-slate-200">
                <tr>
                  <th className="px-5 py-3.5">Timestamp</th>
                  <th className="px-5 py-3.5">Administrative Operator</th>
                  <th className="px-5 py-3.5">Target Layer</th>
                  <th className="px-5 py-3.5">Action Code</th>
                  <th className="px-5 py-3.5">Structural Delta Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/50 transition-colors">
                    {/* Date Context */}
                    <td className="px-5 py-4 whitespace-nowrap text-xs text-slate-500 font-mono">
                      <div className="flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                        <span>{log.timestamp}</span>
                      </div>
                    </td>

                    {/* User Context */}
                    <td className="px-5 py-4 whitespace-nowrap text-sm font-bold text-slate-800">
                      <div className="flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span>{log.user_name}</span>
                      </div>
                    </td>

                    {/* Target Scope Mapping */}
                    <td className="px-5 py-4 whitespace-nowrap text-xs">
                      <span className="flex items-center gap-1 text-slate-600 font-bold">
                        <Layers className="w-3.5 h-3.5 text-slate-400" />
                        {log.target_type}
                      </span>
                    </td>

                    {/* Action Classification badges */}
                    <td className="px-5 py-4 whitespace-nowrap text-xs">
                      <span className={`px-2 py-1 rounded-md font-black border uppercase tracking-wider text-[10px] ${ACTION_COLORS[log.action] || 'bg-slate-50 text-slate-700 border-slate-100'}`}>
                        {(ACTION_LABELS[log.action] || log.action).replace('_', ' ')}
                      </span>
                    </td>

                    {/* JSON/String Configuration Log Explanations */}
                    <td className="px-5 py-4 text-xs text-slate-600 max-w-md leading-relaxed wrap-break-word font-mono bg-slate-50/30">
                      {log.details}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 bg-slate-50/50 text-xs font-bold text-slate-500">
            <span className="flex items-center gap-1.5">
              <History className="w-3.5 h-3.5" /> {totalCount} total record(s) — page {page} of {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1 || loading}
                onClick={() => fetchAuditLogs(page - 1)}
                title="Previous page"
                aria-label="Previous page"
                className="p-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                disabled={!hasMore || loading}
                onClick={() => fetchAuditLogs(page + 1)}
                title="Next page"
                aria-label="Next page"
                className="p-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
