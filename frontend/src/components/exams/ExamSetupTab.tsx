import React, { useState, useEffect } from 'react';
import { Calendar, Plus, BookOpen, Settings, CheckCircle2, Edit, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import GradingRulesModal from './GradingRulesModal'; 
import TermModal from './TermModal'; // NEW: Imported your separated modal
import ExamModal from './ExamModal'; // NEW: Imported your separated modal
import api from '../../libs/axiosInstance';

// --- Interfaces ---
interface Term {
  id: string | number;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
  academic_year_id?: string | number; // Helpful for editing
}

interface ExamEvent {
  id: string | number;
  term_name: string;
  term_id?: string | number; // Helpful for editing
  name: string;
  exam_type: string;
  marks: number;
  status: string;
}

interface AcademicYear {
  id: string | number;
  year: string;
}

const ExamSetupTab: React.FC = () => {
  // Data State
  const [activeYear, setActiveYear] = useState('Loading...');
  const [activeTerm, setActiveTerm] = useState('Loading...');
  const [terms, setTerms] = useState<Term[]>([]);
  const [exams, setExams] = useState<ExamEvent[]>([]);
  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([]); 
  const [isLoading, setIsLoading] = useState(true);

  // Modal States
  const [isTermModalOpen, setIsTermModalOpen] = useState(false);
  const [isExamModalOpen, setIsExamModalOpen] = useState(false);
  const [isGradingModalOpen, setIsGradingModalOpen] = useState(false);

  // NEW: State to track which item we are editing
  const [editingTerm, setEditingTerm] = useState<Term | null>(null);
  const [editingExam, setEditingExam] = useState<ExamEvent | null>(null);

  // --- FETCH DATA ---
  const fetchSetupData = async () => {
    setIsLoading(true);
    try {
      const response = await api.get('/api/exams/setup-data/');
      setActiveYear(response.data.active_year || 'No Active Year');
      setActiveTerm(response.data.active_term || 'No Active Term');
      setTerms(response.data.terms || []);
      setExams(response.data.exams || []);
      setAcademicYears(response.data.academic_years || []); 
    } catch (error) {
      console.error("Failed to fetch setup data", error);
      toast.error("Failed to load setup data from server.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSetupData();
  }, []);

  // --- ACTIONS & HANDLERS ---
  const handleActivateTerm = async (id: string | number) => {
    const toastId = toast.loading('Updating active term...');
    try {
      await api.post(`/api/exams/terms/activate/${id}/`);
      toast.success('Active term updated!', { id: toastId });
      fetchSetupData(); 
    } catch (error) {
      console.error("Failed to activate term", error);
      toast.error('Failed to change active term.', { id: toastId });
    }
  };

  // NEW: Delete Handlers
  // The backend blocks the first attempt with a 409 + impact summary when the term/exam
  // has real data attached, instead of silently cascade-deleting marks. On that response we
  // show the blast radius and let the admin explicitly confirm with force=true.
  const handleDeleteTerm = (id: string | number) => {
    toast((t) => (
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium text-slate-800">
          Delete this term? All connected exams will also be removed.
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={() => toast.dismiss(t.id)}
            className="px-3 py-1 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-600 rounded transition"
          >
            Cancel
          </button>
          <button
            onClick={async () => {
              toast.dismiss(t.id);
              try {
                await api.delete(`/api/exams/terms/${id}/delete/`);
                toast.success('Term deleted successfully!');
                fetchSetupData();
              } catch (error: any) {
                if (error.response?.status === 409 && error.response.data?.requires_confirmation) {
                  confirmForceDeleteTerm(id, error.response.data.error);
                  return;
                }
                toast.error(error.response?.data?.error || 'Failed to delete term.');
                console.error("Failed to delete term", error);
              }
            }}
            className="px-3 py-1 text-xs font-medium bg-red-600 hover:bg-red-700 text-white rounded transition"
          >
            Delete Term
          </button>
        </div>
      </div>
    ), { duration: Infinity }); // Infinity prevents it from auto-closing before they decide
  };

  const confirmForceDeleteTerm = (id: string | number, impactMessage: string) => {
    toast((t) => (
      <div className="flex flex-col gap-3 max-w-sm">
        <p className="text-sm font-bold text-red-700">This will permanently destroy real data.</p>
        <p className="text-sm text-slate-700">{impactMessage}</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={() => toast.dismiss(t.id)}
            className="px-3 py-1 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-600 rounded transition"
          >
            Cancel
          </button>
          <button
            onClick={async () => {
              toast.dismiss(t.id);
              try {
                await api.delete(`/api/exams/terms/${id}/delete/?force=true`);
                toast.success('Term and all its data deleted.');
                fetchSetupData();
              } catch (error) {
                toast.error('Failed to delete term.');
                console.error("Failed to force-delete term", error);
              }
            }}
            className="px-3 py-1 text-xs font-medium bg-red-600 hover:bg-red-700 text-white rounded transition"
          >
            Yes, Delete Everything
          </button>
        </div>
      </div>
    ), { duration: Infinity });
  };

  const handleDeleteExam = (id: string | number) => {
    toast((t) => (
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium text-slate-800">
          Delete this exam? All student results tied to it will be lost.
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={() => toast.dismiss(t.id)}
            className="px-3 py-1 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-600 rounded transition"
          >
            Cancel
          </button>
          <button
            onClick={async () => {
              toast.dismiss(t.id);
              try {
                await api.delete(`/api/exams/events/${id}/delete/`);
                toast.success('Exam deleted successfully!');
                fetchSetupData();
              } catch (error: any) {
                if (error.response?.status === 409 && error.response.data?.requires_confirmation) {
                  confirmForceDeleteExam(id, error.response.data.error);
                  return;
                }
                toast.error(error.response?.data?.error || 'Failed to delete exam.');
                console.error("Failed to delete exam", error);
              }
            }}
            className="px-3 py-1 text-xs font-medium bg-red-600 hover:bg-red-700 text-white rounded transition"
          >
            Delete Exam
          </button>
        </div>
      </div>
    ), { duration: Infinity });
  };

  const confirmForceDeleteExam = (id: string | number, impactMessage: string) => {
    toast((t) => (
      <div className="flex flex-col gap-3 max-w-sm">
        <p className="text-sm font-bold text-red-700">This will permanently destroy real data.</p>
        <p className="text-sm text-slate-700">{impactMessage}</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={() => toast.dismiss(t.id)}
            className="px-3 py-1 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-600 rounded transition"
          >
            Cancel
          </button>
          <button
            onClick={async () => {
              toast.dismiss(t.id);
              try {
                await api.delete(`/api/exams/events/${id}/delete/?force=true`);
                toast.success('Exam and all its marks deleted.');
                fetchSetupData();
              } catch (error) {
                toast.error('Failed to delete exam.');
                console.error("Failed to force-delete exam", error);
              }
            }}
            className="px-3 py-1 text-xs font-medium bg-red-600 hover:bg-red-700 text-white rounded transition"
          >
            Yes, Delete Everything
          </button>
        </div>
      </div>
    ), { duration: Infinity });
  };

  // NEW: Open Modal Handlers
  const openAddTerm = () => {
    setEditingTerm(null); // Null means we are Adding
    setIsTermModalOpen(true);
  };

  const openEditTerm = (term: Term) => {
    setEditingTerm(term); // Pass data to edit
    setIsTermModalOpen(true);
  };

  const openAddExam = () => {
    setEditingExam(null); // Null means we are Adding
    setIsExamModalOpen(true);
  };

  const openEditExam = (exam: ExamEvent) => {
    setEditingExam(exam); // Pass data to edit
    setIsExamModalOpen(true);
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 relative">
      
      {/* Top Stats/Overview Bar */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-blue-50 border border-blue-100 p-4 rounded-lg flex items-center justify-between">
          <div>
            <p className="text-sm text-blue-600 font-semibold uppercase tracking-wider">Current Year</p>
            <h3 className="text-2xl font-bold text-blue-900">{activeYear}</h3>
          </div>
          <Calendar className="w-8 h-8 text-blue-300" />
        </div>
        
        <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-lg flex items-center justify-between">
          <div>
            <p className="text-sm text-emerald-600 font-semibold uppercase tracking-wider">Active Term</p>
            <h3 className="text-2xl font-bold text-emerald-900">{activeTerm}</h3>
          </div>
          <CheckCircle2 className="w-8 h-8 text-emerald-300" />
        </div>

        {/* Action Card for Grading */}
        <div 
          onClick={() => setIsGradingModalOpen(true)}
          className="bg-slate-50 border border-slate-200 p-4 rounded-lg flex items-center justify-between hover:bg-slate-100 cursor-pointer transition-colors"
        >
          <div>
            <p className="text-sm text-slate-600 font-semibold uppercase tracking-wider">Configuration</p>
            <h3 className="text-lg font-bold text-slate-800">Grading Rules</h3>
          </div>
          <Settings className="w-8 h-8 text-slate-400" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* LEFT COLUMN: Manage Terms */}
        <div className="border border-slate-200 rounded-lg shadow-sm bg-white overflow-hidden flex flex-col">
          <div className="bg-slate-50 border-b border-slate-200 p-4 flex justify-between items-center">
            <h3 className="font-semibold text-slate-800 flex items-center gap-2">
              <Calendar className="w-5 h-5 text-slate-500" />
              Academic Terms
            </h3>
            <button 
              onClick={openAddTerm}
              className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded-md hover:bg-blue-700 flex items-center gap-1 transition"
            >
              <Plus className="w-4 h-4" /> Add Term
            </button>
          </div>
          <div className="p-4 overflow-x-auto flex-1">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead>
                <tr className="text-slate-500 border-b">
                  <th className="pb-2 font-medium">Term Name</th>
                  <th className="pb-2 font-medium">Dates</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium text-right">Actions</th> {/* NEW HEADER */}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={4} className="py-4 text-center text-slate-400">Loading terms...</td></tr>
                ) : terms.length === 0 ? (
                  <tr><td colSpan={4} className="py-4 text-center text-slate-400">No terms configured.</td></tr>
                ) : (
                  terms.map(term => (
                    <tr key={term.id} className="border-b last:border-0 hover:bg-slate-50 group">
                      <td className="py-3 font-medium text-slate-800">{term.name}</td>
                      <td className="py-3 text-slate-600">{term.startDate} to {term.endDate}</td>
                      <td className="py-3 flex items-center justify-between gap-2">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          term.status === 'Active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
                        }`}>
                          {term.status}
                        </span>
                        
                        {term.status !== 'Active' && (
                          <button 
                            onClick={() => handleActivateTerm(term.id)}
                            className="text-[10px] font-bold text-blue-600 hover:text-blue-800 uppercase tracking-tight border border-blue-200 px-2 py-1 rounded hover:bg-blue-50 transition"
                          >
                            Set Active
                          </button>
                        )}
                      </td>
                      {/* NEW ACTIONS COLUMN */}
                      <td className="py-3 text-right">
                        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button type="button" onClick={() => openEditTerm(term)} className="p-1 text-slate-400 hover:text-blue-600 rounded">
                            <Edit className="w-4 h-4" />
                          </button>
                          <button  type="button" onClick={() => handleDeleteTerm(term.id)} className="p-1 text-slate-400 hover:text-red-600 rounded">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* RIGHT COLUMN: Manage Exam Events */}
        <div className="border border-slate-200 rounded-lg shadow-sm bg-white overflow-hidden flex flex-col">
          <div className="bg-slate-50 border-b border-slate-200 p-4 flex justify-between items-center">
            <h3 className="font-semibold text-slate-800 flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-slate-500" />
              Assessments & Exams
            </h3>
            <button 
              onClick={openAddExam}
              className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded-md hover:bg-blue-700 flex items-center gap-1 transition"
            >
              <Plus className="w-4 h-4" /> Add Exam
            </button>
          </div>
          <div className="p-4 overflow-x-auto flex-1">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead>
                <tr className="text-slate-500 border-b">
                  <th className="pb-2 font-medium">Exam Name</th>
                  <th className="pb-2 font-medium">Max Marks</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium text-right">Actions</th> {/* NEW HEADER */}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={4} className="py-4 text-center text-slate-400">Loading exams...</td></tr>
                ) : exams.length === 0 ? (
                  <tr><td colSpan={4} className="py-4 text-center text-slate-400">No exams configured.</td></tr>
                ) : (
                  exams.map(exam => (
                    <tr key={exam.id} className="border-b last:border-0 hover:bg-slate-50 group">
                      <td className="py-3">
                        <p className="font-medium text-slate-800">{exam.name}</p>
                        <p className="text-xs text-slate-500">{exam.term_name} • {exam.exam_type}</p>
                      </td>
                      <td className="py-3 text-slate-600">{exam.marks}</td>
                      <td className="py-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          exam.status === 'Published' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'
                        }`}>
                          {exam.status}
                        </span>
                      </td>
                      {/* NEW ACTIONS COLUMN */}
                      <td className="py-3 text-right">
                        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button type="button" onClick={() => openEditExam(exam)} title="Edit exam" aria-label={`Edit ${exam.name}`} className="p-1 text-slate-400 hover:text-blue-600 rounded">
                            <Edit className="w-4 h-4" />
                          </button>
                          <button type="button" onClick={() => handleDeleteExam(exam.id)} title="Delete exam" aria-label={`Delete ${exam.name}`} className="p-1 text-slate-400 hover:text-red-600 rounded">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      
      {/* ================= MODALS ================= */}

      {/* NEW: Extracted Term Modal */}
      <TermModal 
        isOpen={isTermModalOpen} 
        onClose={() => setIsTermModalOpen(false)} 
        onSuccess={fetchSetupData}
        academicYears={academicYears}
        editData={editingTerm} // Passes null if adding, or the term data if editing
      />

      {/* NEW: Extracted Exam Modal */}
      <ExamModal 
        isOpen={isExamModalOpen} 
        onClose={() => setIsExamModalOpen(false)} 
        onSuccess={fetchSetupData}
        terms={terms}
        editData={editingExam} // Passes null if adding, or the exam data if editing
      />

      {/* Grading Rules Component */}
      <GradingRulesModal 
        isOpen={isGradingModalOpen} 
        onClose={() => setIsGradingModalOpen(false)} 
      />

    </div>
  );
};

export default ExamSetupTab;