import { useState, useEffect } from 'react';
import { X, Save, Layers } from 'lucide-react';
import { toast } from 'react-hot-toast';
import api from '../../libs/axiosInstance';

interface Curriculum {
  id: number;
  code: string;
  name: string;
  is_active_for_new_grades: boolean;
  is_archived: boolean;
}

interface Tier {
  id: number;
  curriculum: number;
  name: string;
  code: string;
}

interface AddGradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function AddGradeModal({ isOpen, onClose, onSuccess }: AddGradeModalProps) {
  const [formData, setFormData] = useState({
    grade_name: '', numeric_order: '', streams: '', capacity: 40, curriculum_id: '', tier_id: ''
  });
  const [loading, setLoading] = useState(false);
  const [curricula, setCurricula] = useState<Curriculum[]>([]);
  const [tiers, setTiers] = useState<Tier[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    api.get('/api/core/curriculum/curricula/')
      .then(res => {
        const available: Curriculum[] = (res.data ?? []).filter(
          (c: Curriculum) => c.is_active_for_new_grades && !c.is_archived
        );
        setCurricula(available);
      })
      .catch(err => console.error('Failed to load curricula', err));
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !formData.curriculum_id) {
      setTiers([]);
      return;
    }
    api.get(`/api/core/curriculum/tiers/?curriculum=${formData.curriculum_id}`)
      .then(res => setTiers(res.data ?? []))
      .catch(err => console.error('Failed to load tiers', err));
  }, [isOpen, formData.curriculum_id]);

  if (!isOpen) return null;

  const hasTiers = tiers.length > 0;

const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();

  if (!formData.curriculum_id) {
    toast.error('Please select a curriculum.');
    return;
  }
  if (hasTiers && !formData.tier_id) {
    toast.error('Please select a tier.');
    return;
  }

  setLoading(true);

  const toastId = toast.loading('Creating grade...');

  try {
    const response = await api.post('/api/academic-hub/add-grade/', {
      ...formData,
      tier_id: hasTiers ? formData.tier_id : null,
    });
    const data = response.data;

    if (data.status === 'success') {
      toast.success('Grade and Streams successfully created!', { id: toastId });
      onSuccess();
      onClose();
    } else {
      toast.error(data.message || 'Failed to create grade.', { id: toastId });
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
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl dark:shadow-none w-full max-w-xl overflow-hidden flex flex-col max-h-[90vh]">

        {/* Beautiful Header Design (matches AddStreamModal) */}
        <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 flex items-center justify-between relative overflow-hidden shrink-0">
          <div className="absolute top-0 right-0 -mr-4 -mt-4 w-24 h-24 bg-blue-100 dark:bg-blue-500/10 rounded-full opacity-50 pointer-events-none blur-xl"></div>

          <div className="flex items-center gap-3 relative z-10">
            <div className="w-10 h-10 bg-white dark:bg-slate-900 shadow-sm dark:shadow-none border border-slate-200 dark:border-slate-700 rounded-full flex items-center justify-center text-blue-600 dark:text-blue-400">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg leading-tight">Add Grade & Streams</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium tracking-wide">Builds the grade level and its physical classrooms in one step</p>
            </div>
          </div>

          <button onClick={onClose} title="Close" className="text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 p-1.5 rounded-full transition-colors relative z-10 border border-transparent hover:border-slate-200 dark:hover:border-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6 overflow-y-auto">
          <div className="grid grid-cols-3 gap-5">
            <div className="col-span-2 space-y-1.5">
              <label className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider block">
                Grade Name <span className="text-red-500">*</span>
              </label>
              <input required type="text" placeholder="e.g. Grade 8" aria-label="Grade Name"
                className="w-full border border-slate-300 dark:border-slate-600 rounded-xl p-3 outline-none focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-400/20 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 transition-all shadow-sm dark:shadow-none"
                onChange={(e) => setFormData({...formData, grade_name: e.target.value})} />
            </div>
            <div className="col-span-1 space-y-1.5">
              <label className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider block">
                Sort Order <span className="text-red-500">*</span>
              </label>
              <input required type="number" placeholder="e.g. 8" aria-label="Sort Order"
                className="w-full border border-slate-300 dark:border-slate-600 rounded-xl p-3 outline-none focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-400/20 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 transition-all shadow-sm dark:shadow-none"
                onChange={(e) => setFormData({...formData, numeric_order: e.target.value})} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider block">
                Curriculum <span className="text-red-500">*</span>
              </label>
              <select required aria-label="Curriculum" value={formData.curriculum_id}
                onChange={(e) => setFormData({...formData, curriculum_id: e.target.value, tier_id: ''})}
                className="w-full border border-slate-300 dark:border-slate-600 rounded-xl p-3 outline-none focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-400/20 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 transition-all shadow-sm dark:shadow-none">
                <option value="">Select curriculum...</option>
                {curricula.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            {hasTiers && (
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider block">
                  Tier <span className="text-red-500">*</span>
                </label>
                <select required aria-label="Tier" value={formData.tier_id}
                  onChange={(e) => setFormData({...formData, tier_id: e.target.value})}
                  className="w-full border border-slate-300 dark:border-slate-600 rounded-xl p-3 outline-none focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-400/20 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 transition-all shadow-sm dark:shadow-none">
                  <option value="">Select tier...</option>
                  {tiers.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider block">
              Class Streams (Comma Separated) <span className="text-red-500">*</span>
            </label>
            <input required type="text" placeholder="e.g. A, B, C, East, West" aria-label="Class Streams"
              className="w-full border border-slate-300 dark:border-slate-600 rounded-xl p-3 outline-none focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-400/20 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 transition-all shadow-sm dark:shadow-none"
              onChange={(e) => setFormData({...formData, streams: e.target.value})} />
            <p className="text-xs text-slate-400 dark:text-slate-500">This will auto-generate all physical classrooms for this grade — one per stream listed.</p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider block">
              Default Capacity Per Stream <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input required type="number" defaultValue={40} aria-label="Default Capacity Per Stream"
                className="w-full border border-slate-300 dark:border-slate-600 rounded-xl p-3 outline-none focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-400/20 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 transition-all shadow-sm dark:shadow-none font-medium"
                onChange={(e) => setFormData({...formData, capacity: parseInt(e.target.value)})} />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 text-sm font-medium pointer-events-none">Students</span>
            </div>
            <p className="text-xs text-slate-400 dark:text-slate-500">Applied to every stream created above — you can fine-tune each one afterward.</p>
          </div>

          <div className="pt-3 flex gap-3">
            <button type="button" onClick={onClose} disabled={loading} className="flex-1 px-4 py-3 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 rounded-xl font-bold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={loading} className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all flex items-center justify-center gap-2 disabled:opacity-70 shadow-md shadow-blue-600/20">
              <Save className="w-4 h-4" />
              {loading ? 'Saving...' : 'Save Structure'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
