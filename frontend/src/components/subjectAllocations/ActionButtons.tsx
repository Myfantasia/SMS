// src/components/subjectAllocations/ActionButtons.tsx

import React, { useState } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { Save, Wand2, Copy, Loader2, X, Eraser, RotateCcw } from 'lucide-react';
import type { MatrixRow } from '../../libs/types';

interface ActionButtonsProps {
  yearId: string;
  termId: string;
  classId: string;
  matrixData: MatrixRow[];
  setMatrixData: React.Dispatch<React.SetStateAction<MatrixRow[]>>;
  onRefresh: () => void; // Trigger to reload the grid from the database
}

const ActionButtons: React.FC<ActionButtonsProps> = ({
  yearId,
  termId,
  classId,
  matrixData,
  setMatrixData,
  onRefresh
}) => {
  const [isSaving, setIsSaving] = useState(false);
  const [isAutoAllocating, setIsAutoAllocating] = useState(false);
  
  // Rollover Modal States
  const [isRolloverModalOpen, setIsRolloverModalOpen] = useState(false);
  const [isRollingOver, setIsRollingOver] = useState(false);
  const [sourceTermId, setSourceTermId] = useState('');
  const [availableTerms, setAvailableTerms] = useState<{id: number, name: string}[]>([]);

  const isContextReady = yearId && termId && classId;

  // --- 1. SAVE LOGIC ---
  const handleSave = async () => {
    if (!isContextReady) return;

    const allocationsPayload = matrixData
      .filter(row => row.assigned_teacher_id !== "")
      .map(row => ({
        subject_id: row.subject_id,
        teacher_id: row.assigned_teacher_id
      }));

    setIsSaving(true);
    try {
      const response = await axios.post('/api/allocations/matrix/', {
        class_id: classId,
        term_id: termId,
        year_id: yearId,
        allocations: allocationsPayload
      });

      toast.success(response.data.message || "Allocations saved successfully!");
      onRefresh(); // Refresh the grid to lock in changes
    } catch (error: any) {
      console.error("Save Error:", error);
      toast.error(error.response?.data?.error || "Failed to save allocations.");
    } finally {
      setIsSaving(false);
    }
  };

  // --- 2. AUTO-ALLOCATE LOGIC ---
  const handleAutoAllocate = async () => {
    if (!isContextReady) return;

    setIsAutoAllocating(true);
    try {
      const response = await axios.get('/api/allocations/auto-draft/', {
        params: { class_id: classId, term_id: termId, year_id: yearId }
      });

      const draftResults = response.data.draft;

      setMatrixData(prevData => 
        prevData.map(row => {
          const draftMatch = draftResults.find((d: any) => d.subject_id === row.subject_id);
          if (draftMatch) {
            return {
              ...row,
              assigned_teacher_id: draftMatch.teacher_id,
              status: draftMatch.status
            };
          }
          return row;
        })
      );

      toast.success("Algorithm applied! Review the draft before saving.");
    } catch (error: any) {
      console.error("Auto-Allocate Error:", error);
      toast.error(error.response?.data?.error || "Algorithm failed to run.");
    } finally {
      setIsAutoAllocating(false);
    }
  };

  // --- 3. REVERT & CLEAR LOGIC ---
  const handleClearGrid = () => {
    setMatrixData(prevData => 
      prevData.map(row => ({
        ...row,
        assigned_teacher_id: "",
        status: null // Clear algorithm warnings
      }))
    );
    toast.success("Grid cleared! Click Save to apply this to the database.");
  };

  const handleRevertToSaved = () => {
    onRefresh();
    toast.success("Discarded unsaved changes.");
  };

  // --- 4. ROLLOVER LOGIC ---
  const fetchTermsForRollover = async () => {
    try {
        const token = localStorage.getItem('firebase_dev_token');
        const response = await axios.get('http://127.0.0.1:8000/api/results/filter-options/', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const formattedTerms = response.data.terms.map((t: string, index: number) => ({
            id: index,
            name: t
        }));
        setAvailableTerms(formattedTerms);
        setIsRolloverModalOpen(true);
    } catch (error) {
        console.error("Error fetching terms for rollover:", error);
        toast.error("Could not fetch terms for rollover.");
    }
  };

  const executeRollover = async () => {
    if (!sourceTermId) {
        toast.error("Please select a term to copy from.");
        return;
    }

    setIsRollingOver(true);
    try {
        const response = await axios.post('/api/allocations/rollover/', {
            source_term_id: sourceTermId,
            target_term_id: termId,
            year_id: yearId
        });
        
        toast.success(response.data.message);
        setIsRolloverModalOpen(false);
        onRefresh(); 
    } catch (error: any) {
        toast.error(error.response?.data?.error || "Failed to rollover allocations.");
    } finally {
        setIsRollingOver(false);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 md:gap-3">
        
        {/* Utilities Group (Rollover, Clear, Revert) */}
        <div className="flex items-center gap-2 pr-2 border-r border-slate-600">
            <button
              onClick={fetchTermsForRollover}
              disabled={!isContextReady || isSaving || isAutoAllocating}
              className="flex items-center gap-2 px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              title="Copy assignments from a previous term"
            >
              <Copy className="w-4 h-4" />
              <span className="hidden xl:inline">Rollover</span>
            </button>

            <button
              onClick={handleClearGrid}
              disabled={!isContextReady || isSaving || isAutoAllocating}
              className="flex items-center gap-2 px-3 py-2 border border-red-400/50 text-red-400 hover:bg-red-400/10 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              title="Wipe all assignments on screen"
            >
              <Eraser className="w-4 h-4" />
              <span className="hidden xl:inline">Clear Grid</span>
            </button>

            <button
              onClick={handleRevertToSaved}
              disabled={!isContextReady || isSaving || isAutoAllocating}
              className="flex items-center gap-2 px-3 py-2 border border-amber-400/50 text-amber-400 hover:bg-amber-400/10 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              title="Discard unsaved changes and reload from database"
            >
              <RotateCcw className="w-4 h-4" />
              <span className="hidden xl:inline">Revert</span>
            </button>
        </div>

        {/* Primary Actions Group */}
        <button
          onClick={handleAutoAllocate}
          disabled={!isContextReady || isSaving || isAutoAllocating}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors shadow-sm disabled:opacity-50"
        >
          {isAutoAllocating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
          <span className="hidden sm:inline">Auto-Allocate</span>
        </button>

        <button
          onClick={handleSave}
          disabled={!isContextReady || isSaving || isAutoAllocating}
          className="flex items-center gap-2 px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-colors shadow-sm disabled:opacity-50"
        >
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          <span>Save Grid</span>
        </button>

      </div>

      {/* --- INLINE ROLLOVER MODAL (Remains Unchanged) --- */}
      {isRolloverModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                    <h3 className="font-bold text-slate-800">Rollover Allocations</h3>
                    <button
                        onClick={() => setIsRolloverModalOpen(false)}
                        className="text-slate-400 hover:text-slate-600"
                        title="Close rollover modal"
                        aria-label="Close rollover modal"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <div className="p-6">
                    <p className="text-sm text-slate-600 mb-4">
                        Select a previous term to copy all teaching assignments from. <br/>
                        <span className="font-semibold text-red-600">Warning:</span> This will overwrite any current assignments in the active grid.
                    </p>
                    <label htmlFor="sourceTermSelect" className="block text-sm font-medium text-slate-700 mb-1">Copy From Term:</label>
                    <select id="sourceTermSelect"
                        className="w-full border-slate-300 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500 p-2.5 border"
                        value={sourceTermId}
                        onChange={(e) => setSourceTermId(e.target.value)}
                    >
                        <option value="">-- Select Source Term --</option>
                        {availableTerms.map((t) => (
                            <option key={t.name} value={t.name}>{t.name}</option>
                        ))}
                    </select>
                </div>
                <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                    <button 
                        onClick={() => setIsRolloverModalOpen(false)}
                        className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"
                    >
                        Cancel
                    </button>
                    <button 
                        onClick={executeRollover}
                        disabled={isRollingOver || !sourceTermId}
                        className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                    >
                        {isRollingOver ? <Loader2 className="w-4 h-4 animate-spin" /> : <Copy className="w-4 h-4" />}
                        Execute Rollover
                    </button>
                </div>
            </div>
        </div>
      )}
    </>
  );
};

export default ActionButtons;