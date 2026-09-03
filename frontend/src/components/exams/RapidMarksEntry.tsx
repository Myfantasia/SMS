import React, { useState, useEffect } from 'react';
import type { FormEvent } from 'react';
import { Save, AlertCircle, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../libs/axiosInstance';
import SearchableSelect from '../common/SearchableSelect';

// --- Interfaces mapping to our Django Serializers ---
interface StudentInfo {
  id: string;
  roll: string;
  student_name: string;
}

interface MarkEntry {
  marks: string;
  remarks: string;
}

interface SelectionOption {
  id: string | number;
  name: string;
}

interface ClassOption extends SelectionOption {
  grade_id: number;
}

interface SubjectOption extends SelectionOption {
  is_core: boolean;
  grade_ids: number[];
}

interface ExamOption extends SelectionOption {
  total_marks: number;
}

const RapidMarksEntry: React.FC = () => {
  // Selection State
  const [selectedClass, setSelectedClass] = useState('');
  const [selectedSubject, setSelectedSubject] = useState('');
  const [selectedExam, setSelectedExam] = useState('');

  // Dropdown Data State (Fetched from Backend)
  const [availableClasses, setAvailableClasses] = useState<ClassOption[]>([]);
  const [allSubjects, setAllSubjects] = useState<SubjectOption[]>([]);
  const [availableExams, setAvailableExams] = useState<ExamOption[]>([]);

  // Data State
  const [students, setStudents] = useState<StudentInfo[]>([]);
  const [marksData, setMarksData] = useState<Record<string, MarkEntry>>({});
  const [isSaving, setIsSaving] = useState(false);

  // Roster-fetch response tells us the real max score and whether the selected subject is
  // an elective (in which case only enrolled students are shown, not the whole class).
  const [totalMarks, setTotalMarks] = useState<number>(100);
  const [isCoreSubject, setIsCoreSubject] = useState<boolean>(true);

  // --- 1. FETCH DROPDOWN SELECTIONS ON MOUNT ---
  useEffect(() => {
    const fetchSelectionData = async () => {
      try {
        const response = await api.get('/api/exams/selection-data/');
        setAvailableClasses(response.data.classes);
        setAllSubjects(response.data.subjects);
        setAvailableExams(response.data.exams);
      } catch (error) {
        console.error("Error fetching selection data:", error);
        toast.error("Failed to load dropdown data.");
      }
    };
    fetchSelectionData();
  }, []);

  // Only show subjects actually taught to the selected class's grade, instead of every
  // subject in the school regardless of relevance.
  const selectedClassGradeId = availableClasses.find(c => String(c.id) === selectedClass)?.grade_id;
  const availableSubjects = selectedClassGradeId
    ? allSubjects.filter(s => s.grade_ids.includes(selectedClassGradeId))
    : allSubjects;

  // Drop a previously-selected subject that doesn't apply to the newly selected class
  // (e.g. switching from a senior grade to a junior one that doesn't teach it).
  useEffect(() => {
    if (selectedSubject && !availableSubjects.some(s => String(s.id) === selectedSubject)) {
      setSelectedSubject('');
      setStudents([]);
      setMarksData({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClass, allSubjects]);

  // --- 2. FETCH ROSTER & EXISTING MARKS ---
  useEffect(() => {
    const fetchRosterAndMarks = async () => {
      // Only run the fetch if ALL three dropdowns have a value selected
      if (selectedClass && selectedSubject && selectedExam) {
        try {
          const response = await api.get('/api/exams/rapid-entry/', {
            params: {
              class_id: selectedClass,
              subject_id: selectedSubject,
              exam_id: selectedExam
            }
          });

          const fetchedStudents: StudentInfo[] = response.data.students;
          const existingMarks = response.data.existing_marks; // Marks saved previously

          setTotalMarks(response.data.total_marks ?? 100);
          setIsCoreSubject(response.data.is_core_subject ?? true);
          setStudents(fetchedStudents);

          // Initialize the input state dictionary and pre-fill any existing drafts
          const initialMarks: Record<string, MarkEntry> = {};
          fetchedStudents.forEach(student => {
            // Check if this student already has a mark saved in the database
            const existing = existingMarks.find((em: any) => em.student === student.id);

            initialMarks[student.id] = {
              marks: existing ? existing.marks_obtained : '',
              remarks: existing ? (existing.teacher_remarks || '') : ''
            };
          });

          setMarksData(initialMarks);

        } catch (error: any) {
          console.error("Error fetching roster:", error);
          // UPDATED: Now dynamically shows the backend 403 Access Denied messages
          const errorMsg = error.response?.data?.error || "Failed to load student roster.";
          toast.error(errorMsg);
          setStudents([]);
          setMarksData({});
        }
      }
    };

    fetchRosterAndMarks();
  }, [selectedClass, selectedSubject, selectedExam]);

  // --- HANDLERS ---

  const handleDropdownChange = (
    setter: React.Dispatch<React.SetStateAction<string>>,
    value: string
  ) => {
    setter(value);
    // Immediately clear the grid when a selection changes so old data isn't displayed
    // while waiting for the new data to fetch (or if they select an empty option).
    setStudents([]);
    setMarksData({});
  };

  const handleMarkChange = (studentId: string, value: string) => {
    setMarksData(prev => ({
      ...prev,
      [studentId]: { ...prev[studentId], marks: value }
    }));
  };

  const handleRemarkChange = (studentId: string, value: string) => {
    setMarksData(prev => ({
      ...prev,
      [studentId]: { ...prev[studentId], remarks: value }
    }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsSaving(true);

    const payload = {
      exam_id: selectedExam,
      subject_id: selectedSubject,
      results: Object.entries(marksData)
        .filter(([ _, data]) => data.marks !== '') // Only send rows with actual marks
        .map(([studentId, data]) => ({
          student_id: studentId,
          marks: data.marks,
          remarks: data.remarks
        }))
    };

    try {
      // Post the data to Django
      await api.post('/api/exams/rapid-entry/', payload);
      toast.success('Results saved successfully as Draft.');
    } catch (error: any) {
      console.error("Error saving marks:", error);
      const errorMsg = error.response?.data?.error || 'Failed to save results. Please try again.';
      toast.error(errorMsg);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">

      {/* Configuration Bar */}
      <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 p-5 rounded-lg grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label htmlFor="select-class" className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Class Stream</label>
          <SearchableSelect
            id="select-class"
            aria-label="Class Stream"
            value={selectedClass}
            onChange={(v) => handleDropdownChange(setSelectedClass, v)}
            placeholder="-- Select Class --"
            searchPlaceholder="Search class streams…"
            options={availableClasses.map((cls) => ({ value: String(cls.id), label: cls.name }))}
          />
        </div>

        <div>
          <label htmlFor="select-subject" className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Subject</label>
          <SearchableSelect
            id="select-subject"
            aria-label="Subject"
            value={selectedSubject}
            onChange={(v) => handleDropdownChange(setSelectedSubject, v)}
            placeholder="-- Select Subject --"
            searchPlaceholder="Search subjects…"
            options={availableSubjects.map((sub) => ({ value: String(sub.id), label: sub.name }))}
          />
        </div>

        <div>
          <label htmlFor="select-exam" className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Assessment</label>
          <select
            id="select-exam"
            className="w-full p-2.5 border border-slate-300 dark:border-slate-600 rounded-md focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 dark:focus:border-blue-400 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100"
            value={selectedExam}
            onChange={(e) => handleDropdownChange(setSelectedExam, e.target.value)}
            aria-label="Assessment"
          >
            <option value="">-- Select Exam --</option>
            {availableExams.map((exam) => (
              <option key={exam.id} value={exam.id}>{exam.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Spreadsheet Grid */}
      {students.length > 0 ? (
        <form onSubmit={handleSubmit} className="border border-slate-200 dark:border-slate-700 rounded-lg shadow-sm dark:shadow-none bg-white dark:bg-slate-900 overflow-hidden">
          <div className="bg-slate-50 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-700 p-4 flex justify-between items-center flex-wrap gap-2">
            <h3 className="font-semibold text-slate-800 dark:text-slate-100">
              Entering marks for {students.length} student{students.length === 1 ? '' : 's'}
              {!isCoreSubject && <span className="text-slate-500 dark:text-slate-400 font-normal"> (enrolled in this elective)</span>}
            </h3>
            <div className="flex items-center gap-2">
              {!isCoreSubject && (
                <span className="text-xs bg-indigo-100 dark:bg-indigo-500/10 text-indigo-800 dark:text-indigo-400 px-2 py-1 rounded-full font-medium">
                  Elective
                </span>
              )}
              <span className="text-xs bg-amber-100 dark:bg-amber-500/10 text-amber-800 dark:text-amber-400 px-2 py-1 rounded-full font-medium flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> Draft Mode
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead>
                <tr className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">
                  <th className="py-3 px-4 font-semibold w-32">Adm Number</th>
                  <th className="py-3 px-4 font-semibold">Student Name</th>
                  <th className="py-3 px-4 font-semibold w-40">Score (out of {totalMarks})</th>
                  <th className="py-3 px-4 font-semibold">Teacher Remarks (Optional)</th>
                </tr>
              </thead>
              <tbody>
                {students.map((student) => (
                  <tr key={student.id} className="border-b last:border-0 border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                    <td className="py-2 px-4 text-slate-500 dark:text-slate-400 font-mono text-xs">{student.roll}</td>
                    <td className="py-2 px-4 font-medium text-slate-800 dark:text-slate-100">{student.student_name}</td>
                    <td className="py-2 px-4">
                      <input
                        type="number"
                        min="0"
                        max={totalMarks}
                        className="w-full p-2 border border-slate-300 dark:border-slate-600 rounded focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 dark:focus:border-blue-400 outline-none transition-all bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                        placeholder={`0-${totalMarks}`}
                        value={marksData[student.id]?.marks || ''}
                        onChange={(e) => handleMarkChange(student.id, e.target.value)}
                      />
                    </td>
                    <td className="py-2 px-4">
                      <input
                        type="text"
                        className="w-full p-2 border border-slate-300 dark:border-slate-600 rounded focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 dark:focus:border-blue-400 outline-none transition-all bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                        placeholder="e.g., Excellent progress"
                        value={marksData[student.id]?.remarks || ''}
                        onChange={(e) => handleRemarkChange(student.id, e.target.value)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-slate-50 dark:bg-slate-800/40 p-4 border-t border-slate-200 dark:border-slate-700 flex justify-end">
            <button
              type="submit"
              disabled={isSaving}
              className="bg-blue-600 text-white px-6 py-2.5 rounded-md hover:bg-blue-700 font-medium flex items-center gap-2 transition-colors disabled:opacity-70"
            >
              {isSaving ? (
                <>Saving...</>
              ) : (
                <>
                  <Save className="w-4 h-4" /> Save Draft Results
                </>
              )}
            </button>
          </div>
        </form>
      ) : (
        <div className="border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-lg p-12 flex flex-col items-center justify-center text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/40">
          <CheckCircle2 className="w-12 h-12 text-slate-300 dark:text-slate-600 mb-3" />
          <p className="text-lg font-medium text-slate-600 dark:text-slate-300">No Roster Selected</p>
          <p className="text-sm">Please select a class, subject, and assessment above to begin entering marks.</p>
        </div>
      )}
    </div>
  );
};

export default RapidMarksEntry;
