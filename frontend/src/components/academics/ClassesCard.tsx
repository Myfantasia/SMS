import { useState } from 'react';
import { Users, Eye, Edit, Trash2, X, Star, BookOpen, Plus, Loader2, Settings } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../libs/axiosInstance';

interface Stream {
  id: number;
  name: string;
  capacity: number;
  enrolled_count: number;
  class_teacher: string | null;
}

interface Grade {
  id: number;
  grade_name: string;
  total_streams: number;
  curriculum_type?: string;
  curriculum_id: number | null;
  tier_id: number | null;
  streams: Stream[];
}

interface Tier {
  id: number;
  curriculum: number;
  name: string;
  code: string;
}

// NEW: Interface for the fetched teacher data
interface AssignedTeacher {
  subject: string;
  teacher: string;
}

interface ClassesCardProps {
  grades: Grade[];
  tiers: Tier[];
  onRefresh: () => void;
  onAddStream: (gradeId: number, gradeName: string) => void;
  onEditGrade: (grade: Grade) => void;
}

export default function ClassesCard({ grades, tiers, onRefresh, onAddStream, onEditGrade }: ClassesCardProps) {
  const [selectedStream, setSelectedStream] = useState<{ stream: Stream, grade: Grade } | null>(null);
  const [modalType, setModalType] = useState<'view' | 'edit' | 'delete' | null>(null);

  // Form States for Editing
  const [editName, setEditName] = useState('');
  const [editCapacity, setEditCapacity] = useState<number | string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // NEW: States for dynamic teacher fetching
  const [assignedTeachers, setAssignedTeachers] = useState<AssignedTeacher[]>([]);
  const [isLoadingTeachers, setIsLoadingTeachers] = useState(false);

  if (grades.length === 0) {
    return <div className="p-8 text-center text-slate-400" title="No Data Available">No classes configured yet.</div>;
  }

  // NEW: Fetch function for the class profile
const fetchStreamTeachers = async (streamId: number) => {
  setIsLoadingTeachers(true);
  setAssignedTeachers([]); // Clear previous data stale states
  try {
    // Replaced native fetch with clean api.get
    const response = await api.get(`/api/academic-hub/stream-teachers/${streamId}/`);
    const data = response.data;
    
    if (data.status === 'success') {
      setAssignedTeachers(data.data);
    } else {
      toast.error(data.message);
    }
  } catch (error: any) {
    console.error("Error fetching stream teachers:", error);
    const errMsg = error.response?.data?.message || "Could not load assigned teachers.";
    toast.error(errMsg);
  } finally {
    setIsLoadingTeachers(false);
  }
};

  const openAction = (stream: Stream, grade: Grade, type: 'view' | 'edit' | 'delete') => {
    setSelectedStream({ stream, grade });
    setModalType(type);
    
    // Pre-fill edit states when opening the edit modal
    if (type === 'edit') {
      setEditName(stream.name);
      setEditCapacity(stream.capacity);
    }

    // NEW: Trigger fetch if opening the view modal
    if (type === 'view') {
      fetchStreamTeachers(stream.id);
    }
  };

  const closeModal = () => {
    setSelectedStream(null);
    setModalType(null);
  };

  // Submit Edit to Backend
const handleEditSubmit = async () => {
  if (!selectedStream) return;
  setIsSubmitting(true);
  
  try {
    // Replaced native fetch wrapper with structured api.put()
    const response = await api.put(`/api/academic-hub/edit-stream/${selectedStream.stream.id}/`, {
      name: editName,
      capacity: editCapacity,
      grade_id: selectedStream.grade.id
    });
    
    const data = response.data;
    
    if (data.status === 'success') {
      toast.success(data.message);
      onRefresh();
      closeModal();
    } else {
      console.error("Backend Edit Error:", data.message);
      toast.error(data.message);
    }
  } catch (error: any) {
    console.error("Error editing stream:", error);
    const errMsg = error.response?.data?.message || "Failed to connect to the server.";
    toast.error(errMsg);
  } finally {
    setIsSubmitting(false);
  }
};

  // Submit Delete to Backend
const handleDeleteConfirm = async () => {
  if (!selectedStream) return;
  setIsSubmitting(true);
  
  try {
    // Replaced native method config with direct api.delete() lookup
    const response = await api.delete(`/api/academic-hub/delete-stream/${selectedStream.stream.id}/`);
    const data = response.data;
    
    if (data.status === 'success') {
      toast.success(data.message);
      onRefresh();
      closeModal();
    } else {
      console.error("Backend Delete Error:", data.message);
      toast.error(data.message);
    }
  } catch (error: any) {
    console.error("Error deleting stream:", error);
    const errMsg = error.response?.data?.message || "Failed to connect to the server.";
    toast.error(errMsg);
  } finally {
    setIsSubmitting(false);
  }
};

  return (
    <div className="w-full relative">
      {grades.map((grade) => (
        <div key={grade.id} className="border-b border-slate-100 last:border-0">
          <div className="bg-slate-50 px-4 py-3 flex justify-between items-center">
            <span className="font-semibold text-slate-700">
              {grade.grade_name}
              <span className="ml-2 text-[10px] uppercase tracking-wider text-slate-400 border border-slate-300 px-1.5 py-0.5 rounded" title="Curriculum Type">
                {grade.curriculum_type || 'CBC'}
                {grade.tier_id ? ` · ${tiers.find(t => t.id === grade.tier_id)?.code ?? ''}` : ''}
              </span>
            </span>

            <div className="flex items-center gap-3">
              <span className="text-xs font-medium bg-blue-100 text-blue-700 px-2 py-1 rounded-full" title="Total streams in this grade">
                {grade.total_streams} Streams
              </span>
              <button
                onClick={() => onEditGrade(grade)}
                title={`Edit ${grade.grade_name}'s curriculum settings`}
                className="flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-amber-600 bg-white border border-slate-200 hover:border-amber-300 px-2 py-1 rounded transition shadow-sm"
              >
                <Settings className="w-3.5 h-3.5" /> Edit Grade
              </button>
              <button
                onClick={() => onAddStream(grade.id, grade.grade_name)}
                title={`Add a new stream to ${grade.grade_name}`}
                className="flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-blue-600 bg-white border border-slate-200 hover:border-blue-300 px-2 py-1 rounded transition shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" /> Add Stream
              </button>
            </div>
          </div>
          
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-slate-400 uppercase bg-white border-b border-slate-100">
              <tr>
                <th className="px-4 py-3 font-medium w-1/4">Stream</th>
                <th className="px-4 py-3 font-medium w-1/4">Class Teacher</th>
                <th className="px-4 py-3 font-medium w-1/4">Capacity</th>
                <th className="px-4 py-3 font-medium text-right w-1/4">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {grade.streams.map((stream) => (
                <tr key={stream.id} className="hover:bg-slate-50/80 transition-colors group">
                  <td className="px-4 py-3 font-medium text-slate-800">
                    <div className="flex items-center gap-2" title={`Stream Name: ${grade.grade_name} ${stream.name}`}>
                      {grade.grade_name} {stream.name}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {stream.class_teacher ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold bg-amber-50 text-amber-700 px-2 py-1 rounded-full">
                        <Star className="w-3 h-3 fill-amber-500 text-amber-500" /> {stream.class_teacher}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-300 italic">Not assigned</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    <div className="flex items-center gap-1" title={`Enrolled: ${stream.enrolled_count} out of ${stream.capacity}`}>
                      <Users className="w-4 h-4" /> {stream.enrolled_count} / {stream.capacity} Enrolled
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => openAction(stream, grade, 'view')} className="text-slate-400 hover:text-blue-600 transition-colors p-1" title="View Deep Details">
                        <Eye className="w-4 h-4" />
                      </button>
                      <button onClick={() => openAction(stream, grade, 'edit')} className="text-slate-400 hover:text-amber-600 transition-colors p-1" title={`Edit ${stream.name}`}>
                        <Edit className="w-4 h-4" />
                      </button>
                      <button onClick={() => openAction(stream, grade, 'delete')} className="text-slate-400 hover:text-red-600 transition-colors p-1" title={`Delete ${stream.name}`}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {grade.streams.length === 0 && (
                <tr>
                   <td colSpan={4} className="px-4 py-6 text-center text-slate-400 text-xs italic">
                     No streams in this grade yet. Click "Add Stream" above.
                   </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ))}

      {/* MODALS OVERLAY */}
      {modalType && selectedStream && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col animate-fade-in">
            
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="text-lg font-bold text-slate-800 capitalize" title="Modal Title">
                {modalType === 'view' ? 'Class Profile & Analytics' : modalType === 'edit' ? 'Edit Class Configuration' : 'Confirm Deletion'}
              </h3>
              <button type="button" onClick={closeModal} className="text-slate-400 hover:text-slate-600 transition" title="Close window">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body - VIEW */}
            {modalType === 'view' && (
              <div className="p-6 overflow-y-auto space-y-6 bg-slate-50/50">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-black text-slate-800">{selectedStream.grade.grade_name} {selectedStream.stream.name}</h2>
                    <p className="text-sm text-slate-500 mt-1">Capacity: {selectedStream.stream.enrolled_count} / {selectedStream.stream.capacity} Enrolled</p>
                  </div>
                  <div className={`px-3 py-1.5 rounded-lg text-sm font-bold flex items-center gap-2 ${
                    selectedStream.stream.enrolled_count >= selectedStream.stream.capacity
                      ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800'
                  }`} title="Enrollment fill rate">
                    <Users className="w-4 h-4" />
                    {selectedStream.stream.capacity > 0 ? Math.round((selectedStream.stream.enrolled_count / selectedStream.stream.capacity) * 100) : 0}% Full
                  </div>
                </div>

                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                  <div className="flex items-center gap-2 text-blue-600 mb-2 font-semibold">
                    <BookOpen className="w-4 h-4" /> Leadership
                  </div>
                  {selectedStream.stream.class_teacher ? (
                    <p className="text-sm text-slate-600 flex items-center gap-1.5">
                      <span className="font-medium text-slate-800">Class Teacher:</span> {selectedStream.stream.class_teacher}
                      <Star className="w-3.5 h-3.5 fill-amber-500 text-amber-500" />
                    </p>
                  ) : (
                    <p className="text-sm text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                      No class teacher assigned yet. Assign one from Class Operations &rarr; Edit.
                    </p>
                  )}
                </div>

                <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                   <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/80 font-semibold text-slate-700 flex justify-between items-center">
                     <span>Subject Teachers Assigned</span>
                     {isLoadingTeachers && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
                   </div>
                   <div className="p-4 text-sm text-slate-500 min-h-25">
                     {isLoadingTeachers ? (
                       <div className="flex items-center justify-center h-full text-slate-400 italic">
                         Loading assignments...
                       </div>
                     ) : assignedTeachers.length > 0 ? (
                       <ul className="grid grid-cols-2 gap-4">
                         {assignedTeachers.map((item, idx) => (
                           <li key={idx} className="flex flex-col border-b border-slate-50 pb-2">
                             <span className="font-bold text-slate-700">{item.subject}</span>
                             <span className="text-slate-500">{item.teacher}</span>
                           </li>
                         ))}
                       </ul>
                     ) : (
                       <div className="flex items-center justify-center h-full text-slate-400 italic">
                         No subject teachers actively assigned to this stream.
                       </div>
                     )}
                   </div>
                </div>
              </div>
            )}

            {/* Modal Body - EDIT */}
            {modalType === 'edit' && (
              <div className="p-6 space-y-4">
                <div className="space-y-2">
                  <label htmlFor="stream-name" className="text-sm font-medium text-slate-700">Stream Name</label>
                  <input 
                    id="stream-name" 
                    type="text" 
                    title="Edit stream name"
                    value={editName} 
                    onChange={(e) => setEditName(e.target.value)} 
                    className="w-full border border-slate-300 rounded-md p-2 focus:ring-2 focus:ring-blue-500 outline-none" 
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="capacity" className="text-sm font-medium text-slate-700">Capacity</label>
                  <input 
                    id="capacity" 
                    type="number" 
                    title="Edit stream capacity"
                    value={editCapacity} 
                    onChange={(e) => setEditCapacity(e.target.value)} 
                    className="w-full border border-slate-300 rounded-md p-2 focus:ring-2 focus:ring-blue-500 outline-none" 
                  />
                </div>

                <button
                  onClick={handleEditSubmit} 
                  disabled={isSubmitting} 
                  title="Save configurations"
                  className="w-full bg-blue-600 text-white font-medium py-2 rounded-md hover:bg-blue-700 mt-4 disabled:bg-blue-400 transition"
                >
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
                <h3 className="text-xl font-bold text-slate-800">Delete {selectedStream.grade.grade_name} {selectedStream.stream.name}?</h3>
                <p className="text-slate-500 text-sm">This action cannot be undone. All historical data, student assignments, and performance records tied exclusively to this stream will be permanently lost.</p>
                <div className="flex gap-4 mt-6">
                  <button 
                    onClick={closeModal} 
                    disabled={isSubmitting} 
                    title="Cancel deletion"
                    className="flex-1 bg-slate-100 text-slate-700 py-2 rounded-md font-medium hover:bg-slate-200 transition"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleDeleteConfirm} 
                    disabled={isSubmitting} 
                    title="Confirm Permanent Deletion"
                    className="flex-1 bg-red-600 text-white py-2 rounded-md font-medium hover:bg-red-700 disabled:bg-red-400 transition"
                  >
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