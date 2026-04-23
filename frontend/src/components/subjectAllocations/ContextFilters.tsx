// src/components/subjectAllocations/ContextFilters.tsx

import React, { useState, useEffect } from 'react';
import axios from 'axios';

// --- 1. TYPES FOR INCOMING API DATA ---
interface AcademicYear {
  id: number;
  year: string;
  is_active: boolean;
}

interface ExamTerm {
  id: number;
  name: string;
  academic_year: number; 
}

interface ClassStream {
  id: number;
  name: string; 
  grade_name: string; 
  full_name: string; 
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
  const [classes, setClasses] = useState<ClassStream[]>([]);
  
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // --- 4. FETCH INITIAL DATA (Combined from filter-options) ---
  useEffect(() => {
    const fetchBaseData = async () => {
      setIsLoading(true);
      try {
        const token = localStorage.getItem('firebase_dev_token');
        const response = await axios.get('http://127.0.0.1:8000/api/results/filter-options/', {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.status === 200) {
          const data = response.data;

          // Convert string arrays to objects to maintain your existing structure
          const formattedYears = data.years.map((y: string, index: number) => ({
            id: index, // Temporary ID since endpoint returns strings
            year: y,
            is_active: index === 0 // Logic from your summary file (first is usually current)
          }));

          const formattedClasses = data.streams.map((s: string, index: number) => ({
            id: index,
            name: s.split(' (')[0],
            grade_name: '',
            full_name: s
          }));

          // We set terms initially from the same payload
          const formattedTerms = data.terms.map((t: string, index: number) => ({
            id: index,
            name: t,
            academic_year: 0
          }));

          setYears(formattedYears);
          setClasses(formattedClasses);
          setTerms(formattedTerms);

          // Auto-select defaults as seen in your ClassPerformanceSummary
          if (data.years.length > 0 && !selectedYear) setSelectedYear(data.years[0]);
          if (data.terms.length > 0 && !selectedTerm) setSelectedTerm(data.terms[0]);
          if (data.streams.length > 0 && !selectedClass) setSelectedClass(data.streams[0]);
        }

      } catch (error) {
        console.error("Error fetching filter options:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchBaseData();
  }, []);

  // --- 5. CASCADING FETCH (Keeping structure, though data is already loaded) ---
  useEffect(() => {
    const fetchTermsForYear = async () => {
      if (!selectedYear) {
        setSelectedTerm('');
        return;
      }
      // Since your filter-options endpoint provides all terms at once, 
      // we don't need a separate API call here, keeping the structure intact.
    };

    fetchTermsForYear();
  }, [selectedYear]);

  // --- 6. THE UI (Tailwind Grid) ---
  return (
    <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm">
      <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-4 border-b pb-2">
        1. Select Context
      </h2>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* YEAR DROPDOWN */}
        <div>
          <label htmlFor="year-select" className="block text-sm font-medium text-gray-700 mb-1">Academic Year <span className="text-red-500">*</span></label>
          <select
            id="year-select"
            className="w-full border-gray-300 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500 p-2.5 bg-gray-50 border text-sm"
            value={selectedYear}
            onChange={(e) => {
              setSelectedYear(e.target.value);
            }}
            disabled={isLoading}
          >
            <option value="">-- Select Year --</option>
            {years.map((y) => (
              <option key={y.year} value={y.year}>
                {y.year} {y.is_active ? '(Current)' : ''}
              </option>
            ))}
          </select>
        </div>

        {/* TERM DROPDOWN */}
        <div>
          <label htmlFor="term-select" className="block text-sm font-medium text-gray-700 mb-1">Exam Term <span className="text-red-500">*</span></label>
          <select
            id="term-select"
            className={`w-full border-gray-300 rounded-md shadow-sm p-2.5 border focus:ring-blue-500 focus:border-blue-500 text-sm ${
              !selectedYear ? 'bg-gray-200 cursor-not-allowed opacity-60' : 'bg-gray-50'
            }`}
            value={selectedTerm}
            onChange={(e) => setSelectedTerm(e.target.value)}
            disabled={!selectedYear || isLoading}
          >
            <option value="">-- Select Term --</option>
            {terms.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        {/* CLASS STREAM DROPDOWN */}
        <div>
          <label htmlFor="class-select" className="block text-sm font-medium text-gray-700 mb-1">Class Stream <span className="text-red-500">*</span></label>
          <select
            id="class-select"
            className="w-full border-gray-300 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500 p-2.5 bg-gray-50 border text-sm"
            value={selectedClass}
            onChange={(e) => setSelectedClass(e.target.value)}
            disabled={isLoading}
          >
            <option value="">-- Select Class --</option>
            {classes.map((c) => (
              <option key={c.full_name} value={c.full_name}>
                {c.full_name}
              </option>
            ))}
          </select>
        </div>

      </div>
    </div>
  );
};

export default ContextFilters;