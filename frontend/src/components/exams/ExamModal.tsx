import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../libs/axiosInstance';

interface Term {
  id: string | number;
  name: string;
}

interface ExamModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  terms: Term[];
  editData?: any;
}

const ExamModal: React.FC<ExamModalProps> = ({ isOpen, onClose, onSuccess, terms, editData }) => {
  const [examForm, setExamForm] = useState({ term_id: '', name: '', exam_type: 'MAIN', marks: 100 });
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (editData) {
      setExamForm({
        term_id: editData.term_id || '',
        name: editData.name,
        exam_type: editData.exam_type === 'Continuous Assessment' ? 'CAT' : 'MAIN',
        marks: editData.marks,
      });
    } else {
      setExamForm({ term_id: '', name: '', exam_type: 'MAIN', marks: 100 });
    }
  }, [editData, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      if (editData) {
        // Future Django Edit Endpoint
        await api.put(`/api/exams/events/${editData.id}/update/`, examForm);
        toast.success('Exam updated successfully!');
      } else {
        await api.post('/api/exams/events/add/', examForm);
        toast.success('Exam created successfully!');
      }
      onSuccess();
      onClose();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to save exam.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <h2 className="font-semibold text-slate-800">{editData ? 'Edit Assessment' : 'Create Assessment / Exam'}</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-sm">
          <div>
            <label htmlFor="term-select" className="block text-slate-600 font-medium mb-1">Select Term</label>
            <select id="term-select" required className="w-full border border-slate-200 rounded-md p-2 focus:ring-2 focus:ring-blue-500 outline-none bg-white"
              value={examForm.term_id} onChange={(e) => setExamForm({...examForm, term_id: e.target.value})}>
              <option value="">-- Choose Term --</option>
              {terms.map(t => <option key={t.id} value={String(t.id)}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-slate-600 font-medium mb-1">Exam Name</label>
            <input required type="text" placeholder="e.g. End of Term, CAT 1" className="w-full border border-slate-200 rounded-md p-2 focus:ring-2 focus:ring-blue-500 outline-none" 
              value={examForm.name} onChange={(e) => setExamForm({...examForm, name: e.target.value})} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="exam-type-select" className="block text-slate-600 font-medium mb-1">Exam Type</label>
              <select id="exam-type-select" required className="w-full border border-slate-200 rounded-md p-2 focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                value={examForm.exam_type} onChange={(e) => setExamForm({...examForm, exam_type: e.target.value})}>
                <option value="MAIN">Main Exam</option>
                <option value="CAT">Continuous Assessment</option>
              </select>
            </div>
            <div>
              <label className="block text-slate-600 font-medium mb-1">Total Marks</label>
              <input required type="number" min="1" max="100" className="w-full border border-slate-200 rounded-md p-2 focus:ring-2 focus:ring-blue-500 outline-none" 
                value={examForm.marks} onChange={(e) => setExamForm({...examForm, marks: Number(e.target.value)})} />
            </div>
          </div>
          <div className="pt-4 flex justify-end gap-3 border-t border-slate-100 mt-6">
            <button type="button" onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-md font-medium">Cancel</button>
            <button type="submit" disabled={isSubmitting} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-medium disabled:opacity-50">
              {isSubmitting ? 'Saving...' : (editData ? 'Update Exam' : 'Create Exam')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ExamModal;