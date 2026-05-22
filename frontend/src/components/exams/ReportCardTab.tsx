import React, { useState, useEffect } from 'react';
import { Printer, Save, User, FileText, QrCode } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../libs/axiosInstance';

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

interface ReportCardData {
  student: { name: string; roll: string; class_name: string; curriculum: string };
  exam: { name: string; term: string; year: string };
  results: { subject: string; code: string; marks: number; grade: string; remarks: string; teacher: string }[];
  aggregates: { total: number; mean: number; grade: string; position: number | string };
  summary: { class_teacher_remark: string; principal_remark: string };
}

const ReportCardsTab: React.FC = () => {
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

  // Form States for Manual Remarks
  const [ctRemark, setCtRemark] = useState('');
  const [prRemark, setPrRemark] = useState('');

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

  // 2. Fetch Student Roster when Class changes
  useEffect(() => {
    const fetchRoster = async () => {
      if (!selectedClass) return;
      try {
        // Reusing the rapid-entry endpoint to cleanly fetch the class roster
        const response = await api.get('/api/exams/rapid-entry/', {
          params: { class_id: selectedClass }
        });
        setStudents(response.data.students);
        setSelectedStudent(null); // Reset selected student when class changes
        setReportData(null);
      } catch (error) {
        console.error(error);
        toast.error("Failed to load student roster.");
      }
    };
    fetchRoster();
  }, [selectedClass]);

  // 3. Fetch specific Report Card Data when a Student is clicked
  useEffect(() => {
    const fetchReportCard = async () => {
      if (!selectedStudent || !selectedExam) return;
      setIsLoading(true);
      try {
        const response = await api.get(`/api/exams/report-card/${selectedExam}/${selectedStudent}/`);
        setReportData(response.data);
        // Pre-fill the textboxes with existing remarks (if any)
        setCtRemark(response.data.summary.class_teacher_remark);
        setPrRemark(response.data.summary.principal_remark);
      } catch (error) {
        console.error(error);
        toast.error("Failed to generate report card. Ensure marks have been entered.");
        setReportData(null);
      } finally {
        setIsLoading(false);
      }
    };
    fetchReportCard();
  }, [selectedStudent, selectedExam]);

  // 4. Save Manual Remarks Handler
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
      
      // Update local state to reflect changes instantly on the preview
      if (reportData) {
        setReportData({
          ...reportData,
          summary: { class_teacher_remark: ctRemark, principal_remark: prRemark }
        });
      }
    } catch (error) {
      console.error(error);
      toast.error('Failed to save remarks.');
    } finally {
      setIsSaving(false);
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
              <select className="w-full p-2 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 outline-none" aria-label="Class Stream"
                value={selectedClass} onChange={(e) => setSelectedClass(e.target.value)}>
                {availableClasses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="flex-1 md:w-48">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 block">Assessment</label>
              <select className="w-full p-2 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 outline-none" aria-label="Assessment"
                value={selectedExam} onChange={(e) => setSelectedExam(e.target.value)}>
                {availableExams.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
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
              <p className="text-sm text-center text-slate-400 mt-10">Select a class to load students.</p>
            ) : (
              students.map(student => (
                <button
                  key={student.id}
                  onClick={() => setSelectedStudent(student.id)}
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
                  <button onClick={handleSaveRemarks} disabled={isSaving} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-70 transition">
                    <Save className="w-4 h-4" /> {isSaving ? 'Saving...' : 'Save Remarks'}
                  </button>
                  <button onClick={() => window.print()} className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white text-sm rounded hover:bg-slate-900 transition">
                    <Printer className="w-4 h-4" /> Print Document
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Class Teacher's Remark</label>
                  <input type="text" value={ctRemark} onChange={e => setCtRemark(e.target.value)} placeholder="e.g., A hardworking student..." className="w-full p-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Principal's Remark</label>
                  <input type="text" value={prRemark} onChange={e => setPrRemark(e.target.value)} placeholder="e.g., Excellent performance, keep it up." className="w-full p-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
              </div>
            </div>
          )}

          {/* ================= THE ACTUAL REPORT CARD (VISIBLE ON PRINT) ================= */}
          {!selectedStudent ? (
            <div className="print:hidden border-2 border-dashed border-slate-200 rounded-lg h-96 flex flex-col items-center justify-center text-slate-400 bg-white">
              <FileText className="w-12 h-12 mb-3 text-slate-300" />
              <p>Select a student from the roster to generate their report card.</p>
            </div>
          ) : isLoading ? (
            <div className="print:hidden flex justify-center items-center h-96 bg-white border border-slate-200 rounded-lg"><p className="text-slate-500">Generating report card...</p></div>
          ) : reportData ? (
            <div className="bg-white border border-slate-200 rounded-lg shadow-lg p-10 print:shadow-none print:border-none print:m-0 print:p-0">
              
              {/* Document Header */}
              <div className="text-center border-b-4 border-slate-800 pb-6 mb-6">
                <h1 className="text-3xl font-black text-slate-900 uppercase tracking-widest">School Management System</h1>
                <p className="text-sm text-slate-500 uppercase tracking-widest mt-1">Official Student Academic Transcript</p>
                <div className="mt-4 flex justify-center items-center gap-4 text-sm font-semibold text-slate-700 bg-slate-50 py-2 rounded">
                  <span>{reportData.exam.name}</span> • 
                  <span>{reportData.exam.term}</span> • 
                  <span>Academic Year {reportData.exam.year}</span>
                </div>
              </div>

              {/* Student Bio Section */}
              <div className="grid grid-cols-2 gap-x-12 gap-y-2 mb-8 text-sm">
                <div className="flex border-b border-dashed border-slate-300 pb-1">
                  <span className="font-bold text-slate-600 w-32">Student Name:</span>
                  <span className="font-bold text-slate-900">{reportData.student.name}</span>
                </div>
                <div className="flex border-b border-dashed border-slate-300 pb-1">
                  <span className="font-bold text-slate-600 w-32">Admission No:</span>
                  <span className="text-slate-900 font-mono">{reportData.student.roll}</span>
                </div>
                <div className="flex border-b border-dashed border-slate-300 pb-1">
                  <span className="font-bold text-slate-600 w-32">Class / Stream:</span>
                  <span className="text-slate-900">{reportData.student.class_name}</span>
                </div>
                <div className="flex border-b border-dashed border-slate-300 pb-1">
                  <span className="font-bold text-slate-600 w-32">Curriculum:</span>
                  <span className="text-slate-900">{reportData.student.curriculum}</span>
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
                  {reportData.results.map((res, idx) => (
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
                    <div className="flex justify-between"><span className="font-semibold text-slate-600">Total Score:</span> <span className="font-bold text-slate-900">{reportData.aggregates.total}</span></div>
                    <div className="flex justify-between"><span className="font-semibold text-slate-600">Mean Score:</span> <span className="font-bold text-slate-900">{reportData.aggregates.mean}</span></div>
                    <div className="flex justify-between"><span className="font-semibold text-slate-600">Overall Grade:</span> <span className="font-bold text-blue-700 text-lg">{reportData.aggregates.grade}</span></div>
                    {reportData.student.curriculum === '8-4-4' && (
                      <div className="flex justify-between pt-2 border-t border-slate-300"><span className="font-bold text-slate-800">Class Position:</span> <span className="font-bold text-emerald-600">{reportData.aggregates.position}</span></div>
                    )}
                  </div>
                </div>
              </div>

              {/* Official Remarks & Signatures */}
              <div className="grid grid-cols-3 gap-6 text-sm mb-12">
                <div className="col-span-2 space-y-6">
                  <div>
                    <h4 className="font-bold text-slate-800 border-b border-slate-800 pb-1 mb-2">Class Teacher's Remarks</h4>
                    <p className="text-slate-700 italic min-h-12">{reportData.summary.class_teacher_remark || "No remarks provided."}</p>
                    <div className="border-t border-dotted border-slate-400 w-48 mt-8 pt-1 text-xs text-slate-500">Sign & Date</div>
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-800 border-b border-slate-800 pb-1 mb-2">Principal's Remarks</h4>
                    <p className="text-slate-700 italic min-h-123">{reportData.summary.principal_remark || "No remarks provided."}</p>
                    <div className="border-t border-dotted border-slate-400 w-48 mt-8 pt-1 text-xs text-slate-500">Sign & Official Stamp</div>
                  </div>
                </div>
                
                {/* Dynamic QR Code Verification Placeholder */}
                <div className="flex flex-col items-end justify-start">
                  <div className="p-2 border-2 border-slate-200 rounded flex items-center justify-center text-slate-300 bg-slate-50 w-32 h-32">
                    {/* Note: We use a placeholder icon here to avoid forcing an npm install. 
                        In production, replace this with <QRCode value={`Verify: ${reportData.student.roll}`} /> from 'react-qr-code' */}
                    <QrCode className="w-16 h-16" />
                  </div>
                  <p className="text-[10px] text-slate-400 text-right mt-2 w-32 leading-tight">Scan to verify document authenticity</p>
                </div>
              </div>

              <div className="text-center text-xs text-slate-400 mt-12 pt-4 border-t border-slate-200">
                Generated securely by the School Management System. This document is not valid without an official stamp.
              </div>

            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default ReportCardsTab;