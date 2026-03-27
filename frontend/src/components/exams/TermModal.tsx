import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import axios from 'axios';

interface AcademicYear {
  id: string | number;
  year: string;
}

interface TermModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  academicYears: AcademicYear[];
  editData?: any; // Pass data if editing, null if adding
}

const TermModal: React.FC<TermModalProps> = ({ isOpen, onClose, onSuccess, academicYears, editData }) => {
  const [termForm, setTermForm] = useState({ academic_year_id: '', name: '', startDate: '', endDate: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Auto-fill form if editing, or set defaults if adding
  useEffect(() => {
    if (editData) {
      setTermForm({
        academic_year_id: editData.academic_year_id || (academicYears.length > 0 ? academicYears[0].id.toString() : ''),
        name: editData.name,
        startDate: editData.startDate,
        endDate: editData.endDate,
      });
    } else {
      setTermForm({ 
        academic_year_id: academicYears.length > 0 ? academicYears[0].id.toString() : '', 
        name: '', startDate: '', endDate: '' 
      });
    }
  }, [editData, academicYears, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      if (editData) {
        // Future Django Edit Endpoint
        await axios.put(`http://localhost:8000/api/exams/terms/${editData.id}/update/`, termForm);
        toast.success('Term updated successfully!');
      } else {
        await axios.post('http://localhost:8000/api/exams/terms/add/', termForm);
        toast.success('Term created successfully!');
      }
      onSuccess();
      onClose();
    } catch (error: any) {
      console.error("Django Error Details:", error.response?.data);
      toast.error(error.response?.data?.error || 'Failed to save term.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <h2 className="font-semibold text-slate-800">{editData ? 'Edit Academic Term' : 'Add Academic Term'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-sm">
          <div>
            <label className="block text-slate-600 font-medium mb-1">Select Academic Year</label>
            <select required className="w-full border border-slate-200 rounded-md p-2 focus:ring-2 focus:ring-blue-500 outline-none bg-white"
              value={termForm.academic_year_id} onChange={(e) => setTermForm({...termForm, academic_year_id: e.target.value})}>
              <option value="">-- Choose Year --</option>
              {academicYears.map(y => <option key={y.id} value={String(y.id)}>{y.year}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-slate-600 font-medium mb-1">Term Name</label>
            <input required type="text" placeholder="e.g. Term 1" className="w-full border border-slate-200 rounded-md p-2 focus:ring-2 focus:ring-blue-500 outline-none" 
              value={termForm.name} onChange={(e) => setTermForm({...termForm, name: e.target.value})} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-slate-600 font-medium mb-1">Start Date</label>
              <input required type="date" className="w-full border border-slate-200 rounded-md p-2 focus:ring-2 focus:ring-blue-500 outline-none" 
                value={termForm.startDate} onChange={(e) => setTermForm({...termForm, startDate: e.target.value})} />
            </div>
            <div>
              <label className="block text-slate-600 font-medium mb-1">End Date</label>
              <input required type="date" className="w-full border border-slate-200 rounded-md p-2 focus:ring-2 focus:ring-blue-500 outline-none" 
                value={termForm.endDate} onChange={(e) => setTermForm({...termForm, endDate: e.target.value})} />
            </div>
          </div>
          <div className="pt-4 flex justify-end gap-3 border-t border-slate-100 mt-6">
            <button type="button" onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-md font-medium">Cancel</button>
            <button type="submit" disabled={isSubmitting} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-medium disabled:opacity-50">
              {isSubmitting ? 'Saving...' : (editData ? 'Update Term' : 'Save Term')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default TermModal;