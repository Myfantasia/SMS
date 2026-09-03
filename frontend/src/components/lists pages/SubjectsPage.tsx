import { useState, useEffect, useMemo } from 'react';
import { BookOpen, Eye, Edit, Trash2, X, Search, Layers, GraduationCap } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../../libs/axiosInstance';

interface SubjectData {
  id: number;
  code: string;
  name: string;
  department_id: number | null;
  department_name: string | null;
  is_core: boolean;
  assigned_teachers: string[];
  tier_ids: number[];
  tier_names: string[];
  curriculum_ids: number[];
  curriculum_codes: string[];
  /** curriculum_id (string) → department name for that curriculum */
  curriculum_departments: Record<string, string | null>;
  /** curriculum_id (string) → list of tier names assigned under that curriculum */
  curriculum_tier_names: Record<string, string[]>;
}

interface Tier {
  id: number;
  name: string;
  code: string;
  curriculum: number;
}

interface Curriculum {
  id: number;
  name: string;
  code: string;
}

const UNCATEGORIZED = 'Uncategorized';

const DEPT_PALETTE = [
  'bg-cyan-100 dark:bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border-cyan-200 dark:border-cyan-500/40',
  'bg-indigo-100 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-200 dark:border-indigo-500/40',
  'bg-rose-100 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-500/40',
  'bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/40',
  'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/40',
  'bg-purple-100 dark:bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-500/40',
  'bg-orange-100 dark:bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-500/40',
  'bg-teal-100 dark:bg-teal-500/10 text-teal-700 dark:text-teal-400 border-teal-200 dark:border-teal-500/40',
  'bg-pink-100 dark:bg-pink-500/10 text-pink-700 dark:text-pink-400 border-pink-200 dark:border-pink-500/40',
];

const CURRICULUM_COLORS: Record<string, { active: string; idle: string }> = {
  CBC: {
    active: 'bg-emerald-600 text-white border-emerald-600',
    idle: 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/40 hover:bg-emerald-50 dark:hover:bg-emerald-500/10',
  },
  '8-4-4': {
    active: 'bg-indigo-600 text-white border-indigo-600',
    idle: 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-400 border-indigo-200 dark:border-indigo-500/40 hover:bg-indigo-50 dark:hover:bg-indigo-500/10',
  },
};

const deptStyle = (deptName: string) => {
  if (deptName === UNCATEGORIZED) return 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-600';
  let hash = 0;
  for (let i = 0; i < deptName.length; i++) hash = (hash * 31 + deptName.charCodeAt(i)) >>> 0;
  return DEPT_PALETTE[hash % DEPT_PALETTE.length];
};

