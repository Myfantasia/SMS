import type { ReactNode } from 'react';
import { CalendarRange, User, MessageSquareText, UserCheck, Edit, XCircle } from 'lucide-react';
import LeaveStatusBadge from './LeaveStatusBadge';
import type { TeacherLeaveRequest } from '../../libs/types';

interface LeaveRequestCardProps {
  leave: TeacherLeaveRequest;
  showTeacherName?: boolean;
  onEdit?: (leave: TeacherLeaveRequest) => void;
  onCancel?: (leave: TeacherLeaveRequest) => void;
  footer?: ReactNode;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function LeaveRequestCard({ leave, showTeacherName, onEdit, onCancel, footer }: LeaveRequestCardProps) {
  const canModify = leave.status === 'Pending' && (onEdit || onCancel);

  return (
    <div className="group bg-white dark:bg-slate-900 rounded-2xl p-5 shadow-sm dark:shadow-none border border-slate-200 dark:border-slate-700 hover:shadow-md dark:hover:shadow-none hover:border-slate-300 dark:hover:border-slate-600 transition-all relative overflow-hidden">
      <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${
        leave.status === 'Approved' ? 'bg-emerald-500' : leave.status === 'Rejected' ? 'bg-rose-500' : 'bg-amber-500'
      }`} />

      <div className="pl-3 flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">{leave.leave_type_display}</h3>
            <LeaveStatusBadge status={leave.status} />
            {leave.is_long_term && (
              <span className="px-2.5 py-0.5 text-[10px] font-black rounded-full border bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-500/40 uppercase tracking-widest">
                Long-Term
              </span>
            )}
          </div>

          {showTeacherName && (
            <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1.5">
              <User className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" /> {leave.teacher_name}
            </p>
          )}

          <p className="flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
            <CalendarRange className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
            {formatDate(leave.start_date)} &rarr; {formatDate(leave.end_date)}
            <span className="text-slate-400 dark:text-slate-500">&bull;</span>
            {leave.duration_days} day{leave.duration_days === 1 ? '' : 's'}
          </p>

          {leave.reason && (
            <p className="flex items-start gap-1.5 text-sm text-slate-600 dark:text-slate-300 mt-2">
              <MessageSquareText className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 mt-0.5 shrink-0" />
              <span className="whitespace-pre-wrap">{leave.reason}</span>
            </p>
          )}

          {leave.relief_teacher_name && (
            <p className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 mt-2">
              <UserCheck className="w-3.5 h-3.5" /> Relief cover: {leave.relief_teacher_name}
            </p>
          )}
        </div>

        {canModify && (
          <div className="flex items-center gap-2 shrink-0">
            {onEdit && (
              <button
                onClick={() => onEdit(leave)}
                title="Edit this application"
                className="text-slate-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 transition-all p-2 rounded-xl hover:bg-blue-50 dark:hover:bg-blue-500/10 border border-transparent hover:border-blue-100 dark:hover:border-blue-500/20"
              >
                <Edit className="w-4 h-4" />
              </button>
            )}
            {onCancel && (
              <button
                onClick={() => onCancel(leave)}
                title="Cancel this application"
                className="text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 transition-all p-2 rounded-xl hover:bg-rose-50 dark:hover:bg-rose-500/10 border border-transparent hover:border-rose-100 dark:hover:border-rose-500/20"
              >
                <XCircle className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      </div>

      {footer && <div className="pl-3 mt-4 pt-4 border-t border-slate-100 dark:border-slate-700">{footer}</div>}
    </div>
  );
}
