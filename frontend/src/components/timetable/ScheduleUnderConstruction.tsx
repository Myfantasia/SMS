import { Hammer, Clock, ShieldAlert, Sparkles } from 'lucide-react';

interface UnderConstructionProps {
  termName?: string;
}

export default function ScheduleUnderConstruction({ termName }: UnderConstructionProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center animate-fade-in bg-slate-50/50 dark:bg-slate-800/40 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 min-h-112.5">
      <div className="relative mb-6">
        {/* Glow ring badge */}
        <div className="w-20 h-20 bg-amber-100/80 dark:bg-amber-500/10 rounded-3xl flex items-center justify-center border border-amber-200/60 dark:border-amber-500/40 shadow-inner relative z-10">
          <Hammer className="w-10 h-10 text-amber-600 dark:text-amber-400 animate-bounce" />
        </div>
        <div className="absolute -top-2 -right-2 w-8 h-8 bg-indigo-500 text-white rounded-full flex items-center justify-center shadow-md z-20">
          <Sparkles className="w-4 h-4" />
        </div>
      </div>

      <div className="max-w-md space-y-3">
        <span className="px-3 py-1 bg-amber-100 dark:bg-amber-500/10 text-amber-800 dark:text-amber-400 text-[10px] font-black uppercase tracking-wider rounded-md border border-amber-200 dark:border-amber-500/40 inline-flex items-center gap-1.5">
          <Clock className="w-3 h-3 text-amber-700 dark:text-amber-400" /> Draft Mode Active
        </span>

        <h2 className="text-2xl font-black text-slate-800 dark:text-slate-100 tracking-tight">
          Schedule Under Construction
        </h2>

        <p className="text-sm text-slate-500 dark:text-slate-400 font-medium leading-relaxed">
          The timetable schedule for <strong className="text-indigo-600 dark:text-indigo-400">{termName || "the active term"}</strong> is currently being compiled by school administration. Check back soon once the schedule is official.
        </p>
      </div>

      <div className="mt-8 pt-6 border-t border-slate-200/60 dark:border-slate-700/60 flex items-center gap-2 text-xs font-semibold text-slate-400 dark:text-slate-500">
        <ShieldAlert className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" />
        <span>Official schedules will appear here automatically upon publication.</span>
      </div>
    </div>
  );
}
