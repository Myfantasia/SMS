import { useState, useEffect } from 'react';
import { X, Save, Layers } from 'lucide-react';
import { toast } from 'react-hot-toast';
import api from '../../libs/axiosInstance';

interface Grade {
  id: number;
  grade_name: string;
}

interface EditGradeModalProps {
  isOpen: boolean;
  grade: Grade | null;
  onClose: () => void;
  onSuccess: () => void;
}

export default function EditGradeModal({ isOpen, grade, onClose, onSuccess }: EditGradeModalProps) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !grade) return;
    setName(grade.grade_name);
  }, [isOpen, grade]);

  if (!isOpen || !grade) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    setLoading(true);
    const toastId = toast.loading('Updating grade...');

    try {
      const response = await api.put(`/api/academic-hub/edit-grade/${grade.id}/`, { name });
      const data = response.data;

      if (data.status === 'success') {
        toast.success(data.message || 'Grade updated successfully!', { id: toastId });
        onSuccess();
        onClose();
      } else {
        toast.error(data.message || 'Failed to update grade.', { id: toastId });
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

        <div className="px-6 py-5 border-b border-slate-100 bg-slate-50 flex items-center justify-between relative overflow-hidden shrink-0">
          <div className="absolute top-0 right-0 -mr-4 -mt-4 w-24 h-24 bg-amber-100 rounded-full opacity-50 pointer-events-none blur-xl"></div>

          <div className="flex items-center gap-3 relative z-10">
            <div className="w-10 h-10 bg-white shadow-sm border border-slate-200 rounded-full flex items-center justify-center text-amber-600">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-lg leading-tight">Edit Grade</h3>
              <p className="text-xs text-slate-500 font-medium tracking-wide">Update the grade's name</p>
            </div>
          </div>

          <button onClick={onClose} title="Close" className="text-slate-400 hover:text-slate-700 bg-white hover:bg-slate-100 p-1.5 rounded-full transition-colors relative z-10 border border-transparent hover:border-slate-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6 overflow-y-auto">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-600 uppercase tracking-wider block">
              Grade Name <span className="text-red-500">*</span>
            </label>
            <input required type="text" aria-label="Grade Name" value={name}
              className="w-full border border-slate-300 rounded-xl p-3 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100 bg-white text-slate-800 transition-all shadow-sm"
              onChange={(e) => setName(e.target.value)} />
          </div>
          <p className="text-xs text-slate-400 -mt-3">
            To reassign this grade's curriculum or tier, open the relevant Tier in Curriculum Hub → Tiers.
          </p>

          <div className="pt-3 flex gap-3">
            <button type="button" onClick={onClose} disabled={loading} className="flex-1 px-4 py-3 border border-slate-200 text-slate-600 rounded-xl font-bold hover:bg-slate-50 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={loading} className="flex-1 px-4 py-3 bg-amber-600 text-white rounded-xl font-bold hover:bg-amber-700 transition-all flex items-center justify-center gap-2 disabled:opacity-70 shadow-md shadow-amber-600/20">
              <Save className="w-4 h-4" />
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
