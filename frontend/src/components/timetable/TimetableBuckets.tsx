import { BookOpen } from 'lucide-react';
import type { Bucket } from '../../libs/types';


export default function TimetableBuckets({ buckets }: { buckets: Bucket[] }) {
  return (
    <div className="w-[260px] bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm dark:shadow-none p-5 flex flex-col shrink-0">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-9 h-9 bg-indigo-100 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded-xl flex items-center justify-center shrink-0"><BookOpen className="w-4 h-4" /></div>
        <div>
          <h2 className="text-base font-bold text-slate-800 dark:text-slate-100 leading-tight">Subject Quotas</h2>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">Unassigned lessons</p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 custom-scrollbar">
        {buckets.length === 0 ? (
          <div className="text-sm text-slate-500 dark:text-slate-400 text-center mt-8">
            <p className="font-medium">No quotas configured.</p>
          </div>
        ) : (
          buckets.map(bucket => (
            <div key={bucket.subject_id} className={`p-3 rounded-xl border transition-all ${bucket.remaining === 0 ? 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 opacity-60' : 'bg-white dark:bg-slate-900 border-indigo-100 dark:border-indigo-500/20 shadow-sm dark:shadow-none hover:border-indigo-300 dark:hover:border-indigo-500/40'}`}>
              <div className="flex justify-between items-start mb-2 gap-2">
                <span className="font-bold text-slate-700 dark:text-slate-200 text-sm break-words leading-tight">{bucket.subject_name}</span>
                <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-md whitespace-nowrap ${bucket.remaining === 0 ? 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-indigo-100 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-400'}`}>{bucket.remaining} Left</span>
              </div>
              <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 mt-2 overflow-hidden">
                <div
                  className={`h-full rounded-full ${bucket.remaining === 0 ? 'bg-emerald-500' : 'bg-indigo-500'}`}
                  style={{ width: `${bucket.total_required > 0 ? Math.min(100, (bucket.already_scheduled / bucket.total_required) * 100) : 0}%` }}
                ></div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}