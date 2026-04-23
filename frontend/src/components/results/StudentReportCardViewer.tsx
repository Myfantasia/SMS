import { useState, useEffect } from 'react';
import { Search, Printer, User, AlertCircle, Users, CheckCircle, Upload, Loader2 } from 'lucide-react';

interface LinkedChild {
  name: string;
  admNo: string;
}

interface StudentReportCardViewerProps {
  role: 'admin' | 'teacher' | 'student' | 'parent';
  // If a student logs in, pass their admission number here
  currentStudentAdmNo?: string; 
  // If a parent logs in, pass their array of children here
  linkedChildren?: LinkedChild[]; 
}

export default function StudentReportCardViewer({ role, currentStudentAdmNo, linkedChildren }: StudentReportCardViewerProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [reportData, setReportData] = useState<any>(null);

  // Filter States
  const [academicYear, setAcademicYear] = useState('');
  const [term, setTerm] = useState('');
  const [availableYears, setAvailableYears] = useState<string[]>([]);
  const [availableTerms, setAvailableTerms] = useState<string[]>([]);

  // State to track which child the parent is currently viewing
  const [selectedChildAdmNo, setSelectedChildAdmNo] = useState<string>('');

  // Auto-hide the toast after 3 seconds
  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  // ==========================================
  // FETCH FILTER OPTIONS ON MOUNT
  // ==========================================
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
        }
      } catch (err) {
        console.error("Failed to load filter options", err);
      }
    };
    fetchFilters();
  }, []);

  // ==========================================
  // ACTION: READ (Fetch Data)
  // ==========================================
  const fetchReportCard = async (searchQuery: string) => {
    if (!searchQuery.trim()) return;
    
    setIsLoading(true);
    setError(null);
    setReportData(null);
    
    try {
      const token = localStorage.getItem('firebase_dev_token');
      // Append filters if they are selected
      let url = `http://127.0.0.1:8000/api/results/report-card/?search=${encodeURIComponent(searchQuery)}`;
      if (academicYear) url += `&year=${academicYear}`;
      if (term) url += `&term=${term}`;

      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch report card.");
      }

      setReportData(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // ==========================================
  // ACTION: WRITE (Publish Data)
  // ==========================================
  const handlePublish = async () => {
    if (!reportData) return;
    setIsPublishing(true);
    setError(null);

    try {
      const token = localStorage.getItem('firebase_dev_token');
      const response = await fetch(`http://127.0.0.1:8000/api/results/report-card/`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          admNo: reportData.student.admNo,
          year: reportData.termInfo.year,
          term: reportData.termInfo.term
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to publish report card.");
      }

      setToastMessage("Report card published successfully!");
      // Update local state to show the published badge
      setReportData({ ...reportData, isPublished: true });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsPublishing(false);
    }
  };

  // ROLE-BASED AUTO-FETCHING LOGIC
  useEffect(() => {
    if (role === 'student' && currentStudentAdmNo) {
      fetchReportCard(currentStudentAdmNo);
    } 
    else if (role === 'parent' && linkedChildren && linkedChildren.length > 0) {
      setSelectedChildAdmNo(linkedChildren[0].admNo);
      fetchReportCard(linkedChildren[0].admNo);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, currentStudentAdmNo, linkedChildren]);

  // When a parent selects a different child from the dropdown, fetch that child's data
  useEffect(() => {
    if (role === 'parent' && selectedChildAdmNo) {
      fetchReportCard(selectedChildAdmNo);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChildAdmNo]);

  const handlePrint = () => {
    window.print();
  };

  // Determine what to search based on role
  const getSearchTarget = () => {
    if (role === 'student') return currentStudentAdmNo || '';
    if (role === 'parent') return selectedChildAdmNo || '';
    return searchTerm;
  };

  return (
    <div className="space-y-6 relative">
      
      {/* 1. CONTROLS BAR */}
      <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 flex flex-wrap gap-4 items-end justify-between print:hidden">
        
        {/* Term & Year Filters (Available to everyone) */}
        <div className="flex gap-4 flex-1">
          <div className="flex flex-col gap-1 min-w-35">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Academic Year</label>
            <select 
              value={academicYear} 
              onChange={(e) => setAcademicYear(e.target.value)}
              className="p-2 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
            >
              <option value="">Latest Available</option>
              {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>

          <div className="flex flex-col gap-1 min-w-35">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Term</label>
            <select 
              value={term} 
              onChange={(e) => setTerm(e.target.value)}
              className="p-2 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
            >
              <option value="">Latest Available</option>
              {availableTerms.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        {/* Dynamic Search / Action Area Based on Role */}
        <div className="flex gap-4 items-end w-full lg:w-auto mt-4 lg:mt-0 border-t lg:border-t-0 border-slate-200 pt-4 lg:pt-0">
          
          {/* Admins & Teachers: Search Bar */}
          {(role === 'admin' || role === 'teacher') && (
            <>
              <div className="flex flex-col gap-1 flex-1 min-w-62.5">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Search Student</label>
                <div className="relative">
                  <input 
                    type="text" 
                    placeholder="Admission No. or Name..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && fetchReportCard(getSearchTarget())}
                    className="w-full p-2 pl-9 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                </div>
              </div>
            </>
          )}

          {/* Parents: Child Selector */}
          {role === 'parent' && linkedChildren && linkedChildren.length > 0 && (
            <div className="flex flex-col gap-1 flex-1 min-w-50">
              <label className="text-xs font-semibold text-blue-800 uppercase tracking-wider">Select Child</label>
              <select 
                title='Select Child'
                value={selectedChildAdmNo}
                onChange={(e) => setSelectedChildAdmNo(e.target.value)}
                className="p-2 border border-blue-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
              >
                {linkedChildren.map(child => (
                  <option key={child.admNo} value={child.admNo}>
                    {child.name} ({child.admNo})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Generate Button for Everyone */}
          <button 
            onClick={() => fetchReportCard(getSearchTarget())}
            disabled={isLoading}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-md text-sm font-medium transition-colors mb-px disabled:bg-blue-400 whitespace-nowrap h-9.5"
          >
            Load Report
          </button>
        </div>

      </div>

      {/* ERROR STATE */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-md flex items-center gap-3 print:hidden animate-in fade-in">
          <AlertCircle className="w-5 h-5 text-red-500" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* 3. LOADING STATE */}
      {isLoading && (
        <div className="py-12 flex justify-center items-center flex-col gap-4 print:hidden animate-in fade-in">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="text-slate-500 text-sm">Compiling report card data...</p>
        </div>
      )}

      {/* 4. REPORT CARD DISPLAY AREA */}
      {!isLoading && reportData && (
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden print:border-none print:shadow-none animate-in fade-in slide-in-from-bottom-4 duration-300">
          
          {/* Action Bar - Hidden during print */}
          <div className="bg-slate-50 p-4 border-b border-slate-200 flex justify-between items-center print:hidden flex-wrap gap-4">
            <h3 className="font-semibold text-slate-800 flex items-center gap-2">
              <User className="w-4 h-4 text-blue-600"/> Official Report Card
            </h3>
            
            <div className="flex gap-3">
              {/* PUBLISH BUTTON LOGIC (Admins/Teachers Only) */}
              {(role === 'admin' || role === 'teacher') && (
                reportData.isPublished ? (
                  <span className="flex items-center gap-2 text-sm font-semibold text-emerald-700 bg-emerald-100 px-4 py-1.5 rounded-full">
                    <CheckCircle className="w-4 h-4" /> Published
                  </span>
                ) : (
                  <button 
                    onClick={handlePublish}
                    disabled={isPublishing}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-1.5 rounded-md flex items-center gap-2 text-sm font-medium transition-colors disabled:bg-emerald-400"
                  >
                    {isPublishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    Publish Report
                  </button>
                )
              )}

              <button 
                onClick={handlePrint}
                // Disable printing if it's a draft and the user is a student/parent
                disabled={(role === 'student' || role === 'parent') && !reportData.isPublished}
                className="text-slate-600 hover:text-blue-600 bg-white border border-slate-200 px-4 py-1.5 rounded-md flex items-center gap-2 text-sm font-medium transition-colors shadow-sm disabled:opacity-50"
              >
                <Printer className="w-4 h-4" /> Print PDF
              </button>
            </div>
          </div>

          {/* DRAFT RESTRICTION BLOCK FOR STUDENTS/PARENTS */}
          {(role === 'student' || role === 'parent') && !reportData.isPublished ? (
            <div className="p-12 text-center text-slate-500 print:hidden flex flex-col items-center">
              <AlertCircle className="w-12 h-12 mb-4 text-amber-500" />
              <h2 className="text-xl font-bold text-slate-800 mb-2">Results Pending</h2>
              <p className="max-w-md">
                The report card for {reportData.student.name} ({reportData.termInfo.term} {reportData.termInfo.year}) is currently being finalized and has not been published yet. Check back soon!
              </p>
            </div>
          ) : (
            
            /* The Printable Area (Only renders if published OR if user is Admin/Teacher) */
            <div className="p-8 max-w-4xl mx-auto bg-white print:p-0" id="printable-report-card">
              
              {/* Draft Watermark for Admins previewing unpublished data */}
              {!reportData.isPublished && (
                <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-45 opacity-5 pointer-events-none print:opacity-10">
                  <p className="text-[120px] font-black uppercase">DRAFT</p>
                </div>
              )}

              {/* Header */}
              <div className="text-center border-b-2 border-slate-800 pb-6 mb-6">
                <h1 className="text-2xl font-bold text-slate-900 uppercase tracking-wider">Acme International School</h1>
                <p className="text-slate-600">P.O Box 12345, Nairobi, Kenya | Email: info@acmeschool.com</p>
                <h2 className="text-xl font-bold mt-4 text-slate-800">
                  END OF {reportData.termInfo.term.toUpperCase()} ACADEMIC REPORT - {reportData.termInfo.year}
                </h2>
              </div>

              {/* Student Bio Row */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8 bg-slate-50 p-4 rounded-lg border border-slate-200 text-sm print:bg-transparent print:border-slate-800">
                <div><span className="text-slate-500 font-semibold block print:text-slate-800">Student Name:</span> <span className="font-bold text-slate-900">{reportData.student.name}</span></div>
                <div><span className="text-slate-500 font-semibold block print:text-slate-800">Admission No:</span> <span className="font-bold text-slate-900">{reportData.student.admNo}</span></div>
                <div><span className="text-slate-500 font-semibold block print:text-slate-800">Class Stream:</span> <span className="font-bold text-slate-900">{reportData.student.stream}</span></div>
                <div><span className="text-slate-500 font-semibold block print:text-slate-800">Curriculum:</span> <span className="font-bold text-slate-900">{reportData.student.curriculum}</span></div>
              </div>

              {/* CONDITIONAL RENDERING: 8-4-4 vs CBC */}
              {reportData.student.curriculum === '8-4-4' ? (
                <Layout844 data={reportData} />
              ) : (
                <LayoutCBC data={reportData} />
              )}

              {/* Signatures & Remarks Area */}
              <div className="mt-8 space-y-4 border-t border-slate-200 pt-6 print:border-slate-800">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div>
                    <p className="text-sm font-semibold text-slate-800 border-b border-slate-200 pb-1 mb-2 print:border-slate-800">Class Teacher's Remarks:</p>
                    <p className="text-sm text-slate-600 italic print:text-black">"{reportData.remarks.classTeacher}"</p>
                    <div className="mt-6 border-t border-dashed border-slate-400 w-48"><p className="text-xs text-slate-500 mt-1 print:text-black">Signature</p></div>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-800 border-b border-slate-200 pb-1 mb-2 print:border-slate-800">Principal's Remarks:</p>
                    <p className="text-sm text-slate-600 italic print:text-black">"{reportData.remarks.principal}"</p>
                    <div className="mt-6 border-t border-dashed border-slate-400 w-48"><p className="text-xs text-slate-500 mt-1 print:text-black">Signature</p></div>
                  </div>
                </div>
              </div>

            </div>
          )}
        </div>
      )}

      {/* SUCCESS TOAST */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 bg-emerald-600 text-white px-5 py-3 rounded-lg shadow-xl flex items-center gap-3 animate-in fade-in slide-in-from-bottom-5 duration-300 z-50">
          <CheckCircle className="w-5 h-5" />
          <p className="text-sm font-medium">{toastMessage}</p>
        </div>
      )}
    </div>
  );
}

// ==========================================
// SUB-COMPONENTS FOR CLEAN RENDERING
// ==========================================

function Layout844({ data }: { data: any }) {
  return (
    <div>
      <table className="w-full text-left text-sm text-slate-700 border-collapse mb-6 print:text-black">
        <thead className="bg-slate-100 text-slate-800 print:bg-slate-200">
          <tr>
            <th className="border border-slate-300 px-4 py-2 print:border-slate-800">Subject</th>
            <th className="border border-slate-300 px-4 py-2 text-center w-20 print:border-slate-800">CAT 1 (20)</th>
            <th className="border border-slate-300 px-4 py-2 text-center w-20 print:border-slate-800">CAT 2 (20)</th>
            <th className="border border-slate-300 px-4 py-2 text-center w-20 print:border-slate-800">Main (60)</th>
            <th className="border border-slate-300 px-4 py-2 text-center w-20 bg-slate-200 print:border-slate-800 print:bg-slate-300">Total (100)</th>
            <th className="border border-slate-300 px-4 py-2 text-center w-20 bg-slate-200 print:border-slate-800 print:bg-slate-300">Grade</th>
            <th className="border border-slate-300 px-4 py-2 print:border-slate-800">Teacher's Remark</th>
          </tr>
        </thead>
        <tbody>
          {data.subjects.map((sub: any, idx: number) => (
            <tr key={idx} className="hover:bg-slate-50">
              <td className="border border-slate-300 px-4 py-2 font-medium print:border-slate-800">{sub.name}</td>
              <td className="border border-slate-300 px-4 py-2 text-center print:border-slate-800">{sub.cat1}</td>
              <td className="border border-slate-300 px-4 py-2 text-center print:border-slate-800">{sub.cat2}</td>
              <td className="border border-slate-300 px-4 py-2 text-center print:border-slate-800">{sub.main}</td>
              <td className="border border-slate-300 px-4 py-2 text-center font-bold bg-slate-50 print:border-slate-800">{sub.total}</td>
              <td className="border border-slate-300 px-4 py-2 text-center font-bold bg-slate-50 print:border-slate-800">{sub.grade}</td>
              <td className="border border-slate-300 px-4 py-2 text-xs print:border-slate-800">{sub.remark}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* 8-4-4 Summary Block */}
      <div className="bg-slate-100 border border-slate-300 p-4 flex justify-between items-center rounded-md font-bold text-slate-800 print:bg-transparent print:border-slate-800">
        <div>Total Marks: <span className="text-blue-700 print:text-black">{data.summary.totalMarks} / {data.summary.outOf}</span></div>
        <div>Mean Grade: <span className="text-emerald-700 print:text-black">{data.summary.meanGrade}</span></div>
        <div>Class Position: <span className="text-slate-900">{data.summary.classPosition}</span></div>
      </div>
    </div>
  );
}

function LayoutCBC({ data }: { data: any }) {
  // Helper function to color-code the CBC performance levels
  const getBadgeStyle = (level: string) => {
    switch (level) {
      case 'Exceeding Expectation (EE)':
        return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case 'Meeting Expectation (ME)':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'Approaching Expectation (AE)':
        return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'Below Expectation (BE)':
        return 'bg-red-100 text-red-800 border-red-200';
      default:
        return 'bg-slate-100 text-slate-800 border-slate-200';
    }
  };

  return (
    <div>
      {/* CBC Grading Key / Legend */}
      <div className="flex flex-wrap gap-4 mb-4 text-xs font-medium text-slate-600 bg-slate-50 p-3 rounded-md border border-slate-200 print:bg-transparent print:border-slate-800 print:text-black">
        <span className="font-bold text-slate-800 uppercase mr-2">Key:</span>
        <span className="flex items-center gap-1"><div className="w-3 h-3 rounded-full bg-emerald-500"></div> EE - Exceeding Expectation</span>
        <span className="flex items-center gap-1"><div className="w-3 h-3 rounded-full bg-blue-500"></div> ME - Meeting Expectation</span>
        <span className="flex items-center gap-1"><div className="w-3 h-3 rounded-full bg-amber-500"></div> AE - Approaching Expectation</span>
        <span className="flex items-center gap-1"><div className="w-3 h-3 rounded-full bg-red-500"></div> BE - Below Expectation</span>
      </div>

      {/* The Competency Table */}
      <table className="w-full text-left text-sm text-slate-700 border-collapse mb-6 print:text-black">
        <thead className="bg-slate-100 text-slate-800 print:bg-slate-200">
          <tr>
            <th className="border border-slate-300 px-4 py-3 print:border-slate-800 w-1/3">Learning Area</th>
            <th className="border border-slate-300 px-4 py-3 print:border-slate-800 w-1/4">Performance Level</th>
            <th className="border border-slate-300 px-4 py-3 print:border-slate-800">Teacher's Specific Comment</th>
          </tr>
        </thead>
        <tbody>
          {/* Note: We map through data.subjects, but in CBC they are called Learning Areas */}
          {data.subjects.map((sub: any, idx: number) => (
            <tr key={idx} className="hover:bg-slate-50">
              <td className="border border-slate-300 px-4 py-3 font-semibold text-slate-800 print:border-slate-800">{sub.name}</td>
              <td className="border border-slate-300 px-4 py-3 print:border-slate-800">
                <span className={`px-2.5 py-1 rounded-full text-xs font-bold border ${getBadgeStyle(sub.performanceLevel || sub.grade)} print:border-none print:bg-transparent print:text-black print:p-0`}>
                  {sub.performanceLevel || sub.grade}
                </span>
              </td>
              <td className="border border-slate-300 px-4 py-3 text-sm italic print:border-slate-800">
                "{sub.remark}"
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* CBC Overall Summary Block */}
      <div className="bg-blue-50 border border-blue-200 p-4 rounded-md font-medium text-blue-900 print:bg-transparent print:border-slate-800 print:text-black">
        <p className="mb-2"><span className="font-bold">Overall General Comment:</span> {data.remarks.classTeacher}</p>
        <p><span className="font-bold">Areas Requiring Support:</span> {data.summary.needsSupport || "None currently. Learner is progressing well across core competencies."}</p>
      </div>
    </div>
  );
}