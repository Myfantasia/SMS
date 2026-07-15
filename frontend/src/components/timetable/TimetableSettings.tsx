import { useState, useEffect } from 'react';
import { X, CalendarPlus, Clock, BookOpen, AlertCircle, Sliders, History, Layers, Settings2 } from 'lucide-react';
import toast from 'react-hot-toast';
import SettingsTerms from './SettingsTerms';
import SettingsBells from './SettingsBells';
import SettingsQuotas from './SettingsQuotas'; 
import type { Grade, Quota, Subject, TimeSlot, Timetable } from '../../libs/types';
import api from '../../libs/axiosInstance';
import SettingsAuditLog from './SettingsAuditLogs';
import SettingsPolicies from './SettingsPolicies';
import SettingsSubjectBlocks from './SettingsSubjectBlocks';

interface TimetableSettingsProps { onClose: () => void; onRefreshTrigger: () => void; }

export default function TimetableSettings({ onClose, onRefreshTrigger }: TimetableSettingsProps) {
  // FIXED: Expanded the tab literal type state array to support 'logs'
  const [activeTab, setActiveTab] = useState<'terms' | 'bells' | 'quotas' | 'blocks' | 'policies' | 'logs'>('terms');
  
  const [timetables, setTimetables] = useState<Timetable[]>([]);
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [quotas, setQuotas] = useState<Quota[]>([]);
  const [daytimeCapacity, setDaytimeCapacity] = useState(0);

  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, title: '', message: '', onConfirm: () => {} });

  const fetchSettingsData = async () => {
    try {
      const [termRes, gridRes, quotaRes] = await Promise.all([
        api.get('/api/timetable/manage-containers/'),
        api.get('/api/timetable/grid/'),
        api.get('/api/timetable/manage-quotas/')
      ]);

      if (termRes.data.status === 'success') setTimetables(termRes.data.data);
      if (gridRes.data.status === 'success') setSlots(gridRes.data.data);
      if (quotaRes.data.status === 'success') {
        setGrades(quotaRes.data.data.grades);
        setSubjects(quotaRes.data.data.subjects);
        setQuotas(quotaRes.data.data.quotas);
        setDaytimeCapacity(quotaRes.data.data.daytime_capacity || 0);
      }
    } catch (error) {
      console.error("Error loading timetable setting matrices:", error);
      toast.error("Failed to load layout configuration metrics.");
    }
  };

  useEffect(() => { fetchSettingsData(); }, []);

  const triggerConfirm = (title: string, message: string, onConfirm: () => void) => {
    setConfirmDialog({ isOpen: true, title, message, onConfirm: () => { onConfirm(); setConfirmDialog(prev => ({ ...prev, isOpen: false })); } });
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl flex flex-col max-h-[90vh] overflow-hidden animate-fade-in relative">
        
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-50 text-blue-600"><Settings2 className="w-5 h-5" /></div>
            <h2 className="text-xl font-black text-slate-800">Timetable Configuration</h2>
          </div>
          <button onClick={onClose} title="Close" aria-label="Close" className="text-slate-400 p-2 bg-white rounded-full border border-slate-200 hover:text-slate-600 transition-colors"><X className="w-5 h-5" /></button>
        </div>

        {/* Tab Selection Row */}
        <div className="flex border-b border-slate-200 px-6 pt-4 gap-6 bg-slate-50 shrink-0 overflow-x-auto custom-scrollbar">
          <button onClick={() => setActiveTab('terms')} className={`pb-3 font-bold text-sm border-b-2 transition-all flex items-center whitespace-nowrap ${activeTab === 'terms' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'}`}><CalendarPlus className="w-4 h-4 mr-2" /> Terms & Containers</button>
          <button onClick={() => setActiveTab('bells')} className={`pb-3 font-bold text-sm border-b-2 transition-all flex items-center whitespace-nowrap ${activeTab === 'bells' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'}`}><Clock className="w-4 h-4 mr-2" /> Bell Schedule</button>
          <button onClick={() => setActiveTab('quotas')} className={`pb-3 font-bold text-sm border-b-2 transition-all flex items-center whitespace-nowrap ${activeTab === 'quotas' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'}`}><BookOpen className="w-4 h-4 mr-2" /> Quotas (Rules)</button>
          <button onClick={() => setActiveTab('policies')} className={`pb-3 font-bold text-sm border-b-2 transition-all flex items-center whitespace-nowrap ${activeTab === 'policies' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'}`}><Sliders className="w-4 h-4 mr-2" /> Institutional Policies</button>
          <button onClick={() => setActiveTab('logs')} className={`pb-3 font-bold text-sm border-b-2 transition-all flex items-center whitespace-nowrap ${activeTab === 'logs' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'}`}><History className="w-4 h-4 mr-2" /> Audit Logs</button>
          <button onClick={() => setActiveTab('blocks')} className={`pb-3 font-bold text-sm border-b-2 transition-all flex items-center whitespace-nowrap ${activeTab === 'blocks' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'}`}><Layers className="w-4 h-4 mr-2" /> Subject Block Builder</button>
        </div>

        {/* Tab Subpanels Display Track */}
        <div className="flex-1 overflow-y-auto p-6 bg-white custom-scrollbar">
          {activeTab === 'terms' && <SettingsTerms timetables={timetables} onRefreshTrigger={onRefreshTrigger} fetchSettingsData={fetchSettingsData} confirmAction={triggerConfirm} />}
          {activeTab === 'bells' && <SettingsBells slots={slots} onRefreshTrigger={onRefreshTrigger} fetchSettingsData={fetchSettingsData} confirmAction={triggerConfirm} />}
          {activeTab === 'quotas' && <SettingsQuotas grades={grades} subjects={subjects} quotas={quotas} daytimeCapacity={daytimeCapacity} onRefreshTrigger={onRefreshTrigger} fetchSettingsData={fetchSettingsData} confirmAction={triggerConfirm} />}
          {activeTab === 'policies' && <SettingsPolicies />}
          {activeTab === 'logs' && <SettingsAuditLog />}
          {activeTab === 'blocks' && <SettingsSubjectBlocks grades={grades} subjects={subjects} quotas={quotas} confirmAction={triggerConfirm} />}
        </div>

        {/* Global Dialog Modal */}
        {confirmDialog.isOpen && (
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-60 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden p-6 text-center">
              <AlertCircle className="w-12 h-12 text-red-600 mx-auto mb-4" />
              <h3 className="text-xl font-black mb-2 text-slate-800">{confirmDialog.title}</h3>
              <p className="text-sm text-slate-500 mb-6 leading-relaxed">{confirmDialog.message}</p>
              <div className="flex gap-3">
                <button onClick={() => setConfirmDialog(p => ({ ...p, isOpen: false }))} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 rounded-lg font-bold hover:bg-slate-50">Cancel</button>
                <button onClick={confirmDialog.onConfirm} className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg font-bold hover:bg-red-700">Confirm</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}