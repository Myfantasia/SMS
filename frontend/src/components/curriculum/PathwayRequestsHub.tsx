import { useState, useEffect, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import { GitBranch, Clock, CheckCircle2, XCircle, Check, X, Eye } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../libs/axiosInstance';
import type { DashboardContextType } from '../../layouts/DashboardLayouts';

interface PathwayRequest {
  id: number;
  student_id: number;
  student_name: string;
  student_roll: string;
  class_name: string | null;
  pathway_id: number;
  pathway_name: string;
  academic_year: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  updated_at: string;
}

const STATUS_STYLE: Record<string, string> = {
  Pending: 'bg-amber-50 text-amber-700 border-amber-200',
  Approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Rejected: 'bg-red-50 text-red-700 border-red-200',
};

type StatusFilter = 'Pending' | 'Approved' | 'Rejected' | 'All';

export default function PathwayRequestsHub({ role }: { role: 'admin' | 'teacher' }) {
  const { permissions } = useOutletContext<DashboardContextType>();
  const canDecide = permissions.includes('pathway.edit');

  const [requests, setRequests] = useState<PathwayRequest[]>([]);
  const [filter, setFilter] = useState<StatusFilter>('Pending');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);

  const fetchRequests = useCallback(async (status: StatusFilter) => {
    setLoading(true);
    try {
      const res = await api.get('/api/subjects/pathway-requests/', {
        params: status === 'All' ? {} : { status },
      });
      const result = res.data;
      if (result.status === 'success') {
        setRequests(result.data);
      } else {
        toast.error(result.message || 'Failed to load pathway requests.');
      }
    } catch (error: any) {
      console.error('Failed to load pathway requests', error);
      toast.error(error.response?.data?.message || 'Failed to load pathway requests.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRequests(filter);
  }, [filter, fetchRequests]);

  const handleDecide = async (request: PathwayRequest, decision: 'Approved' | 'Rejected') => {
    setBusyId(request.id);
    try {
      const res = await api.post(`/api/subjects/pathway-requests/${request.id}/decide/`, { decision });
      toast.success(res.data.message);
      fetchRequests(filter);
    } catch (error: any) {
      toast.error(error.response?.data?.message || `Failed to ${decision.toLowerCase()} request.`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-2xl text-indigo-600 bg-indigo-50">
          <GitBranch className="w-7 h-7" strokeWidth={2.5} />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800 flex items-center gap-2">
            Pathway Requests
            {!canDecide && (
              <span className="flex items-center gap-1 text-xs font-semibold text-slate-500 bg-slate-100 border border-slate-200 px-2 py-1 rounded-full">
                <Eye className="w-3 h-3" /> View only
              </span>
            )}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {role === 'admin'
              ? 'Every student Pathway request, across all classes.'
              : 'Pathway requests from students in classes you are the Class Teacher of.'}
          </p>
        </div>
      </div>

      <div className="flex bg-white rounded-lg p-1 shadow-sm border border-slate-100 w-max">
        {(['Pending', 'Approved', 'Rejected', 'All'] as StatusFilter[]).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition ${filter === s ? 'bg-slate-100 text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="text-slate-400 text-[11px] uppercase tracking-wider border-b border-slate-100 bg-slate-50">
              <th className="px-6 py-3 font-bold">Student</th>
              <th className="px-6 py-3 font-bold">Class</th>
              <th className="px-6 py-3 font-bold">Pathway</th>
              <th className="px-6 py-3 font-bold">Status</th>
              <th className="px-6 py-3 font-bold text-right">Action</th>
            </tr>
          </thead>
          <tbody className="text-sm text-slate-700 divide-y divide-slate-50">
            {loading ? (
              <tr><td colSpan={5} className="p-8 text-center text-slate-400">Loading...</td></tr>
            ) : requests.length === 0 ? (
              <tr><td colSpan={5} className="p-8 text-center text-slate-400">No {filter !== 'All' ? filter.toLowerCase() : ''} pathway requests.</td></tr>
            ) : (
              requests.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4">
                    <span className="font-semibold text-slate-800">{r.student_name}</span>
                    <span className="text-xs text-slate-400 ml-2">{r.student_roll}</span>
                  </td>
                  <td className="px-6 py-4 text-slate-500">{r.class_name ?? '—'}</td>
                  <td className="px-6 py-4 font-medium text-slate-700">{r.pathway_name}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${STATUS_STYLE[r.status]}`}>
                      {r.status === 'Pending' && <Clock className="w-3 h-3" />}
                      {r.status === 'Approved' && <CheckCircle2 className="w-3 h-3" />}
                      {r.status === 'Rejected' && <XCircle className="w-3 h-3" />}
                      {r.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    {canDecide && r.status === 'Pending' ? (
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => handleDecide(r, 'Approved')}
                          disabled={busyId === r.id}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-bold rounded-lg transition-colors border border-emerald-200 disabled:opacity-50"
                        >
                          <Check className="w-3.5 h-3.5" /> Approve
                        </button>
                        <button
                          onClick={() => handleDecide(r, 'Rejected')}
                          disabled={busyId === r.id}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold rounded-lg transition-colors border border-red-200 disabled:opacity-50"
                        >
                          <X className="w-3.5 h-3.5" /> Reject
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-300 italic">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
