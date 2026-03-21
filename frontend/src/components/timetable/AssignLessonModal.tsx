import { X, Save } from 'lucide-react';
import type { Bucket, Teacher } from '../../libs/types';

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
          <h3 className="font-bold text-lg text-slate-800">Assign Lesson</h3>
          <button onClick={() => setActiveSlotId(null)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSaveLesson} className="p-6 space-y-5">
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">Select Subject from Bucket</label>
            <select required value={selectedSubject} onChange={(e) => setSelectedSubject(e.target.value)} className="w-full border border-slate-300 rounded-lg p-3 outline-none focus:ring-2 focus:ring-blue-500 bg-white">
              <option value="">-- Choose Subject --</option>
              {buckets.filter(b => b.remaining > 0).map(b => (
                <option key={b.subject_id} value={b.subject_id.toString()}>{b.subject_name} ({b.remaining} left)</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">Assign Teacher</label>
            <select required value={selectedTeacher} onChange={(e) => setSelectedTeacher(e.target.value)} className="w-full border border-slate-300 rounded-lg p-3 outline-none focus:ring-2 focus:ring-blue-500 bg-white" disabled={!selectedSubject || teachers.length === 0}>
              <option value="">{selectedSubject ? (teachers.length > 0 ? '-- Choose Teacher --' : 'No qualified teachers found') : '-- Select a subject first --'}</option>
              {teachers.map(t => <option key={t.id} value={t.id.toString()}>{t.name}</option>)}
            </select>
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