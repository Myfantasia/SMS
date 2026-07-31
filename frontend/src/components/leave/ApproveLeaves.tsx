import { useState, useEffect, useCallback, useMemo } from 'react';
import { ShieldCheck, Loader2, CheckCircle2, XCircle, UserCheck2, History } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../libs/axiosInstance';
import type { TeacherLeaveRequest, LeaveStats, EligibleReliefTeacher } from '../../libs/types';
import LeaveStatCards from './LeaveStatCards';
import LeaveRequestCard from './LeaveRequestCard';
import SearchableSelect from '../common/SearchableSelect';

const EMPTY_STATS: LeaveStats = { pending: 0, approved: 0, rejected: 0, total: 0 };

interface DecisionRowProps {
  leave: TeacherLeaveRequest;
  reliefTeachers: EligibleReliefTeacher[];
  onDecide: (leave: TeacherLeaveRequest, status: 'Approved' | 'Rejected', reliefTeacherId?: number) => void;
  isBusy: boolean;
}

function DecisionRow({ leave, reliefTeachers, onDecide, isBusy }: DecisionRowProps) {
  const [reliefTeacherId, setReliefTeacherId] = useState<string>('');
  const eligibleRelief = reliefTeachers.filter((t) => t.id !== leave.teacher);

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
      {leave.is_long_term && (
        <div className="flex-1">
          <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
            Relief Teacher (optional)
          </label>
          <div className="w-full sm:w-64">
            <SearchableSelect
              value={reliefTeacherId}
              onChange={setReliefTeacherId}
              placeholder="No relief teacher assigned"
              searchPlaceholder="Search teachers…"
              options={eligibleRelief.map((t) => ({ value: String(t.id), label: t.name }))}
            />
          </div>
        </div>
      )}
      <div className="flex items-center gap-2 sm:ml-auto">
        <button
          disabled={isBusy}
          onClick={() => onDecide(leave, 'Rejected')}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg hover:bg-rose-100 transition-all disabled:opacity-60"
        >
          <XCircle className="w-4 h-4" /> Reject
        </button>
        <button
          disabled={isBusy}
          onClick={() => onDecide(leave, 'Approved', reliefTeacherId ? Number(reliefTeacherId) : undefined)}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-all shadow-sm disabled:opacity-60"
        >
          <CheckCircle2 className="w-4 h-4" /> Approve
        </button>
      </div>
    </div>
  );
}

export default function ApproveLeaves() {
  const [leaves, setLeaves] = useState<TeacherLeaveRequest[]>([]);
  const [stats, setStats] = useState<LeaveStats>(EMPTY_STATS);
  const [reliefTeachers, setReliefTeachers] = useState<EligibleReliefTeacher[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'pending' | 'decided'>('pending');

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [leavesRes, statsRes] = await Promise.all([
        api.get('/api/core/leaves/'),
        api.get('/api/core/leaves/stats/'),
      ]);
      setLeaves(leavesRes.data);
      setStats(statsRes.data);
    } catch (error) {
      console.error('Error fetching leave approvals:', error);
      toast.error('Failed to load leave requests.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    api.get('/api/approved-users/teachers/')
      .then((res) => {
        if (res.data?.status === 'success') {
          setReliefTeachers(res.data.data.map((t: { id: number; name: string }) => ({ id: t.id, name: t.name })));
        }
      })
      .catch((err) => console.error('Failed to fetch teacher directory for relief assignment', err));
  }, [fetchData]);

  const pendingLeaves = useMemo(() => leaves.filter((l) => l.status === 'Pending'), [leaves]);
  const decidedLeaves = useMemo(
    () => leaves.filter((l) => l.status !== 'Pending').sort((a, b) => b.id - a.id),
    [leaves]
  );

  const handleDecide = async (leave: TeacherLeaveRequest, status: 'Approved' | 'Rejected', reliefTeacherId?: number) => {
    setBusyId(leave.id);
    try {
      await api.patch(`/api/core/leaves/${leave.id}/`, {
        status,
        ...(reliefTeacherId ? { relief_teacher_id: reliefTeacherId } : {}),
      });
      toast.success(
        status === 'Approved'
          ? `${leave.teacher_name}'s leave has been approved.`
          : `${leave.teacher_name}'s leave has been rejected.`
      );
      fetchData();
    } catch (error) {
      console.error('Error deciding on leave request:', error);
      toast.error('Failed to record your decision. Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6 flex items-center gap-4">
        <div className="p-3 rounded-2xl text-blue-600 bg-blue-50">
          <ShieldCheck className="w-7 h-7" strokeWidth={2.5} />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">Approve Leave Requests</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Review pending applications, decide, and assign relief cover for long-term absences.
          </p>
        </div>
      </div>

      <div className="mb-6">
        <LeaveStatCards stats={stats} />
      </div>

      <div className="flex bg-slate-100 p-1 rounded-lg w-fit mb-5">
        <button
          onClick={() => setActiveTab('pending')}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-all flex items-center gap-2 ${activeTab === 'pending' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          <UserCheck2 className="w-4 h-4" /> Pending Decisions ({pendingLeaves.length})
        </button>
        <button
          onClick={() => setActiveTab('decided')}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-all flex items-center gap-2 ${activeTab === 'decided' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          <History className="w-4 h-4" /> Decision History
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center items-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        </div>
      ) : activeTab === 'pending' ? (
        pendingLeaves.length === 0 ? (
          <div className="text-center py-20 bg-white border border-slate-200 rounded-2xl shadow-inner">
            <p className="text-slate-400 font-semibold tracking-tight italic">You are all caught up — no leave requests awaiting a decision.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {pendingLeaves.map((leave) => (
              <LeaveRequestCard
                key={leave.id}
                leave={leave}
                showTeacherName
                footer={
                  <DecisionRow
                    leave={leave}
                    reliefTeachers={reliefTeachers}
                    onDecide={handleDecide}
                    isBusy={busyId === leave.id}
                  />
                }
              />
            ))}
          </div>
        )
      ) : decidedLeaves.length === 0 ? (
        <div className="text-center py-20 bg-white border border-slate-200 rounded-2xl shadow-inner">
          <p className="text-slate-400 font-semibold tracking-tight italic">No decisions have been recorded yet.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {decidedLeaves.map((leave) => (
            <LeaveRequestCard key={leave.id} leave={leave} showTeacherName />
          ))}
        </div>
      )}
    </div>
  );
}
