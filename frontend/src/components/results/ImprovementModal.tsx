import { useState, useEffect } from 'react';
import { X, TrendingUp, TrendingDown, Award, AlertTriangle } from 'lucide-react';
import api from '../../libs/axiosInstance';

interface ImprovementModalProps {
  isOpen: boolean;
  onClose: () => void;
  year: string;
  term: string;
}

export default function ImprovementModal({ isOpen, onClose, year, term }: ImprovementModalProps) {
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchImprovementData();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, year, term]);

  const fetchImprovementData = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await api.get('/api/results/improvement-analytics/', {
        params: {
          year: year,
          term: term
        }
      });

      setData(response.data);

    } catch (err: any) {
      setError(err.response?.data?.error || err.message || "Failed to fetch detailed improvement analytics.");
    } finally {
      setIsLoading(false);
    }
};

  if (!isOpen) return null;

  // Bulletproof arrays
  const improvedStreams = data?.improved || [];
  const droppedStreams = data?.dropped || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl dark:shadow-none border border-transparent dark:border-slate-700 w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">

        {/* Header */}
        <div className="flex justify-between items-center p-5 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <TrendingUp className="text-blue-600 dark:text-blue-400"/> Term Comparison Analysis ({term})
          </h2>
          <button
            onClick={onClose}
            title="Close"
            aria-label="Close"
            className="text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 bg-white dark:bg-slate-900 p-1 rounded-md shadow-sm dark:shadow-none border border-slate-200 dark:border-slate-700"
          ><X /></button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1 bg-slate-50/50 dark:bg-slate-800/40">
          {isLoading ? (
            <div className="flex justify-center items-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 dark:border-blue-400"></div></div>
          ) : error ? (
            <div className="p-4 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 rounded-md flex gap-2"><AlertTriangle/> {error}</div>
          ) : data && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

              {/* IMPROVED STREAMS */}
              <div className="bg-white dark:bg-slate-900 border border-emerald-100 dark:border-emerald-500/20 rounded-xl overflow-hidden shadow-sm dark:shadow-none h-max">
                <div className="bg-emerald-50 dark:bg-emerald-500/10 p-4 border-b border-emerald-100 dark:border-emerald-500/20">
                  <h3 className="font-bold text-emerald-800 dark:text-emerald-400 flex items-center gap-2"><Award className="w-5 h-5"/> Streams Showing Growth</h3>
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">
                    {term === 'Term 1' ? "Comparing CAT 1 to MAIN exam performances." : "Comparing current mean to the previous term."}
                  </p>
                </div>
                <div className="p-4 space-y-3">
                    {improvedStreams.length === 0 ? <p className="text-sm text-slate-500 dark:text-slate-400 italic">No improvements recorded.</p> : null}
                    {improvedStreams.map((item: any, i: number) => (
                        <div key={i} className="p-3 rounded-lg border border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                            <div className="flex justify-between items-start">
                                <div>
                                    <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{item.grade}</p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-0.5">Stream: {item.stream}</p>
                                </div>
                                <span className="font-black text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-3 py-1 rounded-full text-sm">{item.jump}</span>
                            </div>
                            <div className="flex justify-between mt-3 text-xs text-slate-400 dark:text-slate-500 border-t border-slate-100 dark:border-slate-700 pt-2">
                                <span>Prev: <strong className="text-slate-600 dark:text-slate-300">{item.previous_score}</strong></span>
                                <span>Current: <strong className="text-slate-600 dark:text-slate-300">{item.current_score}</strong></span>
                            </div>
                        </div>
                    ))}
                </div>
              </div>

              {/* DROPPED STREAMS */}
              <div className="bg-white dark:bg-slate-900 border border-red-100 dark:border-red-500/20 rounded-xl overflow-hidden shadow-sm dark:shadow-none h-max">
                <div className="bg-red-50 dark:bg-red-500/10 p-4 border-b border-red-100 dark:border-red-500/20">
                  <h3 className="font-bold text-red-800 dark:text-red-400 flex items-center gap-2"><TrendingDown className="w-5 h-5"/> Streams Requiring Attention</h3>
                  <p className="text-xs text-red-600 dark:text-red-400 mt-1">Streams that experienced a drop in mean score.</p>
                </div>
                <div className="p-4 space-y-3">
                    {droppedStreams.length === 0 ? <p className="text-sm text-slate-500 dark:text-slate-400 italic">No streams dropped in performance. Excellent!</p> : null}
                    {droppedStreams.map((item: any, i: number) => (
                        <div key={i} className="p-3 rounded-lg border border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                            <div className="flex justify-between items-start">
                                <div>
                                    <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{item.grade}</p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-0.5">Stream: {item.stream}</p>
                                </div>
                                <span className="font-black text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 px-3 py-1 rounded-full text-sm">{item.jump}</span>
                            </div>
                            <div className="flex justify-between mt-3 text-xs text-slate-400 dark:text-slate-500 border-t border-slate-100 dark:border-slate-700 pt-2">
                                <span>Prev: <strong className="text-slate-600 dark:text-slate-300">{item.previous_score}</strong></span>
                                <span>Current: <strong className="text-slate-600 dark:text-slate-300">{item.current_score}</strong></span>
                            </div>
                        </div>
                    ))}
                </div>
              </div>

            </div>
          )}
        </div>
      </div>
    </div>
  );
}
