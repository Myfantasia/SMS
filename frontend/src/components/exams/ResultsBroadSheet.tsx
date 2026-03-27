import React, { useState, useEffect } from 'react';
import { Download, UploadCloud, Filter, TrendingUp, Award } from 'lucide-react';
import toast from 'react-hot-toast';
import axios from 'axios';

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

// Interfaces for dropdown options
interface SelectionOption {
  id: string | number;
  name: string;
}

const ResultsBroadsheet: React.FC = () => {
  // Selection State
  const [selectedClass, setSelectedClass] = useState(''); 
  const [selectedExam, setSelectedExam] = useState('');   
  const [isPublishing, setIsPublishing] = useState(false);
  const [isLoading, setIsLoading] = useState(false); 

  // Dropdown Data State (Fetched from backend)
  const [availableClasses, setAvailableClasses] = useState<SelectionOption[]>([]);
  const [availableExams, setAvailableExams] = useState<SelectionOption[]>([]);

  // Live Broadsheet Data State
  const [results, setResults] = useState<StudentResult[]>([]);
  const [subjects, setSubjects] = useState<{code: string, name: string}[]>([]);
  const [curriculum, setCurriculum] = useState<'8-4-4' | 'CBC'>('8-4-4');

  // --- 1. FETCH DROPDOWN SELECTIONS ON MOUNT ---
  useEffect(() => {
    const fetchSelectionData = async () => {
      try {
        const response = await axios.get('http://localhost:8000/api/exams/selection-data/');
        setAvailableClasses(response.data.classes);
        setAvailableExams(response.data.exams);
        
        // Auto-select the first available option
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
      // Don't fetch if no class or exam is selected yet
      if (!selectedClass || !selectedExam) return;

      setIsLoading(true);
      try {
        // Hitting the Django Calculation Engine
        const response = await axios.get('http://localhost:8000/api/exams/broadsheet/', {
          params: {
            class_id: selectedClass,
            exam_id: selectedExam
          }
        });

        // Populate state with real database calculations
        setCurriculum(response.data.curriculum);
        setSubjects(response.data.subjects);
        setResults(response.data.results);
      } catch (error) {
        console.error("Error fetching broadsheet:", error);
        toast.error("Failed to load calculation engine data.");
      } finally {
        setIsLoading(false);
      }
    };

    fetchBroadsheet();
  }, [selectedClass, selectedExam]); // Re-runs whenever the user changes a dropdown

  // --- HANDLERS ---
  const handlePublish = async () => {
    setIsPublishing(true);
    try {
      // Future wiring: await axios.post('/api/exams/publish/', { exam_id: selectedExam })
      setTimeout(() => {
        toast.success('Results published successfully! Students and parents can now view them.');
        setIsPublishing(false);
      }, 1500);
    } catch (error) {
      toast.error("Failed to publish results.");
      setIsPublishing(false);
    }
  };

  const handleExport = () => {
    toast.success('Downloading Master Broadsheet PDF...');
  };

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
            onClick={handleExport}
            className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2 border border-slate-300 text-slate-700 rounded-md hover:bg-slate-50 font-medium transition-colors"
          >
            <Download className="w-4 h-4" /> Export CSV
          </button>
          <button 
            onClick={handlePublish}
            disabled={isPublishing || isLoading || results.length === 0}
            className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 font-medium transition-colors disabled:opacity-70"
          >
            {isPublishing ? 'Publishing...' : <><UploadCloud className="w-4 h-4" /> Publish Results</>}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-slate-50 border border-slate-200 p-4 rounded-lg flex flex-col md:flex-row gap-4">
        <div className="flex-1">
          <label className="flex text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 items-center gap-1">
            <Filter className="w-3 h-3" /> Class Stream
          </label>
          <select 
            className="w-full p-2.5 border border-slate-300 rounded-md focus:ring-2 focus:ring-blue-500 outline-none bg-white"
            value={selectedClass}
            onChange={(e) => setSelectedClass(e.target.value)}
          >
            {availableClasses.length === 0 && <option value="">No classes found</option>}
            {availableClasses.map((cls) => (
              <option key={cls.id} value={cls.id}>{cls.name}</option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Assessment</label>
          <select 
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