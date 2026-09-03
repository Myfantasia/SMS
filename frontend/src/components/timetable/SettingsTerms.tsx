import { useState } from 'react';
import { Save, CheckCircle2, Trash2, RefreshCw, EyeOff, Globe } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Timetable } from '../../libs/types';
import api from '../../libs/axiosInstance';

interface TermsProps {
  timetables: Timetable[];
  onRefreshTrigger: () => void;
  fetchSettingsData: () => void;
  confirmAction: (title: string, msg: string, onConfirm: () => void) => void;
}

export default function SettingsTerms({ timetables, onRefreshTrigger, fetchSettingsData, confirmAction }: TermsProps) {
  const [selectedTermId, setSelectedTermId] = useState<number | null>(null);
  const [termName, setTermName] = useState('');
  const [termStatus, setTermStatus] = useState('Draft');
  const [termIsActive, setTermIsActive] = useState(false);
  const [isUpdatingLifecycle, setIsUpdatingLifecycle] = useState(false);

  const handleSaveTerm = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.post('/api/timetable/manage-containers/', {
        id: selectedTermId, // Backend update hook if matching record exists
        name: termName,
        status: termStatus,
        is_active: termIsActive
      });
      
      const data = res.data;
      if (data.status === 'success') {
        toast.success(data.message);
        setTermName('');
        setSelectedTermId(null);
        fetchSettingsData();
        onRefreshTrigger();
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      console.error(error);
      toast.error("Error saving term container allocation.");
    }
  };

  // --- NEW: ATOMIC STATUS LIFECYCLE PATCH ROUTE EXECUTOR ---
  const handleLifecycleTransition = async (id: number, status: string, isActive: boolean, e: React.MouseEvent) => {
    e.stopPropagation(); // Avoid triggering form selection side-effects
    setIsUpdatingLifecycle(true);
    const loadingToast = toast.loading("Syncing structural container lifecycle changes...");
    
    try {
      const res = await api.post(`/api/timetable/update-status/${id}/`, {
        status: status,
        is_active: isActive
      });
      const data = res.data;
      
      if (data.status === 'success') {
        toast.success(data.message, { id: loadingToast });
        fetchSettingsData();
        onRefreshTrigger();
      } else {
        toast.error(data.message, { id: loadingToast });
      }
    } catch (err) {
      console.error("Lifecycle change processing error:", err);
      toast.error("Network communication failure tracking adjustments.", { id: loadingToast });
    } finally {
      setIsUpdatingLifecycle(false);
    }
  };

  const handleDeleteTerm = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    confirmAction("Delete Term Container", "This will permanently erase the container and all associated lessons. Are you sure?", async () => {
      try {
        const res = await api.delete('/api/timetable/manage-containers/', {
          data: { id }
        });
        const data = res.data;
        if (data.status === 'success') {
          toast.success(data.message);
          if (selectedTermId === id) {
            setTermName('');
            setSelectedTermId(null);
          }
          fetchSettingsData();
          onRefreshTrigger();
        }
      } catch (error) {
        console.error(error);
        toast.error("Error deleting.");
      }
    });
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
      
      {/* Creation/Adjustment Interface Panel */}
      <form onSubmit={handleSaveTerm} className="space-y-4 bg-slate-50 dark:bg-slate-800/40 p-5 rounded-xl border border-slate-200 dark:border-slate-700 h-fit">
        <div className="flex justify-between items-center border-b border-slate-200 dark:border-slate-700 pb-2">
          <h3 className="font-bold text-slate-800 dark:text-slate-100">{selectedTermId ? "Modify Container Core" : "Create Term Container"}</h3>
          {selectedTermId && (
            <button type="button" onClick={() => { setSelectedTermId(null); setTermName(''); setTermStatus('Draft'); setTermIsActive(false); }} className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline">Clear Fields</button>
          )}
        </div>
        <div>
          <label className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">Term Name</label>
          <input type="text" required value={termName} onChange={(e) => setTermName(e.target.value)} className="w-full mt-1 border border-slate-300 dark:border-slate-600 rounded-lg p-2.5 outline-none focus:border-blue-500 dark:focus:border-blue-400 bg-white dark:bg-slate-800 font-medium text-slate-800 dark:text-slate-100" placeholder="e.g., 2026 Term 2" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">Default Status</label>
            <select value={termStatus} onChange={(e) => setTermStatus(e.target.value)} className="w-full mt-1 border border-slate-300 dark:border-slate-600 rounded-lg p-2.5 outline-none bg-white dark:bg-slate-800 font-bold text-slate-700 dark:text-slate-200">
              <option value="Draft">Draft (Hidden)</option>
              <option value="Published">Published (Live)</option>
            </select>
          </div>
          <div className="flex flex-col justify-end pb-2">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={termIsActive} onChange={(e) => setTermIsActive(e.target.checked)} className="w-4 h-4 text-blue-600 rounded focus:ring-0" />
              <span className="text-sm font-bold text-slate-700 dark:text-slate-200">Set as Active</span>
            </label>
          </div>
        </div>
        <button type="submit" className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 flex justify-center items-center gap-2 transition-colors">
          <Save className="w-4 h-4" /> Save Term Container
        </button>
      </form>

      {/* Roster View Feed Ledger */}
      <div>
        <h3 className="font-bold text-slate-800 dark:text-slate-100 mb-4">Existing Terms</h3>
        <div className="space-y-3">
          {timetables.length === 0 && (
            <div className="text-center py-10 text-slate-400 dark:text-slate-500 text-sm bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-dashed border-slate-200 dark:border-slate-700">
              No term containers yet. Create one with the form on the left.
            </div>
          )}
          {timetables.map(t => (
            <div
              key={t.id}
              onClick={() => { setSelectedTermId(t.id); setTermName(t.name); setTermStatus(t.status || 'Draft'); setTermIsActive(t.is_active); }}
              className={`p-4 rounded-xl border flex flex-col gap-3 cursor-pointer transition ${selectedTermId === t.id ? 'border-blue-500 dark:border-blue-400 bg-blue-50/40 dark:bg-blue-500/10' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800/40'}`}
            >
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-black text-slate-800 dark:text-slate-100 tracking-tight text-base">{t.name}</p>
                  <div className="flex items-center gap-1.5 mt-1">
                    {t.status === 'Published' ? (
                      <span className="flex items-center text-[10px] font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/20 px-1.5 py-0.5 rounded-md"><Globe className="w-3 h-3 mr-1" /> PUBLISHED</span>
                    ) : (
                      <span className="flex items-center text-[10px] font-bold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-1.5 py-0.5 rounded-md"><EyeOff className="w-3 h-3 mr-1" /> DRAFT</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {t.is_active && (
                    <span className="flex items-center gap-1 text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-2 py-1 rounded-md border border-emerald-100 dark:border-emerald-500/20 shadow-sm dark:shadow-none animate-pulse">
                      <CheckCircle2 className="w-3.5 h-3.5" /> ACTIVE
                    </span>
                  )}
                  <button
                    onClick={(e) => handleDeleteTerm(t.id, e)}
                    disabled={isUpdatingLifecycle}
                    title="Delete term"
                    aria-label={`Delete ${t.name}`}
                    className="text-slate-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-2 transition shadow-sm dark:shadow-none hover:border-red-200 dark:hover:border-red-500/40"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* --- NEW: FAST LIFECYCLE CONTROLS STRIP --- */}
              <div className="flex gap-2 border-t border-slate-100 dark:border-slate-700 pt-3 mt-1 justify-end">
                <button
                  type="button"
                  disabled={isUpdatingLifecycle}
                  onClick={(e) => {
                    e.stopPropagation();
                    const goingLive = t.status !== 'Published';
                    confirmAction(
                      goingLive ? 'Publish This Term?' : 'Revert to Draft?',
                      goingLive
                        ? `"${t.name}" will become visible to teachers, students, and parents immediately.`
                        : `"${t.name}" will be hidden from everyone except admins.`,
                      () => handleLifecycleTransition(t.id, goingLive ? 'Published' : 'Draft', t.is_active, e)
                    );
                  }}
                  className="px-2.5 py-1 text-[11px] font-bold border border-slate-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-1 transition"
                >
                  <RefreshCw className="w-3 h-3" /> {t.status === 'Published' ? 'Revert to Draft' : 'Publish'}
                </button>
                {!t.is_active && (
                  <button
                    type="button"
                    disabled={isUpdatingLifecycle}
                    onClick={(e) => {
                      e.stopPropagation();
                      confirmAction(
                        'Set as the Active Term?',
                        `"${t.name}" will become the school-wide active timetable, replacing whichever term is active now.`,
                        () => handleLifecycleTransition(t.id, t.status || 'Draft', true, e)
                      );
                    }}
                    className="px-2.5 py-1 text-[11px] font-bold bg-emerald-600 text-white rounded-md hover:bg-emerald-700 flex items-center gap-1 transition"
                  >
                    <CheckCircle2 className="w-3 h-3" /> Mount Active
                  </button>
                )}
              </div>

            </div>
          ))}
        </div>
      </div>
    </div>
  );
}