import { useState, useEffect } from 'react';
import { Layers, BookOpen, Library } from 'lucide-react';
import ClassesCard from './ClassesCard';
import SubjectsCard from './SubjectsCard';

// 1. Import the Modals
import AddGradeModal from './AddGradeModal';
import AddSubjectModal from './AddSubjectModal';
import AddStreamModal from './AddStreamModal'; // NEW: Import the Stream Modal
import api from '../../libs/axiosInstance';

export default function AcademicHub() {
  const [data, setData] = useState({ classes: [], subjects: [] });
  const [loading, setLoading] = useState(true);

  // 2. State to control modal visibility
  const [isGradeModalOpen, setGradeModalOpen] = useState(false);
  const [isSubjectModalOpen, setSubjectModalOpen] = useState(false);
  
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

  useEffect(() => {
    fetchAcademicData();
  }, []);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto space-y-6 animate-pulse">
        <div className="h-12 w-80 bg-slate-200 rounded-2xl"></div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div className="h-96 bg-slate-200 rounded-2xl"></div>
          <div className="h-96 bg-slate-200 rounded-2xl"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header Section */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-2xl text-indigo-600 bg-indigo-50">
            <Library className="w-7 h-7" strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-slate-800">Academic Structure Hub</h1>
            <p className="text-sm text-slate-500 mt-0.5">Manage grade levels, streams, and master curriculum.</p>
          </div>
        </div>
      </div>

      {/* Side-by-Side Cards Layout */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
        
        {/* Classes Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden flex flex-col h-96">
          <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <div className="flex items-center gap-2">
              <Layers className="w-5 h-5 text-blue-600" />
              <h2 className="font-semibold text-slate-800">Grades & Streams</h2>
            </div>
            {/* 4. Wired up the button to open the Grade Modal */}
            <button 
              onClick={() => setGradeModalOpen(true)}
              title="Click to add a new Grade Level"
              className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700 transition">
              + New Grade
            </button>
          </div>
          <div className="p-0 overflow-y-auto flex-1">
             {/* NEW: Passed the onAddStream trigger down to the ClassesCard */}
             <ClassesCard 
               grades={data.classes} 
               onRefresh={fetchAcademicData} 
               onAddStream={(gradeId, gradeName) => setStreamModalConfig({ isOpen: true, gradeId, gradeName })}
             />
          </div>
        </div>

        {/* Subjects Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden flex flex-col h-96">
          <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <div className="flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-emerald-600" />
              <h2 className="font-semibold text-slate-800">Master Curriculum</h2>
            </div>
            {/* 4. Wired up the button to open the Subject Modal */}
            <button 
              onClick={() => setSubjectModalOpen(true)}
              title="Click to add a new Master Subject"
              className="bg-emerald-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-emerald-700 transition">
              + New Subject
            </button>
          </div>
          <div className="p-0 overflow-y-auto flex-1">
            <SubjectsCard subjects={data.subjects} onRefresh={fetchAcademicData} />
          </div>
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
        onClose={() => setSubjectModalOpen(false)} 
        onSuccess={fetchAcademicData} 
      />

      {/* NEW: Render the Stream Modal */}
      <AddStreamModal 
        isOpen={streamModalConfig.isOpen}
        gradeId={streamModalConfig.gradeId}
        gradeName={streamModalConfig.gradeName}
        onClose={() => setStreamModalConfig({ isOpen: false, gradeId: null, gradeName: '' })}
        onSuccess={fetchAcademicData}
      />

    </div>
  );
}