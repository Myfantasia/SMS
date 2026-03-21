import { useState } from 'react';
import { Save, Edit, Trash2, BookOpen } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Grade, Quota, Subject } from '../../libs/types';

interface QuotasProps {
  grades: Grade[];
  subjects: Subject[];
  quotas: Quota[];
  onRefreshTrigger: () => void;
  fetchSettingsData: () => void;
  confirmAction: (title: string, msg: string, onConfirm: () => void) => void;
}

export default function SettingsQuotas({ grades, subjects, quotas, onRefreshTrigger, fetchSettingsData, confirmAction }: QuotasProps) {
  const [quotaGrade, setQuotaGrade] = useState('');
  const [quotaSubject, setQuotaSubject] = useState('');
  const [quotaTotal, setQuotaTotal] = useState(5);
  const [quotaDouble, setQuotaDouble] = useState(0);
  const [quotaRemedial, setQuotaRemedial] = useState(1);

  const handleEditQuota = (q: Quota) => {
    setQuotaGrade(q.grade_id.toString()); 
    setQuotaSubject(q.subject_id.toString()); 
    setQuotaTotal(q.total_lessons); 
    setQuotaDouble(q.double_lessons_required); 
    setQuotaRemedial(q.remedial_lessons_required);
  };

  const handleSaveQuota = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('http://localhost:8000/api/timetable/manage-quotas/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grade_id: quotaGrade, subject_id: quotaSubject, total_lessons: quotaTotal, double_lessons_required: quotaDouble, remedial_lessons_required: quotaRemedial })
      });
      const data = await res.json();
      if (data.status === 'success') { toast.success(data.message); fetchSettingsData(); onRefreshTrigger(); }
    } catch (e) { toast.error("Error saving."); }
  };

  const handleDeleteQuota = (id: number) => {
    confirmAction("Delete Rule", "Are you sure you want to delete this rule?", async () => {
      try {
        const res = await fetch('http://localhost:8000/api/timetable/manage-quotas/', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
        const data = await res.json();
        if (data.status === 'success') { toast.success(data.message); fetchSettingsData(); onRefreshTrigger(); }
      } catch (e) { toast.error("Error deleting."); }
    });
  };

  // --- EXISTING: MoE Auto-Generate Function ---
  const handleMoEAutoGenerate = async () => {
    const loadingToast = toast.loading("Applying Kenyan MoE Curriculum Rules...");
    try {
      const res = await fetch('http://localhost:8000/api/timetable/auto-generate-quotas/', {
        method: 'POST'
      });
      const data = await res.json();
      
      if (data.status === 'success') {
        toast.success(data.message, { id: loadingToast });
        fetchSettingsData();
        onRefreshTrigger();
      } else {
        toast.error(data.message, { id: loadingToast });
      }
    } catch (error) {
      toast.error("Failed to reach the server.", { id: loadingToast });
    }
  };

  // --- NEW: Clear Quotas Function ---
  const handleClearQuotas = () => {
    confirmAction("Clear All Quotas", "DANGER: This will delete ALL subject quotas. Are you sure?", async () => {
      const loadingToast = toast.loading("Clearing quotas...");
      try {
        const res = await fetch('http://localhost:8000/api/timetable/clear-quotas/', { method: 'DELETE' });
        const data = await res.json();
        if (data.status === 'success') {
          toast.success(data.message, { id: loadingToast });
          fetchSettingsData();
          onRefreshTrigger();
        } else {
          toast.error(data.message, { id: loadingToast });
        }
      } catch (e) { 
        toast.error("Error clearing quotas.", { id: loadingToast }); 
      }
    });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <form onSubmit={handleSaveQuota} className="lg:col-span-1 space-y-4 bg-slate-50 p-5 rounded-xl border border-slate-200 sticky top-4 h-fit">
        <h3 className="font-bold text-slate-800 border-b border-slate-200 pb-2">Assign Lesson Rule</h3>
        <select required value={quotaGrade} onChange={(e) => setQuotaGrade(e.target.value)} className="w-full border border-slate-300 rounded-lg p-2.5 bg-white"><option value="">-- Choose Grade --</option>{grades.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
        <select required value={quotaSubject} onChange={(e) => setQuotaSubject(e.target.value)} className="w-full border border-slate-300 rounded-lg p-2.5 bg-white"><option value="">-- Choose Subject --</option>{subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <div className="grid grid-cols-3 gap-3">
          <div><label className="text-xs font-bold text-slate-600">Total</label><input type="number" min="1" required value={quotaTotal} onChange={(e) => setQuotaTotal(parseInt(e.target.value))} className="w-full border border-slate-300 rounded-lg p-2.5 text-center" /></div>
          <div><label className="text-[10px] font-bold text-slate-600">Doubles</label><input type="number" min="0" required value={quotaDouble} onChange={(e) => setQuotaDouble(parseInt(e.target.value))} className="w-full border border-slate-300 rounded-lg p-2.5 text-center" /></div>
          <div><label className="text-[10px] font-bold text-slate-600">Remedial</label><input type="number" min="0" required value={quotaRemedial} onChange={(e) => setQuotaRemedial(parseInt(e.target.value))} className="w-full border border-slate-300 rounded-lg p-2.5 text-center text-purple-600" /></div>
        </div>
        <button type="submit" className="w-full py-2.5 bg-indigo-600 text-white rounded-lg font-bold"><Save className="w-4 h-4 inline" /> Save Rule</button>
      </form>

      <div className="lg:col-span-2 flex flex-col gap-4">
        {/* --- UPDATED: Action Buttons Container --- */}
        <div className="flex justify-end gap-3 flex-wrap">
          <button 
            type="button" 
            onClick={handleClearQuotas} 
            className="flex items-center gap-2 px-4 py-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg text-sm font-bold shadow-sm transition-colors border border-red-200"
          >
            <Trash2 className="w-4 h-4" /> Reset Quotas
          </button>
          
          <button 
            type="button" 
            onClick={handleMoEAutoGenerate} 
            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-bold shadow-sm transition-colors"
          >
            <BookOpen className="w-4 h-4" /> Auto-Fill Subject Quotas
          </button>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 text-slate-600 font-bold uppercase text-xs border-b border-slate-200">
              <tr><th className="px-4 py-3">Grade</th><th className="px-4 py-3">Subject</th><th className="px-4 py-3 text-center">Lessons</th><th className="px-4 py-3 text-center">Action</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {quotas.map(q => (
                <tr key={q.id}>
                  <td className="px-4 py-3 font-bold">{q.grade__name}</td>
                  <td className="px-4 py-3 font-bold text-indigo-700">{q.subject__name}</td>
                  <td className="px-4 py-3 text-center"><span className="font-black">{q.total_lessons}</span></td>
                  <td className="px-4 py-3 text-center flex justify-center gap-2">
                    <button onClick={() => handleEditQuota(q)} className="text-blue-500 p-1 bg-blue-50 rounded"><Edit className="w-4 h-4" /></button>
                    <button onClick={() => handleDeleteQuota(q.id)} className="text-red-500 p-1 bg-red-50 rounded"><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}