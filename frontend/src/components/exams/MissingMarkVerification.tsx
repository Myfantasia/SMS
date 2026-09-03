import React, { useState, useEffect } from 'react';
import { ShieldCheck, Filter, AlertTriangle, CheckCircle2, XCircle, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../libs/axiosInstance';
import SearchableSelect from '../common/SearchableSelect';

// --- Interfaces ---
interface SelectionOption {
  id: string | number;
  name: string;
}

interface VerificationMatrixRow {
  subject_id: number;
  subject_name: string;
  subject_code: string;
  teacher_id: number;
  teacher_name: string;
  status: 'Complete' | 'Partial' | 'Missing' | 'No Enrolled Students';
  expected_submissions: number;
  actual_submissions: number;
  missing_records_count: number;
}

interface VerificationData {
  class_name: string;
  exam_name: string;
  total_class_students: number;
  matrix: VerificationMatrixRow[];
}

const MissingMarksVerification: React.FC = () => {
  // Selection State
  const [selectedClass, setSelectedClass] = useState('');
  const [selectedExam, setSelectedExam] = useState('');

  // Dropdown Data
  const [availableClasses, setAvailableClasses] = useState<SelectionOption[]>([]);
  const [availableExams, setAvailableExams] = useState<SelectionOption[]>([]);

  // Verification Data
  const [verificationData, setVerificationData] = useState<VerificationData | null>(null);
  const [isLoading, setIsLoading] = useState(false);

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
        console.error("Error fetching selection data:", error);
        toast.error("Failed to load dropdown data.");
      }
    };
    fetchSelectionData();
  }, []);

  // 2. Fetch Verification Matrix
  useEffect(() => {
    const fetchVerificationData = async () => {
      if (!selectedClass || !selectedExam) return;

      setIsLoading(true);
      try {
        const response = await api.get('/api/exams/verify-marks/', {
          params: { class_id: selectedClass, exam_id: selectedExam }
        });
        setVerificationData(response.data);
      } catch (error: any) {
        console.error("Error fetching verification data:", error);
        const errorMsg = error.response?.data?.error || "Failed to load verification matrix.";
        toast.error(errorMsg);
        setVerificationData(null);
      } finally {
        setIsLoading(false);
      }
    };

    fetchVerificationData();
  }, [selectedClass, selectedExam]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">

      {/* Top Action Bar */}
      <div className="flex items-center gap-3 bg-white dark:bg-slate-900 p-4 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm dark:shadow-none">
        <div className="bg-indigo-100 dark:bg-indigo-500/10 p-2 rounded-lg">
          <ShieldCheck className="w-6 h-6 text-indigo-700 dark:text-indigo-400" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">Accountability Engine</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">Cross-reference master allocations against submitted marks.</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 p-4 rounded-lg flex flex-col md:flex-row gap-4">
        <div className="flex-1">
          <label htmlFor="class-select" className="flex text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1 items-center gap-1">
            <Filter className="w-3 h-3" /> Class Stream
          </label>
          <SearchableSelect
            id="class-select"
            aria-label="Class Stream"
            value={selectedClass}
            onChange={setSelectedClass}
            placeholder={availableClasses.length === 0 ? 'No classes found' : '-- Select Class --'}
            searchPlaceholder="Search class streams…"
            options={availableClasses.map((cls) => ({ value: String(cls.id), label: cls.name }))}
          />
        </div>
        <div className="flex-1">
          <label htmlFor="exam-select" className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Assessment</label>
          <select
            id="exam-select"
            className="w-full p-2.5 border border-slate-300 dark:border-slate-600 rounded-md focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 outline-none bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100"
            value={selectedExam}
            onChange={(e) => setSelectedExam(e.target.value)}
          >
            {availableExams.length === 0 && <option value="">No exams found</option>}
            {availableExams.map((exam) => (
              <option key={exam.id} value={exam.id}>{exam.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Verification Matrix Table */}
      <div className="border border-slate-200 dark:border-slate-700 rounded-lg shadow-sm dark:shadow-none bg-white dark:bg-slate-900 overflow-hidden">
        <div className="bg-slate-800 dark:bg-slate-800 text-white p-4 flex justify-between items-center">
          <h3 className="font-semibold flex items-center gap-2">
            Subject Submission Status
          </h3>
          {verificationData && (
            <span className="text-xs bg-slate-700 dark:bg-slate-700 px-3 py-1 rounded-full border border-slate-600 dark:border-slate-600">
              {verificationData.total_class_students} Active Students
            </span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">
                <th className="py-3 px-4 font-semibold w-48">Subject</th>
                <th className="py-3 px-4 font-semibold">Allocated Teacher</th>
                <th className="py-3 px-4 font-semibold text-center">Expected</th>
                <th className="py-3 px-4 font-semibold text-center">Submitted</th>
                <th className="py-3 px-4 font-semibold text-center">Missing</th>
                <th className="py-3 px-4 font-semibold text-center">Clearance Status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500 dark:text-slate-400">Running compliance check...</td>
                </tr>
              ) : !verificationData || verificationData.matrix.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500 dark:text-slate-400">No allocations found for this selection.</td>
                </tr>
              ) : (
                verificationData.matrix.map((row, idx) => (
                  <tr key={idx} className="border-b last:border-0 border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                    <td className="py-3 px-4 font-medium text-slate-800 dark:text-slate-100">
                      {row.subject_name} <span className="text-xs text-slate-400 dark:text-slate-500 ml-1">({row.subject_code})</span>
                    </td>
                    <td className="py-3 px-4 text-slate-700 dark:text-slate-200 font-medium">
                      {row.teacher_name}
                    </td>
                    <td className="py-3 px-4 text-center text-slate-500 dark:text-slate-400 font-mono">
                      {row.expected_submissions}
                    </td>
                    <td className="py-3 px-4 text-center text-slate-700 dark:text-slate-200 font-mono font-medium">
                      {row.actual_submissions}
                    </td>
                    <td className={`py-3 px-4 text-center font-mono font-bold ${row.missing_records_count > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-300 dark:text-slate-600'}`}>
                      {row.missing_records_count}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <div className="flex justify-center">
                        {row.status === 'Complete' && (
                          <span className="flex items-center gap-1 bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 px-2.5 py-1 rounded-full text-xs font-bold">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Complete
                          </span>
                        )}
                        {row.status === 'Partial' && (
                          <span className="flex items-center gap-1 bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 px-2.5 py-1 rounded-full text-xs font-bold">
                            <AlertTriangle className="w-3.5 h-3.5" /> Partial
                          </span>
                        )}
                        {row.status === 'Missing' && (
                          <span className="flex items-center gap-1 bg-red-100 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-2.5 py-1 rounded-full text-xs font-bold">
                            <XCircle className="w-3.5 h-3.5" /> Missing
                          </span>
                        )}
                        {row.status === 'No Enrolled Students' && (
                          <span className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 px-2.5 py-1 rounded-full text-xs font-bold" title="No student has an approved enrollment for this elective yet">
                            <Users className="w-3.5 h-3.5" /> No Enrollees
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
};

export default MissingMarksVerification;
