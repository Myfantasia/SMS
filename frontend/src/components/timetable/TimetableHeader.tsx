import { useState } from 'react';
import {
  Settings, Wand2, Trash2, CheckCircle2, Loader2, AlertTriangle,
  X, Calendar, UserX, Layers, Globe, EyeOff, LayoutGrid
} from 'lucide-react';
import type { ClassStream, Timetable } from '../../libs/types';

interface HeaderProps {
  activeTimetable: Timetable | null;
  classes: ClassStream[];
  selectedClassId: number | null;
  setSelectedClassId: (id: number) => void;
  viewType: 'Weekdays' | 'Weekends';
  setViewType: (view: 'Weekdays' | 'Weekends') => void;
  setShowSettings: (show: boolean) => void;
  handleAutoGenerate: () => void;
  handleClearTimetable: () => void; 
  role?: string;
  isEngineBusy: boolean;               
  unscheduledBasket: string[];         
  setUnscheduledBasket: (basket: string[]) => void;
  isDailyCoverMode: boolean;
  setIsDailyCoverMode: (mode: boolean) => void;
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  onOpenTeacherAvailability: () => void;
  onOpenMasterTimetable: () => void;

  // --- RESTORED: PUBLISH LIFECYCLE CONTROLS ---
  handlePublishLifecycleToggle: () => void;
  isProcessingPublish: boolean;
}

