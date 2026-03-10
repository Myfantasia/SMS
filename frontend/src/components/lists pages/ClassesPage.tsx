import { useState, useEffect } from 'react';
import { Layers, Eye, Edit, Trash2, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';

interface Stream {
  id: number;
  name: string;
  capacity: number;
  class_teacher: string;
}

interface GradeData {
  grade_id: number;
  grade_name: string;
  streams: Stream[];
}

export default function ClassesPage() {
  const [grades, setGrades] = useState<GradeData[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  // Delete Modal States
  const [streamToDelete, setStreamToDelete] = useState<{ stream: Stream, gradeName: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchClasses = () => {
    fetch('http://localhost:8000/api/manage-classes/')
      .then(res => res.json())
      .then(response => {
        if (response.status === 'success') {
          setGrades(response.data);
        }
        setLoading(false);
      })
      .catch(err => {
        console.error("Failed to fetch classes data", err);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchClasses();
  }, []);

  const openDeleteModal = (stream: Stream, gradeName: string) => {
    setStreamToDelete({ stream, gradeName });
  };

  const closeDeleteModal = () => {
    setStreamToDelete(null);
  };

  const confirmDelete = async () => {
    if (!streamToDelete) return;
    setIsDeleting(true);
    try {
      const response = await fetch(`http://localhost:8000/api/academic-hub/delete-stream/${streamToDelete.stream.id}/`, {
        method: 'DELETE',
      });
      const data = await response.json();
      if (data.status === 'success') {
        toast.success('Class successfully deleted');
        fetchClasses(); // Refresh list
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

  if (loading) return <div className="p-6 text-slate-500">Loading Classes...</div>;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8 relative">
      {/* Header Section */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Layers className="w-6 h-6 text-blue-600" />
            Class Operations
          </h1>
          <p className="text-sm text-slate-500 mt-1">Manage physical classes, assign class teachers, and view capacities.</p>
        </div>
      </div>

      {/* Render a table for each Grade Level */}
      {grades.length === 0 ? (
        <div className="text-slate-500 bg-white p-6 rounded-lg border border-slate-200">No classes found. Set them up in the Academics Hub first.</div>
      ) : (
        grades.map((grade) => (
          <div key={grade.grade_id} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="bg-slate-50 px-6 py-4 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-700">{grade.grade_name}</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-white text-slate-500 text-xs uppercase tracking-wider border-b border-slate-200">
                    <th className="px-6 py-3 font-medium">Stream Name</th>
                    <th className="px-6 py-3 font-medium">Class Teacher</th>
                    <th className="px-6 py-3 font-medium">Capacity</th>
                    <th className="px-6 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="text-sm text-slate-700 divide-y divide-slate-100">
                  {grade.streams.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-4 text-center text-slate-400">No streams available for this grade.</td>
                    </tr>
                  ) : (
                    grade.streams.map((stream) => (
                      <tr key={stream.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-6 py-4 font-semibold text-slate-800">
                          {grade.grade_name} {stream.name}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${stream.class_teacher !== 'Not Assigned' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                            {stream.class_teacher}
                          </span>
                        </td>
                        <td className="px-6 py-4">{stream.capacity} Students</td>
                        <td className="px-6 py-4 text-right flex justify-end gap-3">
                          
                          {/* VIEW BUTTON - Redirects to dedicated View page */}
                          <button 
                            onClick={() => navigate(`/admin-dashboard/classes/view/${stream.id}`)}
                            className="text-slate-400 hover:text-blue-600 transition" 
                            title="View details"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          
                          {/* EDIT BUTTON - Redirects to dedicated Edit page */}
                          <button 
                            onClick={() => navigate(`/admin-dashboard/classes/edit/${stream.id}`)}
                            className="text-slate-400 hover:text-amber-600 transition" 
                            title="Update class & Assign Teacher"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          
                          {/* DELETE BUTTON - Opens Card/Modal */}
                          <button 
                            onClick={() => openDeleteModal(stream, grade.grade_name)}
                            className="text-slate-400 hover:text-red-600 transition" 
                            title="Delete class"
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
        ))
      )}

      {/* DELETE CONFIRMATION MODAL (CARD) */}
      {streamToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="text-lg font-bold text-slate-800">Confirm Deletion</h3>
              <button onClick={closeDeleteModal} className="text-slate-400 hover:text-slate-600 transition" title="Close">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 text-center space-y-4">
              <div className="mx-auto w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mb-4">
                <Trash2 className="w-6 h-6 text-red-600" />
              </div>
              <h3 className="text-xl font-bold text-slate-800">
                Delete {streamToDelete.gradeName} {streamToDelete.stream.name}?
              </h3>
              <p className="text-slate-500 text-sm">
                This action cannot be undone. All class rosters, records, and assignments linked to this physical stream will be lost.
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