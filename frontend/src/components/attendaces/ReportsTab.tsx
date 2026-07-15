import { Calendar, Sparkles, Clock } from 'lucide-react';

export default function ReportsTab() {
  return (
    <div className="flex flex-col items-center justify-center text-center p-8 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200 min-h-100">
      <div className="relative mb-6">
        <div className="w-20 h-20 bg-blue-100/80 rounded-3xl flex items-center justify-center border border-blue-200/60 shadow-inner">
          <Calendar className="w-10 h-10 text-blue-600" />
        </div>
        <div className="absolute -top-2 -right-2 w-8 h-8 bg-indigo-500 text-white rounded-full flex items-center justify-center shadow-md">
          <Sparkles className="w-4 h-4" />
        </div>
      </div>
      <span className="px-3 py-1 bg-amber-100 text-amber-800 text-[10px] font-black uppercase tracking-wider rounded-md border border-amber-200 inline-flex items-center gap-1.5 mb-3">
        <Clock className="w-3 h-3" /> Coming Soon
      </span>
      <h3 className="text-2xl font-black text-slate-800 tracking-tight">Attendance Analytics</h3>
      <p className="text-slate-500 text-sm font-medium leading-relaxed max-w-md mt-2">
        Historical trend charts and downloadable reports are on the way. Today's live snapshot is already available under School Overview.
      </p>
    </div>
  );
}
