import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Layers, BookOpen, Library, ArrowRight, Building2 } from 'lucide-react';
import ClassesCard from './ClassesCard';
import SubjectsCard from './SubjectsCard';
import DepartmentsCard from './DepartmentsCard';

// 1. Import the Modals
import AddGradeModal from './AddGradeModal';
import AddSubjectModal from './AddSubjectModal';
import DepartmentModal from './DepartmentModal';
import AddStreamModal from './AddStreamModal'; // NEW: Import the Stream Modal
import EditGradeModal from './EditGradeModal';
import api from '../../libs/axiosInstance';

interface GradeSummary {
  id: number;
  grade_name: string;
  numeric_order?: number;
  curriculum_id?: number | null;
  tier_id?: number | null;
}

interface Tier {
  id: number;
  curriculum: number;
  name: string;
  code: string;
}

interface Curriculum {
  id: number;
  code: string;
  name: string;
  is_active_for_new_grades: boolean;
  is_archived: boolean;
}

interface SubjectCurriculumProfile {
  id: number;
  subject: number;
  curriculum: number;
  tier: number | null;
  is_core: boolean | null;
  total_lessons: number | null;
}

interface Department {
  id: number;
  name: string;
  code: string;
  description: string;
  is_active: boolean;
  subject_count: number;
}

