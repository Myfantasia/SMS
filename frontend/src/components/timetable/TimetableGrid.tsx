import { Clock, Plus, Trash2, Eye, UserCheck, Info, Lock, Unlock } from 'lucide-react';
import type { ClassStream, DailyCoverEntry, Lesson, TimeSlot } from '../../libs/types';
import { getSubjectColor } from './subjectColors';

interface GridProps {
  viewType: 'Weekdays' | 'Weekends';
  slots: TimeSlot[];
  lessons: Lesson[];
  classes: ClassStream[];
  selectedClassId: number | null;
  setActiveSlotId: (id: number) => void;
  setLessonToDelete: (id: number) => void;
  setViewBlockLessons: (lessons: Lesson[]) => void;
  role?: string;
  onToggleLock?: (id: number) => void;

  // --- PHASE 5: DAILY REASSIGNMENT PARITY FLAGS ---
  isDailyCoverMode?: boolean;
  setCoverAllocationId?: (id: number) => void;
  dailyCovers?: DailyCoverEntry[];
}

export default function TimetableGrid({
  viewType, slots, lessons, classes, selectedClassId,
  setActiveSlotId, setLessonToDelete, setViewBlockLessons, role, onToggleLock,
  isDailyCoverMode = false, setCoverAllocationId, dailyCovers = []
}: GridProps) {
  const isAdmin = role === 'admin';
  const activeDays = viewType === 'Weekdays' ? ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] : ['Saturday', 'Sunday'];
  // minmax's lower bound must be a real pixel value, not 0 — 0 lets the grid tracks shrink
  // to fit any viewport, which is what made this squish unreadably on phone widths instead
  // of triggering the parent's overflow-auto to scroll horizontally (same pattern already
  // used correctly by the min-w-* columns in MasterTimetableView.tsx).
  const gridColClass = viewType === 'Weekdays' ? "grid-cols-[90px_repeat(5,minmax(150px,1fr))]" : "grid-cols-[90px_repeat(2,minmax(150px,1fr))]";
  const uniqueTimes = Array.from(new Set(slots.filter(s => activeDays.includes(s.day)).map(s => `${s.start_time} - ${s.end_time}`))).sort();

  return (
    <div className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm dark:shadow-none flex flex-col overflow-hidden relative">
      <div className="flex-1 overflow-auto custom-scrollbar">
        <div className={`w-full flex flex-col ${viewType === 'Weekends' ? 'max-w-4xl' : ''}`}>

          <div className={`grid ${gridColClass} border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 sticky top-0 z-50 shadow-sm dark:shadow-none`}>
            <div className="p-4 flex items-center justify-center border-r border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40"><Clock className="w-5 h-5 text-slate-400 dark:text-slate-500" /></div>
            {activeDays.map(day => (
              <div key={day} className="p-4 text-center font-bold text-slate-700 dark:text-slate-200 text-sm uppercase tracking-wider border-r border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40">{day}</div>
            ))}
          </div>

          <div className="flex-1">
            {uniqueTimes.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-slate-400 dark:text-slate-500">
                <Clock className="w-12 h-12 mb-3 text-slate-200 dark:text-slate-700" />
                <p className="font-medium">No slots for {viewType}.</p>
              </div>
            ) : (
              uniqueTimes.map((timeStr, rowIndex) => (
                <div key={timeStr} className={`grid ${gridColClass} border-b border-slate-100 dark:border-slate-700 group`} style={{ zIndex: 40 - rowIndex, position: 'relative' }}>

                  <div className="p-4 text-xs font-bold text-slate-500 dark:text-slate-400 flex flex-col justify-center items-center text-center border-r border-slate-100 dark:border-slate-700 bg-slate-50/30 dark:bg-slate-800/40">
                    <span>{timeStr.split(' - ')[0]}</span><span className="text-slate-300 dark:text-slate-600 font-normal">to</span><span>{timeStr.split(' - ')[1]}</span>
                  </div>

                  {activeDays.map(day => {
                    const slot = slots.find(s => s.day === day && `${s.start_time} - ${s.end_time}` === timeStr);
                    if (!slot) return <div key={day} className="p-2 border-r border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40"></div>;

                    if (slot.is_global) return (
                      <div key={slot.id} className="p-2 border-r border-slate-100 dark:border-slate-700 flex items-center justify-center">
                        <div className="w-full h-full min-h-15 bg-slate-100 dark:bg-slate-800 rounded-lg flex items-center justify-center text-slate-400 dark:text-slate-500 font-bold text-sm tracking-wide border border-dashed border-slate-300 dark:border-slate-600 p-2 text-center leading-tight wrap-break-word">
                          {slot.global_label}
                        </div>
                      </div>
                    );

                    const slotLessons = lessons.filter(l => l.time_slot_id === slot.id);
                    const lesson = slotLessons[0];
                    
                    if (lesson) {
                      // --- PURE RELATIONAL PARSING ENGINE ---
                      // We look strictly at whether the lesson template contains a database block index
                      const isOptionBlock = lesson.subject_block_id !== null && lesson.subject_block_id !== undefined;
                      const blockLabel = String(lesson.subject_block_name || 'Elective Option Block');
                      
                      // Stacking is permitted if the cell is predefined as an administrative Option Block container
                      const allowStacking = isOptionBlock;

                      // If a substitute has been assigned for this exact lesson on the selected date,
                      // surface it directly on the cell instead of silently keeping the absent teacher's name.
                      const activeCover = isDailyCoverMode
                        ? dailyCovers.find(c => c.target_lesson_id === lesson.id)
                        : undefined;

                      // Cover mode changes the layout background to amber to indicate override rules are active;
                      // once a substitute is actually assigned, switch to green so it reads as "resolved."
                      const colors = isDailyCoverMode
                        ? (activeCover
                            ? 'bg-emerald-50/60 dark:bg-emerald-500/10 text-emerald-900 dark:text-emerald-300 border-emerald-300 dark:border-emerald-500/40 shadow-inner'
                            : 'bg-amber-50/60 dark:bg-amber-500/10 text-amber-900 dark:text-amber-300 border-amber-300 dark:border-amber-500/40 shadow-inner')
                        : (isOptionBlock ? 'bg-slate-800 text-white border-slate-700' : getSubjectColor(lesson.subject_name));

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

                      if (isSecondHalf) return <div key={slot.id} className="p-2 border-r border-slate-100 dark:border-slate-700 relative"><div className="w-full min-h-20"></div></div>;

                      return (
                        <div key={slot.id} className="p-2 border-r border-slate-100 dark:border-slate-700 relative">
                          {isFirstHalf && <div className="w-full min-h-20"></div>}
                          <div 
                            className={`${isFirstHalf ? 'absolute top-2 left-2 right-2 z-20 shadow-lg' : 'w-full h-full min-h-20 relative'} rounded-xl border p-3 flex flex-col justify-between group/card hover:shadow-md min-w-0 transition-all ${colors}`}
                            style={isFirstHalf ? { height: 'calc(200% - 15px)' } : {}}
                          >
                            <div className="min-w-0 w-full flex-1 flex flex-col">
                              {slotLessons.length > 1 ? (
                                <>
                                  <div className="min-w-0">
                                    <p className="font-bold text-sm leading-tight wrap-break-word">{blockLabel} {isFirstHalf && '(Double)'}</p>
                                    <p className={`text-xs mt-1 font-medium truncate ${isOptionBlock && !isDailyCoverMode ? 'text-slate-300' : 'opacity-80'}`}>{slotLessons.length} Subjects</p>
                                  </div>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setViewBlockLessons(slotLessons); }}
                                    title="View subjects"
                                    aria-label={`View ${slotLessons.length} subjects in ${blockLabel}`}
                                    className={`absolute bottom-2 right-2 p-1.5 rounded-md transition-colors ${isOptionBlock && !isDailyCoverMode ? 'hover:bg-slate-700 text-slate-300 hover:text-white' : 'hover:bg-white/50 text-slate-600'}`}
                                  >
                                    <Eye className="w-4 h-4" />
                                  </button>
                                </>
                              ) : (
                                <div className="min-w-0">
                                  <p className="font-bold text-sm leading-tight wrap-break-word flex items-center gap-1">
                                    {lesson.is_locked && <Lock className="w-3 h-3 shrink-0" aria-label="Locked" />}
                                    {lesson.subject_name} {isFirstHalf && '(Double)'}
                                  </p>
                                  {activeCover ? (
                                    <p className="text-xs mt-1 font-medium truncate opacity-80">
                                      <span className="line-through opacity-60">{lesson.teacher_name}</span>
                                      {' → '}
                                      <span className="font-bold">{activeCover.covering_teacher_name}</span>
                                    </p>
                                  ) : (
                                    <p className={`text-xs mt-1 font-medium truncate ${isOptionBlock && !isDailyCoverMode ? 'text-slate-300' : 'opacity-80'}`}>{lesson.teacher_name}</p>
                                  )}
                                </div>
                              )}
                            </div>
                            
                            {/* --- PHASE 5: AD-HOC SUBSTITUTION COVER TRIGGER INTERCEPTOR --- */}
                            {isAdmin && (
                              <div className="absolute top-2 right-2 flex gap-1 z-30 opacity-0 group-hover/card:opacity-100 transition-opacity">
                                {isDailyCoverMode ? (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setCoverAllocationId?.(lesson.id); }}
                                    title={activeCover ? "Change substitute covering teacher" : "Assign substitute covering teacher"}
                                    aria-label={activeCover ? "Change substitute covering teacher" : "Assign substitute covering teacher"}
                                    className={`p-1.5 rounded-md text-white shadow-md animate-fade-in flex items-center justify-center ${activeCover ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-amber-600 hover:bg-amber-700'}`}
                                  >
                                    <UserCheck className="w-4 h-4" />
                                  </button>
                                ) : (
                                  <>
                                    {allowStacking && (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); setActiveSlotId(slot.id); }}
                                        title="Add concurrent subject"
                                        aria-label={`Add concurrent subject to ${blockLabel}`}
                                        className={`p-1.5 rounded-md text-white shadow-sm transition-colors ${isOptionBlock ? 'bg-slate-600 hover:bg-slate-500' : 'bg-blue-600 hover:bg-blue-500'}`}
                                      >
                                        <Plus className="w-4 h-4" />
                                      </button>
                                    )}
                                    {slotLessons.length === 1 && onToggleLock && (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); onToggleLock(lesson.id); }}
                                        title={lesson.is_locked ? "Unlock lesson (allow automation to move it)" : "Lock lesson (pin it against auto-generate/sync)"}
                                        aria-label={lesson.is_locked ? `Unlock ${lesson.subject_name} lesson` : `Lock ${lesson.subject_name} lesson`}
                                        className={`p-1.5 rounded-md transition-colors ${isOptionBlock ? 'bg-slate-600 hover:bg-slate-500 text-white shadow-sm dark:shadow-none' : 'bg-white dark:bg-slate-900 hover:bg-amber-50 dark:hover:bg-amber-500/10 text-amber-600 dark:text-amber-400 shadow-sm dark:shadow-none border border-slate-200 dark:border-slate-700'}`}
                                      >
                                        {lesson.is_locked ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                                      </button>
                                    )}
                                    {slotLessons.length === 1 && !lesson.is_locked && (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); setLessonToDelete(lesson.id); }}
                                        title="Remove lesson"
                                        aria-label={`Remove ${lesson.subject_name} lesson`}
                                        className={`p-1.5 rounded-md transition-colors ${isOptionBlock ? 'bg-red-500 hover:bg-red-600 text-white shadow-sm dark:shadow-none' : 'bg-white dark:bg-slate-900 hover:bg-red-50 dark:hover:bg-red-500/10 text-red-500 dark:text-red-400 shadow-sm dark:shadow-none border border-slate-200 dark:border-slate-700'}`}
                                      >
                                        <Trash2 className="w-4 h-4" />
                                      </button>
                                    )}
                                  </>
                                )}
                              </div>
                            )}

                          </div>
                        </div>
                      );
                    }

                    return (
                      <div key={slot.id} className={`p-2 border-r border-slate-100 dark:border-slate-700 transition flex items-center justify-center min-h-20 ${isAdmin && !isDailyCoverMode ? 'cursor-pointer' : ''} ${slot.is_remedial ? 'bg-purple-50/30 dark:bg-purple-500/10 hover:bg-purple-100/50 dark:hover:bg-purple-500/20' : 'hover:bg-blue-50/50 dark:hover:bg-blue-500/10'}`}>
                        {isAdmin && !isDailyCoverMode && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setActiveSlotId(slot.id); }}
                            title="Schedule a lesson in this slot"
                            aria-label={`Schedule a lesson on ${day} ${timeStr}`}
                            className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 focus-visible:ring-2 focus-visible:ring-blue-400 dark:focus-visible:ring-blue-400 outline-none transition-opacity hover:bg-blue-100 dark:hover:bg-blue-500/20 hover:text-blue-600 dark:hover:text-blue-400 shadow-sm dark:shadow-none"
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Legend — explains cell coloring/icons that aren't otherwise self-evident */}
      <div className="shrink-0 border-t border-slate-100 dark:border-slate-700 px-4 py-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 bg-slate-50/60 dark:bg-slate-800/40 text-[11px] font-medium text-slate-500 dark:text-slate-400">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-purple-100 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/40 shrink-0"></span> Remedial period</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-slate-800 shrink-0"></span> Elective option block</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-amber-100 dark:bg-amber-500/10 border border-amber-300 dark:border-amber-500/40 shrink-0"></span> Cover needed</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-100 dark:bg-emerald-500/10 border border-emerald-300 dark:border-emerald-500/40 shrink-0"></span> Cover assigned</span>
        <span className="flex items-center gap-1.5"><Lock className="w-3 h-3 shrink-0" /> Locked (pinned against auto-generate/sync)</span>
        {isAdmin && !isDailyCoverMode && (
          <span className="flex items-center gap-1.5 ml-auto text-slate-400 dark:text-slate-500">
            <Info className="w-3 h-3" /> Hover an empty slot and click <Plus className="w-3 h-3 inline" /> to schedule a lesson
          </span>
        )}
      </div>
    </div>
  );
}