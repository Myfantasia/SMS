import { Settings, Wand2, Trash2, CheckCircle2 } from 'lucide-react';
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
}

export default function TimetableHeader({
  activeTimetable, classes, selectedClassId, setSelectedClassId,
  viewType, setViewType, setShowSettings, handleAutoGenerate, handleClearTimetable
}: HeaderProps) {
  return (
    <div className="flex justify-between items-center bg-white p-6 rounded-2xl shadow-sm border border-slate-200 shrink-0 flex-wrap gap-4 relative overflow-hidden">
      
      {/* --- NEW: Professional Enterprise Background Animation --- */}
      <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden rounded-2xl">
        {/* Soft gradient sweep anchoring the right side */}
        <div className="absolute top-0 right-0 w-2/3 h-full bg-gradient-to-l from-indigo-50/60 via-blue-50/20 to-transparent"></div>
        
        {/* Blueprint dot grid fading cleanly to the left */}
        <div className="absolute top-0 right-0 w-1/2 h-full opacity-50" 
             style={{ 
               backgroundImage: 'radial-gradient(#94a3b8 1.5px, transparent 1.5px)', 
               backgroundSize: '18px 18px',
               WebkitMaskImage: 'linear-gradient(to left, rgba(0,0,0,1) 10%, rgba(0,0,0,0) 90%)',
               maskImage: 'linear-gradient(to left, rgba(0,0,0,1) 10%, rgba(0,0,0,0) 90%)'
             }}>
        </div>

        {/* Slow-pulsing ambient floating orbs */}
        <div className="absolute -top-32 -right-16 w-80 h-80 bg-blue-400/10 rounded-full blur-3xl animate-[pulse_4s_ease-in-out_infinite]"></div>
        <div className="absolute -bottom-32 right-40 w-72 h-72 bg-indigo-400/10 rounded-full blur-3xl animate-[pulse_6s_ease-in-out_infinite_700ms]"></div>
      </div>

      {/* Left Section: Title & Filters */}
      <div className="flex flex-col gap-2 z-10">
        <h1 className="text-3xl font-black text-slate-800 tracking-tight">Schedule Builder</h1>
        <div className="flex items-center gap-4 flex-wrap">
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

          <div className="bg-slate-100 p-1 rounded-xl flex gap-1 border border-slate-200 shadow-inner">
            <button 
              onClick={() => setViewType('Weekdays')}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-black transition-all ${viewType === 'Weekdays' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400'}`}
            >WEEKDAYS</button>
            <button 
              onClick={() => setViewType('Weekends')}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-black transition-all ${viewType === 'Weekends' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400'}`}
            >WEEKENDS</button>
          </div>
        </div>
      </div>

      {/* Right Section: Button Toolbar */}
      <div className="flex items-center gap-4 flex-wrap z-10">
        
        {/* Utility Toolbar Group */}
        <div className="flex items-center gap-1 p-1.5 bg-white/60 backdrop-blur-md border border-slate-200/80 rounded-xl shadow-sm">
          <button 
            onClick={() => setShowSettings(true)} 
            className="px-3 py-2 text-slate-600 text-sm font-bold rounded-lg hover:bg-slate-100/80 hover:text-slate-900 transition flex items-center gap-2"
          >
            <Settings className="w-4 h-4" /> Config
          </button>
          
          <div className="w-px h-5 bg-slate-200 mx-1 hidden sm:block"></div> {/* Divider */}
          
          <button 
            onClick={handleAutoGenerate} 
            className="px-3 py-2 text-slate-600 text-sm font-bold rounded-lg hover:bg-slate-100/80 hover:text-indigo-600 transition flex items-center gap-2"
          >
            <Wand2 className="w-4 h-4 text-indigo-500" /> Auto-Generate
          </button>
          
          <div className="w-px h-5 bg-slate-200 mx-1 hidden sm:block"></div> {/* Divider */}

          <button 
            onClick={handleClearTimetable} 
            className="px-3 py-2 text-slate-600 text-sm font-bold rounded-lg hover:bg-red-50/80 hover:text-red-600 transition flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4 text-slate-400 hover:text-red-500 transition-colors" /> Clear Grid
          </button>
        </div>

        {/* Primary Action */}
        <button className="px-6 py-2.5 bg-blue-600 text-white text-sm font-bold rounded-xl shadow-md shadow-blue-600/20 hover:bg-blue-700 transition flex items-center gap-2 border border-blue-500">
          <CheckCircle2 className="w-4 h-4" /> Publish Timetable
        </button>

      </div>
      
    </div>
  );
}