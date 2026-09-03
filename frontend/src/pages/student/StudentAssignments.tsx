import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileEdit, Search, Filter, Clock, CheckCircle2, RotateCcw, Lock,
  PlayCircle, Eye, Timer, Users, ShieldAlert
} from 'lucide-react';
import toast from 'react-hot-toast';
import { studentAssignmentService } from '../../libs/studentAssignmentService';
import type { BoardItem } from '../../libs/assignments';

export default function StudentAssignments() {
  const navigate = useNavigate();
  const [board, setBoard] = useState<BoardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');

  useEffect(() => {
    fetchBoard();
  }, []);

  const fetchBoard = async () => {
    try {
      setLoading(true);
      const data = await studentAssignmentService.getBoard();
      setBoard(data || []);
    } catch (error) {
      console.error("Error fetching assignment board:", error);
      toast.error("Failed to load your assignments.");
    } finally {
      setLoading(false);
    }
  };

  const filtered = board.filter(item => {
    const matchesSearch = item.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.subject.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'All' || item.student_status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const statusBadge = (status: string) => {
    switch (status) {
      case 'Published':
        return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="w-3 h-3" /> Graded</span>;
      case 'Returned':
        return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400"><RotateCcw className="w-3 h-3" /> Needs Revision</span>;
      case 'Pending':
        return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400"><Clock className="w-3 h-3" /> Submitted</span>;
      default:
        return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"><FileEdit className="w-3 h-3" /> Not Started</span>;
    }
  };

  const actionFor = (item: BoardItem) => {
    if (item.is_locked && item.student_status === 'Not Started') {
      return <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 dark:text-slate-500"><Lock className="w-3.5 h-3.5" /> Locked</span>;
    }
    if (item.student_status === 'Published') {
      return (
        <button onClick={() => navigate(`${item.id}/review`)} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
          <Eye className="w-3.5 h-3.5" /> View Feedback
        </button>
      );
    }
    if (item.student_status === 'Returned') {
      if (item.is_locked) return <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 dark:text-slate-500"><Lock className="w-3.5 h-3.5" /> Locked</span>;
      return (
        <button onClick={() => navigate(`${item.id}/take`)} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-semibold hover:bg-amber-700 transition-colors">
          <RotateCcw className="w-3.5 h-3.5" /> Revise & Resubmit
        </button>
      );
    }
    if (item.student_status === 'Pending') {
      const canResubmit = item.allow_resubmission && item.attempt_number < item.max_attempts && !item.is_locked;
      if (canResubmit) {
        return (
          <button onClick={() => navigate(`${item.id}/take`)} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
            <RotateCcw className="w-3.5 h-3.5" /> Resubmit
          </button>
        );
      }
      return <span className="text-xs text-slate-400 dark:text-slate-500 font-medium">Awaiting grading</span>;
    }
    // Not Started
    return (
      <button onClick={() => navigate(`${item.id}/take`)} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 transition-colors">
        <PlayCircle className="w-3.5 h-3.5" /> {item.is_quiz ? 'Start Quiz' : 'Start'}
      </button>
    );
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto space-y-6 animate-pulse">
        <div className="h-16 bg-slate-200 dark:bg-slate-800 rounded-2xl"></div>
        <div className="h-16 bg-slate-200 dark:bg-slate-800 rounded-2xl"></div>
        <div className="h-96 bg-slate-200 dark:bg-slate-800 rounded-2xl"></div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-2xl text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10">
          <FileEdit className="w-7 h-7" strokeWidth={2.5} />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800 dark:text-slate-100">My Assignments</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Tasks and quizzes assigned to you.</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 bg-white dark:bg-slate-900 p-4 rounded-2xl shadow-sm dark:shadow-none border border-slate-100 dark:border-slate-700">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500" />
          <input
            type="text"
            placeholder="Search by title or subject..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-slate-800 dark:text-slate-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:focus:ring-blue-400/20 focus:border-blue-500 dark:focus:border-blue-400 transition-all"
          />
        </div>
        <div className="flex items-center gap-2 min-w-50">
          <Filter className="w-4 h-4 text-slate-400 dark:text-slate-500" />
          <select
            aria-label="Filter assignments by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="flex-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 py-2 px-3 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:focus:ring-blue-400/20 focus:border-blue-500 dark:focus:border-blue-400 cursor-pointer"
          >
            <option value="All">All Statuses</option>
            <option value="Not Started">Not Started</option>
            <option value="Pending">Submitted</option>
            <option value="Returned">Needs Revision</option>
            <option value="Published">Graded</option>
          </select>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm dark:shadow-none border border-slate-100 dark:border-slate-700 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-500 space-y-3">
            <ShieldAlert className="w-12 h-12 text-slate-300 dark:text-slate-600" />
            <p className="text-sm font-medium">No assignments match your filters.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            {filtered.map(item => (
              <div key={item.id} className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/50 dark:hover:bg-slate-800/60 transition-colors">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-slate-800 dark:text-slate-100 truncate">{item.title}</h3>
                    {item.is_quiz && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-purple-700 dark:text-purple-400 bg-purple-50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/40 px-2 py-0.5 rounded uppercase">
                        <Timer className="w-3 h-3" /> {item.duration_minutes}min Quiz
                      </span>
                    )}
                    {item.is_group_assignment && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/40 px-2 py-0.5 rounded uppercase">
                        <Users className="w-3 h-3" /> Group
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    {item.subject} • Due {item.due_date ? new Date(item.due_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'N/A'}
                  </p>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  {statusBadge(item.student_status)}
                  {item.student_status === 'Published' && (
                    <span className="text-xs font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-md">{item.awarded_score} / {item.total_score}</span>
                  )}
                  {actionFor(item)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
