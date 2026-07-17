import { useState, useEffect, useMemo } from 'react';
import { ArrowLeft, Search, LayoutGrid, X, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import type { TimeSlot, Timetable } from '../../libs/types';
import api from '../../libs/axiosInstance';
import { getSubjectColor } from './subjectColors';

interface MasterStream {
  id: number;
  name: string;
  grade_id: number;
  grade_name: string;
}

interface MasterLesson {
  id: number;
  time_slot_id: number;
  class_stream_id: number;
  subject_name: string;
  teacher_name: string;
  is_double: boolean;
}

interface MasterTimetableViewProps {
  activeTimetable: Timetable | null;
  slots: TimeSlot[];
  onBack: () => void;
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export default function MasterTimetableView({ activeTimetable, slots, onBack }: MasterTimetableViewProps) {
  const [streams, setStreams] = useState<MasterStream[]>([]);
  const [lessons, setLessons] = useState<MasterLesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [streamSearch, setStreamSearch] = useState('');
  const [activeDay, setActiveDay] = useState<string>('Monday');

  useEffect(() => {
    const fetchMaster = async () => {
      if (!activeTimetable) { setLoading(false); return; }
      setLoading(true);
      try {
        const res = await api.get(`/api/timetable/master/${activeTimetable.id}/`);
        if (res.data.status === 'success') {
          setStreams(res.data.data.streams);
          setLessons(res.data.data.lessons);
        } else {
          toast.error(res.data.message || "Failed to load the whole-school view.");
        }
      } catch (error) {
        console.error("Error fetching master timetable:", error);
        toast.error("Network error loading the whole-school view.");
      } finally {
        setLoading(false);
      }
    };
    fetchMaster();
  }, [activeTimetable]);

  // Days that actually have configured slots, so we don't show empty tabs for e.g. weekends
  // when the school only runs Mon-Fri.
  const daysWithSlots = useMemo(
    () => DAYS.filter(d => slots.some(s => s.day === d)),
    [slots]
  );

  useEffect(() => {
    if (daysWithSlots.length > 0 && !daysWithSlots.includes(activeDay)) {
      setActiveDay(daysWithSlots[0]);
    }
  }, [daysWithSlots, activeDay]);

  const filteredStreams = useMemo(() => {
    const q = streamSearch.trim().toLowerCase();
    if (!q) return streams;
    return streams.filter(s => s.name.toLowerCase().includes(q) || s.grade_name.toLowerCase().includes(q));
  }, [streams, streamSearch]);

  // Group filtered streams by grade, preserving backend order (grade numeric_order, then name),
  // so the header can render a grade-spanning row above the individual stream columns.
  const gradeGroups = useMemo(() => {
    const groups: { grade_id: number; grade_name: string; streams: MasterStream[] }[] = [];
    for (const s of filteredStreams) {
      const last = groups[groups.length - 1];
      if (last && last.grade_id === s.grade_id) {
        last.streams.push(s);
      } else {
        groups.push({ grade_id: s.grade_id, grade_name: s.grade_name, streams: [s] });
      }
    }
    return groups;
  }, [filteredStreams]);

  const daySlots = useMemo(
    () => slots.filter(s => s.day === activeDay).sort((a, b) => a.start_time.localeCompare(b.start_time)),
    [slots, activeDay]
  );
  const uniqueTimes = useMemo(
    () => Array.from(new Set(daySlots.map(s => `${s.start_time} - ${s.end_time}`))),
    [daySlots]
  );

  // (stream_id, time_slot_id) -> lessons in that cell, since option blocks can stack more than one
  const lessonsByCell = useMemo(() => {
    const map = new Map<string, MasterLesson[]>();
    for (const l of lessons) {
      const key = `${l.class_stream_id}_${l.time_slot_id}`;
      const list = map.get(key) || [];
      list.push(l);
      map.set(key, list);
    }
    return map;
  }, [lessons]);

  const totalColumns = filteredStreams.length;

  if (loading) {
    return (
      <div className="p-6 max-w-full mx-auto space-y-4 animate-pulse">
        <div className="h-24 bg-slate-200 rounded-2xl"></div>
        <div className="h-125 bg-slate-200 rounded-2xl"></div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-full mx-auto space-y-4 animate-fade-in">

      {/* Header */}
      <div className="flex flex-wrap justify-between items-center gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition font-bold flex items-center gap-2 text-sm"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Schedule
          </button>
          <div>
            <h1 className="text-2xl font-black text-slate-800 tracking-tight flex items-center gap-2">
              <LayoutGrid className="w-5 h-5 text-slate-500" /> Whole-School Timetable
            </h1>
            <p className="text-xs text-slate-500 font-medium flex items-center gap-1.5 flex-wrap">
              Every class stream's schedule for {activeTimetable?.name || 'the active term'}, side by side. Read-only.
              {streams.length > 0 && (
                <span className="inline-flex items-center gap-1 text-slate-400 font-bold">
                  &middot; <Users className="w-3 h-3" /> {streams.length} stream{streams.length !== 1 ? 's' : ''} across {new Set(streams.map(s => s.grade_id)).size} grade{new Set(streams.map(s => s.grade_id)).size !== 1 ? 's' : ''}
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="relative w-64">
          <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
          <input
            type="text"
            placeholder="Filter by stream or grade..."
            value={streamSearch}
            onChange={(e) => setStreamSearch(e.target.value)}
            className="w-full border border-slate-300 rounded-lg pl-9 pr-8 py-2 text-sm bg-slate-50 outline-none focus:border-indigo-500 font-medium text-slate-700"
          />
          {streamSearch && (
            <button
              onClick={() => setStreamSearch('')}
              title="Clear filter"
              aria-label="Clear filter"
              className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Day Tabs */}
      <div className="bg-slate-100 p-1 rounded-xl flex gap-1 border border-slate-200 shadow-inner w-fit">
        {daysWithSlots.map(day => (
          <button
            key={day}
            onClick={() => setActiveDay(day)}
            className={`px-4 py-1.5 rounded-lg text-xs font-black transition-all ${activeDay === day ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
          >
            {day.slice(0, 3).toUpperCase()}
          </button>
        ))}
      </div>

      {/* Grid */}
      {filteredStreams.length === 0 ? (
        <div className="border border-dashed border-slate-200 rounded-2xl p-16 text-center text-slate-400 bg-white">
          No streams match "{streamSearch}".
        </div>
      ) : uniqueTimes.length === 0 ? (
        <div className="border border-dashed border-slate-200 rounded-2xl p-16 text-center text-slate-400 bg-white">
          No time slots configured for {activeDay}.
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-auto custom-scrollbar max-h-[calc(100vh-280px)]">
          <table className="border-collapse text-xs w-full">
            <thead className="sticky top-0 z-20">
              <tr>
                <th rowSpan={2} className="sticky left-0 z-30 bg-slate-100 border-r border-b border-slate-200 p-2 min-w-25 text-slate-500 font-black uppercase">Period</th>
                {gradeGroups.map(g => (
                  <th key={g.grade_id} colSpan={g.streams.length} className="bg-slate-100 border-b border-r border-slate-200 p-2 text-slate-700 font-black uppercase tracking-wide text-center whitespace-nowrap">
                    {g.grade_name}
                  </th>
                ))}
              </tr>
              <tr>
                {filteredStreams.map(s => (
                  <th key={s.id} className="bg-slate-50 border-b border-r border-slate-200 p-2 text-slate-600 font-bold text-center whitespace-nowrap min-w-30">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {uniqueTimes.map(timeStr => {
                const slot = daySlots.find(s => `${s.start_time} - ${s.end_time}` === timeStr);
                if (!slot) return null;

                if (slot.is_global) {
                  return (
                    <tr key={timeStr}>
                      <td className="sticky left-0 z-10 bg-slate-50 border-r border-b border-slate-200 p-2 text-center font-mono font-bold text-slate-500 whitespace-nowrap">
                        {timeStr}
                      </td>
                      <td colSpan={totalColumns} className="border-b border-slate-200 bg-slate-100 text-center font-bold text-slate-400 uppercase tracking-wider p-2">
                        {slot.global_label}
                      </td>
                    </tr>
                  );
                }

                return (
                  <tr key={timeStr} className={slot.is_remedial ? 'bg-purple-50/30' : ''}>
                    <td className="sticky left-0 z-10 bg-white border-r border-b border-slate-200 p-2 text-center font-mono font-bold text-slate-500 whitespace-nowrap">
                      {timeStr}
                    </td>
                    {filteredStreams.map(stream => {
                      const cellLessons = lessonsByCell.get(`${stream.id}_${slot.id}`) || [];
                      return (
                        <td key={stream.id} className="border-r border-b border-slate-100 p-1.5 align-top min-w-30">
                          {cellLessons.length === 0 ? (
                            <div className="h-full min-h-8"></div>
                          ) : cellLessons.length === 1 ? (
                            <div className={`rounded-md border p-1.5 leading-tight ${getSubjectColor(cellLessons[0].subject_name)}`}>
                              <p className="font-bold truncate">{cellLessons[0].subject_name}{cellLessons[0].is_double ? ' (Dbl)' : ''}</p>
                              <p className="opacity-70 truncate">{cellLessons[0].teacher_name}</p>
                            </div>
                          ) : (
                            <div className="bg-slate-800 text-white rounded-md p-1.5 leading-tight">
                              <p className="font-bold truncate">{cellLessons.length} Subjects</p>
                              <p className="text-slate-300 truncate">{cellLessons.map(l => l.subject_name).join(', ')}</p>
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      {filteredStreams.length > 0 && uniqueTimes.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-2 text-[11px] font-medium text-slate-500">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-purple-100 border border-purple-200 shrink-0"></span> Remedial period</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-slate-800 shrink-0"></span> Multiple subjects (option block)</span>
          <span className="text-slate-400">Cell colors match a subject across every stream</span>
        </div>
      )}
    </div>
  );
}
