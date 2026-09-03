import { useState, useEffect } from 'react';
import { X, BookOpen, AlertTriangle } from 'lucide-react';
import api from '../../libs/axiosInstance';

interface SubjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  year: string;
  term: string;
}

export default function SubjectModal({ isOpen, onClose, year, term }: SubjectModalProps) {
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchSubjectData();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, year, term]);

  const fetchSubjectData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get('/api/results/subject-matrix-analytics/', {
        params: { year: year, term: term }
      });

      setData(response.data);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || "Failed to fetch detailed subject analytics.");
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  // Bulletproof object access
  const grades = data?.grades || {};

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl dark:shadow-none w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">

        {/* Header */}
        <div className="flex justify-between items-center p-5 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40">
          <div>
            <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><BookOpen className="text-blue-600 dark:text-blue-400"/> School-Wide Subject Matrix</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Comprehensive breakdown of subject performance categorized by Grade and Stream.</p>
          </div>
          <button onClick={onClose} className="text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 bg-white dark:bg-slate-900 p-1 rounded-md shadow-sm dark:shadow-none border border-slate-200 dark:border-slate-700" title="Close"><X /></button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1 bg-white dark:bg-slate-900">
          {isLoading ? (
            <div className="flex justify-center items-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 dark:border-blue-400"></div></div>
          ) : error ? (
            <div className="p-4 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 rounded-md flex gap-2"><AlertTriangle/> {error}</div>
          ) : Object.keys(grades).length === 0 ? (
            <div className="p-6 text-center text-slate-500 dark:text-slate-400 italic">No subject data found for this term.</div>
          ) : (
            <div className="space-y-10">
              {Object.keys(grades).map((gradeLevel) => (
                  <div key={gradeLevel} className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden shadow-sm dark:shadow-none">
                      {/* Grade Header */}
                      <div className="bg-slate-800 dark:bg-slate-700 text-white px-5 py-3 font-bold text-lg tracking-wide">
                          {gradeLevel}
                      </div>

                      {/* Grid of Subjects for this Grade */}
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 p-5 bg-slate-50 dark:bg-slate-800/40">
                          {(grades[gradeLevel] || []).map((subItem: any, i: number) => (
                              <div key={i} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden shadow-sm dark:shadow-none hover:border-blue-400 dark:hover:border-blue-500/60 transition-colors duration-200">
                                  <div className="bg-blue-50/50 dark:bg-blue-500/10 px-4 py-3 font-bold text-slate-800 dark:text-slate-100 text-sm border-b border-slate-100 dark:border-slate-700 flex justify-between items-center">
                                      {subItem.subject}
                                  </div>
                                  <div className="divide-y divide-slate-100 dark:divide-slate-700">
                                      {(subItem.streams || []).map((st: any, j: number) => {
                                          const score = parseFloat(st.mean);
                                          const isGood = score >= 60;
                                          const isWarning = score < 50;

                                          return (
                                              <div key={j} className="flex justify-between items-center px-4 py-3 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
                                                  <span className="text-slate-600 dark:text-slate-300 font-medium">{st.name}</span>
                                                  <span className={`font-black px-2 py-0.5 rounded text-xs border ${
                                                      isGood ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/40' :
                                                      isWarning ? 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border-red-200 dark:border-red-500/40' : 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/40'
                                                  }`}>
                                                      {st.mean}
                                                  </span>
                                              </div>
                                          );
                                      })}
                                  </div>
                              </div>
                          ))}
                      </div>
                  </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
