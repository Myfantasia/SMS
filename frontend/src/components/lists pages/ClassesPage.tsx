import { useState, useEffect, useMemo } from 'react';
import { Layers, Eye, Edit, Trash2, X, Search, Users, Star } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../../libs/axiosInstance';

interface Stream {
  id: number;
  name: string;
  capacity: number;
  enrolled_count: number;
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
  const [searchTerm, setSearchTerm] = useState('');
  const navigate = useNavigate();

  // Environment Path Checks for Conditional Rendering
  const isAdmin = window.location.pathname.includes('admin-dashboard');
  const basePath = '/' + (window.location.pathname.split('/')[1] || 'admin-dashboard');

  // Delete Modal States
  const [streamToDelete, setStreamToDelete] = useState<{ stream: Stream, gradeName: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchClasses = () => {
  api.get('/api/manage-classes/')
    .then(res => {
      const response = res.data;
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
    const response = await api.delete(`/api/academic-hub/delete-stream/${streamToDelete.stream.id}/`);
    const data = response.data;

    if (data.status === 'success') {
      toast.success('Class successfully deleted');
      fetchClasses();
      closeDeleteModal();
    } else {
      toast.error(data.message);
    }
  } catch (error) {
    console.error("Error deleting class:", error);
    toast.error('Failed to connect to server');
  } finally {
    setIsDeleting(false);
  }
};

  const { filteredGrades, totalStreams, totalEnrolled, totalCapacity } = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    const filtered = q
      ? grades
          .map((grade) => ({
            ...grade,
            streams: grade.streams.filter((s) =>
              s.name.toLowerCase().includes(q) ||
              s.class_teacher.toLowerCase().includes(q) ||
              grade.grade_name.toLowerCase().includes(q)
            ),
          }))
          .filter((grade) => grade.streams.length > 0)
      : grades;

    let streams = 0, enrolled = 0, capacity = 0;
    grades.forEach((g) => g.streams.forEach((s) => {
      streams += 1;
      enrolled += s.enrolled_count;
      capacity += s.capacity;
    }));

    return { filteredGrades: filtered, totalStreams: streams, totalEnrolled: enrolled, totalCapacity: capacity };
  }, [grades, searchTerm]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto space-y-6 animate-pulse">
        <div className="h-12 w-80 bg-slate-200 rounded-2xl"></div>
        {[1, 2, 3].map((i) => <div key={i} className="h-40 bg-slate-200 rounded-2xl"></div>)}
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-8 relative">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-2xl text-blue-600 bg-blue-50">
            <Layers className="w-7 h-7" strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-slate-800">Class Operations</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {totalStreams} streams &middot; {totalEnrolled} / {totalCapacity} students enrolled
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-full ring-1 ring-slate-200 px-3 py-2 bg-slate-50 focus-within:ring-2 focus-within:ring-blue-500 focus-within:bg-white transition-all w-full md:w-72">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            type="text"
            placeholder="Search by stream, grade or teacher..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-transparent outline-none text-sm text-slate-700 placeholder:text-slate-400"
          />
        </div>
      </div>

      {filteredGrades.length === 0 ? (
        <div className="text-slate-400 bg-white p-10 rounded-2xl border border-slate-100 text-center text-sm">
          {grades.length === 0 ? 'No classes found. Set them up in the Academics Hub first.' : `No classes match "${searchTerm}".`}
        </div>
      ) : (
        filteredGrades.map((grade) => (
          <div key={grade.grade_id} className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="bg-slate-50 px-6 py-4 border-b border-slate-100 flex items-center gap-2">
              <h2 className="text-lg font-bold text-slate-700">{grade.grade_name}</h2>
              <span className="bg-white text-slate-400 text-xs font-bold px-2 py-0.5 rounded-full border border-slate-200">{grade.streams.length}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-white text-slate-500 text-xs uppercase tracking-wider border-b border-slate-200">
                    <th className="px-6 py-3 font-medium">Stream Name</th>
                    <th className="px-6 py-3 font-medium">Class Teacher</th>
                    <th className="px-6 py-3 font-medium">Enrollment</th>
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
                          {stream.name}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${stream.class_teacher !== 'Not Assigned' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                            {stream.class_teacher !== 'Not Assigned' && <Star className="w-3 h-3 fill-blue-600 text-blue-600" />}
                            {stream.class_teacher}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <Users className="w-3.5 h-3.5 text-slate-400" />
                            <span className="text-slate-600">{stream.enrolled_count} / {stream.capacity}</span>
                            <div className="w-16 bg-slate-100 rounded-full h-1.5 hidden sm:block">
                              <div
                                className={`h-1.5 rounded-full ${stream.enrolled_count >= stream.capacity ? 'bg-red-400' : 'bg-blue-500'}`}
                                style={{ width: `${stream.capacity > 0 ? Math.min(100, Math.round((stream.enrolled_count / stream.capacity) * 100)) : 0}%` }}
                              ></div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right flex justify-end gap-3">

                          <button
                            onClick={() => navigate(`${basePath}/classes/view/${stream.id}`)}
                            className="text-slate-400 hover:text-blue-600 transition"
                            title="View details"
                          >
                            <Eye className="w-4 h-4" />
                          </button>

                          {/* Role Shield: Only Admins can execute these structural changes */}
                          {isAdmin && (
                            <>
                              <button
                                onClick={() => navigate(`${basePath}/classes/edit/${stream.id}`)}
                                className="text-slate-400 hover:text-amber-600 transition"
                                title="Update class & Assign Teacher"
                              >
                                <Edit className="w-4 h-4" />
                              </button>

                              <button
                                onClick={() => openDeleteModal(stream, grade.grade_name)}
                                className="text-slate-400 hover:text-red-600 transition"
                                title="Delete class"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          )}

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
