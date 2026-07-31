import { useState, useEffect } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Trash2, Wand2 } from 'lucide-react';
import TimetableHeader from './TimetableHeader';
import TimetableBuckets from './TimetableBuckets';
import TimetableGrid from './TimetableGrid';
import AssignLessonModal from './AssignLessonModal';
import TimetableSettings from './TimetableSettings';
import ViewBlockModal from './ViewBlockModal'; 
import SubstituteModal from './SubstituteModal'; 
import type { Bucket, ClassStream, DailyCoverEntry, Lesson, Teacher, TimeSlot, Timetable } from '../../libs/types';
import api from '../../libs/axiosInstance';
import { pollJob } from '../../libs/pollJob';
import TeacherAvailabilityView from './TeacherAvailability';
import MasterTimetableView from './MasterTimetableView';
import ScheduleUnderConstruction from './ScheduleUnderConstruction';

export default function TimetableManager() {
  const { role } = useOutletContext<{ role: string }>();
  // Lets other pages (e.g. a class's "Manage Timetable" button) deep-link
  // straight to that class instead of always landing on the first one.
  const [searchParams] = useSearchParams();
  const preselectedClassId = searchParams.get('class');

  // View Mode Navigation State
  const [currentView, setCurrentView] = useState<'grid' | 'availability' | 'master'>('grid');

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
  
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearScope, setClearScope] = useState<'stream' | 'all'>('stream');

  const [showGenerateConfirm, setShowGenerateConfirm] = useState(false);
  const [generateScope, setGenerateScope] = useState<'class' | 'grade' | 'all'>('class');

  const [isEngineBusy, setIsEngineBusy] = useState(false);
  const [unscheduledBasket, setUnscheduledBasket] = useState<string[]>([]);

  const [isDailyCoverMode, setIsDailyCoverMode] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [coverAllocationId, setCoverAllocationId] = useState<number | null>(null);
  const [dailyCovers, setDailyCovers] = useState<DailyCoverEntry[]>([]);

  // Lifecycle Toggle State
  const [isProcessingPublish, setIsProcessingPublish] = useState(false);

  const isPublished = activeTimetable?.status === 'Published';

  const executeStatusUpdate = async (targetNextStatus: 'Draft' | 'Published') => {
    setIsProcessingPublish(true);
    const loadingToast = toast.loading(`Transitioning status to ${targetNextStatus}...`);

    try {
      const res = await api.post(`/api/timetable/update-status/${activeTimetable?.id}/`, {
        status: targetNextStatus,
        is_active: activeTimetable?.is_active
      });

      if (res.data.status === 'success') {
        toast.success(`Timetable status updated to ${targetNextStatus}!`, { id: loadingToast });
        setActiveTimetable(prev => prev ? { ...prev, status: targetNextStatus as 'Draft' | 'Published' } : null);
      } else {
        toast.error(res.data.message || "Failed to update status.", { id: loadingToast });
      }
    } catch (err) {
      console.error("Error updating timetable status:", err);
      toast.error("Network error updating status.", { id: loadingToast });
    } finally {
      setIsProcessingPublish(false);
    }
  };

  // Interactive Toast Trigger Replacing window.confirm
  const handlePublishLifecycleToggle = () => {
    if (!activeTimetable || isEngineBusy || isProcessingPublish) return;

    const targetNextStatus = isPublished ? 'Draft' : 'Published';
    const alertMessage = isPublished 
      ? "Revert this timetable back to Draft status? Public views will be hidden."
      : "Publish this schedule framework to go Live? Grid modifications and compilation tools will be locked.";

    // Renders a custom interactive confirmation card inside react-hot-toast
    toast((t) => (
      <div className="flex flex-col gap-3 font-sans text-left max-w-sm">
        <div>
          <p className="text-xs font-black uppercase tracking-wider text-slate-400 mb-1">
            Confirm Lifecycle Shift
          </p>
          <p className="text-xs font-medium text-slate-700 leading-relaxed">
            {alertMessage}
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-1 border-t border-slate-100">
          <button
            type="button"
            onClick={() => toast.dismiss(t.id)}
            className="px-3 py-1.5 text-xs font-bold text-slate-500 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              toast.dismiss(t.id);
              executeStatusUpdate(targetNextStatus);
            }}
            className={`px-3 py-1.5 text-xs font-bold text-white rounded-lg transition-colors cursor-pointer shadow-xs ${
              isPublished 
                ? 'bg-amber-600 hover:bg-amber-700' 
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            Confirm Transition
          </button>
        </div>
      </div>
    ), {
      duration: 8000,
      position: 'top-center',
      style: {
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        padding: '14px',
        borderRadius: '16px',
        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
      },
    });
  };

  const safeSetActiveSlotId = (id: number | null) => {
    if (isPublished) {
      toast.error("Grid is Published (Live). Revert to Draft mode to edit slots.");
      return;
    }
    if (role === 'admin' && !isEngineBusy && !isDailyCoverMode) setActiveSlotId(id);
  };

  const safeSetLessonToDelete = (id: number | null) => {
    if (isPublished) {
      toast.error("Grid is Published (Live). Revert to Draft mode to delete lessons.");
      return;
    }
    if (role === 'admin' && !isEngineBusy && !isDailyCoverMode) setLessonToDelete(id);
  };

  useEffect(() => {
    const fetchTeachers = async () => {
      try {
        const res = await api.get(`/api/timetable/teachers-by-subject/${selectedSubject}/`);
        const data = res.data;
        if (data.status === 'success') {
          setTeachers(data.data);
        } else {
          toast.error("Could not fetch teachers.");
        }
      } catch (error) {
        console.error("Error fetching teachers:", error);
        toast.error("Could not fetch teachers.");
      }
    };
    if (selectedSubject) fetchTeachers();
  }, [selectedSubject]);

  const fetchInitialSetup = async () => {
    try {
      const [termRes, classRes] = await Promise.all([
        api.get('/api/timetable/manage-containers/'),
        api.get('/api/manage-classes/')
      ]);
      
      const termData = termRes.data;
      const classData = classRes.data;
      
      if (termData.status === 'success') {
        setActiveTimetable(termData.data.find((t: Timetable) => t.is_active) || null);
      }
      
      if (classData.status === 'success') {
        const flatClasses: ClassStream[] = [];
        classData.data.forEach((grade: any) => {
          grade.streams.forEach((stream: any) => {
            flatClasses.push({ id: stream.id, name: stream.name, grade_name: grade.grade_name, grade_id: grade.grade_id });
          });
        });
        setClasses(flatClasses);
        if (flatClasses.length > 0 && !selectedClassId) {
          const deepLinked = preselectedClassId ? flatClasses.find((c) => c.id === Number(preselectedClassId)) : null;
          setSelectedClassId(deepLinked ? deepLinked.id : flatClasses[0].id);
        }
      }
    } catch (error) {
      console.error("Error fetching initial setup:", error);
      toast.error("Failed to load setup.");
    }
  };

  const fetchGridData = async () => {
    if (!selectedClassId || !activeTimetable) { setLoading(false); return; }
    setLoading(true);
    try {
      const [gridRes, bucketRes, lessonsRes] = await Promise.all([
        api.get('/api/timetable/grid/'),
        api.get(`/api/timetable/buckets/${selectedClassId}/${activeTimetable.id}/`),
        api.get(`/api/timetable/class-lessons/${selectedClassId}/${activeTimetable.id}/`)
      ]);
      
      const gridData = gridRes.data;
      const bucketData = bucketRes.data;
      const lessonsData = lessonsRes.data;
      
      if (gridData.status === 'success') setSlots(gridData.data);
      if (bucketData.status === 'success') setBuckets(bucketData.data);
      if (lessonsData.status === 'success') setLessons(lessonsData.data);
    } catch (error) { 
      console.error("Error fetching grid data:", error);
      toast.error("Failed to sync grid."); 
    } finally { 
      setLoading(false); 
    }
  };

  const fetchDailyCovers = async () => {
    if (!selectedClassId || !selectedDate) return;
    try {
      const res = await api.get(`/api/timetable/assign-daily-cover/?date=${selectedDate}&class_stream_id=${selectedClassId}`);
      if (res.data.status === 'success') setDailyCovers(res.data.data);
    } catch (error) {
      console.error("Error fetching daily covers:", error);
    }
  };

  const handleCancelCover = async (coverId: number) => {
    try {
      const res = await api.delete('/api/timetable/assign-daily-cover/', { data: { id: coverId } });
      if (res.data.status === 'success') {
        toast.success(res.data.message || "Cover cancelled.");
        fetchDailyCovers();
      } else {
        toast.error(res.data.message);
      }
    } catch (error) {
      console.error("Error cancelling cover:", error);
      toast.error("Failed to cancel cover.");
    }
  };

  useEffect(() => { fetchInitialSetup(); }, []);
  useEffect(() => { fetchGridData(); }, [selectedClassId, activeTimetable]);
  useEffect(() => {
    if (isDailyCoverMode) fetchDailyCovers();
  }, [isDailyCoverMode, selectedDate, selectedClassId]);

  const handleAutoGenerate = () => {
    if (role !== 'admin' || isEngineBusy || isPublished) return;
    if (!activeTimetable) {
      toast.error("Please ensure an active term is selected.");
      return;
    }
    if (!selectedClassId) {
      toast.error("Please select a class to generate a timetable for.");
      return;
    }
    setGenerateScope('class');
    setShowGenerateConfirm(true);
  };

  const confirmAutoGenerate = async () => {
    if (!activeTimetable || isEngineBusy || isPublished) return;
    setShowGenerateConfirm(false);

    const currentGradeId = classes.find((c) => c.id === selectedClassId)?.grade_id;
    const scopeParams = generateScope === 'class' && selectedClassId
      ? `stream_id=${selectedClassId}`
      : generateScope === 'grade' && currentGradeId
        ? `grade_id=${currentGradeId}`
        : 'scope=all';

    setIsEngineBusy(true);
    setUnscheduledBasket([]);
    const loadingToast = toast.loading("Scheduling algorithm compiling models...");

    try {
      const res = await api.post(`/api/timetable/auto-generate/${activeTimetable.id}/?${scopeParams}`);
      const data = res.data;

      if (res.status === 202 && data.job_id) {
        // The engine run itself now happens in a Celery worker (see school/tasks.py) —
        // poll until it finishes instead of getting the result inline.
        try {
          const result = await pollJob<{ message: string; unscheduled_basket?: string[] }>(data.job_id);
          toast.success(result.message, { id: loadingToast });
          if (result.unscheduled_basket && result.unscheduled_basket.length > 0) {
            setUnscheduledBasket(result.unscheduled_basket);
          }
          await fetchGridData();
        } catch (jobError: any) {
          toast.error(jobError.message || "Critical compilation abort.", { id: loadingToast });
        }
      } else if (data.status === 'success') {
        toast.success(data.message, { id: loadingToast });
        if (data.unscheduled_basket && data.unscheduled_basket.length > 0) {
          setUnscheduledBasket(data.unscheduled_basket);
        }
        await fetchGridData();
      } else {
        toast.error(data.message, { id: loadingToast });
      }
    } catch (error: any) {
      console.error("Error generating timetable:", error);
      if (error.response?.status === 423) {
        const structuralMsg = error.response?.data?.message || "Engine state locked. Compilation active in another window.";
        toast.error(structuralMsg, { id: loadingToast, duration: 6000 });
      } else {
        const errMsg = error.response?.data?.message || "Critical compilation abort.";
        toast.error(errMsg, { id: loadingToast });
      }
    } finally {
      setIsEngineBusy(false);
    }
  };

  const confirmClearGrid = async () => {
  if (!activeTimetable || isEngineBusy || isPublished) return;
  const loadingToast = toast.loading("Clearing allocations...");
  
  try {
    // If clearScope === 'stream', append ?stream_id=... to target only the selected stream
    const endpoint = (clearScope === 'stream' && selectedClassId)
      ? `/api/timetable/clear-grid/${activeTimetable.id}/?stream_id=${selectedClassId}`
      : `/api/timetable/clear-grid/${activeTimetable.id}/`;

    const res = await api.delete(endpoint);
    if (res.data.status === 'success') {
      toast.success(res.data.message, { id: loadingToast });
      fetchGridData(); // Refresh grid view
    } else {
      toast.error(res.data.message, { id: loadingToast });
    }
  } catch (error) {
    console.error("Error clearing grid:", error);
    toast.error("Failed to clear grid.", { id: loadingToast });
  } finally {
    setShowClearConfirm(false);
  }
};

  const confirmRemoveLesson = async () => {
    if (role !== 'admin' || !lessonToDelete || isEngineBusy || isPublished) return;
    try {
      const targetLesson = lessons.find(l => l.id === lessonToDelete);
      const isSharedBlockSubject = targetLesson && targetLesson.subject_block_id !== null && targetLesson.subject_block_id !== undefined;
      let twinId = null;
      
      if (targetLesson && targetLesson.is_double && !isSharedBlockSubject) {
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
      
      const res = await api.delete(`/api/timetable/remove-lesson/${lessonToDelete}/`);
      const data = res.data;
      
      if (data.status === 'success') {
        if (twinId) {
          await api.delete(`/api/timetable/remove-lesson/${twinId}/`);
        }
        toast.success(data.message || "Lesson returned to bucket.");
        fetchGridData(); 
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      console.error("Error removing lesson:", error);
      toast.error("Error removing lesson.");
    }
    setLessonToDelete(null);
  };

  // Pins/unpins a lesson against the auto-generator and the allocation-change sync engine —
  // doesn't alter what's scheduled, so (unlike add/remove) it's allowed even on a Published
  // timetable: locking is precisely how an admin protects a finalized placement.
  const handleToggleLock = async (lessonId: number) => {
    if (role !== 'admin' || isEngineBusy) return;
    try {
      const res = await api.post(`/api/timetable/toggle-lesson-lock/${lessonId}/`);
      if (res.data.status === 'success') {
        toast.success(res.data.is_locked ? "Lesson locked." : "Lesson unlocked.");
        fetchGridData();
      } else {
        toast.error(res.data.message || "Failed to toggle lock.");
      }
    } catch (error) {
      console.error("Error toggling lesson lock:", error);
      toast.error("Error toggling lesson lock.");
    }
  };

  // --- UPGRADED RELATIONAL INTEGRITY PLACEMENT ENGINE ---
  const handleSaveLesson = async (e: React.FormEvent) => {
    e.preventDefault();
    if (role !== 'admin' || !activeTimetable || !selectedClassId || !activeSlotId || isEngineBusy || isPublished) return;
    setIsSaving(true);
    
    try {
      const currentSlot = slots.find(s => s.id === activeSlotId);
      let nextSlot: TimeSlot | undefined = undefined; 

      const currentSlotConflicts = lessons.filter(l => l.time_slot_id === activeSlotId);
      
      if (currentSlotConflicts.length > 0) {
         const existingLesson = currentSlotConflicts[0];
         const isExistingBlock = existingLesson.subject_block_id !== null && existingLesson.subject_block_id !== undefined;
         
         if (!isExistingBlock) {
            toast.error(`Conflict Warning: Slot already fully occupied by standalone subject: ${existingLesson.subject_name}.`);
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
        if (nextSlotConflicts.length > 0) {
           const existingNextLesson = nextSlotConflicts[0];
           const isNextBlock = existingNextLesson.subject_block_id !== null && existingNextLesson.subject_block_id !== undefined;
           
           if (!isNextBlock) {
              toast.error(`Conflict Warning: Target trailing slot occupied by standalone subject: ${existingNextLesson.subject_name}.`);
              setIsSaving(false);
              return;
           }
        }
      }

      const payload = { timetable_id: activeTimetable.id, class_stream_id: selectedClassId, subject_id: selectedSubject, teacher_id: selectedTeacher, is_double_period: isDoublePeriod };
      const res1 = await api.post('/api/timetable/save-lesson/', { ...payload, time_slot_id: activeSlotId });
      const data1 = res1.data;
      
      if (data1.status !== 'success') { 
        toast.error(data1.message); 
        setIsSaving(false); 
        return; 
      }

      if (data1.warnings && data1.warnings.length > 0) {
        data1.warnings.forEach((warn: string) => {
          toast(warn, { icon: '⚠️', duration: 6000, style: { background: '#fffbeb', color: '#92400e', border: '1px solid #fde68a' } });
        });
      }

      if (isDoublePeriod && nextSlot) {
         const res2 = await api.post('/api/timetable/save-lesson/', { ...payload, time_slot_id: nextSlot.id });
         const data2 = res2.data;
         if (data2.status !== 'success') {
             toast.error(`Error on second period: ${data2.message}`);
         }
         
         if (data2.warnings && data2.warnings.length > 0) {
           data2.warnings.forEach((warn: string) => {
             toast(warn, { icon: '⚠️', duration: 6000, style: { background: '#fffbeb', color: '#92400e', border: '1px solid #fde68a' } });
           });
         }
      }
      
      toast.success("Lesson locked in!");
      setActiveSlotId(null); setSelectedSubject(''); setSelectedTeacher(''); setIsDoublePeriod(false);
      fetchGridData(); 
    } catch (error) { 
      toast.error("Network error.");
      console.error("Error saving lesson:", error);
    } finally { 
      setIsSaving(false); 
    }
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-16 bg-slate-200 rounded-2xl"></div>
        <div className="h-[60vh] bg-slate-200 rounded-2xl"></div>
      </div>
    );
  }

  // Render Full-Screen Availability Workspace when requested
  if (currentView === 'availability') {
    return (
      <TeacherAvailabilityView
        slots={slots}
        onBack={() => {
          setCurrentView('grid');
          fetchGridData();
        }}
      />
    );
  }

  // Render the read-only Whole-School (Master) Timetable view when requested
  if (currentView === 'master') {
    return (
      <MasterTimetableView
        activeTimetable={activeTimetable}
        slots={slots}
        onBack={() => setCurrentView('grid')}
      />
    );
  }

  return (
    <div className="p-6 max-w-400 mx-auto space-y-6 flex flex-col h-[calc(100vh-80px)] animate-fade-in relative">
      
      <TimetableHeader 
        activeTimetable={activeTimetable} 
        classes={classes} 
        selectedClassId={selectedClassId} 
        setSelectedClassId={setSelectedClassId} 
        viewType={viewType} 
        setViewType={setViewType} 
        setShowSettings={setShowSettings} 
        handleAutoGenerate={handleAutoGenerate} 
        handleClearTimetable={() => { setClearScope('stream'); setShowClearConfirm(true); }}
        role={role}
        isEngineBusy={isEngineBusy}
        unscheduledBasket={unscheduledBasket}
        setUnscheduledBasket={setUnscheduledBasket}
        isDailyCoverMode={isDailyCoverMode}
        setIsDailyCoverMode={setIsDailyCoverMode}
        selectedDate={selectedDate}
        setSelectedDate={setSelectedDate}
        onOpenTeacherAvailability={() => setCurrentView('availability')}
        onOpenMasterTimetable={() => setCurrentView('master')}
        handlePublishLifecycleToggle={handlePublishLifecycleToggle}
        isProcessingPublish={isProcessingPublish}
      />
      
      {/* --- PHASE 9: CONSUMER VIEW GUARD --- */}
      {role !== 'admin' && !isPublished ? (
        <ScheduleUnderConstruction termName={activeTimetable?.name} />
      ) : (
        <div className="flex gap-6 flex-1 overflow-hidden min-h-0">
          <TimetableGrid
            viewType={viewType}
            slots={slots}
            lessons={lessons}
            classes={classes}
            selectedClassId={selectedClassId}
            setActiveSlotId={safeSetActiveSlotId}
            setLessonToDelete={safeSetLessonToDelete}
            setViewBlockLessons={setViewBlockLessons}
            role={role}
            onToggleLock={handleToggleLock}
            isDailyCoverMode={isDailyCoverMode}
            setCoverAllocationId={setCoverAllocationId}
            dailyCovers={dailyCovers}
          />

          {role === 'admin' && !isDailyCoverMode && <TimetableBuckets buckets={buckets} />}

          {role === 'admin' && isDailyCoverMode && (
            <div className="w-80 bg-amber-50/40 border border-amber-200 p-4 rounded-2xl shadow-sm h-full flex flex-col gap-3 animate-fade-in">
              <h3 className="font-bold text-sm text-amber-900 tracking-tight uppercase border-b border-amber-200 pb-2">
                Date Adjustments ledger
              </h3>
              <p className="text-xs font-semibold text-amber-700/80 leading-relaxed">
                Click any active cell badge icon on the calendar grid to register a single-day teacher absence.
              </p>
              <div className="flex-1 overflow-y-auto space-y-2">
                {dailyCovers.length === 0 ? (
                  <div className="h-full bg-white/50 border border-dashed border-amber-200 rounded-xl p-3 flex flex-col items-center justify-center text-center text-slate-400 text-xs">
                    No covers assigned for {selectedDate} yet.
                  </div>
                ) : (
                  dailyCovers.map(cover => (
                    <div key={cover.id} className="bg-white border border-amber-200 rounded-lg p-3 text-xs space-y-1 shadow-sm">
                      <div className="flex justify-between items-start gap-2">
                        <span className="font-bold text-slate-800">{cover.subject_name}</span>
                        <button
                          onClick={() => handleCancelCover(cover.id)}
                          className="text-red-500 hover:text-red-700 font-bold shrink-0"
                          title="Cancel this cover"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <p className="text-slate-500">
                        <span className="text-red-600 font-semibold">{cover.absent_teacher_name}</span>
                        {' → '}
                        <span className="text-emerald-600 font-semibold">{cover.covering_teacher_name}</span>
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {activeSlotId && (
        <AssignLessonModal setActiveSlotId={setActiveSlotId} buckets={buckets} teachers={teachers} selectedSubject={selectedSubject} setSelectedSubject={setSelectedSubject} selectedTeacher={selectedTeacher} setSelectedTeacher={setSelectedTeacher} isDoublePeriod={isDoublePeriod} setIsDoublePeriod={setIsDoublePeriod} handleSaveLesson={handleSaveLesson} isSaving={isSaving} />
      )}

      {coverAllocationId && (
        <SubstituteModal 
          allocationId={coverAllocationId}
          targetDate={selectedDate}
          onClose={() => setCoverAllocationId(null)}
          onSuccess={() => { setCoverAllocationId(null); fetchDailyCovers(); }}
          lessons={lessons}
        />
      )}

      {viewBlockLessons && (
        <ViewBlockModal
          lessons={viewBlockLessons}
          gradeName={classes.find(c => c.id === selectedClassId)?.grade_name || ''}
          onClose={() => setViewBlockLessons(null)}
          onDeleteLesson={safeSetLessonToDelete}
        />
      )}

      {lessonToDelete && (() => {
        const target = lessons.find(l => l.id === lessonToDelete);
        return (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-70 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-fade-in p-6 text-center space-y-4">
              <div className="w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-2"><Trash2 className="w-6 h-6" /></div>
              <h3 className="font-bold text-xl text-slate-800">Remove Lesson?</h3>
              {target && (
                <p className="text-sm text-slate-500">
                  <span className="font-bold text-slate-700">{target.subject_name}</span> with {target.teacher_name} will be unscheduled and returned to the bucket.
                </p>
              )}
              <div className="flex gap-3 pt-4">
                <button onClick={() => setLessonToDelete(null)} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 rounded-lg font-bold hover:bg-slate-50">Cancel</button>
                <button onClick={confirmRemoveLesson} className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg font-bold hover:bg-red-700">Remove</button>
              </div>
            </div>
          </div>
        );
      })()}

      {showClearConfirm && (() => {
        const currentClass = classes.find(c => c.id === selectedClassId);
        const currentClassLabel = currentClass
          ? (currentClass.name.toLowerCase().includes(currentClass.grade_name.toLowerCase()) ? currentClass.name : `${currentClass.grade_name} ${currentClass.name}`)
          : 'the selected class';
        return (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-70 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-fade-in p-6 text-center space-y-4">
              <div className="w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-2">
                <Trash2 className="w-6 h-6" />
              </div>
              <h3 className="font-bold text-xl text-slate-800">Clear Schedule?</h3>

              {/* Scope selector — `clearScope` used to be dead state with no way to set it,
                  so "Clear Entire Grid?" always meant just the current stream regardless
                  of what the copy implied. Now the choice is explicit. */}
              <div className="flex flex-col gap-2 text-left">
                <label className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors ${clearScope === 'stream' ? 'border-red-300 bg-red-50/60' : 'border-slate-200 hover:bg-slate-50'}`}>
                  <input type="radio" name="clear-scope" className="mt-1" checked={clearScope === 'stream'} onChange={() => setClearScope('stream')} />
                  <span>
                    <span className="block text-sm font-bold text-slate-800">Just {currentClassLabel}</span>
                    <span className="block text-xs text-slate-500">Removes lessons for this class only. Other classes are untouched.</span>
                  </span>
                </label>
                <label className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors ${clearScope === 'all' ? 'border-red-300 bg-red-50/60' : 'border-slate-200 hover:bg-slate-50'}`}>
                  <input type="radio" name="clear-scope" className="mt-1" checked={clearScope === 'all'} onChange={() => setClearScope('all')} />
                  <span>
                    <span className="block text-sm font-bold text-slate-800">The entire school</span>
                    <span className="block text-xs text-slate-500">Removes every scheduled lesson for every class in this term. Cannot be undone.</span>
                  </span>
                </label>
              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={() => setShowClearConfirm(false)} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 rounded-lg font-bold hover:bg-slate-50">Cancel</button>
                <button onClick={confirmClearGrid} className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg font-bold hover:bg-red-700">
                  {clearScope === 'all' ? 'Clear Entire School' : `Clear ${currentClassLabel}`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {showGenerateConfirm && (() => {
        const currentClass = classes.find(c => c.id === selectedClassId);
        const currentClassLabel = currentClass
          ? (currentClass.name.toLowerCase().includes(currentClass.grade_name.toLowerCase()) ? currentClass.name : `${currentClass.grade_name} ${currentClass.name}`)
          : 'the selected class';
        const currentGradeName = currentClass?.grade_name ?? 'this grade';
        return (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-70 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-fade-in p-6 text-center space-y-4">
              <div className="w-12 h-12 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-2">
                <Wand2 className="w-6 h-6" />
              </div>
              <h3 className="font-bold text-xl text-slate-800">Auto-Generate Timetable</h3>

              {/* Same explicit scope pattern as Clear Grid above — Auto-Generate can run for
                  just the selected class, every stream in its grade, or the whole school. */}
              <div className="flex flex-col gap-2 text-left">
                <label className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors ${generateScope === 'class' ? 'border-indigo-300 bg-indigo-50/60' : 'border-slate-200 hover:bg-slate-50'}`}>
                  <input type="radio" name="generate-scope" className="mt-1" checked={generateScope === 'class'} onChange={() => setGenerateScope('class')} />
                  <span>
                    <span className="block text-sm font-bold text-slate-800">Just {currentClassLabel}</span>
                    <span className="block text-xs text-slate-500">Generates lessons for this class only. Other classes are untouched.</span>
                  </span>
                </label>
                <label className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors ${generateScope === 'grade' ? 'border-indigo-300 bg-indigo-50/60' : 'border-slate-200 hover:bg-slate-50'}`}>
                  <input type="radio" name="generate-scope" className="mt-1" checked={generateScope === 'grade'} onChange={() => setGenerateScope('grade')} />
                  <span>
                    <span className="block text-sm font-bold text-slate-800">All of {currentGradeName}</span>
                    <span className="block text-xs text-slate-500">Generates every stream in this grade in one run.</span>
                  </span>
                </label>
                <label className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors ${generateScope === 'all' ? 'border-indigo-300 bg-indigo-50/60' : 'border-slate-200 hover:bg-slate-50'}`}>
                  <input type="radio" name="generate-scope" className="mt-1" checked={generateScope === 'all'} onChange={() => setGenerateScope('all')} />
                  <span>
                    <span className="block text-sm font-bold text-slate-800">The entire school</span>
                    <span className="block text-xs text-slate-500">Generates every class in this term. Locked lessons are always left untouched.</span>
                  </span>
                </label>
              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={() => setShowGenerateConfirm(false)} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 rounded-lg font-bold hover:bg-slate-50">Cancel</button>
                <button onClick={confirmAutoGenerate} className="flex-1 px-4 py-2.5 bg-indigo-600 text-white rounded-lg font-bold hover:bg-indigo-700">
                  {generateScope === 'all' ? 'Generate Whole School' : generateScope === 'grade' ? `Generate ${currentGradeName}` : `Generate ${currentClassLabel}`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {showSettings && <TimetableSettings onClose={() => setShowSettings(false)} onRefreshTrigger={fetchInitialSetup} />}
    </div>
  );
}