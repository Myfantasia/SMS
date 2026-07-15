import { useState } from 'react';
import { X, Save, BookOpen } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../libs/axiosInstance';

interface AddSubjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void; // Used to trigger a refresh of the table data
}

export default function AddSubjectModal({ isOpen, onClose, onSuccess }: AddSubjectModalProps) {
  const [formData, setFormData] = useState({
    code: '', name: '', department: 'None', is_core: true,
    allow_double_periods: true, earliest_allowed_time: ''
  });
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  setLoading(true);

  const toastId = toast.loading('Adding subject...');

  try {
    const response = await api.post('/api/academic-hub/add-subject/', formData);
    const data = response.data;

    if (data.status === 'success') {
      toast.success(`${formData.name} added to curriculum!`, { id: toastId });
      onSuccess();
      onClose();
    } else {
      toast.error(data.message || 'Failed to add subject.', { id: toastId });
    }
  } catch (error: any) {
    console.error(error);
    const errMsg = error.response?.data?.message || 'Network error occurred.';
    toast.error(errMsg, { id: toastId });
  } finally {
    setLoading(false);
  }
};

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden flex flex-col max-h-[90vh]">

        {/* Beautiful Header Design (matches AddStreamModal) */}
        <div className="px-6 py-5 border-b border-slate-100 bg-slate-50 flex items-center justify-between relative overflow-hidden shrink-0">
          <div className="absolute top-0 right-0 -mr-4 -mt-4 w-24 h-24 bg-emerald-100 rounded-full opacity-50 pointer-events-none blur-xl"></div>

          <div className="flex items-center gap-3 relative z-10">
            <div className="w-10 h-10 bg-white shadow-sm border border-slate-200 rounded-full flex items-center justify-center text-emerald-600">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-lg leading-tight">Add New Subject</h3>
              <p className="text-xs text-slate-500 font-medium tracking-wide">Adds a subject to the master curriculum catalog</p>
            </div>
          </div>

          <button type="button" onClick={onClose} title="Close modal" className="text-slate-400 hover:text-slate-700 bg-white hover:bg-slate-100 p-1.5 rounded-full transition-colors relative z-10 border border-transparent hover:border-slate-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6 overflow-y-auto">
          <div className="grid grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-600 uppercase tracking-wider block">
                Subject Code <span className="text-red-500">*</span>
              </label>
              <input required type="text" placeholder="e.g. MAT101"
                className="w-full border border-slate-300 rounded-xl p-3 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 bg-white text-slate-800 transition-all shadow-sm"
                onChange={(e) => setFormData({...formData, code: e.target.value})} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="department" className="text-xs font-bold text-slate-600 uppercase tracking-wider block">Department</label>
              <select id="department" className="w-full border border-slate-300 rounded-xl p-3 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 bg-white text-slate-800 transition-all shadow-sm cursor-pointer"
                onChange={(e) => setFormData({...formData, department: e.target.value})} defaultValue="None">
                <option value="None">None / Unassigned</option>
                <option value="Languages">Languages</option>
                <option value="Mathematics">Mathematics</option>
                <option value="Sciences">Sciences</option>
                <option value="Humanities">Humanities</option>
                <option value="Technical">Technical</option>
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-600 uppercase tracking-wider block">
              Subject Name <span className="text-red-500">*</span>
            </label>
            <input required type="text" placeholder="e.g. Mathematics"
              className="w-full border border-slate-300 rounded-xl p-3 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 bg-white text-slate-800 transition-all shadow-sm"
              onChange={(e) => setFormData({...formData, name: e.target.value})} />
          </div>

          <div className="space-y-3 bg-slate-50 border border-slate-100 rounded-xl p-4">
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" id="is_core" defaultChecked className="w-4 h-4 text-emerald-600 border-slate-300 rounded focus:ring-emerald-500"
                onChange={(e) => setFormData({...formData, is_core: e.target.checked})} />
              <span className="text-slate-700 text-sm font-medium">This is a core/mandatory subject</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" id="allow_double_periods" defaultChecked className="w-4 h-4 text-emerald-600 border-slate-300 rounded focus:ring-emerald-500"
                onChange={(e) => setFormData({...formData, allow_double_periods: e.target.checked})} />
              <span className="text-slate-700 text-sm font-medium">Allow double periods for this subject</span>
            </label>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="earliest_allowed_time" className="text-xs font-bold text-slate-600 uppercase tracking-wider block">Earliest Allowed Time (optional)</label>
            <input type="time" id="earliest_allowed_time"
              className="w-full border border-slate-300 rounded-xl p-3 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 bg-white text-slate-800 transition-all shadow-sm"
              onChange={(e) => setFormData({...formData, earliest_allowed_time: e.target.value})} />
            <p className="text-xs text-slate-400">e.g. 09:30 for P.E., to prevent scheduling during cold early morning slots.</p>
          </div>

          <div className="pt-3 flex gap-3">
            <button type="button" onClick={onClose} disabled={loading} className="flex-1 px-4 py-3 border border-slate-200 text-slate-600 rounded-xl font-bold hover:bg-slate-50 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={loading} className="flex-1 px-4 py-3 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-all flex items-center justify-center gap-2 disabled:opacity-70 shadow-md shadow-emerald-600/20">
              <Save className="w-4 h-4" />
              {loading ? 'Saving...' : 'Save Subject'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
