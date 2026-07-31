import React, { useMemo } from 'react';
import { AlertCircle, CheckCircle2, Info, Layers, Puzzle } from 'lucide-react';
import type { MatrixRow } from '../../libs/types';
import SearchableSelect from '../common/SearchableSelect';


interface MatrixTableProps {
  data: MatrixRow[];
  onTeacherChange: (subjectId: number, teacherId: string | number) => void;
  readOnly?: boolean;
}

const MatrixTable: React.FC<MatrixTableProps> = ({ data, onTeacherChange, readOnly = false }) => {

  // Arrange: Core subjects first (the fixed backbone of the timetable), then each
  // elective block grouped together, alphabetically — instead of whatever arbitrary
  // order the backend query happened to return.
  const groups = useMemo(() => {
    const byBlock = new Map<string, MatrixRow[]>();
    data.forEach((row) => {
      const key = row.block_name || 'Other';
      if (!byBlock.has(key)) byBlock.set(key, []);
      byBlock.get(key)!.push(row);
    });

    byBlock.forEach((rows) => rows.sort((a, b) => a.subject_name.localeCompare(b.subject_name)));

    const blockNames = [...byBlock.keys()].sort((a, b) => {
      if (a === 'Core Subject') return -1;
      if (b === 'Core Subject') return 1;
      return a.localeCompare(b);
    });

    return blockNames.map((block) => ({ block, rows: byBlock.get(block)! }));
  }, [data]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Subject</th>
            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Assign Teacher</th>
            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {groups.map(({ block, rows }) => (
            <React.Fragment key={block}>
              <tr className="bg-slate-50/70">
                <td colSpan={3} className="px-6 py-2">
                  <span className={`inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider ${
                    block === 'Core Subject' ? 'text-slate-500' : 'text-indigo-600'
                  }`}>
                    {block !== 'Core Subject' && <Layers className="w-3.5 h-3.5" />}
                    {block} <span className="text-slate-400 font-normal normal-case">&middot; {rows.length} subject{rows.length !== 1 ? 's' : ''}</span>
                  </span>
                </td>
              </tr>
              {rows.map((row) => (
                <tr key={row.subject_id} className="hover:bg-slate-50/50 transition-colors">
                  {/* SUBJECT INFO */}
                  <td className="px-6 py-4">
                    <div className="flex flex-col">
                      <span className="font-semibold text-slate-800">{row.subject_name}</span>
                      <span className="text-xs text-slate-400 font-mono">{row.subject_code}</span>
                    </div>
                  </td>

                  {/* TEACHER SELECTION DROPDOWN */}
                  <td className="px-6 py-4">
                    {row.routed_to_groups ? (
                      <p className="text-xs text-indigo-600 max-w-xs">
                        Staffed per elective group, not here — switch to <span className="font-semibold">Elective Groups</span> above to assign teachers for each group.
                      </p>
                    ) : (
                      <>
                        <div className="max-w-xs">
                          <SearchableSelect
                            aria-label={`Assign teacher for ${row.subject_name}`}
                            value={String(row.assigned_teacher_id ?? '')}
                            onChange={(val) => onTeacherChange(row.subject_id, val)}
                            disabled={readOnly}
                            placeholder="-- Unassigned --"
                            searchPlaceholder="Search teachers…"
                            options={row.eligible_teachers.map((t) => {
                              const nearCap = t.max_weekly_lessons > 0 && t.current_load >= t.max_weekly_lessons;
                              return {
                                value: String(t.id),
                                label: t.name,
                                sublabel: `Load: ${t.current_load}${t.max_weekly_lessons ? `/${t.max_weekly_lessons}` : ''}${nearCap ? ' ⚠ At/over cap' : ''}`,
                              };
                            })}
                          />
                        </div>
                        {/* Surface the cap proximity for the CURRENTLY assigned teacher up front,
                            instead of the admin only discovering a violation after clicking Save. */}
                        {(() => {
                          const assigned = row.eligible_teachers.find(t => String(t.id) === String(row.assigned_teacher_id));
                          if (!assigned || !assigned.max_weekly_lessons) return null;
                          const ratio = assigned.current_load / assigned.max_weekly_lessons;
                          if (ratio < 0.8) return null;
                          const atOrOverCap = assigned.current_load >= assigned.max_weekly_lessons;
                          return (
                            <p className={`text-[11px] font-bold mt-1 flex items-center gap-1 ${atOrOverCap ? 'text-red-600' : 'text-amber-600'}`}>
                              <AlertCircle className="w-3 h-3" />
                              {assigned.name.split(' ')[0]} is {atOrOverCap ? 'at/over' : 'near'} the weekly lesson cap
                              ({assigned.current_load}/{assigned.max_weekly_lessons})
                            </p>
                          );
                        })()}
                      </>
                    )}
                  </td>

                  {/* STATUS INDICATORS (Algorithm Feedback) */}
                  <td className="px-6 py-4">
                    {row.routed_to_groups ? (
                      <div className={`flex items-center gap-2 ${row.group_status?.startsWith('0 of') ? 'text-red-600' : row.group_status?.match(/^(\d+) of \1/) ? 'text-emerald-600' : 'text-amber-600'}`}>
                        <Puzzle className="w-4 h-4" />
                        <span className="text-xs font-medium">{row.group_status || 'Split into elective groups'}</span>
                      </div>
                    ) : row.status?.includes('Failed') ? (
                      <div className="flex items-center gap-2 text-red-600 bg-red-50 p-2 rounded-md border border-red-100">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        <span className="text-xs font-medium leading-tight">Requires Manual Action</span>
                      </div>
                    ) : row.assigned_teacher_id ? (
                      <div className="flex items-center gap-2 text-emerald-600">
                        <CheckCircle2 className="w-4 h-4" />
                        <span className="text-xs font-medium">Ready</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-slate-400">
                        <Info className="w-4 h-4" />
                        <span className="text-xs">Awaiting Selection</span>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default MatrixTable;
