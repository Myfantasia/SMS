import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, BookOpen, Users, BarChart3, GraduationCap } from 'lucide-react';

interface SubjectData {
  id: number;
  code: string;
  name: string;
  department: string;
  is_core: boolean;
  assigned_teachers: string[];
}

export default function ViewSubject() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [subject, setSubject] = useState<SubjectData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('http://localhost:8000/api/manage-subjects/')
      .then(res => res.json())
      .then(response => {
        if (response.status === 'success') {
          const found = response.data.find((s: SubjectData) => s.id === Number(id));
          if (found) setSubject(found);
        }
        setLoading(false);
      })
      .catch(err => {
        console.error("Failed to fetch subject data", err);
        setLoading(false);
      });
  }, [id]);

  if (loading) return <div className="p-6 text-slate-500">Loading Subject Profile...</div>;
  if (!subject) return <div className="p-6 text-red-500">Subject not found.</div>;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 animate-fade-in">
      
      <button onClick={() => navigate('/admin-dashboard/subjects')} className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-emerald-600 transition-colors w-max">
        <ArrowLeft className="w-4 h-4" /> Back to Subjects
      </button>

      {/* Hero Header */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-6 border-t-4 border-t-emerald-500">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-3xl font-black text-slate-800">{subject.name}</h1>
            {subject.is_core ? (
              <span className="bg-emerald-100 text-emerald-800 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider">Core Requirement</span>
            ) : (
              <span className="bg-slate-100 text-slate-600 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider">Elective</span>
            )}
          </div>
          <p className="text-slate-500 font-mono font-medium flex items-center gap-2">
            <BookOpen className="w-4 h-4" /> Code: {subject.code} | Dept: {subject.department}
          </p>
        </div>
        
        <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 text-center min-w-37.5">
          <p className="text-3xl font-black text-slate-800">{subject.assigned_teachers.length}</p>
          <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mt-1">Active Teachers</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Approved Staff Pool */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <Users className="w-5 h-5 text-blue-600" /> Teaching Staff Pool
            </h3>
            <button onClick={() => navigate(`/admin-dashboard/subjects/edit/${subject.id}`)} className="text-sm text-blue-600 font-medium hover:underline">Manage Staff</button>
          </div>
          
          {subject.assigned_teachers.length > 0 ? (
            <div className="space-y-3">
              {subject.assigned_teachers.map((teacher, idx) => (
                <div key={idx} className="flex items-center gap-4 p-3 rounded-lg border border-slate-100 hover:border-blue-100 hover:bg-blue-50/50 transition">
                  <div className="w-10 h-10 bg-slate-200 text-slate-600 rounded-full flex items-center justify-center font-bold">
                    {teacher.charAt(0)}
                  </div>
                  <div>
                    <p className="font-bold text-slate-800">{teacher}</p>
                    <p className="text-xs text-slate-500">Approved to teach {subject.name}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-amber-50 border border-amber-100 rounded-lg p-6 text-center text-amber-700 font-medium">
              No staff members are currently allocated to teach this subject.
            </div>
          )}
        </div>

        {/* Global Analytics */}
        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-4">
              <BarChart3 className="w-5 h-5 text-indigo-500" /> School-wide Performance
            </h3>
            <div className="bg-slate-50 border border-slate-100 rounded-lg p-8 text-center text-sm text-slate-500">
                Aggregate analytics, grade distributions, and exam trends for {subject.name} will be visualized here.
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-4">
              <GraduationCap className="w-5 h-5 text-purple-500" /> Curriculum & Syllabus
            </h3>
            <div className="bg-slate-50 border border-slate-100 rounded-lg p-8 text-center text-sm text-slate-500">
                Syllabus tracking, lesson plan attachments, and termly milestones will be managed here.
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}