export default function AcademicHub() {
  const [data, setData] = useState({ classes: [], subjects: [] });
  const [loading, setLoading] = useState(true);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [curricula, setCurricula] = useState<Curriculum[]>([]);
  const [subjectProfiles, setSubjectProfiles] = useState<SubjectCurriculumProfile[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [activeTab, setActiveTab] = useState<'grades' | 'subjects' | 'departments'>('grades');

  // 2. State to control modal visibility
  const [isGradeModalOpen, setGradeModalOpen] = useState(false);
  const [isSubjectModalOpen, setSubjectModalOpen] = useState(false);
  const [isDepartmentModalOpen, setDepartmentModalOpen] = useState(false);
  const [departmentToEdit, setDepartmentToEdit] = useState<Department | null>(null);
  const [editingGrade, setEditingGrade] = useState<GradeSummary | null>(null);
  const [selectedDeptCurriculumId, setSelectedDeptCurriculumId] = useState<number | null>(null);
  const [selectedSubjectTierId, setSelectedSubjectTierId] = useState<number | null>(null);

  // NEW: State for the Stream Modal
  const [streamModalConfig, setStreamModalConfig] = useState<{
    isOpen: boolean;
    gradeId: number | null; // <--- This fixes the error!
    gradeName: string;
  }>({
    isOpen: false,
    gradeId: null,
    gradeName: ''
  });

  // 3. Extracted fetch logic so we can call it again after a modal succeeds
const fetchAcademicData = () => {
  // Axios implicitly rejects non-2xx status codes, eliminating manual response status checking
  api.get('/api/academic-hub/')
    .then(res => {
      const response = res.data;
      if (response.status === 'success') {
        setData(response.data);
      } else {
        console.error("API returned error status:", response.message);
      }
      setLoading(false);
    })
    .catch(err => {
      console.error("Failed to fetch academic data:", err);
      setLoading(false);
    });
};

  // Curricula/tiers/profiles power the subject's curriculum assignment picker and the
  // "which curricula teach this" badges — refetched alongside subjects/grades so a new
  // assignment (made here or in Curriculum Hub) shows up immediately.
  const fetchCurriculumMeta = () => {
    api.get('/api/core/curriculum/tiers/')
      .then(res => setTiers(res.data ?? []))
      .catch(err => console.error('Failed to load tiers', err));
    api.get('/api/core/curriculum/curricula/')
      .then(res => setCurricula(res.data ?? []))
      .catch(err => console.error('Failed to load curricula', err));
    api.get('/api/core/curriculum/subject-profiles/')
      .then(res => setSubjectProfiles(res.data ?? []))
      .catch(err => console.error('Failed to load subject profiles', err));
  };

  const fetchDepartments = () => {
    api.get('/api/departments/')
      .then(res => {
        if (res.data.status === 'success') setDepartments(res.data.data);
      })
      .catch(err => console.error('Failed to load departments', err));
  };

  const refreshAll = () => {
    fetchAcademicData();
    fetchCurriculumMeta();
    fetchDepartments();
  };

  useEffect(() => {
    fetchAcademicData();
    fetchCurriculumMeta();
    fetchDepartments();
  }, []);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto space-y-6 animate-pulse">
        <div className="h-12 w-80 bg-slate-200 dark:bg-slate-800 rounded-2xl"></div>
        <div className="h-96 bg-slate-200 dark:bg-slate-800 rounded-2xl"></div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header Section */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-2xl text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10">
            <Library className="w-7 h-7" strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-slate-800 dark:text-slate-100">Academic Structure Hub</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Manage grade levels, streams, and master curriculum.</p>
          </div>
        </div>
        <Link
          to="/curriculum"
          title="Manage curriculum templates, pathways, and presets"
          className="flex items-center gap-1.5 text-sm font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition"
        >
          Manage Curricula <ArrowRight className="w-4 h-4" />
        </Link>
      </div>

      {/* Tabbed Layout — each entity gets the full width to show its own detail */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm dark:shadow-none border border-slate-100 dark:border-slate-700 overflow-hidden flex flex-col">
        <div className="px-4 pt-3 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50/50 dark:bg-slate-800/40 flex-wrap gap-y-2">
          <div className="flex items-center gap-1 flex-wrap">
            <button
              onClick={() => setActiveTab('grades')}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
                activeTab === 'grades'
                  ? 'border-blue-600 dark:border-blue-400 text-blue-700 dark:text-blue-400'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              <Layers className="w-4 h-4" /> Grades & Streams
            </button>
            <button
              onClick={() => setActiveTab('subjects')}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
                activeTab === 'subjects'
                  ? 'border-emerald-600 dark:border-emerald-400 text-emerald-700 dark:text-emerald-400'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              <BookOpen className="w-4 h-4" /> Master Curriculum
            </button>
            <button
              onClick={() => setActiveTab('departments')}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
                activeTab === 'departments'
                  ? 'border-indigo-600 dark:border-indigo-400 text-indigo-700 dark:text-indigo-400'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              <Building2 className="w-4 h-4" /> Departments
            </button>
          </div>

          {activeTab === 'grades' && (
            <button
              onClick={() => setGradeModalOpen(true)}
              title="Click to add a new Grade Level"
              className="mb-2.5 bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700 transition">
              + New Grade
            </button>
          )}
          {activeTab === 'subjects' && (
            <button
              onClick={() => setSubjectModalOpen(true)}
              title="Click to add a new Master Subject"
              className="mb-2.5 bg-emerald-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-emerald-700 transition">
              + New Subject
            </button>
          )}
          {activeTab === 'departments' && (
            <button
              onClick={() => { setDepartmentToEdit(null); setDepartmentModalOpen(true); }}
              title="Click to add a new Department"
              className="mb-2.5 bg-indigo-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-indigo-700 transition">
              + New Department
            </button>
          )}
        </div>

        <div className="p-0 overflow-y-auto flex-1 max-h-[32rem]">
          {activeTab === 'grades' && (
            <ClassesCard
              grades={data.classes}
              tiers={tiers}
              onRefresh={fetchAcademicData}
              onAddStream={(gradeId, gradeName) => setStreamModalConfig({ isOpen: true, gradeId, gradeName })}
              onEditGrade={(grade) => setEditingGrade(grade)}
            />
          )}
          {activeTab === 'subjects' && (
            <div className="flex flex-col h-full">
              <div className="flex px-4 py-3 bg-slate-50 dark:bg-slate-800/40 border-b border-slate-100 dark:border-slate-700 gap-2 overflow-x-auto shrink-0">
                <button
                  onClick={() => setSelectedSubjectTierId(null)}
                  className={`px-3 py-1.5 text-xs font-bold rounded-full transition-colors whitespace-nowrap ${selectedSubjectTierId === null ? 'bg-emerald-600 text-white' : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 shadow-sm dark:shadow-none'}`}
                >
                  All Tiers
                </button>
                {tiers.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setSelectedSubjectTierId(t.id)}
                    className={`px-3 py-1.5 text-xs font-bold rounded-full transition-colors whitespace-nowrap ${selectedSubjectTierId === t.id ? 'bg-emerald-600 text-white' : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 shadow-sm dark:shadow-none'}`}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
              <div className="flex-1 overflow-y-auto">
                <SubjectsCard
                  subjects={selectedSubjectTierId ? data.subjects.filter(s => subjectProfiles.some(p => p.subject === s.id && p.tier === selectedSubjectTierId)) : data.subjects}
                  curricula={curricula}
                  tiers={tiers}
                  subjectProfiles={subjectProfiles}
                  departments={departments}
                  selectedTierId={selectedSubjectTierId}
                  onRefresh={refreshAll}
                />
              </div>
            </div>
          )}
          {activeTab === 'departments' && (
            <div className="flex flex-col h-full">
              <div className="flex px-4 py-3 bg-slate-50 dark:bg-slate-800/40 border-b border-slate-100 dark:border-slate-700 gap-2 overflow-x-auto shrink-0">
                <button
                  onClick={() => setSelectedDeptCurriculumId(null)}
                  className={`px-3 py-1.5 text-xs font-bold rounded-full transition-colors whitespace-nowrap ${selectedDeptCurriculumId === null ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 shadow-sm dark:shadow-none'}`}
                >
                  All Curricula
                </button>
                {curricula.map(c => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedDeptCurriculumId(c.id)}
                    className={`px-3 py-1.5 text-xs font-bold rounded-full transition-colors whitespace-nowrap ${selectedDeptCurriculumId === c.id ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 shadow-sm dark:shadow-none'}`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
              <div className="flex-1 overflow-y-auto">
                <DepartmentsCard
                  departments={selectedDeptCurriculumId ? departments.filter(d => d.curriculum_id === selectedDeptCurriculumId) : departments}
                  curricula={curricula}
                  subjects={data.subjects}
                  subjectProfiles={subjectProfiles}
                  onRefresh={refreshAll}
                  onEdit={(dept) => {
                    setDepartmentToEdit(dept);
                    setDepartmentModalOpen(true);
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 5. Render the Modals */}
      <AddGradeModal
        isOpen={isGradeModalOpen}
        onClose={() => setGradeModalOpen(false)}
        onSuccess={fetchAcademicData}
      />

      <AddSubjectModal
        isOpen={isSubjectModalOpen}
        curricula={curricula}
        tiers={tiers}
        departments={departments}
        onClose={() => setSubjectModalOpen(false)}
        onSuccess={refreshAll}
      />

      <DepartmentModal
        isOpen={isDepartmentModalOpen}
        curricula={curricula}
        defaultCurriculumId={selectedDeptCurriculumId}
        departmentToEdit={departmentToEdit}
        subjects={data.subjects}
        subjectProfiles={subjectProfiles}
        onClose={() => { setDepartmentModalOpen(false); setDepartmentToEdit(null); }}
        onSuccess={refreshAll}
      />

      {/* NEW: Render the Stream Modal */}
      <AddStreamModal
        isOpen={streamModalConfig.isOpen}
        gradeId={streamModalConfig.gradeId}
        gradeName={streamModalConfig.gradeName}
        onClose={() => setStreamModalConfig({ isOpen: false, gradeId: null, gradeName: '' })}
        onSuccess={fetchAcademicData}
      />

      <EditGradeModal
        isOpen={!!editingGrade}
        grade={editingGrade}
        onClose={() => setEditingGrade(null)}
        onSuccess={fetchAcademicData}
      />

    </div>
  );
}