import { Trash2, X } from 'lucide-react';
import type { Lesson } from '../../libs/types';

// --- FRONTEND HELPER FUNCTIONS ---
const isTechSubject = (subjectName: string, gradeName: string) => {
  const nameUpper = subjectName.toUpperCase();
  const gradeNum = parseInt(gradeName.replace(/\D/g, '')) || 0;
  
  if (nameUpper === "TECHNICAL BLOCK") return true;

  const techKeywords = ["TECHNICAL", "PRE-TECH", "HOME SCIENCE", "COMPUTER", "AGRICULTURE", "ART", "MUSIC"];
  if (techKeywords.some(kw => nameUpper.includes(kw))) return true;

  if (nameUpper.includes("BUSINESS")) return gradeNum >= 10;
  return false;
};

interface ViewBlockModalProps {
  lessons: Lesson[];
  gradeName: string;
  onClose: () => void;
  onDeleteLesson: (id: number) => void;
}

export default function ViewBlockModal({ lessons, gradeName, onClose, onDeleteLesson }: ViewBlockModalProps) {
  if (!lessons || lessons.length === 0) return null;

  const isTech = isTechSubject(lessons[0].subject_name, gradeName);

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-fade-in flex flex-col max-h-[80vh]">
        
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <h3 className="font-black text-lg text-slate-800">
            {isTech ? 'Technical Block Details' : 'Religious Block Details'}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors p-1 rounded-md hover:bg-slate-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body - List of Subjects */}
        <div className="p-6 overflow-y-auto custom-scrollbar flex flex-col gap-3">
          {lessons.map(sl => (
            <div key={sl.id} className="flex justify-between items-center p-4 rounded-xl border border-slate-200 bg-slate-50">
              <div>
                <p className="font-bold text-sm text-slate-800">{sl.subject_name}</p>
                <p className="text-xs font-medium text-slate-500 mt-1">{sl.teacher_name}</p>
              </div>
              <button
                onClick={() => {
                  onDeleteLesson(sl.id);
                  onClose(); // Close the view modal so the confirmation dialog can appear
                }}
                className="p-2 bg-white border border-slate-200 text-red-500 hover:bg-red-50 hover:border-red-200 rounded-lg shadow-sm transition-colors"
                title="Remove this specific subject"
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