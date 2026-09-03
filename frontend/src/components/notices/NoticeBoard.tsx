import { Trash2, Paperclip, Download, Edit, AlertCircle, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import type { SchoolNotice } from './NoticesHub';
import api from '../../libs/axiosInstance';

interface NoticeBoardProps {
  role: 'admin' | 'teacher' | 'student' | 'parent';
  notices: SchoolNotice[];
  onRefresh: () => void;
  onEdit: (notice: SchoolNotice) => void;
}

export default function NoticeBoard({ role, notices, onRefresh, onEdit }: NoticeBoardProps) {

  // Logic: The actual API call to the Django backend
  const executeDelete = async (id: number) => {
    const loadingToast = toast.loading("Processing deletion...");
    try {
      await api.delete(`/api/core/notices/${id}/`);
      toast.success("Notice permanently removed from database.", { id: loadingToast });
      onRefresh();
    } catch (error) {
      console.error("Django Error Details:", error);
      toast.error("Critical: Could not complete deletion request.", { id: loadingToast });
    }
  };

  // Logic: Professional Confirmation UI via Custom Toast
  const handleDeleteRequest = (id: number) => {
    toast.custom((t) => (
      <div
        className={`${
          t.visible ? 'animate-enter' : 'animate-leave'
        } max-w-md w-full bg-white dark:bg-slate-900 shadow-2xl dark:shadow-none rounded-xl pointer-events-auto flex ring-1 ring-black ring-opacity-5 dark:ring-slate-700 overflow-hidden border border-slate-200 dark:border-slate-700`}
      >
        <div className="flex-1 w-0 p-4">
          <div className="flex items-start">
            <div className="shrink-0 pt-0.5">
              <div className="p-2 bg-red-100 dark:bg-red-500/10 rounded-full">
                <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" />
              </div>
            </div>
            <div className="ml-4 flex-1">
              <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Confirm Permanent Deletion
              </p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                This notice and any associated attachments will be purged. This action cannot be undone.
              </p>
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-3">
            <button
              onClick={() => toast.dismiss(t.id)}
              className="px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-all uppercase tracking-wider"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                toast.dismiss(t.id);
                executeDelete(id);
              }}
              className="px-4 py-2 text-xs font-bold text-white bg-red-600 rounded-lg hover:bg-red-700 transition-all shadow-sm dark:shadow-none shadow-red-200 uppercase tracking-wider"
            >
              Confirm Delete
            </button>
          </div>
        </div>
      </div>
    ), { duration: Infinity, position: 'top-center' });
  };

  const getAudienceStyle = (audience: string) => {
    switch(audience) {
      case 'Teachers': return 'bg-purple-100 dark:bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-500/40';
      case 'Parents': return 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/40';
      case 'Students': return 'bg-orange-100 dark:bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-500/40';
      default: return 'bg-blue-100 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-500/40';
    }
  };

  if (notices.length === 0) {
    return (
      <div className="text-center py-20 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-inner">
        <p className="text-slate-400 dark:text-slate-500 font-semibold tracking-tight italic">No published notices are currently available for display.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {notices.map((notice) => {
        const formattedDate = new Date(notice.date).toLocaleDateString('en-GB', {
          day: 'numeric', month: 'long', year: 'numeric'
        });

        const accentColor = notice.is_urgent
          ? 'bg-red-500'
          : getAudienceStyle(notice.audience).split(' ')[0].replace('100', '500');

        return (
          <div
            key={notice.id}
            className="group bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-sm dark:shadow-none border border-slate-200 dark:border-slate-700 transition-all duration-300 hover:shadow-xl dark:hover:shadow-none hover:border-slate-300 dark:hover:border-slate-600 relative overflow-hidden"
          >
            {/* Structural Accent Line */}
            <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${accentColor}`}></div>

            <div className="flex justify-between items-start mb-4 pl-3">
              <div className="flex items-center gap-3 flex-wrap">
                <h3 className="text-xl font-extrabold text-slate-800 dark:text-slate-100 tracking-tight">{notice.title}</h3>

                {notice.is_urgent && (
                  <span className="flex items-center gap-1.5 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 text-[11px] font-black px-3 py-1 rounded-full uppercase tracking-widest border border-red-100 dark:border-red-500/20 animate-pulse">
                    <AlertCircle className="w-3.5 h-3.5" /> Urgent
                  </span>
                )}

                <span className={`px-3 py-1 text-[11px] font-black rounded-full border uppercase tracking-widest ${getAudienceStyle(notice.audience)}`}>
                  {notice.audience}
                </span>
              </div>

              {role === 'admin' && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onEdit(notice)}
                    className="text-slate-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 transition-all p-2 rounded-xl hover:bg-blue-50 dark:hover:bg-blue-500/10 border border-transparent hover:border-blue-100 dark:hover:border-blue-500/20"
                    title="Edit Notice Content"
                  >
                    <Edit className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => handleDeleteRequest(notice.id)}
                    className="text-slate-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400 transition-all p-2 rounded-xl hover:bg-red-50 dark:hover:bg-red-500/10 border border-transparent hover:border-red-100 dark:hover:border-red-500/20"
                    title="Delete Notice Permanently"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              )}
            </div>

            <p className="text-slate-600 dark:text-slate-300 text-[15px] whitespace-pre-wrap font-medium leading-relaxed mb-6 pl-3 border-l border-slate-100 dark:border-slate-700">
              {notice.message}
            </p>

            <div className="flex flex-wrap items-center justify-between gap-4 pt-5 border-t border-slate-100 dark:border-slate-700 pl-3">
              <div className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                Authorized by <span className="text-slate-900 dark:text-slate-100">{notice.by}</span> • {formattedDate}
              </div>

              {notice.attachment && (
                <a
                  href={notice.attachment}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2.5 px-5 py-2.5 bg-slate-900 text-white text-xs font-black rounded-xl hover:bg-slate-800 transition-all shadow-lg dark:shadow-none shadow-slate-200 active:scale-95"
                >
                  <Paperclip className="w-4 h-4 text-blue-400" />
                  Download Resource
                  <Download className="w-3.5 h-3.5 ml-1 opacity-60" />
                </a>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
