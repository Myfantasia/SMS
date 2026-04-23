import { useState, useEffect } from 'react';
import { X, BookOpen, AlertTriangle } from 'lucide-react';

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
      const token = localStorage.getItem('firebase_dev_token');
      const response = await fetch(`http://127.0.0.1:8000/api/results/subject-matrix-analytics/?year=${year}&term=${term}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) throw new Error("Failed to fetch detailed subject analytics.");
      const result = await response.json();
      setData(result);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  // Bulletproof object access
  const grades = data?.grades || {};

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex justify-between items-center p-5 border-b border-slate-100 bg-slate-50">
          <div>
            <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2"><BookOpen className="text-blue-600"/> School-Wide Subject Matrix</h2>
            <p className="text-sm text-slate-500 mt-1">Comprehensive breakdown of subject performance categorized by Grade and Stream.</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-red-500 bg-white p-1 rounded-md shadow-sm border border-slate-200" title="Close"><X /></button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1 bg-white">
          {isLoading ? (
            <div className="flex justify-center items-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div></div>
          ) : error ? (
            <div className="p-4 bg-red-50 text-red-700 rounded-md flex gap-2"><AlertTriangle/> {error}</div>
          ) : Object.keys(grades).length === 0 ? (
            <div className="p-6 text-center text-slate-500 italic">No subject data found for this term.</div>
          ) : (
            <div className="space-y-10">
              {Object.keys(grades).map((gradeLevel) => (
                  <div key={gradeLevel} className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                      {/* Grade Header */}
                      <div className="bg-slate-800 text-white px-5 py-3 font-bold text-lg tracking-wide">
                          {gradeLevel}
                      </div>
                      
                      {/* Grid of Subjects for this Grade */}
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 p-5 bg-slate-50">
                          {(grades[gradeLevel] || []).map((subItem: any, i: number) => (
                              <div key={i} className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm hover:border-blue-400 transition-colors duration-200">
                                  <div className="bg-blue-50/50 px-4 py-3 font-bold text-slate-800 text-sm border-b border-slate-100 flex justify-between items-center">
                                      {subItem.subject}
                                  </div>
                                  <div className="divide-y divide-slate-100">
                                      {(subItem.streams || []).map((st: any, j: number) => {
                                          const score = parseFloat(st.mean);
                                          const isGood = score >= 60;
                                          const isWarning = score < 50;
                                          
                                          return (
                                              <div key={j} className="flex justify-between items-center px-4 py-3 text-sm hover:bg-slate-50">
                                                  <span className="text-slate-600 font-medium">{st.name}</span>
                                                  <span className={`font-black px-2 py-0.5 rounded text-xs border ${
                                                      isGood ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 
                                                      isWarning ? 'bg-red-50 text-red-700 border-red-200' : 'bg-amber-50 text-amber-700 border-amber-200'
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