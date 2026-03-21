import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Trash2 } from 'lucide-react';
import TimetableHeader from './TimetableHeader';
import TimetableBuckets from './TimetableBuckets';
import TimetableGrid from './TimetableGrid';
import AssignLessonModal from './AssignLessonModal';
import TimetableSettings from './TimetableSettings';
import ViewBlockModal from './ViewBlockModal'; 
import type { Bucket, ClassStream, Lesson, Teacher, TimeSlot, Timetable } from '../../libs/types';

// --- FRONTEND HELPER FUNCTIONS ---
const isTechSubject = (subjectName: string, gradeName: string) => {
  const nameUpper = subjectName.toUpperCase();
  const gradeNum = parseInt(gradeName.replace(/\D/g, '')) || 0;
  
  if (nameUpper === "TECHNICAL BLOCK") return true;

  const techKeywords = ["TECHNICAL", "PRE-TECH", "HOME SCIENCE", "COMPUTER", "AGRICULTURE", "ART", "MUSIC"];
  if (techKeywords.some(kw => nameUpper.includes(kw))) return true;

  if (nameUpper.includes("BUSINESS")) return gradeNum >= 10;
  return false;
};

const isRelSubject = (subjectName: string) => {
  const nameUpper = subjectName.toUpperCase();
  return ['CRE', 'IRE', 'HRE', 'CHRISTIAN', 'ISLAM', 'HINDU', 'RELIGIOUS'].some(kw => nameUpper.includes(kw));
};

const isHumSubject = (subjectName: string, gradeName: string) => {
  const nameUpper = subjectName.toUpperCase();
  const gradeNum = parseInt(gradeName.replace(/\D/g, '')) || 0;
  
  if (gradeNum >= 10) {
    if (nameUpper.includes("HISTORY")) return false; // History is excluded
    return ['GEOGRAPHY', 'CRE', 'IRE', 'HRE', 'CHRISTIAN', 'ISLAM', 'HINDU', 'RELIGIOUS'].some(kw => nameUpper.includes(kw));
  }
  return false;
};

const canStackSubjects = (existingSubject: string, newSubject: string, gradeName: string) => {
  const gradeNum = parseInt(gradeName.replace(/\D/g, '')) || 0;

  // 1. Religious subjects stack together (Grades 1-9 ONLY)
  if (gradeNum < 10 && isRelSubject(existingSubject) && isRelSubject(newSubject)) return true;

  // 2. Technical subjects stack together
  if (isTechSubject(existingSubject, gradeName) && isTechSubject(newSubject, gradeName)) return true;

  // 3. Humanities stack together (Grades 10-12 ONLY)
  if (isHumSubject(existingSubject, gradeName) && isHumSubject(newSubject, gradeName)) return true;

  // STRICT RULE: Business Studies in Grades 7-9 will hit 'false' and block stacking automatically!
  return false;
};

