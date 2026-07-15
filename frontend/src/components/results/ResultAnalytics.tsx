import { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, AlertTriangle, Trophy, BookOpen, Users, Layers } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import ImprovementModal from './ImprovementModal';
import SubjectModal from './SubjectModal';
import TopPerformersModal from './TopPerformanceModal';
import api from '../../libs/axiosInstance';

interface ResultsAnalyticsProps {
  role: 'admin' | 'teacher' | 'student' | 'parent';
}

export default function ResultsAnalytics({ role }: ResultsAnalyticsProps) {
  const [academicYear, setAcademicYear] = useState('2026');
  const [term, setTerm] = useState('Term 1');

  // Modal States
  const [isImprovementModalOpen, setIsImprovementModalOpen] = useState(false);
  const [isSubjectModalOpen, setIsSubjectModalOpen] = useState(false);
  const [isTopPerformersModalOpen, setIsTopPerformersModalOpen] = useState(false); 

  // REAL DATA STATES
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // FETCH FROM DJANGO API
  useEffect(() => {
    const fetchAnalytics = async () => {
      setIsLoading(true);
      setError(null);
      
      try {
        const response = await api.get('/api/results/school-analytics/', {
          params: { year: academicYear, term: term }
        });
        
        setData(response.data);
      } catch (err: any) {
        setError(err.response?.data?.error || err.message || "Failed to fetch analytics data from the server.");
      } finally {
        setIsLoading(false);
      }
    };

    fetchAnalytics();
  }, [academicYear, term]);

  // Security Check
  if (role === 'student' || role === 'parent') {
    return <div className="p-6 text-red-500 font-bold">Unauthorized Access. Administrators only.</div>;
  }

  // Loading State
  if (isLoading) {
    return (
      <div className="py-24 flex justify-center items-center flex-col gap-4">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
        <p className="text-slate-500 text-sm font-medium">Crunching school-wide analytics...</p>
      </div>
    );
  }

  // Error State
  if (error || !data) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-md flex items-center gap-3">
        <AlertTriangle className="w-5 h-5 text-red-500" />
        <p className="text-sm text-red-700">{error || "Failed to load data"}</p>
      </div>
    );
  }

  // BULLETPROOF DESTRUCTURING
  const schoolStats = data?.schoolStats || {};
  const subjectAlerts = data?.subjectAlerts || [];
  const termTrends = data?.termTrends || [];
  const gradeDistribution = data?.gradeDistribution || [];

  const groupedStreams = data?.groupedStreams || {};
  const streamComparisons = Object.values(groupedStreams).reduce((acc: any, val: any) => acc.concat(val), []);

  const groupedTopPerformers = data?.groupedTopPerformers || {};
  const topPerformers = Object.values(groupedTopPerformers).reduce((acc: any, val: any) => acc.concat(val), []).slice(0, 5);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      
      {/* 1. FILTER BAR */}
      <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 flex flex-wrap gap-4 items-end">
        <div className="flex flex-col gap-1 min-w-37.5">
          <label htmlFor="academic-year" className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Academic Year</label>
          <select
            id="academic-year"
            value={academicYear}
            onChange={(e) => setAcademicYear(e.target.value)}
            className="p-2 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
          >
            <option>2026</option>
            <option>2025</option>
          </select>
        </div>
        <div className="flex flex-col gap-1 min-w-37.5">
          <label htmlFor="term-focus" className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Term Focus</label>
          <select
            id="term-focus"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            className="p-2 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
          >
            <option>Term 1</option>
            <option>Term 2</option>
            <option>Term 3</option>
          </select>
        </div>
      </div>

      {/* 2. MACRO STATS */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm flex items-center gap-4 border-l-4 border-l-blue-500">
          <div className="p-3 bg-blue-50 text-blue-600 rounded-full"><Users className="w-6 h-6" /></div>
          <div>
            <p className="text-sm text-slate-500 font-medium">Total Assessed</p>
            <p className="text-2xl font-bold text-slate-800">{schoolStats.totalAssessed || 0}</p>
          </div>
        </div>
        <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm flex items-center gap-4 border-l-4 border-l-emerald-500">
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-full"><BookOpen className="w-6 h-6" /></div>
          <div>
            <p className="text-sm text-slate-500 font-medium">School Mean</p>
            <p className="text-2xl font-bold text-slate-800">{schoolStats.schoolMeanGrade || "N/A"}</p>
          </div>
        </div>
        <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm flex items-center gap-4 border-l-4 border-l-indigo-500">
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-full"><TrendingUp className="w-6 h-6" /></div>
          <div>
            <p className="text-sm text-slate-500 font-medium">Pass Rate</p>
            <p className="text-2xl font-bold text-slate-800">{schoolStats.passRate || "0%"}</p>
          </div>
        </div>
        
        {/* INTERACTIVE IMPROVEMENT CARD */}
        <div 
          onClick={() => setIsImprovementModalOpen(true)}
          className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm flex items-center gap-4 border-l-4 border-l-amber-500 cursor-pointer hover:bg-slate-50 transition-colors group"
        >
          <div className="p-3 bg-amber-50 text-amber-600 rounded-full group-hover:bg-amber-100 transition-colors"><TrendingUp className="w-6 h-6" /></div>
          <div className="flex-1">
            <p className="text-sm text-slate-500 font-medium">Improvement</p>
            <p className="text-2xl font-bold text-emerald-600">{schoolStats.improvement || "+0.0%"}</p>
          </div>
          <div className="text-xs text-slate-400 group-hover:text-blue-500">Details &rarr;</div>
        </div>
      </div>

      {/* 3. MAIN DASHBOARD GRID - ROW 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        <div className="lg:col-span-2 bg-white p-6 rounded-lg border border-slate-200 shadow-sm">
          <h3 className="font-semibold text-slate-800 mb-6 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-indigo-600" /> School Mean Trend ({academicYear})
          </h3>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={termTrends} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="term" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} domain={[0, 100]} />
                <RechartsTooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0' }} formatter={(value: number) => [`${value}%`, 'Mean Score']} />
                <Bar dataKey="mean" fill="#4f46e5" radius={[4, 4, 0, 0]} barSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm">
          <h3 className="font-semibold text-slate-800 mb-2 flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-blue-600" /> Overall Grade Distribution
          </h3>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={gradeDistribution}
                  cx="50%"
                  cy="45%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {gradeDistribution.map((entry: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <RechartsTooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0' }} />
                <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '12px' }}/>
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* 4. MAIN DASHBOARD GRID - ROW 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        <div className="lg:col-span-2 bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
          <div className="bg-slate-50 p-4 border-b border-slate-200 flex items-center justify-between">
            <h3 className="font-semibold text-slate-800 flex items-center gap-2">
              <Layers className="w-5 h-5 text-slate-600" /> Class Stream Performance Comparison
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="bg-white text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-3 font-semibold">Stream</th>
                  <th className="px-6 py-3 font-semibold text-center">Mean Score</th>
                  <th className="px-6 py-3 font-semibold text-center">Mean Grade</th>
                  <th className="px-6 py-3 font-semibold text-right">Term Trend</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {streamComparisons.length === 0 ? (
                  <tr><td colSpan={4} className="p-4 text-center text-slate-500">No streams data available.</td></tr>
                ) : (
                  streamComparisons.map((stream: any) => (
                    <tr key={stream.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 font-medium text-slate-800">{stream.stream}</td>
                      <td className="px-6 py-4 text-center">{stream.mean}</td>
                      <td className="px-6 py-4 text-center font-bold">{stream.grade}</td>
                      <td className="px-6 py-4 text-right">
                        {stream.trend === 'up' ? (
                          <span className="inline-flex items-center text-emerald-600 bg-emerald-50 px-2 py-1 rounded-md text-xs font-bold">
                            <TrendingUp className="w-3 h-3 mr-1" /> Improving
                          </span>
                        ) : (
                          <span className="inline-flex items-center text-red-600 bg-red-50 px-2 py-1 rounded-md text-xs font-bold">
                            <TrendingDown className="w-3 h-3 mr-1" /> Dropping
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-lg border border-red-200 shadow-sm overflow-hidden">
            <div 
              onClick={() => setIsSubjectModalOpen(true)}
              className="bg-red-50 p-4 border-b border-red-100 flex items-center justify-between cursor-pointer hover:bg-red-100 transition-colors group"
            >
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-600" />
                <h3 className="font-semibold text-red-900">Subject Deficit Alerts</h3>
              </div>
              <div className="text-xs text-red-600 font-medium opacity-0 group-hover:opacity-100 transition-opacity">Full Matrix &rarr;</div>
            </div>
            <div className="p-4 divide-y divide-slate-100">
              {subjectAlerts.length === 0 ? (
                <p className="text-sm text-slate-500 italic py-2">No alerts. All subjects are performing above the baseline.</p>
              ) : (
                subjectAlerts.map((alert: any) => (
                  <div key={alert.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex justify-between items-start mb-1">
                      <p className="font-semibold text-slate-800 text-sm">{alert.subject}</p>
                      <span className="bg-red-100 text-red-700 text-xs px-2 py-0.5 rounded font-bold">{alert.mean}</span>
                    </div>
                    <div className="flex justify-between text-xs text-slate-500">
                      {/* ✅ FIXED: Styled warning tags if alert return contains an unallocated staff state */}
                      <span className={alert.teacher === 'Unassigned' ? 'text-amber-600 font-bold' : ''}>
                        Teacher: {alert.teacher}
                      </span>
                      <span className="flex items-center text-red-600"><TrendingDown className="w-3 h-3 mr-1"/> {alert.drop}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
            <div 
              onClick={() => setIsTopPerformersModalOpen(true)}
              className="bg-amber-50 p-4 border-b border-amber-100 flex items-center justify-between cursor-pointer hover:bg-amber-100 transition-colors group"
            >
              <div className="flex items-center gap-2">
                <Trophy className="w-5 h-5 text-amber-600" />
                <h3 className="font-semibold text-amber-900">School Top Performers</h3>
              </div>
              <div className="text-xs text-amber-700 font-medium opacity-0 group-hover:opacity-100 transition-opacity">View Podium &rarr;</div>
            </div>
            <div className="p-4 space-y-4">
              {topPerformers.length === 0 ? (
                <p className="text-sm text-slate-500 italic">No top performers found for this term yet.</p>
              ) : (
                topPerformers.map((student: any, index: number) => (
                  <div key={student.id} className="flex items-center gap-4">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                      index === 0 ? 'bg-amber-200 text-amber-800' :
                      index === 1 ? 'bg-slate-200 text-slate-700' :
                      'bg-amber-100 text-amber-700'
                    }`}>
                      {index + 1}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-slate-800">{student.name}</p>
                      <p className="text-xs text-slate-500">{student.stream}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-slate-900">{student.marks}</p>
                      <p className="text-xs font-semibold text-emerald-600">{student.grade}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
        
      </div>

      {/* Render the detached Modals */}
      <ImprovementModal 
        isOpen={isImprovementModalOpen} 
        onClose={() => setIsImprovementModalOpen(false)} 
        year={academicYear} 
        term={term} 
      />
      <SubjectModal 
        isOpen={isSubjectModalOpen} 
        onClose={() => setIsSubjectModalOpen(false)} 
        year={academicYear} 
        term={term} 
      />
      <TopPerformersModal 
        isOpen={isTopPerformersModalOpen} 
        onClose={() => setIsTopPerformersModalOpen(false)} 
        data={groupedTopPerformers} 
        term={term} 
      />

    </div>
  );
}