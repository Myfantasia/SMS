import { Megaphone, AlertTriangle, Info, Clock, CheckCircle2 } from 'lucide-react';

// This interface matches your Django `Notice` model
interface Notice {
  id: number;
  message: string;
  by: string;
  date: string;
  is_urgent?: boolean; // Added optional flag for the new UI highlight
}

export default function Announcements({ notices }: { notices: Notice[] }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col h-105 overflow-hidden mt-4">
      
      {/* Sticky Premium Header */}
      <div className="p-5 border-b border-slate-100 bg-white/90 backdrop-blur-md z-10 flex justify-between items-center shrink-0">
        <h1 className="text-lg font-bold text-slate-800 flex items-center gap-2">
          <Megaphone className="w-5 h-5 text-blue-600" />
          Announcements
        </h1>
        <div className="flex items-center gap-3">
          {notices.length > 0 && (
            <span className="bg-blue-50 text-blue-600 text-[10px] font-bold px-2 py-1 rounded-full">
              {notices.length} NEW
            </span>
          )}
          <span className="text-xs font-semibold text-blue-600 hover:text-blue-700 cursor-pointer transition-colors">
            View All
          </span>
        </div>
      </div>
      
      {/* Scrollable Feed Area */}
      <div className="p-4 overflow-y-auto flex-1 space-y-3 scrollbar-hide">
        {notices.length > 0 ? (
          notices.map((notice) => (
            <div 
              key={notice.id} 
              className={`relative p-4 rounded-xl border-l-4 transition-all hover:translate-x-1 cursor-pointer ${
                notice.is_urgent 
                  ? 'border-red-500 bg-red-50/80 text-red-900 shadow-sm shadow-red-100/50' 
                  : 'border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100/80'
              }`}
            >
              <div className="flex gap-3">
                {/* Dynamic Status Icon */}
                <div className="mt-0.5 shrink-0">
                  {notice.is_urgent ? (
                    <AlertTriangle className="w-5 h-5 text-red-500" />
                  ) : (
                    <Info className="w-5 h-5 text-slate-400" />
                  )}
                </div>
                
                {/* Notice Content */}
                <div className="flex flex-col gap-1.5 w-full">
                  <p className={`text-sm font-medium leading-relaxed ${notice.is_urgent ? 'text-red-900' : 'text-slate-700'}`}>
                    {notice.message}
                  </p>
                  
                  {/* Clean Meta Footer (60-30-10 Rule Typography) */}
                  <div className="flex justify-between items-center mt-2 pt-2 border-t border-black/5">
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${notice.is_urgent ? 'text-red-500' : 'text-slate-500'}`}>
                      By: {notice.by}
                    </span>
                    <div className="flex items-center gap-1 text-[10px] text-slate-400 font-medium bg-white/50 px-2 py-0.5 rounded-sm">
                      <Clock className="w-3 h-3" />
                      {notice.date}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))
        ) : (
          // Premium Empty State Design
          <div className="flex flex-col items-center justify-center h-full text-slate-400 space-y-3 opacity-80 pt-8">
            <CheckCircle2 className="w-12 h-12 text-slate-300" />
            <p className="text-sm font-medium">All caught up! No recent announcements.</p>
          </div>
        )}
      </div>
    </div>
  );
}