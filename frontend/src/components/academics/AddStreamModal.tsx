import React, { useState, useEffect } from 'react';
import { X, Save, Layers } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../libs/axiosInstance';
import SearchableSelect, { SearchableSelectOption } from '../common/SearchableSelect';

interface AddStreamModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  gradeId: number | null;
  gradeName: string;
}

export default function AddStreamModal({ isOpen, onClose, onSuccess, gradeId, gradeName }: AddStreamModalProps) {
  const [streamName, setStreamName] = useState('');
  const [capacity, setCapacity] = useState<number | string>(40);
  const [teacherId, setTeacherId] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const [teacherOptions, setTeacherOptions] = useState<SearchableSelectOption[]>([]);
  const [loadingTeacherOptions, setLoadingTeacherOptions] = useState(false);

  useEffect(() => {
    if (!isOpen || teacherOptions.length > 0) return;
    setLoadingTeacherOptions(true);
    api.get('/api/approved-users/teachers/')
      .then(res => {
        const list = Array.isArray(res.data?.data) ? res.data.data : [];
        setTeacherOptions(list.map((t: { id: number; name: string; username: string }) => ({
          value: String(t.id), label: t.name, sublabel: t.username,
        })));
      })
      .catch(err => console.error('Failed to load teachers', err))
      .finally(() => setLoadingTeacherOptions(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // If the modal is triggered to be closed, don't render its contents
  if (!isOpen) return null;

const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  
  if (!streamName.trim()) {
    toast.error("Stream name cannot be empty");
    return;
  }

  setIsSaving(true);

  try {
    // Axios throws automatically on non-2xx responses. 
    // You can safely eliminate the old "if (!response.ok)" block.
    const response = await api.post('/api/add-single-stream/', {
      grade_id: gradeId,
      stream_name: streamName,
      capacity: Number(capacity) || 40,
      teacher_id: teacherId
    });

    const data = response.data;

    if (data.status === 'success') {
      toast.success(data.message);
      setStreamName(''); // Reset fields on success
      setCapacity(40);
      setTeacherId('');
      onSuccess();       // Refresh parent component layout context
      onClose();         // Dismiss open overlay
    } else {
      console.error("Backend validation error:", data.message);
      toast.error(data.message || "Failed to add stream.");
    }
  } catch (error: any) {
    console.error("Network or parsing error:", error);
    const errMsg = error.response?.data?.message || "Network error. Failed to save the stream.";
    toast.error(errMsg);
  } finally {
    setIsSaving(false);
  }
};


  return (
    <div className="fixed inset-0 z-60 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl dark:shadow-none w-full max-w-sm overflow-hidden flex flex-col">

        {/* Beautiful Header Design */}
        <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 flex items-center justify-between relative overflow-hidden">
          {/* Background Decorative Element */}
          <div className="absolute top-0 right-0 -mr-4 -mt-4 w-24 h-24 bg-blue-100 dark:bg-blue-500/10 rounded-full opacity-50 pointer-events-none blur-xl"></div>

          <div className="flex items-center gap-3 relative z-10">
            <div className="w-10 h-10 bg-white dark:bg-slate-900 shadow-sm dark:shadow-none border border-slate-200 dark:border-slate-700 rounded-full flex items-center justify-center text-blue-600 dark:text-blue-400">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg leading-tight" title="Modal Title">Add Stream</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium tracking-wide">Target: {gradeName}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            title="Close Window"
            className="text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 p-1.5 rounded-full transition-colors relative z-10 border border-transparent hover:border-slate-200 dark:hover:border-slate-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Input Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="space-y-1.5">
            <label htmlFor="streamNameInput" className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider block">
              Stream Name <span className="text-red-500">*</span>
            </label>
            <input
              id="streamNameInput"
              type="text"
              required
              title="Enter a unique stream identifier"
              value={streamName}
              onChange={(e) => setStreamName(e.target.value)}
              placeholder="e.g., East, West, Blue, Alpha"
              className="w-full border border-slate-300 dark:border-slate-600 rounded-xl p-3 outline-none focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-400/20 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 transition-all shadow-sm dark:shadow-none"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="capacityInput" className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider block">
              Maximum Capacity <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                id="capacityInput"
                type="number"
                required
                min="1"
                max="150"
                title="Maximum number of students allowed"
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                className="w-full border border-slate-300 dark:border-slate-600 rounded-xl p-3 outline-none focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-400/20 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 transition-all shadow-sm dark:shadow-none font-medium"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 text-sm font-medium pointer-events-none">
                Students
              </span>
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="stream-teacher" className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider block">
              Class Teacher <span className="text-slate-400 dark:text-slate-500 normal-case font-medium">(optional)</span>
            </label>
            <SearchableSelect
              id="stream-teacher"
              options={teacherOptions}
              value={teacherId}
              onChange={setTeacherId}
              placeholder={loadingTeacherOptions ? 'Loading…' : 'Unassigned'}
              searchPlaceholder="Search teachers…"
              emptyMessage="No teachers found."
              disabled={loadingTeacherOptions}
            />
            <p className="text-xs text-slate-400 dark:text-slate-500">Can also be assigned later from the stream's edit action.</p>
          </div>

          <div className="pt-3 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              title="Cancel action"
              disabled={isSaving}
              className="flex-1 px-4 py-3 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 rounded-xl font-bold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button 
              type="submit" 
              title="Save to Database"
              disabled={isSaving || !streamName.trim()}
              className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:hover:bg-blue-600 shadow-md shadow-blue-600/20"
            >
              <Save className="w-4 h-4" /> 
              {isSaving ? 'Processing...' : 'Save Stream'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}