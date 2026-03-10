import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Users, Trophy, BookOpen, Clock, CalendarDays, GraduationCap } from 'lucide-react';

interface ClassData {
  id: number;
  name: string;
  capacity: number;
  class_teacher: string;
  grade_name: string;
}

export default function ViewClass() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [classData, setClassData] = useState<ClassData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // We will need a specific endpoint for fetching a single class's deep data later.
    // For now, we fetch all and filter to get the structure rendering perfectly.
    fetch('http://localhost:8000/api/manage-classes/')
      .then(res => res.json())
      .then(response => {
        if (response.status === 'success') {
          // Find the specific stream across all grades
          for (const grade of response.data) {
            const stream = grade.streams.find((s: any) => s.id === Number(id));
            if (stream) {
              setClassData({ ...stream, grade_name: grade.grade_name });
              break;
            }
          }
        }
        setLoading(false);
      })
      .catch(err => {
        console.error("Failed to fetch class data", err);
        setLoading(false);
      });
  }, [id]);

  if (loading) return <div className="p-6 text-slate-500 flex items-center gap-3"><span className="animate-spin h-5 w-5 border-2 border-blue-600 border-t-transparent rounded-full"></span> Loading Class Profile...</div>;
  if (!classData) return <div className="p-6 text-red-500">Class not found.</div>;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 animate-fade-in">
      
      {/* Header Actions */}
      <button onClick={() => navigate('/admin-dashboard/classes')} className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-blue-600 transition-colors w-max">
        <ArrowLeft className="w-4 h-4" /> Back to Classes
      </button>

      {/* Hero Section */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-3xl font-black text-slate-800">{classData.grade_name} {classData.name}</h1>
            <span className="bg-blue-100 text-blue-800 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider">Active</span>
          </div>
          <p className="text-slate-500 font-medium flex items-center gap-2">
            <Users className="w-4 h-4" /> Capacity: {classData.capacity} Students Maximum
          </p>
        </div>
        
        <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 min-w-62.5">
          <p className="text-xs text-slate-400 uppercase tracking-wider font-bold mb-1">Homeroom Teacher</p>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold">
              {classData.class_teacher !== 'Not Assigned' ? classData.class_teacher.charAt(0) : '?'}
            </div>
            <span className="font-bold text-slate-700">{classData.class_teacher}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column - Stats & Roster */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Performance Overview */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-4">
              <Trophy className="w-5 h-5 text-amber-500" /> Academic Performance Summary
            </h3>
            <div className="grid grid-cols-3 gap-4">
               <div className="bg-amber-50 p-4 rounded-lg border border-amber-100 text-center">
                 <p className="text-2xl font-black text-amber-700">78.4%</p>
                 <p className="text-xs text-amber-600 font-medium mt-1 uppercase tracking-wider">Class Mean Score</p>
               </div>
               <div className="bg-emerald-50 p-4 rounded-lg border border-emerald-100 text-center">
                 <p className="text-2xl font-black text-emerald-700">94%</p>
                 <p className="text-xs text-emerald-600 font-medium mt-1 uppercase tracking-wider">Avg Attendance</p>
               </div>
               <div className="bg-blue-50 p-4 rounded-lg border border-blue-100 text-center">
                 <p className="text-2xl font-black text-blue-700">B+</p>
                 <p className="text-xs text-blue-600 font-medium mt-1 uppercase tracking-wider">Overall Grade</p>
               </div>
            </div>
          </div>

          {/* Student Roster Placeholder */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
             <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                  <GraduationCap className="w-5 h-5 text-blue-600" /> Enrolled Students
                </h3>
                <button className="text-sm text-blue-600 font-medium hover:underline">View Full Roster</button>
             </div>
             <div className="bg-slate-50 border border-slate-100 rounded-lg p-8 text-center text-slate-500">
                Student directory mapping for this stream will be displayed here once the Student models are connected.
             </div>
          </div>

        </div>

        {/* Right Column - Schedule & Subjects */}
        <div className="space-y-6">
          
          {/* Timetable Placeholder */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-4">
              <CalendarDays className="w-5 h-5 text-indigo-500" /> Today's Timetable
            </h3>
            <div className="space-y-3">
              {/* Mock Timetable Items */}
              <div className="flex gap-3 items-start p-3 rounded-lg hover:bg-slate-50 transition border border-transparent hover:border-slate-100">
                 <div className="bg-indigo-100 text-indigo-700 px-2 py-1 rounded text-xs font-bold w-16 text-center">08:00</div>
                 <div>
                   <p className="text-sm font-bold text-slate-800">Mathematics</p>
                   <p className="text-xs text-slate-500 flex items-center gap-1"><Clock className="w-3 h-3"/> Mr. Anderson</p>
                 </div>
              </div>
              <div className="flex gap-3 items-start p-3 rounded-lg hover:bg-slate-50 transition border border-transparent hover:border-slate-100">
                 <div className="bg-indigo-100 text-indigo-700 px-2 py-1 rounded text-xs font-bold w-16 text-center">09:40</div>
                 <div>
                   <p className="text-sm font-bold text-slate-800">Biology</p>
                   <p className="text-xs text-slate-500 flex items-center gap-1"><Clock className="w-3 h-3"/> Dr. Roberts</p>
                 </div>
              </div>
            </div>
            <button className="w-full mt-4 py-2 bg-slate-100 text-slate-600 font-medium text-sm rounded-lg hover:bg-slate-200 transition">Manage Timetable</button>
          </div>

          {/* Subject Teachers Pool */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-4">
              <BookOpen className="w-5 h-5 text-emerald-500" /> Assigned Subject Teachers
            </h3>
            <div className="bg-slate-50 border border-slate-100 rounded-lg p-6 text-center text-sm text-slate-500">
                Subject allocation matrix will populate here once subject assignments are completed.
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}