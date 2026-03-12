import { useState, useEffect } from 'react';
import { X, CalendarPlus, Clock, Save, Trash2, CheckCircle2, BookOpen, Edit, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';

interface TimetableSettingsProps {
  onClose: () => void;
  onRefreshTrigger: () => void;
}

interface Timetable { id: number; name: string; status: string; is_active: boolean; }
interface TimeSlot { id: number; day: string; start_time: string; end_time: string; is_global: boolean; global_label: string; }
interface Grade { id: number; name: string; }
interface Subject { id: number; name: string; }
interface Quota { id: number; grade_id: number; grade__name: string; subject_id: number; subject__name: string; total_lessons: number; double_lessons_required: number; }

export default function TimetableSettings({ onClose, onRefreshTrigger }: TimetableSettingsProps) {
  const [activeTab, setActiveTab] = useState<'terms' | 'bells' | 'quotas'>('terms');
  
  // Data States
  const [timetables, setTimetables] = useState<Timetable[]>([]);
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [quotas, setQuotas] = useState<Quota[]>([]);
  
  // Form States - Term
  const [termName, setTermName] = useState('');
  const [termStatus, setTermStatus] = useState('Draft');
  const [termIsActive, setTermIsActive] = useState(false);

  // Form States - Bell Schedule 
  const [editSlotId, setEditSlotId] = useState<number | null>(null);
  const [slotDay, setSlotDay] = useState('Monday');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [isGlobal, setIsGlobal] = useState(false);
  const [globalLabel, setGlobalLabel] = useState('');
  
  // State for the Daily Filter Tabs
  const [selectedFilterDay, setSelectedFilterDay] = useState('Monday');

  // Form States - Quotas
  const [quotaGrade, setQuotaGrade] = useState('');
  const [quotaSubject, setQuotaSubject] = useState('');
  const [quotaTotal, setQuotaTotal] = useState(5);
  const [quotaDouble, setQuotaDouble] = useState(0);

  // Professional Confirmation Modal State
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({ isOpen: false, title: '', message: '', onConfirm: () => {} });

  // UPDATED: Added Saturday and Sunday
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  const fetchSettingsData = async () => {
    try {
      const [termRes, gridRes, quotaRes] = await Promise.all([
        fetch('http://localhost:8000/api/timetable/manage-containers/'),
        fetch('http://localhost:8000/api/timetable/grid/'),
        fetch('http://localhost:8000/api/timetable/manage-quotas/')
      ]);
      const termData = await termRes.json();
      const gridData = await gridRes.json();
      const quotaData = await quotaRes.json();

      if (termData.status === 'success') setTimetables(termData.data);
      if (gridData.status === 'success') setSlots(gridData.data);
      if (quotaData.status === 'success') {
        setGrades(quotaData.data.grades);
        setSubjects(quotaData.data.subjects);
        setQuotas(quotaData.data.quotas);
      }
    } catch (e) {
      toast.error("Failed to load settings data.");
    }
  };

  useEffect(() => { fetchSettingsData(); }, []);

  // --- SAVE TERM ---
  const handleSaveTerm = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('http://localhost:8000/api/timetable/manage-containers/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: termName, status: termStatus, is_active: termIsActive })
      });
      const data = await res.json();
      if (data.status === 'success') {
        toast.success(data.message);
        setTermName('');
        fetchSettingsData();
        onRefreshTrigger();
      } else toast.error(data.message);
    } catch (e) { toast.error("Error saving term."); }
  };

  // --- DELETE TERM ---
  const handleDeleteTerm = (id: number, e: React.MouseEvent) => {
    e.stopPropagation(); 
    setConfirmDialog({
      isOpen: true,
      title: "Delete Term Container",
      message: "This will permanently erase the container and all associated lessons. Are you sure?",
      onConfirm: async () => {
        setConfirmDialog(prev => ({ ...prev, isOpen: false }));
        try {
          const res = await fetch('http://localhost:8000/api/timetable/manage-containers/', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
          });
          const data = await res.json();
          if (data.status === 'success') {
            toast.success(data.message);
            fetchSettingsData();
            onRefreshTrigger();
          } else toast.error(data.message);
        } catch (e) { toast.error("Error deleting term."); }
      }
    });
  };

  // --- TRIGGER EDIT MODE FOR A SLOT ---
  const handleEditSlot = (slot: TimeSlot) => {
    setEditSlotId(slot.id);
    setSlotDay(slot.day);
    setStartTime(slot.start_time.substring(0, 5));
    setEndTime(slot.end_time.substring(0, 5));
    setIsGlobal(slot.is_global);
    setGlobalLabel(slot.global_label || '');
  };

  const cancelSlotEdit = () => {
    setEditSlotId(null);
    setStartTime(''); setEndTime(''); setGlobalLabel(''); setIsGlobal(false);
  };

  // --- SAVE OR UPDATE SLOT ---
  const handleSaveSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('http://localhost:8000/api/timetable/manage-slots/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          id: editSlotId,
          day: slotDay, 
          start_time: startTime, 
          end_time: endTime, 
          is_global: isGlobal, 
          global_label: isGlobal ? globalLabel : '' 
        })
      });
      const data = await res.json();
      if (data.status === 'success') {
        toast.success(data.message);
        cancelSlotEdit(); 
        
        // Ensure the filter switches to the day you just saved a slot for
        setSelectedFilterDay(slotDay);
        
        fetchSettingsData();
        onRefreshTrigger();
      } else toast.error(data.message);
    } catch (e) { toast.error("Error saving time slot."); }
  };

  // --- DELETE SLOT ---
  const handleDeleteSlot = (id: number) => {
    setConfirmDialog({
      isOpen: true,
      title: "Delete Time Slot",
      message: "Are you sure? This will remove the time slot from the grid permanently!",
      onConfirm: async () => {
        setConfirmDialog(prev => ({ ...prev, isOpen: false }));
        try {
          const res = await fetch('http://localhost:8000/api/timetable/manage-slots/', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
          });
          const data = await res.json();
          if (data.status === 'success') {
            toast.success(data.message);
            fetchSettingsData();
            onRefreshTrigger();
          } else toast.error(data.message);
        } catch (e) { toast.error("Error deleting time slot."); }
      }
    });
  };

  // --- SAVE QUOTA ---
  const handleSaveQuota = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('http://localhost:8000/api/timetable/manage-quotas/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          grade_id: quotaGrade, subject_id: quotaSubject, 
          total_lessons: quotaTotal, double_lessons_required: quotaDouble 
        })
      });
      const data = await res.json();
      if (data.status === 'success') {
        toast.success(data.message);
        fetchSettingsData();
        onRefreshTrigger();
      } else toast.error(data.message);
    } catch (e) { toast.error("Error saving quota."); }
  };

  // --- DELETE QUOTA ---
  const handleDeleteQuota = (id: number) => {
    setConfirmDialog({
      isOpen: true,
      title: "Delete Subject Rule",
      message: "Are you sure you want to delete this subject quota rule?",
      onConfirm: async () => {
        setConfirmDialog(prev => ({ ...prev, isOpen: false }));
        try {
          const res = await fetch('http://localhost:8000/api/timetable/manage-quotas/', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
          });
          const data = await res.json();
          if (data.status === 'success') {
            toast.success(data.message);
            fetchSettingsData();
            onRefreshTrigger();
          }
        } catch (e) { toast.error("Error deleting quota."); }
      }
    });
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl flex flex-col max-h-[90vh] overflow-hidden animate-fade-in relative">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
          <div>
            <h2 className="text-xl font-black text-slate-800">Timetable Configuration</h2>
            <p className="text-sm text-slate-500 font-medium">Manage rules, terms, and the school bell schedule.</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-2 bg-white rounded-full shadow-sm border border-slate-200"><X className="w-5 h-5" /></button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200 px-6 pt-4 gap-6 bg-slate-50 shrink-0 overflow-x-auto custom-scrollbar">
          <button onClick={() => setActiveTab('terms')} className={`pb-3 font-bold text-sm border-b-2 transition-colors whitespace-nowrap ${activeTab === 'terms' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            <CalendarPlus className="w-4 h-4 inline-block mr-2 mb-0.5" /> Terms & Containers
          </button>
          <button onClick={() => setActiveTab('bells')} className={`pb-3 font-bold text-sm border-b-2 transition-colors whitespace-nowrap ${activeTab === 'bells' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            <Clock className="w-4 h-4 inline-block mr-2 mb-0.5" /> Global Bell Schedule
          </button>
          <button onClick={() => setActiveTab('quotas')} className={`pb-3 font-bold text-sm border-b-2 transition-colors whitespace-nowrap ${activeTab === 'quotas' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            <BookOpen className="w-4 h-4 inline-block mr-2 mb-0.5" /> Subject Quotas (Rules)
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 bg-white custom-scrollbar">
          
          {/* TAB 1: TERMS */}
          {activeTab === 'terms' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <form onSubmit={handleSaveTerm} className="space-y-4 bg-slate-50 p-5 rounded-xl border border-slate-200">
                <h3 className="font-bold text-slate-800 border-b border-slate-200 pb-2">Create / Edit Term</h3>
                <div>
                  <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Timetable Name</label>
                  <input type="text" required value={termName} onChange={(e) => setTermName(e.target.value)} placeholder="e.g., Term 1 - 2026" className="w-full mt-1 border border-slate-300 rounded-lg p-2.5 outline-none focus:border-blue-500 bg-white" />
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
                    <div key={t.id} onClick={() => { setTermName(t.name); setTermStatus(t.status); setTermIsActive(t.is_active); }} className="p-4 rounded-xl border border-slate-200 flex justify-between items-center cursor-pointer hover:border-blue-300 hover:bg-blue-50 transition">
                      <div>
                        <p className="font-bold text-slate-800">{t.name}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{t.status}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        {t.is_active && <span className="flex items-center gap-1 text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-md border border-emerald-100"><CheckCircle2 className="w-3.5 h-3.5" /> ACTIVE</span>}
                        <button onClick={(e) => handleDeleteTerm(t.id, e)} className="text-red-500 hover:text-red-700 bg-white hover:bg-red-50 p-1.5 rounded-md transition-colors border border-slate-200 hover:border-red-200 flex items-center justify-center shadow-sm">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: BELL SCHEDULE */}
          {activeTab === 'bells' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <form onSubmit={handleSaveSlot} className="lg:col-span-1 space-y-4 bg-slate-50 p-5 rounded-xl border border-slate-200 h-fit">
                <div className="flex justify-between items-center border-b border-slate-200 pb-2">
                  <h3 className="font-bold text-slate-800">
                    {editSlotId ? 'Edit Time Slot' : 'Add Time Slot'}
                  </h3>
                  {editSlotId && (
                    <button type="button" onClick={cancelSlotEdit} className="text-xs font-bold text-red-500 hover:text-red-700 bg-red-50 px-2 py-1 rounded">Cancel Edit</button>
                  )}
                </div>
                
                <div>
                  <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Day of Week</label>
                  <select value={slotDay} onChange={(e) => setSlotDay(e.target.value)} className="w-full mt-1 border border-slate-300 rounded-lg p-2.5 outline-none bg-white">
                    {days.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Start</label>
                    <input type="time" required value={startTime} onChange={(e) => setStartTime(e.target.value)} className="w-full mt-1 border border-slate-300 rounded-lg p-2.5 outline-none bg-white" />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">End</label>
                    <input type="time" required value={endTime} onChange={(e) => setEndTime(e.target.value)} className="w-full mt-1 border border-slate-300 rounded-lg p-2.5 outline-none bg-white" />
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-200">
                  <label className="text-xs font-bold text-slate-600 uppercase tracking-wider block mb-1">Type of Slot</label>
                  <select 
                    value={isGlobal ? 'global' : 'academic'} 
                    onChange={(e) => setIsGlobal(e.target.value === 'global')} 
                    className="w-full border border-slate-300 rounded-lg p-2.5 outline-none bg-white text-sm font-medium"
                  >
                    <option value="academic">Academic Lesson (Requires Teacher)</option>
                    <option value="global">Global Event (Prep, Break, Assembly)</option>
                  </select>

                  {isGlobal && (
                    <div className="mt-3 animate-fade-in">
                      <label className="text-xs font-bold text-slate-600 uppercase tracking-wider block mb-1">Name of Event</label>
                      <input 
                        type="text" 
                        required 
                        value={globalLabel} 
                        onChange={(e) => setGlobalLabel(e.target.value)} 
                        placeholder="e.g., Morning Prep, Lunch Break" 
                        className="w-full border border-slate-300 rounded-lg p-2.5 outline-none bg-white" 
                      />
                    </div>
                  )}
                </div>

                <button type="submit" className={`w-full py-2.5 text-white rounded-lg font-bold flex justify-center items-center gap-2 ${editSlotId ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-blue-600 hover:bg-blue-700'}`}>
                  {editSlotId ? <><Save className="w-4 h-4" /> Update Slot</> : <><Save className="w-4 h-4" /> Add to Grid</>}
                </button>
              </form>

              <div className="lg:col-span-2">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-3">
                  <h3 className="font-bold text-slate-800">Current Bell Schedule</h3>
                  
                  {/* UPDATED DAY FILTER PILLS */}
                  <div className="flex gap-1 bg-slate-100 p-1 rounded-lg overflow-x-auto max-w-full">
                    {days.map(day => (
                      <button
                        key={day}
                        onClick={() => {
                          setSelectedFilterDay(day);
                          setSlotDay(day); // <-- Syncs the dropdown automatically
                        }}
                        type="button"
                        className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all whitespace-nowrap ${
                          selectedFilterDay === day 
                            ? 'bg-white text-blue-600 shadow-sm' 
                            : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'
                        }`}
                      >
                        {day.substring(0, 3).toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 text-slate-600 font-bold uppercase text-xs border-b border-slate-200">
                      <tr>
                        <th className="px-4 py-3">Time</th>
                        <th className="px-4 py-3">Type</th>
                        <th className="px-4 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {slots.filter(s => s.day === selectedFilterDay).map(s => (
                        <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-3 text-slate-700 font-bold">{s.start_time.substring(0,5)} - {s.end_time.substring(0,5)}</td>
                          <td className="px-4 py-3">
                            {s.is_global ? <span className="bg-amber-100 text-amber-800 px-2 py-1 rounded-md text-xs font-bold border border-amber-200">{s.global_label}</span> : <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded-md text-xs font-bold border border-blue-200">Academic Lesson</span>}
                          </td>
                          <td className="px-4 py-3 text-right flex justify-end gap-2">
                            <button onClick={() => handleEditSlot(s)} className="text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 p-1.5 rounded-md transition-colors flex items-center justify-center">
                              <Edit className="w-4 h-4" />
                            </button>
                            <button onClick={() => handleDeleteSlot(s.id)} className="text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 p-1.5 rounded-md transition-colors flex items-center justify-center">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {slots.filter(s => s.day === selectedFilterDay).length === 0 && (
                        <tr><td colSpan={3} className="px-4 py-8 text-center text-slate-400 font-medium">No slots defined for {selectedFilterDay} yet. Build your bell schedule!</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: QUOTAS (RULES) */}
          {activeTab === 'quotas' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <form onSubmit={handleSaveQuota} className="lg:col-span-1 space-y-4 bg-slate-50 p-5 rounded-xl border border-slate-200">
                <h3 className="font-bold text-slate-800 border-b border-slate-200 pb-2">Assign Lesson Rule</h3>
                
                <div>
                  <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Select Grade</label>
                  <select required value={quotaGrade} onChange={(e) => setQuotaGrade(e.target.value)} className="w-full mt-1 border border-slate-300 rounded-lg p-2.5 outline-none bg-white">
                    <option value="">-- Choose Grade --</option>
                    {grades.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Select Subject</label>
                  <select required value={quotaSubject} onChange={(e) => setQuotaSubject(e.target.value)} className="w-full mt-1 border border-slate-300 rounded-lg p-2.5 outline-none bg-white">
                    <option value="">-- Choose Subject --</option>
                    {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Total Lessons/Wk</label>
                    <input type="number" min="1" max="20" required value={quotaTotal} onChange={(e) => setQuotaTotal(parseInt(e.target.value))} className="w-full mt-1 border border-slate-300 rounded-lg p-2.5 outline-none bg-white text-center font-bold" />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Double Periods</label>
                    <input type="number" min="0" max="10" required value={quotaDouble} onChange={(e) => setQuotaDouble(parseInt(e.target.value))} className="w-full mt-1 border border-slate-300 rounded-lg p-2.5 outline-none bg-white text-center font-bold" />
                  </div>
                </div>

                <button type="submit" className="w-full py-2.5 bg-indigo-600 text-white rounded-lg font-bold hover:bg-indigo-700 flex justify-center items-center gap-2 mt-2"><Save className="w-4 h-4" /> Save Rule</button>
              </form>

              <div className="lg:col-span-2">
                <h3 className="font-bold text-slate-800 mb-4">Master Quota Rules</h3>
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 text-slate-600 font-bold uppercase text-xs border-b border-slate-200">
                      <tr><th className="px-4 py-3">Grade</th><th className="px-4 py-3">Subject</th><th className="px-4 py-3 text-center">Lessons</th><th className="px-4 py-3 text-center">Action</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {quotas.map(q => (
                        <tr key={q.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-3 font-bold text-slate-700">{q.grade__name}</td>
                          <td className="px-4 py-3 font-bold text-indigo-700">{q.subject__name}</td>
                          <td className="px-4 py-3 text-center">
                            <span className="font-black text-slate-800">{q.total_lessons}</span>
                            {q.double_lessons_required > 0 && <span className="text-xs text-slate-400 ml-1">({q.double_lessons_required} double)</span>}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <button onClick={() => handleDeleteQuota(q.id)} className="text-red-500 hover:text-red-700 p-1.5 hover:bg-red-50 rounded-md transition"><Trash2 className="w-4 h-4" /></button>
                          </td>
                        </tr>
                      ))}
                      {quotas.length === 0 && (
                        <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400 font-medium">No rules defined. Add subject quotas to start building timetables.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
        
        {/* --- CUSTOM CONFIRMATION MODAL --- */}
        {confirmDialog.isOpen && (
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[60] p-4 rounded-2xl">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden border border-slate-100">
              <div className="p-6 text-center">
                <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
                  <AlertCircle className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-black text-slate-800 mb-2">{confirmDialog.title}</h3>
                <p className="text-slate-500 font-medium text-sm mb-6">{confirmDialog.message}</p>
                <div className="flex gap-3">
                  <button 
                    onClick={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))} 
                    className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 rounded-lg font-bold hover:bg-slate-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={confirmDialog.onConfirm} 
                    className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg font-bold hover:bg-red-700 transition-colors shadow-sm"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}