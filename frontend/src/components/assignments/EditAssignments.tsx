import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { 
  ArrowLeft, 
  Save, 
  UploadCloud, 
  ListPlus, 
  UserSquare2,  
  BookOpen,
  X,
  Lock // <-- NEW: Used to indicate read-only fields
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { Assignment, Question } from '../../libs/assignments';
import { assignmentService } from '../../libs/assignmentService';
import QuestionBuilder from './QuestionBuilder';
import AssignmentOptionsPanel from './AssignmentOptionsPanel';
import api from '../../libs/axiosInstance';
import SearchableSelect from '../common/SearchableSelect';

interface EditAssignmentProps {
  role: 'admin' | 'teacher';
}

// Helper: Django sends ISO dates (2026-05-20T14:30:00Z). HTML datetime-local needs: 2026-05-20T14:30
const formatForDateTimeLocal = (isoString: string | undefined | null) => {
  if (!isoString) return '';
  return isoString.substring(0, 16);
};

export default function EditAssignment({ role }: EditAssignmentProps) {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>(); // Grabs the ID from the URL (/assignments/edit/12)
  const [loading, setLoading] = useState(false);
  const [initialFetchDone, setInitialFetchDone] = useState(false);
  
  // --- Data States ---
  const [teachers, setTeachers] = useState<any[]>([]); 
  const [classes, setClasses] = useState<any[]>([]);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [filteredSubjects, setFilteredSubjects] = useState<any[]>([]); 

  // --- Form States ---
  const [uploadMode, setUploadMode] = useState<boolean>(true);
  const [isQuestionModalOpen, setIsQuestionModalOpen] = useState<boolean>(false);
  const [isPublishedMode, setIsPublishedMode] = useState<boolean>(false); // SAFETY LOCK
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  
  const [assignment, setAssignment] = useState<Partial<Assignment>>({});
  const [questions, setQuestions] = useState<Question[]>([]);

  const classStreamOptions = classes.flatMap((grade: any) =>
    (grade.streams || []).map((stream: any) => ({ id: stream.id, label: stream.name }))
  );

  // 1. Fetch Master Data & Existing Assignment Data
  useEffect(() => {
    const fetchEverything = async () => {
      if (!id) return;

      try {
        setLoading(true);
        // Fetch Dropdown Metadata
        const [classRes, subRes] = await Promise.all([
          api.get('/api/manage-classes/'),
          api.get('/api/manage-subjects/')
        ]);
        
        const classData = classRes.data?.data || [];
        const subData = subRes.data?.data || [];
        setClasses(Array.isArray(classData) ? classData : []);
        setSubjects(Array.isArray(subData) ? subData : []);
        setFilteredSubjects(Array.isArray(subData) ? subData : []);

        // Fetch the Specific Assignment
        const assignData = await assignmentService.getAssignmentById(id);
        
        // Populate the form state
        setAssignment({
          ...assignData,
          publish_date: formatForDateTimeLocal(assignData.publish_date),
          due_date: formatForDateTimeLocal(assignData.due_date),
          cutoff_date: formatForDateTimeLocal(assignData.cutoff_date),
        });

        // Populate questions
        if (assignData.questions && assignData.questions.length > 0) {
          setQuestions(assignData.questions);
          setUploadMode(false); // If it has questions, swap to builder mode
        } else {
          setUploadMode(true);
        }

        // --- ACTIVATE SAFETY LOCK IF PUBLISHED ---
        if (assignData.status === 'Published') {
          setIsPublishedMode(true);
        }

        // Fetch Teacher Data based on Role
        if (role === 'admin') {
          const teacherRes = await api.get('/api/approved-users/teachers/');
          const teacherData = teacherRes.data?.data || [];
          setTeachers(Array.isArray(teacherData) ? teacherData : []);
        } else if (role === 'teacher' && !assignData.teacher_id) {
            // Backup in case teacher_id is missing, but backend should supply it
            const profileRes = await api.get('/api/my-profile/');
            const profileData = profileRes.data?.data || {};
            if (profileData.teacher_id) {
              setAssignment(prev => ({ ...prev, teacher_id: profileData.teacher_id.toString() }));
            }
        }

        setInitialFetchDone(true);
      } catch (error) {
        console.error("Error fetching data:", error);
        toast.error("Failed to load assignment data.");
        navigate('..'); // Kick them back if the ID doesn't exist
      } finally {
        setLoading(false);
      }
    };
    
    fetchEverything();
  }, [id, role, navigate]);

  // 2. Dynamic Subject Filtering (Admin Dropdown String Matching)
  useEffect(() => {
    if (!initialFetchDone || role !== 'admin') return;

    if (assignment.teacher_id) {
      const selectedTeacher = teachers.find(t => t.id.toString() === assignment.teacher_id?.toString());
      if (selectedTeacher && selectedTeacher.subjects && selectedTeacher.subjects !== "N/A") {
        const teacherSubjectNames = selectedTeacher.subjects
          .split(',')
          .map((s: string) => s.trim().toLowerCase());
          
        const available = subjects.filter(sub => 
          teacherSubjectNames.includes(sub.name.toLowerCase())
        );
        setFilteredSubjects(available.length > 0 ? available : subjects);
      } else {
        setFilteredSubjects(subjects);
      }
    } else {
      setFilteredSubjects([]);
    }
  }, [assignment.teacher_id, teachers, subjects, role, initialFetchDone]);

  // --- Handlers ---
  const handleAssignmentChange = (field: keyof Assignment | 'strand_name', value: any) => {
    setAssignment(prev => ({ ...prev, [field]: value }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleAssignmentChange('teacher_attachment', e.target.files[0]);
    }
  };

  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingFile(false);
    if (isPublishedMode) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleAssignmentChange('teacher_attachment', e.dataTransfer.files[0]);
    }
  };

  const handleSubmit = async (e: React.FormEvent, isDraft: boolean) => {
    e.preventDefault();
    if (!id) return;

    // Basic Validation
    if (!assignment.title || !assignment.class_stream_id || !assignment.subject_id) {
      toast.error("Please fill in all required fields (Title, Class, Subject).");
      return;
    }

    // Schedule must make chronological sense — nothing previously stopped a Due
    // Date before the Publish Date, or a Cutoff before the Due Date.
    const { publish_date, due_date, cutoff_date } = assignment;
    if (publish_date && due_date && new Date(due_date) < new Date(publish_date)) {
      toast.error("Due Date can't be before the Publish Date.");
      return;
    }
    if (due_date && cutoff_date && new Date(cutoff_date) < new Date(due_date)) {
      toast.error("Cutoff Date can't be before the Due Date.");
      return;
    }
    if (publish_date && cutoff_date && !due_date && new Date(cutoff_date) < new Date(publish_date)) {
      toast.error("Cutoff Date can't be before the Publish Date.");
      return;
    }

    try {
      setLoading(true);
      const finalAssignment = { 
        ...assignment, 
        status: isDraft ? 'Draft' : 'Published' 
      } as Assignment;

      const finalQuestions = uploadMode ? [] : questions;

      await assignmentService.updateAssignment(id, finalAssignment, finalQuestions);
      
      toast.success(`Assignment updated successfully!`);
      navigate('..'); 
    } catch (error: any) {
      console.error("Error updating assignment:", error);
      const serverErrorMessage = error.response?.data?.error;
      if (serverErrorMessage) {
        toast.error(serverErrorMessage);
      } else {
        toast.error("Failed to save assignment. Please check the inputs.");
      }
    } finally {
      setLoading(false);
    }
  };

  if (!initialFetchDone) {
    return (
      <div className="max-w-5xl mx-auto space-y-6 animate-pulse">
        <div className="h-14 bg-slate-200 dark:bg-slate-800 rounded-2xl"></div>
        <div className="h-40 bg-slate-200 dark:bg-slate-800 rounded-2xl"></div>
        <div className="h-56 bg-slate-200 dark:bg-slate-800 rounded-2xl"></div>
        <div className="h-40 bg-slate-200 dark:bg-slate-800 rounded-2xl"></div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-20">

      {/* 1. Header & Actions */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('..')}
            aria-label="Go back"
            title="Go back"
            className="p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="p-2.5 rounded-2xl text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10">
            <ListPlus className="w-6 h-6" strokeWidth={2.5} />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Edit Assignment</h1>
              {isPublishedMode && (
                <span className="px-2.5 py-1 bg-emerald-100 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-400 text-xs font-semibold rounded-md border border-emerald-200 dark:border-emerald-500/40 flex items-center gap-1">
                  <Lock className="w-3 h-3" /> Live (Limited Editing)
                </span>
              )}
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400">Update details or extend deadlines.</p>
          </div>
        </div>

        <div className="flex gap-3">
          {/* Only show "Save Draft" if it isn't already published */}
          {!isPublishedMode && (
            <button
              onClick={(e) => handleSubmit(e, true)}
              disabled={loading}
              aria-label="Save draft"
              title="Save draft"
              className="px-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
            >
              Save Draft
            </button>
          )}
          <button 
            onClick={(e) => handleSubmit(e, false)}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 shadow-sm"
          >
            <Save className="w-4 h-4" />
            {loading ? 'Saving...' : (isPublishedMode ? 'Save Changes' : 'Publish Now')}
          </button>
        </div>
      </div>

      <form className="space-y-6">
        
        {/* 2. ADMIN ONLY: Impersonation Block (Disabled if published to prevent ownership breaking) */}
        {role === 'admin' && (
          <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/40 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <UserSquare2 className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              <h3 className="font-semibold text-amber-800 dark:text-amber-300">Admin Override: Assigned Teacher</h3>
            </div>
            <div className="w-full md:w-1/2">
              <SearchableSelect
                id="assigned-teacher-select"
                value={assignment.teacher_id || ''}
                onChange={(val) => handleAssignmentChange('teacher_id', val)}
                disabled={isPublishedMode}
                placeholder="-- Select Teacher --"
                searchPlaceholder="Search teachers…"
                options={teachers.map(t => ({
                  value: String(t.id),
                  label: t.name || `${t.first_name || ''} ${t.last_name || ''}`.trim(),
                }))}
              />
            </div>
          </div>
        )}

        {/* 3. Basic Details Card */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-sm dark:shadow-none border border-slate-100 dark:border-slate-700 space-y-5">
          <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100 border-b border-slate-100 dark:border-slate-700 pb-3">General Information</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Assignment Title <span className="text-red-500">*</span></label>
              <input
                type="text"
                className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm outline-none transition-all focus:bg-white dark:focus:bg-slate-800 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 dark:focus:border-blue-400"
                value={assignment.title || ''}
                onChange={(e) => handleAssignmentChange('title', e.target.value)}
              />
            </div>

            <div>
              <label htmlFor="class-stream" className="flex text-sm font-medium text-slate-700 dark:text-slate-200 mb-1 justify-between">
                <span>Class Stream <span className="text-red-500">*</span></span>
                {isPublishedMode && <Lock className="w-4 h-4 text-slate-400 dark:text-slate-500" />}
              </label>
              <SearchableSelect
                id="class-stream"
                aria-label="Class Stream"
                value={assignment.class_stream_id || ''}
                onChange={(v) => handleAssignmentChange('class_stream_id', v)}
                disabled={isPublishedMode}
                placeholder="Select Class"
                searchPlaceholder="Search grade or stream…"
                options={classes.flatMap((grade: any) =>
                  grade.streams.map((stream: any) => ({
                    value: String(stream.id),
                    label: stream.name.startsWith(grade.grade_name) ? stream.name.slice(grade.grade_name.length).trim() : stream.name,
                    sublabel: grade.grade_name,
                  }))
                )}
              />
            </div>

            <div>
              <label className="flex text-sm font-medium text-slate-700 dark:text-slate-200 mb-1 justify-between">
                <span>Subject <span className="text-red-500">*</span></span>
                {isPublishedMode && <Lock className="w-4 h-4 text-slate-400 dark:text-slate-500" />}
              </label>
              <SearchableSelect
                aria-label="Subject"
                value={assignment.subject_id || ''}
                onChange={(v) => handleAssignmentChange('subject_id', v)}
                disabled={isPublishedMode || (role === 'admin' && !assignment.teacher_id)}
                placeholder="Select Subject"
                searchPlaceholder="Search subjects…"
                options={filteredSubjects.map(s => ({ value: String(s.id), label: s.name }))}
              />
            </div>
          </div>
        </div>

        {/* 4. Curriculum Type */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-sm dark:shadow-none border border-slate-100 dark:border-slate-700 space-y-5">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 pb-3">
            <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              Curriculum Mapping
              {isPublishedMode && <Lock className="w-4 h-4 text-slate-400 dark:text-slate-500" />}
            </h3>
            <div className={`flex p-1 rounded-lg ${isPublishedMode ? 'bg-slate-50 dark:bg-slate-800/40 opacity-50 pointer-events-none' : 'bg-slate-100 dark:bg-slate-800'}`}>
              <button
                type="button"
                onClick={() => handleAssignmentChange('curriculum_type', 'CBC')}
                aria-pressed={assignment.curriculum_type === 'CBC'}
                className={`px-3 py-1 text-sm font-medium rounded-md transition-all ${assignment.curriculum_type === 'CBC' ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
              >
                CBC
              </button>
              <button
                type="button"
                onClick={() => handleAssignmentChange('curriculum_type', '8-4-4')}
                aria-pressed={assignment.curriculum_type === '8-4-4'}
                className={`px-3 py-1 text-sm font-medium rounded-md transition-all ${assignment.curriculum_type === '8-4-4' ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
              >
                8-4-4
              </button>
            </div>
          </div>

          {assignment.curriculum_type === 'CBC' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Curriculum Strand</label>
                <input
                  type="text"
                  className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm outline-none disabled:opacity-50 disabled:bg-slate-100 dark:disabled:bg-slate-800"
                  value={(assignment as any).strand_name || ''}
                  onChange={(e) => handleAssignmentChange('strand_name', e.target.value)}
                  disabled={isPublishedMode}
                />
              </div>
            </div>
          ) : (
            <div className="text-sm text-slate-500 dark:text-slate-400 py-2 flex items-center gap-2">
              <BookOpen className="w-4 h-4" />
              Standard 8-4-4 Curriculum selected. No strand mapping required.
            </div>
          )}
        </div>

        {/* 5. Schedule & Timers (Always Editable so Teachers can extend deadlines) */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-sm dark:shadow-none border border-slate-100 dark:border-slate-700 space-y-5">
          <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100 border-b border-slate-100 dark:border-slate-700 pb-3">Schedule & Deadlines</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Publish Date</label>
              <input
                type="datetime-local"
                className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm outline-none focus:bg-white dark:focus:bg-slate-800"
                value={assignment.publish_date || ''}
                onChange={(e) => handleAssignmentChange('publish_date', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Due Date</label>
              <input
                type="datetime-local"
                className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm outline-none focus:bg-white dark:focus:bg-slate-800"
                value={assignment.due_date || ''}
                onChange={(e) => handleAssignmentChange('due_date', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Cutoff Date</label>
              <input
                type="datetime-local"
                className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm outline-none focus:bg-white dark:focus:bg-slate-800"
                value={assignment.cutoff_date || ''}
                onChange={(e) => handleAssignmentChange('cutoff_date', e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* 5b. Submission Rules, Targeting & Reference Material */}
        <AssignmentOptionsPanel
          assignment={assignment}
          onChange={handleAssignmentChange}
          classStreamOptions={classStreamOptions}
          structuralLocked={isPublishedMode}
        />

        {/* 6. Content Mode Toggle */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-sm dark:shadow-none border border-slate-100 dark:border-slate-700 space-y-5 relative">
          <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-700 pb-3">
             <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Assignment Content</h3>
             {isPublishedMode && <span className="text-xs text-red-500 dark:text-red-400 font-medium">Content is locked for live assignments</span>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <button
              type="button"
              onClick={() => setUploadMode(true)}
              disabled={isPublishedMode} // Lock the toggle if published
              aria-pressed={uploadMode}
              className={`p-4 rounded-xl border-2 flex flex-col items-center justify-center gap-2 transition-all
                ${uploadMode ? 'border-blue-600 dark:border-blue-500 bg-blue-50/50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400'}
                ${isPublishedMode && !uploadMode ? 'opacity-40 cursor-not-allowed' : ''}
              `}
            >
              <UploadCloud className="w-8 h-8" />
              <span className="font-semibold">Upload Master File</span>
            </button>

            <button
              type="button"
              onClick={() => setUploadMode(false)}
              disabled={isPublishedMode} // Lock the toggle if published
              aria-pressed={!uploadMode}
              className={`p-4 rounded-xl border-2 flex flex-col items-center justify-center gap-2 transition-all
                ${!uploadMode ? 'border-blue-600 dark:border-blue-500 bg-blue-50/50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400'}
                ${isPublishedMode && uploadMode ? 'opacity-40 cursor-not-allowed' : ''}
              `}
            >
              <ListPlus className="w-8 h-8" />
              <span className="font-semibold">Build Questions Online</span>
            </button>
          </div>

          <div className="pt-4">
            {uploadMode ? (
              <div
                onDragOver={(e) => { e.preventDefault(); if (!isPublishedMode) setIsDraggingFile(true); }}
                onDragLeave={() => setIsDraggingFile(false)}
                onDrop={handleFileDrop}
                className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${isPublishedMode ? 'opacity-70 pointer-events-none border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800' : isDraggingFile ? 'border-blue-400 dark:border-blue-500 bg-blue-50 dark:bg-blue-500/10 cursor-pointer' : 'border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer'}`}
              >
                <input
                  type="file"
                  id="file-upload"
                  className="hidden"
                  onChange={handleFileChange}
                  accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                  disabled={isPublishedMode}
                />
                <label htmlFor="file-upload" className={isPublishedMode ? "cursor-default flex flex-col items-center gap-3" : "cursor-pointer flex flex-col items-center gap-3"}>
                  <div className="p-3 bg-white dark:bg-slate-900 shadow-sm dark:shadow-none rounded-full">
                    <UploadCloud className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <p className="font-medium text-slate-700 dark:text-slate-200">Click to browse or drag and drop</p>
                  </div>
                  {/* Show existing file from backend string, OR newly attached File object */}
                  {assignment.teacher_attachment && (
                    <div className="mt-4 px-4 py-2 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 rounded-lg text-sm font-medium border border-emerald-200 dark:border-emerald-500/40">
                      File attached: {typeof assignment.teacher_attachment === 'string' ? 'Current Master Document' : (assignment.teacher_attachment as File).name}
                    </div>
                  )}
                </label>
              </div>
            ) : (
              <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-8 text-center bg-slate-50 dark:bg-slate-800 flex flex-col items-center justify-center">
                <div className="w-16 h-16 bg-blue-100 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-full flex items-center justify-center mb-4">
                  <span className="text-2xl font-bold">{questions.length}</span>
                </div>
                <h4 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-1">Questions Prepared</h4>
                {!isPublishedMode ? (
                   <button
                     type="button"
                     onClick={() => setIsQuestionModalOpen(true)}
                     className="inline-flex items-center gap-2 px-6 py-3 mt-4 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg font-medium text-slate-700 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-blue-500/10 hover:text-blue-700 dark:hover:text-blue-400 hover:border-blue-200 dark:hover:border-blue-500/40 transition-all shadow-sm dark:shadow-none"
                   >
                     <ListPlus className="w-5 h-5" /> Edit Questions
                   </button>
                ) : (
                   <div className="text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 px-4 py-2 rounded-lg border border-amber-200 dark:border-amber-500/40 mt-2 flex items-center gap-2">
                     <Lock className="w-4 h-4" /> Editing questions on a published assignment is disabled to protect student grades.
                   </div>
                )}
              </div>
            )}
          </div>
        </div>
      </form>

      {/* --- The Question Builder Modal Overlay --- */}
      {isQuestionModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 sm:p-6 animate-in fade-in duration-200">
          <div className="bg-slate-50 dark:bg-slate-800/40 w-full max-w-5xl max-h-[95vh] rounded-2xl shadow-2xl dark:shadow-none flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 border border-transparent dark:border-slate-700">
            <div className="bg-white dark:bg-slate-900 px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-lg"><ListPlus className="w-5 h-5" /></div>
                <div>
                  <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">Question Builder</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Edit and arrange questions.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsQuestionModalOpen(false)}
                className="p-2 text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg"
                title="Close Question Builder"
                aria-label="Close Question Builder"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1">
              <QuestionBuilder questions={questions} setQuestions={setQuestions} />
            </div>

            <div className="bg-white dark:bg-slate-900 px-6 py-4 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-3 shrink-0">
              <button
                type="button"
                onClick={() => setIsQuestionModalOpen(false)}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg shadow-sm"
              >
                Save & Close Builder
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}