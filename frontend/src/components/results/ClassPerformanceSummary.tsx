import { useState, useEffect } from 'react';
import { Search, Download, TrendingUp, AlertCircle, Award, Users, Loader2, CheckCircle, Eye, X, School } from 'lucide-react';

import ClassSubjectModal from './ClassSubjectModal';
import StudentAnalyticsModal from './StudentAnalyticsModal';
import api from '../../libs/axiosInstance';

interface BulkGenerateResult {
  message: string;
  per_class: { class_id: number; class_name: string; students_assessed: number; error: string | null }[];
  classes_with_issues: { class_id: number; class_name: string; students_assessed: number; error: string | null }[];
}

interface ClassPerformanceSummaryProps {
  role: 'admin' | 'teacher' | 'student' | 'parent';
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
  const [myStreams, setMyStreams] = useState<string[]>([]); // ✅ ADDED: Specialized array tracking teacher's own allocations
  const [isFiltersLoading, setIsFiltersLoading] = useState(true);

  // Real State for our Django data
  const [summaryStats, setSummaryStats] = useState<any>(null);
  const [studentRankings, setStudentRankings] = useState<any[]>([]);
  
  // State for Modal Data & Visibility
  const [subjectPerformance, setSubjectPerformance] = useState<any[]>([]);
  const [isSubjectModalOpen, setIsSubjectModalOpen] = useState(false);
  const [isStudentModalOpen, setIsStudentModalOpen] = useState(false);
  const [selectedStudentId, setSelectedStudentId] = useState<number | null>(null);

  // UI states for loading, errors, and toasts
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Bulk (whole-school) generate states
  const [isBulkConfirmOpen, setIsBulkConfirmOpen] = useState(false);
  const [isBulkGenerating, setIsBulkGenerating] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkGenerateResult | null>(null);

  // Auto-hide the toast after 3 seconds
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
        const response = await api.get('/api/results/filter-options/');
        const data = response.data;
        
        setAvailableYears(data.years);
        setAvailableTerms(data.terms);
        setAvailableStreams(data.streams);
        setMyStreams(data.my_streams || []); // ✅ ADDED: Pulling backend-filtered allocations from response

        if (data.years.length > 0) setAcademicYear(data.years[0].toString());
        if (data.terms.length > 0) setTerm(data.terms[0]);
        
