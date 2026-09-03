import { useState, useEffect, useMemo, useRef } from 'react';
import {
  ArrowLeft, User, Calendar, Trash2,
  Loader2, CheckSquare, Square, Search, Copy, Eraser, X, Lock
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { TimeSlot, Teacher } from '../../libs/types';
import api from '../../libs/axiosInstance';
import SearchableSelect from '../common/SearchableSelect';

interface BlockedSlotRecord {
  id: number;
  time_slot_id: number;
  reason: string;
}

interface TeacherAvailabilityViewProps {
  slots: TimeSlot[];
  onBack: () => void;
}

export default function TeacherAvailabilityView({ slots, onBack }: TeacherAvailabilityViewProps) {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>('');
  const [blockedSlots, setBlockedSlots] = useState<Record<number, string>>({}); // Maps slot_id -> reason
  
  const [loadingStaff, setLoadingStaff] = useState(true);
  const [loadingMatrix, setLoadingMatrix] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Batch Selection state tracker
  const [selectedSlotIds, setSelectedSlotIds] = useState<number[]>([]);
  const [batchReason, setBatchReason] = useState('Department Meeting');

  // Searchable teacher picker (replaces a flat unsearchable <select> for large staff lists)
  const [teacherSearch, setTeacherSearch] = useState('');
  const [isTeacherDropdownOpen, setIsTeacherDropdownOpen] = useState(false);
  const teacherPickerRef = useRef<HTMLDivElement>(null);

  // Copy-pattern-to-another-teacher state
  const [showCopyPanel, setShowCopyPanel] = useState(false);
  const [copyTargetTeacherId, setCopyTargetTeacherId] = useState('');
  const [isCopying, setIsCopying] = useState(false);

  // In-app replacement for window.prompt() when blocking a single cell
  const [reasonModalSlotId, setReasonModalSlotId] = useState<number | null>(null);
  const [reasonInput, setReasonInput] = useState('');

  const activeDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const uniqueTimes = Array.from(new Set(slots.filter(s => activeDays.includes(s.day)).map(s => `${s.start_time} - ${s.end_time}`))).sort();
  const gridColClass = "grid-cols-[110px_repeat(5,minmax(0,1fr))]";

  // Fetch Teacher Roster
  useEffect(() => {
    const fetchTeachers = async () => {
      try {
        const res = await api.get('/api/timetable/teachers-by-subject/all/');
        if (res.data.status === 'success') {
          setTeachers(res.data.data);
        }
      } catch (error) {
        console.error("Roster retrieval error:", error);
        toast.error("Failed to load teacher list.");
      } finally {
        setLoadingStaff(false);
      }
    };
    fetchTeachers();
  }, []);

  // Fetch Blackout Matrix when selected teacher changes
  useEffect(() => {
    if (!selectedTeacherId) {
      setBlockedSlots({});
      setSelectedSlotIds([]);
      return;
    }

    const fetchTeacherMatrix = async () => {
      setLoadingMatrix(true);
      try {
        const res = await api.get(`/api/timetable/teacher-availability/${selectedTeacherId}/`);
        if (res.data.status === 'success') {
          const lookups: Record<number, string> = {};
          res.data.data.forEach((block: BlockedSlotRecord) => {
            lookups[block.time_slot_id] = block.reason || "Structural Blockout";
          });
          setBlockedSlots(lookups);
          setSelectedSlotIds([]);
        }
      } catch (error) {
        console.error("Matrix load error:", error);
        toast.error("Could not sync teacher availability records.");
      } finally {
        setLoadingMatrix(false);
      }
    };
    fetchTeacherMatrix();
  }, [selectedTeacherId]);

  const activeTeacher = teachers.find(t => t.id.toString() === selectedTeacherId);

  const filteredTeachers = useMemo(() => {
    const q = teacherSearch.trim().toLowerCase();
    if (!q) return teachers;
    return teachers.filter(t => t.name.toLowerCase().includes(q) || (t.department || '').toLowerCase().includes(q));
  }, [teachers, teacherSearch]);

  // Close the teacher search dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (teacherPickerRef.current && !teacherPickerRef.current.contains(e.target as Node)) {
        setIsTeacherDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Single Cell Instant Toggle Handler
  const handleSingleCellToggle = async (slotId: number) => {
    if (!selectedTeacherId || isSaving) return;
    const isCurrentlyBlocked = !!blockedSlots[slotId];

    if (isCurrentlyBlocked) {
      setIsSaving(true);
      try {
        const res = await api.post(`/api/timetable/teacher-availability/${selectedTeacherId}/`, {
          time_slot_id: slotId,
          remove: true
        });
        if (res.data.status === 'success') {
          setBlockedSlots(prev => {
            const copy = { ...prev };
            delete copy[slotId];
            return copy;
          });
          toast.success("Slot restored to open availability.");
        }
      } catch (error) {
        console.error("Single cell toggle error:", error);
        toast.error("Failed to clear slot restriction.");
      } finally {
        setIsSaving(false);
      }
    } else {
      // Open the in-app reason dialog instead of a native window.prompt()
      setReasonInput('HOD Administrative Time');
      setReasonModalSlotId(slotId);
    }
  };

  // Commits the block for whichever slot the reason dialog is open for
  const commitSingleBlock = async () => {
    if (reasonModalSlotId === null || !selectedTeacherId) return;
    const slotId = reasonModalSlotId;
    const reason = reasonInput.trim() || 'Structural Blockout';

    setIsSaving(true);
    try {
      const res = await api.post(`/api/timetable/teacher-availability/${selectedTeacherId}/`, {
        time_slot_id: slotId,
        reason,
        remove: false
      });
      if (res.data.status === 'success') {
        setBlockedSlots(prev => ({ ...prev, [slotId]: reason }));
        setReasonModalSlotId(null);
        if (res.data.ejected_lessons_count > 0) {
          toast(`Blocked! ${res.data.ejected_lessons_count} conflicting lesson(s) returned to unscheduled buckets.`, {
            icon: '⚠️', duration: 5000, style: { background: '#fffbeb', color: '#92400e', border: '1px solid #fde68a' }
          });
        } else {
          toast.success("Slot blocked successfully.");
        }
      }
    } catch (error) {
      console.error("Single cell toggle error:", error);
      toast.error("Failed to block slot.");
    } finally {
      setIsSaving(false);
    }
  };

  // Batch Actions: Select All Slots for a Specific Day
  const handleSelectEntireDay = (day: string) => {
    const daySlotIds = slots.filter(s => s.day === day && !s.is_global).map(s => s.id);
    const allSelected = daySlotIds.every(id => selectedSlotIds.includes(id));

    if (allSelected) {
      setSelectedSlotIds(prev => prev.filter(id => !daySlotIds.includes(id)));
    } else {
      setSelectedSlotIds(prev => Array.from(new Set([...prev, ...daySlotIds])));
    }
  };

  // Multi-Slot Batch Commit
  const handleBatchCommit = async (remove = false) => {
    if (selectedSlotIds.length === 0 || !selectedTeacherId || isSaving) return;
    
    setIsSaving(true);
    const loadingToast = toast.loading(remove ? "Clearing selected slots..." : "Applying batch blockouts...");

    try {
      const res = await api.post(`/api/timetable/teacher-availability/${selectedTeacherId}/`, {
        time_slot_ids: selectedSlotIds,
        reason: batchReason,
        remove: remove
      });

      if (res.data.status === 'success') {
        toast.success(res.data.message, { id: loadingToast });
        
        // Refresh local view map
        setBlockedSlots(prev => {
          const updated = { ...prev };
          selectedSlotIds.forEach(id => {
            if (remove) delete updated[id];
            else updated[id] = batchReason;
          });
          return updated;
        });

        setSelectedSlotIds([]);
      } else {
        toast.error(res.data.message, { id: loadingToast });
      }
    } catch (error) {
      console.error("Batch commit error:", error);
      toast.error("Error committing batch restrictions.", { id: loadingToast });
    } finally {
      setIsSaving(false);
    }
  };

  // Clear every blockout currently held by the selected teacher, in one batch call
  const handleClearAllForTeacher = async () => {
    const allBlockedIds = Object.keys(blockedSlots).map(Number);
    if (allBlockedIds.length === 0 || !selectedTeacherId || isSaving) return;

    setIsSaving(true);
    const loadingToast = toast.loading(`Clearing all ${allBlockedIds.length} blockout(s)...`);
    try {
      const res = await api.post(`/api/timetable/teacher-availability/${selectedTeacherId}/`, {
        time_slot_ids: allBlockedIds,
        remove: true
      });
      if (res.data.status === 'success') {
        toast.success(`Cleared all blockouts for ${activeTeacher?.name}.`, { id: loadingToast });
        setBlockedSlots({});
        setSelectedSlotIds([]);
      } else {
        toast.error(res.data.message, { id: loadingToast });
      }
    } catch (error) {
      console.error("Clear-all error:", error);
      toast.error("Failed to clear all blockouts.", { id: loadingToast });
    } finally {
      setIsSaving(false);
    }
  };

  // Copy the selected teacher's entire blockout pattern onto another teacher
  const handleCopyPatternToTeacher = async () => {
    const sourceBlockedIds = Object.keys(blockedSlots).map(Number);
    if (!copyTargetTeacherId || sourceBlockedIds.length === 0 || isCopying) return;

    setIsCopying(true);
    const targetName = teachers.find(t => t.id.toString() === copyTargetTeacherId)?.name || 'target teacher';
    const loadingToast = toast.loading(`Copying pattern to ${targetName}...`);
    try {
      // Slots share a reason where one exists per-slot; batch endpoint takes a single reason,
      // so group by reason to preserve per-slot labels instead of flattening them to one string.
      const byReason = new Map<string, number[]>();
      for (const [slotIdStr, reason] of Object.entries(blockedSlots)) {
        const list = byReason.get(reason) || [];
        list.push(Number(slotIdStr));
        byReason.set(reason, list);
      }

      for (const [reason, slotIds] of byReason.entries()) {
        const res = await api.post(`/api/timetable/teacher-availability/${copyTargetTeacherId}/`, {
          time_slot_ids: slotIds,
          reason,
          remove: false
        });
        if (res.data.status !== 'success') {
          throw new Error(res.data.message || 'Batch apply failed.');
        }
      }

      toast.success(`Copied ${sourceBlockedIds.length} blockout(s) to ${targetName}.`, { id: loadingToast });
      setShowCopyPanel(false);
      setCopyTargetTeacherId('');
    } catch (error: any) {
      console.error("Copy pattern error:", error);
      toast.error(error.message || "Failed to copy blockout pattern.", { id: loadingToast });
    } finally {
      setIsCopying(false);
    }
  };

  if (loadingStaff) {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-6 animate-pulse">
        <div className="h-20 bg-slate-200 dark:bg-slate-800 rounded-2xl"></div>
        <div className="h-96 bg-slate-200 dark:bg-slate-800 rounded-2xl"></div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 animate-fade-in">
      
      {/* Top Navigation & Action Header */}
      <div className="flex justify-between items-center bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm dark:shadow-none">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="p-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl transition font-bold flex items-center gap-2 text-sm"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Schedule
          </button>
          <div>
            <h1 className="text-2xl font-black text-slate-800 dark:text-slate-100 tracking-tight">Teacher Availability Matrix</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">Define recurring weekly blackout slots and part-time availability constraints.</p>
          </div>
        </div>

        {/* Teacher Profile Selector — searchable combobox instead of a flat <select>, so a
            large staff list stays usable */}
        <div className="relative min-w-70" ref={teacherPickerRef}>
          <div className="flex items-center gap-2 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2 bg-slate-50 dark:bg-slate-800 shadow-sm dark:shadow-none focus-within:ring-2 focus-within:ring-indigo-500 dark:focus-within:ring-indigo-400">
            <User className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
            <input
              type="text"
              aria-label="Search instructor by name or department"
              value={isTeacherDropdownOpen ? teacherSearch : (activeTeacher ? `${activeTeacher.name} [${activeTeacher.department || 'General'}]` : '')}
              onChange={(e) => setTeacherSearch(e.target.value)}
              onFocus={() => { setIsTeacherDropdownOpen(true); setTeacherSearch(''); }}
              placeholder="Search instructor by name or department..."
              className="flex-1 bg-transparent outline-none text-sm font-bold text-slate-800 dark:text-slate-100 min-w-0"
            />
            <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" />
          </div>
          {isTeacherDropdownOpen && (
            <div className="absolute right-0 mt-1 w-full max-h-72 overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg dark:shadow-none z-50">
              {filteredTeachers.length === 0 ? (
                <div className="p-3 text-xs text-slate-400 dark:text-slate-500 font-medium text-center">No matching instructors.</div>
              ) : (
                filteredTeachers.map(t => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => { setSelectedTeacherId(t.id.toString()); setIsTeacherDropdownOpen(false); setTeacherSearch(''); }}
                    className={`w-full text-left px-3 py-2 text-sm font-bold hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition-colors ${t.id.toString() === selectedTeacherId ? 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-400' : 'text-slate-700 dark:text-slate-200'}`}
                  >
                    {t.name} <span className="text-xs font-medium text-slate-400 dark:text-slate-500">[{t.department || 'General'}]</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {selectedTeacherId && activeTeacher && (
        <>
          {/* Workload Telemetry Cards Bar */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 animate-fade-in">
            <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm dark:shadow-none">
              <p className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase">Instructor Name</p>
              <p className="text-base font-black text-slate-800 dark:text-slate-100 mt-1">{activeTeacher.name}</p>
            </div>
            <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm dark:shadow-none">
              <p className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase">Department</p>
              <p className="text-base font-black text-indigo-600 dark:text-indigo-400 mt-1">{activeTeacher.department || 'General'}</p>
            </div>
            <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm dark:shadow-none">
              <p className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase">Current Assigned Load</p>
              <p className="text-base font-black text-emerald-600 dark:text-emerald-400 mt-1">
                {activeTeacher.current_load ?? 0} / {activeTeacher.max_weekly_lessons ?? 40} periods
              </p>
            </div>
            <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm dark:shadow-none">
              <p className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase">Total Restricted Slots</p>
              <p className="text-base font-black text-red-600 dark:text-red-400 mt-1">{Object.keys(blockedSlots).length} Slots Blocked</p>
            </div>
          </div>

          {/* Bulk Pattern Actions: clear everything for this teacher, or copy their whole
              blockout pattern onto another teacher, instead of only per-cell/per-day edits */}
          <div className="flex flex-wrap items-center gap-2 animate-fade-in">
            <button
              type="button"
              onClick={handleClearAllForTeacher}
              disabled={isSaving || Object.keys(blockedSlots).length === 0}
              className="flex items-center gap-2 px-3.5 py-2 bg-white dark:bg-slate-900 hover:bg-red-50 dark:hover:bg-red-500/10 border border-slate-200 dark:border-slate-700 hover:border-red-200 dark:hover:border-red-500/40 text-slate-600 dark:text-slate-300 hover:text-red-600 dark:hover:text-red-400 rounded-lg text-xs font-bold transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Eraser className="w-3.5 h-3.5" /> Clear All Blockouts for {activeTeacher.name}
            </button>
            <button
              type="button"
              onClick={() => setShowCopyPanel(prev => !prev)}
              disabled={Object.keys(blockedSlots).length === 0}
              className="flex items-center gap-2 px-3.5 py-2 bg-white dark:bg-slate-900 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 border border-slate-200 dark:border-slate-700 hover:border-indigo-200 dark:hover:border-indigo-500/40 text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 rounded-lg text-xs font-bold transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Copy className="w-3.5 h-3.5" /> Copy Pattern to Another Teacher
            </button>

            {showCopyPanel && (
              <div className="w-full bg-indigo-50/60 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/40 rounded-xl p-3 flex flex-wrap items-center gap-2 animate-fade-in">
                <span className="text-xs font-bold text-indigo-900 dark:text-indigo-300">Copy {Object.keys(blockedSlots).length} blockout(s) to:</span>
                <SearchableSelect
                  aria-label="Select Destination Teacher"
                  value={copyTargetTeacherId}
                  onChange={setCopyTargetTeacherId}
                  placeholder="-- Select Destination Teacher --"
                  searchPlaceholder="Search teachers…"
                  className="min-w-60"
                  options={teachers.filter(t => t.id.toString() !== selectedTeacherId).map(t => ({
                    value: t.id.toString(),
                    label: t.name,
                    sublabel: t.department || 'General',
                  }))}
                />
                <button
                  type="button"
                  onClick={handleCopyPatternToTeacher}
                  disabled={!copyTargetTeacherId || isCopying}
                  className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg transition disabled:opacity-50 flex items-center gap-1.5"
                >
                  {isCopying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Copy className="w-3.5 h-3.5" />}
                  Confirm Copy
                </button>
                <button
                  type="button"
                  onClick={() => { setShowCopyPanel(false); setCopyTargetTeacherId(''); }}
                  className="px-3 py-1.5 text-indigo-700 dark:text-indigo-400 hover:text-indigo-900 dark:hover:text-indigo-300 text-xs font-bold"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          {/* Batch Operations Floating Controller Strip */}
          {selectedSlotIds.length > 0 && (
            <div className="bg-indigo-900 text-white p-4 rounded-xl shadow-lg flex justify-between items-center animate-slide-in flex-wrap gap-4">
              <div className="flex items-center gap-3">
                <span className="bg-indigo-700 text-indigo-100 text-xs font-black px-2.5 py-1 rounded-md">
                  {selectedSlotIds.length} Slots Selected
                </span>
                <input
                  type="text"
                  value={batchReason}
                  onChange={(e) => setBatchReason(e.target.value)}
                  placeholder="Reason for blockout..."
                  className="bg-indigo-800 border border-indigo-700 text-white placeholder-indigo-300 text-xs rounded-lg px-3 py-1.5 outline-none font-medium"
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleBatchCommit(false)}
                  disabled={isSaving}
                  className="px-3.5 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg transition shadow-sm"
                >
                  Apply Blockout
                </button>
                <button
                  onClick={() => handleBatchCommit(true)}
                  disabled={isSaving}
                  className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition shadow-sm"
                >
                  Clear Selection Blockouts
                </button>
                <button
                  onClick={() => setSelectedSlotIds([])}
                  className="px-3 py-1.5 bg-indigo-800 hover:bg-indigo-700 text-indigo-200 text-xs font-bold rounded-lg transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Main Availability Grid Matrix */}
          {loadingMatrix ? (
            <div className="h-96 bg-slate-200 dark:bg-slate-800 rounded-2xl animate-pulse"></div>
          ) : (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm dark:shadow-none overflow-hidden flex flex-col">

              {/* Day Header Row with Select All Column Controls */}
              <div className={`grid ${gridColClass} border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 font-bold text-slate-700 dark:text-slate-200 text-xs uppercase tracking-wider text-center sticky top-0 z-10`}>
                <div className="p-4 border-r border-slate-100 dark:border-slate-700 bg-slate-100/60 dark:bg-slate-800 flex items-center justify-center">Periods</div>
                {activeDays.map(day => {
                  const daySlotIds = slots.filter(s => s.day === day && !s.is_global).map(s => s.id);
                  const isDayFullySelected = daySlotIds.length > 0 && daySlotIds.every(id => selectedSlotIds.includes(id));
                  return (
                    <div key={day} className="p-3 border-r border-slate-100 dark:border-slate-700 flex flex-col items-center justify-center gap-1">
                      <span>{day}</span>
                      <button
                        type="button"
                        onClick={() => handleSelectEntireDay(day)}
                        className="text-[10px] text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-bold flex items-center gap-1 hover:underline"
                      >
                        {isDayFullySelected ? <CheckSquare className="w-3 h-3 text-indigo-600 dark:text-indigo-400" /> : <Square className="w-3 h-3 text-slate-400 dark:text-slate-500" />}
                        Select Day
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Weekly Time Grid Body */}
              <div className="divide-y divide-slate-100 dark:divide-slate-700">
                {uniqueTimes.map(timeStr => (
                  <div key={timeStr} className={`grid ${gridColClass} transition-colors hover:bg-slate-50/40 dark:hover:bg-slate-800/40`}>

                    <div className="p-3 text-[11px] font-mono font-bold text-slate-500 dark:text-slate-400 flex flex-col items-center justify-center text-center bg-slate-50/30 dark:bg-slate-800/40 border-r border-slate-100 dark:border-slate-700">
                      <span>{timeStr.split(' - ')[0]}</span>
                      <span className="text-[9px] font-normal text-slate-300 dark:text-slate-600 my-0.5">to</span>
                      <span>{timeStr.split(' - ')[1]}</span>
                    </div>

                    {activeDays.map(day => {
                      const targetSlot = slots.find(s => s.day === day && `${s.start_time} - ${s.end_time}` === timeStr);
                      if (!targetSlot) return <div key={day} className="bg-slate-50/50 dark:bg-slate-800/40 border-r border-slate-100 dark:border-slate-700"></div>;

                      if (targetSlot.is_global) return (
                        <div key={targetSlot.id} className="p-2 border-r border-slate-100 dark:border-slate-700 flex items-center justify-center">
                          <div className="w-full h-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl flex items-center justify-center text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider p-2 text-center leading-tight">
                            {targetSlot.global_label}
                          </div>
                        </div>
                      );

                      const reasonBlocked = blockedSlots[targetSlot.id];
                      const isSelected = selectedSlotIds.includes(targetSlot.id);

                      return (
                        <div key={targetSlot.id} className="p-2 border-r border-slate-100 dark:border-slate-700 min-h-17.5">
                          <div
                            onClick={() => {
                              if (selectedSlotIds.length > 0) {
                                // Toggle in batch array if batch mode active
                                setSelectedSlotIds(prev =>
                                  prev.includes(targetSlot.id)
                                    ? prev.filter(id => id !== targetSlot.id)
                                    : [...prev, targetSlot.id]
                                );
                              } else {
                                handleSingleCellToggle(targetSlot.id);
                              }
                            }}
                            className={`w-full h-full min-h-14 rounded-xl border p-2 flex flex-col justify-between transition cursor-pointer group ${
                              isSelected
                                ? 'ring-2 ring-indigo-500 dark:ring-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 border-indigo-300 dark:border-indigo-500/40'
                                : reasonBlocked
                                ? 'bg-red-50/80 dark:bg-red-500/10 border-red-200 dark:border-red-500/40 hover:bg-red-100/80 dark:hover:bg-red-500/20'
                                : 'border-dashed border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-500/40 hover:bg-indigo-50/30 dark:hover:bg-indigo-500/10'
                            }`}
                          >
                            <div className="flex justify-between items-start">
                              {reasonBlocked ? (
                                <span className="text-[9px] font-black uppercase tracking-wider text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-500/10 px-1.5 py-0.5 rounded">
                                  BLOCKED
                                </span>
                              ) : (
                                <span className="text-[9px] font-bold text-slate-300 dark:text-slate-600 group-hover:text-indigo-500 dark:group-hover:text-indigo-400 transition-colors">
                                  AVAILABLE
                                </span>
                              )}
                              {reasonBlocked && (
                                <Trash2 className="w-3.5 h-3.5 text-red-400 dark:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                              )}
                            </div>

                            <p className={`text-xs font-bold leading-tight truncate mt-1 ${reasonBlocked ? 'text-red-900 dark:text-red-300' : 'text-slate-400 dark:text-slate-500'}`}>
                              {reasonBlocked || 'Click to Restrict'}
                            </p>
                          </div>
                        </div>
                      );
                    })}

                  </div>
                ))}
              </div>

            </div>
          )}
        </>
      )}

      {!selectedTeacherId && (
        <div className="border border-dashed border-slate-200 dark:border-slate-700 rounded-2xl p-16 text-center text-slate-400 dark:text-slate-500 flex flex-col items-center justify-center gap-2 bg-white dark:bg-slate-900">
          <Calendar className="w-10 h-10 text-slate-300 dark:text-slate-600" />
          <p className="text-sm font-bold text-slate-600 dark:text-slate-300">No Teacher Selected</p>
          <p className="text-xs text-slate-400 dark:text-slate-500">Choose an instructor profile from the top right menu to view and manage blackout slots.</p>
        </div>
      )}

      {/* Single-Cell Block Reason Dialog (replaces window.prompt) */}
      {reasonModalSlotId !== null && (() => {
        const targetSlot = slots.find(s => s.id === reasonModalSlotId);
        return (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-70 p-4">
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl dark:shadow-none w-full max-w-sm overflow-hidden animate-fade-in">
              <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between bg-slate-50 dark:bg-slate-800/40">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400"><Lock className="w-4 h-4" /></div>
                  <div>
                    <h3 className="font-black text-slate-800 dark:text-slate-100 text-sm">Block This Slot</h3>
                    {targetSlot && (
                      <p className="text-xs text-slate-400 dark:text-slate-500 font-medium">{targetSlot.day} &middot; {targetSlot.start_time} - {targetSlot.end_time}</p>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setReasonModalSlotId(null)}
                  title="Cancel"
                  aria-label="Cancel"
                  className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 p-1 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label htmlFor="block-reason-input" className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Reason</label>
                  <input
                    id="block-reason-input"
                    type="text"
                    autoFocus
                    value={reasonInput}
                    onChange={(e) => setReasonInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') commitSingleBlock(); }}
                    placeholder="e.g. HOD Administrative Time"
                    className="w-full border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 focus:border-indigo-500 dark:focus:border-indigo-400 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100"
                  />
                </div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setReasonModalSlotId(null)}
                    disabled={isSaving}
                    className="flex-1 px-4 py-2.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 rounded-lg font-bold text-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={commitSingleBlock}
                    disabled={isSaving}
                    className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                  >
                    {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                    Block Slot
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

    </div>
  );
}