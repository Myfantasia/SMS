// src/components/subjectAllocations/ActionButtons.tsx

import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Save, Wand2, Copy, Loader2, X, Eraser, RotateCcw, Users, AlertTriangle, CheckCircle2, Layers, Lock, Unlock } from 'lucide-react';
import type { MatrixRow } from '../../libs/types';
import api from '../../libs/axiosInstance';
import { pollJob } from '../../libs/pollJob';

interface BulkAllocateResult {
  message: string;
  per_class: { class_id: number; class_name: string; assigned: number; unresolved: number; class_teacher_assigned: boolean }[];
  classes_with_gaps: { class_id: number; class_name: string; assigned: number; unresolved: number; class_teacher_assigned: boolean }[];
  teachers_near_cap: { teacher_name: string; weekly_lessons: number; cap: number }[];
  ejected_lesson_count: number;
  skipped_published?: { class_id: number; class_name: string }[];
}

interface ActionButtonsProps {
  yearId: string;
  termId: string;
  classId: string;
  gradeId: string;
  gradeName: string;
  classDisplayName: string;
  matrixData: MatrixRow[];
  setMatrixData: React.Dispatch<React.SetStateAction<MatrixRow[]>>;
  isPublished: boolean;
  isVirtualStream: boolean;
  onRefresh: () => void; // Trigger to reload the grid from the database
  onOpenSplittingModal: () => void;
}

