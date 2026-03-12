import { useState, useEffect } from 'react';
import { Clock, BookOpen, Trash2, Plus, X, Save, Settings } from 'lucide-react';
import toast from 'react-hot-toast';
import TimetableSettings from './TimetableSettings';

interface TimeSlot { id: number; day: string; start_time: string; end_time: string; is_global: boolean; global_label: string; }
interface Bucket { subject_id: number; subject_name: string; total_required: number; already_scheduled: number; remaining: number; double_required: number; }
interface Lesson { id: number; time_slot_id: number; subject_name: string; teacher_name: string; is_double?: boolean; }
interface Teacher { id: number; name: string; }
interface Timetable { id: number; name: string; is_active: boolean; }
interface ClassStream { id: number; name: string; grade_name: string; }

const getSubjectColor = (subjectName: string) => {
  const colors = [
    'bg-blue-50 text-blue-700 border-blue-200', 'bg-purple-50 text-purple-700 border-purple-200',
    'bg-emerald-50 text-emerald-700 border-emerald-200', 'bg-amber-50 text-amber-700 border-amber-200',
    'bg-rose-50 text-rose-700 border-rose-200',
  ];
  const index = subjectName.length % colors.length;
  return colors[index];
};

export default function TimetableManager() {
  const [loading, setLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  
  // Toggle between Weekdays and Weekends
  const [viewType, setViewType] = useState<'Weekdays' | 'Weekends'>('Weekdays');
  
  // --- DYNAMIC STATE ---
  const [activeTimetable, setActiveTimetable] = useState<Timetable | null>(null);
  const [classes, setClasses] = useState<ClassStream[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<number | null>(null);

  // Modal State
  const [activeSlotId, setActiveSlotId] = useState<number | null>(null);
  const [selectedSubject, setSelectedSubject] = useState('');
  const [selectedTeacher, setSelectedTeacher] = useState('');
  const [isDoublePeriod, setIsDoublePeriod] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [lessonToDelete, setLessonToDelete] = useState<number | null>(null);

  // DYNAMIC TEACHER FETCHING BASED ON SUBJECT SELECTION
  useEffect(() => {
    if (!selectedSubject) {
      setTeachers([]); // Clear teachers if no subject is selected
      setSelectedTeacher('');
      return;
    }

    const fetchTeachersForSubject = async () => {
      try {
        const res = await fetch(`http://localhost:8000/api/timetable/teachers-by-subject/${selectedSubject}/`);
        const data = await res.json();
        if (data.status === 'success') {
          setTeachers(data.data);
        } else {
          toast.error("Could not fetch teachers for this subject.");
        }
      } catch (e) {
        console.error("Error fetching teachers", e);
      }
    };

    fetchTeachersForSubject();
  }, [selectedSubject]);

  // Filter logic for view
  const weekdayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const weekendNames = ['Saturday', 'Sunday'];
  const activeDays = viewType === 'Weekdays' ? weekdayNames : weekendNames;

  // Chronological sorting tailored to the current view
  const uniqueTimes = Array.from(new Set(
    slots
      .filter(s => activeDays.includes(s.day))
      .map(s => `${s.start_time} - ${s.end_time}`)
  )).sort();

  const fetchInitialSetup = async () => {
    try {
      const [termRes, classRes] = await Promise.all([
        fetch('http://localhost:8000/api/timetable/manage-containers/'),
        fetch('http://localhost:8000/api/manage-classes/')
      ]);
      const termData = await termRes.json();
      const classData = await classRes.json();
      
      if (termData.status === 'success') {
        const active = termData.data.find((t: Timetable) => t.is_active);
        if (active) setActiveTimetable(active);
        else setActiveTimetable(null);
      }

      if (classData.status === 'success') {
        const flatClasses: ClassStream[] = [];
        classData.data.forEach((grade: any) => {
          grade.streams.forEach((stream: any) => {
            flatClasses.push({ id: stream.id, name: stream.name, grade_name: grade.grade_name });
          });
        });
        setClasses(flatClasses);
        if (flatClasses.length > 0 && !selectedClassId) {
          setSelectedClassId(flatClasses[0].id);
        }
      }
    } catch (e) {
      toast.error("Failed to load initial setup.");
    }
  };

  const fetchGridData = async () => {
    if (!selectedClassId || !activeTimetable) {
      setLoading(false);
      return;
    }
    
    setLoading(true);
    try {
      const [gridRes, bucketRes, lessonsRes] = await Promise.all([
        fetch('http://localhost:8000/api/timetable/grid/'),
        fetch(`http://localhost:8000/api/timetable/buckets/${selectedClassId}/${activeTimetable.id}/`),
        fetch(`http://localhost:8000/api/timetable/class-lessons/${selectedClassId}/${activeTimetable.id}/`)
      ]);

      const gridData = await gridRes.json();
      const bucketData = await bucketRes.json();
      const lessonsData = await lessonsRes.json();

      if (gridData.status === 'success') setSlots(gridData.data);
      if (bucketData.status === 'success') setBuckets(bucketData.data);
      if (lessonsData.status === 'success') setLessons(lessonsData.data);
    } catch (error) { 
      toast.error("Failed to sync grid."); 
    } finally { 
      setLoading(false); 
    }
  };

  useEffect(() => { fetchInitialSetup(); }, []);
  useEffect(() => { fetchGridData(); }, [selectedClassId, activeTimetable]);

  const confirmRemoveLesson = async () => {
    if (!lessonToDelete) return;
    try {
      // Find the lesson to delete
      const targetLesson = lessons.find(l => l.id === lessonToDelete);
      
      // If it's a double period, we need to find and delete its paired sibling
      let twinLessonId: number | null = null;
      if (targetLesson && targetLesson.is_double) {
         const slot = slots.find(s => s.id === targetLesson.time_slot_id);
         if (slot) {
            // Index-based sibling matching (ignores minor time gaps)
            const daySlots = slots.filter(s => s.day === slot.day).sort((a, b) => a.start_time.localeCompare(b.start_time));
            const idx = daySlots.findIndex(s => s.id === slot.id);

            // Check previous slot for sibling
            const prevSlot = daySlots[idx - 1];
            const prevL = prevSlot && !prevSlot.is_global ? lessons.find(l => l.time_slot_id === prevSlot.id && l.subject_name === targetLesson.subject_name && l.is_double) : null;
            if (prevL) twinLessonId = prevL.id;
            
            // Check next slot for sibling
            const nextSlot = daySlots[idx + 1];
            const nextL = nextSlot && !nextSlot.is_global ? lessons.find(l => l.time_slot_id === nextSlot.id && l.subject_name === targetLesson.subject_name && l.is_double) : null;
            if (nextL) twinLessonId = nextL.id;
         }
      }

      // Delete main lesson
      const res = await fetch(`http://localhost:8000/api/timetable/remove-lesson/${lessonToDelete}/`, { method: 'DELETE' });
      const data = await res.json();
      
      if (data.status === 'success') {
        // If there is a twin, delete it silently behind the scenes
        if (twinLessonId) {
           await fetch(`http://localhost:8000/api/timetable/remove-lesson/${twinLessonId}/`, { method: 'DELETE' });
        }
        toast.success("Lesson returned to bucket.");
        fetchGridData(); 
      } else {
        toast.error(data.message);
      }
    } catch (e) { toast.error("Error removing lesson."); }
    setLessonToDelete(null);
  };

  const handleSaveLesson = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTimetable || !selectedClassId || !activeSlotId) return;

    setIsSaving(true);
    try {
      const currentSlot = slots.find(s => s.id === activeSlotId);
      let nextSlot = null;

      // Ensure consecutive slots exist before attempting a double period
      if (isDoublePeriod && currentSlot) {
        // Index-based next slot calculation
        const daySlots = slots.filter(s => s.day === currentSlot.day).sort((a, b) => a.start_time.localeCompare(b.start_time));
        const currentIndex = daySlots.findIndex(s => s.id === activeSlotId);
        nextSlot = daySlots[currentIndex + 1];

        if (!nextSlot || nextSlot.is_global) {
          toast.error("Cannot assign a double period here. There is no consecutive 40-minute slot available.", { duration: 5000 });
          setIsSaving(false);
          return;
        }
        
        // Prevent overriding an existing lesson in the second half, UNLESS it's a Technical Block
        const conflict = lessons.find(l => l.time_slot_id === nextSlot.id);
        if (conflict && conflict.subject_name !== "Technical Block") {
           toast.error(`Cannot assign a double period. The next slot is already occupied by ${conflict.subject_name}.`, { duration: 5000 });
           setIsSaving(false);
           return;
        }
      }

      const payload = {
        timetable_id: activeTimetable.id,
        class_stream_id: selectedClassId,
        subject_id: selectedSubject,
        teacher_id: selectedTeacher,
        is_double_period: isDoublePeriod
      };

      // Lock in First Half
      const res1 = await fetch('http://localhost:8000/api/timetable/save-lesson/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, time_slot_id: activeSlotId })
      });
      const data1 = await res1.json();
      
      if (data1.status !== 'success') {
        toast.error(data1.message, { duration: 6000 }); 
        setIsSaving(false);
        return;
      }

      // Lock in Second Half automatically if Double Period is selected
      if (isDoublePeriod && nextSlot) {
         const res2 = await fetch('http://localhost:8000/api/timetable/save-lesson/', {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({ ...payload, time_slot_id: nextSlot.id })
         });
         const data2 = await res2.json();
         if (data2.status !== 'success') {
            toast.error(`Part 2 of double period failed: ${data2.message}`);
         }
      }

      toast.success(isDoublePeriod ? "Double period locked in!" : "Lesson locked in!");
      setActiveSlotId(null);
      setSelectedSubject('');
      setSelectedTeacher('');
      setIsDoublePeriod(false);
      fetchGridData(); 
    } catch (e) {
      toast.error("Network error saving lesson.");
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) return <div className="p-8 text-slate-500 font-medium">Booting Timetable Engine...</div>;

  // Dynamic grid configuration
  const gridColClass = viewType === 'Weekdays' 
    ? "grid-cols-[90px_repeat(5,minmax(0,1fr))]" 
    : "grid-cols-[90px_repeat(2,minmax(0,1fr))]";

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-6 flex flex-col h-[calc(100vh-80px)] animate-fade-in relative">
      
      {/* HEADER: Restored to original layout structure */}
      <div className="flex justify-between items-center bg-white p-6 rounded-2xl shadow-sm border border-slate-200 shrink-0">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-black text-slate-800 tracking-tight">Schedule Builder</h1>
          <div className="flex items-center gap-4">
            <p className="text-slate-500 font-medium whitespace-nowrap">
              Active Term: <span className="text-indigo-600 font-bold">{activeTimetable?.name || "None Selected"}</span>
            </p>
            
            <select 
              value={selectedClassId || ''} 
              onChange={(e) => setSelectedClassId(Number(e.target.value))}
              className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm font-bold text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 bg-slate-50 shadow-sm"
            >
              {classes.map(c => <option key={c.id} value={c.id}>{c.grade_name} {c.name}</option>)}
            </select>

            {/* TOGGLE: Positioned within the flow of header info */}
            <div className="bg-slate-100 p-1 rounded-xl flex gap-1 border border-slate-200">
              <button 
                onClick={() => setViewType('Weekdays')}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-black transition-all ${viewType === 'Weekdays' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400'}`}
              >
                WEEKDAYS
              </button>
              <button 
                onClick={() => setViewType('Weekends')}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-black transition-all ${viewType === 'Weekends' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400'}`}
              >
                WEEKENDS
              </button>
            </div>
          </div>
        </div>

        {/* BUTTON GROUP: Restored exactly as requested */}
        <div className="flex gap-3">
          <button onClick={() => setShowSettings(true)} className="px-4 py-2.5 bg-slate-100 text-slate-700 font-bold rounded-xl hover:bg-slate-200 transition flex items-center gap-2">
            <Settings className="w-4 h-4" /> Config
          </button>
          <button className="px-6 py-2.5 bg-slate-100 text-slate-700 font-bold rounded-xl hover:bg-slate-200 transition">Auto-Generate</button>
          <button className="px-6 py-2.5 bg-blue-600 text-white font-bold rounded-xl shadow-lg shadow-blue-600/20 hover:bg-blue-700 transition">Publish Timetable</button>
        </div>
      </div>

      <div className="flex gap-6 flex-1 overflow-hidden min-h-0">
        
        {/* LEFT: Calendar Grid */}
        <div className="flex-1 bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-col overflow-hidden relative">
          <div className="flex-1 overflow-auto custom-scrollbar">
            <div className={`w-full flex flex-col ${viewType === 'Weekends' ? 'max-w-4xl' : ''}`}>
              
              <div className={`grid ${gridColClass} border-b border-slate-100 bg-slate-50 sticky top-0 z-20 shadow-sm`}>
                <div className="p-4 flex items-center justify-center border-r border-slate-100 bg-slate-50"><Clock className="w-5 h-5 text-slate-400" /></div>
                {activeDays.map(day => (
                  <div key={day} className="p-4 text-center font-bold text-slate-700 text-sm uppercase tracking-wider border-r border-slate-100 bg-slate-50">
                    {day}
                  </div>
                ))}
              </div>

              <div className="flex-1">
                {uniqueTimes.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-64 text-slate-400">
                    <Clock className="w-12 h-12 mb-3 text-slate-200" />
                    <p className="font-medium">No slots for {viewType}.</p>
                  </div>
                ) : (
                  uniqueTimes.map(timeStr => (
                    <div key={timeStr} className={`grid ${gridColClass} border-b border-slate-100 group`}>
                      
                      <div className="p-4 text-xs font-bold text-slate-500 flex flex-col justify-center items-center text-center border-r border-slate-100 bg-slate-50/30">
                        <span>{timeStr.split(' - ')[0]}</span>
                        <span className="text-slate-300 font-normal">to</span>
                        <span>{timeStr.split(' - ')[1]}</span>
                      </div>

                      {activeDays.map(day => {
                        const slot = slots.find(s => s.day === day && `${s.start_time} - ${s.end_time}` === timeStr);
                        if (!slot) return <div key={day} className="p-2 border-r border-slate-100 bg-slate-50/50"></div>;

                        if (slot.is_global) return (
                          <div key={slot.id} className="p-2 border-r border-slate-100 flex items-center justify-center">
                            <div className="w-full h-full min-h-[60px] bg-slate-100 rounded-lg flex items-center justify-center text-slate-400 font-bold text-sm tracking-wide border border-dashed border-slate-300 p-2 text-center leading-tight break-words">
                              {slot.global_label}
                            </div>
                          </div>
                        );

                        const lesson = lessons.find(l => l.time_slot_id === slot.id);
                        if (lesson) {
                          const isTech = lesson.subject_name === "Technical Block";
                          const colors = isTech ? 'bg-slate-800 text-white border-slate-700' : getSubjectColor(lesson.subject_name);
                          
                          // ===============================================
                          // DOUBLE PERIOD VISUAL MERGING ENGINE
                          // Detects if this is part 1 or part 2 of a double block
                          // ===============================================
                          let isFirstHalf = false;
                          let isSecondHalf = false;
                          
                          if (lesson.is_double) {
                             const daySlots = slots.filter(s => s.day === day).sort((a, b) => a.start_time.localeCompare(b.start_time));
                             const idx = daySlots.findIndex(s => s.id === slot.id);
                             
                             const prevSlot = daySlots[idx - 1];
                             const prevLesson = prevSlot && !prevSlot.is_global ? lessons.find(l => l.time_slot_id === prevSlot.id && l.subject_name === lesson.subject_name && l.is_double) : null;
                             if (prevLesson) isSecondHalf = true;

                             const nextSlot = daySlots[idx + 1];
                             const nextLesson = nextSlot && !nextSlot.is_global ? lessons.find(l => l.time_slot_id === nextSlot.id && l.subject_name === lesson.subject_name && l.is_double) : null;
                             if (nextLesson && !isSecondHalf) isFirstHalf = true;
                          }

                          // If this is the bottom half, we render an invisible placeholder to hold grid structure
                          if (isSecondHalf) {
                             return <div key={slot.id} className="p-2 border-r border-slate-100 relative"><div className="w-full min-h-[80px]"></div></div>;
                          }

                          // If this is the top half, we render absolute positioning to span downward over the gap!
                          if (isFirstHalf) {
                            return (
                              <div key={slot.id} className="p-2 border-r border-slate-100 relative">
                                <div className="w-full min-h-[80px]"></div> {/* Grid Structural Placeholder */}
                                <div 
                                  className={`absolute top-2 left-2 right-2 z-10 rounded-xl border p-3 flex flex-col justify-between group/card hover:shadow-md min-w-0 transition-all ${colors}`}
                                  style={{ height: 'calc(200% + 17px)' }} // Covers 2 cells + the 17px gap/border between them
                                >
                                  <div className="min-w-0">
                                    <p className="font-bold text-sm leading-tight break-words">{lesson.subject_name} (Double)</p>
                                    <p className={`text-xs mt-1 font-medium truncate ${isTech ? 'text-slate-300' : 'opacity-80'}`}>{lesson.teacher_name}</p>
                                  </div>
                                  <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover/card:opacity-100 transition-opacity">
                                    {isTech && (
                                      <button onClick={() => setActiveSlotId(slot.id)} title="Add another technical subject" className="p-1.5 bg-white/20 hover:bg-white/40 rounded-md text-white transition-colors">
                                        <Plus className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                    <button onClick={() => setLessonToDelete(lesson.id)} title="Remove double lesson" className={`p-1.5 rounded-md transition-colors ${isTech ? 'bg-red-500/20 hover:bg-red-500 text-white' : 'bg-white/50 hover:bg-white text-red-500'}`}>
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          }

                          // STANDARD SINGLE PERIOD RENDER
                          return (
                            <div key={slot.id} className="p-2 border-r border-slate-100">
                              <div className={`w-full h-full min-h-[80px] rounded-xl border p-3 flex flex-col justify-between relative group/card hover:shadow-md min-w-0 transition-all ${colors}`}>
                                <div className="min-w-0">
                                  <p className="font-bold text-sm leading-tight break-words">{lesson.subject_name}</p>
                                  <p className={`text-xs mt-1 font-medium truncate ${isTech ? 'text-slate-300' : 'opacity-80'}`}>{lesson.teacher_name}</p>
                                </div>
                                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover/card:opacity-100 transition-opacity">
                                  {isTech && (
                                    <button onClick={() => setActiveSlotId(slot.id)} title="Add another technical subject" className="p-1.5 bg-white/20 hover:bg-white/40 rounded-md text-white transition-colors">
                                      <Plus className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                  <button onClick={() => setLessonToDelete(lesson.id)} title="Remove lesson" className={`p-1.5 rounded-md transition-colors ${isTech ? 'bg-red-500/20 hover:bg-red-500 text-white' : 'bg-white/50 hover:bg-white text-red-500'}`}>
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        }

                        // EMPTY SLOT (Available to assign)
                        return (
                          <div key={slot.id} className="p-2 border-r border-slate-100 cursor-pointer hover:bg-blue-50/50 transition flex items-center justify-center min-h-[80px]">
                            <button onClick={() => setActiveSlotId(slot.id)} className="w-8 h-8 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-blue-100 hover:text-blue-600">
                              <Plus className="w-4 h-4" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT: Buckets */}
        <div className="w-[260px] bg-slate-50 border border-slate-200 rounded-2xl shadow-sm p-5 flex flex-col shrink-0">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center shrink-0"><BookOpen className="w-4 h-4" /></div>
            <div>
              <h2 className="text-base font-bold text-slate-800 leading-tight">Subject Quotas</h2>
              <p className="text-[11px] text-slate-500">Unassigned lessons</p>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 custom-scrollbar">
            {buckets.length === 0 ? (
              <div className="text-sm text-slate-500 text-center mt-8">
                <p className="font-medium">No quotas configured.</p>
              </div>
            ) : (
              buckets.map(bucket => (
                <div key={bucket.subject_id} className={`p-3 rounded-xl border transition-all ${bucket.remaining === 0 ? 'bg-white border-slate-200 opacity-60' : 'bg-white border-indigo-100 shadow-sm hover:border-indigo-300'}`}>
                  <div className="flex justify-between items-start mb-2 gap-2">
                    <span className="font-bold text-slate-700 text-sm break-words leading-tight">{bucket.subject_name}</span>
                    <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-md whitespace-nowrap ${bucket.remaining === 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-100 text-indigo-700'}`}>{bucket.remaining} Left</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-1.5 mt-2 overflow-hidden">
                    <div className={`h-full rounded-full ${bucket.remaining === 0 ? 'bg-emerald-500' : 'bg-indigo-500'}`} style={{ width: `${(bucket.already_scheduled / bucket.total_required) * 100}%` }}></div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* --- ASSIGNMENT MODAL --- */}
      {activeSlotId && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-fade-in">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="font-bold text-lg text-slate-800">Assign Lesson</h3>
              <button onClick={() => setActiveSlotId(null)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            
            <form onSubmit={handleSaveLesson} className="p-6 space-y-5">
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">Select Subject from Bucket</label>
                <select required value={selectedSubject} onChange={(e) => setSelectedSubject(e.target.value)} className="w-full border border-slate-300 rounded-lg p-3 outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                  <option value="">-- Choose Subject --</option>
                  {buckets.filter(b => b.remaining > 0).map(b => (
                    <option key={b.subject_id} value={b.subject_id}>{b.subject_name} ({b.remaining} left)</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">Assign Teacher</label>
                <select required value={selectedTeacher} onChange={(e) => setSelectedTeacher(e.target.value)} className="w-full border border-slate-300 rounded-lg p-3 outline-none focus:ring-2 focus:ring-blue-500 bg-white" disabled={!selectedSubject || teachers.length === 0}>
                  <option value="">{selectedSubject ? (teachers.length > 0 ? '-- Choose Teacher --' : 'No qualified teachers found') : '-- Select a subject first --'}</option>
                  {teachers.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>

              <label className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-100 transition">
                <input type="checkbox" checked={isDoublePeriod} onChange={(e) => setIsDoublePeriod(e.target.checked)} className="w-5 h-5 text-blue-600 rounded" />
                <span className="font-medium text-slate-700 text-sm">This is a Double Period (80 mins)</span>
              </label>

              <div className="pt-2 flex gap-3">
                <button type="button" onClick={() => setActiveSlotId(null)} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 rounded-lg font-bold hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={isSaving || !selectedTeacher} className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 flex items-center justify-center gap-2 disabled:opacity-70">
                  <Save className="w-4 h-4" /> {isSaving ? 'Checking...' : 'Lock Lesson'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- DELETE CONFIRMATION MODAL --- */}
      {lessonToDelete && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-fade-in p-6 text-center space-y-4">
            <div className="w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-2">
              <Trash2 className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-xl text-slate-800">Remove Lesson?</h3>
            <p className="text-slate-500 text-sm">This lesson will be removed from the grid and returned to the bucket. Are you sure you want to proceed?</p>
            <div className="flex gap-3 pt-4">
              <button onClick={() => setLessonToDelete(null)} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 rounded-lg font-bold hover:bg-slate-50 transition">Cancel</button>
              <button onClick={confirmRemoveLesson} className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg font-bold hover:bg-red-700 transition">Remove</button>
            </div>
          </div>
        </div>
      )}

      {/* --- SETTINGS OVERLAY --- */}
      {showSettings && (
        <TimetableSettings 
          onClose={() => setShowSettings(false)} 
          onRefreshTrigger={fetchInitialSetup} 
        />
      )}
    </div>
  );
}