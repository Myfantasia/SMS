import { useState } from 'react';
import { Eye, Edit, Trash2, X, Users, Sparkles, Clock, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../libs/axiosInstance';

interface Subject {
  id: number;
  code: string;
  name: string;
  department_id: number | null;
  department_name: string | null;
  is_core: boolean;
  requires_synchronized_grade_blocking?: boolean;
  synchronized_blocking_min_grade?: number | null;
  live_enrollment?: number;
  assigned_teachers?: string[];
  assigned_teacher_ids?: number[];
}

interface TeacherOption {
  id: number;
  name: string;
  username: string;
}

interface Curriculum {
  id: number;
  code: string;
  name: string;
}

interface Tier {
  id: number;
  curriculum: number;
  name: string;
  code: string;
}

interface SubjectCurriculumProfile {
  id: number;
  subject: number;
  curriculum: number;
  tier: number | null;
  is_core: boolean | null;
  department: number | null;
}

interface Department {
  id: number;
  name: string;
  is_active: boolean;
}

interface SubjectsCardProps {
  subjects: Subject[];
  curricula: Curriculum[];
  tiers: Tier[];
  subjectProfiles: SubjectCurriculumProfile[];
  departments: Department[];
  onRefresh: () => void;
}

export default function SubjectsCard({ subjects, curricula, tiers, subjectProfiles, departments, onRefresh }: SubjectsCardProps) {
  const [selectedSubject, setSelectedSubject] = useState<Subject | null>(null);
  const [modalType, setModalType] = useState<'view' | 'edit' | 'delete' | null>(null);

  // Added Form States for Editing
  const [editCode, setEditCode] = useState('');
  const [editName, setEditName] = useState('');
  const [editDepartmentId, setEditDepartmentId] = useState<number | ''>('');
  const [editIsCore, setEditIsCore] = useState(false);
  const [editSyncBlocking, setEditSyncBlocking] = useState(false);
  const [editSyncMinGrade, setEditSyncMinGrade] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Teacher qualification checklist for the edit modal
  const [allTeachers, setAllTeachers] = useState<TeacherOption[]>([]);
  const [selectedTeacherIds, setSelectedTeacherIds] = useState<Set<number>>(new Set());
  const [loadingTeachers, setLoadingTeachers] = useState(false);
  const [teacherFilter, setTeacherFilter] = useState('');

  // Labels this subject's curriculum/tier assignments for the table badges — e.g. "8-4-4",
  // or "CBC · Junior Secondary" when scoped to one tier — plus the TRUE effective core/elective
  // status for that specific context (the profile's own override if set, else the subject's
  // flat default), since a subject can be core under one curriculum and elective under another.
  const curriculumBadges = (subject: Subject) =>
    subjectProfiles
      .filter((p) => p.subject === subject.id)
      .map((p) => {
        const curriculum = curricula.find((c) => c.id === p.curriculum);
        const tier = p.tier ? tiers.find((t) => t.id === p.tier) : undefined;
        if (!curriculum) return null;
        const label = tier ? `${curriculum.code} · ${tier.name}` : curriculum.code;
        const isCore = p.is_core ?? subject.is_core;
        // A subject's department can differ per curriculum (CBC and 8-4-4 group subjects
        // differently) — resolved from this profile row, not the subject's flat default.
        const deptName = p.department ? departments.find((d) => d.id === p.department)?.name : undefined;
        return { label, isCore, deptName };
      })
      .filter((badge): badge is { label: string; isCore: boolean; deptName: string | undefined } => !!badge);

  // Departments are now admin-defined (not a fixed 6-name list), so colors are hashed from the
  // name instead of switch-cased — every department still gets a stable, distinct color.
  const DEPT_PALETTE = [
    'bg-cyan-100 text-cyan-700 border-cyan-200',
    'bg-indigo-100 text-indigo-700 border-indigo-200',
    'bg-rose-100 text-rose-700 border-rose-200',
    'bg-amber-100 text-amber-700 border-amber-200',
    'bg-emerald-100 text-emerald-700 border-emerald-200',
    'bg-purple-100 text-purple-700 border-purple-200',
    'bg-orange-100 text-orange-700 border-orange-200',
    'bg-teal-100 text-teal-700 border-teal-200',
    'bg-pink-100 text-pink-700 border-pink-200',
  ];
  const getDeptColor = (deptName: string | null) => {
    if (!deptName) return 'bg-slate-100 text-slate-600 border-slate-300';
    let hash = 0;
    for (let i = 0; i < deptName.length; i++) hash = (hash * 31 + deptName.charCodeAt(i)) >>> 0;
    return DEPT_PALETTE[hash % DEPT_PALETTE.length];
  };

  if (subjects.length === 0) {
    return <div className="p-8 text-center text-slate-400">No subjects configured yet.</div>;
  }

  // Lazily loads the full teacher directory the first time the edit modal needs it,
  // so switching between subjects doesn't re-fetch on every open.
  const fetchAllTeachers = async () => {
    if (allTeachers.length > 0) return;
    setLoadingTeachers(true);
    try {
      const res = await api.get('/api/approved-users/teachers/');
      const list = Array.isArray(res.data?.data) ? res.data.data : [];
      setAllTeachers(list.map((t: { id: number; name: string; username: string }) => ({
        id: t.id, name: t.name, username: t.username,
      })));
    } catch (err) {
      console.error('Failed to load teachers', err);
    } finally {
      setLoadingTeachers(false);
    }
  };

  const openAction = (subject: Subject, type: 'view' | 'edit' | 'delete') => {
    setSelectedSubject(subject);
    setModalType(type);
    // Pre-fill edit states
    if (type === 'edit') {
      setEditCode(subject.code);
      setEditName(subject.name);
      setEditDepartmentId(subject.department_id ?? '');
      setEditIsCore(subject.is_core);
      setEditSyncBlocking(!!subject.requires_synchronized_grade_blocking);
      setEditSyncMinGrade(subject.synchronized_blocking_min_grade != null ? String(subject.synchronized_blocking_min_grade) : '');
      setSelectedTeacherIds(new Set(subject.assigned_teacher_ids ?? []));
      setTeacherFilter('');
      fetchAllTeachers();
    }
  };

  const toggleTeacher = (teacherId: number) => {
    setSelectedTeacherIds(prev => {
      const next = new Set(prev);
      if (next.has(teacherId)) next.delete(teacherId); else next.add(teacherId);
      return next;
    });
  };

  const closeModal = () => {
    setSelectedSubject(null);
    setModalType(null);
  };

  // Submit Edit to Backend
const handleEditSubmit = async () => {
  if (!selectedSubject) return;
  setIsSubmitting(true);
  
  try {
    const response = await api.put(`/api/academic-hub/edit-subject/${selectedSubject.id}/`, {
      code: editCode,
      name: editName,
      department_id: editDepartmentId || null,
      is_core: editIsCore,
      requires_synchronized_grade_blocking: editSyncBlocking,
      synchronized_blocking_min_grade: editSyncBlocking && editSyncMinGrade ? Number(editSyncMinGrade) : null,
      teacher_ids: Array.from(selectedTeacherIds),
    });
    const data = response.data;
    
    if (data.status === 'success') {
      toast.success(data.message);
      onRefresh();
      closeModal();
    } else {
      toast.error(data.message);
    }
  } catch (error: any) {
    console.error("Error editing subject:", error);
    const errMsg = error.response?.data?.message || "Failed to connect to the server.";
    toast.error(errMsg);
  } finally {
    setIsSubmitting(false);
  }
};

  // Submit Delete to Backend
const handleDeleteConfirm = async () => {
  if (!selectedSubject) return;
  setIsSubmitting(true);
  
  try {
    const response = await api.delete(`/api/academic-hub/delete-subject/${selectedSubject.id}/`);
    const data = response.data;
    
    if (data.status === 'success') {
      toast.success(data.message);
      onRefresh();
      closeModal();
    } else {
      toast.error(data.message);
    }
  } catch (error: any) {
    console.error("Error deleting subject:", error);
    const errMsg = error.response?.data?.message || "Failed to connect to the server.";
    toast.error(errMsg);
  } finally {
    setIsSubmitting(false);
  }
};

  return (
    <div className="w-full relative">
      <table className="w-full text-sm text-left">
        <thead className="text-xs text-slate-400 uppercase bg-white sticky top-0 shadow-sm border-b border-slate-100">
          <tr>
            <th className="px-4 py-4 font-medium w-1/6">Code</th>
            <th className="px-4 py-4 font-medium w-1/4">Subject Name</th>
            <th className="px-4 py-4 font-medium w-1/6">Department</th>
            <th className="px-4 py-4 font-medium w-1/5">Teachers Assigned</th>
            <th className="px-4 py-4 font-medium w-1/6">Live Enrollment</th>
            <th className="px-4 py-4 font-medium text-right w-1/6">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {subjects.map((sub) => {
            const teacherCount = sub.assigned_teachers?.length ?? 0;
            return (
            <tr key={sub.id} className="hover:bg-slate-50 transition-colors group">
              <td className="px-4 py-4 font-mono text-xs font-semibold text-slate-500">
                {sub.code}
              </td>
              <td className="px-4 py-4 font-medium text-slate-800">
                {(() => {
                  const badges = curriculumBadges(sub);
                  // Zero profiles = shared/global subject with one flat truth (Subject.is_core).
                  // One or more profiles = core-ness is resolved per curriculum/tier below instead,
                  // since it can legitimately differ from one curriculum to another.
                  if (badges.length === 0) {
                    return (
                      <>
                        <div className="flex items-center gap-2">
                          {sub.name}
                          {sub.is_core && <span className="text-[10px] uppercase bg-slate-800 text-white px-1.5 py-0.5 rounded">Core</span>}
                        </div>
                        <span className="text-[10px] text-slate-300 italic">Not categorized — assign in Curriculum Hub</span>
                      </>
                    );
                  }
                  return (
                    <>
                      <div>{sub.name}</div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {badges.map(({ label, isCore, deptName }, i) => (
                          <span
                            key={i}
                            title={isCore ? 'Core in this curriculum/tier' : 'Elective in this curriculum/tier'}
                            className={`text-[10px] font-semibold border px-1.5 py-0.5 rounded-full ${
                              isCore
                                ? 'bg-slate-800 text-white border-slate-800'
                                : 'bg-amber-50 text-amber-700 border-amber-200'
                            }`}
                          >
                            {label} &middot; {isCore ? 'Core' : 'Elective'}{deptName ? ` · ${deptName}` : ''}
                          </span>
                        ))}
                      </div>
                    </>
                  );
                })()}
              </td>
              <td className="px-4 py-4">
                <span className={`px-2 py-1 rounded-md text-xs font-medium border ${getDeptColor(sub.department_name)}`}>
                  {sub.department_name ?? 'Uncategorized'}
                </span>
              </td>
              <td className="px-4 py-4">
                {teacherCount > 0 ? (
                  <span
                    className="inline-flex items-center gap-1.5 text-xs font-semibold bg-indigo-50 text-indigo-700 px-2 py-1 rounded-full"
                    title={sub.assigned_teachers?.join(', ')}
                  >
                    <Users className="w-3 h-3" /> {teacherCount} teacher{teacherCount === 1 ? '' : 's'}
                  </span>
                ) : (
                  <span className="text-xs text-slate-300 italic">Unassigned</span>
                )}
              </td>
              <td className="px-4 py-4 text-slate-500">
                <div className="flex items-center gap-1.5" title="Students enrolled this academic year">
                  <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
                  <span className="font-semibold text-slate-700">{sub.live_enrollment ?? 0}</span> students
                </div>
              </td>
              <td className="px-4 py-4 text-right">
                <div className="flex items-center justify-end gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                   <button type="button" onClick={() => openAction(sub, 'view')} className="text-slate-400 hover:text-emerald-600 transition-colors p-1" title="Subject Insights">
                     <Eye className="w-4 h-4" />
                   </button>
                   <button type="button" onClick={() => openAction(sub, 'edit')} className="text-slate-400 hover:text-amber-600 transition-colors p-1" title="Edit Subject">
                     <Edit className="w-4 h-4" />
                   </button>
                   <button type="button" onClick={() => openAction(sub, 'delete')} className="text-slate-400 hover:text-red-600 transition-colors p-1" title="Delete Subject">
                     <Trash2 className="w-4 h-4" />
                   </button>
                </div>
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>

      {/* MODALS OVERLAY */}
      {modalType && selectedSubject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
            
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="text-lg font-bold text-slate-800 capitalize">
                {modalType === 'view' ? 'Subject Intelligence' : modalType === 'edit' ? 'Edit Subject Configuration' : 'Confirm Deletion'}
              </h3>
              <button type="button" onClick={closeModal} className="text-slate-400 hover:text-slate-600 transition" title="Close">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body - VIEW */}
            {modalType === 'view' && (
              <div className="p-6 overflow-y-auto space-y-6 bg-slate-50/50">
                <div>
                  <h2 className="text-2xl font-black text-slate-800">{selectedSubject.code} - {selectedSubject.name}</h2>
                  <p className="text-sm font-medium text-slate-500 mt-1 flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded border ${getDeptColor(selectedSubject.department_name)}`}>{selectedSubject.department_name ?? 'Uncategorized'}</span>
                    {selectedSubject.is_core ? 'Core Requirement' : 'Elective'}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                    <div className="flex items-center gap-2 text-indigo-600 mb-2 font-semibold">
                      <Users className="w-4 h-4" /> Active Teachers
                    </div>
                    {selectedSubject.assigned_teachers && selectedSubject.assigned_teachers.length > 0 ? (
                      <ul className="text-sm text-slate-600 space-y-1">
                        {selectedSubject.assigned_teachers.map((name) => (
                          <li key={name} className="font-medium text-slate-800">{name}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                        No teachers currently assigned to this subject.
                      </p>
                    )}
                  </div>
                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                    <div className="flex items-center gap-2 text-emerald-600 mb-2 font-semibold">
                      <Sparkles className="w-4 h-4" /> Live Enrollment
                    </div>
                    <p className="text-sm text-slate-600">
                      <span className="font-bold text-2xl text-slate-800">{selectedSubject.live_enrollment ?? 0}</span> students enrolled this academic year
                    </p>
                  </div>
                </div>

                <div className="flex flex-col items-center justify-center text-center p-8 bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
                  <Clock className="w-8 h-8 text-slate-300 mb-3" />
                  <p className="text-sm font-semibold text-slate-500">Class performance breakdown coming soon</p>
                  <p className="text-xs text-slate-400 mt-1">Per-class mean scores for this subject will appear here once wired up.</p>
                </div>
              </div>
            )}

            {/* Modal Body - EDIT */}
            {modalType === 'edit' && (
              <div className="p-6 space-y-4 overflow-y-auto">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Subject Code</label>
                    <input type="text" value={editCode} onChange={(e) => setEditCode(e.target.value)} placeholder="Enter subject code" className="w-full border border-slate-300 rounded-md p-2 uppercase focus:ring-2 focus:ring-emerald-500 outline-none" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Subject Name</label>
                    <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Enter subject name" className="w-full border border-slate-300 rounded-md p-2 focus:ring-2 focus:ring-emerald-500 outline-none" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4 items-end">
                  <div className="space-y-2">
                    <label htmlFor="department-select" className="text-sm font-medium text-slate-700">Department</label>
                    <select id="department-select" value={editDepartmentId} onChange={(e) => setEditDepartmentId(e.target.value ? Number(e.target.value) : '')} className="w-full border border-slate-300 rounded-md p-2 focus:ring-2 focus:ring-emerald-500 outline-none">
                      <option value="">Uncategorized</option>
                      {departments.filter((d) => d.is_active || d.id === editDepartmentId).map((d) => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                  </div>
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-700 pb-2.5 cursor-pointer">
                    <input type="checkbox" checked={editIsCore} onChange={(e) => setEditIsCore(e.target.checked)} className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
                    Core Requirement (not an elective)
                  </label>
                </div>

                <div className="space-y-2 bg-slate-50 border border-slate-100 rounded-md p-3">
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-700 cursor-pointer">
                    <input type="checkbox" checked={editSyncBlocking} onChange={(e) => setEditSyncBlocking(e.target.checked)} className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
                    Shared/synchronized block subject (e.g. Technical, Agriculture)
                  </label>
                  <p className="text-xs text-slate-400">Routes this subject through the shared lecture-hall / elective-splitting engine instead of ordinary standalone scheduling.</p>
                  {editSyncBlocking && (
                    <div className="pt-1">
                      <label htmlFor="sync-min-grade" className="text-xs font-medium text-slate-500 block mb-1">Only from this grade level upward (optional)</label>
                      <input
                        id="sync-min-grade" type="number" min={1} value={editSyncMinGrade}
                        placeholder="e.g. 10"
                        onChange={(e) => setEditSyncMinGrade(e.target.value)}
                        className="w-32 border border-slate-300 rounded-md p-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                      />
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-slate-700">Qualified Teachers</label>
                    <span className="text-xs text-slate-400">{selectedTeacherIds.size} selected</span>
                  </div>
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={teacherFilter}
                      onChange={(e) => setTeacherFilter(e.target.value)}
                      placeholder="Filter teachers…"
                      className="w-full border border-slate-300 rounded-md p-2 pl-8 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                    />
                  </div>
                  <div className="border border-slate-200 rounded-md max-h-40 overflow-y-auto divide-y divide-slate-50">
                    {loadingTeachers ? (
                      <p className="text-xs text-slate-400 italic p-3">Loading teachers…</p>
                    ) : allTeachers.filter(t => t.name.toLowerCase().includes(teacherFilter.toLowerCase())).length === 0 ? (
                      <p className="text-xs text-slate-400 italic p-3">No teachers match.</p>
                    ) : (
                      allTeachers
                        .filter(t => t.name.toLowerCase().includes(teacherFilter.toLowerCase()))
                        .map(t => (
                          <label key={t.id} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selectedTeacherIds.has(t.id)}
                              onChange={() => toggleTeacher(t.id)}
                              className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                            />
                            <span className="text-slate-700 font-medium">{t.name}</span>
                            <span className="text-xs text-slate-400">{t.username}</span>
                          </label>
                        ))
                    )}
                  </div>
                </div>

                <button type="button" onClick={handleEditSubmit} disabled={isSubmitting} className="w-full bg-emerald-600 text-white font-medium py-2 rounded-md hover:bg-emerald-700 mt-4 disabled:bg-emerald-400">
                  {isSubmitting ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            )}

            {/* Modal Body - DELETE */}
            {modalType === 'delete' && (
              <div className="p-6 text-center space-y-4">
                <div className="mx-auto w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mb-4">
                  <Trash2 className="w-6 h-6 text-red-600" />
                </div>
                <h3 className="text-xl font-bold text-slate-800">Delete {selectedSubject.name}?</h3>
                <p className="text-slate-500 text-sm">This will permanently remove the curriculum listing. All grades, lesson plans, and assignments tied directly to this subject code will be orphaned.</p>
                <div className="flex gap-4 mt-6">
                  <button type="button" onClick={closeModal} disabled={isSubmitting} className="flex-1 bg-slate-100 text-slate-700 py-2 rounded-md font-medium hover:bg-slate-200">Cancel</button>
                  <button type="button" onClick={handleDeleteConfirm} disabled={isSubmitting} className="flex-1 bg-red-600 text-white py-2 rounded-md font-medium hover:bg-red-700 disabled:bg-red-400">
                     {isSubmitting ? 'Deleting...' : 'Permanently Delete'}
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>
      )}
    </div>
  );
}