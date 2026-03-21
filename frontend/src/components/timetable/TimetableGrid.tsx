import { Clock, Plus, Trash2, Eye } from 'lucide-react';
import type { ClassStream, Lesson, TimeSlot } from '../../libs/types';

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

const getSubjectColor = (subjectName: string) => {
  const colors = [
    'bg-blue-50 text-blue-700 border-blue-200', 'bg-purple-50 text-purple-700 border-purple-200',
    'bg-emerald-50 text-emerald-700 border-emerald-200', 'bg-amber-50 text-amber-700 border-amber-200',
    'bg-rose-50 text-rose-700 border-rose-200',
  ];
  return colors[subjectName.length % colors.length];
};

interface GridProps {
  viewType: 'Weekdays' | 'Weekends';
  slots: TimeSlot[];
  lessons: Lesson[];
  classes: ClassStream[];
  selectedClassId: number | null;
  setActiveSlotId: (id: number) => void;
  setLessonToDelete: (id: number) => void;
  setViewBlockLessons: (lessons: Lesson[]) => void;
}

export default function TimetableGrid({ viewType, slots, lessons, classes, selectedClassId, setActiveSlotId, setLessonToDelete, setViewBlockLessons }: GridProps) {
  const activeDays = viewType === 'Weekdays' ? ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] : ['Saturday', 'Sunday'];
  const gridColClass = viewType === 'Weekdays' ? "grid-cols-[90px_repeat(5,minmax(0,1fr))]" : "grid-cols-[90px_repeat(2,minmax(0,1fr))]";
  const uniqueTimes = Array.from(new Set(slots.filter(s => activeDays.includes(s.day)).map(s => `${s.start_time} - ${s.end_time}`))).sort();

  return (
    <div className="flex-1 bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-col overflow-hidden relative">
      <div className="flex-1 overflow-auto custom-scrollbar">
        <div className={`w-full flex flex-col ${viewType === 'Weekends' ? 'max-w-4xl' : ''}`}>
          
          <div className={`grid ${gridColClass} border-b border-slate-100 bg-slate-50 sticky top-0 z-50 shadow-sm`}>
            <div className="p-4 flex items-center justify-center border-r border-slate-100 bg-slate-50"><Clock className="w-5 h-5 text-slate-400" /></div>
            {activeDays.map(day => (
              <div key={day} className="p-4 text-center font-bold text-slate-700 text-sm uppercase tracking-wider border-r border-slate-100 bg-slate-50">{day}</div>
            ))}
          </div>

          <div className="flex-1">
            {uniqueTimes.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-slate-400">
                <Clock className="w-12 h-12 mb-3 text-slate-200" />
                <p className="font-medium">No slots for {viewType}.</p>
              </div>
            ) : (
              uniqueTimes.map((timeStr, rowIndex) => (
                <div key={timeStr} className={`grid ${gridColClass} border-b border-slate-100 group`} style={{ zIndex: 40 - rowIndex, position: 'relative' }}>
                  
                  <div className="p-4 text-xs font-bold text-slate-500 flex flex-col justify-center items-center text-center border-r border-slate-100 bg-slate-50/30">
                    <span>{timeStr.split(' - ')[0]}</span><span className="text-slate-300 font-normal">to</span><span>{timeStr.split(' - ')[1]}</span>
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

                    const slotLessons = lessons.filter(l => l.time_slot_id === slot.id);
                    const lesson = slotLessons[0];
                    
                    if (lesson) {
                      const currentClass = classes.find(c => c.id === selectedClassId);
                      const gradeName = currentClass ? currentClass.grade_name : '';
                      
                      const isTech = slotLessons.some(l => isTechSubject(l.subject_name, gradeName));
                      const isReligious = slotLessons.some(l => isRelSubject(l.subject_name));
                      const isHum = slotLessons.some(l => isHumSubject(l.subject_name, gradeName));
                      
                      const allowStacking = isTech || isReligious || isHum;
                      
                      const colors = isTech ? 'bg-slate-800 text-white border-slate-700' : getSubjectColor(lesson.subject_name);

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

                      if (isSecondHalf) return <div key={slot.id} className="p-2 border-r border-slate-100 relative"><div className="w-full min-h-[80px]"></div></div>;

                      // --- DYNAMIC BLOCK LABEL LOGIC ---
                      let blockLabel = '';
                      if (isTech) {
                        blockLabel = 'Technical Block';
                      } else if (isHum) {
                        blockLabel = 'Geo/Religious Block';
                      } else {
                        blockLabel = 'CRE/IRE Block';
                      }

                      return (
                        <div key={slot.id} className="p-2 border-r border-slate-100 relative">
                          {isFirstHalf && <div className="w-full min-h-[80px]"></div>}
                          <div 
                            className={`${isFirstHalf ? 'absolute top-2 left-2 right-2 z-20 shadow-lg' : 'w-full h-full min-h-[80px] relative'} rounded-xl border p-3 flex flex-col justify-between group/card hover:shadow-md min-w-0 transition-all ${colors}`}
                            style={isFirstHalf ? { height: 'calc(200% - 15px)' } : {}}
                          >
                            <div className="min-w-0 w-full flex-1 flex flex-col">
                              {/* --- GROUPED BLOCK DISPLAY --- */}
                              {slotLessons.length > 1 ? (
                                <>
                                  <div className="min-w-0">
                                    <p className="font-bold text-sm leading-tight break-words">{blockLabel} {isFirstHalf && '(Double)'}</p>
                                    <p className={`text-xs mt-1 font-medium truncate ${isTech ? 'text-slate-300' : 'opacity-80'}`}>{slotLessons.length} Subjects</p>
                                  </div>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setViewBlockLessons(slotLessons); }}
                                    title="View subjects"
                                    className={`absolute bottom-2 right-2 p-1.5 rounded-md transition-colors ${isTech ? 'hover:bg-slate-700 text-slate-300 hover:text-white' : 'hover:bg-white/50 text-slate-600'}`}
                                  >
                                    <Eye className="w-4 h-4" />
                                  </button>
                                </>
                              ) : (
                                <div className="min-w-0">
                                  <p className="font-bold text-sm leading-tight break-words">{lesson.subject_name} {isFirstHalf && '(Double)'}</p>
                                  <p className={`text-xs mt-1 font-medium truncate ${isTech ? 'text-slate-300' : 'opacity-80'}`}>{lesson.teacher_name}</p>
                                </div>
                              )}
                            </div>
                            
                            <div className="absolute top-2 right-2 flex gap-1 z-30 opacity-0 group-hover/card:opacity-100 transition-opacity">
                              {allowStacking && (
                                <button 
                                  onClick={(e) => { e.stopPropagation(); setActiveSlotId(slot.id); }} 
                                  title="Add concurrent subject" 
                                  className={`p-1.5 rounded-md text-white shadow-sm transition-colors ${isTech ? 'bg-slate-600 hover:bg-slate-500' : 'bg-blue-600 hover:bg-blue-500'}`}
                                >
                                  <Plus className="w-4 h-4" />
                                </button>
                              )}
                              {/* Global Trash button is only shown if there is just 1 subject in the slot */}
                              {slotLessons.length === 1 && (
                                <button 
                                  onClick={(e) => { e.stopPropagation(); setLessonToDelete(lesson.id); }} 
                                  title="Remove lesson" 
                                  className={`p-1.5 rounded-md transition-colors ${isTech ? 'bg-red-500 hover:bg-red-600 text-white shadow-sm' : 'bg-white hover:bg-red-50 text-red-500 shadow-sm border border-slate-200 hover:border-red-200'}`}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </div>

                          </div>
                        </div>
                      );
                    }

                    return (
                      <div key={slot.id} className={`p-2 border-r border-slate-100 cursor-pointer transition flex items-center justify-center min-h-[80px] ${slot.is_remedial ? 'bg-purple-50/30 hover:bg-purple-100/50' : 'hover:bg-blue-50/50'}`}>
                        <button onClick={(e) => { e.stopPropagation(); setActiveSlotId(slot.id); }} className="w-8 h-8 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-blue-100 hover:text-blue-600 shadow-sm">
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
  );
}