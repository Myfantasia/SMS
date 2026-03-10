import { useState } from 'react';
import { Eye, Edit, Trash2, X, BarChart3, Users } from 'lucide-react';
import toast from 'react-hot-toast';

interface Subject {
  id: number;
  code: string;
  name: string;
  department: string;
  is_core: boolean;
}

interface SubjectsCardProps {
  subjects: Subject[];
  onRefresh: () => void;
}

export default function SubjectsCard({ subjects, onRefresh }: SubjectsCardProps) {
  const [selectedSubject, setSelectedSubject] = useState<Subject | null>(null);
  const [modalType, setModalType] = useState<'view' | 'edit' | 'delete' | null>(null);

  // Added Form States for Editing
  const [editCode, setEditCode] = useState('');
  const [editName, setEditName] = useState('');
  const [editDept, setEditDept] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const getDeptColor = (dept: string) => {
    switch(dept) {
      case 'Sciences': return 'bg-cyan-100 text-cyan-700 border-cyan-200';
      case 'Languages': return 'bg-indigo-100 text-indigo-700 border-indigo-200';
      case 'Mathematics': return 'bg-rose-100 text-rose-700 border-rose-200';
      case 'Humanities': return 'bg-amber-100 text-amber-700 border-amber-200';
      default: return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  if (subjects.length === 0) {
    return <div className="p-8 text-center text-slate-400">No subjects configured yet.</div>;
  }

  const openAction = (subject: Subject, type: 'view' | 'edit' | 'delete') => {
    setSelectedSubject(subject);
    setModalType(type);
    // Pre-fill edit states
    if (type === 'edit') {
      setEditCode(subject.code);
      setEditName(subject.name);
      setEditDept(subject.department);
    }
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
      const response = await fetch(`http://localhost:8000/api/academic-hub/edit-subject/${selectedSubject.id}/`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: editCode, name: editName, department: editDept })
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
    if (!selectedSubject) return;
    setIsSubmitting(true);
    
    try {
      const response = await fetch(`http://localhost:8000/api/academic-hub/delete-subject/${selectedSubject.id}/`, {
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
      <table className="w-full text-sm text-left">
        <thead className="text-xs text-slate-400 uppercase bg-white sticky top-0 shadow-sm border-b border-slate-100">
          <tr>
            <th className="px-4 py-4 font-medium w-1/4">Code</th>
            <th className="px-4 py-4 font-medium w-1/3">Subject Name</th>
            <th className="px-4 py-4 font-medium w-1/4">Department</th>
            <th className="px-4 py-4 font-medium text-right w-1/6">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {subjects.map((sub) => (
            <tr key={sub.id} className="hover:bg-slate-50 transition-colors group">
              <td className="px-4 py-4 font-mono text-xs font-semibold text-slate-500">
                {sub.code}
              </td>
              <td className="px-4 py-4 font-medium text-slate-800">
                <div className="flex items-center gap-2">
                  {sub.name}
                  {sub.is_core && <span className="text-[10px] uppercase bg-slate-800 text-white px-1.5 py-0.5 rounded">Core</span>}
                </div>
              </td>
              <td className="px-4 py-4">
                <span className={`px-2 py-1 rounded-md text-xs font-medium border ${getDeptColor(sub.department)}`}>
                  {sub.department}
                </span>
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
          ))}
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
                    <span className={`px-2 py-0.5 rounded border ${getDeptColor(selectedSubject.department)}`}>{selectedSubject.department}</span>
                    {selectedSubject.is_core ? 'Core Requirement' : 'Elective'}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                    <div className="flex items-center gap-2 text-indigo-600 mb-2 font-semibold">
                      <Users className="w-4 h-4" /> Staffing
                    </div>
                    <p className="text-sm text-slate-600"><span className="font-medium text-slate-800">Head of Department:</span> Dr. Emily Clark</p>
                    <p className="text-sm text-slate-600 mt-2"><span className="font-medium text-slate-800">Active Teachers:</span> 4 assigned</p>
                  </div>
                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                    <div className="flex items-center gap-2 text-emerald-600 mb-2 font-semibold">
                      <BarChart3 className="w-4 h-4" /> Global Performance
                    </div>
                    <p className="text-sm text-slate-600"><span className="font-medium text-slate-800">School-Wide Mean:</span> 68.2%</p>
                    <p className="text-sm text-slate-600 mt-2"><span className="font-medium text-slate-800">Highest Performing:</span> Grade 8 East</p>
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                   <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/80 font-semibold text-slate-700">Class Performance Breakdown (Term 1)</div>
                   <div className="p-0 text-sm text-slate-500">
                     <table className="w-full text-left">
                       <thead className="bg-slate-50 border-b border-slate-100 text-xs">
                         <tr><th className="px-4 py-2">Class</th><th className="px-4 py-2">Mean Score</th><th className="px-4 py-2">Grade</th></tr>
                       </thead>
                       <tbody>
                         <tr className="border-b border-slate-50"><td className="px-4 py-2">Grade 8 East</td><td className="px-4 py-2 font-mono">84.5%</td><td className="px-4 py-2 text-emerald-600 font-bold">A</td></tr>
                         <tr className="border-b border-slate-50"><td className="px-4 py-2">Grade 8 West</td><td className="px-4 py-2 font-mono">72.1%</td><td className="px-4 py-2 text-blue-600 font-bold">B</td></tr>
                         <tr><td className="px-4 py-2">Grade 7 North</td><td className="px-4 py-2 font-mono">65.0%</td><td className="px-4 py-2 text-amber-600 font-bold">C+</td></tr>
                       </tbody>
                     </table>
                   </div>
                </div>
              </div>
            )}

            {/* Modal Body - EDIT */}
            {modalType === 'edit' && (
              <div className="p-6 space-y-4">
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
                <div className="space-y-2">
                  <label htmlFor="department-select" className="text-sm font-medium text-slate-700">Department</label>
                  <select id="department-select" value={editDept} onChange={(e) => setEditDept(e.target.value)} className="w-full border border-slate-300 rounded-md p-2 focus:ring-2 focus:ring-emerald-500 outline-none">
                    <option>Languages</option>
                    <option>Mathematics</option>
                    <option>Sciences</option>
                    <option>Humanities</option>
                    <option>Technical</option>
                  </select>
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