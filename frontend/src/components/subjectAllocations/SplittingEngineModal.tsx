// src/components/subjectAllocations/SplittingEngineModal.tsx

import React, { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Layers, Settings2, Play, Check, Loader2,
  Users, Info, ChevronRight, Search, Save, AlertTriangle, Briefcase, X, SlidersHorizontal
} from 'lucide-react';
import api from '../../libs/axiosInstance';
import type { GlobalAllocationPolicy } from '../../libs/types';

interface SplittingEngineModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

// --- Interfaces ---
interface GradeOption { id: number; grade_name: string; }
interface RuleRow { subject_id: number; subject_name: string; max_class_size: number; allocation_mode: string; }
interface ProjectedChange { subject_name: string; total_enrolled: number; threshold_limit: number; group_distribution: any[]; }
interface StreamImpact { name: string; action: 'created' | 'updated' | 'unchanged'; capacity: number; }
interface RemovedStreamImpact { name: string; had_allocations: number; had_lessons: number; had_attendance_sessions: number; }

type GlobalPolicy = GlobalAllocationPolicy;

const SplittingEngineModal: React.FC<SplittingEngineModalProps> = ({ onClose, onSuccess }) => {
  // --- Navigation State ---
  const [activeTab, setActiveTab] = useState<'SPLIT' | 'GLOBAL'>('SPLIT');

  // --- Tab 1 States (Splitting) ---
  const [grades, setGrades] = useState<GradeOption[]>([]);
  const [selectedGradeId, setSelectedGradeId] = useState<string>('');
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [projectedData, setProjectedData] = useState<ProjectedChange[]>([]);
  const [streamImpacts, setStreamImpacts] = useState<StreamImpact[]>([]);
  const [removedStreams, setRemovedStreams] = useState<RemovedStreamImpact[]>([]);
  const [showCommitConfirm, setShowCommitConfirm] = useState(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [pendingChanges, setPendingChanges] = useState<Record<number, boolean>>({});

  // --- Tab 2 States (Global Policy) ---
  const [globalPolicy, setGlobalPolicy] = useState<GlobalPolicy>({
    max_subjects_per_class: 2,
    max_classes_per_subject: 2,
    allow_cross_grade_teaching: false,
    max_weekly_lessons: 28,        
    max_total_class_groups: 6,     
    min_classes_per_subject: 2,
    enforce_prep_consolidation: true,
    enforcement_mode: 'STRICT'
  });
  const [isSavingPolicy, setIsSavingPolicy] = useState(false);

  // --- Loading & Exec States ---
  const [isLoadingGrades, setIsLoadingGrades] = useState<boolean>(false);
  const [isLoadingRules, setIsLoadingRules] = useState<boolean>(false);
  const [isBatchSaving, setIsBatchSaving] = useState<boolean>(false);
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [isCommitting, setIsCommitting] = useState<boolean>(false);

  // --- INITIALIZE DATA ---
  useEffect(() => {
    const fetchInitialData = async () => {
      setIsLoadingGrades(true);
      try {
        // Fetch Grades for Tab 1
        const gradeRes = await api.get('/api/manage-classes/');
        if (gradeRes.data?.status === 'success') {
          const mappedGrades = gradeRes.data.data.map((g: any) => ({ id: g.grade_id, grade_name: g.grade_name }));
          setGrades(mappedGrades);
          if (mappedGrades.length > 0) setSelectedGradeId(mappedGrades[0].id.toString());
        }
        // Fetch Policy for Tab 2
        const policyRes = await api.get('/api/allocations/global-policy/');
        if (policyRes.data) {
          setGlobalPolicy(policyRes.data);
        }
      } catch (error) {
        console.error("Error fetching initial data:", error);
        toast.error("Failed to load initial workspace data.");
      } finally {
        setIsLoadingGrades(false);
      }
    };
    fetchInitialData();
  }, []);

  // --- TAB 1: Fetch Grade Rules ---
  useEffect(() => {
    if (!selectedGradeId || activeTab !== 'SPLIT') return;
    const fetchSplittingRules = async () => {
      setIsLoadingRules(true);
      setProjectedData([]); setPendingChanges({}); setSearchQuery('');
      try {
        const response = await api.get(`/api/allocations/splitting-rules/${selectedGradeId}/`);
        if (response.data?.status === 'success') setRules(response.data.data);
      } catch (error) {
        console.error("Error fetching splitting rules:", error);
        toast.error("Could not fetch splitting policies for this grade.");
      } finally {
        setIsLoadingRules(false);
      }
    };
    fetchSplittingRules();
  }, [selectedGradeId, activeTab]);

  // --- TAB 1: Handlers ---
  const handleRowChange = (subjectId: number, field: keyof RuleRow, value: any) => {
    setRules(prev => prev.map(r => r.subject_id === subjectId ? { ...r, [field]: value } : r));
    setPendingChanges(prev => ({ ...prev, [subjectId]: true }));
  };

  const filteredRules = useMemo(
    () => rules
      .filter(r => r.subject_name.toLowerCase().includes(searchQuery.toLowerCase()))
      .sort((a, b) => a.subject_name.localeCompare(b.subject_name)),
    [rules, searchQuery]
  );

  const handleSaveAllPolicies = async () => {
    const alteredRows = rules.filter(r => pendingChanges[r.subject_id]);
    setIsBatchSaving(true);
    try {
      await Promise.all(alteredRows.map(row => 
        api.post(`/api/allocations/splitting-rules/${selectedGradeId}/`, {
          subject_id: row.subject_id, max_class_size: row.max_class_size, allocation_mode: row.allocation_mode
        })
      ));
      toast.success("All allocation updates saved.");
      setPendingChanges({});
      } catch (error) {
        console.error("Error saving all policies:", error);
        toast.error("Failed to commit configurations.");
    } finally {
      setIsBatchSaving(false);
    }
  };

  const handleTriggerSimulation = async () => {
    setIsSimulating(true);
    try {
      const response = await api.post(`/api/allocations/execute-splits/${selectedGradeId}/`, { is_simulation: true });
      if (response.data?.status === 'success') {
        setProjectedData(response.data.projected_data);
        setStreamImpacts(response.data.stream_impacts || []);
        setRemovedStreams(response.data.removed_streams || []);
        toast.success("Simulation layout ready!");
      }
    } catch (error) {
      console.error("Error triggering simulation:", error);
      toast.error("Simulation engine pipeline failed.");
    } finally {
      setIsSimulating(false);
    }
  };

  const handleCommitLiveSplits = async () => {
    setIsCommitting(true);
    try {
      const response = await api.post(`/api/allocations/execute-splits/${selectedGradeId}/`, { is_simulation: false });
      if (response.data?.status === 'success') {
        toast.success("Virtual pools deployed successfully.");
        setShowCommitConfirm(false);
        onSuccess(); // Close and refresh dashboard
      }
    } catch (error) {
      console.error("Error committing live splits:", error);
      toast.error("Live structural pool migration failed.");
    } finally {
      setIsCommitting(false);
    }
  };

  // --- TAB 2: Handlers ---
  const handlePolicyChange = (field: keyof GlobalPolicy, value: any) => {
    setGlobalPolicy(prev => ({ ...prev, [field]: value }));
  };

  const handleSaveGlobalPolicy = async () => {
    setIsSavingPolicy(true);
    try {
      const response = await api.post('/api/allocations/global-policy/', globalPolicy);
      if (response.status === 200) {
        toast.success("Global constraint algorithms updated.");
      }
    } catch (error) {
      console.error("Error saving global policy:", error);
      toast.error("Failed to update global policy.");
    } finally {
      setIsSavingPolicy(false);
    }
  };

  // --- RENDER ---
  const hasUnsavedChanges = Object.keys(pendingChanges).length > 0;

  return (
    // FULL PAGE TAKEOVER: fixed inset-0, w-full, h-full, bg-slate-50 (No backdrop transparency)
    <div className="fixed inset-0 z-50 bg-slate-50 w-full h-full flex flex-col overflow-hidden animate-slideUp">
      
      {/* 1. PAGE HEADER */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center shrink-0 shadow-sm z-10">
        <div className="flex items-center gap-4">
          <button onClick={onClose} className="flex items-center gap-2 text-slate-500 hover:text-slate-800 transition-colors font-medium text-sm bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg">
            <ArrowLeft className="w-4 h-4" />
            Back to Matrix
          </button>
          <div className="h-6 w-px bg-slate-200 hidden sm:block"></div>
          <div className="flex items-center gap-2.5">
            <div className="bg-indigo-600 p-2 rounded-lg text-white">
              <Settings2 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-bold text-slate-800 text-lg leading-tight">System Configuration Workspace</h2>
              <p className="text-xs text-slate-400 font-medium">Rules that govern how the allocation algorithm splits electives and balances workload</p>
            </div>
          </div>
        </div>
      </header>

      {/* 2. DUAL-TAB NAVIGATION */}
      <div className="bg-white border-b border-slate-200 px-6 shrink-0 flex gap-6">
        <button
          onClick={() => setActiveTab('SPLIT')}
          className={`py-3.5 text-sm font-bold border-b-2 transition-all flex items-center gap-2 ${activeTab === 'SPLIT' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
        >
          <Layers className="w-4 h-4" />
          Elective Splitting Engine
        </button>
        <button
          onClick={() => setActiveTab('GLOBAL')}
          className={`py-3.5 text-sm font-bold border-b-2 transition-all flex items-center gap-2 ${activeTab === 'GLOBAL' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
        >
          <Briefcase className="w-4 h-4" />
          Global Workload Controls
        </button>
      </div>

      {/* 3. MAIN SCROLLABLE WORKSPACE */}
      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-7xl mx-auto w-full">
          
          {/* ========================================= */}
          {/* TAB 1: SPLITTING ENGINE                     */}
          {/* ========================================= */}
          {activeTab === 'SPLIT' && (
            <div className="space-y-6 animate-fadeIn">
              
              <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                  <Info className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-bold text-slate-800">Dynamic Balancing Framework</p>
                    <p className="text-xs text-slate-500 mt-1 max-w-2xl">
                      Select a grade scope below to apply structural configuration adjustments. Modifications will remain editable until you run split simulations and write them to the live database.
                    </p>
                  </div>
                </div>
                <div className="min-w-55 shrink-0">
                  <label htmlFor="grade-scope-select" className="sr-only">Grade Scope</label>
                  <select
                    id="grade-scope-select"
                    className="w-full border-slate-300 rounded-lg shadow-sm focus:ring-2 focus:ring-indigo-500 text-sm p-2.5 bg-slate-50 border font-bold text-slate-700 cursor-pointer"
                    value={selectedGradeId}
                    onChange={(e) => setSelectedGradeId(e.target.value)}
                    disabled={isLoadingGrades || isSimulating || isCommitting}
                  >
                    {isLoadingGrades ? <option>Loading Contexts...</option> : grades.map(g => <option key={g.id} value={g.id}>{g.grade_name}</option>)}
                  </select>
                </div>
              </div>

              {/* Matrix Controls Subsection */}
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <h4 className="text-sm font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
                    Subject Threshold Configurations
                    {!isLoadingRules && <span className="text-slate-400 font-normal normal-case text-xs">&middot; {rules.length} subject{rules.length !== 1 ? 's' : ''}</span>}
                  </h4>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text" placeholder="Filter subjects..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9 pr-8 py-2 w-64 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
                      />
                      {searchQuery && (
                        <button
                          onClick={() => setSearchQuery('')}
                          title="Clear search"
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    {hasUnsavedChanges && (
                      <button onClick={handleSaveAllPolicies} disabled={isBatchSaving} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-lg shadow-sm disabled:opacity-60">
                        {isBatchSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        Save All Changes
                      </button>
                    )}
                  </div>
                </div>

                <div className="border border-slate-100 rounded-2xl overflow-hidden bg-white shadow-sm">
                  {isLoadingRules ? (
                    <div className="p-10 flex flex-col items-center justify-center gap-3 text-slate-400">
                      <Loader2 className="w-6 h-6 animate-spin" />
                      <p className="text-sm font-medium">Loading subject thresholds for this grade...</p>
                    </div>
                  ) : filteredRules.length === 0 ? (
                    <div className="p-10 flex flex-col items-center justify-center gap-2 text-slate-400">
                      <SlidersHorizontal className="w-8 h-8 text-slate-300" />
                      <p className="text-sm font-medium">
                        {rules.length === 0 ? 'No elective subjects configured for this grade yet.' : `No subjects match "${searchQuery}".`}
                      </p>
                    </div>
                  ) : (
                    <table className="w-full text-left border-collapse">
                      <thead className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase tracking-wider">
                        <tr>
                          <th className="px-5 py-3">Elective Pool Target</th>
                          <th className="px-5 py-3">Max Cap Threshold</th>
                          <th className="px-5 py-3">Auto-Balancing Mode</th>
                          <th className="px-5 py-3 text-right">Row Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-sm text-slate-700">
                        {filteredRules.map((row) => (
                          <tr key={row.subject_id} className="hover:bg-slate-50/50">
                            <td className="px-5 py-4 font-bold text-slate-800">{row.subject_name}</td>
                            <td className="px-5 py-4">
                              <label htmlFor={`max-size-${row.subject_id}`} className="sr-only">Max class size for {row.subject_name}</label>
                              <input
                                id={`max-size-${row.subject_id}`}
                                type="number" min="1"
                                className="w-24 border-slate-300 rounded-lg p-2 border text-center font-bold focus:ring-2 focus:ring-indigo-500 outline-none"
                                value={row.max_class_size}
                                onChange={(e) => handleRowChange(row.subject_id, 'max_class_size', parseInt(e.target.value) || 35)}
                              />
                            </td>
                            <td className="px-5 py-4">
                              <label htmlFor={`mode-${row.subject_id}`} className="sr-only">Balancing mode for {row.subject_name}</label>
                              <select
                                id={`mode-${row.subject_id}`}
                                className="border-slate-300 rounded-lg p-2 border bg-white font-medium focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                                value={row.allocation_mode}
                                onChange={(e) => handleRowChange(row.subject_id, 'allocation_mode', e.target.value)}
                              >
                                <option value="Split_Balance">Auto-Split & Balance</option>
                                <option value="Co_Teaching">Co-Teaching (Massive Group)</option>
                                <option value="Strict_Cap">Strict Cap Limit</option>
                              </select>
                            </td>
                            <td className="px-5 py-4 text-right">
                              {pendingChanges[row.subject_id] ? (
                                <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-600 bg-amber-50 px-2.5 py-1 rounded-md border border-amber-200">
                                  <AlertTriangle className="w-3.5 h-3.5" /> Unsaved
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200">
                                  <Check className="w-3.5 h-3.5" /> Saved
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              {/* Simulation Box */}
              {projectedData.length > 0 && (
                <div className="space-y-3 animate-fadeIn">
                  <h4 className="text-sm font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
                    <Users className="w-4 h-4 text-slate-400" />
                    Live Generated Stream Distributions
                  </h4>
                  {/* ✅ UPGRADED: Expanded to 3-columns for wider visibility of simulation pools */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {projectedData.map((project, idx) => (
                      <div key={idx} className="border border-slate-100 rounded-2xl p-5 bg-white shadow-sm flex flex-col">
                        <div className="flex justify-between items-start border-b border-slate-100 pb-3 mb-3">
                          <div>
                            <h5 className="font-bold text-slate-800">{project.subject_name}</h5>
                            <p className="text-xs text-slate-500 mt-1 font-medium">Total Pool: <span className="text-indigo-600 font-bold">{project.total_enrolled} Candidates</span></p>
                          </div>
                          <span className="text-xs font-mono font-bold bg-slate-100 text-slate-700 px-3 py-1 rounded-lg border border-slate-200">Cap: {project.threshold_limit}</span>
                        </div>
                        <div className="space-y-2">
                          {project.group_distribution.map((grp, gIdx) => {
                            const ratio = Math.min((grp.capacity / project.threshold_limit) * 100, 100);
                            return (
                              <div key={gIdx} className="bg-slate-50 p-3 rounded-lg border border-slate-100 text-sm space-y-2">
                                <div className="flex justify-between items-center">
                                  <span className="font-semibold text-slate-700 flex items-center gap-2"><ChevronRight className="w-4 h-4 text-indigo-500" />{grp.name}</span>
                                  <span className="font-bold text-slate-600 bg-white px-2 py-1 rounded border border-slate-200 text-xs">{grp.capacity} Enrolled</span>
                                </div>
                                <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                                  <div className="bg-indigo-600 h-full rounded-full transition-all duration-500" style={{ width: `${ratio}%` }} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Execution Actions for Tab 1 */}
              <div className="pt-6 border-t border-slate-200 flex justify-end gap-3">
                <button
                  onClick={handleTriggerSimulation} disabled={isSimulating || hasUnsavedChanges}
                  className="flex items-center gap-2 px-5 py-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold rounded-xl transition-all disabled:opacity-40"
                >
                  {isSimulating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Preview Distributions
                </button>
                <button
                  onClick={() => setShowCommitConfirm(true)} disabled={isCommitting || projectedData.length === 0 || hasUnsavedChanges}
                  className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all disabled:opacity-40"
                >
                  {isCommitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Layers className="w-4 h-4" />} Commit Live Configurations
                </button>
              </div>

              {/* --- DESTRUCTIVE-ACTION CONFIRMATION ---
                  Previously committing gave no warning that it would delete/regenerate virtual
                  streams (and cascade-remove any live allocations/lessons/attendance tied to
                  groups that no longer exist) — this makes the real impact explicit up front. */}
              {showCommitConfirm && (
                <div className="fixed inset-0 z-70 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
                  <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-fade-in">
                    <div className="px-6 py-4 border-b border-slate-100 bg-amber-50 flex items-center gap-2.5">
                      <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
                      <h3 className="font-bold text-slate-800">Confirm Live Commit</h3>
                    </div>
                    <div className="p-6 space-y-4 max-h-100 overflow-y-auto">
                      <div className="grid grid-cols-3 gap-3 text-center text-sm">
                        <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3">
                          <p className="text-xl font-black text-emerald-700">{streamImpacts.filter(s => s.action === 'created').length}</p>
                          <p className="text-[11px] font-bold text-emerald-600 uppercase">New Groups</p>
                        </div>
                        <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
                          <p className="text-xl font-black text-blue-700">{streamImpacts.filter(s => s.action === 'updated').length}</p>
                          <p className="text-[11px] font-bold text-blue-600 uppercase">Capacity Updated</p>
                        </div>
                        <div className="bg-red-50 border border-red-100 rounded-xl p-3">
                          <p className="text-xl font-black text-red-700">{removedStreams.length}</p>
                          <p className="text-[11px] font-bold text-red-600 uppercase">Groups Removed</p>
                        </div>
                      </div>

                      {removedStreams.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-bold text-slate-600">
                            These groups no longer correspond to any current subject/enrollment and will be removed
                            (soft-deleted — recoverable, but hidden from all views):
                          </p>
                          {removedStreams.map(r => {
                            const hasLiveData = r.had_allocations > 0 || r.had_lessons > 0 || r.had_attendance_sessions > 0;
                            return (
                              <div key={r.name} className={`p-3 rounded-lg border text-xs ${hasLiveData ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200'}`}>
                                <p className="font-bold text-slate-800">{r.name}</p>
                                {hasLiveData ? (
                                  <p className="text-red-700 mt-1">
                                    ⚠ Has {r.had_allocations} teacher assignment(s), {r.had_lessons} timetabled lesson(s),
                                    and {r.had_attendance_sessions} attendance record(s) tied to it.
                                  </p>
                                ) : (
                                  <p className="text-slate-500 mt-1">No live data attached — safe to remove.</p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {removedStreams.length === 0 && (
                        <p className="text-xs text-slate-500">No existing groups will be removed — only created or capacity-updated in place.</p>
                      )}
                    </div>
                    <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                      <button
                        onClick={() => setShowCommitConfirm(false)}
                        disabled={isCommitting}
                        className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleCommitLiveSplits}
                        disabled={isCommitting}
                        className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-lg transition-colors disabled:opacity-50"
                      >
                        {isCommitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Layers className="w-4 h-4" />}
                        Confirm & Commit
                      </button>
                    </div>
                  </div>
                </div>
              )}

            </div>
          )}

          {/* ========================================= */}
          {/* TAB 2: GLOBAL POLICY ENGINE                 */}
          {/* ========================================= */}
          {activeTab === 'GLOBAL' && (
            // ✅ UPGRADED: Expanded container width slightly to properly accommodate the 3-column layout inside
            <div className="max-w-6xl space-y-8 animate-fadeIn pb-12">
              
              <div>
                <h3 className="text-xl font-bold text-slate-800">Teacher Workload Constraints</h3>
                <p className="text-slate-500 text-sm mt-1">These variables dictate how the backend assignment algorithm prevents timetable clashes and workload exhaustion.</p>
              </div>

              {/* ✅ UPGRADED: Set to a 3-column layout for better flow and screen utilization */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                
                {/* Rule Card 1 */}
                <div className="bg-white border border-slate-100 p-6 rounded-2xl shadow-sm flex flex-col">
                  <label className="block font-bold text-slate-800 mb-2">Max Subjects Per Class</label>
                  <p className="text-xs text-slate-500 mb-4 h-8">Limits how many different subjects a single teacher can instruct within the same specific class stream.</p>
                  <input 
                    type="number" min="1"
                    aria-label="Max Subjects Per Class"
                    className="w-full border-slate-300 rounded-lg p-3 font-bold focus:ring-2 focus:ring-indigo-500 mt-auto"
                    value={globalPolicy.max_subjects_per_class}
                    onChange={(e) => handlePolicyChange('max_subjects_per_class', parseInt(e.target.value) || 2)}
                  />
                </div>

                {/* Rule Card 2 */}
                <div className="bg-white border border-slate-100 p-6 rounded-2xl shadow-sm flex flex-col">
                  <label className="block font-bold text-slate-800 mb-2">Max Streams Per Subject</label>
                  <p className="text-xs text-slate-500 mb-4 h-8">Limits how many physical rooms a teacher can be assigned to for an identical subject.</p>
                  <input 
                    type="number" min="1"
                    aria-label="Max Streams Per Subject"
                    className="w-full border-slate-300 rounded-lg p-3 font-bold focus:ring-2 focus:ring-indigo-500 mt-auto"
                    value={globalPolicy.max_classes_per_subject}
                    onChange={(e) => handlePolicyChange('max_classes_per_subject', parseInt(e.target.value) || 2)}
                  />
                </div>

                {/* Rule Card 3 */}
                <div className="bg-white border border-slate-100 p-6 rounded-2xl shadow-sm flex flex-col">
                  <label className="block font-bold text-slate-800 mb-2">Absolute Weekly Lesson Cap</label>
                  <p className="text-xs text-slate-500 mb-4 h-8">Limits the total number of teaching periods a teacher can be assigned across all subjects.</p>
                  <input 
                    type="number" min="1"
                    aria-label="Absolute Weekly Lesson Cap"
                    className="w-full border-slate-300 rounded-lg p-3 font-bold focus:ring-2 focus:ring-indigo-500 mt-auto"
                    value={globalPolicy.max_weekly_lessons}
                    onChange={(e) => handlePolicyChange('max_weekly_lessons', parseInt(e.target.value) || 28)}
                  />
                </div>

                {/* Rule Card 4 */}
                <div className="bg-white border border-slate-100 p-6 rounded-2xl shadow-sm flex flex-col">
                  <label className="block font-bold text-slate-800 mb-2">Total Class Group Limit (Prep Cap)</label>
                  <p className="text-xs text-slate-500 mb-4 h-8">Restricts the total number of distinct class sections a teacher manages to control grading overhead.</p>
                  <input 
                    type="number" min="1"
                    aria-label="Total Class Group Limit (Prep Cap)"
                    className="w-full border-slate-300 rounded-lg p-3 font-bold focus:ring-2 focus:ring-indigo-500 mt-auto"
                    value={globalPolicy.max_total_class_groups}
                    onChange={(e) => handlePolicyChange('max_total_class_groups', parseInt(e.target.value) || 6)}
                  />
                </div>

                {/* ✅ ADDED: Rule Card 5 (Prep Consolidation Controls) */}
                <div className={`p-6 rounded-2xl shadow-sm flex flex-col border transition-colors ${globalPolicy.enforce_prep_consolidation ? 'bg-white border-slate-200' : 'bg-slate-50 border-slate-200 opacity-80'}`}>
                  <div className="flex justify-between items-start mb-2">
                    <label className="block font-bold text-slate-800">Minimum Prep Target</label>
                    <label className="relative inline-flex items-center cursor-pointer shrink-0">
                      <input 
                        type="checkbox" 
                        className="sr-only peer" 
                        checked={globalPolicy.enforce_prep_consolidation}
                        onChange={(e) => handlePolicyChange('enforce_prep_consolidation', e.target.checked)}
                      />
                      <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                    </label>
                  </div>
                  <p className="text-xs text-slate-500 mb-4 h-8">Sets an optimization goal to bundle assignments, minimizing unique course preparations per teacher.</p>
                  <input 
                    type="number" min="1"
                    disabled={!globalPolicy.enforce_prep_consolidation}
                    aria-label="Minimum Prep Target"
                    className="w-full border-slate-300 rounded-lg p-3 font-bold focus:ring-2 focus:ring-indigo-500 mt-auto disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
                    value={globalPolicy.min_classes_per_subject}
                    onChange={(e) => handlePolicyChange('min_classes_per_subject', parseInt(e.target.value) || 2)}
                  />
                </div>

              </div>

              {/* Cross Grade Setting */}
              <div className="bg-white border border-slate-100 p-6 rounded-2xl shadow-sm flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-slate-800">Allow Cross-Grade Teaching</h4>
                  <p className="text-sm text-slate-500 mt-1 max-w-xl">If enabled, the algorithm permits a teacher to instruct the same subject across different grade levels (e.g., Grade 7 & Grade 8 Mathematics).</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input 
                    type="checkbox" className="sr-only peer" 
                    checked={globalPolicy.allow_cross_grade_teaching}
                    onChange={(e) => handlePolicyChange('allow_cross_grade_teaching', e.target.checked)}
                  />
                  <div className="w-14 h-7 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:border-slate-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-indigo-600"></div>
                </label>
              </div>

              {/* Enforcement Strategy */}
              <div className="bg-amber-50 border border-amber-200 p-6 rounded-2xl shadow-sm">
                <h4 className="font-bold text-amber-900 mb-4 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5" /> Enforcement Compliance Mode
                </h4>
                <div className="flex flex-col sm:flex-row gap-4">
                  <button 
                    onClick={() => handlePolicyChange('enforcement_mode', 'STRICT')}
                    className={`flex-1 p-4 rounded-xl border-2 text-left transition-all ${globalPolicy.enforcement_mode === 'STRICT' ? 'bg-white border-amber-500 shadow-md' : 'bg-amber-50/50 border-amber-200 hover:bg-white'}`}
                  >
                    <div className="font-bold text-amber-900 mb-1">STRICT: Hard Blocking</div>
                    <div className="text-xs text-amber-700/80">The system completely rejects saving if any workload rule is violated. Standard protocol.</div>
                  </button>
                  <button 
                    onClick={() => handlePolicyChange('enforcement_mode', 'SOFT')}
                    className={`flex-1 p-4 rounded-xl border-2 text-left transition-all ${globalPolicy.enforcement_mode === 'SOFT' ? 'bg-white border-amber-500 shadow-md' : 'bg-amber-50/50 border-amber-200 hover:bg-white'}`}
                  >
                    <div className="font-bold text-amber-900 mb-1">SOFT: Override Warnings</div>
                    <div className="text-xs text-amber-700/80">Allows the administrator to force-save matrix configurations while logging amber warnings.</div>
                  </button>
                </div>
              </div>

              {/* Save Tab 2 Action */}
              <div className="flex justify-end pt-4">
                <button
                  onClick={handleSaveGlobalPolicy} disabled={isSavingPolicy}
                  className="flex items-center gap-2 px-8 py-3 bg-slate-800 hover:bg-slate-900 text-white font-bold rounded-xl shadow-lg transition-all"
                >
                  {isSavingPolicy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                  Save Global Algorithm Policies
                </button>
              </div>

            </div>
          )}

        </div>
      </main>
    </div>
  );
};

export default SplittingEngineModal;