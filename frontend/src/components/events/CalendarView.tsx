import React, { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { SchoolEvent } from './EventsHub';


interface CalendarViewProps {
  events: SchoolEvent[];
  role: 'admin' | 'teacher' | 'student' | 'parent';
}

export default function CalendarView({ events, role }: CalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date());

  // --- DATE MATH LOGIC ---
  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth();

  // 1. Get the first day of the month (0 = Sunday, 1 = Monday, etc.)
  const firstDayOfMonth = new Date(currentYear, currentMonth, 1).getDay();

  // 2. Get total days in the current month
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

  // 3. Create arrays for rendering the grid
  const blanks = Array.from({ length: firstDayOfMonth }, (_, i) => i);
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  // --- NAVIGATION CONTROLS ---
  const prevMonth = () => setCurrentDate(new Date(currentYear, currentMonth - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(currentYear, currentMonth + 1, 1));
  const goToToday = () => setCurrentDate(new Date());

  // --- EVENT FILTERING ---
  const getEventsForDay = (day: number) => {
    return events.filter(event => {
      const eventDate = new Date(event.start_time);
      return (
        eventDate.getDate() === day &&
        eventDate.getMonth() === currentMonth &&
        eventDate.getFullYear() === currentYear
      );
    });
  };

  // --- STYLING HELPERS ---
  const getEventChipStyle = (type: string) => {
    switch (type) {
      case 'Exam': return 'bg-red-100 dark:bg-red-500/10 text-red-700 dark:text-red-400 border-red-200 dark:border-red-500/40';
      case 'Holiday': return 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/40';
      case 'Meeting': return 'bg-purple-100 dark:bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-500/40';
      case 'Sports': return 'bg-orange-100 dark:bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-500/40';
      default: return 'bg-blue-100 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-500/40';
    }
  };

  const isToday = (day: number) => {
    const today = new Date();
    return day === today.getDate() && currentMonth === today.getMonth() && currentYear === today.getFullYear();
  };

  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm dark:shadow-none border border-slate-200 dark:border-slate-700 overflow-hidden">

      {/* Calendar Header */}
      <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between bg-slate-50 dark:bg-slate-800/40">
        <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">
          {monthNames[currentMonth]} {currentYear}
        </h2>
        <div className="flex items-center gap-3">
          <button onClick={goToToday} className="px-3 py-1.5 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md transition-colors">
            Today
          </button>
          <div className="flex items-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden shadow-sm dark:shadow-none">
            <button onClick={prevMonth} className="p-2 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div className="w-px h-5 bg-slate-200 dark:bg-slate-700"></div>
            <button onClick={nextMonth} className="p-2 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="bg-slate-200 dark:bg-slate-700 gap-px grid grid-cols-7 border-b border-slate-200 dark:border-slate-700">
        {/* Days of the Week Header */}
        {weekDays.map(day => (
          <div key={day} className="bg-white dark:bg-slate-900 py-2 text-center text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            {day}
          </div>
        ))}

        {/* Empty Padding Cells */}
        {blanks.map(blank => (
          <div key={`blank-${blank}`} className="bg-slate-50/50 dark:bg-slate-800/40 min-h-30 p-2"></div>
        ))}

        {/* Actual Days */}
        {days.map(day => {
          const dayEvents = getEventsForDay(day);
          const todayHighlight = isToday(day);

          return (
            <div key={day} className="bg-white dark:bg-slate-900 min-h-30 p-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex flex-col group">

              {/* Day Number */}
              <div className="flex justify-between items-start mb-1">
                <span className={`text-sm font-semibold w-7 h-7 flex items-center justify-center rounded-full ${todayHighlight ? 'bg-blue-600 text-white shadow-md dark:shadow-none' : 'text-slate-700 dark:text-slate-200'}`}>
                  {day}
                </span>

                {/* Admin Quick-Add Hint (Only visible on hover) */}
                {role === 'admin' && (
                  <span className="opacity-0 group-hover:opacity-100 text-[10px] text-blue-500 dark:text-blue-400 font-semibold cursor-pointer">
                    + Add
                  </span>
                )}
              </div>

              {/* Event Chips */}
              <div className="flex-1 flex flex-col gap-1 mt-1 overflow-y-auto custom-scrollbar">
                {dayEvents.map(event => {
                  const timeStr = new Date(event.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  return (
                    <div
                      key={event.id}
                      title={`${event.title}\n${timeStr}`}
                      className={`px-1.5 py-1 text-[11px] leading-tight font-medium rounded border truncate cursor-default ${getEventChipStyle(event.event_type)} ${!event.is_active ? 'opacity-60 border-dashed' : ''}`}
                    >
                      <span className="font-bold mr-1">{timeStr}</span>
                      {event.title}
                    </div>
                  );
                })}
              </div>

            </div>
          );
        })}
      </div>
    </div>
  );
}
