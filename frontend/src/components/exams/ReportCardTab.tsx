import React, { useState, useEffect } from 'react';
import { Printer, Save, User, FileText, QrCode, TrendingUp, AlertCircle, Users, X, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../libs/axiosInstance';
import SearchableSelect from '../common/SearchableSelect';

// --- Interfaces ---
interface SelectionOption {
  id: string | number;
  name: string;
}

interface StudentInfo {
  id: string;
  roll: string;
  student_name: string;
}

interface StudentTelemetry {
  class_deviation: number;
  historical_velocity: number;
  trajectory_state: string;
}

interface ReportCardData {
  student: { name: string; roll: string; class_name: string; curriculum: string };
  exam: { name: string; term: string; year: string };
  results: { subject: string; code: string; marks: number; grade: string; remarks: string; teacher: string }[];
  aggregates: { total: number; mean: number; grade: string; position: number | string };
  summary: { class_teacher_remark: string; principal_remark: string };
}

interface ReportCardsTabProps {
  role?: 'admin' | 'teacher' | 'student' | 'parent';
}

// Extracted so a single student's preview and a whole-class bulk-print run render from the
// exact same template — used for both the single-report view and the bulk-print list below.
const ReportCardDocument: React.FC<{ data: ReportCardData; breakAfter?: boolean }> = ({ data, breakAfter }) => (
  <div className={`bg-white border border-slate-200 rounded-lg shadow-lg p-10 print:shadow-none print:border-none print:m-0 print:p-0 ${breakAfter ? 'print:break-after-page' : ''}`}>

    {/* Document Header */}
    <div className="text-center border-b-4 border-slate-800 pb-6 mb-6">
      <h1 className="text-3xl font-black text-slate-900 uppercase tracking-widest">School Management System</h1>
      <p className="text-sm text-slate-500 uppercase tracking-widest mt-1">Official Student Academic Transcript</p>
      <div className="mt-4 flex justify-center items-center gap-4 text-sm font-semibold text-slate-700 bg-slate-50 py-2 rounded">
        <span>{data.exam.name}</span> •
        <span>{data.exam.term}</span> •
        <span>Academic Year {data.exam.year}</span>
      </div>
    </div>

    {/* Student Bio Section */}
    <div className="grid grid-cols-2 gap-x-12 gap-y-2 mb-8 text-sm">
      <div className="flex border-b border-dashed border-slate-300 pb-1">
        <span className="font-bold text-slate-600 w-32">Student Name:</span>
        <span className="font-bold text-slate-900">{data.student.name}</span>
      </div>
      <div className="flex border-b border-dashed border-slate-300 pb-1">
        <span className="font-bold text-slate-600 w-32">Admission No:</span>
        <span className="text-slate-900 font-mono">{data.student.roll}</span>
      </div>
      <div className="flex border-b border-dashed border-slate-300 pb-1">
        <span className="font-bold text-slate-600 w-32">Class / Stream:</span>
        <span className="text-slate-900">{data.student.class_name}</span>
      </div>
      <div className="flex border-b border-dashed border-slate-300 pb-1">
        <span className="font-bold text-slate-600 w-32">Curriculum:</span>
        <span className="text-slate-900">{data.student.curriculum}</span>
      </div>
    </div>

    {/* Subject Results Table */}
    <table className="w-full text-left border-collapse mb-8">
      <thead>
        <tr className="bg-slate-800 text-white text-sm uppercase tracking-wider">
          <th className="py-2 px-3 border border-slate-800">Subject</th>
          <th className="py-2 px-3 border border-slate-800 text-center w-20">Score</th>
          <th className="py-2 px-3 border border-slate-800 text-center w-20">Grade</th>
          <th className="py-2 px-3 border border-slate-800">Teacher's Remarks</th>
          <th className="py-2 px-3 border border-slate-800 text-slate-300 text-xs font-medium w-40">Tr. Initials</th>
        </tr>
      </thead>
      <tbody className="text-sm">
        {data.results.map((res, idx) => (
          <tr key={idx} className={idx % 2 === 0 ? 'bg-slate-50' : 'bg-white'}>
            <td className="py-2 px-3 border border-slate-300 font-medium text-slate-800">{res.subject}</td>
            <td className="py-2 px-3 border border-slate-300 text-center font-bold">{res.marks}</td>
            <td className="py-2 px-3 border border-slate-300 text-center font-bold text-blue-700">{res.grade}</td>
            <td className="py-2 px-3 border border-slate-300 text-slate-600 italic">{res.remarks}</td>
            <td className="py-2 px-3 border border-slate-300 text-slate-500 text-xs">{res.teacher}</td>
          </tr>
        ))}
      </tbody>
    </table>

    {/* Aggregates Box */}
    <div className="flex justify-end mb-8">
      <div className="border-2 border-slate-800 rounded p-4 w-72 bg-slate-50">
        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3 text-center border-b border-slate-300 pb-2">Term Aggregates</h4>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="font-semibold text-slate-600">Total Score:</span> <span className="font-bold text-slate-900">{data.aggregates.total}</span></div>
          <div className="flex justify-between"><span className="font-semibold text-slate-600">Mean Score:</span> <span className="font-bold text-slate-900">{data.aggregates.mean}</span></div>
          <div className="flex justify-between"><span className="font-semibold text-slate-600">Overall Grade:</span> <span className="font-bold text-blue-700 text-lg">{data.aggregates.grade}</span></div>
          {data.student.curriculum === '8-4-4' && (
            <div className="flex justify-between pt-2 border-t border-slate-300"><span className="font-bold text-slate-800">Class Position:</span> <span className="font-bold text-emerald-600">{data.aggregates.position}</span></div>
          )}
        </div>
      </div>
    </div>

    {/* Official Remarks & Signatures */}
    <div className="grid grid-cols-3 gap-6 text-sm mb-12">
      <div className="col-span-2 space-y-6">
        <div>
          <h4 className="font-bold text-slate-800 border-b border-slate-800 pb-1 mb-2">Class Teacher's Remarks</h4>
          <p className="text-slate-700 italic min-h-12">{data.summary.class_teacher_remark || "No remarks provided."}</p>
          <div className="border-t border-dotted border-slate-400 w-48 mt-8 pt-1 text-xs text-slate-500">Sign & Date</div>
        </div>
        <div>
          <h4 className="font-bold text-slate-800 border-b border-slate-800 pb-1 mb-2">Principal's Remarks</h4>
          <p className="text-slate-700 italic min-h-12">{data.summary.principal_remark || "No remarks provided."}</p>
          <div className="border-t border-dotted border-slate-400 w-48 mt-8 pt-1 text-xs text-slate-500">Sign & Official Stamp</div>
        </div>
      </div>

      {/* Dynamic QR Code Verification Placeholder */}
      <div className="flex flex-col items-end justify-start">
        <div className="p-2 border-2 border-slate-200 rounded flex items-center justify-center text-slate-300 bg-slate-50 w-32 h-32">
          <QrCode className="w-16 h-16" />
        </div>
        <p className="text-[10px] text-slate-400 text-right mt-2 w-32 leading-tight">Scan to verify document authenticity</p>
      </div>
    </div>

    <div className="text-center text-xs text-slate-400 mt-12 pt-4 border-t border-slate-200">
      Generated securely by the School Management System. This document is not valid without an official stamp.
    </div>
  </div>
);

const ReportCardsTab: React.FC<ReportCardsTabProps> = ({ role = 'teacher' }) => {
  // Dropdown Selections
  const [selectedClass, setSelectedClass] = useState('');
  const [selectedExam, setSelectedExam] = useState('');
  const [selectedStudent, setSelectedStudent] = useState<string | null>(null);

  // Data States
  const [availableClasses, setAvailableClasses] = useState<SelectionOption[]>([]);
  const [availableExams, setAvailableExams] = useState<SelectionOption[]>([]);
  const [students, setStudents] = useState<StudentInfo[]>([]);
  
  // Active Report Card State
  const [reportData, setReportData] = useState<ReportCardData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Bulk (whole-class) print state
  const [bulkReportCards, setBulkReportCards] = useState<ReportCardData[] | null>(null);
  const [isBulkLoading, setIsBulkLoading] = useState(false);

  // Form States for Manual Remarks
  const [ctRemark, setCtRemark] = useState('');
  const [prRemark, setPrRemark] = useState('');

  // Step 5 Telemetry & Recommendation Engine Data States
  const [activeTelemetry, setActiveTelemetry] = useState<StudentTelemetry | null>(null);
  const [smartBankOptions, setSmartBankOptions] = useState<string[]>([]);
  const [fullClassRosterData, setFullClassRosterData] = useState<any[]>([]);

  // 1. Fetch Dropdowns on Mount
  useEffect(() => {
    const fetchSelectionData = async () => {
      try {
        const response = await api.get('/api/exams/selection-data/');
        setAvailableClasses(response.data.classes);
        setAvailableExams(response.data.exams);
        if (response.data.classes.length > 0) setSelectedClass(response.data.classes[0].id.toString());
        if (response.data.exams.length > 0) setSelectedExam(response.data.exams[0].id.toString());
      } catch (error) {
        console.error(error);
        toast.error("Failed to load dropdown data.");
      }
    };
    fetchSelectionData();
  }, []);

  // 2. ✨ STEP 5 UPGRADE: Fetch complete roster packet with integrated telemetry tracking maps
  useEffect(() => {
    const fetchRosterWithTelemetry = async () => {
      if (!selectedClass || !selectedExam) return;
      try {
        const response = await api.get('/api/exams/report-card/save-summary/', {
          params: { class_id: selectedClass, exam_id: selectedExam }
        });
        
        // Save the raw multi-dimensional roster telemetry array directly into the local execution memory cache
        setFullClassRosterData(response.data.roster || []);
        
        // Map the tracking payload down to extract names for the fast selection menu list
        const extractedRoster = (response.data.roster || []).map((item: any) => ({
          id: item.student_id,
          roll: item.student_roll,
          student_name: item.student_name
        }));
        
        setStudents(extractedRoster);
        setSelectedStudent(null); 
        setReportData(null);
        setActiveTelemetry(null);
        setSmartBankOptions([]);
      } catch (error: any) {
        console.error("Error fetching telemetry roster:", error);
        const errorMsg = error.response?.data?.error || "Failed to load student compliance roster.";
        toast.error(errorMsg);
        setStudents([]);
        setFullClassRosterData([]);
      }
    };
    fetchRosterWithTelemetry();
  }, [selectedClass, selectedExam]);

  // 3. Fetch specific Report Card Data when a Student is clicked
  useEffect(() => {
    const fetchReportCard = async () => {
      if (!selectedStudent || !selectedExam) return;
      setIsLoading(true);
      try {
        const response = await api.get(`/api/exams/report-card/${selectedExam}/${selectedStudent}/`);
        setReportData(response.data);
        setCtRemark(response.data.summary.class_teacher_remark);
        setPrRemark(response.data.summary.principal_remark);
      } catch (error: any) {
        console.error(error);
        const errorMsg = error.response?.data?.error || "Failed to generate report card. Ensure marks have been entered.";
        toast.error(errorMsg);
        setReportData(null);
      } finally {
        setIsLoading(false);
      }
    };
    fetchReportCard();
  }, [selectedStudent, selectedExam]);

  // 4. Handle student selection changes to extract cached panel metrics instantly
  const handleSelectStudent = (studentId: string) => {
    setBulkReportCards(null); // leaving bulk mode when a single student is picked
    setSelectedStudent(studentId);

    // Intercept matching analytical data shapes inside in-memory matrix records
    const studentMetrics = fullClassRosterData.find(item => item.student_id === studentId);
    if (studentMetrics) {
      setActiveTelemetry({
        class_deviation: studentMetrics.performance.class_deviation,
        historical_velocity: studentMetrics.performance.historical_velocity,
        trajectory_state: studentMetrics.performance.trajectory_state
      });
      setSmartBankOptions(studentMetrics.smart_remark_bank || []);
    } else {
      setActiveTelemetry(null);
      setSmartBankOptions([]);
    }
  };

  // 5. Save Manual Remarks Handler
  const handleSaveRemarks = async () => {
    if (!selectedStudent || !selectedExam) return;
    setIsSaving(true);
    try {
      await api.post('/api/exams/report-card/save-summary/', {
        student_id: selectedStudent,
        exam_id: selectedExam,
        class_teacher_remark: ctRemark,
        principal_remark: prRemark
      });
      toast.success('Remarks saved and added to report card!');
      
      if (reportData) {
        setReportData({
          ...reportData,
          summary: { class_teacher_remark: ctRemark, principal_remark: prRemark }
        });
      }

      // Synchronize changes to locally cached records to maintain tracking coherence
      setFullClassRosterData(prev => prev.map(item => 
        item.student_id === selectedStudent 
          ? { ...item, saved_remarks: { class_teacher_remark: ctRemark, principal_remark: prRemark } }
          : item
      ));
    } catch (error: any) {
      console.error(error);
      const errorMsg = error.response?.data?.error || 'Failed to save remarks.';
      toast.error(errorMsg);
    } finally {
      setIsSaving(false);
    }
  };

  // 6. Bulk (whole-class) Print Handler
  const handlePrintClass = async () => {
    if (!selectedClass || !selectedExam) return;
    setSelectedStudent(null); // leaving single-student mode
    setReportData(null);
    setIsBulkLoading(true);
    try {
      const response = await api.get(`/api/exams/report-card/class/${selectedExam}/${selectedClass}/`);
      const cards: ReportCardData[] = response.data.report_cards || [];
      if (cards.length === 0) {
        toast.error('No students with entered marks were found for this class/assessment.');
        setBulkReportCards(null);
        return;
      }
      setBulkReportCards(cards);
    } catch (error: any) {
      console.error(error);
      toast.error(error.response?.data?.error || 'Failed to load report cards for this class.');
      setBulkReportCards(null);
    } finally {
      setIsBulkLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 relative">
      
      {/* ================= HEADER & FILTERS (HIDDEN ON PRINT) ================= */}
      <div className="print:hidden space-y-4 mb-6">
        <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-blue-100 p-2 rounded-lg"><FileText className="w-6 h-6 text-blue-700" /></div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">Report Cards</h2>
              <p className="text-sm text-slate-500">Review, add remarks, and print official documents.</p>
            </div>
          </div>
          <div className="flex gap-4 w-full md:w-auto">
            <div className="flex-1 md:w-48">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 block">Class Stream</label>
              <SearchableSelect
                aria-label="Class Stream"
                value={selectedClass}
                onChange={setSelectedClass}
                searchPlaceholder="Search class streams…"
                options={availableClasses.map(c => ({ value: String(c.id), label: c.name }))}
              />
            </div>
            <div className="flex-1 md:w-48">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 block">Assessment</label>
              <select className="w-full p-2 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 outline-none bg-white" aria-label="Assessment"
                value={selectedExam} onChange={(e) => setSelectedExam(e.target.value)}>
                {availableExams.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <div className="flex items-end">
              <button
                onClick={handlePrintClass}
                disabled={isBulkLoading || !selectedClass || !selectedExam}
                title="Load and print every student's report card in this class at once"
                className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded transition-colors disabled:opacity-50 whitespace-nowrap"
              >
                {isBulkLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
                Print Entire Class
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ================= MAIN LAYOUT ================= */}
      <div className="flex flex-col lg:flex-row gap-6 flex-1">
        
        {/* LEFT SIDEBAR: Student List (HIDDEN ON PRINT) */}
        <div className="print:hidden w-full lg:w-1/4 bg-white border border-slate-200 rounded-lg shadow-sm flex flex-col h-175">
          <div className="bg-slate-800 text-white p-3 rounded-t-lg flex justify-between items-center">
            <h3 className="font-semibold flex items-center gap-2"><User className="w-4 h-4" /> Class Roster</h3>
            <span className="text-xs bg-slate-700 px-2 py-1 rounded">{students.length}</span>
          </div>
          <div className="overflow-y-auto flex-1 p-2 space-y-1">
            {students.length === 0 ? (
              <p className="text-sm text-center text-slate-400 mt-10">Select a class parameters to load records.</p>
            ) : (
              // Enforce customized extraction handler here to capture telemetry fields
              students.map(student => (
                <button
                  key={student.id}
                  onClick={() => handleSelectStudent(student.id)}
                  className={`w-full text-left px-3 py-3 rounded-md text-sm font-medium transition-colors border ${
                    selectedStudent === student.id 
                    ? 'bg-blue-50 border-blue-200 text-blue-800 shadow-sm' 
                    : 'bg-white border-transparent text-slate-600 hover:bg-slate-50 hover:border-slate-200'
                  }`}
                >
                  <p>{student.student_name}</p>
                  <p className="text-xs text-slate-400 font-mono mt-0.5">{student.roll}</p>
                </button>
              ))
            )}
          </div>
        </div>

        {/* RIGHT AREA: Report Card Preview & Tools */}
        <div className="flex-1 flex flex-col space-y-4">
          
          {/* REMARKS EDITOR & PRINT BUTTON (HIDDEN ON PRINT) */}
          {reportData && (
            <div className="print:hidden bg-white border border-slate-200 rounded-lg shadow-sm p-4">
              <div className="flex justify-between items-center mb-3">
                <h3 className="font-semibold text-slate-800">Final Official Remarks</h3>
                <div className="flex gap-2">
                  <button onClick={handleSaveRemarks} disabled={isSaving} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-70 transition font-medium">
                    <Save className="w-4 h-4" /> {isSaving ? 'Saving...' : 'Save Remarks'}
                  </button>
                  <button onClick={() => window.print()} className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white text-sm rounded hover:bg-slate-900 transition font-medium">
                    <Printer className="w-4 h-4" /> Print Document
                  </button>
                </div>
              </div>

              {/* ✨ STEP 5: Telemetry Feedback Dashboard Panel */}
              {activeTelemetry && (
                <div className="flex gap-6 mb-4 p-3.5 bg-slate-50 border border-slate-200 rounded-lg text-sm">
                  <div className="flex items-center gap-2.5">
                    <div className="bg-indigo-100 p-1.5 rounded-md">
                      <TrendingUp className="w-4 h-4 text-indigo-700" />
                    </div>
                    <div>
                      <span className="text-slate-500 block text-xs font-semibold uppercase tracking-wider">Class Deviation</span>
                      <span className={`font-bold ${activeTelemetry.class_deviation >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {activeTelemetry.class_deviation > 0 ? '+' : ''}{activeTelemetry.class_deviation}
                      </span>
                    </div>
                  </div>
                  <div className="border-l border-slate-200 pl-6 flex items-center gap-2.5">
                    <div className={`p-1.5 rounded-md ${activeTelemetry.historical_velocity >= 0 ? 'bg-emerald-100' : 'bg-rose-100'}`}>
                      <User className={`w-4 h-4 ${activeTelemetry.historical_velocity >= 0 ? 'text-emerald-700' : 'text-rose-700'}`} />
                    </div>
                    <div>
                      <span className="text-slate-500 block text-xs font-semibold uppercase tracking-wider">Historical Velocity</span>
                      <span className={`font-bold ${activeTelemetry.historical_velocity >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {activeTelemetry.historical_velocity > 0 ? '+' : ''}{activeTelemetry.historical_velocity} 
                        <span className="text-xs font-medium text-slate-500 ml-1">({activeTelemetry.trajectory_state})</span>
                      </span>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide">Class Teacher's Remark</label>
                  
                  {/* ✨ STEP 5: Integrated Smart Vocabulary Recommendation Options Dropdown */}
                  <select 
                    className="w-full p-2 border border-slate-300 rounded text-sm bg-slate-50 focus:outline-none font-medium text-slate-700"
                    onChange={(e) => {
                      if (e.target.value) setCtRemark(e.target.value);
                    }}
                  >
                    <option value="">-- Use Dynamic Smart Bank Recommendation --</option>
                    {smartBankOptions.map((opt, i) => (
                      <option key={i} value={opt}>{opt}</option>
                    ))}
                  </select>

                  <textarea 
                    value={ctRemark} 
                    onChange={e => setCtRemark(e.target.value)} 
                    placeholder="Type customized summaries or select from option recommendations above..." 
                    className="w-full p-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none min-h-20" 
                  />
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide">Principal's Remark</label>
                  <input 
                    type="text" 
                    value={prRemark} 
                    onChange={e => setPrRemark(e.target.value)} 
                    placeholder={role === 'admin' ? "e.g., Excellent performance, keep it up." : "Locked down for school principal access only"} 
                    className="w-full p-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed min-h-10 mt-9 md:mt-0" 
                    disabled={role !== 'admin'}
                  />
                  <div className="bg-slate-50 p-2 rounded text-xs text-slate-400 flex items-center gap-1.5 border border-slate-100">
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>Transcripts remain editable until official class results are declared.</span>
                  </div>
                </div>
              </div>

            </div>
          )}

          {/* BULK PRINT TOOLBAR (HIDDEN ON PRINT) */}
          {bulkReportCards && (
            <div className="print:hidden bg-white border border-slate-200 rounded-lg shadow-sm p-4 flex justify-between items-center">
              <div>
                <h3 className="font-semibold text-slate-800">Whole-Class Print Preview</h3>
                <p className="text-sm text-slate-500">{bulkReportCards.length} report card(s) ready — each prints on its own page.</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => window.print()} className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white text-sm rounded hover:bg-slate-900 transition font-medium">
                  <Printer className="w-4 h-4" /> Print All
                </button>
                <button onClick={() => setBulkReportCards(null)} title="Close bulk preview" aria-label="Close bulk preview" className="flex items-center gap-2 px-3 py-2 border border-slate-200 text-slate-600 text-sm rounded hover:bg-slate-50 transition font-medium">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* ================= THE ACTUAL REPORT CARD(S) (VISIBLE ON PRINT) ================= */}
          {bulkReportCards ? (
            <div className="space-y-6 print:space-y-0">
              {bulkReportCards.map((card, idx) => (
                <ReportCardDocument key={card.student.roll} data={card} breakAfter={idx < bulkReportCards.length - 1} />
              ))}
            </div>
          ) : !selectedStudent ? (
            <div className="print:hidden border-2 border-dashed border-slate-200 rounded-lg h-96 flex flex-col items-center justify-center text-slate-400 bg-white">
              <FileText className="w-12 h-12 mb-3 text-slate-300" />
              <p className="font-medium text-slate-600 text-lg">No Document Loaded</p>
              <p className="text-sm text-slate-400">Select a student from the class roster list panel to generate their report card template, or use "Print Entire Class" above.</p>
            </div>
          ) : isLoading ? (
            <div className="print:hidden flex justify-center items-center h-96 bg-white border border-slate-200 rounded-lg"><p className="text-slate-500 font-medium">Assembling student database marks card record...</p></div>
          ) : reportData ? (
            <ReportCardDocument data={reportData} />
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default ReportCardsTab;