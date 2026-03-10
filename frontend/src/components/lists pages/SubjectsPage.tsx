import { useState, useEffect } from 'react';
import { BookOpen, Eye, Edit, Trash2, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';

interface SubjectData {
  id: number;
  code: string;
  name: string;
  department: string;
  is_core: boolean;
  assigned_teachers: string[];
}

export default function SubjectsPage() {
  const [subjects, setSubjects] = useState<SubjectData[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  // Delete Modal States
  const [subjectToDelete, setSubjectToDelete] = useState<SubjectData | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchSubjects = () => {
    fetch('http://localhost:8000/api/manage-subjects/')
      .then(res => res.json())
      .then(response => {
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
      const response = await fetch(`http://localhost:8000/api/academic-hub/delete-subject/${subjectToDelete.id}/`, {
        method: 'DELETE',
      });
      const data = await response.json();
      if (data.status === 'success') {
        toast.success('Subject successfully deleted');
        fetchSubjects(); // Refresh list
        closeDeleteModal();
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      toast.error('Failed to connect to server');
    } finally {
      setIsDeleting(false);
    }
  };

  if (loading) return <div className="p-6 text-slate-500">Loading Subjects...</div>;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 relative">
      {/* Header Section */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-emerald-600" />
            Subject Assignments
          </h1>
          <p className="text-sm text-slate-500 mt-1">Track subjects and the teachers actively teaching them.</p>
        </div>
      </div>

      {/* Subjects Data Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider border-b border-slate-200">
                <th className="px-6 py-4 font-medium">Code</th>
                <th className="px-6 py-4 font-medium">Subject Name</th>
                <th className="px-6 py-4 font-medium">Department</th>
                <th className="px-6 py-4 font-medium">Active Teachers</th>
                <th className="px-6 py-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="text-sm text-slate-700 divide-y divide-slate-100">
              {subjects.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-slate-400">
                    No subjects found. Please add them in the Academics Hub.
                  </td>
                </tr>
              ) : (
                subjects.map((sub) => (
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
                    <td className="px-6 py-4 text-slate-500">
                      {sub.department}
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
                    <td className="px-6 py-4 text-right flex justify-end gap-3">
                      
                      {/* VIEW BUTTON - Redirects to dedicated View page */}
                      <button 
                        onClick={() => navigate(`/admin-dashboard/subjects/view/${sub.id}`)}
                        className="text-slate-400 hover:text-emerald-600 transition" 
                        title="View broad details"
                      >
                        <Eye className="w-4 h-4" />
                      </button>

                      {/* EDIT BUTTON - Redirects to dedicated Edit page */}
                      <button 
                        onClick={() => navigate(`/admin-dashboard/subjects/edit/${sub.id}`)}
                        className="text-slate-400 hover:text-amber-600 transition" 
                        title="Update & Assign Staff Pool"
                      >
                        <Edit className="w-4 h-4" />
                      </button>

                      {/* DELETE BUTTON - Opens Card/Modal */}
                      <button 
                        onClick={() => openDeleteModal(sub)}
                        className="text-slate-400 hover:text-red-600 transition" 
                        title="Delete subject"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>

                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

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