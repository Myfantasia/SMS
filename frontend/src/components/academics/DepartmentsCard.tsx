import { useState, Fragment } from 'react';
import { Pencil, Trash2, EyeOff, Eye, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../libs/axiosInstance';

export interface Department {
  id: number;
  name: string;
  description: string;
  is_active: boolean;
  subject_count: number;
  curriculum_id: number;
}

interface DepartmentsCardProps {
  departments: Department[];
  curricula?: any[];
  subjects?: any[];
  subjectProfiles?: any[];
  onRefresh: () => void;
  onEdit?: (department: Department) => void;
}

export default function DepartmentsCard({ departments, curricula, subjects, subjectProfiles, onRefresh, onEdit }: DepartmentsCardProps) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const toggleActive = async (d: Department) => {
    setBusyId(d.id);
    try {
      await api.put(`/api/departments/${d.id}/`, { is_active: !d.is_active });
      toast.success(d.is_active ? `${d.name} deactivated.` : `${d.name} reactivated.`);
      onRefresh();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to update department.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (d: Department) => {
    const warning = d.subject_count > 0
      ? `Delete "${d.name}"? ${d.subject_count} subject(s) will become uncategorized.`
      : `Delete "${d.name}"?`;
    if (!window.confirm(warning)) return;
    setBusyId(d.id);
    try {
      await api.delete(`/api/departments/${d.id}/`);
      toast.success(`${d.name} deleted.`);
      onRefresh();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to delete department.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="p-5">
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
        Departments group subjects for staffing, quota policy, and category limits. Renaming a
        department is safe — every subject in it stays categorized. The Auto-Fill Subject Quotas
        ladder recognizes a few names by convention (Languages, Mathematics, Sciences, Humanities
        &amp; Religious Education, Technical/Business departments, PE) — a Quota Default Rule
        (Django admin) covers anything beyond those.
      </p>
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-700 overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="text-slate-400 dark:text-slate-500 text-[11px] uppercase tracking-wider border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40">
              <th className="px-5 py-3 font-bold">Name</th>
              <th className="px-5 py-3 font-bold">Description</th>
              <th className="px-5 py-3 font-bold">Subjects</th>
              <th className="px-5 py-3 font-bold">Status</th>
              <th className="px-5 py-3 font-bold text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="text-sm text-slate-700 dark:text-slate-200 divide-y divide-slate-50 dark:divide-slate-800">
            {departments.length === 0 ? (
              <tr><td colSpan={5} className="p-8 text-center text-slate-400 dark:text-slate-500">No departments yet.</td></tr>
            ) : (
              departments.map((d) => {
                const busy = busyId === d.id;
                const expanded = expandedId === d.id;
                const deptSubjectProfiles = subjectProfiles?.filter(p => p.department === d.id) || [];
                const deptSubjects = subjects?.filter(s => deptSubjectProfiles.some(p => p.subject === s.id)) || [];

                return (
                  <Fragment key={d.id}>
                    <tr
                      onClick={() => setExpandedId(expanded ? null : d.id)}
                      className={`hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer ${!d.is_active ? 'opacity-50' : ''}`}
                    >
                      <td className="px-5 py-3 font-semibold text-slate-800 dark:text-slate-100">{d.name}</td>
                      <td className="px-5 py-3 text-slate-500 dark:text-slate-400 text-xs max-w-xs truncate">{d.description || '—'}</td>
                      <td className="px-5 py-3 text-slate-500 dark:text-slate-400">{d.subject_count}</td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold border ${d.is_active ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/40' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700'}`}>
                          {d.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex justify-end gap-1.5 items-center">
                          {onEdit && (
                            <button type="button" title="Rename / edit" disabled={busy} onClick={(e) => { e.stopPropagation(); onEdit(d); }}
                              className="p-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-500/10 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 text-indigo-700 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/40 disabled:opacity-50">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button type="button" title={d.is_active ? 'Deactivate' : 'Reactivate'} disabled={busy} onClick={(e) => { e.stopPropagation(); toggleActive(d); }}
                            className="p-1.5 rounded-lg bg-amber-50 dark:bg-amber-500/10 hover:bg-amber-100 dark:hover:bg-amber-500/20 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-500/40 disabled:opacity-50">
                            {d.is_active ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                          <button type="button" title="Delete" disabled={busy} onClick={(e) => { e.stopPropagation(); handleDelete(d); }}
                            className="p-1.5 rounded-lg bg-red-50 dark:bg-red-500/10 hover:bg-red-100 dark:hover:bg-red-500/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-500/40 disabled:opacity-50">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                          <ChevronRight className={`w-4 h-4 ml-2 text-slate-300 dark:text-slate-600 transition-transform ${expanded ? 'rotate-90' : ''}`} />
                        </div>
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="bg-slate-50/50 dark:bg-slate-800/40">
                        <td colSpan={5} className="px-6 py-5 border-b border-slate-100 dark:border-slate-700 shadow-inner">
                          <div className="space-y-3">
                            <h4 className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider">Subjects in this Department</h4>
                            {deptSubjects.length > 0 ? (
                              <div className="flex flex-wrap gap-2">
                                {deptSubjects.map(s => (
                                  <span key={s.id} className="px-2.5 py-1 rounded-full text-xs font-medium border bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 shadow-sm dark:shadow-none">
                                    {s.name}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <p className="text-sm text-slate-400 dark:text-slate-500 italic">No subjects categorized under this department yet.</p>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
