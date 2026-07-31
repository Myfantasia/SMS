import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, BookOpen, Users, BarChart3, GraduationCap, Search } from 'lucide-react';
import api from '../../libs/axiosInstance';

interface SubjectData {
  id: number;
  code: string;
  name: string;
  department_name: string | null;
  is_core: boolean;
  assigned_teachers: string[];
}

interface SubjectStudent {
  id: number;
  name: string;
  roll: string;
  grade_id: number | null;
  grade_name: string;
  grade_order: number;
  stream_name: string;
  total_score: number | null;
  grade_label: string | null;
}

export default function ViewSubject() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [subject, setSubject] = useState<SubjectData | null>(null);
  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<SubjectStudent[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(true);
  const [studentTerm, setStudentTerm] = useState<string | null>(null);
  const [studentSearch, setStudentSearch] = useState('');

  // ✅ RBAC PATH RESOLVER: Controls local view layout visibility options
  const isAdmin = window.location.pathname.includes('admin-dashboard');
  const basePath = '/' + (window.location.pathname.split('/')[1] || 'admin-dashboard');

useEffect(() => {
  const fetchSubjectData = async () => {
    try {
      const response = await api.get('/api/manage-subjects/');
      const responseData = response.data;

      if (responseData.status === 'success') {
        const found = responseData.data.find((s: SubjectData) => s.id === Number(id));
        if (found) setSubject(found);
      }
    } catch (error) {
      console.error("Failed to fetch subject data", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchSubjectStudents = async () => {
    setStudentsLoading(true);
    try {
      const response = await api.get(`/api/manage-subjects/${id}/students/`);
      if (response.data.status === 'success') {
        setStudents(response.data.data.students);
        setStudentTerm(response.data.data.term);
      }
    } catch (error) {
      console.error("Failed to fetch subject roster", error);
    } finally {
      setStudentsLoading(false);
    }
  };

  fetchSubjectData();
  fetchSubjectStudents();
}, [id]);

  // Roster is already grade+stream-ordered by the backend; group by stream here for
  // display (each stream is its own findable section) and apply the search filter within.
  const groupedStudents = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    const filtered = q
      ? students.filter(s => s.name.toLowerCase().includes(q) || s.roll.toLowerCase().includes(q) || s.stream_name.toLowerCase().includes(q))
      : students;

    const groups = new Map<string, SubjectStudent[]>();
    filtered.forEach(s => {
      const key = `${s.grade_name} ${s.stream_name}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(s);
    });
    return Array.from(groups.entries());
  }, [students, studentSearch]);

  if (loading) return <div className="p-6 text-slate-500">Loading Subject Profile...</div>;
  if (!subject) return <div className="p-6 text-red-500">Subject not found.</div>;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 animate-fade-in">
      
      {/* Back button navigates contextually to the appropriate index directory */}
      <button onClick={() => navigate(`${basePath}/subjects`)} className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-emerald-600 transition-colors w-max">
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
            <BookOpen className="w-4 h-4" /> Code: {subject.code} | Dept: {subject.department_name ?? 'Uncategorized'}
          </p>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 text-center min-w-37.5">
            <p className="text-3xl font-black text-slate-800">{subject.assigned_teachers.length}</p>
            <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mt-1">Active Teachers</p>
          </div>
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 text-center min-w-37.5">
            <p className="text-3xl font-black text-slate-800">{studentsLoading ? '—' : students.length}</p>
            <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mt-1">Enrolled Students</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Approved Staff Pool */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <Users className="w-5 h-5 text-blue-600" /> Teaching Staff Pool
            </h3>
            {/* ✅ RBAC BUTTON INTERCEPT: Hides staff allocation management panel if user is an instructor */}
            {isAdmin && (
              <button 
                onClick={() => navigate(`${basePath}/subjects/edit/${subject.id}`)} 
                className="text-sm text-blue-600 font-medium hover:underline"
              >
                Manage Staff
              </button>
            )}
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

        {/* Curriculum placeholder */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-4">
            <GraduationCap className="w-5 h-5 text-purple-500" /> Curriculum & Syllabus
          </h3>
          <div className="bg-slate-50 border border-slate-100 rounded-lg p-8 text-center text-sm text-slate-500">
              Syllabus tracking, lesson plan attachments, and termly milestones will be managed here.
          </div>
        </div>

      </div>

      {/* Enrolled Students, grouped by Grade */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
          <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-indigo-500" /> Students Taking {subject.name}
            {studentTerm && <span className="text-xs font-medium text-slate-400 normal-case">&middot; {studentTerm} results shown</span>}
          </h3>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={studentSearch}
              onChange={(e) => setStudentSearch(e.target.value)}
              placeholder="Search students…"
              className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        {studentsLoading ? (
          <div className="space-y-2 animate-pulse">
            {[1, 2, 3].map(i => <div key={i} className="h-12 bg-slate-100 rounded-lg"></div>)}
          </div>
        ) : groupedStudents.length === 0 ? (
          <div className="bg-amber-50 border border-amber-100 rounded-lg p-6 text-center text-amber-700 font-medium text-sm">
            {students.length === 0 ? `No students are currently taking ${subject.name}.` : 'No students match your search.'}
          </div>
        ) : (
          <div className="space-y-6">
            {groupedStudents.map(([streamLabel, group]) => (
              <div key={streamLabel}>
                <div className="flex items-center gap-2 mb-2">
                  <h4 className="text-sm font-bold text-slate-700">{streamLabel}</h4>
                  <span className="bg-indigo-50 text-indigo-600 text-[11px] font-bold px-2 py-0.5 rounded-full">{group.length}</span>
                </div>
                <div className="overflow-x-auto border border-slate-100 rounded-lg">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 text-slate-400 uppercase text-[11px] tracking-wider">
                        <th className="py-2.5 px-4 font-bold">Student</th>
                        <th className="py-2.5 px-4 font-bold">Roll No.</th>
                        <th className="py-2.5 px-4 font-bold text-right">Score</th>
                        <th className="py-2.5 px-4 font-bold text-right">Grade</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {group.map(s => (
                        <tr key={s.id} className="hover:bg-slate-50/70 transition-colors">
                          <td className="py-2.5 px-4 font-semibold text-slate-800 text-sm">{s.name}</td>
                          <td className="py-2.5 px-4 text-slate-500 text-sm font-mono">{s.roll}</td>
                          <td className="py-2.5 px-4 text-slate-600 text-sm text-right font-mono">
                            {s.total_score !== null ? s.total_score : <span className="text-slate-300 italic font-sans">—</span>}
                          </td>
                          <td className="py-2.5 px-4 text-right">
                            {s.grade_label ? (
                              <span className="bg-emerald-50 text-emerald-700 text-xs font-bold px-2 py-0.5 rounded-full">{s.grade_label}</span>
                            ) : (
                              <span className="text-slate-300 italic text-xs">Not graded</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}