export default function TimetableManager() {
  const [loading, setLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  
  const [viewType, setViewType] = useState<'Weekdays' | 'Weekends'>('Weekdays');
  const [activeTimetable, setActiveTimetable] = useState<Timetable | null>(null);
  const [classes, setClasses] = useState<ClassStream[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<number | null>(null);

  const [activeSlotId, setActiveSlotId] = useState<number | null>(null);
  const [selectedSubject, setSelectedSubject] = useState('');
  const [selectedTeacher, setSelectedTeacher] = useState('');
  const [isDoublePeriod, setIsDoublePeriod] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  const [lessonToDelete, setLessonToDelete] = useState<number | null>(null);
  const [viewBlockLessons, setViewBlockLessons] = useState<Lesson[] | null>(null); 
  
  // --- NEW STATE FOR CLEAR GRID MODAL ---
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  useEffect(() => {
    if (!selectedSubject) {
      setTeachers([]);
      setSelectedTeacher('');
      return;
    }
    const fetchTeachers = async () => {
      try {
        const res = await fetch(`http://localhost:8000/api/timetable/teachers-by-subject/${selectedSubject}/`);
        const data = await res.json();
        if (data.status === 'success') setTeachers(data.data);
        else toast.error("Could not fetch teachers.");
      } catch (e) { console.error("Error", e); }
    };
    fetchTeachers();
  }, [selectedSubject]);

  const fetchInitialSetup = async () => {
    try {
      const [termRes, classRes] = await Promise.all([
        fetch('http://localhost:8000/api/timetable/manage-containers/'),
        fetch('http://localhost:8000/api/manage-classes/')
      ]);
      const termData = await termRes.json();
      const classData = await classRes.json();
      
      if (termData.status === 'success') setActiveTimetable(termData.data.find((t: Timetable) => t.is_active) || null);
      if (classData.status === 'success') {
        const flatClasses: ClassStream[] = [];
        classData.data.forEach((grade: any) => {
          grade.streams.forEach((stream: any) => {
            flatClasses.push({ id: stream.id, name: stream.name, grade_name: grade.grade_name });
          });
        });
        setClasses(flatClasses);
        if (flatClasses.length > 0 && !selectedClassId) setSelectedClassId(flatClasses[0].id);
      }
    } catch (e) { toast.error("Failed to load setup."); }
  };

  const fetchGridData = async () => {
    if (!selectedClassId || !activeTimetable) { setLoading(false); return; }
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
    } catch (error) { toast.error("Failed to sync grid."); } 
    finally { setLoading(false); }
  };

  useEffect(() => { fetchInitialSetup(); }, []);
  useEffect(() => { fetchGridData(); }, [selectedClassId, activeTimetable]);

  const handleAutoGenerate = async () => {
    if (!activeTimetable) { toast.error("Please ensure an active term is selected."); return; }
    const loadingToast = toast.loading("Algorithm running...");
    try {
      const res = await fetch(`http://localhost:8000/api/timetable/auto-generate/${activeTimetable.id}/`, { method: 'POST' });
      const data = await res.json();
      if (data.status === 'success') { toast.success(data.message, { id: loadingToast }); fetchGridData(); } 
      else toast.error(data.message, { id: loadingToast });
    } catch (e) { toast.error("Server error.", { id: loadingToast }); }
  };

  // --- NEW: Handle Confirm Clear Grid ---
  const confirmClearGrid = async () => {
    if (!activeTimetable) return;
    const loadingToast = toast.loading("Clearing timetable grid...");
    try {
      const res = await fetch(`http://localhost:8000/api/timetable/clear-grid/${activeTimetable.id}/`, { method: 'DELETE' });
      const data = await res.json();
      if (data.status === 'success') {
        toast.success(data.message, { id: loadingToast });
        fetchGridData();
      } else {
        toast.error(data.message, { id: loadingToast });
      }
    } catch (e) {
      toast.error("Failed to clear grid.", { id: loadingToast });
    }
    setShowClearConfirm(false);
  };

  const confirmRemoveLesson = async () => {
    if (!lessonToDelete) return;
    try {
      const targetLesson = lessons.find(l => l.id === lessonToDelete);
      let twinId = null;
      if (targetLesson && targetLesson.is_double) {
         const slot = slots.find(s => s.id === targetLesson.time_slot_id);
         if (slot) {
            const daySlots = slots.filter(s => s.day === slot.day).sort((a, b) => a.start_time.localeCompare(b.start_time));
            const idx = daySlots.findIndex(s => s.id === slot.id);
            const prevL = daySlots[idx-1] && !daySlots[idx-1].is_global ? lessons.find(l => l.time_slot_id === daySlots[idx-1].id && l.subject_name === targetLesson.subject_name && l.is_double) : null;
            if (prevL) twinId = prevL.id;
            const nextL = daySlots[idx+1] && !daySlots[idx+1].is_global ? lessons.find(l => l.time_slot_id === daySlots[idx+1].id && l.subject_name === targetLesson.subject_name && l.is_double) : null;
            if (nextL) twinId = nextL.id;
         }
      }
      const res = await fetch(`http://localhost:8000/api/timetable/remove-lesson/${lessonToDelete}/`, { method: 'DELETE' });
      const data = await res.json();
      if (data.status === 'success') {
        if (twinId) await fetch(`http://localhost:8000/api/timetable/remove-lesson/${twinId}/`, { method: 'DELETE' });
        toast.success("Lesson returned to bucket.");
        fetchGridData(); 
      } else toast.error(data.message);
    } catch (e) { toast.error("Error removing."); }
    setLessonToDelete(null);
  };

  const handleSaveLesson = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTimetable || !selectedClassId || !activeSlotId) return;
    setIsSaving(true);
    
    try {
      const currentSlot = slots.find(s => s.id === activeSlotId);
      let nextSlot = null;
      
      const currentClass = classes.find(c => c.id === selectedClassId);
      const gradeName = currentClass?.grade_name || '';

      const newSubjectObj = buckets.find(b => b.subject_id.toString() === selectedSubject.toString());
      const newSubjectName = newSubjectObj ? newSubjectObj.subject_name : '';

      const currentSlotConflicts = lessons.filter(l => l.time_slot_id === activeSlotId);
      for (const conflict of currentSlotConflicts) {
         if (!canStackSubjects(conflict.subject_name, newSubjectName, gradeName)) {
            toast.error(`Slot already occupied by ${conflict.subject_name}.`);
            setIsSaving(false);
            return;
         }
      }
      
      if (isDoublePeriod && currentSlot) {
        const daySlots = slots.filter(s => s.day === currentSlot.day).sort((a, b) => a.start_time.localeCompare(b.start_time));
        nextSlot = daySlots[daySlots.findIndex(s => s.id === activeSlotId) + 1];
        
        if (!nextSlot || nextSlot.is_global) { 
          toast.error("No consecutive slot available."); setIsSaving(false); return; 
        }
        
        const nextSlotConflicts = lessons.filter(l => l.time_slot_id === nextSlot.id);
        for (const conflict of nextSlotConflicts) {
           if (!canStackSubjects(conflict.subject_name, newSubjectName, gradeName)) {
              toast.error(`Next slot occupied by ${conflict.subject_name}.`);
              setIsSaving(false);
              return;
           }
        }
      }

      const payload = { timetable_id: activeTimetable.id, class_stream_id: selectedClassId, subject_id: selectedSubject, teacher_id: selectedTeacher, is_double_period: isDoublePeriod };
      
      const res1 = await fetch('http://localhost:8000/api/timetable/save-lesson/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, time_slot_id: activeSlotId }) });
      const data1 = await res1.json();
      if (data1.status !== 'success') { toast.error(data1.message); setIsSaving(false); return; }

      if (isDoublePeriod && nextSlot) {
         const res2 = await fetch('http://localhost:8000/api/timetable/save-lesson/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, time_slot_id: nextSlot.id }) });
         const data2 = await res2.json();
         if (data2.status !== 'success') {
             toast.error(`Error on second period: ${data2.message}`);
         }
      }
      
      toast.success("Lesson locked in!");
      setActiveSlotId(null); setSelectedSubject(''); setSelectedTeacher(''); setIsDoublePeriod(false);
      fetchGridData(); 
    } catch (e) { toast.error("Network error."); } 
    finally { setIsSaving(false); }
  };

  if (loading) return <div className="p-8 text-slate-500 font-medium">Booting Timetable Engine...</div>;

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-6 flex flex-col h-[calc(100vh-80px)] animate-fade-in relative">
      <TimetableHeader 
        activeTimetable={activeTimetable} 
        classes={classes} 
        selectedClassId={selectedClassId} 
        setSelectedClassId={setSelectedClassId} 
        viewType={viewType} 
        setViewType={setViewType} 
        setShowSettings={setShowSettings} 
        handleAutoGenerate={handleAutoGenerate} 
        handleClearTimetable={() => setShowClearConfirm(true)} // <-- WIRED UP HERE
      />
      
      <div className="flex gap-6 flex-1 overflow-hidden min-h-0">
        <TimetableGrid viewType={viewType} slots={slots} lessons={lessons} classes={classes} selectedClassId={selectedClassId} setActiveSlotId={setActiveSlotId} setLessonToDelete={setLessonToDelete} setViewBlockLessons={setViewBlockLessons} />
        <TimetableBuckets buckets={buckets} />
      </div>

      {activeSlotId && (
        <AssignLessonModal setActiveSlotId={setActiveSlotId} buckets={buckets} teachers={teachers} selectedSubject={selectedSubject} setSelectedSubject={setSelectedSubject} selectedTeacher={selectedTeacher} setSelectedTeacher={setSelectedTeacher} isDoublePeriod={isDoublePeriod} setIsDoublePeriod={setIsDoublePeriod} handleSaveLesson={handleSaveLesson} isSaving={isSaving} />
      )}

      {viewBlockLessons && (
        <ViewBlockModal
          lessons={viewBlockLessons}
          gradeName={classes.find(c => c.id === selectedClassId)?.grade_name || ''}
          onClose={() => setViewBlockLessons(null)}
          onDeleteLesson={setLessonToDelete}
        />
      )}

      {/* --- EXISTING: Remove Lesson Modal --- */}
      {lessonToDelete && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-fade-in p-6 text-center space-y-4">
            <div className="w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-2"><Trash2 className="w-6 h-6" /></div>
            <h3 className="font-bold text-xl text-slate-800">Remove Lesson?</h3>
            <div className="flex gap-3 pt-4">
              <button onClick={() => setLessonToDelete(null)} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 rounded-lg font-bold hover:bg-slate-50">Cancel</button>
              <button onClick={confirmRemoveLesson} className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg font-bold hover:bg-red-700">Remove</button>
            </div>
          </div>
        </div>
      )}

      {/* --- NEW: Clear Grid Modal --- */}
      {showClearConfirm && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-fade-in p-6 text-center space-y-4">
            <div className="w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-2">
              <Trash2 className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-xl text-slate-800">Clear Entire Grid?</h3>
            <p className="text-sm text-slate-500">This will remove all scheduled lessons from the active timetable. This action cannot be undone.</p>
            <div className="flex gap-3 pt-4">
              <button onClick={() => setShowClearConfirm(false)} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 rounded-lg font-bold hover:bg-slate-50">Cancel</button>
              <button onClick={confirmClearGrid} className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg font-bold hover:bg-red-700">Clear Grid</button>
            </div>
          </div>
        </div>
      )}

      {showSettings && <TimetableSettings onClose={() => setShowSettings(false)} onRefreshTrigger={fetchInitialSetup} />}
    </div>
  );
}