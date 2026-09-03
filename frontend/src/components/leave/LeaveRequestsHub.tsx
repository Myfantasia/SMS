import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarClock, Plus, Loader2, Search, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../libs/axiosInstance';
import type { TeacherLeaveRequest, LeaveStats, LeaveStatus } from '../../libs/types';
import LeaveStatCards from './LeaveStatCards';
import LeaveRequestCard from './LeaveRequestCard';
import ApplyLeaveModal from './ApplyLeaveModal';

interface LeaveRequestsHubProps {
  role: 'admin' | 'teacher';
}

const EMPTY_STATS: LeaveStats = { pending: 0, approved: 0, rejected: 0, total: 0 };

export default function LeaveRequestsHub({ role }: LeaveRequestsHubProps) {
  const navigate = useNavigate();
  const [leaves, setLeaves] = useState<TeacherLeaveRequest[]>([]);
  const [stats, setStats] = useState<LeaveStats>(EMPTY_STATS);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingLeave, setEditingLeave] = useState<TeacherLeaveRequest | null>(null);

  const [statusFilter, setStatusFilter] = useState<LeaveStatus | 'All'>('All');
  const [searchQuery, setSearchQuery] = useState('');

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
      console.error('Error fetching leave data:', error);
      toast.error('Failed to load leave records.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleOpenApply = () => {
    setEditingLeave(null);
    setIsModalOpen(true);
  };

  const handleEdit = (leave: TeacherLeaveRequest) => {
    setEditingLeave(leave);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setEditingLeave(null);
    setIsModalOpen(false);
  };

  const handleCancel = (leave: TeacherLeaveRequest) => {
    toast.custom((t) => (
      <div className={`${t.visible ? 'animate-enter' : 'animate-leave'} max-w-md w-full bg-white dark:bg-slate-900 shadow-2xl dark:shadow-none rounded-xl pointer-events-auto ring-1 ring-black dark:ring-white/10 ring-opacity-5 overflow-hidden border border-slate-200 dark:border-slate-700 p-4`}>
        <p className="text-sm font-bold text-slate-900 dark:text-slate-100">Cancel this leave application?</p>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Your {leave.leave_type_display.toLowerCase()} request will be permanently withdrawn.
        </p>
        <div className="mt-4 flex justify-end gap-3">
          <button
            onClick={() => toast.dismiss(t.id)}
            className="px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-all uppercase tracking-wider"
          >
            Keep It
          </button>
          <button
            onClick={async () => {
              toast.dismiss(t.id);
              try {
                await api.delete(`/api/core/leaves/${leave.id}/`);
                toast.success('Leave application cancelled.');
                fetchData();
              } catch (error) {
                console.error('Error cancelling leave:', error);
                toast.error('Could not cancel this application.');
              }
            }}
            className="px-4 py-2 text-xs font-bold text-white bg-rose-600 rounded-lg hover:bg-rose-700 transition-all shadow-sm dark:shadow-none uppercase tracking-wider"
          >
            Cancel It
          </button>
        </div>
      </div>
    ), { duration: Infinity, position: 'top-center' });
  };

  const filteredLeaves = useMemo(() => {
    return leaves.filter((leave) => {
      const matchesStatus = statusFilter === 'All' || leave.status === statusFilter;
      const matchesSearch = !searchQuery.trim()
        || leave.teacher_name.toLowerCase().includes(searchQuery.trim().toLowerCase())
        || leave.leave_type_display.toLowerCase().includes(searchQuery.trim().toLowerCase());
      return matchesStatus && matchesSearch;
    });
  }, [leaves, statusFilter, searchQuery]);

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-2xl text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10">
            <CalendarClock className="w-7 h-7" strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-slate-800 dark:text-slate-100">
              {role === 'admin' ? 'Leave Requests Directory' : 'My Leave Applications'}
            </h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm mt-0.5">
              {role === 'admin'
                ? 'A live record of every leave application submitted across the school.'
                : 'Apply for leave and track the status of every application you have submitted.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {role === 'admin' && stats.pending > 0 && (
            <button
              onClick={() => navigate('/admin-dashboard/approvals/leave')}
              className="flex items-center gap-2 px-4 py-2 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-500/40 font-semibold rounded-lg hover:bg-amber-100 dark:hover:bg-amber-500/20 transition-all text-sm"
            >
              <ShieldCheck className="w-4 h-4" /> Review {stats.pending} Pending
            </button>
          )}
          {role === 'teacher' && (
            <button
              onClick={handleOpenApply}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-all shadow-sm dark:shadow-none"
            >
              <Plus className="w-4 h-4" /> Apply for Leave
            </button>
          )}
        </div>
      </div>

      <div className="mb-6">
        <LeaveStatCards stats={stats} totalLabel={role === 'admin' ? 'Total Applications' : 'My Applications'} />
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
          <input
            type="text"
            placeholder={role === 'admin' ? 'Search by teacher or leave type...' : 'Search by leave type...'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 dark:focus:border-blue-400 outline-none text-sm bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as LeaveStatus | 'All')}
          className="px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 dark:focus:border-blue-400 outline-none bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-200"
        >
          <option value="All">All Statuses</option>
          <option value="Pending">Pending</option>
          <option value="Approved">Approved</option>
          <option value="Rejected">Rejected</option>
        </select>
      </div>

      {isLoading ? (
        <div className="flex justify-center items-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500 dark:text-blue-400" />
        </div>
      ) : filteredLeaves.length === 0 ? (
        <div className="text-center py-20 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-inner dark:shadow-none">
          <p className="text-slate-400 dark:text-slate-500 font-semibold tracking-tight italic">
            {leaves.length === 0
              ? (role === 'admin' ? 'No leave applications have been submitted yet.' : "You haven't applied for any leave yet.")
              : 'No applications match your current filters.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredLeaves.map((leave) => (
            <LeaveRequestCard
              key={leave.id}
              leave={leave}
              showTeacherName={role === 'admin'}
              onEdit={role === 'teacher' ? handleEdit : undefined}
              onCancel={role === 'teacher' ? handleCancel : undefined}
            />
          ))}
        </div>
      )}

      {role === 'teacher' && (
        <ApplyLeaveModal
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          onSuccess={fetchData}
          initialData={editingLeave}
        />
      )}
    </div>
  );
}
