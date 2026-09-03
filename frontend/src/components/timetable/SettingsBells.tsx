import { useState } from 'react';
import { Save, Edit, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import type { TimeSlot } from '../../libs/types';
import api from '../../libs/axiosInstance';


interface BellsProps {
  slots: TimeSlot[];
  onRefreshTrigger: () => void;
  fetchSettingsData: () => void;
  confirmAction: (title: string, msg: string, onConfirm: () => void) => void;
}

export default function SettingsBells({ slots, onRefreshTrigger, fetchSettingsData, confirmAction }: BellsProps) {
  const [editSlotId, setEditSlotId] = useState<number | null>(null);
  const [slotDay, setSlotDay] = useState('Monday');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [slotType, setSlotType] = useState('academic');
  const [globalLabel, setGlobalLabel] = useState('');
  const [selectedFilterDay, setSelectedFilterDay] = useState('Monday');

  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  const handleEditSlot = (slot: TimeSlot) => {
    setEditSlotId(slot.id); setSlotDay(slot.day); setStartTime(slot.start_time.substring(0, 5)); setEndTime(slot.end_time.substring(0, 5)); setGlobalLabel(slot.global_label || '');
    if (slot.is_global) setSlotType('global'); else if (slot.is_remedial) setSlotType('remedial'); else setSlotType('academic');
  };

  const handleSaveSlot = async (e: React.FormEvent) => {
  e.preventDefault();
  try {
    // Axios eliminates the need for manual header construction and JSON stringification
    const res = await api.post('/api/timetable/manage-slots/', {
      id: editSlotId,
      day: slotDay,
      start_time: startTime,
      end_time: endTime,
      is_global: slotType === 'global',
      is_remedial: slotType === 'remedial',
      global_label: slotType === 'global' ? globalLabel : ''
    });
    
    const data = res.data;
    if (data.status === 'success') {
      toast.success(data.message);
      setEditSlotId(null);
      setStartTime('');
      setEndTime('');
      setSelectedFilterDay(slotDay);
      fetchSettingsData();
      onRefreshTrigger();
    } else {
      toast.error(data.message);
    }
  } catch (error) {
    console.error("Error saving slot:", error);
    toast.error("Error saving.");
  }
};

  const handleDeleteSlot = (id: number) => {
  confirmAction("Delete Time Slot", "Remove this time slot permanently?", async () => {
    try {
      // CRITICAL AXIOS PATTERN: Payload objects for DELETE requests must be explicitly nested inside a config 'data' block
      const res = await api.delete('/api/timetable/manage-slots/', {
        data: { id }
      });
      const data = res.data;
      if (data.status === 'success') {
        toast.success(data.message);
        fetchSettingsData();
        onRefreshTrigger();
      }
    } catch (error) {
      console.error("Error deleting slot:", error);
      toast.error("Error deleting.");
    }
  });
};

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <form onSubmit={handleSaveSlot} className="lg:col-span-1 space-y-4 bg-slate-50 dark:bg-slate-800/40 p-5 rounded-xl border border-slate-200 dark:border-slate-700 sticky top-4 h-fit">
        <div className="flex justify-between items-center border-b border-slate-200 dark:border-slate-700 pb-2">
          <h3 className="font-bold text-slate-800 dark:text-slate-100">{editSlotId ? 'Edit Time Slot' : 'Add Time Slot'}</h3>
          {editSlotId && <button type="button" onClick={() => setEditSlotId(null)} className="text-xs font-bold text-red-500 dark:text-red-400">Cancel</button>}
        </div>
        <div>
          <label className="text-xs font-bold text-slate-600 dark:text-slate-300">Day</label>
          <select value={slotDay} onChange={(e) => setSlotDay(e.target.value)} className="w-full mt-1 border border-slate-300 dark:border-slate-600 rounded-lg p-2.5 outline-none bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100">
            {days.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-bold text-slate-600 dark:text-slate-300">Start</label>
            <input type="time" required value={startTime} onChange={(e) => setStartTime(e.target.value)} className="w-full mt-1 border border-slate-300 dark:border-slate-600 rounded-lg p-2.5 outline-none bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100" />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 dark:text-slate-300">End</label>
            <input type="time" required value={endTime} onChange={(e) => setEndTime(e.target.value)} className="w-full mt-1 border border-slate-300 dark:border-slate-600 rounded-lg p-2.5 outline-none bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100" />
          </div>
        </div>
        <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
          <label className="text-xs font-bold text-slate-600 dark:text-slate-300 block mb-1">Type</label>
          <select value={slotType} onChange={(e) => setSlotType(e.target.value)} className="w-full border border-slate-300 dark:border-slate-600 rounded-lg p-2.5 outline-none bg-white dark:bg-slate-800 text-sm text-slate-800 dark:text-slate-100">
            <option value="academic">Academic</option><option value="remedial">Remedial/Prep</option><option value="global">Global Event</option>
          </select>
          {slotType === 'global' && (
            <input type="text" required value={globalLabel} onChange={(e) => setGlobalLabel(e.target.value)} placeholder="e.g., Lunch Break" className="w-full mt-3 border border-slate-300 dark:border-slate-600 rounded-lg p-2.5 outline-none bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500" />
          )}
        </div>
        <button type="submit" className={`w-full py-2.5 text-white rounded-lg font-bold flex justify-center items-center gap-2 ${editSlotId ? 'bg-emerald-600' : 'bg-blue-600'}`}>
          <Save className="w-4 h-4" /> {editSlotId ? 'Update Slot' : 'Add to Grid'}
        </button>
      </form>
      <div className="lg:col-span-2">
        <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg overflow-x-auto mb-4">
          {days.map(day => (
            <button key={day} onClick={() => setSelectedFilterDay(day)} className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${selectedFilterDay === day ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-sm dark:shadow-none' : 'text-slate-500 dark:text-slate-400'}`}>{day.substring(0, 3).toUpperCase()}</button>
          ))}
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden shadow-sm dark:shadow-none">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 dark:bg-slate-800/40 text-slate-600 dark:text-slate-300 font-bold uppercase text-xs border-b border-slate-200 dark:border-slate-700">
              <tr><th className="px-4 py-3">Time</th><th className="px-4 py-3">Type</th><th className="px-4 py-3 text-right">Actions</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {slots.filter(s => s.day === selectedFilterDay).length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-slate-400 dark:text-slate-500 text-sm">No slots configured for {selectedFilterDay} yet.</td>
                </tr>
              ) : (
                slots.filter(s => s.day === selectedFilterDay).map(s => (
                  <tr key={s.id} className="hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100">
                    <td className="px-4 py-3 font-bold">{s.start_time.substring(0,5)} - {s.end_time.substring(0,5)}</td>
                    <td className="px-4 py-3">
                      {s.is_global ? <span className="bg-amber-100 dark:bg-amber-500/10 text-amber-800 dark:text-amber-400 px-2 py-1 rounded text-xs font-bold">{s.global_label}</span> :
                       s.is_remedial ? <span className="bg-purple-100 dark:bg-purple-500/10 text-purple-800 dark:text-purple-400 px-2 py-1 rounded text-xs font-bold">Remedial</span> :
                       <span className="bg-blue-100 dark:bg-blue-500/10 text-blue-800 dark:text-blue-400 px-2 py-1 rounded text-xs font-bold">Academic</span>}
                    </td>
                    <td className="px-4 py-3 text-right flex justify-end gap-2">
                      <button onClick={() => handleEditSlot(s)} title="Edit slot" aria-label={`Edit ${s.start_time.substring(0,5)}-${s.end_time.substring(0,5)} slot`} className="text-blue-600 dark:text-blue-400 p-1.5 bg-blue-50 dark:bg-blue-500/10 rounded-md hover:bg-blue-100 dark:hover:bg-blue-500/20 transition-colors"><Edit className="w-4 h-4" /></button>
                      <button onClick={() => handleDeleteSlot(s.id)} title="Delete slot" aria-label={`Delete ${s.start_time.substring(0,5)}-${s.end_time.substring(0,5)} slot`} className="text-red-500 dark:text-red-400 p-1.5 bg-red-50 dark:bg-red-500/10 rounded-md hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors"><Trash2 className="w-4 h-4" /></button>
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