const ActionButtons: React.FC<ActionButtonsProps> = ({
  yearId,
  termId,
  classId,
  gradeId,
  gradeName,
  classDisplayName,
  matrixData,
  setMatrixData,
  isPublished,
  isVirtualStream,
  onRefresh,
  onOpenSplittingModal
}) => {
  const [isSaving, setIsSaving] = useState(false);
  const [isAutoAllocating, setIsAutoAllocating] = useState(false);
  const [isUnpublishing, setIsUnpublishing] = useState(false);

  // Rollover Modal States
  const [isRolloverModalOpen, setIsRolloverModalOpen] = useState(false);
  const [isRollingOver, setIsRollingOver] = useState(false);
  const [sourceTermId, setSourceTermId] = useState('');
  const [availableTerms, setAvailableTerms] = useState<{id: number, name: string, academic_year_id: number}[]>([]);
  const [rolloverScope, setRolloverScope] = useState<'class' | 'all'>('all');

  // Bulk (whole-grade) Auto-Allocate States
  const [isBulkConfirmOpen, setIsBulkConfirmOpen] = useState(false);
  const [isBulkAllocating, setIsBulkAllocating] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkAllocateResult | null>(null);

  // Clear (backend-hitting) States
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearScope, setClearScope] = useState<'class' | 'grade' | 'all'>('class');
  const [isClearing, setIsClearing] = useState(false);

  // Unpublish Scope States
  const [showUnpublishConfirm, setShowUnpublishConfirm] = useState(false);
  const [unpublishScope, setUnpublishScope] = useState<'class' | 'grade' | 'all'>('class');

  // Save Scope States — 'class' (default) saves+publishes just this class exactly as before;
  // 'grade'/'all' additionally publish every other already-drafted class in that wider scope
  // in the same click, so a whole grade/school can be finalized without re-opening each class.
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);
  const [saveScope, setSaveScope] = useState<'class' | 'grade' | 'all'>('class');

  // Revert Confirmation States
  const [showRevertConfirm, setShowRevertConfirm] = useState(false);

  const isContextReady = yearId && termId && classId;
  const isBusy = isSaving || isAutoAllocating || isBulkAllocating || isClearing || isUnpublishing;

  // --- 1. SAVE LOGIC ---
  // Saving this class always happens; `scope` only controls whether OTHER already-drafted
  // classes get swept up and published in the same request (see AllocationMatrixAPIView.post).
  const handleSave = async (scope: 'class' | 'grade' | 'all' = 'class') => {
    if (!isContextReady) return;

    const allocationsPayload = matrixData
      .filter(row => row.assigned_teacher_id !== "")
      .map(row => ({
        subject_id: row.subject_id,
        teacher_id: row.assigned_teacher_id
      }));

    setIsSaving(true);
    try {
      const response = await api.post('/api/allocations/matrix/', {
        class_id: classId,
        term_id: termId,
        year_id: yearId,
        allocations: allocationsPayload,
        publish_scope: scope
      });

      toast.success(response.data.message || "Allocations saved successfully!");
      onRefresh(); // Refresh the grid to lock in changes
    } catch (error: any) {
      console.error("Save Error:", error);
      toast.error(error.response?.data?.error || "Failed to save allocations.");
    } finally {
      setIsSaving(false);
      setShowSaveConfirm(false);
    }
  };

  // Grade/school scope also publishes OTHER classes' already-saved drafts, so gate it behind a
  // confirmation like Clear Grid/Unpublish do — plain "just this class" stays a single click.
  const handleSaveClick = () => {
    if (saveScope === 'class') {
      handleSave('class');
    } else {
      setShowSaveConfirm(true);
    }
  };

  // --- 2. AUTO-ALLOCATE LOGIC ---
  // One step, like Bulk Allocate: run the algorithm, then immediately save + publish the result
  // (no separate manual Save Grid click needed) instead of only staging it in local state.
  const handleAutoAllocate = async () => {
    if (!isContextReady) return;

    setIsAutoAllocating(true);
    try {
      const draftResponse = await api.get('/api/allocations/auto-draft/', {
        params: { class_id: classId, term_id: termId, year_id: yearId }
      });

      const draftResults = draftResponse.data.draft;

      const updatedMatrixData = matrixData.map(row => {
        const draftMatch = draftResults.find((d: any) => d.subject_id === row.subject_id);
        return draftMatch
          ? { ...row, assigned_teacher_id: draftMatch.teacher_id, status: draftMatch.status }
          : row;
      });
      setMatrixData(updatedMatrixData);

      const allocationsPayload = updatedMatrixData
        .filter(row => row.assigned_teacher_id !== "")
        .map(row => ({
          subject_id: row.subject_id,
          teacher_id: row.assigned_teacher_id
        }));

      const saveResponse = await api.post('/api/allocations/matrix/', {
        class_id: classId,
        term_id: termId,
        year_id: yearId,
        allocations: allocationsPayload
      });

      toast.success(saveResponse.data.message || "Auto-allocated and published to the live grid.");
      onRefresh();
    } catch (error: any) {
      console.error("Auto-Allocate Error:", error);
      toast.error(error.response?.data?.error || "Algorithm failed to run.");
    } finally {
      setIsAutoAllocating(false);
    }
  };

  // --- 3. CLEAR LOGIC (backend-hitting, scoped like the Timetable's Clear Grid) ---
  const confirmClearGrid = async () => {
    if (!isContextReady) return;

    setIsClearing(true);
    try {
      const params: Record<string, string> = { term_id: termId, year_id: yearId };
      if (clearScope === 'class') {
        params.class_id = classId;
      } else if (clearScope === 'grade') {
        params.grade_id = gradeId;
      }
      const response = await api.delete('/api/allocations/clear/', { params });
      toast.success(response.data.message || "Allocations cleared.");
      onRefresh();
    } catch (error: any) {
      console.error("Clear Error:", error);
      toast.error(error.response?.data?.error || "Failed to clear allocations.");
    } finally {
      setIsClearing(false);
      setShowClearConfirm(false);
    }
  };

  // --- 4. REVERT LOGIC ---
  const confirmRevertToSaved = () => {
    onRefresh();
    toast.success("Discarded unsaved changes.");
    setShowRevertConfirm(false);
  };

  // --- UNPUBLISH LOGIC (scoped like Clear Grid: class / grade / entire term) ---
  const confirmUnpublish = async () => {
    if (!isContextReady) return;
    setIsUnpublishing(true);
    try {
      const payload: Record<string, string> = { term_id: termId, year_id: yearId };
      if (unpublishScope === 'class') {
        payload.class_id = classId;
      } else if (unpublishScope === 'grade') {
        payload.grade_id = gradeId;
      }
      const response = await api.post('/api/allocations/unpublish/', payload);
      toast.success(response.data.message || "Reverted to draft.");
      onRefresh();
    } catch (error: any) {
      toast.error(error.response?.data?.error || "Failed to unpublish.");
    } finally {
      setIsUnpublishing(false);
      setShowUnpublishConfirm(false);
    }
  };

  // --- 5. ROLLOVER LOGIC ---
  const fetchTermsForRollover = async () => {
    try {
        // Real numeric term IDs (not names) — /api/results/filter-options/ used to be sourced
        // here instead, which only returns distinct term *names* (not year-scoped, and not
        // real IDs), so the rollover POST was silently sent a name where an integer PK was
        // expected and always errored. This endpoint gives real ids.
        const response = await api.get('/api/exams/setup-data/');
        const allTerms: { id: number; name: string; academic_year_id: number }[] = response.data.terms || [];
        // Exclude the term we're rolling INTO — copying a term onto itself is meaningless.
        const formattedTerms = allTerms.filter(t => String(t.id) !== String(termId));
        setAvailableTerms(formattedTerms);
        setRolloverScope('all');
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

    const sourceTerm = availableTerms.find(t => String(t.id) === sourceTermId);

    setIsRollingOver(true);
    try {
        // The actual clone/validate/timetable-sync work now runs in a Celery worker (see
        // school/tasks.py:rollover_allocations_task) — this just queues it and gets a job id back.
        const response = await api.post('/api/allocations/rollover/', {
            source_term_id: sourceTermId,
            source_year_id: sourceTerm?.academic_year_id,
            target_term_id: termId,
            year_id: yearId,
            class_id: rolloverScope === 'class' ? classId : undefined
        });

        const result = await pollJob<{ message: string }>(response.data.job_id);
        toast.success(result.message);
        setIsRolloverModalOpen(false);
        onRefresh();
    } catch (error: any) {
        toast.error(error.response?.data?.error || error.message || "Failed to rollover allocations.");
    } finally {
        setIsRollingOver(false);
    }
  };

  // --- 6. BULK (WHOLE-GRADE) AUTO-ALLOCATE LOGIC ---
  const handleBulkAllocate = async () => {
    if (!gradeId || !termId || !yearId) return;

    setIsBulkAllocating(true);
    try {
      // Runs in a Celery worker (school/tasks.py:bulk_auto_allocate_task) — this just
      // queues it and gets a job id back to poll.
      const response = await api.post('/api/allocations/bulk-auto-allocate/', {
        grade_id: gradeId,
        term_id: termId,
        year_id: yearId
      });

      const result = await pollJob<BulkAllocateResult>(response.data.job_id);
      setBulkResult(result);
      setIsBulkConfirmOpen(false);
      toast.success(result.message || "Bulk allocation complete.");
      onRefresh(); // Reload the currently viewed class so it reflects the new allocations
    } catch (error: any) {
      console.error("Bulk Allocate Error:", error);
      toast.error(error.response?.data?.error || error.message || "Bulk allocation failed.");
    } finally {
      setIsBulkAllocating(false);
    }
  };

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 bg-white border border-slate-200 rounded-2xl shadow-sm">

        {/* Generate Group */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mr-1">Generate</span>

          <button
            onClick={handleAutoAllocate}
            disabled={!isContextReady || isBusy || isPublished}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors shadow-sm disabled:opacity-50"
            title={isPublished ? "This class is published — unpublish it first to auto-allocate again" : "Auto-assign teachers for this class only — saves and publishes immediately"}
          >
            {isAutoAllocating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
            <span className="hidden sm:inline">Auto-Allocate</span>
          </button>

          <button
            onClick={() => setIsBulkConfirmOpen(true)}
            disabled={!isContextReady || !gradeId || isBusy}
            className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-lg transition-colors shadow-sm disabled:opacity-50"
            title={`Coordinated allocation across every class in ${gradeName || 'this grade'} — commits directly, no review step`}
          >
            {isBulkAllocating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
            <span className="hidden sm:inline">Bulk Allocate Grade</span>
          </button>

          <button
            onClick={onOpenSplittingModal}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-sm font-medium rounded-lg transition-colors border border-indigo-200 disabled:opacity-50"
            title="Manage elective split groups for this grade"
          >
            <Layers className="w-4 h-4" />
            <span className="hidden sm:inline">Manage Elective Splits</span>
          </button>
        </div>

        {/* Utilities + Danger Zone + Save */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mr-1">Utilities</span>

          <button
            onClick={fetchTermsForRollover}
            disabled={!isContextReady || isBusy}
            className="flex items-center gap-2 px-4 py-2 border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
            title="Copy assignments from a previous term"
          >
            <Copy className="w-4 h-4" />
            <span className="hidden sm:inline">Rollover</span>
          </button>

          <button
            onClick={() => setShowRevertConfirm(true)}
            disabled={!isContextReady || isBusy}
            className="flex items-center gap-2 px-4 py-2 border border-amber-200 text-amber-600 hover:bg-amber-50 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
            title="Discard unsaved changes and reload from database"
          >
            <RotateCcw className="w-4 h-4" />
            <span className="hidden sm:inline">Revert</span>
          </button>

          <span className="w-px h-6 bg-slate-200 mx-1 hidden sm:block" />

          <button
            onClick={() => { setClearScope('class'); setShowClearConfirm(true); }}
            disabled={!isContextReady || isBusy || isPublished}
            className="flex items-center gap-2 px-4 py-2 border border-red-200 text-red-600 hover:bg-red-50 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
            title={isPublished ? "This class is published — unpublish it first to clear it" : "Permanently delete saved allocations — choose this class or the whole school"}
          >
            {isClearing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eraser className="w-4 h-4" />}
            <span className="hidden sm:inline">Clear Grid</span>
          </button>

          <span className="w-px h-6 bg-slate-200 mx-1 hidden sm:block" />

          {isPublished ? (
            <button
              onClick={() => { setUnpublishScope('class'); setShowUnpublishConfirm(true); }}
              disabled={!isContextReady || isBusy}
              className="flex items-center gap-2 px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-bold rounded-lg transition-colors shadow-sm disabled:opacity-50"
              title="Revert to draft so allocations can be edited again — choose this class, the whole grade, or the whole term"
            >
              {isUnpublishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unlock className="w-4 h-4" />}
              <span>Unpublish</span>
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleSaveClick}
                disabled={!isContextReady || isBusy}
                className="flex items-center gap-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-lg transition-colors shadow-sm disabled:opacity-50"
                title={
                  saveScope === 'all'
                    ? "Saves this class, then also publishes every other already-drafted class in the school"
                    : saveScope === 'grade'
                      ? `Saves this class, then also publishes every other already-drafted class in ${gradeName || 'this grade'}`
                      : "Saves and publishes — locks this class until unpublished"
                }
              >
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                <span>{saveScope === 'all' ? 'Save + Publish School' : saveScope === 'grade' ? 'Save + Publish Grade' : 'Save Grid'}</span>
              </button>
              <select
                value={saveScope}
                onChange={(e) => setSaveScope(e.target.value as 'class' | 'grade' | 'all')}
                disabled={!isContextReady || isBusy}
                className="text-xs font-medium border border-slate-200 rounded-lg px-2 py-2.5 bg-white text-slate-600 disabled:opacity-50"
                title="Choose what else gets published when you click Save"
              >
                <option value="class">This class only</option>
                {gradeId && <option value="grade">+ Publish rest of grade</option>}
                <option value="all">+ Publish rest of school</option>
              </select>
            </div>
          )}

          {isPublished && (
            <span className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold rounded-lg">
              <Lock className="w-3.5 h-3.5" />
              Published
            </span>
          )}
        </div>

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
                    <label htmlFor="sourceTermSelect" className="block text-sm font-medium text-slate-700 mb-1">Copy From Term:</label>
                    <select id="sourceTermSelect"
                        className="w-full border-slate-300 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500 p-2.5 border mb-4"
                        value={sourceTermId}
                        onChange={(e) => setSourceTermId(e.target.value)}
                    >
                        <option value="">-- Select Source Term --</option>
                        {availableTerms.map((t) => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                    </select>

                    <label className="block text-sm font-medium text-slate-700 mb-1">Apply To:</label>
                    <div className="flex flex-col gap-2 text-left mb-2">
                        <label className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors ${rolloverScope === 'class' ? 'border-emerald-300 bg-emerald-50/60' : 'border-slate-200 hover:bg-slate-50'}`}>
                            <input type="radio" name="rollover-scope" className="mt-1" checked={rolloverScope === 'class'} onChange={() => setRolloverScope('class')} />
                            <span>
                                <span className="block text-sm font-bold text-slate-800">Just {classDisplayName || 'this class'}</span>
                                <span className="block text-xs text-slate-500">Copies assignments for this class only. Other classes are untouched.</span>
                            </span>
                        </label>
                        <label className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors ${rolloverScope === 'all' ? 'border-emerald-300 bg-emerald-50/60' : 'border-slate-200 hover:bg-slate-50'}`}>
                            <input type="radio" name="rollover-scope" className="mt-1" checked={rolloverScope === 'all'} onChange={() => setRolloverScope('all')} />
                            <span>
                                <span className="block text-sm font-bold text-slate-800">Every class in the target term</span>
                                <span className="block text-xs text-slate-500">Overwrites assignments school-wide for the term you're rolling into. Cannot be undone.</span>
                            </span>
                        </label>
                    </div>
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
                        {rolloverScope === 'all' ? 'Execute Rollover' : `Roll Over ${classDisplayName || 'Class'}`}
                    </button>
                </div>
            </div>
        </div>
      )}

      {/* --- CLEAR GRID CONFIRMATION MODAL (scoped, like the Timetable's Clear Grid) --- */}
      {showClearConfirm && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-fade-in p-6 text-center space-y-4">
                <div className="w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto">
                    <Eraser className="w-6 h-6" />
                </div>
                <h3 className="font-bold text-xl text-slate-800">Clear Allocations?</h3>
                <p className="text-sm text-slate-500">
                    This permanently deletes saved teacher assignments and ejects any matching lessons from the active timetable. It cannot be undone.
                </p>

                <div className="flex flex-col gap-2 text-left">
                    <label className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors ${clearScope === 'class' ? 'border-red-300 bg-red-50/60' : 'border-slate-200 hover:bg-slate-50'}`}>
                        <input type="radio" name="clear-scope" className="mt-1" checked={clearScope === 'class'} onChange={() => setClearScope('class')} />
                        <span>
                            <span className="block text-sm font-bold text-slate-800">Just {classDisplayName || 'this class'}</span>
                            <span className="block text-xs text-slate-500">
                                Removes allocations for this class only. Other classes are untouched
                                {/* Elective groups pool students from every stream in the grade, so
                                    clearing one stream deliberately leaves them alone — see the
                                    "This Grade" option below to also reset those. */}
                                {!isVirtualStream && ' — including this grade\'s elective groups, which stay as-is'}.
                            </span>
                        </span>
                    </label>
                    {gradeId && (
                        <label className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors ${clearScope === 'grade' ? 'border-red-300 bg-red-50/60' : 'border-slate-200 hover:bg-slate-50'}`}>
                            <input type="radio" name="clear-scope" className="mt-1" checked={clearScope === 'grade'} onChange={() => setClearScope('grade')} />
                            <span>
                                <span className="block text-sm font-bold text-slate-800">This Grade ({gradeName || 'incl. elective groups'})</span>
                                <span className="block text-xs text-slate-500">Removes allocations for every stream AND elective group in this grade. Other grades are untouched.</span>
                            </span>
                        </label>
                    )}
                    <label className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors ${clearScope === 'all' ? 'border-red-300 bg-red-50/60' : 'border-slate-200 hover:bg-slate-50'}`}>
                        <input type="radio" name="clear-scope" className="mt-1" checked={clearScope === 'all'} onChange={() => setClearScope('all')} />
                        <span>
                            <span className="block text-sm font-bold text-slate-800">The entire school</span>
                            <span className="block text-xs text-slate-500">Removes every class's allocations for this term. Cannot be undone.</span>
                        </span>
                    </label>
                </div>

                <div className="flex gap-3 pt-2">
                    <button onClick={() => setShowClearConfirm(false)} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 rounded-lg font-bold hover:bg-slate-50">Cancel</button>
                    <button
                        onClick={confirmClearGrid}
                        disabled={isClearing}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-red-600 text-white rounded-lg font-bold hover:bg-red-700 disabled:opacity-50"
                    >
                        {isClearing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                        {clearScope === 'all' ? 'Clear Entire School' : clearScope === 'grade' ? `Clear ${gradeName || 'Grade'}` : `Clear ${classDisplayName || 'Class'}`}
                    </button>
                </div>
            </div>
        </div>
      )}

      {/* --- UNPUBLISH CONFIRMATION MODAL (scoped, like Clear Grid) --- */}
      {showUnpublishConfirm && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-fade-in p-6 text-center space-y-4">
                <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto">
                    <Unlock className="w-6 h-6" />
                </div>
                <h3 className="font-bold text-xl text-slate-800">Unpublish Allocations?</h3>
                <p className="text-sm text-slate-500">
                    Reverts published allocations back to draft so they can be edited or re-generated again.
                </p>

                <div className="flex flex-col gap-2 text-left">
                    <label className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors ${unpublishScope === 'class' ? 'border-amber-300 bg-amber-50/60' : 'border-slate-200 hover:bg-slate-50'}`}>
                        <input type="radio" name="unpublish-scope" className="mt-1" checked={unpublishScope === 'class'} onChange={() => setUnpublishScope('class')} />
                        <span>
                            <span className="block text-sm font-bold text-slate-800">Just {classDisplayName || 'this class'}</span>
                            <span className="block text-xs text-slate-500">Reverts this class only. Other classes are untouched.</span>
                        </span>
                    </label>
                    {gradeId && (
                        <label className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors ${unpublishScope === 'grade' ? 'border-amber-300 bg-amber-50/60' : 'border-slate-200 hover:bg-slate-50'}`}>
                            <input type="radio" name="unpublish-scope" className="mt-1" checked={unpublishScope === 'grade'} onChange={() => setUnpublishScope('grade')} />
                            <span>
                                <span className="block text-sm font-bold text-slate-800">This Grade ({gradeName || 'incl. elective groups'})</span>
                                <span className="block text-xs text-slate-500">Reverts every published stream AND elective group in this grade. Other grades are untouched.</span>
                            </span>
                        </label>
                    )}
                    <label className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors ${unpublishScope === 'all' ? 'border-amber-300 bg-amber-50/60' : 'border-slate-200 hover:bg-slate-50'}`}>
                        <input type="radio" name="unpublish-scope" className="mt-1" checked={unpublishScope === 'all'} onChange={() => setUnpublishScope('all')} />
                        <span>
                            <span className="block text-sm font-bold text-slate-800">The entire school</span>
                            <span className="block text-xs text-slate-500">Reverts every published class for this term back to draft.</span>
                        </span>
                    </label>
                </div>

                <div className="flex gap-3 pt-2">
                    <button onClick={() => setShowUnpublishConfirm(false)} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 rounded-lg font-bold hover:bg-slate-50">Cancel</button>
                    <button
                        onClick={confirmUnpublish}
                        disabled={isUnpublishing}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-600 text-white rounded-lg font-bold hover:bg-amber-700 disabled:opacity-50"
                    >
                        {isUnpublishing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                        {unpublishScope === 'all' ? 'Unpublish Entire School' : unpublishScope === 'grade' ? `Unpublish ${gradeName || 'Grade'}` : `Unpublish ${classDisplayName || 'Class'}`}
                    </button>
                </div>
            </div>
        </div>
      )}

      {/* --- SAVE + PUBLISH SCOPE CONFIRMATION MODAL (only shown for grade/school scope) --- */}
      {showSaveConfirm && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-fade-in p-6 text-center space-y-4">
                <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
                    <Save className="w-6 h-6" />
                </div>
                <h3 className="font-bold text-xl text-slate-800">Save &amp; Publish {saveScope === 'all' ? 'Entire School' : `${gradeName || 'Grade'}`}?</h3>
                <p className="text-sm text-slate-500">
                    Saves {classDisplayName || 'this class'} as usual, then also publishes every other class
                    {saveScope === 'grade' ? ` in ${gradeName || 'this grade'}` : ' in the school'} that
                    already has a saved draft but isn't published yet. Classes with nothing saved are left alone.
                    Published classes are locked until unpublished.
                </p>

                <div className="flex gap-3 pt-2">
                    <button onClick={() => setShowSaveConfirm(false)} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 rounded-lg font-bold hover:bg-slate-50">Cancel</button>
                    <button
                        onClick={() => handleSave(saveScope)}
                        disabled={isSaving}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-lg font-bold hover:bg-emerald-700 disabled:opacity-50"
                    >
                        {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                        {saveScope === 'all' ? 'Save + Publish School' : `Save + Publish ${gradeName || 'Grade'}`}
                    </button>
                </div>
            </div>
        </div>
      )}

      {/* --- REVERT CONFIRMATION MODAL --- */}
      {showRevertConfirm && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-fade-in p-6 text-center space-y-4">
                <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto">
                    <RotateCcw className="w-6 h-6" />
                </div>
                <h3 className="font-bold text-xl text-slate-800">Discard Unsaved Changes?</h3>
                <p className="text-sm text-slate-500">
                    This reloads the grid from what's actually saved in the database, discarding any edits made on screen since your last save.
                </p>
                <div className="flex gap-3 pt-2">
                    <button onClick={() => setShowRevertConfirm(false)} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 rounded-lg font-bold hover:bg-slate-50">Cancel</button>
                    <button onClick={confirmRevertToSaved} className="flex-1 px-4 py-2.5 bg-amber-600 text-white rounded-lg font-bold hover:bg-amber-700">Discard</button>
                </div>
            </div>
        </div>
      )}

      {/* --- BULK (WHOLE-GRADE) ALLOCATE CONFIRMATION MODAL --- */}
      {isBulkConfirmOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                    <h3 className="font-bold text-slate-800">Bulk Allocate Whole Grade</h3>
                    <button
                        onClick={() => setIsBulkConfirmOpen(false)}
                        className="text-slate-400 hover:text-slate-600"
                        title="Close bulk allocate modal"
                        aria-label="Close bulk allocate modal"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <div className="p-6">
                    <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 p-4 rounded-xl mb-4">
                        <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                        <p className="text-sm text-amber-800">
                            This wipes and re-generates assignments for <span className="font-semibold">every class in {gradeName || 'this grade'}</span> for the currently selected term — not just the class on screen. It commits directly (no draft/review step), running one coordinated pass so no teacher is overloaded and every class teacher's own subject is reserved first.
                        </p>
                    </div>
                    <p className="text-sm text-slate-600">
                        Any subjects the algorithm can't fully resolve (e.g. a class teacher unqualified for anything taught in their own grade, or a subject with too few qualified teachers) will be reported back after it runs, not silently dropped.
                    </p>
                </div>
                <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                    <button
                        onClick={() => setIsBulkConfirmOpen(false)}
                        className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleBulkAllocate}
                        disabled={isBulkAllocating}
                        className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                    >
                        {isBulkAllocating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
                        Run Bulk Allocation
                    </button>
                </div>
            </div>
        </div>
      )}

      {/* --- BULK (WHOLE-GRADE) ALLOCATE RESULT MODAL --- */}
      {bulkResult && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
                    <h3 className="font-bold text-slate-800 flex items-center gap-2">
                        <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                        Bulk Allocation Results
                    </h3>
                    <button
                        onClick={() => setBulkResult(null)}
                        className="text-slate-400 hover:text-slate-600"
                        title="Close results"
                        aria-label="Close results"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <div className="p-6 overflow-y-auto space-y-5">
                    <p className="text-sm text-slate-700">{bulkResult.message}</p>

                    {bulkResult.ejected_lesson_count > 0 && (
                        <p className="text-sm text-slate-500">
                            {bulkResult.ejected_lesson_count} stale timetable lesson(s) for dropped teacher-subject pairs were cleared.
                        </p>
                    )}

                    <div>
                        <h4 className="text-sm font-bold text-slate-700 mb-2">Per-Class Summary</h4>
                        <div className="border border-slate-200 rounded-lg overflow-hidden">
                            <table className="w-full text-sm">
                                <thead className="bg-slate-50 text-slate-600">
                                    <tr>
                                        <th className="text-left px-3 py-2 font-medium">Class</th>
                                        <th className="text-left px-3 py-2 font-medium">Assigned</th>
                                        <th className="text-left px-3 py-2 font-medium">Unresolved</th>
                                        <th className="text-left px-3 py-2 font-medium">Class Teacher</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {bulkResult.per_class.map((c) => (
                                        <tr key={c.class_id} className="border-t border-slate-100">
                                            <td className="px-3 py-2 text-slate-800">{c.class_name}</td>
                                            <td className="px-3 py-2 text-slate-600">{c.assigned}</td>
                                            <td className={`px-3 py-2 ${c.unresolved > 0 ? 'text-red-600 font-semibold' : 'text-slate-600'}`}>{c.unresolved}</td>
                                            <td className="px-3 py-2">
                                                {c.class_teacher_assigned
                                                    ? <span className="text-emerald-600 font-medium">Assigned</span>
                                                    : <span className="text-red-600 font-medium">Missing</span>}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {bulkResult.skipped_published && bulkResult.skipped_published.length > 0 && (
                        <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-200 p-4 rounded-xl">
                            <Lock className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                            <div className="text-sm text-emerald-800">
                                <p className="font-semibold mb-1">
                                    {bulkResult.skipped_published.length} published class(es) were skipped
                                </p>
                                <p>
                                    {bulkResult.skipped_published.map(c => c.class_name).join(', ')} — already
                                    published and left untouched. Unpublish a class first if it needs to be
                                    re-run.
                                </p>
                            </div>
                        </div>
                    )}

                    {bulkResult.classes_with_gaps.length > 0 && (
                        <div className="flex items-start gap-3 bg-red-50 border border-red-200 p-4 rounded-xl">
                            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                            <div className="text-sm text-red-800">
                                <p className="font-semibold mb-1">{bulkResult.classes_with_gaps.length} class(es) have unresolved gaps</p>
                                <p>
                                    These are genuine staffing gaps the algorithm could not solve (e.g. no qualified teacher available, or a class teacher unqualified for any subject taught in their own grade) — they need a manual fix, either by assigning a teacher directly on the grid or updating qualifications.
                                </p>
                            </div>
                        </div>
                    )}

                    {bulkResult.teachers_near_cap.length > 0 && (
                        <div>
                            <h4 className="text-sm font-bold text-slate-700 mb-2">Teachers Near Their Weekly Cap</h4>
                            <div className="border border-slate-200 rounded-lg overflow-hidden">
                                <table className="w-full text-sm">
                                    <thead className="bg-slate-50 text-slate-600">
                                        <tr>
                                            <th className="text-left px-3 py-2 font-medium">Teacher</th>
                                            <th className="text-left px-3 py-2 font-medium">Weekly Lessons</th>
                                            <th className="text-left px-3 py-2 font-medium">Cap</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {bulkResult.teachers_near_cap.map((t, i) => (
                                            <tr key={i} className="border-t border-slate-100">
                                                <td className="px-3 py-2 text-slate-800">{t.teacher_name}</td>
                                                <td className={`px-3 py-2 ${t.weekly_lessons >= t.cap ? 'text-red-600 font-semibold' : 'text-amber-600 font-medium'}`}>{t.weekly_lessons}</td>
                                                <td className="px-3 py-2 text-slate-600">{t.cap}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
                <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex justify-end shrink-0">
                    <button
                        onClick={() => setBulkResult(null)}
                        className="px-4 py-2 text-sm font-medium bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
      )}
    </>
  );
};

export default ActionButtons;