import { Trash2, X, Layers } from 'lucide-react';
import type { Lesson } from '../../libs/types';

interface ViewBlockModalProps {
  lessons: Lesson[];
  gradeName: string;
  onClose: () => void;
  onDeleteLesson: (id: number) => void;
}

export default function ViewBlockModal({ lessons, gradeName, onClose, onDeleteLesson }: ViewBlockModalProps) {
  if (!lessons || lessons.length === 0) return null;

  // Use the real block name the admin configured (Settings → Subject Blocks) instead
  // of guessing from a hardcoded keyword list — that list only ever produced two
  // possible titles ("Technical"/"Religious"), which was wrong for any other block.
  const blockName = String(lessons[0].subject_block_name || 'Elective Option Block');

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl dark:shadow-none w-full max-w-md overflow-hidden animate-fade-in flex flex-col max-h-[80vh]">

        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-800">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 shrink-0">
              <Layers className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="font-black text-lg text-slate-800 dark:text-slate-100 truncate">{blockName}</h3>
              <p className="text-xs text-slate-400 dark:text-slate-500 font-medium">{gradeName} &middot; {lessons.length} subject{lessons.length !== 1 ? 's' : ''} sharing this slot</p>
            </div>
          </div>
          <button onClick={onClose} title="Close" aria-label="Close" className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors p-1 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body - List of Subjects */}
        <div className="p-6 overflow-y-auto custom-scrollbar flex flex-col gap-3">
          {lessons.map(sl => (
            <div key={sl.id} className="flex justify-between items-center p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40">
              <div>
                <p className="font-bold text-sm text-slate-800 dark:text-slate-100">{sl.subject_name}</p>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-1">{sl.teacher_name}</p>
              </div>
              <button
                onClick={() => {
                  onDeleteLesson(sl.id);
                  onClose(); // Close the view modal so the confirmation dialog can appear
                }}
                className="p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 hover:border-red-200 dark:hover:border-red-500/40 rounded-lg shadow-sm dark:shadow-none transition-colors"
                title="Remove this specific subject"
                aria-label={`Remove ${sl.subject_name}`}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}
