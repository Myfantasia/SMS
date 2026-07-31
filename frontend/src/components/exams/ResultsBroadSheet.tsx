import React, { useState, useEffect } from 'react';
import { Download, UploadCloud, Filter, TrendingUp, AlertCircle, Award, RotateCcw, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../libs/axiosInstance';
import SearchableSelect from '../common/SearchableSelect';

// --- Interfaces matching Django JSON Response ---
interface StudentResult {
  id: string;
  roll: string;
  name: string;
  scores: Record<string, number | string>; 
  total: number;
  mean: number;
  grade: string;
  position: number | string; 
}

interface SelectionOption {
  id: string | number;
  name: string;
  status?: string;
  can_publish?: boolean; 
}

// NEW: Added the props interface to receive the role
interface ResultsBroadsheetProps {
  role?: 'admin' | 'teacher' | 'student' | 'parent';
}

const ResultsBroadsheet: React.FC<ResultsBroadsheetProps> = ({ role = 'teacher' }) => {
  const [selectedClass, setSelectedClass] = useState(''); 
  const [selectedExam, setSelectedExam] = useState('');   
  const [isPublishing, setIsPublishing] = useState(false);
  const [isLoading, setIsLoading] = useState(false); 

  const [availableClasses, setAvailableClasses] = useState<SelectionOption[]>([]);
  const [availableExams, setAvailableExams] = useState<SelectionOption[]>([]);

  const [results, setResults] = useState<StudentResult[]>([]);
  const [subjects, setSubjects] = useState<{code: string, name: string}[]>([]);
  const [curriculum, setCurriculum] = useState<'8-4-4' | 'CBC'>('8-4-4');
  
  const [classPublishStatus, setClassPublishStatus] = useState('Draft');

  // --- 1. FETCH DROPDOWN SELECTIONS ON MOUNT ---
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
        toast.error("Failed to load classes and exams dropdowns.");
      }
    };
    fetchSelectionData();
  }, []);

  // --- 2. LIVE BROADSHEET DATA FETCHING ---
  useEffect(() => {
    const fetchBroadsheet = async () => {
      if (!selectedClass || !selectedExam) return;

      setIsLoading(true);
      try {
        const response = await api.get('/api/exams/broadsheet/', {
          params: { class_id: selectedClass, exam_id: selectedExam }
        });

        setCurriculum(response.data.curriculum);
        setSubjects(response.data.subjects);
        setResults(response.data.results);
        
        if (response.data.class_publish_status) {
          setClassPublishStatus(response.data.class_publish_status);
        } else {
          setClassPublishStatus('Draft');
        }

      } catch (error) {
        console.error("Error fetching broadsheet:", error);
        toast.error("Failed to load calculation engine data.");
      } finally {
        setIsLoading(false);
      }
    };

    fetchBroadsheet();
  }, [selectedClass, selectedExam]); 

  // --- HANDLERS ---

  // PROFESSIONAL PUBLISH POPUP
  const handlePublish = () => {
    if (!selectedExam || !selectedClass) return;

    toast.custom((t) => (
      <div className={`${t.visible ? 'animate-enter' : 'animate-leave'} max-w-md w-full bg-white shadow-2xl rounded-xl pointer-events-auto flex flex-col ring-1 ring-black ring-opacity-5 overflow-hidden`}>
        <div className="p-5">
          <div className="flex items-start">
            <div className="shrink-0">
              <div className="h-10 w-10 rounded-full bg-blue-50 flex items-center justify-center">
                <UploadCloud className="h-5 w-5 text-blue-600" />
              </div>
            </div>
            <div className="ml-4 w-0 flex-1">
              <h3 className="text-base font-semibold text-slate-900">Publish Results</h3>
              <p className="mt-1 text-sm text-slate-500">
                You can publish the results for just this specific class{role === 'admin' && ', or broadcast the results for the entire school at once'}.
              </p>
            </div>
          </div>
        </div>
        <div className="bg-slate-50 px-5 py-4 flex flex-col sm:flex-row justify-end gap-3 border-t border-slate-100">
          <button
            onClick={() => toast.dismiss(t.id)}
            className="w-full sm:w-auto px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={async () => {
              toast.dismiss(t.id);
              setIsPublishing(true);
              try {
                await api.post(`/api/exams/events/${selectedExam}/publish/`, { class_id: selectedClass });
                toast.success('This class has been published successfully!');
                setClassPublishStatus('Published');
              } catch (error: any) {
                console.error("🔥 PUBLISH ERROR CAUGHT:", error); 
                const actualErrorMessage = error.response?.data?.error || error.message || "Unknown error occurred";
                toast.error(`Error: ${actualErrorMessage}`);
              } finally {
                setIsPublishing(false);
              }
            }}
            className="w-full sm:w-auto px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 transition-colors"
          >
            This Class Only
          </button>
          
          {/* UPDATED: Only Admins can see the Publish All button */}
          {role === 'admin' && (
            <button
              onClick={async () => {
                toast.dismiss(t.id);
                setIsPublishing(true);
                try {
                  await api.post(`/api/exams/events/${selectedExam}/publish/`, { class_id: 'ALL' });
                  toast.success('Entire school published successfully!');
                  setClassPublishStatus('Published');
                } catch (error: any) {
                  console.error("🔥 PUBLISH ERROR CAUGHT:", error); 
                  const actualErrorMessage = error.response?.data?.error || error.message || "Unknown error occurred";
                  toast.error(`Error: ${actualErrorMessage}`);
                } finally {
                  setIsPublishing(false);
                }
              }}
              className="w-full sm:w-auto px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors shadow-sm"
            >
              Publish All Classes
            </button>
          )}
        </div>
      </div>
    ), { duration: Infinity });
  };

  // PROFESSIONAL REVERT POPUP
  const handleRevert = () => {
    if (!selectedExam || !selectedClass) return;

    toast.custom((t) => (
      <div className={`${t.visible ? 'animate-enter' : 'animate-leave'} max-w-md w-full bg-white shadow-2xl rounded-xl pointer-events-auto flex flex-col ring-1 ring-black ring-opacity-5 overflow-hidden`}>
        <div className="p-5">
          <div className="flex items-start">
            <div className="shrink-0">
              <div className="h-10 w-10 rounded-full bg-amber-50 flex items-center justify-center">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
              </div>
            </div>
            <div className="ml-4 w-0 flex-1">
              <h3 className="text-base font-semibold text-slate-900">Revert to Draft</h3>
              <p className="mt-1 text-sm text-slate-500">
                This will hide the results from parent and student portals. Do you want to revert just this class{role === 'admin' && ' or the whole school'}?
              </p>
            </div>
          </div>
        </div>
        <div className="bg-slate-50 px-5 py-4 flex flex-col sm:flex-row justify-end gap-3 border-t border-slate-100">
          <button
            onClick={() => toast.dismiss(t.id)}
            className="w-full sm:w-auto px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-amber-500 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={async () => {
              toast.dismiss(t.id);
              try {
                await api.post(`/api/exams/events/${selectedExam}/revert/`, { class_id: selectedClass });
                toast.success('Class reversed to Draft!');
                setClassPublishStatus('Draft');
              } catch (error: any) {
                console.error("🔥 REVERT ERROR CAUGHT:", error); 
                const actualErrorMessage = error.response?.data?.error || error.message || "Unknown error occurred";
                toast.error(`Error: ${actualErrorMessage}`);
              }
            }}
            className="w-full sm:w-auto px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-amber-50 hover:text-amber-700 hover:border-amber-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-amber-500 transition-colors"
          >
            This Class Only
          </button>

          {/* UPDATED: Only Admins can see the Revert All button */}
          {role === 'admin' && (
            <button
              onClick={async () => {
                toast.dismiss(t.id);
                try {
                  await api.post(`/api/exams/events/${selectedExam}/revert/`, { class_id: 'ALL' });
                  toast.success('Entire school reversed to Draft!');
                  setClassPublishStatus('Draft');
                } catch (error: any) {
                  console.error("🔥 REVERT ERROR CAUGHT:", error); 
                  const actualErrorMessage = error.response?.data?.error || error.message || "Unknown error occurred";
                  toast.error(`Error: ${actualErrorMessage}`);
                }
              }}
              className="w-full sm:w-auto px-4 py-2 text-sm font-medium text-white bg-red-600 border border-transparent rounded-lg hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-colors shadow-sm"
            >
              Revert All Classes
            </button>
          )}
        </div>
      </div>
    ), { duration: Infinity });
  };

  // CSV Exporter
  const handleExportCSV = () => {
    if (results.length === 0) {
      toast.error("No data available to export.");
      return;
    }

    const subjectHeaders = subjects.map(s => s.code);
    const headers = curriculum === '8-4-4' 
      ? ['Rank', 'Adm Number', 'Student Name', ...subjectHeaders, 'Total', 'Mean', 'Grade']
      : ['Adm Number', 'Student Name', ...subjectHeaders, 'Overall Expectation'];

    const rows = results.map(student => {
      const subjectScores = subjects.map(sub => 
        student.scores[sub.code] !== undefined ? student.scores[sub.code] : '-'
      );

      const rowData = curriculum === '8-4-4'
        ? [student.position, student.roll, student.name, ...subjectScores, student.total, Number(student.mean).toFixed(1), student.grade]
        : [student.roll, student.name, ...subjectScores, student.grade];

      return rowData.join(','); 
    });

    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    
    const className = availableClasses.find(c => c.id.toString() === selectedClass)?.name || 'Class';
    const examName = availableExams.find(e => e.id.toString() === selectedExam)?.name || 'Exam';
    
    link.href = url;
    link.setAttribute('download', `${className}_${examName}_Results.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    toast.success('CSV Downloaded!');
  };

  const isCurrentlyPublished = classPublishStatus === 'Published';

  const activeClassData = availableClasses.find(c => c.id.toString() === selectedClass);
  const hasPublishRights = activeClassData?.can_publish || false;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      
      {/* Top Action Bar */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="bg-blue-100 p-2 rounded-lg">
            <TrendingUp className="w-6 h-6 text-blue-700" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-800">Master Broadsheet</h2>
            <p className="text-sm text-slate-500">Review aggregated performance before publishing.</p>
          </div>
        </div>

        <div className="flex gap-3 w-full md:w-auto">
          <button 
            onClick={handleExportCSV}
            disabled={results.length === 0 || isLoading}
            className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2 border border-slate-300 text-slate-700 rounded-md hover:bg-slate-50 font-medium transition-colors disabled:opacity-50"
          >
            <Download className="w-4 h-4" /> Export CSV
          </button>
          
          {/* Dynamic Button Rendering based on Specific Class Status */}
          {isCurrentlyPublished ? (
             <button 
               onClick={handleRevert}
               className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-md hover:bg-amber-600 font-medium transition-colors shadow-sm"
             >
               <RotateCcw className="w-4 h-4" /> Revert to Draft
             </button>
          ) : !hasPublishRights ? (
            // ✨ STEP 6: Show a locked, disabled button if they aren't authorized
            <button 
              disabled
              className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-slate-100 text-slate-400 border border-slate-200 rounded-md cursor-not-allowed font-medium shadow-sm"
              title="Only the assigned Class Teacher or Admin can publish results."
            >
              <AlertCircle className="w-4 h-4" /> Not Authorized to Publish
            </button>
          ) : (
            <button 
              onClick={handlePublish}
              disabled={isPublishing || isLoading || results.length === 0}
              className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 font-medium transition-colors disabled:opacity-70 shadow-sm"
            >
              {isPublishing ? 'Publishing...' : <><UploadCloud className="w-4 h-4" /> Publish Results</>}
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-slate-50 border border-slate-200 p-4 rounded-lg flex flex-col md:flex-row gap-4">
        <div className="flex-1">
          <label htmlFor="class-select" className="flex text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 items-center gap-1">
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
          <label htmlFor="exam-select" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Assessment</label>
          <select
            id="exam-select"
            className="w-full p-2.5 border border-slate-300 rounded-md focus:ring-2 focus:ring-blue-500 outline-none bg-white"
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

      {/* The Broadsheet Table */}
      <div className="border border-slate-200 rounded-lg shadow-sm bg-white overflow-hidden">
        <div className="bg-slate-800 text-white p-4 flex justify-between items-center">
          <h3 className="font-semibold flex items-center gap-2">
            <Award className="w-5 h-5 text-amber-400" /> 
            {curriculum} Curriculum Performance
          </h3>
          <span className="text-xs bg-slate-700 px-3 py-1 rounded-full border border-slate-600">
            {isLoading ? "Calculating..." : `${results.length} Students Assessed`}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                {curriculum === '8-4-4' && <th className="py-3 px-4 font-bold text-slate-800 w-16">Rank</th>}
                <th className="py-3 px-4 font-semibold w-24">Adm No.</th>
                <th className="py-3 px-4 font-semibold w-48 border-r border-slate-200">Student Name</th>
                
                {/* Dynamic Subject Headers */}
                {subjects.map(sub => (
                  <th key={sub.code} className="py-3 px-4 font-semibold text-center" title={sub.name}>
                    {sub.code}
                  </th>
                ))}
                
                {/* Aggregate Headers */}
                {curriculum === '8-4-4' ? (
                  <>
                    <th className="py-3 px-4 font-bold text-slate-800 text-center border-l border-slate-200">Total</th>
                    <th className="py-3 px-4 font-bold text-slate-800 text-center">Mean</th>
                    <th className="py-3 px-4 font-bold text-slate-800 text-center">Grade</th>
                  </>
                ) : (
                  <th className="py-3 px-4 font-bold text-slate-800 text-center border-l border-slate-200">Overall Expectation</th>
                )}
              </tr>
            </thead>
            <tbody>
              {results.length === 0 && !isLoading ? (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-slate-500">No results found for this selection.</td>
                </tr>
              ) : (
                results.map((student) => (
                  <tr key={student.id} className="border-b last:border-0 border-slate-100 hover:bg-slate-50 transition-colors">
                    {curriculum === '8-4-4' && (
                      <td className="py-2 px-4 font-bold text-slate-700">{student.position}</td>
                    )}
                    <td className="py-2 px-4 text-slate-500 font-mono text-xs">{student.roll}</td>
                    <td className="py-2 px-4 font-medium text-slate-800 border-r border-slate-100">{student.name}</td>
                    
                    {/* Subject Scores */}
                    {subjects.map(sub => (
                      <td key={sub.code} className="py-2 px-4 text-center text-slate-600">
                        {student.scores[sub.code] || '-'}
                      </td>
                    ))}
                    
                    {/* Aggregates */}
                    {curriculum === '8-4-4' ? (
                      <>
                        <td className="py-2 px-4 text-center font-semibold text-slate-800 border-l border-slate-100">{student.total}</td>
                        <td className="py-2 px-4 text-center text-slate-600">{Number(student.mean).toFixed(1)}</td>
                        <td className="py-2 px-4 text-center font-bold text-blue-700">{student.grade}</td>
                      </>
                    ) : (
                      <td className="py-2 px-4 text-center font-semibold text-emerald-700 border-l border-slate-100">{student.grade}</td>
                    )}
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

export default ResultsBroadsheet;