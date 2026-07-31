import { useState } from 'react';
import { X, Save, BookOpen, GraduationCap, Clock3, Layers } from 'lucide-react';
import toast from 'react-hot-toast';
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

interface Department {
  id: number;
  name: string;
  is_active: boolean;
  curriculum_id: number;
}

interface AddSubjectModalProps {
  isOpen: boolean;
  curricula: Curriculum[];
  tiers: Tier[];
  departments: Department[];
  onClose: () => void;
  onSuccess: () => void; // Used to trigger a refresh of the table data
}

export default function AddSubjectModal({ isOpen, curricula, tiers, departments, onClose, onSuccess }: AddSubjectModalProps) {
  const [formData, setFormData] = useState({
    code: '', name: '', department_id: '' as number | '', is_core: true,
    allow_double_periods: true, earliest_allowed_time: '',
    requires_synchronized_grade_blocking: false, synchronized_blocking_min_grade: ''
  });
  // Which curricula are checked, and which of their tiers (if any) narrow the assignment.
  // A curriculum present with an empty Set means "applies to the whole curriculum".
  const [selectedCurricula, setSelectedCurricula] = useState<Record<number, Set<number>>>({});
  // Department per checked curriculum — CBC and 8-4-4 group subjects differently, so this is
  // separate from formData.department_id (the flat fallback used only when a subject has no
  // curriculum assignment at all).
  const [selectedDepartments, setSelectedDepartments] = useState<Record<number, number | ''>>({});
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const availableCurricula = curricula.filter((c) => c.is_active_for_new_grades && !c.is_archived);
  const curriculumCodeById = Object.fromEntries(curricula.map((c) => [c.id, c.code]));

  const toggleCurriculum = (curriculumId: number) => {
    setSelectedCurricula((prev) => {
      const next = { ...prev };
      if (curriculumId in next) {
        delete next[curriculumId];
      } else {
        next[curriculumId] = new Set();
      }
      return next;
    });
  };

  const toggleTier = (curriculumId: number, tierId: number) => {
    setSelectedCurricula((prev) => {
      const current = new Set(prev[curriculumId] ?? []);
      if (current.has(tierId)) current.delete(tierId); else current.add(tierId);
      return { ...prev, [curriculumId]: current };
    });
  };

  const resetForm = () => {
    setFormData({
      code: '', name: '', department_id: '', is_core: true, allow_double_periods: true, earliest_allowed_time: '',
      requires_synchronized_grade_blocking: false, synchronized_blocking_min_grade: ''
    });
    setSelectedCurricula({});
    setSelectedDepartments({});
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const toastId = toast.loading('Adding subject...');

    try {
      const response = await api.post('/api/academic-hub/add-subject/', {
        ...formData,
        department_id: formData.department_id || null,
        synchronized_blocking_min_grade: formData.requires_synchronized_grade_blocking && formData.synchronized_blocking_min_grade
          ? Number(formData.synchronized_blocking_min_grade)
          : null,
      });
      const data = response.data;

      if (data.status !== 'success') {
        toast.error(data.message || 'Failed to add subject.', { id: toastId });
        setLoading(false);
        return;
      }

      const subjectId = data.subject_id;
      const assignments = Object.entries(selectedCurricula);

      if (subjectId && assignments.length > 0) {
        const results = await Promise.allSettled(
          assignments.flatMap(([curriculumId, tierIds]) => {
            const cId = Number(curriculumId);
            const department = selectedDepartments[cId] || null;
            if (tierIds.size === 0) {
              return [api.post('/api/core/curriculum/subject-profiles/', { subject: subjectId, curriculum: cId, tier: null, department })];
            }
            return Array.from(tierIds).map((tierId) =>
              api.post('/api/core/curriculum/subject-profiles/', { subject: subjectId, curriculum: cId, tier: tierId, department })
            );
          })
        );
        const failed = results.filter((r) => r.status === 'rejected').length;
        if (failed > 0) {
          toast.error(`${formData.name} was created, but ${failed} curriculum assignment(s) failed — assign them from Curriculum Hub.`, { id: toastId });
        } else {
          toast.success(`${formData.name} added and assigned!`, { id: toastId });
        }
      } else {
        toast.success(`${formData.name} added to the catalog!`, { id: toastId });
      }

      onSuccess();
      resetForm();
      onClose();
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

          {/* --- BASIC INFO --- */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-5">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-600 uppercase tracking-wider block">
                  Subject Code <span className="text-red-500">*</span>
                </label>
                <input required type="text" placeholder="e.g. MAT101" value={formData.code}
                  className="w-full border border-slate-300 rounded-xl p-3 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 bg-white text-slate-800 transition-all shadow-sm"
                  onChange={(e) => setFormData({ ...formData, code: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="department" className="text-xs font-bold text-slate-600 uppercase tracking-wider block">Default department</label>
                <select id="department" value={formData.department_id} className="w-full border border-slate-300 rounded-xl p-3 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 bg-white text-slate-800 transition-all shadow-sm cursor-pointer"
                  onChange={(e) => setFormData({ ...formData, department_id: e.target.value ? Number(e.target.value) : '' })}>
                  <option value="">Uncategorized</option>
                  {departments.filter((d) => d.is_active).map((d) => (
                    <option key={d.id} value={d.id}>{d.name} ({curriculumCodeById[d.curriculum_id] ?? '?'})</option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-400">Only used if this subject isn't assigned to any curriculum below.</p>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-600 uppercase tracking-wider block">
                Subject Name <span className="text-red-500">*</span>
              </label>
              <input required type="text" placeholder="e.g. Mathematics" value={formData.name}
                className="w-full border border-slate-300 rounded-xl p-3 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 bg-white text-slate-800 transition-all shadow-sm"
                onChange={(e) => setFormData({ ...formData, name: e.target.value })} />
            </div>
          </div>

          {/* --- CURRICULUM & TIER ASSIGNMENT --- */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Layers className="w-3.5 h-3.5 text-indigo-600" />
              <label className="text-xs font-bold text-slate-600 uppercase tracking-wider block">Where is this taught? (optional)</label>
            </div>
            <div className="bg-slate-50 border border-slate-100 rounded-xl divide-y divide-slate-100">
              {availableCurricula.length === 0 && (
                <p className="text-xs text-slate-400 italic px-4 py-3">No curricula configured yet — create one in Curriculum Hub first.</p>
              )}
              {availableCurricula.map((c) => {
                const checked = c.id in selectedCurricula;
                const curriculumTiers = tiers.filter((t) => t.curriculum === c.id);
                const selectedTiers = selectedCurricula[c.id] ?? new Set<number>();
                const curriculumDepartments = departments.filter((d) => d.is_active && d.curriculum_id === c.id);
                return (
                  <div key={c.id} className="px-4 py-3">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input type="checkbox" checked={checked} onChange={() => toggleCurriculum(c.id)}
                        className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500" />
                      <span className="text-slate-700 text-sm font-semibold">{c.name}</span>
                      <span className="text-xs text-slate-400 font-mono">{c.code}</span>
                    </label>
                    {checked && curriculumTiers.length > 0 && (
                      <div className="mt-2 ml-7 flex flex-wrap gap-1.5">
                        {curriculumTiers.map((t) => {
                          const tierChecked = selectedTiers.has(t.id);
                          return (
                            <button
                              type="button"
                              key={t.id}
                              onClick={() => toggleTier(c.id, t.id)}
                              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${
                                tierChecked ? 'bg-indigo-100 border-indigo-300 text-indigo-700' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                              }`}
                            >
                              {t.name}
                            </button>
                          );
                        })}
                        {selectedTiers.size === 0 && (
                          <span className="text-[11px] text-slate-400 italic self-center">No tier picked = applies to every tier of {c.code}</span>
                        )}
                      </div>
                    )}
                    {checked && (
                      <div className="mt-2 ml-7">
                        <select
                          aria-label={`Department under ${c.code}`}
                          value={selectedDepartments[c.id] ?? ''}
                          onChange={(e) => setSelectedDepartments((prev) => ({ ...prev, [c.id]: e.target.value ? Number(e.target.value) : '' }))}
                          className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:border-indigo-500 bg-white text-slate-600"
                        >
                          <option value="">Department under {c.code}...</option>
                          {curriculumDepartments.map((d) => (
                            <option key={d.id} value={d.id}>{d.name}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-slate-400">Leave everything unchecked to keep it shared across all curricula — you can assign it later from Curriculum Hub.</p>
          </div>

          {/* --- SCHEDULING BEHAVIOR --- */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Clock3 className="w-3.5 h-3.5 text-emerald-600" />
              <label className="text-xs font-bold text-slate-600 uppercase tracking-wider block">Scheduling behavior</label>
            </div>
            <div className="space-y-3 bg-slate-50 border border-slate-100 rounded-xl p-4">
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={formData.is_core} className="w-4 h-4 text-emerald-600 border-slate-300 rounded focus:ring-emerald-500"
                  onChange={(e) => setFormData({ ...formData, is_core: e.target.checked })} />
                <span className="text-slate-700 text-sm font-medium">This is a core/mandatory subject</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={formData.allow_double_periods} className="w-4 h-4 text-emerald-600 border-slate-300 rounded focus:ring-emerald-500"
                  onChange={(e) => setFormData({ ...formData, allow_double_periods: e.target.checked })} />
                <span className="text-slate-700 text-sm font-medium">Allow double periods for this subject</span>
              </label>
              <div className="pt-1 space-y-1.5">
                <label htmlFor="earliest_allowed_time" className="text-xs font-medium text-slate-500 block">Earliest allowed time (optional)</label>
                <input type="time" id="earliest_allowed_time" value={formData.earliest_allowed_time}
                  className="w-full border border-slate-300 rounded-xl p-2.5 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 bg-white text-slate-800 transition-all shadow-sm text-sm"
                  onChange={(e) => setFormData({ ...formData, earliest_allowed_time: e.target.value })} />
                <p className="text-xs text-slate-400">e.g. 09:30 for P.E., to prevent scheduling during cold early morning slots.</p>
              </div>
              <label className="flex items-center gap-3 cursor-pointer pt-1">
                <input type="checkbox" checked={formData.requires_synchronized_grade_blocking} className="w-4 h-4 text-emerald-600 border-slate-300 rounded focus:ring-emerald-500"
                  onChange={(e) => setFormData({ ...formData, requires_synchronized_grade_blocking: e.target.checked })} />
                <span className="text-slate-700 text-sm font-medium">Shared/synchronized block subject (e.g. Technical, Agriculture)</span>
              </label>
              {formData.requires_synchronized_grade_blocking && (
                <div className="pl-7 space-y-1.5">
                  <label htmlFor="sync_min_grade" className="text-xs font-medium text-slate-500 block">Only from this grade level upward (optional)</label>
                  <input type="number" min={1} id="sync_min_grade" value={formData.synchronized_blocking_min_grade}
                    placeholder="e.g. 10"
                    className="w-32 border border-slate-300 rounded-xl p-2.5 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 bg-white text-slate-800 transition-all shadow-sm text-sm"
                    onChange={(e) => setFormData({ ...formData, synchronized_blocking_min_grade: e.target.value })} />
                </div>
              )}
            </div>
            <p className="text-xs text-slate-400 flex items-start gap-1.5">
              <GraduationCap className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-300" />
              "Core" decides whether new grades auto-get a lesson quota for this subject and whether students can pick it as an elective. "Double periods" tells the timetable generator whether it may ever place two back-to-back lessons for it.
            </p>
          </div>

          <div className="pt-1 flex gap-3">
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
