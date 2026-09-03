import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { X, UserCheck, AlertCircle, Loader2, Info } from 'lucide-react';
import type { Lesson } from '../../libs/types';
import api from '../../libs/axiosInstance';
import SearchableSelect from '../common/SearchableSelect';

interface SubstituteModalProps {
  allocationId: number;
  targetDate: string;
  onClose: () => void;
  onSuccess: () => void;
  lessons: Lesson[];
}

interface SubstituteTeacher {
  id: number;
  name: string;
  department: string;
  fatigue_warning?: string | null;
}

export default function SubstituteModal({ allocationId, targetDate, onClose, onSuccess, lessons }: SubstituteModalProps) {
  const [substitutes, setSubstitutes] = useState<SubstituteTeacher[]>([]);
  const [selectedSubId, setSelectedSubId] = useState<string>('');
  const [leaveReason, setLeaveReason] = useState<string>('Casual'); // Prepped structure adaptive for the future portal forms
  const [notes, setNotes] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Match meta-data vectors from current loaded list rows for dashboard diagnostics
  const targetedLessonObj = lessons.find(l => l.id === allocationId);

  useEffect(() => {
    const fetchFreeStaff = async () => {
      setIsLoading(true);
      try {
        const res = await api.get(`/api/timetable/available-substitutes/${allocationId}/${targetDate}/`);
        const responseData = res.data;
        if (responseData.status === 'success') {
          setSubstitutes(responseData.data);
        } else {
          toast.error(responseData.message || "Failed to parse clear substitute personnel.");
        }
      } catch (err) {
        console.error("Conflict checking query error:", err);
        toast.error("Error connecting to substitution matching engine.");
      } finally {
        setIsLoading(false);
      }
    };
    fetchFreeStaff();
  }, [allocationId, targetDate]);

  const commitDailyCoverOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSubId) return;
    setIsSaving(true);

    try {
      const payload = {
        target_lesson_id: allocationId,
        covering_teacher_id: Number(selectedSubId),
        date: targetDate,
        notes: `Leave Context: [${leaveReason}] - ${notes}`
      };

      const res = await api.post('/api/timetable/assign-daily-cover/', payload);
      const responseData = res.data;

      if (responseData.status === 'success') {
        toast.success(responseData.message || "Substitute temporary assignment secured.");
        onSuccess();
      } else {
        toast.error(responseData.message || "Relief execution rejected.");
      }
    } catch (err: any) {
      console.error("Error committing cover overlay:", err);
      const msg = err.response?.data?.message || "Relief tracking database collision.";
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-80 p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl dark:shadow-none w-full max-w-md overflow-hidden animate-fade-in border border-slate-100 dark:border-slate-700">

        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-amber-50/60 dark:bg-amber-500/10">
          <div className="flex items-center gap-2 text-amber-800 dark:text-amber-400">
            <UserCheck className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            <h3 className="font-bold text-lg text-slate-800 dark:text-slate-100">Assign Daily Cover</h3>
          </div>
          <button onClick={onClose} title="Close" aria-label="Close" className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Diagnostic Meta-Data Summary Card */}
        <div className="bg-slate-50 dark:bg-slate-800/40 p-4 border-b border-slate-100 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 space-y-1">
          <div className="flex justify-between">
            <span className="font-semibold text-slate-400 dark:text-slate-500">Target Date:</span>
            <span className="font-bold text-amber-800 dark:text-amber-400 bg-amber-100 dark:bg-amber-500/10 px-2 py-0.5 rounded-md">{targetDate}</span>
          </div>
          <div className="flex justify-between">
            <span className="font-semibold text-slate-400 dark:text-slate-500">Master Class:</span>
            <span className="font-bold text-slate-700 dark:text-slate-200">{targetedLessonObj?.subject_name}</span>
          </div>
          <div className="flex justify-between">
            <span className="font-semibold text-slate-400 dark:text-slate-500">Absent Teacher:</span>
            <span className="font-bold text-red-600 dark:text-red-400">{targetedLessonObj?.teacher_name}</span>
          </div>
        </div>

        <form onSubmit={commitDailyCoverOverride} className="p-6 space-y-4">

          {/* Leave Reason Selector Blockout — Built adaptive for direct sync with future teacher forms */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider">Absence Classification</label>
            <select
              value={leaveReason}
              onChange={(e) => setLeaveReason(e.target.value)}
              className="w-full border border-slate-300 dark:border-slate-600 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-amber-500 dark:focus:ring-amber-400 bg-white dark:bg-slate-800 font-medium text-slate-700 dark:text-slate-200"
            >
              <option value="Casual">Casual Leave</option>
              <option value="Sick">Medical / Sick Leave</option>
              <option value="Seminar">Official Duty / Ministry Seminar</option>
              <option value="Compassionate">Compassionate Leave</option>
            </select>
          </div>

          {/* Qualified Substitute Filtering Menu Option List */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider">Available Substitutes</label>
            {isLoading ? (
              <div className="w-full border border-slate-200 dark:border-slate-700 rounded-lg p-3 bg-slate-50 dark:bg-slate-800/40 flex items-center justify-center gap-2 text-xs font-medium text-slate-400 dark:text-slate-500">
                <Loader2 className="w-4 h-4 animate-spin text-amber-500 dark:text-amber-400" />
                <span>Running exclusion matrices...</span>
              </div>
            ) : substitutes.length === 0 ? (
              <div className="w-full border border-red-200 dark:border-red-500/40 rounded-lg p-3 bg-red-50 dark:bg-red-500/10 text-red-800 dark:text-red-400 flex items-center gap-2 text-xs font-medium">
                <AlertCircle className="w-4 h-4 text-red-500 dark:text-red-400 shrink-0" />
                <span>No conflict-free teachers found for this timeframe.</span>
              </div>
            ) : (
              <SearchableSelect
                value={selectedSubId}
                onChange={setSelectedSubId}
                placeholder="-- Select Free Roster Replacement --"
                searchPlaceholder="Search substitutes…"
                options={substitutes.map(staff => ({
                  value: staff.id.toString(),
                  label: staff.name,
                  sublabel: `[${staff.department} Dept]${staff.fatigue_warning ? ' ⚠ Fatigue Risk' : ''}`,
                }))}
              />
            )}
            {selectedSubId && substitutes.find(s => s.id.toString() === selectedSubId)?.fatigue_warning && (
              <div className="w-full border border-amber-200 dark:border-amber-500/40 rounded-lg p-2.5 bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-400 flex items-start gap-2 text-xs font-medium">
                <AlertCircle className="w-4 h-4 text-amber-500 dark:text-amber-400 shrink-0 mt-0.5" />
                <span>{substitutes.find(s => s.id.toString() === selectedSubId)?.fatigue_warning}</span>
              </div>
            )}
          </div>

          {/* Contextual Notes text input area */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider">Internal Logs & Context</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g., Sick check-in forwarded via early SMS, coverage confirmed."
              className="w-full border border-slate-300 dark:border-slate-600 rounded-lg p-3 text-xs outline-none focus:ring-2 focus:ring-amber-500 dark:focus:ring-amber-400 bg-white dark:bg-slate-800 font-medium text-slate-600 dark:text-slate-300 h-16 resize-none placeholder:text-slate-400 dark:placeholder:text-slate-500"
            />
          </div>

          <div className="bg-slate-50 dark:bg-slate-800/40 rounded-xl p-3 border border-slate-200 dark:border-slate-700 flex items-start gap-2.5 text-[11px] font-medium text-slate-500 dark:text-slate-400 leading-normal">
            <Info className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0 mt-0.5" />
            <p>
              This temporary replacement operates as an ad-hoc single-day layout overlay. Your structural master term template rows remain completely unaltered.
            </p>
          </div>

          {/* Modal Action Footer Controls */}
          <div className="pt-2 flex gap-3 border-t border-slate-100 dark:border-slate-700">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="flex-1 px-4 py-2.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 rounded-lg font-bold text-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving || !selectedSubId || isLoading}
              className="flex-1 px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-bold text-sm flex items-center justify-center gap-2 shadow-md dark:shadow-none shadow-amber-600/10 transition-colors disabled:opacity-50"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Securing...</span>
                </>
              ) : (
                <>
                  <UserCheck className="w-4 h-4" />
                  <span>Confirm Cover</span>
                </>
              )}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}