export default function SubjectsPage() {
  const [subjects, setSubjects] = useState<SubjectData[]>([]);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [curricula, setCurricula] = useState<Curriculum[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const navigate = useNavigate();

  const [activeCurriculumId, setActiveCurriculumId] = useState<number | null>(null);
  const [activeTierId, setActiveTierId] = useState<number | null>(null);

  const isAdmin = window.location.pathname.includes('admin-dashboard');
  const basePath = '/' + (window.location.pathname.split('/')[1] || 'admin-dashboard');

  const [subjectToDelete, setSubjectToDelete] = useState<SubjectData | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchSubjects = () => {
    api.get('/api/manage-subjects/')
      .then(res => {
        if (res.data.status === 'success') setSubjects(res.data.data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchSubjects();
    api.get('/api/core/curriculum/tiers/').then(res => {
      setTiers(Array.isArray(res.data) ? res.data : res.data.results ?? []);
    }).catch(() => {});
    api.get('/api/core/curriculum/curricula/').then(res => {
      setCurricula(Array.isArray(res.data) ? res.data : res.data.results ?? []);
    }).catch(() => {});
  }, []);

  const handleCurriculumSelect = (id: number | null) => {
    setActiveCurriculumId(id);
    setActiveTierId(null);
  };

  // Tiers that belong to the selected curriculum
  const tiersForActiveCurriculum = useMemo(
    () => activeCurriculumId ? tiers.filter(t => t.curriculum === activeCurriculumId) : tiers,
    [tiers, activeCurriculumId]
  );

  // Only show "All Tiers" tab + tier sub-tabs when the curriculum has MORE than 1 tier
  const showTierTabs = activeCurriculumId !== null && tiersForActiveCurriculum.length > 1;

  // If curriculum has exactly 1 tier, auto-filter by it so the view is already scoped
  const effectiveTierId = useMemo(() => {
    if (activeTierId !== null) return activeTierId;
    if (activeCurriculumId !== null && tiersForActiveCurriculum.length === 1) {
      return tiersForActiveCurriculum[0].id;
    }
    return null;
  }, [activeTierId, activeCurriculumId, tiersForActiveCurriculum]);

  // Resolve the correct department name for a subject given active curriculum
  const getEffectiveDept = (sub: SubjectData): string => {
    if (activeCurriculumId !== null) {
      const key = String(activeCurriculumId);
      const currDept = sub.curriculum_departments?.[key];
      if (currDept) return currDept;
    }
    return sub.department_name || UNCATEGORIZED;
  };

  // Resolve which tier names to display for a subject given active curriculum
  const getDisplayedTierNames = (sub: SubjectData): string[] => {
    if (activeCurriculumId !== null) {
      const key = String(activeCurriculumId);
      return sub.curriculum_tier_names?.[key] ?? [];
    }
    return sub.tier_names;
  };

  const filteredSubjects = useMemo(() => {
    let base = subjects;

    if (activeCurriculumId !== null) {
      base = base.filter(s => s.curriculum_ids.includes(activeCurriculumId));
    }
    if (effectiveTierId !== null) {
      base = base.filter(s => s.tier_ids.includes(effectiveTierId));
    }

    const q = searchTerm.trim().toLowerCase();
    if (q) {
      base = base.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.code.toLowerCase().includes(q) ||
        (s.department_name ?? '').toLowerCase().includes(q) ||
        s.assigned_teachers.some(t => t.toLowerCase().includes(q))
      );
    }
    return base;
  }, [subjects, activeCurriculumId, effectiveTierId, searchTerm]);

  const departmentGroups = useMemo(() => {
    const byDept = new Map<string, SubjectData[]>();
    filteredSubjects.forEach(s => {
      const key = getEffectiveDept(s);
      if (!byDept.has(key)) byDept.set(key, []);
      byDept.get(key)!.push(s);
    });

    byDept.forEach(list => {
      list.sort((a, b) => a.is_core === b.is_core ? a.name.localeCompare(b.name) : a.is_core ? -1 : 1);
    });

    return [...byDept.keys()]
      .sort((a, b) => {
        if (a === UNCATEGORIZED) return 1;
        if (b === UNCATEGORIZED) return -1;
        return a.localeCompare(b);
      })
      .map(dept => ({ department: dept, subjects: byDept.get(dept)! }));
  }, [filteredSubjects, activeCurriculumId]);

  const activeCurriculumObj = curricula.find(c => c.id === activeCurriculumId);
  const activeTierLabel = effectiveTierId ? tiers.find(t => t.id === effectiveTierId)?.name : null;

  const confirmDelete = async () => {
    if (!subjectToDelete) return;
    setIsDeleting(true);
    try {
      const res = await api.delete(`/api/academic-hub/delete-subject/${subjectToDelete.id}/`);
      if (res.data.status === 'success') {
        toast.success('Subject successfully deleted');
        fetchSubjects();
        setSubjectToDelete(null);
      } else {
        toast.error(res.data.message);
      }
    } catch {
      toast.error('Failed to connect to server');
    } finally {
      setIsDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto space-y-6 animate-pulse">
        <div className="h-12 w-80 bg-slate-200 dark:bg-slate-800 rounded-2xl" />
        <div className="h-80 bg-slate-200 dark:bg-slate-800 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-5 relative">

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-2xl text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10">
            <BookOpen className="w-7 h-7" strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-slate-800 dark:text-slate-100">Subject Assignments</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              {filteredSubjects.length} subject{filteredSubjects.length !== 1 ? 's' : ''}
              {activeCurriculumObj ? ` · ${activeCurriculumObj.code}` : ''}
              {activeTierLabel ? ` · ${activeTierLabel}` : ''}
              {' '}· grouped by department, core subjects first.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-full ring-1 ring-slate-200 dark:ring-slate-700 px-3 py-2 bg-slate-50 dark:bg-slate-800 focus-within:ring-2 focus-within:ring-emerald-500 dark:focus-within:ring-emerald-400 focus-within:bg-white dark:focus-within:bg-slate-800 transition-all w-full md:w-72">
          <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" />
          <input
            type="text"
            placeholder="Search subjects, code or teacher..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full bg-transparent outline-none text-sm text-slate-700 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500"
          />
        </div>
      </div>

      {/* ── Curriculum / Tier filter panel ────────────────────── */}
      {curricula.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm dark:shadow-none overflow-hidden">

          {/* Curriculum row */}
          <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-700 bg-gradient-to-r from-slate-50 dark:from-slate-800 to-white dark:to-slate-900 flex items-center gap-2">
            <GraduationCap className="w-4 h-4 text-slate-400 dark:text-slate-500" />
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Filter by Curriculum</span>
          </div>
          <div className="px-5 py-3 flex flex-wrap gap-2">
            <button
              onClick={() => handleCurriculumSelect(null)}
              className={`px-4 py-1.5 rounded-full text-xs font-bold border transition-all ${
                activeCurriculumId === null
                  ? 'bg-slate-800 text-white border-slate-800'
                  : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              All Curricula
            </button>
            {curricula.map(c => {
              const colors = CURRICULUM_COLORS[c.code] ?? {
                active: 'bg-slate-700 text-white border-slate-700',
                idle: 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800',
              };
              return (
                <button
                  key={c.id}
                  onClick={() => handleCurriculumSelect(c.id)}
                  className={`px-4 py-1.5 rounded-full text-xs font-bold border transition-all ${
                    activeCurriculumId === c.id ? colors.active : colors.idle
                  }`}
                >
                  {c.code} — {c.name}
                </button>
              );
            })}
          </div>

          {/* Tier sub-tabs: only when curriculum is active AND it has more than 1 tier */}
          {showTierTabs && (
            <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/40 flex flex-wrap gap-2 items-center">
              <Layers className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 shrink-0" />
              <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mr-1">Tier:</span>
              <button
                onClick={() => setActiveTierId(null)}
                className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all ${
                  activeTierId === null
                    ? 'bg-slate-700 text-white border-slate-700'
                    : 'bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                All Tiers
              </button>
              {tiersForActiveCurriculum.map(t => {
                const isCBC = activeCurriculumObj?.code === 'CBC';
                return (
                  <button
                    key={t.id}
                    onClick={() => setActiveTierId(t.id)}
                    className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all ${
                      activeTierId === t.id
                        ? (isCBC ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-indigo-600 text-white border-indigo-600')
                        : 'bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    {t.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Subject table, grouped by (curriculum-scoped) dept ── */}
      {departmentGroups.length === 0 ? (
        <div className="text-slate-400 dark:text-slate-500 bg-white dark:bg-slate-900 p-10 rounded-2xl border border-slate-100 dark:border-slate-700 text-center text-sm">
          {subjects.length === 0
            ? 'No subjects found. Please add them in the Academics Hub.'
            : `No subjects match the current filters${searchTerm ? ` or "${searchTerm}"` : ''}.`}
        </div>
      ) : (
        <div className="space-y-6">
          {departmentGroups.map(({ department, subjects: deptSubjects }) => (
            <div key={department} className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm dark:shadow-none border border-slate-100 dark:border-slate-700 overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 flex items-center gap-3">
                <span className={`px-2.5 py-1 rounded-md text-xs font-bold border ${deptStyle(department)}`}>
                  {department}
                </span>
                <span className="text-xs text-slate-400 dark:text-slate-500 font-medium">
                  {deptSubjects.length} subject{deptSubjects.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="text-slate-400 dark:text-slate-500 text-[11px] uppercase tracking-wider border-b border-slate-100 dark:border-slate-700">
                      <th className="px-6 py-3 font-bold">Code</th>
                      <th className="px-6 py-3 font-bold">Subject Name</th>
                      {/* Only show Tier column when "All Curricula" or multi-tier curriculum is selected */}
                      {(activeCurriculumId === null || showTierTabs) && (
                        <th className="px-6 py-3 font-bold">Tier(s)</th>
                      )}
                      <th className="px-6 py-3 font-bold">Active Teachers</th>
                      <th className="px-6 py-3 font-bold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm text-slate-700 dark:text-slate-200 divide-y divide-slate-50 dark:divide-slate-800">
                    {deptSubjects.map(sub => {
                      // Only show tiers that belong to the active curriculum
                      const displayedTierNames = getDisplayedTierNames(sub);
                      // Only show curriculum codes when "All Curricula" is active
                      const displayedCurriculumCodes = activeCurriculumId === null ? sub.curriculum_codes : [];

                      return (
                        <tr key={sub.id} className="hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                          <td className="px-6 py-4 font-mono text-slate-500 dark:text-slate-400 font-medium">{sub.code}</td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-slate-800 dark:text-slate-100">{sub.name}</span>
                              {sub.is_core ? (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 uppercase tracking-widest">Core</span>
                              ) : (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 uppercase tracking-widest">Elective</span>
                              )}
                            </div>
                            {/* Curriculum badges — only when "All Curricula" */}
                            {displayedCurriculumCodes.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {displayedCurriculumCodes.map(code => (
                                  <span
                                    key={code}
                                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                                      code === 'CBC'
                                        ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/40'
                                        : code === '8-4-4'
                                        ? 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-500/40'
                                        : 'bg-slate-50 dark:bg-slate-800/40 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                                    }`}
                                  >
                                    {code}
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>

                          {/* Tier column — scoped to active curriculum */}
                          {(activeCurriculumId === null || showTierTabs) && (
                            <td className="px-6 py-4">
                              {displayedTierNames.length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                  {displayedTierNames.map(name => (
                                    <span
                                      key={name}
                                      className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-400 border border-violet-200 dark:border-violet-500/40 whitespace-nowrap"
                                    >
                                      {name}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-xs text-slate-400 dark:text-slate-500 italic">All tiers</span>
                              )}
                            </td>
                          )}

                          <td className="px-6 py-4">
                            {sub.assigned_teachers.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {sub.assigned_teachers.slice(0, 5).map((teacher, idx) => (
                                  <span
                                    key={idx}
                                    className="bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 px-2 py-1 rounded text-xs whitespace-nowrap"
                                  >
                                    {teacher}
                                  </span>
                                ))}
                                {sub.assigned_teachers.length > 5 && (
                                  <span className="bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-2 py-1 rounded text-xs font-semibold">
                                    +{sub.assigned_teachers.length - 5} more
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 px-2 py-1 rounded border border-amber-100 dark:border-amber-500/20">
                                No Teachers Assigned
                              </span>
                            )}
                          </td>

                          <td className="px-6 py-4 text-right">
                            <div className="flex justify-end gap-3">
                              <button
                                onClick={() => navigate(`${basePath}/subjects/view/${sub.id}`)}
                                className="text-slate-400 dark:text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400 transition"
                                title="View broad details"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                              {isAdmin && (
                                <>
                                  <button
                                    onClick={() => navigate(`${basePath}/subjects/edit/${sub.id}`)}
                                    className="text-slate-400 dark:text-slate-500 hover:text-amber-600 dark:hover:text-amber-400 transition"
                                    title="Update & Assign Staff Pool"
                                  >
                                    <Edit className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => setSubjectToDelete(sub)}
                                    className="text-slate-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400 transition"
                                    title="Delete subject"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Delete confirmation modal ──────────────────────────── */}
      {subjectToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl dark:shadow-none border border-transparent dark:border-slate-700 w-full max-w-md overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-800">
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Confirm Deletion</h3>
              <button onClick={() => setSubjectToDelete(null)} className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 text-center space-y-4">
              <div className="mx-auto w-12 h-12 bg-red-100 dark:bg-red-500/10 rounded-full flex items-center justify-center mb-4">
                <Trash2 className="w-6 h-6 text-red-600 dark:text-red-400" />
              </div>
              <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100">Delete {subjectToDelete.name}?</h3>
              <p className="text-slate-500 dark:text-slate-400 text-sm">
                This will completely remove the subject from the curriculum. Any lesson plans, grades, or teacher assignments tied to this subject code will be permanently lost.
              </p>
              <div className="flex gap-4 mt-6">
                <button
                  onClick={() => setSubjectToDelete(null)}
                  disabled={isDeleting}
                  className="flex-1 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 py-2 rounded-md font-medium hover:bg-slate-200 dark:hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDelete}
                  disabled={isDeleting}
                  className="flex-1 bg-red-600 text-white py-2 rounded-md font-medium hover:bg-red-700 disabled:bg-red-400 dark:disabled:bg-red-900/60"
                >
                  {isDeleting ? 'Deleting...' : 'Permanently Delete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
