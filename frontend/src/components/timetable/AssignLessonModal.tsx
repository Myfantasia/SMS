import { X, Save, CalendarPlus } from 'lucide-react';
import type { Bucket, Teacher } from '../../libs/types';
import SearchableSelect from '../common/SearchableSelect';

interface AssignProps {
  setActiveSlotId: (id: number | null) => void;
  buckets: Bucket[];
  teachers: Teacher[];
  selectedSubject: string;
  setSelectedSubject: (val: string) => void;
  selectedTeacher: string;
  setSelectedTeacher: (val: string) => void;
  isDoublePeriod: boolean;
  setIsDoublePeriod: (val: boolean) => void;
  handleSaveLesson: (e: React.FormEvent) => void;
  isSaving: boolean;
}

export default function AssignLessonModal({
  setActiveSlotId, buckets, teachers, selectedSubject, setSelectedSubject,
  selectedTeacher, setSelectedTeacher, isDoublePeriod, setIsDoublePeriod,
  handleSaveLesson, isSaving
}: AssignProps) {
  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-fade-in">
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-50 text-blue-600"><CalendarPlus className="w-5 h-5" /></div>
            <h3 className="font-bold text-lg text-slate-800">Assign Lesson</h3>
          </div>
          <button onClick={() => setActiveSlotId(null)} title="Close" aria-label="Close" className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSaveLesson} className="p-6 space-y-5">
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">Select Subject from Bucket</label>
            <SearchableSelect
              name="lessonSubject"
              required
              aria-label="Select Subject from Bucket"
              value={selectedSubject}
              onChange={setSelectedSubject}
              placeholder="-- Choose Subject --"
              searchPlaceholder="Search subjects…"
              options={buckets.filter(b => b.remaining > 0).map(b => ({ value: b.subject_id.toString(), label: `${b.subject_name} (${b.remaining} left)` }))}
            />
          </div>
          
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">Assign Teacher</label>
            <SearchableSelect
              value={selectedTeacher}
              onChange={setSelectedTeacher}
              disabled={!selectedSubject || teachers.length === 0}
              placeholder={selectedSubject ? (teachers.length > 0 ? '-- Choose Teacher --' : 'No qualified teachers found') : '-- Select a subject first --'}
              searchPlaceholder="Search teachers…"
              options={teachers.map(t => {
                const hasLoadData = t.current_load !== undefined && t.max_weekly_lessons !== undefined;
                return {
                  value: t.id.toString(),
                  label: t.name,
                  sublabel: hasLoadData ? `${t.current_load}/${t.max_weekly_lessons} periods` : undefined,
                };
              })}
            />
          </div>
          
          <label className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-100 transition">
            <input type="checkbox" checked={isDoublePeriod} onChange={(e) => setIsDoublePeriod(e.target.checked)} className="w-5 h-5 text-blue-600 rounded" />
            <span className="font-medium text-slate-700 text-sm">This is a Double Period (80 mins)</span>
          </label>
          <div className="pt-2 flex gap-3">
            <button type="button" onClick={() => setActiveSlotId(null)} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 rounded-lg font-bold hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={isSaving || !selectedTeacher} className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 flex items-center justify-center gap-2 disabled:opacity-70">
              <Save className="w-4 h-4" /> {isSaving ? 'Checking...' : 'Lock Lesson'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}