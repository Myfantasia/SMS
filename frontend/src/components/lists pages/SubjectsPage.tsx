import { useState, useEffect, useMemo } from 'react';
import { BookOpen, Eye, Edit, Trash2, X, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../../libs/axiosInstance';

interface SubjectData {
  id: number;
  code: string;
  name: string;
  department: string;
  is_core: boolean;
  assigned_teachers: string[];
}

// Fixed, sensible ordering instead of whatever order the department strings happen to sort in.
const DEPARTMENT_ORDER = ['Languages', 'Mathematics', 'Sciences', 'Humanities', 'Technical', 'None'];

const DEPT_STYLE: Record<string, string> = {
  Sciences: 'bg-cyan-100 text-cyan-700 border-cyan-200',
  Languages: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  Mathematics: 'bg-rose-100 text-rose-700 border-rose-200',
  Humanities: 'bg-amber-100 text-amber-700 border-amber-200',
  Technical: 'bg-purple-100 text-purple-700 border-purple-200',
  None: 'bg-slate-100 text-slate-600 border-slate-300',
};

export default function SubjectsPage() {
  const [subjects, setSubjects] = useState<SubjectData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const navigate = useNavigate();

  // ✅ RBAC PATH RESOLVER: Dynamically maps base dashboard routing trees
  const isAdmin = window.location.pathname.includes('admin-dashboard');
  const basePath = '/' + (window.location.pathname.split('/')[1] || 'admin-dashboard');

  // Delete Modal States
  const [subjectToDelete, setSubjectToDelete] = useState<SubjectData | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchSubjects = () => {
  api.get('/api/manage-subjects/')
    .then(res => {
      const response = res.data;
      if (response.status === 'success') {
        setSubjects(response.data);
      }
      setLoading(false);
    })
    .catch(err => {
      console.error("Failed to fetch subjects data", err);
      setLoading(false);
    });
};

  useEffect(() => {
    fetchSubjects();
  }, []);

  const openDeleteModal = (subject: SubjectData) => {
    setSubjectToDelete(subject);
  };

  const closeDeleteModal = () => {
    setSubjectToDelete(null);
  };

  const confirmDelete = async () => {
  if (!subjectToDelete) return;
  setIsDeleting(true);
  try {
    const response = await api.delete(`/api/academic-hub/delete-subject/${subjectToDelete.id}/`);
    const data = response.data;

    if (data.status === 'success') {
      toast.success('Subject successfully deleted');
      fetchSubjects();
      closeDeleteModal();
    } else {
      toast.error(data.message);
    }
  } catch (error) {
    console.error("Error deleting subject:", error);
    toast.error('Failed to connect to server');
  } finally {
    setIsDeleting(false);
  }
};

  // Arrange: group by department (fixed logical order), Core subjects before Electives,
  // alphabetical within each group — instead of one flat alphabetical dump.
  const departmentGroups = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    const matches = !q ? subjects : subjects.filter((s) =>
      s.name.toLowerCase().includes(q) ||
      s.code.toLowerCase().includes(q) ||
      s.department.toLowerCase().includes(q) ||
      s.assigned_teachers.some((t) => t.toLowerCase().includes(q))
    );

    const byDept = new Map<string, SubjectData[]>();
    matches.forEach((s) => {
      const key = s.department || 'None';
      if (!byDept.has(key)) byDept.set(key, []);
      byDept.get(key)!.push(s);
    });

    byDept.forEach((list) => {
      list.sort((a, b) => (a.is_core === b.is_core ? a.name.localeCompare(b.name) : a.is_core ? -1 : 1));
    });

    const orderedKeys = [
      ...DEPARTMENT_ORDER.filter((d) => byDept.has(d)),
      ...[...byDept.keys()].filter((d) => !DEPARTMENT_ORDER.includes(d)).sort(),
    ];

    return orderedKeys.map((dept) => ({ department: dept, subjects: byDept.get(dept)! }));
  }, [subjects, searchTerm]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto space-y-6 animate-pulse">
        <div className="h-12 w-80 bg-slate-200 rounded-2xl"></div>
        <div className="h-80 bg-slate-200 rounded-2xl"></div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 relative">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-2xl text-emerald-600 bg-emerald-50">
            <BookOpen className="w-7 h-7" strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-slate-800">Subject Assignments</h1>
            <p className="text-sm text-slate-500 mt-0.5">{subjects.length} subjects &middot; grouped by department, core subjects first.</p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-full ring-1 ring-slate-200 px-3 py-2 bg-slate-50 focus-within:ring-2 focus-within:ring-emerald-500 focus-within:bg-white transition-all w-full md:w-72">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            type="text"
            placeholder="Search subjects, code or teacher..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-transparent outline-none text-sm text-slate-700 placeholder:text-slate-400"
          />
        </div>
      </div>

      {/* Subjects grouped by department */}
      {departmentGroups.length === 0 ? (
        <div className="text-slate-400 bg-white p-10 rounded-2xl border border-slate-100 text-center text-sm">
          {subjects.length === 0 ? 'No subjects found. Please add them in the Academics Hub.' : `No subjects match "${searchTerm}".`}
        </div>
      ) : (
        <div className="space-y-6">
          {departmentGroups.map(({ department, subjects: deptSubjects }) => (
            <div key={department} className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex items-center gap-3">
                <span className={`px-2.5 py-1 rounded-md text-xs font-bold border ${DEPT_STYLE[department] || DEPT_STYLE.None}`}>
                  {department === 'None' ? 'Unassigned' : department}
                </span>
                <span className="text-xs text-slate-400 font-medium">{deptSubjects.length} subject{deptSubjects.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="text-slate-400 text-[11px] uppercase tracking-wider border-b border-slate-100">
                      <th className="px-6 py-3 font-bold">Code</th>
                      <th className="px-6 py-3 font-bold">Subject Name</th>
                      <th className="px-6 py-3 font-bold">Active Teachers</th>
                      <th className="px-6 py-3 font-bold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm text-slate-700 divide-y divide-slate-50">
                    {deptSubjects.map((sub) => (
                      <tr key={sub.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-6 py-4 font-mono text-slate-500 font-medium">
                          {sub.code}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-800">{sub.name}</span>
                            {sub.is_core ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700 uppercase tracking-widest">Core</span>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 uppercase tracking-widest">Elective</span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          {sub.assigned_teachers.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {sub.assigned_teachers.map((teacher, idx) => (
                                <span key={idx} className="bg-slate-100 border border-slate-200 text-slate-700 px-2 py-1 rounded text-xs whitespace-nowrap">
                                  {teacher}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded border border-amber-100">
                              No Teachers Assigned
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex justify-end gap-3">
                            <button
                              onClick={() => navigate(`${basePath}/subjects/view/${sub.id}`)}
                              className="text-slate-400 hover:text-emerald-600 transition"
                              title="View broad details"
                            >
                              <Eye className="w-4 h-4" />
                            </button>

                            {isAdmin && (
                              <>
                                <button
                                  onClick={() => navigate(`${basePath}/subjects/edit/${sub.id}`)}
                                  className="text-slate-400 hover:text-amber-600 transition"
                                  title="Update & Assign Staff Pool"
                                >
                                  <Edit className="w-4 h-4" />
                                </button>

                                <button
                                  onClick={() => openDeleteModal(sub)}
                                  className="text-slate-400 hover:text-red-600 transition"
                                  title="Delete subject"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* DELETE CONFIRMATION MODAL (CARD) */}
      {subjectToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="text-lg font-bold text-slate-800">Confirm Deletion</h3>
              <button onClick={closeDeleteModal} className="text-slate-400 hover:text-slate-600 transition" title="Close modal">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 text-center space-y-4">
              <div className="mx-auto w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mb-4">
                <Trash2 className="w-6 h-6 text-red-600" />
              </div>
              <h3 className="text-xl font-bold text-slate-800">
                Delete {subjectToDelete.name}?
              </h3>
              <p className="text-slate-500 text-sm">
                This will completely remove the subject from the curriculum. Any lesson plans, grades, or teacher assignments tied to this subject code will be permanently lost.
              </p>
              <div className="flex gap-4 mt-6">
                <button onClick={closeDeleteModal} disabled={isDeleting} className="flex-1 bg-slate-100 text-slate-700 py-2 rounded-md font-medium hover:bg-slate-200">
                  Cancel
                </button>
                <button onClick={confirmDelete} disabled={isDeleting} className="flex-1 bg-red-600 text-white py-2 rounded-md font-medium hover:bg-red-700 disabled:bg-red-400">
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
