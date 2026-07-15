import { useState, useEffect } from 'react';
import { X, Loader2, User, Trophy, BookOpen } from 'lucide-react';
import { 
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer 
} from 'recharts';
import api from '../../libs/axiosInstance';

interface AnalyticsData {
  subject: string;
  teacher: string;
  cat1: number;
  cat2: number;
  main: number;
  termMean: number;
  grade: string;
  position: number | string;
  outOf: number;
}

interface StudentAnalyticsModalProps {
  isOpen: boolean;
  onClose: () => void;
  studentId: number | null;
  year: string;
  term: string;
}

export default function StudentAnalyticsModal({ isOpen, onClose, studentId, year, term }: StudentAnalyticsModalProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [studentInfo, setStudentInfo] = useState<{name: string, admNo: string} | null>(null);
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData[]>([]);

  useEffect(() => {
    if (isOpen && studentId) {
      fetchStudentAnalytics();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, studentId]);

  const fetchStudentAnalytics = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get('/api/results/student-analytics/', {
        params: { student_id: studentId, year: year, term: term }
      });

      setStudentInfo(response.data.student);
      setAnalyticsData(response.data.analytics);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || "Failed to load student analytics.");
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white p-3 border border-slate-200 shadow-lg rounded-md outline-none min-w-50">
          <p className="font-bold text-slate-800 border-b border-slate-100 pb-2 mb-2">{label}</p>
          {payload.map((entry: any, index: number) => (
            <div key={index} className="flex justify-between gap-4 text-sm mb-1">
              <span className="font-medium" style={{ color: entry.color }}>{entry.name}:</span>
              <span className="font-bold text-slate-900">{entry.value}%</span>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 text-blue-600 rounded-full">
              <User className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">
                {studentInfo ? studentInfo.name : 'Loading Student...'}
              </h2>
              <p className="text-sm text-slate-500">
                {studentInfo ? `Adm No: ${studentInfo.admNo}` : ''} • {term} {year}
              </p>
            </div>
          </div>
          <button 
            type="button"
            title="Close modal"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1 bg-white">
          
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-64 text-slate-500">
              <Loader2 className="w-8 h-8 animate-spin text-blue-500 mb-4" />
              <p>Fetching deep analytics...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-64 text-red-500 bg-red-50 rounded-lg border border-red-100">
              <p className="font-medium">{error}</p>
            </div>
          ) : (
            <>
              {/* Visual Chart: Exam Trajectory */}
              <div className="mb-8">
                <h3 className="text-sm font-semibold text-slate-600 mb-4 uppercase tracking-wider flex items-center gap-2">
                  <Trophy className="w-4 h-4" /> Assessment Trajectory
                </h3>
                <div className="h-80 w-full bg-slate-50 border border-slate-200 rounded-lg p-4 pt-6">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={analyticsData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="subject" tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
                      <YAxis domain={[0, 100]} tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
                      <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f1f5f9' }} />
                      <Legend wrapperStyle={{ paddingTop: '20px' }} />
                      
                      <Bar dataKey="cat1" name="CAT 1" fill="#94a3b8" radius={[2, 2, 0, 0]} barSize={20} />
                      <Bar dataKey="cat2" name="CAT 2" fill="#64748b" radius={[2, 2, 0, 0]} barSize={20} />
                      <Bar dataKey="main" name="MAIN Exam" fill="#0f172a" radius={[2, 2, 0, 0]} barSize={20} />
                      <Line type="monotone" dataKey="termMean" name="Final Subject Mean" stroke="#3b82f6" strokeWidth={3} dot={{ r: 4, fill: '#3b82f6', strokeWidth: 2, stroke: '#fff' }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Detailed Data Table */}
              <div>
                <h3 className="text-sm font-semibold text-slate-600 mb-3 uppercase tracking-wider flex items-center gap-2">
                  <BookOpen className="w-4 h-4" /> Comprehensive Breakdown
                </h3>
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <table className="w-full text-left text-sm text-slate-600">
                    <thead className="bg-slate-100 text-slate-500 border-b border-slate-200">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Subject</th>
                        <th className="px-4 py-3 font-semibold">Teacher</th>
                        <th className="px-4 py-3 font-semibold">CAT 1</th>
                        <th className="px-4 py-3 font-semibold">CAT 2</th>
                        <th className="px-4 py-3 font-semibold">MAIN</th>
                        <th className="px-4 py-3 font-semibold bg-blue-50 text-blue-800">Final Mean</th>
                        <th className="px-4 py-3 font-semibold">Class Rank</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {analyticsData.map((row, idx) => (
                        <tr key={idx} className="hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-3 font-medium text-slate-800">{row.subject}</td>
                          {/* ✅ FIXED: Implemented safety check highlighting unassigned teacher profiles inside user modal layout */}
                          <td className={`px-4 py-3 font-medium ${row.teacher === 'Unassigned' ? 'text-rose-600 italic' : 'text-slate-500'}`}>
                            {row.teacher}
                          </td>
                          <td className="px-4 py-3">{row.cat1}%</td>
                          <td className="px-4 py-3">{row.cat2}%</td>
                          <td className="px-4 py-3">{row.main}%</td>
                          <td className="px-4 py-3 bg-blue-50/30">
                            <span className="font-bold text-slate-900">{row.termMean}%</span>
                            <span className="ml-2 text-xs font-bold text-blue-600">({row.grade})</span>
                          </td>
                          <td className="px-4 py-3 font-medium">
                            {row.position} <span className="text-slate-400 text-xs font-normal">/ {row.outOf}</span>
                          </td>
                        </tr>
                      ))}
                      {analyticsData.length === 0 && !isLoading && (
                         <tr>
                           <td colSpan={7} className="px-4 py-8 text-center text-slate-500">No subject data found for this term.</td>
                         </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

            </>
          )}
        </div>
      </div>
    </div>
  );
}