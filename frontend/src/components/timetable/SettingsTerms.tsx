import { useState } from 'react';
import { Save, CheckCircle2, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Timetable } from '../../libs/types';


interface TermsProps {
  timetables: Timetable[];
  onRefreshTrigger: () => void;
  fetchSettingsData: () => void;
  confirmAction: (title: string, msg: string, onConfirm: () => void) => void;
}

export default function SettingsTerms({ timetables, onRefreshTrigger, fetchSettingsData, confirmAction }: TermsProps) {
  const [termName, setTermName] = useState('');
  const [termStatus, setTermStatus] = useState('Draft');
  const [termIsActive, setTermIsActive] = useState(false);

  const handleSaveTerm = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('http://localhost:8000/api/timetable/manage-containers/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: termName, status: termStatus, is_active: termIsActive })
      });
      const data = await res.json();
      if (data.status === 'success') {
        toast.success(data.message);
        setTermName(''); fetchSettingsData(); onRefreshTrigger();
      } else toast.error(data.message);
    } catch (e) { toast.error("Error saving term."); }
  };

  const handleDeleteTerm = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    confirmAction("Delete Term Container", "This will permanently erase the container and all associated lessons. Are you sure?", async () => {
      try {
        const res = await fetch('http://localhost:8000/api/timetable/manage-containers/', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
        const data = await res.json();
        if (data.status === 'success') { toast.success(data.message); fetchSettingsData(); onRefreshTrigger(); }
      } catch (e) { toast.error("Error deleting."); }
    });
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
      <form onSubmit={handleSaveTerm} className="space-y-4 bg-slate-50 p-5 rounded-xl border border-slate-200">
        <h3 className="font-bold text-slate-800 border-b border-slate-200 pb-2">Create / Edit Term</h3>
        <div>
          <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Term Name</label>
          <input type="text" required value={termName} onChange={(e) => setTermName(e.target.value)} className="w-full mt-1 border border-slate-300 rounded-lg p-2.5 outline-none focus:border-blue-500 bg-white" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Status</label>
            <select value={termStatus} onChange={(e) => setTermStatus(e.target.value)} className="w-full mt-1 border border-slate-300 rounded-lg p-2.5 outline-none bg-white">
              <option value="Draft">Draft (Hidden)</option>
              <option value="Published">Published (Live)</option>
            </select>
          </div>
          <div className="flex flex-col justify-end pb-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={termIsActive} onChange={(e) => setTermIsActive(e.target.checked)} className="w-4 h-4 text-blue-600 rounded" />
              <span className="text-sm font-bold text-slate-700">Set as Active Term</span>
            </label>
          </div>
        </div>
        <button type="submit" className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 flex justify-center items-center gap-2"><Save className="w-4 h-4" /> Save Term Container</button>
      </form>
      <div>
        <h3 className="font-bold text-slate-800 mb-4">Existing Terms</h3>
        <div className="space-y-3">
          {timetables.map(t => (
            <div key={t.id} onClick={() => { setTermName(t.name); setTermStatus(t.status || 'Draft'); setTermIsActive(t.is_active); }} className="p-4 rounded-xl border border-slate-200 flex justify-between items-center cursor-pointer hover:border-blue-300 hover:bg-blue-50 transition">
              <div>
                <p className="font-bold text-slate-800">{t.name}</p>
                <p className="text-xs text-slate-500 mt-0.5">{t.status}</p>
              </div>
              <div className="flex items-center gap-3">
                {t.is_active && <span className="flex items-center gap-1 text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-md border border-emerald-100"><CheckCircle2 className="w-3.5 h-3.5" /> ACTIVE</span>}
                <button onClick={(e) => handleDeleteTerm(t.id, e)} className="text-red-500 hover:text-red-700 bg-white hover:bg-red-50 p-1.5 rounded-md transition-colors border border-slate-200 hover:border-red-200 shadow-sm"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}