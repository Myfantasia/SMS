import { X, Trophy, Medal, Award } from 'lucide-react';

interface TopPerformersModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: any;
  term: string;
}

export default function TopPerformersModal({ isOpen, onClose, data, term }: TopPerformersModalProps) {
  if (!isOpen) return null;

  const groupedPerformers = data || {};

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl dark:shadow-none w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">

        {/* Header */}
        <div className="flex justify-between items-center p-5 border-b border-amber-100 dark:border-amber-500/20 bg-amber-50/50 dark:bg-amber-500/10">
          <div>
            <h2 className="text-xl font-bold text-amber-900 dark:text-amber-400 flex items-center gap-2">
              <Trophy className="text-amber-600 dark:text-amber-400"/> School-Wide Top Performers ({term})
            </h2>
            <p className="text-sm text-amber-700/70 dark:text-amber-400/70 mt-1">Celebrating the top 3 academic achievers across every grade level.</p>
          </div>
          <button onClick={onClose} aria-label="Close modal" title="Close modal" className="text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 bg-white dark:bg-slate-900 p-1 rounded-md shadow-sm dark:shadow-none border border-slate-200 dark:border-slate-700"><X /></button>
        </div>

        {/* Scrollable Content */}
        <div className="p-6 overflow-y-auto flex-1 bg-slate-50/50 dark:bg-slate-800/40">
          {Object.keys(groupedPerformers).length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400 dark:text-slate-500">
              <Award className="w-12 h-12 mb-3 opacity-20" />
              <p className="italic">No top performers data available yet.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {Object.keys(groupedPerformers).map((gradeLevel) => {
                // Ensure we are strictly slicing the top 3 students
                const topThree = (groupedPerformers[gradeLevel] || []).slice(0, 3);

                return (
                  <div key={gradeLevel} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden shadow-sm dark:shadow-none">
                    <div className="bg-slate-800 dark:bg-slate-700 text-white px-4 py-3 font-bold flex items-center justify-between">
                      <span>{gradeLevel}</span>
                      <span className="text-xs font-medium text-slate-300 dark:text-slate-300 bg-slate-700 dark:bg-slate-600 px-2 py-1 rounded">Top 3</span>
                    </div>

                    <div className="p-4 space-y-4">
                      {topThree.map((student: any, index: number) => {
                        // Explicitly assigning podium styles
                        const isFirst = index === 0;
                        const isSecond = index === 1;
                        const isThird = index === 2;

                        return (
                          <div
                            key={student.id}
                            className={`flex items-center gap-4 p-3 rounded-lg border ${
                              isFirst ? 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/40' :
                              isSecond ? 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700' :
                              'bg-orange-50 dark:bg-orange-500/10 border-orange-200 dark:border-orange-500/40' // Bronze styling for the 3rd student
                            }`}
                          >
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center font-black shadow-sm dark:shadow-none ${
                              isFirst ? 'bg-amber-400 dark:bg-amber-500 text-amber-900 dark:text-amber-950' :
                              isSecond ? 'bg-slate-300 dark:bg-slate-600 text-slate-800 dark:text-slate-100' :
                              'bg-orange-300 dark:bg-orange-600 text-orange-900 dark:text-orange-100'
                            }`}>
                              {isFirst ? <Trophy className="w-5 h-5"/> : isSecond ? <Medal className="w-5 h-5"/> : '3rd'}
                            </div>

                            <div className="flex-1">
                              <p className={`font-bold ${isFirst ? 'text-amber-900 dark:text-amber-400 text-base' : 'text-slate-800 dark:text-slate-100 text-sm'}`}>
                                {student.name}
                              </p>
                              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-0.5">Stream: {student.stream} | ADM: {student.id}</p>
                            </div>

                            <div className="text-right">
                              <p className={`font-black ${isFirst ? 'text-amber-700 dark:text-amber-400 text-lg' : 'text-slate-700 dark:text-slate-200'}`}>
                                {student.marks}
                              </p>
                              <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400">{student.grade}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
