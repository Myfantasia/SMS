import { Hammer, Clock, ShieldAlert, Sparkles } from 'lucide-react';

interface UnderConstructionProps {
  termName?: string;
}

export default function ScheduleUnderConstruction({ termName }: UnderConstructionProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center animate-fade-in bg-slate-50/50 rounded-2xl border border-dashed border-slate-200 min-h-112.5">
      <div className="relative mb-6">
        {/* Glow ring badge */}
        <div className="w-20 h-20 bg-amber-100/80 rounded-3xl flex items-center justify-center border border-amber-200/60 shadow-inner relative z-10">
          <Hammer className="w-10 h-10 text-amber-600 animate-bounce" />
        </div>
        <div className="absolute -top-2 -right-2 w-8 h-8 bg-indigo-500 text-white rounded-full flex items-center justify-center shadow-md z-20">
          <Sparkles className="w-4 h-4" />
        </div>
      </div>

      <div className="max-w-md space-y-3">
        <span className="px-3 py-1 bg-amber-100 text-amber-800 text-[10px] font-black uppercase tracking-wider rounded-md border border-amber-200 inline-flex items-center gap-1.5">
          <Clock className="w-3 h-3 text-amber-700" /> Draft Mode Active
        </span>

        <h2 className="text-2xl font-black text-slate-800 tracking-tight">
          Schedule Under Construction
        </h2>

        <p className="text-sm text-slate-500 font-medium leading-relaxed">
          The timetable schedule for <strong className="text-indigo-600">{termName || "the active term"}</strong> is currently being compiled by school administration. Check back soon once the schedule is official.
        </p>
      </div>

      <div className="mt-8 pt-6 border-t border-slate-200/60 flex items-center gap-2 text-xs font-semibold text-slate-400">
        <ShieldAlert className="w-4 h-4 text-slate-400 shrink-0" />
        <span>Official schedules will appear here automatically upon publication.</span>
      </div>
    </div>
  );
}