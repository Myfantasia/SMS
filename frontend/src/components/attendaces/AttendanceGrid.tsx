import { CheckCircle2, XCircle, Clock, ShieldAlert } from 'lucide-react';
import type { ExceptionRecord, StatusType } from './RapidEntryTab';


interface GridProps {
  students: { id: number; name: string; roll: string }[];
  exceptions: Record<number, ExceptionRecord>;
  onStatusChange: (id: number, status: StatusType) => void;
  onRemarksChange: (id: number, remarks: string) => void;
  readOnly?: boolean;
}

export default function AttendanceGrid({ students, exceptions, onStatusChange, onRemarksChange, readOnly = false }: GridProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400">
          <tr>
            <th className="px-6 py-4 font-semibold">Student Name</th>
            <th className="px-6 py-4 font-semibold text-center">Attendance Status</th>
            <th className="px-6 py-4 font-semibold">Remarks (Optional)</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {students.map(student => {
            const currentStatus = exceptions[student.id]?.status || 'Present';
            const isException = currentStatus !== 'Present';

            return (
              <tr key={student.id} className={`transition-colors ${isException ? 'bg-red-50/50 dark:bg-red-500/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
                <td className="px-6 py-4">
                  <div className="font-medium text-slate-800 dark:text-slate-100">{student.name}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{student.roll}</div>
                </td>
                <td className="px-6 py-4">
                  <div className={`flex items-center justify-center gap-2 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg w-max mx-auto ${readOnly ? 'opacity-70 pointer-events-none' : ''}`}>
                    <button disabled={readOnly} onClick={() => onStatusChange(student.id, 'Present')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${currentStatus === 'Present' ? 'bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-sm dark:shadow-none ring-1 ring-slate-200 dark:ring-slate-600' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'}`}>
                      <CheckCircle2 className="w-4 h-4" /> Present
                    </button>
                    <button disabled={readOnly} onClick={() => onStatusChange(student.id, 'Absent')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${currentStatus === 'Absent' ? 'bg-red-500 text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'}`}>
                      <XCircle className="w-4 h-4" /> Absent
                    </button>
                    <button disabled={readOnly} onClick={() => onStatusChange(student.id, 'Late')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${currentStatus === 'Late' ? 'bg-orange-500 text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'}`}>
                      <Clock className="w-4 h-4" /> Late
                    </button>
                    <button disabled={readOnly} onClick={() => onStatusChange(student.id, 'Excused')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${currentStatus === 'Excused' ? 'bg-blue-500 text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'}`}>
                      <ShieldAlert className="w-4 h-4" /> Excused
                    </button>
                  </div>
                </td>
                <td className="px-6 py-4">
                  {isException ? (
                    readOnly ? (
                      <span className="text-slate-500 dark:text-slate-400 text-xs">{exceptions[student.id]?.remarks || '—'}</span>
                    ) : (
                      <input
                        type="text"
                        placeholder={`Reason for being ${currentStatus.toLowerCase()}...`}
                        value={exceptions[student.id]?.remarks || ''}
                        onChange={(e) => onRemarksChange(student.id, e.target.value)}
                        className="w-full text-sm px-3 py-1.5 border border-slate-300 dark:border-slate-600 rounded-md focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 dark:focus:border-blue-400 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                      />
                    )
                  ) : (
                    <span className="text-slate-300 dark:text-slate-600 text-xs italic">N/A - Present</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}