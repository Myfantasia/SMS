import { useState, useEffect } from 'react';
import { X, CalendarPlus, Clock, BookOpen, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import SettingsTerms from './SettingsTerms';
import SettingsBells from './SettingsBells';
import SettingsQuotas from './SettingsQuotas';
import type { Grade, Quota, Subject, TimeSlot, Timetable } from '../../libs/types';

interface TimetableSettingsProps { onClose: () => void; onRefreshTrigger: () => void; }

export default function TimetableSettings({ onClose, onRefreshTrigger }: TimetableSettingsProps) {
  const [activeTab, setActiveTab] = useState<'terms' | 'bells' | 'quotas'>('terms');
  
  const [timetables, setTimetables] = useState<Timetable[]>([]);
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [quotas, setQuotas] = useState<Quota[]>([]);
  
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, title: '', message: '', onConfirm: () => {} });

  const fetchSettingsData = async () => {
    try {
      const [termRes, gridRes, quotaRes] = await Promise.all([
        fetch('http://localhost:8000/api/timetable/manage-containers/'),
        fetch('http://localhost:8000/api/timetable/grid/'),
        fetch('http://localhost:8000/api/timetable/manage-quotas/')
      ]);
      const termData = await termRes.json(); const gridData = await gridRes.json(); const quotaData = await quotaRes.json();
      if (termData.status === 'success') setTimetables(termData.data);
      if (gridData.status === 'success') setSlots(gridData.data);
      if (quotaData.status === 'success') { setGrades(quotaData.data.grades); setSubjects(quotaData.data.subjects); setQuotas(quotaData.data.quotas); }
    } catch (e) { toast.error("Failed to load settings."); }
  };

  useEffect(() => { fetchSettingsData(); }, []);

  const triggerConfirm = (title: string, message: string, onConfirm: () => void) => {
    setConfirmDialog({ isOpen: true, title, message, onConfirm: () => { onConfirm(); setConfirmDialog(prev => ({ ...prev, isOpen: false })); } });
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl flex flex-col max-h-[90vh] overflow-hidden animate-fade-in relative">
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
          <div><h2 className="text-xl font-black text-slate-800">Timetable Configuration</h2></div>
          <button onClick={onClose} className="text-slate-400 p-2 bg-white rounded-full border border-slate-200"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex border-b border-slate-200 px-6 pt-4 gap-6 bg-slate-50 shrink-0 overflow-x-auto">
          <button onClick={() => setActiveTab('terms')} className={`pb-3 font-bold text-sm border-b-2 ${activeTab === 'terms' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500'} `}><CalendarPlus className="w-4 h-4 inline-block mr-2" /> Terms & Containers</button>
          <button onClick={() => setActiveTab('bells')} className={`pb-3 font-bold text-sm border-b-2 ${activeTab === 'bells' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500'} `}><Clock className="w-4 h-4 inline-block mr-2" /> Bell Schedule</button>
          <button onClick={() => setActiveTab('quotas')} className={`pb-3 font-bold text-sm border-b-2 ${activeTab === 'quotas' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500'} `}><BookOpen className="w-4 h-4 inline-block mr-2" /> Quotas (Rules)</button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 bg-white custom-scrollbar">
          {activeTab === 'terms' && <SettingsTerms timetables={timetables} onRefreshTrigger={onRefreshTrigger} fetchSettingsData={fetchSettingsData} confirmAction={triggerConfirm} />}
          {activeTab === 'bells' && <SettingsBells slots={slots} onRefreshTrigger={onRefreshTrigger} fetchSettingsData={fetchSettingsData} confirmAction={triggerConfirm} />}
          {activeTab === 'quotas' && <SettingsQuotas grades={grades} subjects={subjects} quotas={quotas} onRefreshTrigger={onRefreshTrigger} fetchSettingsData={fetchSettingsData} confirmAction={triggerConfirm} />}
        </div>
        {confirmDialog.isOpen && (
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden p-6 text-center">
              <AlertCircle className="w-12 h-12 text-red-600 mx-auto mb-4" />
              <h3 className="text-xl font-black mb-2">{confirmDialog.title}</h3>
              <p className="text-sm text-slate-500 mb-6">{confirmDialog.message}</p>
              <div className="flex gap-3">
                <button onClick={() => setConfirmDialog(p => ({ ...p, isOpen: false }))} className="flex-1 px-4 py-2 border rounded-lg">Cancel</button>
                <button onClick={confirmDialog.onConfirm} className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg">Confirm</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}