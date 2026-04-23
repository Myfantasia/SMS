// src/components/subjectAllocations/AllocationDashboard.tsx

import React, { useState, useEffect } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast'; // Consistent with your Toaster in App.tsx
import type { MatrixRow } from '../../libs/types';

// Importing our built and upcoming components
import ContextFilters from './ContextFilters';
import MatrixTable from './MatrixTable';
import ActionButtons from './ActionButtons'; // <-- Uncommented

const AllocationDashboard: React.FC = () => {
  // --- 1. THE STATE ---
  const [yearId, setYearId] = useState<string>('');
  const [termId, setTermId] = useState<string>('');
  const [classId, setClassId] = useState<string>('');

  const [matrixData, setMatrixData] = useState<MatrixRow[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  
  // NEW: A trigger key to force the useEffect to run again on demand (for Revert/Reload)
  const [refreshKey, setRefreshKey] = useState<number>(0);

  // --- 2. FETCH MATRIX LOGIC ---
  useEffect(() => {
    const fetchMatrix = async () => {
      // Only fetch if all three context filters are selected
      if (!yearId || !termId || !classId) {
        setMatrixData([]); // Clear grid if filters are incomplete
        return;
      }

      setIsLoading(true);
      try {
        const response = await axios.get(`/api/allocations/matrix/`, {
          params: {
            class_id: classId,
            term_id: termId,
            year_id: yearId,
          }
        });
        
        // Django returns { matrix: [...] } based on our previous view
        setMatrixData(response.data.matrix);
      } catch (error: any) {
        console.error("Error fetching allocations:", error);
        toast.error(error.response?.data?.error || "Failed to load allocation matrix");
      } finally {
        setIsLoading(false);
      }
    };

    fetchMatrix();
  }, [yearId, termId, classId, refreshKey]); // <-- Added refreshKey to dependencies

  // --- 3. STATE HANDLER (For Manual Selection) ---
  // This function is passed to the Table so that when a teacher is picked, 
  // the Parent state updates immediately.
  const handleTeacherChange = (subjectId: number, teacherId: string | number) => {
    setMatrixData(prevData => 
      prevData.map(row => 
        row.subject_id === subjectId 
          ? { ...row, assigned_teacher_id: teacherId } 
          : row
      )
    );
  };

  // Helper to trigger a refetch of the database data
  const triggerRefresh = () => {
    setRefreshKey(prev => prev + 1);
  };

  // --- 4. RENDER ---
  return (
    <div className="p-4 lg:p-8 bg-slate-50 min-h-screen">
      <div className="max-w-7xl mx-auto bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        
        {/* Header Section */}
        <div className="px-6 py-5 bg-slate-800 flex flex-col md:flex-row justify-between items-center gap-4">
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">
              Subject Teacher Allocations
            </h1>
            <p className="text-slate-400 text-sm">
              Assign and manage staff teaching loads per class
            </p>
          </div>
          
          <div className="flex items-center gap-3">
             {/* ActionButtons inserted here */}
             <ActionButtons 
               yearId={yearId}
               termId={termId}
               classId={classId}
               matrixData={matrixData}
               setMatrixData={setMatrixData}
               onRefresh={triggerRefresh}
             />
          </div>
        </div>

        <div className="p-6">
          {/* 1. Context Filters (Year, Term, Class) */}
          <div className="mb-8">
            <ContextFilters 
                selectedYear={yearId}
                setSelectedYear={setYearId}
                selectedTerm={termId}
                setSelectedTerm={setTermId}
                selectedClass={classId}
                setSelectedClass={setClassId}
            />
          </div>

          {/* 2. Matrix Grid Section */}
          <div className="mt-8">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center p-20 space-y-4">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
                <p className="text-slate-500 animate-pulse">Analyzing subject requirements...</p>
              </div>
            ) : matrixData.length > 0 ? (
               <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm bg-white">
                 {/* MatrixTable successfully integrated */}
                 <MatrixTable 
                    data={matrixData} 
                    onTeacherChange={handleTeacherChange} 
                 />
               </div>
            ) : (
              <div className="text-center py-20 px-6 border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
                <div className="max-w-xs mx-auto space-y-3">
                  <div className="bg-slate-200 w-12 h-12 rounded-full flex items-center justify-center mx-auto">
                    <span className="text-slate-500 text-xl font-bold">?</span>
                  </div>
                  <h3 className="text-slate-700 font-semibold">No Class Selected</h3>
                  <p className="text-slate-500 text-sm">
                    Select an Academic Year, Term, and Class above to generate the teaching matrix.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
        
      </div>
    </div>
  );
};

export default AllocationDashboard;