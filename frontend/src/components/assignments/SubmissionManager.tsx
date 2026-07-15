import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Search, CheckCircle2,
  FileText, Download, UploadCloud, Clock, X, Bot, Filter,
  Maximize2, PenTool, RotateCcw, FileEdit, HelpCircle
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../libs/axiosInstance'; // Adjust path to your configured Axios instance

export default function SubmissionManager({ role }: { role: 'admin' | 'teacher' }) {
  // Grab the assignment ID from the URL parameter
  const { id: assignmentId } = useParams(); 
  const navigate = useNavigate();
  
  // --- LIVE DATA STATES ---
  const [loadingRoster, setLoadingRoster] = useState(true);
  const [assignmentTitle, setAssignmentTitle] = useState('Loading...');
  const [roster, setRoster] = useState<any[]>([]);

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  
  // Grading State
  const [selectedStudent, setSelectedStudent] = useState<number | null>(null);
  const [submissionData, setSubmissionData] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  // Tracks unsaved edits so switching students doesn't silently discard grading in progress
  const [isDirty, setIsDirty] = useState(false);
  
  // Modal States
  const [isFileModalOpen, setIsFileModalOpen] = useState(false);
  const [activeEssayId, setActiveEssayId] = useState<number | null>(null);
  const [returnFile, setReturnFile] = useState<File | null>(null);
  // When the assignment is a group assignment, teachers can propagate a grade to every group member
  const [applyToGroup, setApplyToGroup] = useState(false);

  // ==========================================
  // 1. FETCH INITIAL ROSTER (Ghost Detector)
  // ==========================================
  useEffect(() => {
    const fetchRoster = async () => {
      try {
        setLoadingRoster(true);
        // Hits the SubmissionsRosterAPIView
        const response = await api.get(`/api/assignments/${assignmentId}/submissions-roster/`);
        setAssignmentTitle(response.data.assignment_title);
        setRoster(response.data.submissions);
      } catch (error) {
        console.error("Error fetching roster:", error);
        toast.error("Failed to load student roster.");
      } finally {
        setLoadingRoster(false);
      }
    };
    if (assignmentId) fetchRoster();
  }, [assignmentId]);

  // --- FILTER LOGIC ---
  const filteredRoster = roster.filter(s => {
    const matchesSearch = s.student_name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          (s.student_roll && s.student_roll.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesStatus = statusFilter === 'All' || s.status.includes(statusFilter);
    return matchesSearch && matchesStatus;
  });

  // ==========================================
  // 2. FETCH SPECIFIC STUDENT (Data Zip)
  // ==========================================
  const loadStudent = async (studentId: number) => {
    try {
      setSelectedStudent(studentId);
      setSubmissionData(null);

      // Hits the TeacherSubmissionDetailAPIView
      const response = await api.get(`/api/assignments/${assignmentId}/grade/${studentId}/`);
      setSubmissionData(response.data);
      setReturnFile(null); // Reset the file upload state for the new student
      setApplyToGroup(false);
      setIsDirty(false);
    } catch (error) {
      console.error("Error fetching submission:", error);
      toast.error("Failed to load submission data.");
      setSelectedStudent(null);
    }
  };

  const handleStudentClick = (studentId: number, status: string) => {
    if (status === 'Missing') {
      toast.error("Cannot grade a missing submission. Student must submit first.");
      return;
    }

    // Guard against silently discarding unsaved grading when switching students
    if (isDirty && selectedStudent !== studentId) {
      toast((t) => (
        <div className="flex flex-col gap-3 max-w-sm">
          <p className="text-sm font-medium text-slate-800 leading-relaxed">
            You have unsaved grading changes for the current student. Switch anyway and discard them?
          </p>
          <div className="flex justify-end gap-2 mt-2">
            <button
              onClick={() => toast.dismiss(t.id)}
              className="px-3 py-1.5 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors"
            >
              Keep Editing
            </button>
            <button
              onClick={() => { toast.dismiss(t.id); loadStudent(studentId); }}
              className="px-4 py-1.5 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors shadow-sm"
            >
              Discard & Switch
            </button>
          </div>
        </div>
      ), { duration: Infinity, position: 'top-center', style: { minWidth: '320px' } });
      return;
    }

    loadStudent(studentId);
  };

  // ==========================================
  // 3. LIVE LOCAL INPUT HANDLERS
  // ==========================================
  const handleScoreChange = (qId: number, newScore: number) => {
    setIsDirty(true);
    setSubmissionData((prev: any) => {
      const updatedQuestions = prev.questions_zipped.map((q: any) => {
        if (q.question_id !== qId) return q;
        // Clamp client-side too — the number input's max= only constrains the spinner
        // arrows, a typed value could otherwise exceed the question's max_score.
        const clamped = Math.max(0, Math.min(Number(newScore), q.max_score));
        return { ...q, awarded_score: clamped };
      });
      const newTotal = updatedQuestions.reduce((sum: number, q: any) => sum + q.awarded_score, 0);
      return { ...prev, questions_zipped: updatedQuestions, total_awarded_score: newTotal };
    });
  };

  // When a question has rubric criteria, its awarded_score is derived as the sum of
  // per-criterion scores rather than being directly editable.
  const handleCriterionScoreChange = (qId: number, criterionId: number, newScore: number) => {
    setIsDirty(true);
    setSubmissionData((prev: any) => {
      const updatedQuestions = prev.questions_zipped.map((q: any) => {
        if (q.question_id !== qId) return q;
        const updatedCriteria = q.rubric_criteria.map((c: any) => {
          if (c.id !== criterionId) return c;
          const clamped = Math.max(0, Math.min(Number(newScore), c.max_points));
          return { ...c, score: clamped };
        });
        const newQuestionScore = updatedCriteria.reduce((sum: number, c: any) => sum + c.score, 0);
        return { ...q, rubric_criteria: updatedCriteria, awarded_score: newQuestionScore };
      });
      const newTotal = updatedQuestions.reduce((sum: number, q: any) => sum + q.awarded_score, 0);
      return { ...prev, questions_zipped: updatedQuestions, total_awarded_score: newTotal };
    });
  };

  const handleCommentChange = (qId: number, newComment: string) => {
    setIsDirty(true);
    setSubmissionData((prev: any) => ({
      ...prev,
      questions_zipped: prev.questions_zipped.map((q: any) =>
        q.question_id === qId ? { ...q, teacher_comment: newComment } : q
      )
    }));
  };

  const handleCorrectedTextChange = (qId: number, newText: string) => {
    setIsDirty(true);
    setSubmissionData((prev: any) => ({
      ...prev,
      questions_zipped: prev.questions_zipped.map((q: any) =>
        q.question_id === qId ? { ...q, teacher_corrected_text: newText } : q
      )
    }));
  };

  // ==========================================
  // 4. PUSH TO DJANGO (The Save Engine)
  // ==========================================
  const handleSave = async (action: 'Draft' | 'Return' | 'Published') => {
    if (!submissionData) return;
    
    let targetStatus = 'Graded (Draft)';
    if (action === 'Return') targetStatus = 'Returned';
    if (action === 'Published') targetStatus = 'Published';

    try {
      setIsSaving(true);
      const formData = new FormData();
      
      // We pass the clean mapped DB status to the backend
      formData.append('status', action === 'Draft' ? 'Graded' : targetStatus);
      formData.append('overall_feedback', submissionData.overall_feedback || '');
      formData.append('apply_to_group', String(applyToGroup && submissionData.is_group_assignment));

      if (returnFile) {
        formData.append('teacher_returned_file', returnFile);
      }

      // Package granular grades, micro-feedback, the new essay edits, and any rubric criterion scores
      const gradesPayload = submissionData.questions_zipped.map((q: any) => ({
        answer_id: q.answer_id,
        question_id: q.question_id,
        score: q.awarded_score,
        comment: q.teacher_comment || '',
        // SAFEGUARD: Ensure this always passes a string, never null
        corrected_text: q.teacher_corrected_text || '',
        criterion_scores: (q.rubric_criteria || []).map((c: any) => ({ criterion_id: c.id, score: c.score || 0 }))
      }));
      formData.append('grades', JSON.stringify(gradesPayload));

      // Hits the TeacherGradingSaveAPIView
      await api.put(`/api/assignments/grade/save/${submissionData.submission_id}/`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      toast.success(`Submission marked as ${targetStatus}`);
      setIsDirty(false);

      // Update the left sidebar roster instantly without requiring a full page refresh
      setRoster(prev => prev.map(s =>
        s.student_id === selectedStudent
          ? { ...s, status: targetStatus, score: submissionData.total_awarded_score }
          : s
      ));

    } catch (error) {
      console.error("Error saving grade:", error);
      toast.error("Failed to save grading.");
    } finally {
      setIsSaving(false);
    }
  };

  const confirmPublish = () => {
    toast((t) => (
      <div className="flex flex-col gap-3 max-w-sm">
        <p className="text-sm font-medium text-slate-800 leading-relaxed">
          Publish this grade? {submissionData?.student_name} will immediately be able to see their score and feedback.
        </p>
        <div className="flex justify-end gap-2 mt-2">
          <button
            onClick={() => toast.dismiss(t.id)}
            className="px-3 py-1.5 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => { toast.dismiss(t.id); handleSave('Published'); }}
            className="px-4 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md transition-colors shadow-sm"
          >
            Publish Grade
          </button>
        </div>
      </div>
    ), { duration: Infinity, position: 'top-center', style: { minWidth: '320px' } });
  };

  const handleBackToAssignments = () => {
    const basePath = role === 'admin' ? '/admin-dashboard/assignments' : '/teacher-dashboard/assignments';
    navigate(basePath);
  };

  // Off-palette purple replaced with amber+icon — this app's palette is slate/blue/emerald/amber/red.
  // "Returned" reuses the same amber as the "Return for Revision" button that creates it (a deliberate
  // link), distinguished from "Pending Review" (also amber) by the RotateCcw icon vs Clock icon.
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'Pending Review': return <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-100 text-amber-700 text-xs font-semibold rounded-md border border-amber-200"><Clock className="w-3 h-3" /> Pending</span>;
      case 'Graded (Draft)':
      case 'Graded': return <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-100 text-blue-700 text-xs font-semibold rounded-md border border-blue-200"><FileEdit className="w-3 h-3" /> Draft</span>;
      case 'Published': return <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-100 text-emerald-700 text-xs font-semibold rounded-md border border-emerald-200"><CheckCircle2 className="w-3 h-3" /> Published</span>;
      case 'Returned': return <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-100 text-amber-700 text-xs font-semibold rounded-md border border-amber-200"><RotateCcw className="w-3 h-3" /> Returned</span>;
      default: return <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 text-slate-500 text-xs font-semibold rounded-md border border-slate-200"><HelpCircle className="w-3 h-3" /> Missing</span>;
    }
  };

  // Helper to grab the specific essay being edited in the modal
  const activeEssay = activeEssayId ? submissionData?.questions_zipped.find((q: any) => q.question_id === activeEssayId) : null;

  return (
    <div className="flex h-[calc(100vh-80px)] bg-slate-100 overflow-hidden font-sans">
      
      {/* ========================================== */}
      {/* LEFT SIDEBAR: THE ROSTER INBOX             */}
      {/* ========================================== */}
      <div className="w-80 bg-white border-r border-slate-200 flex flex-col h-full shadow-sm z-10 shrink-0">
        <div className="p-5 border-b border-slate-200 bg-white">
          <button onClick={handleBackToAssignments} className="flex items-center gap-2 text-slate-500 hover:text-blue-600 transition-colors mb-4 text-sm font-medium">
            <ArrowLeft className="w-4 h-4" /> Back to Assignments
          </button>
          
          <h2 className="font-extrabold text-slate-800 text-xl leading-tight">{assignmentTitle}</h2>
          <p className="text-xs font-medium text-slate-500 mt-1.5 flex items-center gap-1.5">
            <span className="px-2 py-0.5 bg-slate-100 rounded border border-slate-200 text-slate-600">Roster</span> 
            • {filteredRoster.length} {filteredRoster.length === 1 ? 'Student' : 'Students'}
          </p>
          
          <div className="space-y-3 mt-5">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input 
                type="text" placeholder="Search student..." 
                value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              />
            </div>
            
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-slate-400 shrink-0" />
              <select 
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 text-slate-700 py-2 px-3 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 cursor-pointer"
              >
                <option value="All">All Statuses</option>
                <option value="Pending">Pending Review</option>
                <option value="Graded">Graded (Draft)</option>
                <option value="Published">Published</option>
                <option value="Missing">Missing</option>
              </select>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-slate-50/50">
          {loadingRoster ? (
            <div className="space-y-2 animate-pulse">
              {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-20 bg-slate-200 rounded-xl"></div>)}
            </div>
          ) : filteredRoster.length === 0 ? (
             <div className="text-center p-6 text-sm text-slate-500">No students match your filter.</div>
          ) : (
            filteredRoster.map(sub => (
              <button
                key={sub.student_id}
                onClick={() => handleStudentClick(sub.student_id, sub.status)}
                className={`w-full text-left p-4 rounded-xl border transition-all flex flex-col gap-3 ${
                  selectedStudent === sub.student_id 
                    ? 'bg-white border-blue-400 shadow-md ring-1 ring-blue-500/10' 
                    : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-sm'
                }`}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <span className="font-bold text-slate-800 text-sm block">{sub.student_name}</span>
                    <span className="text-xs font-medium text-slate-400">{sub.student_roll || "N/A"}</span>
                  </div>
                  {sub.is_late && <span className="text-[10px] font-black bg-red-100 text-red-700 px-2 py-0.5 rounded border border-red-200 uppercase tracking-wide">Late</span>}
                </div>
                {sub.group_name && (
                  <span className="text-[10px] font-bold text-purple-700 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded w-fit">{sub.group_name}</span>
                )}
                <div className="flex justify-between items-center w-full">
                  {getStatusBadge(sub.status)}
                  {sub.status !== 'Missing' && <span className="text-xs font-bold text-slate-600 bg-slate-100 px-2 py-1 rounded-md">{sub.score} / {sub.max_score}</span>}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* ========================================== */}
      {/* RIGHT MAIN PANEL: FULL-SCREEN GRADING DESK */}
      {/* ========================================== */}
      <div className="flex-1 flex flex-col h-full relative overflow-hidden">
        {!selectedStudent || !submissionData ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-8 text-center bg-slate-50">
            <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center shadow-sm border border-slate-100 mb-4">
              <FileText className="w-10 h-10 text-slate-300" />
            </div>
            <h3 className="text-2xl font-bold text-slate-700">Select a Student</h3>
            <p className="text-sm mt-2 max-w-sm text-slate-500">Choose a student from the inbox on the left to review their submission and assign grades.</p>
          </div>
        ) : (
          <>
            <div className="bg-white border-b border-slate-200 px-6 py-4 flex flex-col 2xl:flex-row 2xl:items-center justify-between shrink-0 shadow-sm z-10 sticky top-0 gap-4">
              <div className="min-w-0">
                <h1 className="text-2xl font-extrabold text-slate-800 flex items-center gap-3 truncate">
                  {submissionData.student_name}
                  {submissionData.is_late && <span className="text-[11px] font-bold bg-red-100 text-red-700 px-2 py-1 rounded-md border border-red-200 uppercase tracking-wider shrink-0">Late Submission</span>}
                  {submissionData.is_group_assignment && submissionData.group_name && (
                    <span className="text-[11px] font-bold bg-purple-100 text-purple-700 px-2 py-1 rounded-md border border-purple-200 uppercase tracking-wider shrink-0">{submissionData.group_name}</span>
                  )}
                </h1>
                <p className="flex items-center gap-1.5 mt-1 text-sm font-medium text-slate-500">
                  <Clock className="w-4 h-4 text-slate-400 shrink-0" /> <span className="truncate">Submitted: {submissionData.submitted_at ? new Date(submissionData.submitted_at).toLocaleString() : 'N/A'}</span>
                </p>
              </div>

              <div className="flex items-center gap-5 overflow-x-auto pb-2 2xl:pb-0">
                <div className="flex items-center gap-3 bg-slate-50 px-4 py-2 rounded-xl border border-slate-200 shrink-0">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Score</span>
                  <div className="h-6 w-px bg-slate-300"></div>
                  <p className="text-2xl font-black text-blue-600 whitespace-nowrap">
                    {submissionData.total_awarded_score} <span className="text-base text-slate-400 font-bold">/ {submissionData.total_max_score}</span>
                  </p>
                </div>
                
                <div className="h-10 w-px bg-slate-200 hidden md:block shrink-0"></div>

                {submissionData.is_group_assignment && (
                  <label className="flex items-center gap-2 text-xs font-bold text-purple-700 bg-purple-50 border border-purple-200 px-3 py-2 rounded-lg shrink-0 cursor-pointer">
                    <input type="checkbox" checked={applyToGroup} onChange={(e) => setApplyToGroup(e.target.checked)} />
                    Apply to whole group
                  </label>
                )}

                <div className="flex items-center gap-2.5 shrink-0">
                  <button onClick={() => handleSave('Draft')} disabled={isSaving} className="px-4 py-2.5 bg-white border border-slate-300 text-slate-700 rounded-lg text-sm font-bold hover:bg-slate-50 transition-colors shadow-sm disabled:opacity-50 whitespace-nowrap">
                    Save Draft
                  </button>
                  <button onClick={() => handleSave('Return')} disabled={isSaving} className="px-4 py-2.5 bg-amber-50 border border-amber-200 text-amber-700 rounded-lg text-sm font-bold hover:bg-amber-100 transition-colors shadow-sm disabled:opacity-50 whitespace-nowrap">
                    Return for Revision
                  </button>
                  <button onClick={confirmPublish} disabled={isSaving} className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 border border-emerald-700 text-white rounded-lg text-sm font-bold hover:bg-emerald-700 transition-colors shadow-sm disabled:opacity-50 whitespace-nowrap">
                    <CheckCircle2 className="w-4 h-4" /> Publish Grade
                  </button>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-8 space-y-8 bg-slate-50/50">
              
              {/* MASTER FEEDBACK & MODAL TRIGGER */}
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex flex-col xl:flex-row gap-6">
                <div className="flex-1 space-y-3">
                  <h3 className="text-sm font-extrabold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                    Overall Master Feedback
                  </h3>
                  <textarea
                    placeholder="Enter comprehensive feedback for the student here..."
                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all min-h-30"
                    value={submissionData.overall_feedback || ''}
                    onChange={(e) => { setIsDirty(true); setSubmissionData({...submissionData, overall_feedback: e.target.value}); }}
                  />
                </div>
                
                <div className="w-full xl:w-72 bg-blue-50 rounded-xl border border-blue-100 p-5 flex flex-col justify-center items-center text-center space-y-3">
                  <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-sm text-blue-600 mb-1">
                    <FileText className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-800">File Attachments</h4>
                    <p className="text-xs text-slate-500 mt-1">Student upload & Teacher returns</p>
                  </div>
                  <button 
                    onClick={() => setIsFileModalOpen(true)}
                    className="w-full py-2.5 bg-blue-600 text-white text-sm font-bold rounded-lg shadow-sm hover:bg-blue-700 transition-colors whitespace-nowrap"
                  >
                    Manage Files
                  </button>
                </div>
              </div>

              {/* QUESTIONS MAP */}
              <div className="space-y-6">
                {submissionData.questions_zipped?.map((q: any, index: number) => (
                  <div key={q.question_id} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                    
                    <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex flex-wrap gap-4 justify-between items-center">
                      <div className="flex items-center gap-4">
                        <span className="font-extrabold text-slate-800 text-base">Question {index + 1}</span>
                        <span className="px-2.5 py-1 bg-white border border-slate-200 rounded-md text-xs font-bold text-slate-500 tracking-wide">
                          {q.question_type.replace('_', ' ')}
                        </span>
                        
                        {q.is_auto_graded && (
                           <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold border ${q.awarded_score === q.max_score ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                             <Bot className="w-3.5 h-3.5" /> 
                             {q.awarded_score === q.max_score ? 'Auto-Marked: Correct' : 'Auto-Marked: Incorrect'}
                           </div>
                        )}
                      </div>
                      <span className="text-sm font-black text-slate-600 bg-white px-3 py-1 rounded-lg border border-slate-200">{q.max_score} Points Possible</span>
                    </div>

                    <div className="p-6 flex flex-col lg:flex-row gap-8">
                      
                      <div className="flex-1 space-y-6">
                        <p className="text-slate-800 font-medium text-base whitespace-pre-wrap leading-relaxed">{q.question_text}</p>
                        
                        {/* --- DYNAMIC RENDER: ESSAY vs SHORT --- */}
                        {q.question_type === 'ESSAY' ? (
                          <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 flex flex-col items-center justify-center text-center space-y-3">
                            <p className="text-sm text-blue-800 font-medium">This is a long-form essay response.</p>
                            <button 
                              onClick={() => setActiveEssayId(q.question_id)}
                              className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2.5 rounded-lg text-sm font-bold shadow-sm hover:bg-blue-700 transition-colors"
                            >
                              <Maximize2 className="w-4 h-4" /> Open Grading Studio
                            </button>
                            {q.teacher_corrected_text && <p className="text-xs text-emerald-600 font-bold mt-2"><CheckCircle2 className="w-3 h-3 inline mr-1" /> Contains Teacher Corrections</p>}
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 relative overflow-hidden">
                              <div className="absolute top-0 left-0 w-1 h-full bg-slate-300"></div>
                              <p className="text-xs font-extrabold text-slate-500 uppercase tracking-wider mb-2">System Correct Answer</p>
                              <p className="text-sm text-slate-700 font-medium">{q.correct_answer || <span className="italic text-slate-400">Manual Grading Required</span>}</p>
                            </div>
                            
                            <div className={`p-4 rounded-xl border relative overflow-hidden ${
                              q.is_auto_graded 
                                ? (q.awarded_score === q.max_score ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200')
                                : 'bg-blue-50 border-blue-200'
                            }`}>
                              <div className={`absolute top-0 left-0 w-1 h-full ${
                                q.is_auto_graded ? (q.awarded_score === q.max_score ? 'bg-emerald-500' : 'bg-red-500') : 'bg-blue-500'
                              }`}></div>
                              <p className="text-xs font-extrabold uppercase tracking-wider mb-2 flex justify-between">
                                <span className={q.is_auto_graded ? (q.awarded_score === q.max_score ? 'text-emerald-700' : 'text-red-700') : 'text-blue-700'}>
                                  Student's Answer
                                </span>
                              </p>
                              <p className={`text-sm font-medium ${q.is_auto_graded ? (q.awarded_score === q.max_score ? 'text-emerald-900' : 'text-red-900') : 'text-blue-900'}`}>
                                {q.student_text_answer || <span className="italic opacity-60">No Answer Provided</span>}
                              </p>
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="w-full lg:w-56 shrink-0 space-y-4 border-t lg:border-t-0 lg:border-l border-slate-200 pt-6 lg:pt-0 lg:pl-6">
                        {q.rubric_criteria && q.rubric_criteria.length > 0 ? (
                          <div>
                            <label className="text-xs font-extrabold text-purple-600 uppercase tracking-wider mb-2 block">Rubric Scoring</label>
                            <div className="space-y-2">
                              {q.rubric_criteria.map((c: any) => (
                                <div key={c.id} className="flex items-center justify-between gap-2 bg-purple-50 border border-purple-200 rounded-lg px-2.5 py-2">
                                  <span className="text-xs text-purple-800 font-medium leading-tight">{c.criterion_text}</span>
                                  <div className="flex items-center gap-1 shrink-0">
                                    <input
                                      type="number" min={0} max={c.max_points} value={c.score || 0}
                                      onChange={(e) => handleCriterionScoreChange(q.question_id, c.id, parseFloat(e.target.value) || 0)}
                                      className="w-12 p-1 bg-white border border-purple-200 rounded text-center text-sm font-bold text-purple-700"
                                      aria-label={`Score for ${c.criterion_text}`}
                                    />
                                    <span className="text-[10px] text-purple-500">/{c.max_points}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                            <p className="text-center font-black text-lg text-blue-700 mt-2">{q.awarded_score} <span className="text-sm text-slate-400 font-bold">/ {q.max_score}</span></p>
                          </div>
                        ) : (
                          <div>
                            <label className="text-xs font-extrabold text-slate-500 uppercase tracking-wider mb-2 block">Awarded Score</label>
                            <div className="relative">
                              <input
                                type="number" min="0" max={q.max_score} value={q.awarded_score || 0}
                                onChange={(e) => handleScoreChange(q.question_id, parseFloat(e.target.value) || 0)}
                                className="w-full p-3 bg-white border border-slate-300 rounded-xl font-black text-xl text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all text-center"
                              />
                              {q.is_auto_graded && (
                                <p className="text-[10px] text-slate-400 mt-1.5 text-center leading-tight">Auto-graded — you can override this score</p>
                              )}
                            </div>
                          </div>
                        )}
                        <div>
                          <label className="text-xs font-extrabold text-slate-500 uppercase tracking-wider mb-2 block">Micro-Feedback</label>
                          <textarea 
                            rows={2} placeholder="Note for this answer..." value={q.teacher_comment || ''}
                            onChange={(e) => handleCommentChange(q.question_id, e.target.value)}
                            className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all resize-none"
                          />
                        </div>
                      </div>

                    </div>
                  </div>
                ))}
              </div>

            </div>
          </>
        )}
      </div>

      {/* ========================================== */}
      {/* 1. THE FILE EXCHANGE MODAL                 */}
      {/* ========================================== */}
      {isFileModalOpen && submissionData && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-3xl rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
            
            <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center"><FileText className="w-5 h-5"/></div>
                <div>
                  <h3 className="font-bold text-slate-800 text-lg">File Exchange</h3>
                  <p className="text-xs text-slate-500">Manage documents for {submissionData.student_name}</p>
                </div>
              </div>
              <button onClick={() => setIsFileModalOpen(false)} title="Close" aria-label="Close file exchange" className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-8 flex flex-col md:flex-row gap-8 bg-white">
              <div className="flex-1 space-y-3">
                <h4 className="text-xs font-extrabold text-slate-500 uppercase tracking-wider">Student's Original Upload</h4>
                {submissionData.student_attachment ? (
                  <div className="border border-blue-200 bg-blue-50 p-6 rounded-xl text-center space-y-4">
                    <FileText className="w-12 h-12 text-blue-400 mx-auto" />
                    <p className="text-sm font-bold text-blue-900 text-ellipsis overflow-hidden">{submissionData.student_attachment.split('/').pop()}</p>
                    <a href={submissionData.student_attachment} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-bold shadow-sm hover:bg-blue-700 transition-colors whitespace-nowrap">
                      <Download className="w-4 h-4" /> Download to Grade
                    </a>
                  </div>
                ) : (
                  <div className="border border-slate-200 bg-slate-50 p-6 rounded-xl text-center flex flex-col items-center justify-center min-h-45">
                    <p className="text-sm text-slate-500 font-medium">No file was uploaded by the student.</p>
                  </div>
                )}
              </div>

              <div className="flex-1 space-y-3">
                <h4 className="text-xs font-extrabold text-slate-500 uppercase tracking-wider">Upload Annotated Return File</h4>
                <div className="border-2 border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 transition-colors p-6 rounded-xl text-center relative flex flex-col items-center justify-center min-h-45 cursor-pointer group">
                   <input 
                       type="file" 
                       onChange={(e) => setReturnFile(e.target.files ? e.target.files[0] : null)}
                       className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                   />
                   <div className="w-12 h-12 bg-white rounded-full shadow-sm flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
                     <UploadCloud className="w-6 h-6 text-slate-500" />
                   </div>
                   <p className="text-sm font-bold text-slate-700">
                     {returnFile ? returnFile.name : (submissionData.teacher_returned_file ? "Replace Returned File" : "Click to browse or drop file")}
                   </p>
                   <p className="text-xs text-slate-500 mt-1">PDF, Image, or Word Doc</p>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex justify-end">
              <button onClick={() => setIsFileModalOpen(false)} className="px-6 py-2.5 bg-slate-800 text-white rounded-lg text-sm font-bold hover:bg-slate-900 shadow-sm transition-colors">
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* 2. THE ESSAY GRADING STUDIO MODAL          */}
      {/* ========================================== */}
      {activeEssayId && activeEssay && (
         <div className="fixed inset-0 z-70 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-4 sm:p-6 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-6xl h-[90vh] rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
            
            {/* Studio Header */}
            <div className="bg-slate-800 px-6 py-4 flex justify-between items-center shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-slate-700 text-blue-400 rounded-xl flex items-center justify-center"><PenTool className="w-5 h-5"/></div>
                <div>
                  <h3 className="font-bold text-white text-lg">Essay Grading Studio</h3>
                  <p className="text-xs text-slate-400">Student: {submissionData.student_name}</p>
                </div>
              </div>
              <button onClick={() => setActiveEssayId(null)} title="Close" aria-label="Close essay grading studio" className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Studio Workspace */}
            <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
              
              {/* Main Reading & Editing Area */}
              <div className="flex-1 flex flex-col overflow-y-auto p-6 space-y-6 bg-slate-50">
                {/* The Prompt */}
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                   <p className="text-xs font-extrabold text-slate-500 uppercase tracking-wider mb-2">The Prompt</p>
                   <p className="text-slate-800 font-medium whitespace-pre-wrap">{activeEssay.question_text}</p>
                </div>

                <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-75">
                  {/* Read-Only Original */}
                  <div className="flex flex-col space-y-2">
                    <p className="text-xs font-extrabold text-slate-500 uppercase tracking-wider">Student's Original Submission</p>
                    <div className="flex-1 bg-slate-100 border border-slate-200 rounded-xl p-5 text-slate-600 text-sm leading-relaxed overflow-y-auto">
                      {activeEssay.student_text_answer || <span className="italic">No text submitted.</span>}
                    </div>
                  </div>

                  {/* Teacher's Editable Copy */}
                  <div className="flex flex-col space-y-2">
                    <p className="text-xs font-extrabold text-blue-600 uppercase tracking-wider flex justify-between items-center">
                      <span>Teacher's Edited Version</span>
                      <span className="text-[10px] bg-blue-100 px-2 py-0.5 rounded text-blue-700">Add inline corrections here</span>
                    </p>
                    <textarea 
                      className="flex-1 bg-white border border-blue-200 rounded-xl p-5 text-slate-800 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-500/20 shadow-inner resize-none"
                      // Safely load either the existing correction or the original text
                      value={activeEssay.teacher_corrected_text || activeEssay.student_text_answer || ''}
                      onChange={(e) => handleCorrectedTextChange(activeEssay.question_id, e.target.value)}
                      placeholder="Make corrections directly in this text..."
                    />
                  </div>
                </div>
              </div>

              {/* Sidebar Scoring Panel */}
              <div className="w-full lg:w-80 bg-white border-t lg:border-t-0 lg:border-l border-slate-200 p-6 flex flex-col shrink-0">
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-5 mb-6 text-center">
                  <span className="text-xs font-extrabold text-blue-800 uppercase tracking-wider block mb-2">Assign Score</span>
                  <div className="flex items-end justify-center gap-2">
                    <input 
                      type="number" min="0" max={activeEssay.max_score} value={activeEssay.awarded_score || 0}
                      onChange={(e) => handleScoreChange(activeEssay.question_id, parseInt(e.target.value) || 0)}
                      className="w-20 p-2 bg-white border border-blue-200 rounded-lg font-black text-3xl text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 text-center"
                    />
                    <span className="text-lg font-bold text-slate-400 mb-1">/ {activeEssay.max_score}</span>
                  </div>
                </div>

                <div className="flex-1 flex flex-col">
                  <label className="text-xs font-extrabold text-slate-500 uppercase tracking-wider mb-2 block">Micro-Feedback Summary</label>
                  <textarea 
                    placeholder="General notes on this essay..." 
                    value={activeEssay.teacher_comment || ''}
                    onChange={(e) => handleCommentChange(activeEssay.question_id, e.target.value)}
                    className="flex-1 w-full p-4 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all resize-none mb-6"
                  />
                  <button 
                    onClick={() => setActiveEssayId(null)}
                    className="w-full py-3 bg-slate-800 text-white rounded-xl text-sm font-bold shadow-sm hover:bg-slate-900 transition-colors"
                  >
                    Save & Close Studio
                  </button>
                </div>
              </div>

            </div>
          </div>
         </div>
      )}

    </div>
  );
}