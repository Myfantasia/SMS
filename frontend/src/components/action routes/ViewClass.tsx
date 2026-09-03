import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Users, BookOpen, Clock, CalendarDays, GraduationCap, Settings, Star, ClipboardCheck } from 'lucide-react';
import ManageEnrollments from './ManageEnrollments';
import ManageCurriculum from './ManageCurriculum';
import api from '../../libs/axiosInstance';
import type { TimeSlot, Lesson, Timetable } from '../../libs/types';

interface StudentData {
  id: number;
  name: string;
  roll: string;
}

interface TodayLesson {
  id: number;
  subject: string;
  teacher: string;
  start_time: string;
  end_time: string;
}

interface ClassData {
  id: number;
  name: string;
  capacity: number;
  enrolled_count: number;
  class_teacher: string;
  grade_name: string;
  grade_id: number; 
  students: StudentData[];
  is_current_user_class_teacher?: boolean;
}

interface AssignedTeacher {
  subject: string;
  teacher: string;
}

export default function ViewClass() {
  const { id } = useParams();
  const navigate = useNavigate();
  
  const [classData, setClassData] = useState<ClassData | null>(null);
  const [loading, setLoading] = useState(true);
  
  const [assignedTeachers, setAssignedTeachers] = useState<AssignedTeacher[]>([]);
  const [loadingTeachers, setLoadingTeachers] = useState(true);

  const [todayLessons, setTodayLessons] = useState<TodayLesson[]>([]);
  const [loadingTimetable, setLoadingTimetable] = useState(true);

  const [showEnrollments, setShowEnrollments] = useState(false);
  const [showCurriculum, setShowCurriculum] = useState(false);

  const isAdmin = window.location.pathname.includes('admin-dashboard');
  const basePath = '/' + (window.location.pathname.split('/')[1] || 'admin-dashboard');

  useEffect(() => {
  const loadClassAndFacultyWorkspace = async () => {
    try {
      const [classesRes, teachersRes] = await Promise.all([
        api.get('/api/manage-classes/'),
        api.get(`/api/academic-hub/stream-teachers/${id}/`)
      ]);

      if (classesRes.data.status === 'success') {
        for (const grade of classesRes.data.data) {
          const stream = grade.streams.find((s: any) => s.id === Number(id));
          if (stream) {
            setClassData({ ...stream, grade_name: grade.grade_name, grade_id: grade.grade_id });
            break;
          }
        }
      }

      if (teachersRes.data.status === 'success') {
        setAssignedTeachers(teachersRes.data.data);
      }
    } catch (err) {
      console.error("Failed to compile workspace requirements:", err);
    } finally {
      setLoading(false);
      setLoadingTeachers(false);
    }
  };

  loadClassAndFacultyWorkspace();
}, [id]);

  useEffect(() => {
    const loadTodaysTimetable = async () => {
      setLoadingTimetable(true);
      try {
        const [gridRes, containersRes] = await Promise.all([
          api.get('/api/timetable/grid/'),
          api.get('/api/timetable/manage-containers/'),
        ]);

        const slots: TimeSlot[] = gridRes.data.status === 'success' ? gridRes.data.data : [];
        const containers: Timetable[] = containersRes.data.status === 'success' ? containersRes.data.data : [];
        const activeTimetable = containers.find((t) => t.is_active);

        if (!activeTimetable) {
          setTodayLessons([]);
          return;
        }

        const lessonsRes = await api.get(`/api/timetable/class-lessons/${id}/${activeTimetable.id}/`);
        const lessons: Lesson[] = lessonsRes.data.status === 'success' ? lessonsRes.data.data : [];

        const slotById = new Map(slots.map((s) => [s.id, s]));
        const todayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });

        const today = lessons
          .map((l) => ({ lesson: l, slot: slotById.get(l.time_slot_id) }))
          .filter((entry): entry is { lesson: Lesson; slot: TimeSlot } => !!entry.slot && entry.slot.day === todayName && !entry.slot.is_global)
          .sort((a, b) => a.slot.start_time.localeCompare(b.slot.start_time))
          .map(({ lesson, slot }) => ({
            id: lesson.id,
            subject: lesson.subject_name,
            teacher: lesson.teacher_name,
            start_time: slot.start_time,
            end_time: slot.end_time,
          }));

        setTodayLessons(today);
      } catch (err) {
        console.error("Failed to load today's timetable:", err);
        setTodayLessons([]);
      } finally {
        setLoadingTimetable(false);
      }
    };

    loadTodaysTimetable();
  }, [id]);

  if (loading) return <div className="p-6 text-slate-500 dark:text-slate-400 flex items-center gap-3"><span className="animate-spin h-5 w-5 border-2 border-blue-600 dark:border-blue-400 border-t-transparent rounded-full"></span> Loading Class Profile...</div>;
  if (!classData) return <div className="p-6 text-red-500 dark:text-red-400">Class not found.</div>;

  if (showEnrollments) {
    return (
      <div className="animate-in fade-in zoom-in-95 duration-200">
        <div className="max-w-7xl mx-auto px-6 pt-6">
          <button onClick={() => setShowEnrollments(false)} className="flex items-center gap-2 text-sm font-medium text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors w-max">
            <ArrowLeft className="w-4 h-4" /> Back to Class Profile
          </button>
        </div>
        <ManageEnrollments streamId={Number(id)} />
      </div>
    );
  }

  if (showCurriculum) {
    return (
      <div className="animate-in fade-in zoom-in-95 duration-200">
        <div className="max-w-7xl mx-auto px-6 pt-6">
          <button onClick={() => setShowCurriculum(false)} className="flex items-center gap-2 text-sm font-medium text-slate-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors w-max">
            <ArrowLeft className="w-4 h-4" /> Back to Class Profile
          </button>
        </div>
        <ManageCurriculum streamId={Number(id)} gradeId={classData.grade_id} classNameTitle={`${classData.grade_name} ${classData.name}`} />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-300">

      <button onClick={() => navigate(`${basePath}/classes`)} className="flex items-center gap-2 text-sm font-medium text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors w-max">
        <ArrowLeft className="w-4 h-4" /> Back to Classes
      </button>

      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm dark:shadow-none border border-slate-200 dark:border-slate-700 p-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-3xl font-black text-slate-800 dark:text-slate-100">{classData.name}</h1>
            <span className="bg-blue-100 dark:bg-blue-500/10 text-blue-800 dark:text-blue-400 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider">Active</span>
          </div>
          <p className="text-slate-500 dark:text-slate-400 font-medium flex items-center gap-2">
            <Users className="w-4 h-4" /> Capacity: {classData.enrolled_count} / {classData.capacity} Students Enrolled
          </p>
        </div>

        <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-xl border border-slate-100 dark:border-slate-700 min-w-62.5">
          <p className="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wider font-bold mb-1">Homeroom Teacher</p>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold">
              {classData.class_teacher !== 'Not Assigned' ? classData.class_teacher.charAt(0) : '?'}
            </div>
            <span className="font-bold text-slate-700 dark:text-slate-200">{classData.class_teacher}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        <div className="lg:col-span-2 space-y-6">

          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm dark:shadow-none border border-slate-200 dark:border-slate-700 p-6">
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 mb-4">
              <ClipboardCheck className="w-5 h-5 text-amber-500 dark:text-amber-400" /> Class Snapshot
            </h3>
            <div className="grid grid-cols-3 gap-4">
               <div className="bg-amber-50 dark:bg-amber-500/10 p-4 rounded-lg border border-amber-100 dark:border-amber-500/20 text-center">
                 <p className="text-2xl font-black text-amber-700 dark:text-amber-400">
                   {classData.capacity > 0 ? Math.round((classData.enrolled_count / classData.capacity) * 100) : 0}%
                 </p>
                 <p className="text-xs text-amber-600 dark:text-amber-400 font-medium mt-1 uppercase tracking-wider">Capacity Filled</p>
               </div>
               <div className="bg-emerald-50 dark:bg-emerald-500/10 p-4 rounded-lg border border-emerald-100 dark:border-emerald-500/20 text-center">
                 <p className="text-2xl font-black text-emerald-700 dark:text-emerald-400">{assignedTeachers.length}</p>
                 <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium mt-1 uppercase tracking-wider">Subjects Staffed</p>
               </div>
               <div className="bg-blue-50 dark:bg-blue-500/10 p-4 rounded-lg border border-blue-100 dark:border-blue-500/20 text-center">
                 <p className="text-2xl font-black text-blue-700 dark:text-blue-400">
                   {classData.class_teacher !== 'Not Assigned' ? <Star className="w-6 h-6 fill-blue-700 dark:fill-blue-400 mx-auto" /> : '—'}
                 </p>
                 <p className="text-xs text-blue-600 dark:text-blue-400 font-medium mt-1 uppercase tracking-wider">Homeroom Assigned</p>
               </div>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm dark:shadow-none border border-slate-200 dark:border-slate-700 p-6">
             <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <GraduationCap className="w-5 h-5 text-blue-600 dark:text-blue-400" /> Enrolled Students
                </h3>

                {isAdmin && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowEnrollments(true)}
                      className="text-sm text-blue-600 dark:text-blue-400 font-medium hover:underline px-3 py-1.5 bg-blue-50 dark:bg-blue-500/10 rounded-md transition"
                    >
                      Manage Enrollments
                    </button>
                    <button
                      onClick={() => setShowCurriculum(true)}
                      className="flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400 font-medium hover:underline px-3 py-1.5 bg-emerald-50 dark:bg-emerald-500/10 rounded-md transition"
                    >
                      <Settings className="w-4 h-4" /> Manage Curriculum
                    </button>
                  </div>
                )}
             </div>

             <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-700 rounded-lg overflow-hidden">
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 text-slate-500 dark:text-slate-400 font-medium">
                    <tr>
                      <th className="px-4 py-3">Admission No.</th>
                      <th className="px-4 py-3">Student Name</th>
                      {(isAdmin || classData.is_current_user_class_teacher) && (
                        <th className="px-4 py-3 text-right">Actions</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                    {classData.students && classData.students.length > 0 ? (
                      classData.students.map(student => (
                        <tr key={student.id} className="hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                          <td className="px-4 py-3 font-medium text-slate-600 dark:text-slate-300">{student.roll}</td>
                          <td className="px-4 py-3 text-slate-800 dark:text-slate-100 font-semibold">{student.name}</td>
                          {(isAdmin || classData.is_current_user_class_teacher) && (
                            <td className="px-4 py-3 text-right">
                               <button
                                  onClick={() => navigate(`${basePath}/classes/assign-subjects/${classData.grade_id}/${student.id}`, { state: { studentName: student.name } })}
                                  className="text-blue-600 dark:text-blue-400 hover:underline text-xs font-medium"
                               >
                                  Assign Subjects
                               </button>
                            </td>
                          )}
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={3} className="px-4 py-8 text-center text-slate-400 dark:text-slate-500">No students enrolled in this class yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
             </div>
          </div>

        </div>

        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm dark:shadow-none border border-slate-200 dark:border-slate-700 p-6">
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 mb-4">
              <CalendarDays className="w-5 h-5 text-indigo-500 dark:text-indigo-400" /> Today's Timetable
            </h3>
            {loadingTimetable ? (
              <div className="flex justify-center p-8">
                <span className="animate-spin h-5 w-5 border-2 border-indigo-500 dark:border-indigo-400 border-t-transparent rounded-full"></span>
              </div>
            ) : todayLessons.length > 0 ? (
              <div className="space-y-3">
                {todayLessons.map((lesson) => (
                  <div key={lesson.id} className="flex gap-3 items-start p-3 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition border border-transparent hover:border-slate-100 dark:hover:border-slate-700">
                    <div className="bg-indigo-100 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 px-2 py-1 rounded text-xs font-bold w-16 text-center shrink-0">{lesson.start_time}</div>
                    <div>
                      <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{lesson.subject}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1"><Clock className="w-3 h-3"/> {lesson.teacher}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-lg p-6 text-center text-sm text-slate-500 dark:text-slate-400">
                No lessons scheduled for this class today.
              </div>
            )}
            {isAdmin && (
              <button
                onClick={() => navigate(`${basePath}/timetable?class=${id}`)}
                className="w-full mt-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-medium text-sm rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition"
              >
                Manage Timetable
              </button>
            )}
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm dark:shadow-none border border-slate-200 dark:border-slate-700 p-6">
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 mb-4">
              <BookOpen className="w-5 h-5 text-emerald-500 dark:text-emerald-400" /> Assigned Subject Teachers
            </h3>

            {loadingTeachers ? (
              <div className="flex justify-center p-8">
                 <span className="animate-spin h-5 w-5 border-2 border-emerald-500 dark:border-emerald-400 border-t-transparent rounded-full"></span>
              </div>
            ) : assignedTeachers.length > 0 ? (
              <div className="space-y-2 max-h-96 overflow-y-auto pr-1 -mr-1">
                {assignedTeachers.map((item, idx) => (
                   <div key={idx} className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100/70 dark:hover:bg-slate-700/70 rounded-lg border border-slate-100 dark:border-slate-700 transition-colors">
                     <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 flex items-center justify-center font-bold text-xs shrink-0">
                       {item.teacher.charAt(0).toUpperCase()}
                     </div>
                     <div className="min-w-0 flex-1">
                       <p className="font-bold text-slate-800 dark:text-slate-100 text-sm truncate">{item.subject}</p>
                       <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{item.teacher}</p>
                     </div>
                   </div>
                ))}
              </div>
            ) : (
              <div className="bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-lg p-6 text-center text-sm text-slate-500 dark:text-slate-400">
                  No subject teachers actively assigned to this stream.
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}