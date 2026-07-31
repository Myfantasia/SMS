// src/components/subjectAllocations/ContextFilters.tsx

import React, { useState, useEffect, useMemo } from 'react';
import api from '../../libs/axiosInstance';
import SearchableSelect, { type SearchableSelectGroup } from '../common/SearchableSelect';

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
  enrolled_count?: number;
  capacity?: number;
}

// The manage-classes API always returns stream names grade-prefixed (e.g. "Grade 7 North",
// "Grade 7 French - Group 1") so the name is self-descriptive on its own. Inside an optgroup
// that's already labeled with the grade, repeating that prefix reads as "Grade 7 — Grade 7
// French" — strip it back off wherever the grade is shown separately.
const stripGradePrefix = (name: string, gradeName: string): string => {
  const trimmedGrade = gradeName.trim();
  return name.trim().startsWith(trimmedGrade) ? name.trim().slice(trimmedGrade.length).trim() : name.trim();
};

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

  // Streams vs Elective Groups toggle — keeps each list short instead of mixing physical
  // streams and virtual split groups in one flat dropdown.
  const [viewMode, setViewMode] = useState<'streams' | 'electives'>('streams');

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

        // Fetch Classes (Grouped by Grade) — include virtual elective split groups, since
        // this is the only picker in the app that needs to let an admin select one (to
        // assign it a teacher), unlike every other manage-classes caller.
        const classRes = await api.get('/api/manage-classes/?include_virtual=true');
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

  // --- 5. TREE-GROUPED OPTIONS ---
  // A dropdown-inside-the-dropdown: one branch per grade (Streams tab) or per subject
  // (Elective Groups tab), each collapsed by default — a flat list of ~40-50 rows made every
  // stream/group look the same at a glance, so grouping (with a real collapse/expand, not just
  // a sublabel) is what actually lets an admin land on the right one quickly.
  const streamGroups: SearchableSelectGroup[] = useMemo(() => (
    gradeGroups
      .map((grade) => ({
        key: `grade-${grade.grade_id}`,
        label: grade.grade_name,
        options: [...grade.streams]
          .filter((c) => !c.is_virtual)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((c) => ({
            value: String(c.id),
            label: stripGradePrefix(c.name, grade.grade_name),
            sublabel: `${c.enrolled_count ?? c.capacity ?? 0} students`,
          })),
      }))
      .filter((g) => g.options.length > 0)
  ), [gradeGroups]);

  const electiveGroups: SearchableSelectGroup[] = useMemo(() => {
    // Group EVERY grade's elective groups by the subject they were split from
    // ("French - Group 1" / "French - Group 2" -> subject "French"), across the WHOLE school
    // first — an admin staffing electives works subject-by-subject ("who's covering Agriculture
    // everywhere?"), not grade-by-grade, and that's also how the Matrix's "N of M groups
    // staffed" status is scoped.
    const bySubject = new Map<string, { grade: GradeGroup; stream: ClassStream }[]>();
    gradeGroups.forEach((grade) => {
      grade.streams.filter((c) => c.is_virtual).forEach((c) => {
        const bareName = stripGradePrefix(c.name, grade.grade_name);
        const subjectName = bareName.split(' - Group')[0].trim();
        if (!bySubject.has(subjectName)) bySubject.set(subjectName, []);
        bySubject.get(subjectName)!.push({ grade, stream: c });
      });
    });
    const subjectEntries = Array.from(bySubject.entries()).sort(([a], [b]) => a.localeCompare(b));
    return subjectEntries.map(([subjectName, entries]) => {
      // Grades within a subject branch stay in the order gradeGroups arrived in (the backend's
      // curriculum order), never re-sorted alphabetically; same-grade groups sort by number.
      const byGrade = new Map<number, { grade: GradeGroup; stream: ClassStream }[]>();
      entries.forEach((e) => {
        if (!byGrade.has(e.grade.grade_id)) byGrade.set(e.grade.grade_id, []);
        byGrade.get(e.grade.grade_id)!.push(e);
      });
      const options = Array.from(byGrade.values()).flatMap((gradeEntries) => {
        const grade = gradeEntries[0].grade;
        const sortedGroups = [...gradeEntries].sort((a, b) => {
          const numA = parseInt(stripGradePrefix(a.stream.name, grade.grade_name).split(' - Group')[1] ?? '0', 10);
          const numB = parseInt(stripGradePrefix(b.stream.name, grade.grade_name).split(' - Group')[1] ?? '0', 10);
          return numA - numB;
        });
        return sortedGroups.map(({ stream: c }, idx) => {
          const groupLabel = sortedGroups.length > 1 ? `Group ${idx + 1} of ${sortedGroups.length}` : 'Single group';
          return {
            value: String(c.id),
            // Grade leads here (the subject is already the branch header above it) — sublabel
            // carries the group/count detail, the same lead-with-what-differs idea as Streams.
            label: grade.grade_name,
            sublabel: `${groupLabel} · ${c.enrolled_count ?? c.capacity ?? 0} students`,
          };
        });
      });
      return { key: `subject-${subjectName}`, label: subjectName, options };
    });
  }, [gradeGroups]);

  // --- 6. THE UI (Tailwind Grid) ---
  return (
    <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm relative">
      {/* Decorative background accent — rounded to match the card's own corners instead of
          relying on the card clipping overflow, which would also clip the SearchableSelect
          dropdown that needs to render past the card's bottom edge. */}
      <div className="absolute top-0 left-0 w-1 h-full bg-indigo-500 rounded-l-2xl"></div>

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

        {/* CLASS STREAM / ELECTIVE GROUP DROPDOWN */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label htmlFor="class-select" className="block text-sm font-medium text-slate-700">
              {viewMode === 'streams' ? 'Class Stream' : 'Elective Group'} <span className="text-red-500">*</span>
            </label>
          </div>

          {/* Streams vs Elective Groups toggle */}
          <div className="flex bg-slate-100 p-1 rounded-lg mb-2 w-fit">
            <button
              type="button"
              onClick={() => { setViewMode('streams'); setSelectedClass(''); }}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${viewMode === 'streams' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Streams
            </button>
            <button
              type="button"
              onClick={() => { setViewMode('electives'); setSelectedClass(''); }}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${viewMode === 'electives' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              🧩 Elective Groups
            </button>
          </div>

          <SearchableSelect
            id="class-select"
            aria-label={viewMode === 'streams' ? 'Select Class' : 'Select Elective Group'}
            value={selectedClass}
            onChange={setSelectedClass}
            disabled={isLoading}
            placeholder={viewMode === 'streams' ? '-- Select Class --' : '-- Select Elective Group --'}
            searchPlaceholder={viewMode === 'streams' ? 'Search grade or stream…' : 'Search subject or group…'}
            groups={viewMode === 'streams' ? streamGroups : electiveGroups}
          />
        </div>

      </div>
    </div>
  );
};

export default ContextFilters;