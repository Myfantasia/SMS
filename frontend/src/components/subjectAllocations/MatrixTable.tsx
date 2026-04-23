import React from 'react';
import { AlertCircle, CheckCircle2, UserCheck, Info } from 'lucide-react';
import type { MatrixRow } from '../../libs/types';


interface MatrixTableProps {
  data: MatrixRow[];
  onTeacherChange: (subjectId: number, teacherId: string | number) => void;
}

const MatrixTable: React.FC<MatrixTableProps> = ({ data, onTeacherChange }) => {
  
  // Helper to determine the color of the workload badge
  const getLoadColor = (load: number) => {
    if (load >= 6) return 'bg-red-100 text-red-700 border-red-200';
    if (load >= 4) return 'bg-amber-100 text-amber-700 border-amber-200';
    return 'bg-emerald-100 text-emerald-700 border-emerald-200';
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Subject</th>
            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Block / Category</th>
            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Assign Teacher</th>
            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {data.map((row) => (
            <tr key={row.subject_id} className="hover:bg-slate-50/50 transition-colors">
              {/* SUBJECT INFO */}
              <td className="px-6 py-4">
                <div className="flex flex-col">
                  <span className="font-semibold text-slate-800">{row.subject_name}</span>
                  <span className="text-xs text-slate-400 font-mono">{row.subject_code}</span>
                </div>
              </td>

              {/* BLOCK INFO */}
              <td className="px-6 py-4">
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                  row.block_name === 'Core Subject' 
                    ? 'bg-slate-100 text-slate-600 border-slate-200' 
                    : 'bg-indigo-50 text-indigo-700 border-indigo-100'
                }`}>
                  {row.block_name}
                </span>
              </td>

              {/* TEACHER SELECTION DROPDOWN */}
              <td className="px-6 py-4">
                <div className="relative max-w-xs">
                  <select
                    aria-label={`Assign teacher for ${row.subject_name}`}
                    className="w-full pl-3 pr-10 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white appearance-none cursor-pointer"
                    value={row.assigned_teacher_id}
                    onChange={(e) => onTeacherChange(row.subject_id, e.target.value)}
                  >
                    <option value="">-- Unassigned --</option>
                    {row.eligible_teachers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} (Load: {t.current_load})
                      </option>
                    ))}
                  </select>
                  <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none">
                    <UserCheck className="h-4 w-4 text-slate-400" />
                  </div>
                </div>
              </td>

              {/* STATUS INDICATORS (Algorithm Feedback) */}
              <td className="px-6 py-4">
                {row.status?.includes('Failed') ? (
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
        </tbody>
      </table>
    </div>
  );
};

export default MatrixTable;
