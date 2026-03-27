import { useState } from 'react';
import { Users, Eye, Edit, Trash2, X, Trophy, TrendingUp, BookOpen } from 'lucide-react';
import toast from 'react-hot-toast';

interface Stream {
  id: number;
  name: string;
  capacity: number;
}

interface Grade {
  id: number;
  grade_name: string;
  total_streams: number;
  curriculum_type?: string; // NEW: Added to track if it's CBC or 8-4-4
  streams: Stream[];
}

interface ClassesCardProps {
  grades: Grade[];
  onRefresh: () => void;
}

export default function ClassesCard({ grades, onRefresh }: ClassesCardProps) {
  // NEW: Updated to hold the full grade object so we have the grade ID and curriculum
  const [selectedStream, setSelectedStream] = useState<{ stream: Stream, grade: Grade } | null>(null);
  const [modalType, setModalType] = useState<'view' | 'edit' | 'delete' | null>(null);

  // Form States for Editing
  const [editName, setEditName] = useState('');
  const [editCapacity, setEditCapacity] = useState<number | string>('');
  const [editCurriculum, setEditCurriculum] = useState('CBC'); // NEW: State for curriculum dropdown
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (grades.length === 0) {
    return <div className="p-8 text-center text-slate-400">No classes configured yet.</div>;
  }

  const openAction = (stream: Stream, grade: Grade, type: 'view' | 'edit' | 'delete') => {
    setSelectedStream({ stream, grade });
    setModalType(type);
    
    // Pre-fill edit states when opening the edit modal
    if (type === 'edit') {
      setEditName(stream.name);
      setEditCapacity(stream.capacity);
      // Pre-fill curriculum or default to CBC if it doesn't exist yet
      setEditCurriculum(grade.curriculum_type || 'CBC'); 
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
      const response = await fetch(`http://localhost:8000/api/academic-hub/edit-stream/${selectedStream.stream.id}/`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        // NEW: We now send the curriculum_type and the grade_id so Django can update the parent GradeLevel
        body: JSON.stringify({ 
          name: editName, 
          capacity: editCapacity,
          curriculum_type: editCurriculum,
          grade_id: selectedStream.grade.id 
        })
      });
      const data = await response.json();
      
      if (data.status === 'success') {
        toast.success(data.message);
        onRefresh();
        closeModal();
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      toast.error("Failed to connect to the server.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Submit Delete to Backend
  const handleDeleteConfirm = async () => {
    if (!selectedStream) return;
    setIsSubmitting(true);
    
    try {
      const response = await fetch(`http://localhost:8000/api/academic-hub/delete-stream/${selectedStream.stream.id}/`, {
        method: 'DELETE',
      });
      const data = await response.json();
      
      if (data.status === 'success') {
        toast.success(data.message);
        onRefresh();
        closeModal();
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      toast.error("Failed to connect to the server.");
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
              {/* NEW: Displaying the curriculum tag next to the grade name */}
              <span className="ml-2 text-[10px] uppercase tracking-wider text-slate-400 border border-slate-300 px-1.5 py-0.5 rounded">
                {grade.curriculum_type || 'CBC'}
              </span>
            </span>
            <span className="text-xs font-medium bg-blue-100 text-blue-700 px-2 py-1 rounded-full">
              {grade.total_streams} Streams
            </span>
          </div>
          
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-slate-400 uppercase bg-white border-b border-slate-100">
              <tr>
                <th className="px-4 py-3 font-medium w-1/3">Stream</th>
                <th className="px-4 py-3 font-medium w-1/3">Capacity</th>
                <th className="px-4 py-3 font-medium text-right w-1/3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {grade.streams.map((stream) => (
                <tr key={stream.id} className="hover:bg-slate-50/80 transition-colors group">
                  <td className="px-4 py-3 font-medium text-slate-800">
                    <div className="flex items-center gap-2">
                      {grade.grade_name} {stream.name}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    <div className="flex items-center gap-1">
                      <Users className="w-4 h-4" /> {stream.capacity} Max
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => openAction(stream, grade, 'view')} className="text-slate-400 hover:text-blue-600 transition-colors p-1" title="View Deep Details">
                        <Eye className="w-4 h-4" />
                      </button>
                      <button onClick={() => openAction(stream, grade, 'edit')} className="text-slate-400 hover:text-amber-600 transition-colors p-1" title="Edit Class">
                        <Edit className="w-4 h-4" />
                      </button>
                      <button onClick={() => openAction(stream, grade, 'delete')} className="text-slate-400 hover:text-red-600 transition-colors p-1" title="Delete Class">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {/* MODALS OVERLAY */}
      {modalType && selectedStream && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
            
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="text-lg font-bold text-slate-800 capitalize">
                {modalType === 'view' ? 'Class Profile & Analytics' : modalType === 'edit' ? 'Edit Class Configuration' : 'Confirm Deletion'}
              </h3>
              <button type="button" onClick={closeModal} className="text-slate-400 hover:text-slate-600 transition" title="Close">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body - VIEW */}
            {modalType === 'view' && (
              <div className="p-6 overflow-y-auto space-y-6 bg-slate-50/50">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-black text-slate-800">{selectedStream.grade.grade_name} {selectedStream.stream.name}</h2>
                    <p className="text-sm text-slate-500 mt-1">Class Capacity: {selectedStream.stream.capacity} Students</p>
                  </div>
                  <div className="bg-emerald-100 text-emerald-800 px-3 py-1.5 rounded-lg text-sm font-bold flex items-center gap-2">
                    <Trophy className="w-4 h-4" /> Top Performing Class
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                    <div className="flex items-center gap-2 text-blue-600 mb-2 font-semibold">
                      <BookOpen className="w-4 h-4" /> Leadership
                    </div>
                    <p className="text-sm text-slate-600"><span className="font-medium text-slate-800">Class Teacher:</span> Mr. Anderson (Mathematics)</p>
                    <p className="text-sm text-slate-600 mt-1"><span className="font-medium text-slate-800">Class Prefect:</span> Sarah Jenkins</p>
                  </div>
                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                    <div className="flex items-center gap-2 text-purple-600 mb-2 font-semibold">
                      <TrendingUp className="w-4 h-4" /> Academic History
                    </div>
                    <p className="text-sm text-slate-600"><span className="font-medium text-slate-800">Term 1 Mean:</span> 78.4% (B+)</p>
                    <p className="text-sm text-slate-600 mt-1"><span className="font-medium text-slate-800">Term 2 Mean:</span> 82.1% (A-)</p>
                  </div>
                </div>
                
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                   <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/80 font-semibold text-slate-700">Subject Teachers Assigned</div>
                   <div className="p-4 text-sm text-slate-500">
                     <ul className="grid grid-cols-2 gap-2">
                        <li><span className="font-medium text-slate-700">Mathematics:</span> Mr. Anderson</li>
                        <li><span className="font-medium text-slate-700">English:</span> Mrs. Smith</li>
                        <li><span className="font-medium text-slate-700">Biology:</span> Dr. Roberts</li>
                     </ul>
                   </div>
                </div>
              </div>
            )}

            {/* Modal Body - EDIT */}
            {modalType === 'edit' && (
              <div className="p-6 space-y-4">
                <div className="space-y-2">
                  <label htmlFor="stream-name" className="text-sm font-medium text-slate-700">Stream Name</label>
                  <input id="stream-name" type="text" value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full border border-slate-300 rounded-md p-2 focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div className="space-y-2">
                  <label htmlFor="capacity" className="text-sm font-medium text-slate-700">Capacity</label>
                  <input id="capacity" type="number" value={editCapacity} onChange={(e) => setEditCapacity(e.target.value)} className="w-full border border-slate-300 rounded-md p-2 focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                
                {/* NEW: Curriculum Type Dropdown */}
                <div className="space-y-2">
                  <label htmlFor="curriculum" className="text-sm font-medium text-slate-700">Curriculum Type</label>
                  <select 
                    id="curriculum" 
                    value={editCurriculum} 
                    onChange={(e) => setEditCurriculum(e.target.value)} 
                    className="w-full border border-slate-300 rounded-md p-2 focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                  >
                    <option value="CBC">Competency Based Curriculum (CBC)</option>
                    <option value="8-4-4">Standard 8-4-4 Curriculum</option>
                  </select>
                  <p className="text-xs text-slate-400 mt-1">Note: Changing this will affect how exams are graded for this entire Grade Level.</p>
                </div>

                <button onClick={handleEditSubmit} disabled={isSubmitting} className="w-full bg-blue-600 text-white font-medium py-2 rounded-md hover:bg-blue-700 mt-4 disabled:bg-blue-400">
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
                  <button onClick={closeModal} disabled={isSubmitting} className="flex-1 bg-slate-100 text-slate-700 py-2 rounded-md font-medium hover:bg-slate-200">Cancel</button>
                  <button onClick={handleDeleteConfirm} disabled={isSubmitting} className="flex-1 bg-red-600 text-white py-2 rounded-md font-medium hover:bg-red-700 disabled:bg-red-400">
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