export default function TimetableHeader({
  activeTimetable, classes, selectedClassId, setSelectedClassId,
  viewType, setViewType, setShowSettings, handleAutoGenerate, handleClearTimetable,
  role, isEngineBusy, unscheduledBasket, setUnscheduledBasket,
  isDailyCoverMode, setIsDailyCoverMode, selectedDate, setSelectedDate,
  onOpenTeacherAvailability, onOpenMasterTimetable, handlePublishLifecycleToggle, isProcessingPublish
}: HeaderProps) {
  const isAdmin = role === 'admin';
  const [showBasketTray, setShowBasketTray] = useState(true);

  // Structural check: Locks generation/clearing controls if the timetable is live
  const isPublished = activeTimetable?.status === 'Published';

  return (
    <div className="flex flex-col gap-4 w-full shrink-0">
      {/* Primary Header Control Row */}
      <div className="flex justify-between items-center bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-sm dark:shadow-none border border-slate-200 dark:border-slate-700 shrink-0 flex-wrap gap-4 relative overflow-hidden">
        
        {/* --- RESTORED: PROFESSIONAL BACKGROUND GRAPHICS --- */}
        <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden rounded-2xl">
          <div className="absolute top-0 right-0 w-2/3 h-full bg-linear-to-l from-indigo-50/60 via-blue-50/20 to-transparent"></div>
          <div 
            className="absolute top-0 right-0 w-1/2 h-full opacity-50" 
            style={{ 
              backgroundImage: 'radial-gradient(#94a3b8 1.5px, transparent 1.5px)', 
              backgroundSize: '18px 18px',
              WebkitMaskImage: 'linear-gradient(to left, rgba(0,0,0,1) 10%, rgba(0,0,0,0) 90%)',
              maskImage: 'linear-gradient(to left, rgba(0,0,0,1) 10%, rgba(0,0,0,0) 90%)'
            }}
          ></div>
          <div className="absolute -top-32 -right-16 w-80 h-80 bg-blue-400/10 rounded-full blur-3xl animate-[pulse_4s_ease-in-out_infinite]"></div>
          <div className="absolute -bottom-32 right-40 w-72 h-72 bg-indigo-400/10 rounded-full blur-3xl animate-[pulse_6s_ease-in-out_infinite_700ms]"></div>
        </div>

        {/* Left Section: Title & Filters */}
        <div className="flex flex-col gap-2 z-10">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-black text-slate-800 dark:text-slate-100 tracking-tight">
              {isDailyCoverMode ? "Daily Cover Console" : "Schedule Viewer"}
            </h1>

            {/* Live Timetable Status Badge */}
            {activeTimetable && (
              <span className={`px-2 py-0.5 rounded-md text-[10px] font-black border uppercase tracking-wider flex items-center gap-1 shadow-xs mt-1 animate-fade-in ${
                isPublished
                  ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-500/40'
                  : 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/40'
              }`}>
                {isPublished ? <Globe className="w-3 h-3 text-blue-500 dark:text-blue-400" /> : <EyeOff className="w-3 h-3 text-amber-500 dark:text-amber-400" />}
                {activeTimetable.status || 'Draft'}
              </span>
            )}
          </div>

          <div className="flex items-center gap-4 flex-wrap">
            <p className="text-slate-500 dark:text-slate-400 font-medium whitespace-nowrap">
              Active Term: <span className="text-indigo-600 dark:text-indigo-400 font-bold">{activeTimetable?.name || "None Selected"}</span>
            </p>
            <select
              value={selectedClassId || ''}
              onChange={(e) => setSelectedClassId(Number(e.target.value))}
              disabled={isEngineBusy}
              className="border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-1.5 text-sm font-bold text-slate-700 dark:text-slate-200 outline-none focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-500/20 bg-slate-50 dark:bg-slate-800 shadow-sm dark:shadow-none disabled:opacity-60"
            >
              {classes.map(c => {
                const displayName = c.name.toLowerCase().includes(c.grade_name.toLowerCase())
                  ? c.name
                  : `${c.grade_name} ${c.name}`;

                return (
                  <option key={c.id} value={c.id}>
                    {displayName}
                  </option>
                );
              })}
            </select>

            <div className="bg-slate-100 dark:bg-slate-800 p-1 rounded-xl flex gap-1 border border-slate-200 dark:border-slate-700 shadow-inner">
              <button
                onClick={() => setViewType('Weekdays')}
                disabled={isEngineBusy}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-black transition-all ${viewType === 'Weekdays' ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-sm dark:shadow-none' : 'text-slate-400 dark:text-slate-500'}`}
              >
                WEEKDAYS
              </button>
              <button
                onClick={() => setViewType('Weekends')}
                disabled={isEngineBusy}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-black transition-all ${viewType === 'Weekends' ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-sm dark:shadow-none' : 'text-slate-400 dark:text-slate-500'}`}
              >
                WEEKENDS
              </button>
            </div>

            {/* --- REPOSITIONED: TEACHER AVAILABILITY BUTTON --- */}
            {isAdmin && (
              <button
                onClick={onOpenTeacherAvailability}
                disabled={isEngineBusy}
                className="px-3 py-1.5 bg-indigo-50 dark:bg-indigo-500/10 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 text-indigo-700 dark:text-indigo-400 border border-indigo-200/80 dark:border-indigo-500/40 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-xs hover:shadow-sm dark:hover:shadow-none disabled:opacity-50 cursor-pointer"
                title="Configure teacher off-days and blackout slots"
              >
                <UserX className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                <span>Availability</span>
              </button>
            )}

            {/* --- WHOLE-SCHOOL READ-ONLY VIEW: distinct from the "Master Template" edit-mode
                 toggle below, which only ever shows one class stream at a time --- */}
            <button
              onClick={onOpenMasterTimetable}
              disabled={isEngineBusy}
              className="px-3 py-1.5 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200/80 dark:border-slate-700 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-xs hover:shadow-sm dark:hover:shadow-none disabled:opacity-50 cursor-pointer"
              title="View every class stream's schedule at once"
            >
              <LayoutGrid className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300" />
              <span>Whole-School View</span>
            </button>

            {/* Contextual Date Selection Display */}
            {isDailyCoverMode && (
              <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/40 rounded-xl px-3 py-1.5 shadow-inner animate-fade-in z-10">
                <Calendar className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="bg-transparent text-xs font-bold text-amber-900 dark:text-amber-300 outline-none cursor-pointer"
                />
              </div>
            )}
          </div>
        </div>

        {/* Right Section: Button Toolbar */}
        {isAdmin && (
          <div className="flex items-center gap-4 flex-wrap z-10 animate-fade-in">
            
            {/* Workspace Operation Mode Toggle Switch */}
            <div className="bg-slate-100 dark:bg-slate-800 p-1 rounded-xl flex gap-1 border border-slate-200 dark:border-slate-700 shadow-inner mr-2">
              <button
                type="button"
                onClick={() => setIsDailyCoverMode(false)}
                title="Edit the recurring weekly schedule"
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${!isDailyCoverMode ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm dark:shadow-none' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'}`}
              >
                <Layers className="w-3.5 h-3.5" /> Master Template
              </button>
              <button
                type="button"
                onClick={() => setIsDailyCoverMode(true)}
                title="Assign one-off substitute teachers for a specific date, without touching the weekly template"
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${isDailyCoverMode ? 'bg-amber-600 text-white shadow-sm dark:shadow-none' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'}`}
              >
                <Calendar className="w-3.5 h-3.5" /> Substitution Cover
              </button>
            </div>

            {/* Render Administrative Management Tools when Master Mode is Active */}
            {!isDailyCoverMode ? (
              <div className="flex items-center gap-1 p-1.5 bg-white/60 dark:bg-slate-900/60 backdrop-blur-md border border-slate-200/80 dark:border-slate-700 rounded-xl shadow-sm dark:shadow-none animate-fade-in">
                <button
                  onClick={() => setShowSettings(true)}
                  disabled={isEngineBusy}
                  title="Configure terms, bell schedule, subject quotas, option blocks & workload policies"
                  className="px-3 py-2 text-slate-600 dark:text-slate-300 text-sm font-bold rounded-lg hover:bg-slate-100/80 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100 transition flex items-center gap-2"
                >
                  <Settings className="w-4 h-4" /> Config
                </button>

                <div className="w-px h-5 bg-slate-200 dark:bg-slate-700 mx-1 hidden sm:block"></div>

                {/* Auto-Generate Button (Disabled if Timetable is Live) */}
                <button
                  onClick={handleAutoGenerate}
                  disabled={isEngineBusy || !activeTimetable || isPublished}
                  className={`px-3 py-2 text-sm font-bold rounded-lg transition flex items-center gap-2 ${isEngineBusy ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-slate-800 hover:text-indigo-600 dark:hover:text-indigo-400'} disabled:opacity-40 disabled:cursor-not-allowed`}
                  title={isPublished ? "Grid locked. Revert to Draft state to activate automatic compiler configurations." : "Compile schedule entries"}
                >
                  {isEngineBusy ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-amber-600 dark:text-amber-400" />
                      <span>Engine Compiling...</span>
                    </>
                  ) : (
                    <>
                      <Wand2 className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
                      <span>Auto-Generate</span>
                    </>
                  )}
                </button>

                <div className="w-px h-5 bg-slate-200 dark:bg-slate-700 mx-1 hidden sm:block"></div>

                {/* Clear Grid Button (Disabled if Timetable is Live) */}
                <button
                  onClick={handleClearTimetable}
                  disabled={isEngineBusy || isPublished}
                  className="px-3 py-2 text-slate-600 dark:text-slate-300 text-sm font-bold rounded-lg hover:bg-red-50/80 dark:hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400 transition flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                  title={isPublished ? "Grid locked." : "Clear allocations"}
                >
                  <Trash2 className="w-4 h-4 text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400" /> Clear Grid
                </button>
              </div>
            ) : (
              <div className="px-4 py-2 bg-amber-100 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/40 text-amber-800 dark:text-amber-400 text-xs font-bold rounded-xl shadow-sm dark:shadow-none animate-fade-in">
                ⚡ Operational Mode: Date-Bound Overrides Active
              </div>
            )}

            {/* --- INTEGRATED: LIVE LIFECYCLE TRANSITION BUTTON --- */}
            {!isDailyCoverMode && activeTimetable && (
              <button
                type="button"
                disabled={isProcessingPublish || isEngineBusy}
                onClick={handlePublishLifecycleToggle}
                title={isPublished ? "Hide this schedule from teachers, students & parents again" : "Make this schedule visible to teachers, students & parents"}
                className={`px-6 py-2.5 text-white text-sm font-bold rounded-xl shadow-md transition flex items-center gap-2 border disabled:opacity-50 cursor-pointer ${
                  isPublished
                    ? 'bg-slate-700 hover:bg-slate-800 border-slate-600 shadow-slate-700/10'
                    : 'bg-blue-600 hover:bg-blue-700 border-blue-500 shadow-blue-600/20'
                }`}
              >
                {isProcessingPublish ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-4 h-4" />
                )}
                <span>{isPublished ? "Revert to Draft" : "Publish Timetable"}</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Unscheduled Basket Warnings Dashboard overlay tray */}
      {isAdmin && !isDailyCoverMode && unscheduledBasket.length > 0 && showBasketTray && (
        <div className="w-full bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/40 rounded-2xl p-5 shadow-sm dark:shadow-none animate-slide-in flex flex-col gap-3 z-10">
          <div className="flex justify-between items-center border-b border-amber-200 dark:border-amber-500/40 pb-2">
            <div className="flex items-center gap-2 text-amber-800 dark:text-amber-400">
              <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
              <h2 className="text-sm font-black uppercase tracking-wider">
                Generator Exception Log ({unscheduledBasket.length} items dropped)
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setUnscheduledBasket([])}
                className="text-xs font-bold text-amber-700 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-300 bg-white/60 dark:bg-slate-900/60 hover:bg-white dark:hover:bg-slate-900 border border-amber-300 dark:border-amber-500/40 rounded-md px-2 py-1 transition shadow-sm dark:shadow-none"
              >
                Clear Log
              </button>
              <button onClick={() => setShowBasketTray(false)} title="Dismiss" aria-label="Dismiss exception log" className="text-amber-400 dark:text-amber-500 hover:text-amber-600 dark:hover:text-amber-300 p-1">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="max-h-32 overflow-y-auto custom-scrollbar text-xs font-medium text-amber-900 dark:text-amber-300 space-y-1.5 pr-2">
            {unscheduledBasket.map((errorMsg, index) => (
              <div key={index} className="flex items-start gap-2 bg-white/40 dark:bg-slate-900/40 border border-amber-100/50 dark:border-amber-500/20 rounded-lg p-2 leading-tight">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5 shrink-0"></span>
                <p>{errorMsg}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}