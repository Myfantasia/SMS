import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, 
  Save, 
  UploadCloud, 
  ListPlus, 
  UserSquare2,  
  BookOpen,
  X // <-- NEW: Added X icon for the Modal close button
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { Assignment, Question } from '../../libs/assignments';
import { assignmentService } from '../../libs/assignmentService';
import QuestionBuilder from './QuestionBuilder';
import AssignmentOptionsPanel from './AssignmentOptionsPanel';
import api from '../../libs/axiosInstance';

interface AssignmentCreatorProps {
  role: 'admin' | 'teacher';
}

export default function AssignmentCreator({ role }: AssignmentCreatorProps) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [metadataLoading, setMetadataLoading] = useState(true);

  // --- Data States ---
  const [teachers, setTeachers] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [filteredSubjects, setFilteredSubjects] = useState<any[]>([]); // <-- NEW: Holds filtered subjects

  // --- Form & Modal States ---
  const [uploadMode, setUploadMode] = useState<boolean>(true);
  const [isQuestionModalOpen, setIsQuestionModalOpen] = useState<boolean>(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  
  const [assignment, setAssignment] = useState<Partial<Assignment>>({
    title: '',
    assignment_type: 'Holiday',
    curriculum_type: 'CBC',
    status: 'Draft',
    is_quiz: false,
    teacher_id: role === 'admin' ? '' : '', // <-- UPDATED: Start blank, the profile fetch will fill it
    subject_id: '',
    class_stream_id: '',
    publish_date: '',
    due_date: '',
    cutoff_date: '',
    teacher_attachment: null,
    allow_resubmission: false,
    max_attempts: 1,
    late_penalty_percent: 0,
    is_group_assignment: false,
    groups: [],
    assigned_student_ids: [],
    additional_class_stream_ids: [],
    reference_links: [],
    reference_notes: '',
    additional_attachments: [],
  });

  const [questions, setQuestions] = useState<Question[]>([]);

  const classStreamOptions = classes.flatMap((grade: any) =>
    (grade.streams || []).map((stream: any) => ({ id: stream.id, label: stream.name }))
  );

  // 1. Fetch Real Metadata on Mount
  useEffect(() => {
    const fetchMetadata = async () => {
      try {
        const [classRes, subRes] = await Promise.all([
          api.get('/api/manage-classes/'),
          api.get('/api/manage-subjects/')
        ]);
        
        const classData = classRes.data?.data || [];
        const subData = subRes.data?.data || [];

        setClasses(Array.isArray(classData) ? classData : []);
        setSubjects(Array.isArray(subData) ? subData : []);
        setFilteredSubjects(Array.isArray(subData) ? subData : []); // Initialize filtered list

        if (role === 'admin') {
          // --- ADMIN VIEW: Fetch all teachers ---
          const teacherRes = await api.get('/api/approved-users/teachers/');
          const teacherData = teacherRes.data?.data || [];
          setTeachers(Array.isArray(teacherData) ? teacherData : []);
        } else if (role === 'teacher') {
          // --- TEACHER VIEW: Fetch own profile to get ID and subjects ---
          const profileRes = await api.get('/api/my-profile/');
          const profileData = profileRes.data?.data || {};

          // 1. Lock in the real teacher ID for the database
          if (profileData.teacher_id) {
            setAssignment(prev => ({ ...prev, teacher_id: profileData.teacher_id.toString() }));
          }

          // 2. Instantly filter the subject dropdown based on their profile
          if (profileData.subjects && profileData.subjects !== "N/A") {
            const teacherSubjectNames = profileData.subjects
              .split(',')
              .map((s: string) => s.trim().toLowerCase());
              
            const available = Array.isArray(subData) ? subData.filter((sub: any) => 
              teacherSubjectNames.includes(sub.name.toLowerCase())
            ) : [];
            
            setFilteredSubjects(available.length > 0 ? available : subData);
          }
        }
      } catch (error) {
        console.error("Error fetching form metadata:", error);
        toast.error("Failed to load dropdown data from the server.");
      } finally {
        setMetadataLoading(false);
      }
    };
    fetchMetadata();
  }, [role]);

  // 2. --- NEW: Dynamic Subject Filtering (Admin Dropdown String Matching) ---
  useEffect(() => {
    if (role === 'admin') {
      if (assignment.teacher_id) {
        // Find the teacher the admin just selected
        const selectedTeacher = teachers.find(t => t.id.toString() === assignment.teacher_id?.toString());
        
        // Check if the teacher has subjects assigned in Django
        if (selectedTeacher && selectedTeacher.subjects && selectedTeacher.subjects !== "N/A") {
          
          // Split the Django string "Mathematics, Kiswahili" into an array: ["mathematics", "kiswahili"]
          const teacherSubjectNames = selectedTeacher.subjects
            .split(',')
            .map((s: string) => s.trim().toLowerCase());
            
          // Filter your master subjects list based on the names
          const available = subjects.filter(sub => 
            teacherSubjectNames.includes(sub.name.toLowerCase())
          );
          
          // Set the dropdown to only show their subjects (or all if the match fails)
          setFilteredSubjects(available.length > 0 ? available : subjects);
        } else {
          // Fallback: If the teacher has no subjects assigned in the DB, show all subjects
          setFilteredSubjects(subjects);
        }
      } else {
        // If no teacher is selected yet, clear the subjects dropdown
        setFilteredSubjects([]);
        handleAssignmentChange('subject_id', ''); // Reset the selection
      }
    }
  }, [assignment.teacher_id, teachers, subjects, role]);

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
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleAssignmentChange('teacher_attachment', e.dataTransfer.files[0]);
    }
  };

  const handleSubmit = async (e: React.FormEvent, isDraft: boolean) => {
    e.preventDefault();

    // Basic Validation
    if (!assignment.title || !assignment.class_stream_id || !assignment.subject_id) {
      toast.error("Please fill in all required fields (Title, Class, Subject).");
      return;
    }
    if (role === 'admin' && !assignment.teacher_id) {
      toast.error("Admins must select a Teacher to assign this to.");
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

      await assignmentService.createAssignment(finalAssignment, finalQuestions);
      
      toast.success(`Assignment ${isDraft ? 'saved as draft' : 'published'} successfully!`);
      navigate('..'); 
    } catch (error: any) {
      console.error("Error creating assignment:", error);
      
      // --- NEW: Read the exact database validation error sent back from Django views ---
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

  if (metadataLoading) {
    return (
      <div className="max-w-5xl mx-auto space-y-6 animate-pulse">
        <div className="h-14 bg-slate-200 rounded-2xl"></div>
        <div className="h-40 bg-slate-200 rounded-2xl"></div>
        <div className="h-56 bg-slate-200 rounded-2xl"></div>
        <div className="h-40 bg-slate-200 rounded-2xl"></div>
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
            title="Go back"
            aria-label="Go back"
            className="p-2 bg-white border border-slate-200 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-50 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="p-2.5 rounded-2xl text-amber-600 bg-amber-50">
            <ListPlus className="w-6 h-6" strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Create Assignment</h1>
            <p className="text-sm text-slate-500">Design a new task or upload a master document.</p>
          </div>
        </div>

        <div className="flex gap-3">
          <button 
            onClick={(e) => handleSubmit(e, true)}
            disabled={loading}
            className="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            Save Draft
          </button>
          <button 
            onClick={(e) => handleSubmit(e, false)}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 shadow-sm"
          >
            <Save className="w-4 h-4" />
            {loading ? 'Publishing...' : 'Publish Now'}
          </button>
        </div>
      </div>

      <form className="space-y-6">
        
        {/* 2. ADMIN ONLY: Impersonation Block */}
        {role === 'admin' && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <UserSquare2 className="w-5 h-5 text-amber-600" />
              <h3 className="font-semibold text-amber-800">Admin Override: Assign To</h3>
            </div>
            <label className="block text-sm font-medium text-amber-700 mb-2">Select Teacher</label>
            <select 
              className="w-full md:w-1/2 p-2.5 bg-white border border-amber-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none"
              value={assignment.teacher_id}
              onChange={(e) => handleAssignmentChange('teacher_id', e.target.value)}
              aria-label="Select teacher for assignment"
            >
              <option value="">-- Select Teacher --</option>
              {teachers.map(t => (
                <option key={t.id} value={t.id}>
                  {t.name || `${t.first_name || ''} ${t.last_name || ''}`.trim()}
                </option>
              ))}
            </select>
            <p className="text-xs text-amber-600 mt-2">This assignment will appear on the selected teacher's dashboard as if they created it.</p>
          </div>
        )}

        {/* 3. Basic Details Card */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 space-y-5">
          <h3 className="text-lg font-semibold text-slate-800 border-b border-slate-100 pb-3">General Information</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Assignment Title <span className="text-red-500">*</span></label>
              <input 
                type="text" 
                placeholder="e.g., End of Term Mathematics Project"
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                value={assignment.title}
                onChange={(e) => handleAssignmentChange('title', e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Class Stream <span className="text-red-500">*</span></label>
              <select 
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                value={assignment.class_stream_id}
                onChange={(e) => handleAssignmentChange('class_stream_id', e.target.value)}
                aria-label="Class Stream"
              >
                <option value="">Select Class</option>
                {classes.map((grade: any) => (
                <optgroup key={grade.grade_id} label={grade.grade_name}>
                  {grade.streams.map((stream: any) => (
                  <option key={stream.id} value={stream.id}>
                    {stream.name}
                  </option>
                  ))}
                </optgroup>
                ))}
              </select>
            </div>

            {/* --- UPDATED: Dynamic Subject Selection based on Teacher --- */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Subject <span className="text-red-500">*</span></label>
              <select 
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all disabled:opacity-50 disabled:bg-slate-100 disabled:cursor-not-allowed"
                value={assignment.subject_id}
                aria-label="Subject"
                onChange={(e) => handleAssignmentChange('subject_id', e.target.value)}
                disabled={role === 'admin' && !assignment.teacher_id} // Disable if no teacher selected
              >
                <option value="">
                  {role === 'admin' && !assignment.teacher_id ? "-- Select Teacher First --" : "Select Subject"}
                </option>
                {filteredSubjects.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* 4. Curriculum Type (Hybrid 8-4-4 vs CBC) */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 space-y-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-lg font-semibold text-slate-800">Curriculum Mapping</h3>
            <div className="flex bg-slate-100 p-1 rounded-lg">
              <button
                type="button"
                onClick={() => handleAssignmentChange('curriculum_type', 'CBC')}
                aria-pressed={assignment.curriculum_type === 'CBC'}
                className={`px-3 py-1 text-sm font-medium rounded-md transition-all ${assignment.curriculum_type === 'CBC' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                CBC
              </button>
              <button
                type="button"
                onClick={() => handleAssignmentChange('curriculum_type', '8-4-4')}
                aria-pressed={assignment.curriculum_type === '8-4-4'}
                className={`px-3 py-1 text-sm font-medium rounded-md transition-all ${assignment.curriculum_type === '8-4-4' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                8-4-4
              </button>
            </div>
          </div>

          {/* DYNAMIC RENDER: Only show Strands if CBC is selected */}
          {assignment.curriculum_type === 'CBC' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 animate-in fade-in slide-in-from-top-2 duration-300">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Curriculum Strand</label>
                <input 
                  type="text"
                  placeholder="e.g., Numbers, Measurement"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                  aria-label="Curriculum Strand"
                  value={(assignment as any).strand_name || ''}
                  onChange={(e) => handleAssignmentChange('strand_name', e.target.value)}
                />
              </div>
            </div>
          ) : (
            <div className="text-sm text-slate-500 py-2 flex items-center gap-2">
              <BookOpen className="w-4 h-4" />
              Standard 8-4-4 Curriculum selected. No strand mapping required.
            </div>
          )}
        </div>

        {/* 5. Schedule & Timers */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 space-y-5">
          <h3 className="text-lg font-semibold text-slate-800 border-b border-slate-100 pb-3">Schedule & Deadlines</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Publish Date (Visibility)</label>
              <input 
                type="datetime-local" 
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:bg-white outline-none"
                value={assignment.publish_date}
                onChange={(e) => handleAssignmentChange('publish_date', e.target.value)}
                title="Publish Date (Visibility)"
                placeholder="Select publish date"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Due Date (Marks Late)</label>
              <input 
                type="datetime-local" 
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:bg-white outline-none"
                value={assignment.due_date}
                onChange={(e) => handleAssignmentChange('due_date', e.target.value)}
                title="Due Date (Marks Late)"
                placeholder="Select due date"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Cutoff Date (Lockout)</label>
              <input 
                type="datetime-local" 
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:bg-white outline-none"
                value={assignment.cutoff_date}
                onChange={(e) => handleAssignmentChange('cutoff_date', e.target.value)}
                title="Cutoff Date (Lockout)"
                placeholder="Select cutoff date"
              />
            </div>
          </div>
        </div>

        {/* 5b. Submission Rules, Targeting & Reference Material */}
        <AssignmentOptionsPanel
          assignment={assignment}
          onChange={handleAssignmentChange}
          classStreamOptions={classStreamOptions}
        />

        {/* 6. Content Mode Toggle (File vs Questions) */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 space-y-5">
          <h3 className="text-lg font-semibold text-slate-800 border-b border-slate-100 pb-3">Assignment Content</h3>
          
          <div className="grid grid-cols-2 gap-4">
            <button
              type="button"
              onClick={() => setUploadMode(true)}
              aria-pressed={uploadMode}
              className={`p-4 rounded-xl border-2 flex flex-col items-center justify-center gap-2 transition-all ${uploadMode ? 'border-blue-600 bg-blue-50/50 text-blue-700' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50'}`}
            >
              <UploadCloud className="w-8 h-8" />
              <span className="font-semibold">Upload Master File</span>
              <span className="text-xs opacity-70 text-center">Upload a PDF or Image. Students will upload their answers back to you.</span>
            </button>

            <button
              type="button"
              onClick={() => setUploadMode(false)}
              aria-pressed={!uploadMode}
              className={`p-4 rounded-xl border-2 flex flex-col items-center justify-center gap-2 transition-all ${!uploadMode ? 'border-blue-600 bg-blue-50/50 text-blue-700' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50'}`}
            >
              <ListPlus className="w-8 h-8" />
              <span className="font-semibold">Build Questions Online</span>
              <span className="text-xs opacity-70 text-center">Create MCQs and Essays for auto-grading directly in the portal.</span>
            </button>
          </div>

          {/* DYNAMIC CONTENT AREA */}
          <div className="pt-4">
            {uploadMode ? (
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDraggingFile(true); }}
                onDragLeave={() => setIsDraggingFile(false)}
                onDrop={handleFileDrop}
                className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${isDraggingFile ? 'border-blue-400 bg-blue-50' : 'border-slate-300 bg-slate-50 hover:bg-slate-100'}`}
              >
                <input
                  type="file"
                  id="file-upload"
                  className="hidden"
                  onChange={handleFileChange}
                  accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                />
                <label htmlFor="file-upload" className="cursor-pointer flex flex-col items-center gap-3">
                  <div className="p-3 bg-white shadow-sm rounded-full">
                    <UploadCloud className="w-6 h-6 text-blue-600" />
                  </div>
                  <div>
                    <p className="font-medium text-slate-700">Click to browse or drag and drop</p>
                    <p className="text-sm text-slate-500 mt-1">PDF, DOCX, or Image (Max 10MB)</p>
                  </div>
                  {assignment.teacher_attachment && (
                    <div className="mt-4 px-4 py-2 bg-emerald-50 text-emerald-700 rounded-lg text-sm font-medium border border-emerald-200">
                      File attached: {(assignment.teacher_attachment as File).name}
                    </div>
                  )}
                </label>
              </div>
            ) : (
              <div className="border border-slate-200 rounded-xl p-8 text-center bg-slate-50 flex flex-col items-center justify-center">
                <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mb-4">
                  <span className="text-2xl font-bold">{questions.length}</span>
                </div>
                <h4 className="text-lg font-semibold text-slate-800 mb-1">Questions Prepared</h4>
                <p className="text-slate-500 text-sm mb-6 max-w-md">
                  Click below to open the interactive builder and manage your multiple choice, short answer, and essay questions.
                </p>
                <button 
                  type="button" 
                  onClick={() => setIsQuestionModalOpen(true)}
                  className="inline-flex items-center gap-2 px-6 py-3 bg-white border border-slate-300 rounded-lg font-medium text-slate-700 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200 transition-all shadow-sm"
                >
                  <ListPlus className="w-5 h-5" />
                  {questions.length > 0 ? "Edit Questions" : "Open Question Builder"}
                </button>
              </div>
            )}
          </div>

        </div>
      </form>

      {/* --- NEW: The Question Builder Modal Overlay --- */}
      {isQuestionModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 sm:p-6 animate-in fade-in duration-200">
          <div className="bg-slate-50 w-full max-w-5xl max-h-[95vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
            
            {/* Modal Header */}
            <div className="bg-white px-6 py-4 border-b border-slate-200 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                  <ListPlus className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-800">Question Builder</h2>
                  <p className="text-xs text-slate-500">Add, edit, and arrange questions for this assignment.</p>
                </div>
              </div>
              <button 
                type="button"
                onClick={() => setIsQuestionModalOpen(false)} 
                className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                title="Close Builder"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body (Scrollable area where QuestionBuilder lives) */}
            <div className="p-6 overflow-y-auto flex-1">
              <QuestionBuilder questions={questions} setQuestions={setQuestions} />
            </div>

            {/* Modal Footer */}
            <div className="bg-white px-6 py-4 border-t border-slate-200 flex justify-end gap-3 shrink-0">
              <button 
                type="button"
                onClick={() => setIsQuestionModalOpen(false)} 
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors shadow-sm"
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