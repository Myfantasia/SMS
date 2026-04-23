import { useState, useEffect } from 'react';
import { Search, Download, TrendingUp, AlertCircle, Award, Users, Loader2, CheckCircle, Eye } from 'lucide-react'; 

import ClassSubjectModal from './ClassSubjectModal';
import StudentAnalyticsModal from './StudentAnalyticsModal';


interface ClassPerformanceSummaryProps {
  role: 'admin' | 'teacher' | 'student' | 'parent';
  // In a real app, you might pass the teacherId here to filter the 'Class Stream' dropdown
}

export default function ClassPerformanceSummary({ role }: ClassPerformanceSummaryProps) {
  // 1. FILTER SELECTION STATES
  const [academicYear, setAcademicYear] = useState('');
  const [term, setTerm] = useState('');
  const [classStream, setClassStream] = useState('');

  // DYNAMIC DROPDOWN OPTIONS STATES
  const [availableYears, setAvailableYears] = useState<string[]>([]);
  const [availableTerms, setAvailableTerms] = useState<string[]>([]);
  const [availableStreams, setAvailableStreams] = useState<string[]>([]);
  const [isFiltersLoading, setIsFiltersLoading] = useState(true);

  // Real State for our Django data
  const [summaryStats, setSummaryStats] = useState<any>(null);
  const [studentRankings, setStudentRankings] = useState<any[]>([]);
  
  // ==========================================
  // NEW: State for Modal Data & Visibility
  // ==========================================
  const [subjectPerformance, setSubjectPerformance] = useState<any[]>([]);
  const [isSubjectModalOpen, setIsSubjectModalOpen] = useState(false);
  const [isStudentModalOpen, setIsStudentModalOpen] = useState(false);
  const [selectedStudentId, setSelectedStudentId] = useState<number | null>(null);

  // UI states for loading, errors, and toasts
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null); // NEW: Toast state

  // NEW: Auto-hide the toast after 3 seconds
  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => {
        setToastMessage(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  // FETCH FILTER OPTIONS ON COMPONENT MOUNT
  useEffect(() => {
    const fetchFilters = async () => {
      try {
        const token = localStorage.getItem('firebase_dev_token');
        const response = await fetch('http://127.0.0.1:8000/api/results/filter-options/', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (response.ok) {
          const data = await response.json();
          setAvailableYears(data.years);
          setAvailableTerms(data.terms);
          setAvailableStreams(data.streams);

          if (data.years.length > 0) setAcademicYear(data.years[0].toString());
          if (data.terms.length > 0) setTerm(data.terms[0]);
          if (data.streams.length > 0) setClassStream(data.streams[0]);
        }
      } catch (err) {
        console.error("Failed to load filter options", err);
      } finally {
        setIsFiltersLoading(false);
      }
    };

    fetchFilters();
  }, []);

  // ---------------------------------------------------------
  // ACTION: READ (Fetch generated data)
  // ---------------------------------------------------------
  const fetchClassData = async () => {
    if (!academicYear || !term || !classStream) return; 

    setIsLoading(true);
    setError(null);
    
    const streamName = classStream.split(' (')[0];

    try {
      const token = localStorage.getItem('firebase_dev_token');
      const response = await fetch(`http://127.0.0.1:8000/api/results/class-summary/?year=${academicYear}&term=${term}&stream=${encodeURIComponent(streamName)}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 404) throw new Error("No results found for this class.");
        throw new Error("Failed to fetch class performance data.");
      }

      const data = await response.json();
      setSummaryStats(data.summaryStats);
      setStudentRankings(data.studentRankings);
      
      // ==========================================
      // NEW: Save the subject data array from Django
      // ==========================================
      setSubjectPerformance(data.subjectPerformance || []);
      
    } catch (err: any) {
      setError(err.message);
      setSummaryStats(null);
      setStudentRankings([]);
      setSubjectPerformance([]);
    } finally {
      setIsLoading(false);
    }
  };

  // ---------------------------------------------------------
  // ACTION: WRITE (Tell Django to calculate math)
  // ---------------------------------------------------------
  const handleGenerateMath = async () => {
    if (!academicYear || !term || !classStream) return;
    
    setIsLoading(true);
    setError(null);
    const streamName = classStream.split(' (')[0];

    try {
      const token = localStorage.getItem('firebase_dev_token');
      const response = await fetch(`http://127.0.0.1:8000/api/results/generate/`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          year: academicYear,
          term: term,
          stream: streamName
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to generate results.");
      }

      // If successful, trigger toast and instantly fetch the fresh data
      setToastMessage("Success! Term performance has been calculated and saved.");
      fetchClassData(); 

    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Trigger main fetch ONLY AFTER filters are loaded and defaults are set
  useEffect(() => {
    if (!isFiltersLoading && academicYear && term && classStream) {
      fetchClassData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFiltersLoading]);

  // Show a spinner while the filter options are downloading from the database
  if (isFiltersLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>;
  }

  return (
    <div className="space-y-6 relative">
      {/* 1. THE FILTER BAR */}
      <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 flex flex-wrap gap-4 items-end">
        <div className="flex flex-col gap-1 flex-1 min-w-37.5">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Academic Year</label>
          <select 
            value={academicYear} 
            onChange={(e) => setAcademicYear(e.target.value)}
            title="Select academic year"
            className="p-2 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 outline-none"
          >
            {availableYears.map((year) => (
              <option key={year} value={year}>{year}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1 flex-1 min-w-37.5">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Term</label>
          <select 
            value={term} 
            onChange={(e) => setTerm(e.target.value)}
            title="Select term"
            className="p-2 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 outline-none"
          >
            {availableTerms.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1 flex-1 min-w-50">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Class Stream</label>
          <select 
            value={classStream} 
            onChange={(e) => setClassStream(e.target.value)}
            title="Select class stream"
            className="p-2 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 outline-none"
          >
            {role === 'admin' && <option value="All">All Streams (Admin View)</option>}
            {availableStreams.map((stream) => (
              <option key={stream} value={stream}>{stream}</option>
            ))}
          </select>
        </div>

        {/* BUTTON GROUP */}
        <div className="flex gap-2">
          <button 
            onClick={fetchClassData}
            disabled={isLoading}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 disabled:bg-blue-400"
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            {isLoading ? 'Loading...' : 'Load Data'}
          </button>

          {/* GENERATE BUTTON */}
          {role === 'admin' && (
             <button 
              onClick={handleGenerateMath}
              disabled={isLoading}
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 disabled:bg-emerald-400"
            >
              Calculate Results
            </button>
          )}
        </div>
      </div>

      {/* Error Alert Box */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-md flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Only render the cards and table if we have real data */}
      {!isLoading && !error && summaryStats && (
        <>
          {/* 2. SUMMARY CARDS */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm flex items-center gap-4">
              <div className="p-3 bg-blue-50 text-blue-600 rounded-full"><Users className="w-6 h-6" /></div>
              <div>
                <p className="text-sm text-slate-500 font-medium">Total Assessed</p>
                <p className="text-xl font-bold text-slate-800">{summaryStats.totalStudents}</p>
              </div>
            </div>
            <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm flex items-center gap-4">
              <div className="p-3 bg-emerald-50 text-emerald-600 rounded-full"><TrendingUp className="w-6 h-6" /></div>
              <div>
                <p className="text-sm text-slate-500 font-medium">Class Mean</p>
                <p className="text-xl font-bold text-slate-800">{summaryStats.classMeanGrade} <span className="text-sm font-normal text-slate-400">({summaryStats.classMeanMarks}%)</span></p>
              </div>
            </div>
            
            {/* Top Subject - Now Clickable */}
            <div 
              onClick={() => setIsSubjectModalOpen(true)}
              title="Click to view subject performance"
              className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm flex items-center gap-4 cursor-pointer hover:border-blue-300 hover:shadow-md transition-all group"
            >
              <div className="p-3 bg-amber-50 text-amber-600 rounded-full group-hover:bg-amber-100 transition-colors"><Award className="w-6 h-6" /></div>
              <div>
                <p className="text-sm text-slate-500 font-medium">Top Subject</p>
                <p className="text-lg font-bold text-slate-800 truncate max-w-30">{summaryStats.topSubject}</p>
              </div>
            </div>
            
            {/* Needs Attention - Now Clickable */}
            <div 
              onClick={() => setIsSubjectModalOpen(true)}
              title="Click to view subject performance"
              className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm flex items-center gap-4 cursor-pointer hover:border-blue-300 hover:shadow-md transition-all group"
            >
              <div className="p-3 bg-red-50 text-red-600 rounded-full group-hover:bg-red-100 transition-colors"><AlertCircle className="w-6 h-6" /></div>
              <div>
                <p className="text-sm text-slate-500 font-medium">Needs Attention</p>
                <p className="text-lg font-bold text-slate-800 truncate max-w-30">{summaryStats.needsAttention}</p>
              </div>
            </div>
          </div>

          {/* 3. STUDENT RANKING TABLE */}
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
            <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
              <h3 className="font-semibold text-slate-800">Class Broadsheet Ranking</h3>
              <button className="text-slate-600 hover:text-blue-600 flex items-center gap-2 text-sm font-medium transition-colors">
                <Download className="w-4 h-4" /> Export CSV
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-600">
                <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="px-6 py-3 font-semibold">Rank</th>
                    <th className="px-6 py-3 font-semibold">Adm No.</th>
                    <th className="px-6 py-3 font-semibold">Student Name</th>
                    <th className="px-6 py-3 font-semibold">Total Marks</th>
                    <th className="px-6 py-3 font-semibold">Mean Grade</th>
                    {/* Admin/Teacher specific column */}
                    {(role === 'admin' || role === 'teacher') && (
                      <th className="px-6 py-3 font-semibold text-right">Actions</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {studentRankings.map((student, index) => (
                    <tr key={student.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 font-medium text-slate-900">{student.rank || index + 1}</td>
                      <td className="px-6 py-4">{student.admNo}</td>
                      <td className="px-6 py-4 font-medium text-slate-800">{student.name}</td>
                      <td className="px-6 py-4">{student.marks} <span className="text-slate-400 text-xs">/ {student.outOf}</span></td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center justify-center px-2.5 py-1 rounded-full text-xs font-bold ${
                          student.meanGrade.startsWith('A') ? 'bg-emerald-100 text-emerald-800' :
                          student.meanGrade.startsWith('B') ? 'bg-blue-100 text-blue-800' :
                          'bg-slate-100 text-slate-800'
                        }`}>
                          {student.meanGrade}
                        </span>
                      </td>
                      {/* Interactive Button for Admin/Teacher */}
                      {(role === 'admin' || role === 'teacher') && (
                        <td className="px-6 py-4 text-right">
                          <button
                            onClick={() => {
                              setSelectedStudentId(student.id);
                              setIsStudentModalOpen(true);
                            }}
                            title={`View Analytics for ${student.name}`}
                            className="p-2 text-blue-600 hover:text-blue-800 hover:bg-blue-100 rounded-full transition-colors"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {studentRankings.length === 0 && (
                    <tr>
                      <td colSpan={(role === 'admin' || role === 'teacher') ? 6 : 5} className="px-6 py-8 text-center text-slate-500">
                        No students found for this class.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* NEW: CUSTOM TAILWIND TOAST NOTIFICATION */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 bg-emerald-600 text-white px-5 py-3 rounded-lg shadow-xl flex items-center gap-3 animate-in fade-in slide-in-from-bottom-5 duration-300 z-50">
          <CheckCircle className="w-5 h-5" />
          <p className="text-sm font-medium">{toastMessage}</p>
        </div>
      )}

      {/* ========================================== */}
      {/* RENDER THE INTERACTIVE MODALS */}
      {/* ========================================== */}
      <ClassSubjectModal 
        isOpen={isSubjectModalOpen} 
        onClose={() => setIsSubjectModalOpen(false)} 
        data={subjectPerformance}
        className={classStream}
      />

      <StudentAnalyticsModal 
        isOpen={isStudentModalOpen}
        onClose={() => {
          setIsStudentModalOpen(false);
          setSelectedStudentId(null);
        }}
        studentId={selectedStudentId}
        year={academicYear}
        term={term}
      />
    </div>
  );
}