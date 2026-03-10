import { useState, useEffect } from 'react';
import { Layers, BookOpen } from 'lucide-react';
import ClassesCard from './ClassesCard';
import SubjectsCard from './SubjectsCard';

// 1. Import the Modals
import AddGradeModal from './AddGradeModal';
import AddSubjectModal from './AddSubjectModal';

export default function AcademicHub() {
  const [data, setData] = useState({ classes: [], subjects: [] });
  const [loading, setLoading] = useState(true);

  // 2. State to control modal visibility
  const [isGradeModalOpen, setGradeModalOpen] = useState(false);
  const [isSubjectModalOpen, setSubjectModalOpen] = useState(false);

  // 3. Extracted fetch logic so we can call it again after a modal succeeds
  const fetchAcademicData = () => {
    fetch('http://localhost:8000/api/academic-hub/')
      .then(res => res.json())
      .then(response => {
        if (response.status === 'success') {
          setData(response.data);
        }
        setLoading(false);
      })
      .catch(err => {
        console.error("Failed to fetch academic data", err);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchAcademicData();
  }, []);

  if (loading) return <div className="p-6 text-slate-500">Loading Academic Structure...</div>;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header Section */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Academic Structure Hub</h1>
          <p className="text-sm text-slate-500 mt-1">Manage grade levels, streams, and master curriculum.</p>
        </div>
      </div>

      {/* Side-by-Side Cards Layout */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
        
        {/* Classes Card */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-96">
          <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <div className="flex items-center gap-2">
              <Layers className="w-5 h-5 text-blue-600" />
              <h2 className="font-semibold text-slate-800">Grades & Streams</h2>
            </div>
            {/* 4. Wired up the button to open the Grade Modal */}
            <button 
              onClick={() => setGradeModalOpen(true)}
              className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700 transition">
              + New Grade
            </button>
          </div>
          <div className="p-0 overflow-y-auto flex-1">
             <ClassesCard grades={data.classes} onRefresh={fetchAcademicData} />
          </div>
        </div>

        {/* Subjects Card */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-96">
          <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <div className="flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-emerald-600" />
              <h2 className="font-semibold text-slate-800">Master Curriculum</h2>
            </div>
            {/* 4. Wired up the button to open the Subject Modal */}
            <button 
              onClick={() => setSubjectModalOpen(true)}
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

    </div>
  );
}