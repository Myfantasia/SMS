import { useState, useMemo } from 'react';
import { Save, Edit, Trash2, BookOpen } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Grade, Quota, Subject } from '../../libs/types';
import api from '../../libs/axiosInstance';
import SearchableSelect from '../common/SearchableSelect';

interface QuotasProps {
  grades: Grade[];
  subjects: Subject[];
  quotas: Quota[];
  daytimeCapacity: number;
  onRefreshTrigger: () => void;
  fetchSettingsData: () => void;
  confirmAction: (title: string, msg: string, onConfirm: () => void) => void;
}

export default function SettingsQuotas({ grades, subjects, quotas, daytimeCapacity, onRefreshTrigger, fetchSettingsData, confirmAction }: QuotasProps) {
  const [quotaGrade, setQuotaGrade] = useState('');
  const [quotaSubject, setQuotaSubject] = useState('');
  const [quotaTotal, setQuotaTotal] = useState(5);
  const [quotaDouble, setQuotaDouble] = useState(0);
  const [quotaRemedial, setQuotaRemedial] = useState(1);

  // Periods used per grade, deduping subjects that share a SubjectBlock (they occupy the
  // same slot across the grade, so they only cost the week's capacity once, not once each) —
  // mirrors the same accounting the backend's auto-generator uses. Block ids are already
  // grade-scoped on each quota row (the same subject can sit in a different block per grade).
  const capacityByGrade = useMemo(() => {
    const seenBlocks = new Map<number, Set<number>>();
    const totals = new Map<number, number>();
    for (const q of quotas) {
      const bid = q.subject_block_id;
      if (bid) {
        const seen = seenBlocks.get(q.grade_id) ?? new Set<number>();
        if (seen.has(bid)) continue;
        seen.add(bid);
        seenBlocks.set(q.grade_id, seen);
      }
      totals.set(q.grade_id, (totals.get(q.grade_id) ?? 0) + q.total_lessons);
    }
    return totals;
  }, [quotas]);

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
      const res = await api.post('/api/timetable/manage-quotas/', {
        grade_id: quotaGrade,
        subject_id: quotaSubject,
        total_lessons: quotaTotal,
        double_lessons_required: quotaDouble,
        remedial_lessons_required: quotaRemedial
      });
      
      const data = res.data;
      if (data.status === 'success') {
        toast.success(data.message);
        fetchSettingsData();
        onRefreshTrigger();
      }
    } catch (error) {
      console.error("Error saving quota matrix:", error);
      toast.error("Failed to commit allocation requirements.");
    }
  };

  const handleDeleteQuota = (id: number) => {
    confirmAction("Delete Rule", "Are you sure you want to delete this rule?", async () => {
      try {
        const res = await api.delete('/api/timetable/manage-quotas/', {
          data: { id }
        });
        const data = res.data;
        if (data.status === 'success') {
          toast.success(data.message);
          fetchSettingsData();
          onRefreshTrigger();
        }
      } catch (error) {
        console.error("Error deleting quota rule:", error);
        toast.error("Error deleting requested resource.");
      }
    });
  };

  const handleMoEAutoGenerate = async () => {
    const loadingToast = toast.loading("Applying Kenyan MoE Curriculum Rules...");
    try {
      const res = await api.post('/api/timetable/auto-generate-quotas/');
      const data = res.data;
      
      if (data.status === 'success') {
        toast.success(data.message, { id: loadingToast });
        fetchSettingsData();
        onRefreshTrigger();
      } else {
        toast.error(data.message, { id: loadingToast });
      }
    } catch (error) {
      console.error("Error auto-generating quotas:", error);  
      toast.error("Failed to reach the validation server.", { id: loadingToast });
    }
  };

  const handleClearQuotas = () => {
    confirmAction("Clear All Quotas", "DANGER: This will delete ALL subject quotas. Are you sure?", async () => {
      const loadingToast = toast.loading("Clearing system rules ledger...");
      try {
        const res = await api.delete('/api/timetable/clear-quotas/');
        const data = res.data;
        if (data.status === 'success') {
          toast.success(data.message, { id: loadingToast });
          fetchSettingsData();
          onRefreshTrigger();
        } else {
          toast.error(data.message, { id: loadingToast });
        }
      } catch (error) { 
        console.error("Error clearing quotas:", error);
        toast.error("Error clearing current allocations rules.", { id: loadingToast }); 
      }
    });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      
      {/* Target Allocation Rule Assigning Input Form Sheet */}
      <form onSubmit={handleSaveQuota} className="lg:col-span-1 space-y-4 bg-slate-50 dark:bg-slate-800/40 p-5 rounded-xl border border-slate-200 dark:border-slate-700 sticky top-4 h-fit">
        <h3 className="font-bold text-slate-800 dark:text-slate-100 border-b border-slate-200 dark:border-slate-700 pb-2">Assign Lesson Rule</h3>
        <select required value={quotaGrade} onChange={(e) => setQuotaGrade(e.target.value)} className="w-full border border-slate-300 dark:border-slate-600 rounded-lg p-2.5 bg-white dark:bg-slate-800 font-medium text-slate-700 dark:text-slate-200"><option value="">-- Choose Grade --</option>{grades.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
        <SearchableSelect name="quotaSubject" required aria-label="Choose Subject" value={quotaSubject} onChange={setQuotaSubject} placeholder="-- Choose Subject --" searchPlaceholder="Search subjects…" options={subjects.map(s => ({ value: String(s.id), label: s.name }))} />

        <div className="grid grid-cols-3 gap-3">
          <div><label className="text-xs font-bold text-slate-600 dark:text-slate-300">Total</label><input type="number" min="1" required value={quotaTotal} onChange={(e) => setQuotaTotal(parseInt(e.target.value))} className="w-full border border-slate-300 dark:border-slate-600 rounded-lg p-2.5 text-center font-bold" /></div>
          <div><label className="text-[10px] font-bold text-slate-600 dark:text-slate-300">Doubles</label><input type="number" min="0" required value={quotaDouble} onChange={(e) => setQuotaDouble(parseInt(e.target.value))} className="w-full border border-slate-300 dark:border-slate-600 rounded-lg p-2.5 text-center font-bold" /></div>
          <div><label className="text-[10px] font-bold text-slate-600 dark:text-slate-300">Remedial</label><input type="number" min="0" required value={quotaRemedial} onChange={(e) => setQuotaRemedial(parseInt(e.target.value))} className="w-full border border-slate-300 dark:border-slate-600 rounded-lg p-2.5 text-center font-bold text-purple-600 dark:text-purple-400" /></div>
        </div>
        
        <button type="submit" className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold transition-colors flex items-center justify-center gap-2">
          <Save className="w-4 h-4" /> Save Rule
        </button>
      </form>

      {/* Data Ledger View */}
      <div className="lg:col-span-2 flex flex-col gap-4">
        {daytimeCapacity > 0 && grades.length > 0 && (
          <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-2">
            <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Weekly Capacity Usage ({daytimeCapacity} periods/week)</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {grades.map(g => {
                const used = capacityByGrade.get(g.id) ?? 0;
                const pct = Math.min(100, (used / daytimeCapacity) * 100);
                const isSelected = quotaGrade === g.id.toString();
                const color = used > daytimeCapacity ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-emerald-500';
                return (
                  <div key={g.id} className={`p-2 rounded-lg border ${isSelected ? 'border-indigo-300 dark:border-indigo-500/40 bg-indigo-50 dark:bg-indigo-500/10' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'}`}>
                    <div className="flex justify-between text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                      <span className="truncate">{g.name}</span>
                      <span className={used > daytimeCapacity ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'}>{used}/{daytimeCapacity}</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3 flex-wrap">
          <button
            type="button"
            onClick={handleClearQuotas}
            className="flex items-center gap-2 px-4 py-2 bg-red-50 dark:bg-red-500/10 hover:bg-red-100 dark:hover:bg-red-500/20 text-red-600 dark:text-red-400 rounded-lg text-sm font-bold shadow-sm dark:shadow-none transition-colors border border-red-200 dark:border-red-500/40"
          >
            <Trash2 className="w-4 h-4" /> Reset Quotas
          </button>

          <button
            type="button"
            onClick={handleMoEAutoGenerate}
            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-bold shadow-sm dark:shadow-none transition-colors"
          >
            <BookOpen className="w-4 h-4" /> Auto-Fill Subject Quotas
          </button>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden shadow-sm dark:shadow-none">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 dark:bg-slate-800/40 text-slate-600 dark:text-slate-300 font-bold uppercase text-xs border-b border-slate-200 dark:border-slate-700">
              <tr><th className="px-4 py-3">Grade</th><th className="px-4 py-3">Subject</th><th className="px-4 py-3 text-center">Lessons</th><th className="px-4 py-3 text-center">Action</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {quotas.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-400 dark:text-slate-500 text-sm">No subject quotas configured yet.</td>
                </tr>
              ) : (
                quotas.map(q => (
                  <tr key={q.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40 transition-colors">
                    <td className="px-4 py-3 font-bold text-slate-700 dark:text-slate-200">{q.grade__name}</td>
                    <td className="px-4 py-3 font-bold text-indigo-700 dark:text-indigo-400">{q.subject__name}</td>
                    <td className="px-4 py-3 text-center"><span className="font-black text-slate-800 dark:text-slate-100">{q.total_lessons}</span></td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex justify-center gap-2">
                        <button onClick={() => handleEditQuota(q)} title="Edit quota" aria-label={`Edit ${q.subject__name} quota for ${q.grade__name}`} className="text-blue-500 dark:text-blue-400 p-1.5 bg-blue-50 dark:bg-blue-500/10 rounded hover:bg-blue-100 dark:hover:bg-blue-500/20 transition-colors"><Edit className="w-4 h-4" /></button>
                        <button onClick={() => handleDeleteQuota(q.id)} title="Delete quota" aria-label={`Delete ${q.subject__name} quota for ${q.grade__name}`} className="text-red-500 dark:text-red-400 p-1.5 bg-red-50 dark:bg-red-500/10 rounded hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}