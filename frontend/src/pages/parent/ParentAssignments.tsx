import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileEdit, ShieldAlert, CheckCircle2, RotateCcw, Clock, Eye, Users, Timer, Bell
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../libs/axiosInstance';
import { parentAssignmentService } from '../../libs/parentAssignmentService';
import type { BoardItem, ParentAlert } from '../../libs/assignments';

interface ChildOption {
  id: number;
  name: string;
  class_name: string;
}

export default function ParentAssignments() {
  const navigate = useNavigate();
  const [children, setChildren] = useState<ChildOption[]>([]);
  const [selectedChild, setSelectedChild] = useState<number | null>(null);
  const [board, setBoard] = useState<BoardItem[]>([]);
  const [alerts, setAlerts] = useState<ParentAlert[]>([]);
  const [loadingChildren, setLoadingChildren] = useState(true);
  const [loadingBoard, setLoadingBoard] = useState(false);

  useEffect(() => {
    api.get('/api/parent/dashboard-overview/')
      .then((res) => {
        const kids: ChildOption[] = (res.data?.data?.children || []).map((c: any) => ({ id: c.id, name: c.name, class_name: c.class_name }));
        setChildren(kids);
        if (kids.length > 0) setSelectedChild(kids[0].id);
      })
      .catch((err) => {
        console.error("Failed to fetch children", err);
        toast.error("Failed to load your children's profiles.");
      })
      .finally(() => setLoadingChildren(false));

    parentAssignmentService.getMonitoring().then(setAlerts).catch((err) => console.error("Failed to fetch monitoring alerts", err));
  }, []);

  useEffect(() => {
    if (!selectedChild) return;
    setLoadingBoard(true);
    parentAssignmentService.getBoard(selectedChild)
      .then(setBoard)
      .catch((err) => {
        console.error("Failed to fetch child's assignment board", err);
        toast.error("Failed to load assignments for this child.");
      })
      .finally(() => setLoadingBoard(false));
  }, [selectedChild]);

  const childAlerts = alerts.filter(a => a.student_id === selectedChild);

  const statusBadge = (status: string) => {
    switch (status) {
      case 'Published':
        return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="w-3 h-3" /> Graded</span>;
      case 'Returned':
        return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400"><RotateCcw className="w-3 h-3" /> Needs Revision</span>;
      case 'Pending':
        return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400"><Clock className="w-3 h-3" /> Submitted</span>;
      default:
        return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"><FileEdit className="w-3 h-3" /> Not Started</span>;
    }
  };

  if (loadingChildren) {
    return (
      <div className="max-w-6xl mx-auto space-y-6 animate-pulse">
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
          <h1 className="text-2xl font-extrabold text-slate-800 dark:text-slate-100">Assignments</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Track your children's tasks and grades.</p>
        </div>
      </div>

      {children.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 p-8 rounded-2xl border border-slate-100 dark:border-slate-700 text-center text-slate-400 dark:text-slate-500 text-sm">
          No linked student profiles yet. Contact the school office if this looks wrong.
        </div>
      ) : (
        <>
          {children.length > 1 && (
            <div className="flex gap-2 flex-wrap">
              {children.map(child => (
                <button
                  key={child.id}
                  onClick={() => setSelectedChild(child.id)}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-colors ${selectedChild === child.id ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                >
                  {child.name}
                </button>
              ))}
            </div>
          )}

          {childAlerts.length > 0 && (
            <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/40 rounded-2xl p-4 space-y-2">
              <h3 className="text-sm font-bold text-amber-800 dark:text-amber-300 flex items-center gap-2"><Bell className="w-4 h-4" /> Recent Alerts</h3>
              {childAlerts.slice(0, 5).map((a, idx) => (
                <p key={idx} className="text-xs text-amber-700 dark:text-amber-400">
                  <strong>{a.assignment_title}</strong> ({a.subject}) — {a.alert_type}{a.score !== null ? `: ${a.score}` : ''}
                </p>
              ))}
            </div>
          )}

          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm dark:shadow-none border border-slate-100 dark:border-slate-700 overflow-hidden">
            {loadingBoard ? (
              <div className="p-4 space-y-2 animate-pulse">
                {[1, 2, 3].map(i => <div key={i} className="h-20 bg-slate-100 dark:bg-slate-800 rounded-xl"></div>)}
              </div>
            ) : board.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-500 space-y-3">
                <ShieldAlert className="w-12 h-12 text-slate-300 dark:text-slate-600" />
                <p className="text-sm font-medium">No assignments found for this child.</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {board.map(item => (
                  <div key={item.id} className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/50 dark:hover:bg-slate-800/40 transition-colors">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-slate-800 dark:text-slate-100 truncate">{item.title}</h3>
                        {item.is_quiz && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-purple-700 dark:text-purple-400 bg-purple-50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/40 px-2 py-0.5 rounded uppercase">
                            <Timer className="w-3 h-3" /> Quiz
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
                      {item.student_status === 'Published' && selectedChild && (
                        <button
                          onClick={() => navigate(`${item.id}/review?student_id=${selectedChild}`)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                        >
                          <Eye className="w-3.5 h-3.5" /> View
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