        // ✅ FIXED: Prioritize auto-selecting the teacher's first assigned stream if viewing as a teacher
        if (role === 'teacher' && data.my_streams && data.my_streams.length > 0) {
          setClassStream(data.my_streams[0]);
        } else if (data.streams.length > 0) {
          setClassStream(data.streams[0]);
        }
        
      } catch (err) {
        console.error("Failed to load filter options", err);
      } finally {
        setIsFiltersLoading(false);
      }
    };

    fetchFilters();
  }, [role]);

  // ACTION: READ (Fetch generated data)
  const fetchClassData = async () => {
    if (!academicYear || !term || !classStream) return; 

    setIsLoading(true);
    setError(null);
    
    // ✅ FIXED: Swapped loose string split parameter with full uniform query handling matching the new backend matrix
    const streamName = classStream;

    try {
      const response = await api.get('/api/results/class-summary/', {
        params: {
          year: academicYear,
          term: term,
          stream: streamName 
        }
      });

      const data = response.data;
      
      setSummaryStats(data.summaryStats);
      setStudentRankings(data.studentRankings);
      setSubjectPerformance(data.subjectPerformance || []);
      
    } catch (err: any) {
      if (err.response?.status === 404) {
        setError("No results found for this class.");
      } else {
        setError(err.response?.data?.error || err.message || "Failed to fetch class performance data.");
      }
      
      setSummaryStats(null);
      setStudentRankings([]);
      setSubjectPerformance([]);
    } finally {
      setIsLoading(false);
    }
  };

  // ACTION: WRITE (Tell Django to calculate math)
  const handleGenerateMath = async () => {
    if (!academicYear || !term || !classStream) return;
    
    setIsLoading(true);
    setError(null);
    const streamName = classStream;

    try {
      await api.post('/api/results/generate/', {
        year: academicYear,
        term: term,
        stream: streamName
      });

      setToastMessage("Success! Term performance has been calculated and saved.");
      fetchClassData(); 

    } catch (err: any) {
      const errorMessage = err.response?.data?.error || err.message || "Failed to generate results.";
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  // ACTION: BULK WRITE (Compile results for every class in the school in one pass)
  const handleBulkGenerate = async () => {
    if (!academicYear || !term) return;

    setIsBulkGenerating(true);
    try {
      const response = await api.post('/api/results/bulk-generate/', {
        year: academicYear,
        term: term,
      });
      setBulkResult(response.data);
      setIsBulkConfirmOpen(false);
      setToastMessage(response.data.message || "Bulk results compilation complete.");
      fetchClassData();
    } catch (err: any) {
      const errorMessage = err.response?.data?.error || err.message || "Failed to run bulk results compilation.";
      setError(errorMessage);
      setIsBulkConfirmOpen(false);
    } finally {
      setIsBulkGenerating(false);
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

  // ✅ FIXED: Determine calculation permissions based on specific backend assignment flags
  const canCalculate = role === 'admin' || summaryStats?.isClassTeacher || summaryStats?.isAllocatedSubjectTeacher;

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
            
            {/* ✅ FIXED: Implemented distinct `<optgroup>` paths to prioritize allocations for teachers while keeping browsing lenient */}
            {role === 'teacher' && myStreams.length > 0 ? (
              <>
                <optgroup label="My Allocated Streams">
                  {myStreams.map((stream) => (
                    <option key={`my-${stream}`} value={stream}>{stream}</option>
                  ))}
                </optgroup>
                <optgroup label="All School Streams">
                  {availableStreams.map((stream) => (
                    <option key={`all-${stream}`} value={stream}>{stream}</option>
                  ))}
                </optgroup>
              </>
            ) : (
              availableStreams.map((stream) => (
                <option key={stream} value={stream}>{stream}</option>
              ))
            )}
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

          {/* ✅ FIXED: Render calculate results box if user is admin OR holding active authorization flags */}
          {canCalculate && (
             <button
              onClick={handleGenerateMath}
              disabled={isLoading}
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 disabled:bg-emerald-400"
            >
              Calculate Results
            </button>
          )}

          {role === 'admin' && (
            <button
              onClick={() => setIsBulkConfirmOpen(true)}
              disabled={isBulkGenerating || !academicYear || !term}
              title="Compile results for every class stream in the school for this year/term in one pass"
              className="bg-violet-600 hover:bg-violet-700 text-white px-6 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 disabled:bg-violet-400"
            >
              {isBulkGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <School className="w-4 h-4" />}
              Generate For Entire School
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
          {/* SUMMARY CARDS */}
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
            
            {/* Top Subject - Clickable */}
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
            
            {/* Needs Attention - Clickable */}
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

          {/* STUDENT RANKING TABLE */}
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

      {/* CUSTOM TAILWIND TOAST NOTIFICATION */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 bg-emerald-600 text-white px-5 py-3 rounded-lg shadow-xl flex items-center gap-3 animate-in fade-in slide-in-from-bottom-5 duration-300 z-50">
          <CheckCircle className="w-5 h-5" />
          <p className="text-sm font-medium">{toastMessage}</p>
        </div>
      )}

      {/* INTERACTIVE MODALS */}
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

      {/* BULK GENERATE CONFIRMATION MODAL */}
      {isBulkConfirmOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="font-bold text-slate-800">Generate Results For Entire School</h3>
              <button
                onClick={() => setIsBulkConfirmOpen(false)}
                className="text-slate-400 hover:text-slate-600"
                title="Close"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6">
              <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 p-4 rounded-xl">
                <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-sm text-amber-800">
                  This compiles term results for <span className="font-semibold">every class stream in the school</span> for
                  <span className="font-semibold"> {term} {academicYear}</span> — not just the class currently selected above.
                  Any class with no active students is skipped and reported, not treated as a failure.
                </p>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
              <button
                onClick={() => setIsBulkConfirmOpen(false)}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleBulkGenerate}
                disabled={isBulkGenerating}
                className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {isBulkGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <School className="w-4 h-4" />}
                Run For Whole School
              </button>
            </div>
          </div>
        </div>
      )}

      {/* BULK GENERATE RESULT MODAL */}
      {bulkResult && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
              <h3 className="font-bold text-slate-800 flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-emerald-600" />
                Bulk Compilation Results
              </h3>
              <button
                onClick={() => setBulkResult(null)}
                className="text-slate-400 hover:text-slate-600"
                title="Close results"
                aria-label="Close results"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto space-y-4">
              <p className="text-sm text-slate-700">{bulkResult.message}</p>

              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Class</th>
                      <th className="text-left px-3 py-2 font-medium">Students Assessed</th>
                      <th className="text-left px-3 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bulkResult.per_class.map((c) => (
                      <tr key={c.class_id} className="border-t border-slate-100">
                        <td className="px-3 py-2 text-slate-800">{c.class_name}</td>
                        <td className="px-3 py-2 text-slate-600">{c.students_assessed}</td>
                        <td className="px-3 py-2">
                          {c.error
                            ? <span className="text-amber-600 font-medium">{c.error}</span>
                            : <span className="text-emerald-600 font-medium">Compiled</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex justify-end shrink-0">
              <button
                onClick={() => setBulkResult(null)}
                className="px-4 py-2 text-sm font-medium bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}