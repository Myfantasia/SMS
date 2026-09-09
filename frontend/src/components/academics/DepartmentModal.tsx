import { useState, useEffect } from 'react';
import { X, Save, Building2, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../libs/axiosInstance';

interface Department {
  id: number;
  name: string;
  description: string;
  is_active: boolean;
  subject_count: number;
  curriculum_id: number;
}

interface DepartmentModalProps {
  isOpen: boolean;
  curricula: any[];
  defaultCurriculumId?: number | null;
  departmentToEdit?: Department | null;
  subjects?: any[];
  subjectProfiles?: any[];
  onClose: () => void;
  onSuccess: () => void;
}

export default function DepartmentModal({ isOpen, curricula, defaultCurriculumId, departmentToEdit, subjects = [], subjectProfiles = [], onClose, onSuccess }: DepartmentModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [curriculumId, setCurriculumId] = useState<number | ''>('');
  const [selectedSubjects, setSelectedSubjects] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (departmentToEdit) {
        setName(departmentToEdit.name);
        setDescription(departmentToEdit.description);
        setCurriculumId(departmentToEdit.curriculum_id);
        const deptSubjects = subjectProfiles.filter(p => p.department === departmentToEdit.id).map(p => p.subject);
        setSelectedSubjects(new Set(deptSubjects));
      } else {
        setName('');
        setDescription('');
        setCurriculumId(defaultCurriculumId || '');
        setSelectedSubjects(new Set());
      }
    }
  }, [isOpen, departmentToEdit, defaultCurriculumId, subjectProfiles]);

  if (!isOpen) return null;

  const eligibleSubjects = subjects.filter(s => 
    subjectProfiles.some(p => p.subject === s.id && p.curriculum === curriculumId)
  );

  const toggleSubject = (subjectId: number) => {
    const newSet = new Set(selectedSubjects);
    if (newSet.has(subjectId)) newSet.delete(subjectId);
    else newSet.add(subjectId);
    setSelectedSubjects(newSet);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!curriculumId) {
      toast.error('Curriculum is required.');
      return;
    }
    setLoading(true);
    const toastId = toast.loading(departmentToEdit ? 'Updating department...' : 'Adding department...');
    try {
      const payload = { 
        name, 
        description, 
        curriculum_id: curriculumId,
        subjects: Array.from(selectedSubjects)
      };
      
      let response;
      if (departmentToEdit) {
        response = await api.put(`/api/departments/${departmentToEdit.id}/`, payload);
      } else {
        response = await api.post('/api/departments/', payload);
      }
      
      const data = response.data;
      if (data.status !== 'success') {
        toast.error(data.message || 'Operation failed.', { id: toastId });
        return;
      }
      toast.success(departmentToEdit ? 'Department updated.' : `${name} added.`, { id: toastId });
      onSuccess();
      onClose();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Network error occurred.', { id: toastId });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl dark:shadow-none w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white dark:bg-slate-900 shadow-sm dark:shadow-none border border-slate-200 dark:border-slate-700 rounded-full flex items-center justify-center text-indigo-600 dark:text-indigo-400">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg leading-tight">{departmentToEdit ? 'Edit Department' : 'Add Department'}</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium tracking-wide">Group subjects for staffing and quotas</p>
            </div>
          </div>
          <button type="button" onClick={onClose} title="Close modal" className="text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 p-1.5 rounded-full transition-colors border border-transparent hover:border-slate-200 dark:hover:border-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto flex-1 flex flex-col gap-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider block">
                Curriculum <span className="text-red-500">*</span>
              </label>
              <select required value={curriculumId} onChange={(e) => setCurriculumId(e.target.value ? Number(e.target.value) : '')}
                disabled={!!departmentToEdit}
                className="w-full border border-slate-300 dark:border-slate-600 rounded-xl p-3 outline-none focus:border-indigo-500 dark:focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:focus:ring-indigo-400/20 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 transition-all shadow-sm dark:shadow-none disabled:bg-slate-50 dark:disabled:bg-slate-800/60 disabled:text-slate-500 dark:disabled:text-slate-400">
                <option value="">Select curriculum...</option>
                {curricula.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider block">
                Name <span className="text-red-500">*</span>
              </label>
              <input required type="text" maxLength={50} placeholder="e.g. Creative Arts" value={name}
                className="w-full border border-slate-300 dark:border-slate-600 rounded-xl p-3 outline-none focus:border-indigo-500 dark:focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:focus:ring-indigo-400/20 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 transition-all shadow-sm dark:shadow-none"
                onChange={(e) => setName(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider block">Description (optional)</label>
            <textarea rows={2} maxLength={255} placeholder="Brief note for staff on what this department covers" value={description}
              className="w-full border border-slate-300 dark:border-slate-600 rounded-xl p-3 outline-none focus:border-indigo-500 dark:focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:focus:ring-indigo-400/20 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 transition-all shadow-sm dark:shadow-none resize-none"
              onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="space-y-2 flex-1 flex flex-col min-h-0">
            <label className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider block">Subjects in this Department</label>
            <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-xl p-4 overflow-y-auto flex-1 max-h-60">
              {!curriculumId ? (
                <p className="text-sm text-slate-500 dark:text-slate-400 italic text-center py-4">Select a curriculum first to see eligible subjects.</p>
              ) : eligibleSubjects.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400 italic text-center py-4">No subjects found for this curriculum.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                  {eligibleSubjects.map(s => {
                    const isSelected = selectedSubjects.has(s.id);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => toggleSubject(s.id)}
                        className={`text-left px-3 py-2 rounded-lg border text-sm transition-colors flex items-center justify-between ${
                          isSelected ? 'bg-indigo-50 dark:bg-indigo-500/10 border-indigo-200 dark:border-indigo-500/40 text-indigo-700 dark:text-indigo-400 font-medium' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-indigo-300 dark:hover:border-indigo-500/40 hover:bg-slate-50 dark:hover:bg-slate-800'
                        }`}
                      >
                        <span className="truncate pr-2">{s.name}</span>
                        {isSelected && <Check className="w-4 h-4 shrink-0 text-indigo-600 dark:text-indigo-400" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="pt-2 flex gap-3 shrink-0">
            <button type="button" onClick={onClose} disabled={loading} className="flex-1 px-4 py-3 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 rounded-xl font-bold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={loading} className="flex-1 px-4 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all flex items-center justify-center gap-2 disabled:opacity-70 shadow-md shadow-indigo-600/20">
              <Save className="w-4 h-4" />
              {loading ? 'Saving...' : (departmentToEdit ? 'Save Changes' : 'Save Department')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
