import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, ClipboardList, HelpCircle } from 'lucide-react';
import type { MatrixRow } from '../../libs/types';
import ContextFilters from './ContextFilters';
import MatrixTable from './MatrixTable';
import ActionButtons from './ActionButtons';
import api from '../../libs/axiosInstance';

// We will build this in Step 3
import SplittingEngineModal from './SplittingEngineModal'; 

const AllocationDashboard: React.FC = () => {
  // --- 1. THE STATE ---
  const [yearId, setYearId] = useState<string>('');
  const [termId, setTermId] = useState<string>('');
  const [classId, setClassId] = useState<string>('');
  const [gradeId, setGradeId] = useState<string>('');
  const [gradeName, setGradeName] = useState<string>('');
  const [classDisplayName, setClassDisplayName] = useState<string>('');

  const [matrixData, setMatrixData] = useState<MatrixRow[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  
  // NEW: State to track if the selected class is a virtual elective split
  const [isVirtualStream, setIsVirtualStream] = useState<boolean>(false);

  // Draft/Published lock — once published, the Matrix for this class+term+year is read-only
  // until explicitly unpublished (see UnpublishAllocationAPIView).
  const [isPublished, setIsPublished] = useState<boolean>(false);

  // NEW: State for the Splitting Engine Modal
  const [isSplittingModalOpen, setIsSplittingModalOpen] = useState<boolean>(false);

  // A trigger key to force useEffect to run again, and to remount ContextFilters!
  const [refreshKey, setRefreshKey] = useState<number>(0);

  // --- 2. FETCH MATRIX LOGIC ---
  useEffect(() => {
    const fetchMatrix = async () => {
      // Only fetch if all three context filters are selected
      if (!yearId || !termId || !classId) {
        setMatrixData([]);
        setIsVirtualStream(false);
        setIsPublished(false);
        setGradeId('');
        setGradeName('');
        setClassDisplayName('');
        return;
      }

      setIsLoading(true);
      try {
        const response = await api.get(`/api/allocations/matrix/`, {
          params: {
            class_id: classId,
            term_id: termId,
            year_id: yearId,
          }
        });
        
        setMatrixData(response.data.matrix);
        // Capture the virtual flag from Django
        setIsVirtualStream(response.data.is_virtual || false);
        setIsPublished(response.data.is_published || false);
        setGradeId(response.data.grade_id ? String(response.data.grade_id) : '');
        setGradeName(response.data.grade_name || '');
        setClassDisplayName(response.data.class_name || '');

      } catch (error: any) {
        console.error("Error fetching allocations:", error);
        toast.error(error.response?.data?.error || "Failed to load allocation matrix");
      } finally {
        setIsLoading(false);
      }
    };

    fetchMatrix();
  }, [yearId, termId, classId, refreshKey]); 

  // --- 3. STATE HANDLER ---
  const handleTeacherChange = (subjectId: number, teacherId: string | number) => {
    setMatrixData(prevData => 
      prevData.map(row => 
        row.subject_id === subjectId 
          ? { ...row, assigned_teacher_id: teacherId } 
          : row
      )
    );
  };

  const triggerRefresh = () => {
    setRefreshKey(prev => prev + 1);
  };

  // --- 4. RENDER ---
  return (
    <div>
      <div className="max-w-7xl mx-auto bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        
        {/* Header Section */}
        <div className="px-6 py-5 flex items-center gap-4 border-b border-slate-100">
          <div className="p-3 rounded-2xl text-indigo-600 bg-indigo-50 shrink-0">
            <ClipboardList className="w-6 h-6" strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-slate-800">
              Subject Teacher Allocations
            </h1>
            <p className="text-slate-500 text-sm mt-0.5">
              Assign and manage staff teaching loads per class
            </p>
          </div>
        </div>

        <div className="p-6">
          {/* 1. Context Filters */}
          <div className="mb-6">
            {/* The Key prop forces this to remount and fetch fresh data when splits are generated */}
            <ContextFilters
                key={refreshKey}
                selectedYear={yearId} setSelectedYear={setYearId}
                selectedTerm={termId} setSelectedTerm={setTermId}
                selectedClass={classId} setSelectedClass={setClassId}
            />
          </div>

          {/* 2. Action Toolbar */}
          <div className="mb-8">
             <ActionButtons
               yearId={yearId}
               termId={termId}
               classId={classId}
               gradeId={gradeId}
               gradeName={gradeName}
               classDisplayName={classDisplayName}
               matrixData={matrixData}
               setMatrixData={setMatrixData}
               isPublished={isPublished}
               isVirtualStream={isVirtualStream}
               onRefresh={triggerRefresh}
               onOpenSplittingModal={() => setIsSplittingModalOpen(true)}
             />
          </div>

          {/* 3. Matrix Grid Section */}
          <div className="mt-8">

            {/* NEW: AMBER WARNING FOR VIRTUAL STREAMS */}
            {isVirtualStream && (
              <div className="mb-6 flex items-start gap-3 bg-amber-50 border border-amber-200 p-4 rounded-xl shadow-sm">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-bold text-amber-800">Virtual Elective Split Group</h4>
                  <p className="text-sm text-amber-700 mt-1">
                    You are modifying an Elective Split Group. Changes saved here apply specifically to students enrolled in this elective section. Core subjects will not be shown.
                  </p>
                </div>
              </div>
            )}

            {isPublished && (
              <div className="mb-6 flex items-start gap-3 bg-emerald-50 border border-emerald-200 p-4 rounded-xl shadow-sm">
                <ClipboardList className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-bold text-emerald-800">Published — Locked</h4>
                  <p className="text-sm text-emerald-700 mt-1">
                    This class's allocation is published. It's read-only until you unpublish it from the toolbar above.
                  </p>
                </div>
              </div>
            )}

            {isLoading ? (
              <div className="flex flex-col items-center justify-center p-20 space-y-4">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
                <p className="text-slate-500 animate-pulse">Analyzing subject requirements...</p>
              </div>
            ) : matrixData.length > 0 ? (
               <div className="border border-slate-100 rounded-2xl overflow-hidden shadow-sm bg-white">
                 <MatrixTable
                    data={matrixData}
                    onTeacherChange={handleTeacherChange}
                    readOnly={isPublished}
                 />
               </div>
            ) : (
              <div className="text-center py-20 px-6 border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
                <div className="max-w-xs mx-auto space-y-3">
                  <div className="bg-slate-200 w-12 h-12 rounded-full flex items-center justify-center mx-auto">
                    <HelpCircle className="w-6 h-6 text-slate-500" />
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

      {/* 3. THE SPLITTING ENGINE MODAL */}
      {isSplittingModalOpen && (
        <SplittingEngineModal 
          onClose={() => setIsSplittingModalOpen(false)}
          onSuccess={() => {
            setIsSplittingModalOpen(false);
            // This triggers ContextFilters to refetch and shows the new virtual classes instantly!
            triggerRefresh(); 
          }}
        />
      )}
    </div>
  );
};

export default AllocationDashboard;