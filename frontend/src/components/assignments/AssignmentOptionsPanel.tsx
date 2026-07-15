import React, { useEffect, useState } from 'react';
import { Users, Target, FileStack, Plus, X, Link2, RotateCcw } from 'lucide-react';
import type { Assignment, AssignmentGroup, ReferenceLink } from '../../libs/assignments';
import { assignmentService } from '../../libs/assignmentService';

interface RosterStudent {
  id: number;
  name: string;
  roll: string;
}

interface ClassStreamOption {
  id: number;
  label: string;
}

interface AssignmentOptionsPanelProps {
  assignment: Partial<Assignment>;
  onChange: (field: keyof Assignment, value: any) => void;
  classStreamOptions: ClassStreamOption[]; // flattened { id, "Grade Stream" } list, excluding the primary stream
  structuralLocked?: boolean; // true once published — targeting/grouping become read-only
}

export default function AssignmentOptionsPanel({ assignment, onChange, classStreamOptions, structuralLocked }: AssignmentOptionsPanelProps) {
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);

  const primaryStreamId = assignment.class_stream_id;
  const additionalStreamIds = assignment.additional_class_stream_ids || [];

  useEffect(() => {
    const streamIds = [primaryStreamId, ...additionalStreamIds].filter(Boolean) as (string | number)[];
    if (streamIds.length === 0) {
      setRoster([]);
      return;
    }
    let cancelled = false;
    setRosterLoading(true);
    Promise.all(streamIds.map(id => assignmentService.getStudentsForStream(id).catch(() => [])))
      .then(results => {
        if (cancelled) return;
        const merged = new Map<number, RosterStudent>();
        results.flat().forEach(s => merged.set(s.id, s));
        setRoster(Array.from(merged.values()));
      })
      .finally(() => !cancelled && setRosterLoading(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primaryStreamId, JSON.stringify(additionalStreamIds)]);

  const assignedStudentIds = assignment.assigned_student_ids || [];
  const toggleAssignedStudent = (id: number) => {
    const next = assignedStudentIds.includes(id)
      ? assignedStudentIds.filter(x => x !== id)
      : [...assignedStudentIds, id];
    onChange('assigned_student_ids', next);
  };

  const toggleAdditionalStream = (id: number) => {
    const next = additionalStreamIds.includes(id)
      ? additionalStreamIds.filter(x => x !== id)
      : [...additionalStreamIds, id];
    onChange('additional_class_stream_ids', next);
  };

  const groups: AssignmentGroup[] = assignment.groups || [];
  const updateGroups = (next: AssignmentGroup[]) => onChange('groups', next);

  const addGroup = () => updateGroups([...groups, { name: `Group ${groups.length + 1}`, member_ids: [] }]);
  const removeGroup = (idx: number) => updateGroups(groups.filter((_, i) => i !== idx));
  const renameGroup = (idx: number, name: string) => updateGroups(groups.map((g, i) => i === idx ? { ...g, name } : g));
  const toggleGroupMember = (idx: number, studentId: number) => {
    updateGroups(groups.map((g, i) => {
      if (i !== idx) return g;
      const has = g.member_ids.includes(studentId);
      return { ...g, member_ids: has ? g.member_ids.filter(x => x !== studentId) : [...g.member_ids, studentId] };
    }));
  };

  const links: ReferenceLink[] = assignment.reference_links || [];
  const updateLinks = (next: ReferenceLink[]) => onChange('reference_links', next);
  const addLink = () => updateLinks([...links, { label: '', url: '' }]);
  const removeLink = (idx: number) => updateLinks(links.filter((_, i) => i !== idx));
  const updateLink = (idx: number, field: keyof ReferenceLink, value: string) =>
    updateLinks(links.map((l, i) => i === idx ? { ...l, [field]: value } : l));

  const stagedFiles: File[] = assignment.additional_attachments || [];
  const existingAttachments = assignment.attachments || [];
  const removedIds: number[] = assignment.removed_attachment_ids || [];

  const handleExtraFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    onChange('additional_attachments', [...stagedFiles, ...Array.from(fileList)]);
  };
  const removeStagedFile = (idx: number) => onChange('additional_attachments', stagedFiles.filter((_, i) => i !== idx));
  const removeExistingAttachment = (id: number) => onChange('removed_attachment_ids', [...removedIds, id]);

  return (
    <div className="space-y-6">
      {/* SUBMISSION RULES */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 space-y-5">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
          <RotateCcw className="w-5 h-5 text-slate-500" />
          <h3 className="text-lg font-semibold text-slate-800">Submission Rules</h3>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-700">Allow Resubmission</p>
            <p className="text-xs text-slate-500">Students may submit again after their first attempt.</p>
          </div>
          <button
            type="button"
            aria-pressed={!!assignment.allow_resubmission}
            onClick={() => onChange('allow_resubmission', !assignment.allow_resubmission)}
            className={`relative w-11 h-6 rounded-full transition-colors ${assignment.allow_resubmission ? 'bg-blue-600' : 'bg-slate-300'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${assignment.allow_resubmission ? 'translate-x-5' : ''}`} />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label htmlFor="max-attempts" className="block text-sm font-medium text-slate-700 mb-1">Max Attempts</label>
            <input
              id="max-attempts"
              type="number"
              min={1}
              className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none"
              value={assignment.max_attempts ?? 1}
              onChange={(e) => onChange('max_attempts', parseInt(e.target.value) || 1)}
            />
          </div>
          <div>
            <label htmlFor="late-penalty" className="block text-sm font-medium text-slate-700 mb-1">Late Penalty (%)</label>
            <input
              id="late-penalty"
              type="number"
              min={0}
              max={100}
              className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none"
              value={assignment.late_penalty_percent ?? 0}
              onChange={(e) => onChange('late_penalty_percent', parseFloat(e.target.value) || 0)}
            />
            <p className="text-xs text-slate-500 mt-1">Deducted from the score when a submission arrives after the Due Date.</p>
          </div>
        </div>

        <div className="border-t border-slate-100 pt-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-sm font-medium text-slate-700">Group Assignment</p>
              <p className="text-xs text-slate-500">One member's submission is shared across their whole group.</p>
            </div>
            <button
              type="button"
              disabled={structuralLocked}
              aria-pressed={!!assignment.is_group_assignment}
              onClick={() => onChange('is_group_assignment', !assignment.is_group_assignment)}
              className={`relative w-11 h-6 rounded-full transition-colors disabled:opacity-50 ${assignment.is_group_assignment ? 'bg-blue-600' : 'bg-slate-300'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${assignment.is_group_assignment ? 'translate-x-5' : ''}`} />
            </button>
          </div>

          {assignment.is_group_assignment && (
            <div className="space-y-3 mt-3">
              {groups.map((group, idx) => (
                <div key={idx} className="border border-slate-200 rounded-xl p-3 bg-slate-50">
                  <div className="flex items-center gap-2 mb-2">
                    <input
                      type="text"
                      value={group.name}
                      disabled={structuralLocked}
                      onChange={(e) => renameGroup(idx, e.target.value)}
                      className="flex-1 p-2 bg-white border border-slate-200 rounded-lg text-sm outline-none disabled:opacity-50"
                      placeholder="Group name"
                    />
                    {!structuralLocked && (
                      <button type="button" onClick={() => removeGroup(idx)} className="p-2 text-slate-400 hover:text-red-500" aria-label="Remove group">
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  <div className="max-h-32 overflow-y-auto grid grid-cols-2 gap-1">
                    {roster.map(s => (
                      <label key={s.id} className="flex items-center gap-2 text-xs text-slate-600 px-1 py-0.5">
                        <input
                          type="checkbox"
                          disabled={structuralLocked}
                          checked={group.member_ids.includes(s.id)}
                          onChange={() => toggleGroupMember(idx, s.id)}
                        />
                        {s.name}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              {!structuralLocked && (
                <button type="button" onClick={addGroup} className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium">
                  <Plus className="w-4 h-4" /> Add Group
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* TARGETING & VISIBILITY */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 space-y-5">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
          <Target className="w-5 h-5 text-slate-500" />
          <h3 className="text-lg font-semibold text-slate-800">Targeting & Visibility</h3>
        </div>

        <div>
          <p className="text-sm font-medium text-slate-700 mb-1">Additional Streams</p>
          <p className="text-xs text-slate-500 mb-2">Share this assignment with other streams beyond the primary Class Stream above.</p>
          <div className="max-h-32 overflow-y-auto border border-slate-200 rounded-lg p-2 grid grid-cols-2 gap-1">
            {classStreamOptions.filter(c => c.id.toString() !== primaryStreamId?.toString()).map(c => (
              <label key={c.id} className="flex items-center gap-2 text-xs text-slate-600 px-1 py-0.5">
                <input
                  type="checkbox"
                  disabled={structuralLocked}
                  checked={additionalStreamIds.includes(c.id)}
                  onChange={() => toggleAdditionalStream(c.id)}
                />
                {c.label}
              </label>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center gap-2 mb-1">
            <Users className="w-4 h-4 text-slate-500" />
            <p className="text-sm font-medium text-slate-700">Limit to Specific Students</p>
          </div>
          <p className="text-xs text-slate-500 mb-2">Leave empty to assign the whole class/stream(s) selected above.</p>
          {rosterLoading ? (
            <div className="h-24 bg-slate-100 rounded-lg animate-pulse" />
          ) : roster.length === 0 ? (
            <p className="text-xs text-slate-400 italic">Select a class stream to load its roster.</p>
          ) : (
            <div className="max-h-40 overflow-y-auto border border-slate-200 rounded-lg p-2 grid grid-cols-2 gap-1">
              {roster.map(s => (
                <label key={s.id} className="flex items-center gap-2 text-xs text-slate-600 px-1 py-0.5">
                  <input
                    type="checkbox"
                    disabled={structuralLocked}
                    checked={assignedStudentIds.includes(s.id)}
                    onChange={() => toggleAssignedStudent(s.id)}
                  />
                  {s.name} <span className="text-slate-400">({s.roll})</span>
                </label>
              ))}
            </div>
          )}
          {assignedStudentIds.length > 0 && (
            <p className="text-xs text-blue-600 mt-1.5">{assignedStudentIds.length} student(s) selected — only they will see this assignment.</p>
          )}
        </div>
      </div>

      {/* REFERENCE MATERIAL */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 space-y-5">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
          <FileStack className="w-5 h-5 text-slate-500" />
          <h3 className="text-lg font-semibold text-slate-800">Reference Material</h3>
        </div>

        <div>
          <label htmlFor="reference-notes" className="block text-sm font-medium text-slate-700 mb-1">Reference Notes</label>
          <textarea
            id="reference-notes"
            rows={3}
            className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none"
            placeholder="Optional background reading, instructions, or context for students."
            value={assignment.reference_notes || ''}
            onChange={(e) => onChange('reference_notes', e.target.value)}
          />
        </div>

        <div>
          <p className="text-sm font-medium text-slate-700 mb-2">Reference Links</p>
          <div className="space-y-2">
            {links.map((link, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Link2 className="w-4 h-4 text-slate-400 shrink-0" />
                <input
                  type="text"
                  placeholder="Label"
                  value={link.label}
                  onChange={(e) => updateLink(idx, 'label', e.target.value)}
                  className="w-1/3 p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none"
                />
                <input
                  type="url"
                  placeholder="https://..."
                  value={link.url}
                  onChange={(e) => updateLink(idx, 'url', e.target.value)}
                  className="flex-1 p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none"
                />
                <button type="button" onClick={() => removeLink(idx)} className="p-2 text-slate-400 hover:text-red-500" aria-label="Remove link">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
            <button type="button" onClick={addLink} className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium">
              <Plus className="w-4 h-4" /> Add Link
            </button>
          </div>
        </div>

        <div>
          <p className="text-sm font-medium text-slate-700 mb-2">Supplementary Files</p>
          {existingAttachments.filter(a => !removedIds.includes(a.id)).map(a => (
            <div key={a.id} className="flex items-center justify-between px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm mb-1.5">
              <a href={a.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline truncate">{a.label}</a>
              <button type="button" onClick={() => removeExistingAttachment(a.id)} className="p-1 text-slate-400 hover:text-red-500" aria-label="Remove attachment">
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
          {stagedFiles.map((f, idx) => (
            <div key={idx} className="flex items-center justify-between px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-sm mb-1.5">
              <span className="text-emerald-700 truncate">{f.name}</span>
              <button type="button" onClick={() => removeStagedFile(idx)} className="p-1 text-slate-400 hover:text-red-500" aria-label="Remove staged file">
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
          <label className="inline-flex items-center gap-2 mt-1 px-3 py-2 border border-dashed border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50 cursor-pointer">
            <Plus className="w-4 h-4" />
            Add File
            <input type="file" multiple className="hidden" onChange={(e) => handleExtraFiles(e.target.files)} />
          </label>
        </div>
      </div>
    </div>
  );
}
