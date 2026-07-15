// src/components/subjectAllocations/ContextFilters.tsx

import React, { useState, useEffect } from 'react';
import api from '../../libs/axiosInstance';

// --- 1. TYPES FOR INCOMING API DATA ---
interface AcademicYear {
  id: number;
  year: string;
  is_active: boolean;
}

interface ExamTerm {
  id: number;
  name: string;
}

interface ClassStream {
  id: number;
  name: string; 
  full_name: string; 
  is_virtual?: boolean;
}

interface GradeGroup {
  grade_id: number;
  grade_name: string;
  streams: ClassStream[];
}

// --- 2. COMPONENT PROPS ---
interface ContextFiltersProps {
  selectedYear: string;
  setSelectedYear: (id: string) => void;
  selectedTerm: string;
  setSelectedTerm: (id: string) => void;
  selectedClass: string;
  setSelectedClass: (id: string) => void;
}

const ContextFilters: React.FC<ContextFiltersProps> = ({
  selectedYear,
  setSelectedYear,
  selectedTerm,
  setSelectedTerm,
  selectedClass,
  setSelectedClass,
}) => {
  // --- 3. LOCAL STATE FOR DROPDOWN OPTIONS ---
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [terms, setTerms] = useState<ExamTerm[]>([]);
  const [gradeGroups, setGradeGroups] = useState<GradeGroup[]>([]);
  
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // --- 4. FETCH DATA WITH REAL DATABASE IDs ---
  useEffect(() => {
    const fetchBaseData = async () => {
      setIsLoading(true);
      try {
        // Fetch Academic Years
        const yearRes = await api.get('/api/academic-years/');
        if (yearRes.data?.status === 'success') {
          const fetchedYears = yearRes.data.data;
          setYears(fetchedYears);
          
          // Auto-select the active year if nothing is selected
          if (!selectedYear) {
            const activeYear = fetchedYears.find((y: AcademicYear) => y.is_active);
            if (activeYear) setSelectedYear(activeYear.id.toString());
          }
        }

        // Fetch Exam Terms
        const termRes = await api.get('/api/exams/setup-data/');
        if (termRes.data?.terms) {
          setTerms(termRes.data.terms);
          if (!selectedTerm && termRes.data.terms.length > 0) {
            setSelectedTerm(termRes.data.terms[0].id.toString());
          }
        }

        // Fetch Classes (Grouped by Grade)
        const classRes = await api.get('/api/manage-classes/');
        if (classRes.data?.status === 'success') {
          setGradeGroups(classRes.data.data);
        }

      } catch (error) {
        console.error("Error fetching context filters:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchBaseData();
  }, []);

  // --- 5. THE UI (Tailwind Grid) ---
  return (
    <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm relative overflow-hidden">
      {/* Decorative background accent */}
      <div className="absolute top-0 left-0 w-1 h-full bg-indigo-500"></div>

      <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-3">
        <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 text-xs flex items-center justify-center font-black">1</span>
          Select Context
        </h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* YEAR DROPDOWN */}
        <div>
          <label htmlFor="year-select" className="block text-sm font-medium text-slate-700 mb-1">
            Academic Year <span className="text-red-500">*</span>
          </label>
          <select
            id="year-select"
            className="w-full border-slate-300 rounded-lg shadow-sm focus:border-indigo-500 focus:ring-indigo-500 p-2.5 bg-slate-50 border text-sm transition-colors cursor-pointer"
            value={selectedYear}
            onChange={(e) => setSelectedYear(e.target.value)}
            disabled={isLoading}
          >
            <option value="">-- Select Year --</option>
            {years.map((y) => (
              <option key={y.id} value={y.id}>
                {y.year} {y.is_active ? '(Current)' : ''}
              </option>
            ))}
          </select>
        </div>

        {/* TERM DROPDOWN */}
        <div>
          <label htmlFor="term-select" className="block text-sm font-medium text-slate-700 mb-1">
            Exam Term <span className="text-red-500">*</span>
          </label>
          <select
            id="term-select"
            className={`w-full border-slate-300 rounded-lg shadow-sm p-2.5 border focus:ring-indigo-500 focus:border-indigo-500 text-sm transition-colors ${
              !selectedYear ? 'bg-slate-100 cursor-not-allowed opacity-60' : 'bg-slate-50 cursor-pointer'
            }`}
            value={selectedTerm}
            onChange={(e) => setSelectedTerm(e.target.value)}
            disabled={!selectedYear || isLoading}
          >
            <option value="">-- Select Term --</option>
            {terms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        {/* CLASS STREAM DROPDOWN */}
        <div>
          <label htmlFor="class-select" className="block text-sm font-medium text-slate-700 mb-1">
            Class Stream <span className="text-red-500">*</span>
          </label>
          <select
            id="class-select"
            className="w-full border-slate-300 rounded-lg shadow-sm focus:border-indigo-500 focus:ring-indigo-500 p-2.5 bg-slate-50 border text-sm transition-colors cursor-pointer"
            value={selectedClass}
            onChange={(e) => setSelectedClass(e.target.value)}
            disabled={isLoading}
          >
            <option value="">-- Select Class --</option>
            {gradeGroups.map((grade) => (
              <optgroup key={grade.grade_id} label={grade.grade_name}>
                {grade.streams.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

      </div>
    </div>
  );
};

export default ContextFilters;