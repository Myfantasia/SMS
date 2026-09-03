import { X, Award, AlertCircle } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from 'recharts';

interface SubjectPerformance {
  subject: string;
  mean: number;
  grade: string;
  highest: number;
  lowest: number;
  teacher: string; // ✅ ADDED: Capture assigned faculty property from unified api payload
}

interface ClassSubjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: SubjectPerformance[];
  className?: string;
}

export default function ClassSubjectModal({ isOpen, onClose, data, className }: ClassSubjectModalProps) {
  if (!isOpen) return null;

  const getBarColor = (grade: string) => {
    if (grade.startsWith('A')) return '#10b981';
    if (grade.startsWith('B')) return '#3b82f6';
    if (grade.startsWith('C')) return '#f59e0b';
    if (grade.startsWith('D')) return '#ef4444';
    return '#64748b';
  };

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const p = payload[0].payload;
      return (
        <div className="bg-white dark:bg-slate-900 p-3 border border-slate-200 dark:border-slate-700 shadow-lg dark:shadow-none rounded-md outline-none">
          <p className="font-bold text-slate-800 dark:text-slate-100 mb-1">{p.subject}</p>
          <div className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 mb-2">Instructor: {p.teacher}</div>
          <div className="flex justify-between gap-4 text-sm">
            <span className="text-slate-500 dark:text-slate-400">Class Mean:</span>
            <span className="font-semibold text-slate-900 dark:text-slate-100">{p.mean}% ({p.grade})</span>
          </div>
          <div className="flex justify-between gap-4 text-sm">
            <span className="text-slate-500 dark:text-slate-400">Highest:</span>
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">{p.highest}%</span>
          </div>
          <div className="flex justify-between gap-4 text-sm">
            <span className="text-slate-500 dark:text-slate-400">Lowest:</span>
            <span className="font-semibold text-red-600 dark:text-red-400">{p.lowest}%</span>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl dark:shadow-none border border-transparent dark:border-slate-700 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">

        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-800">
          <div>
            <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">Subject Performance Analysis</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">{className || 'Class'} Overview</p>
          </div>
          <button
            type="button"
            title="Close modal"
            onClick={onClose}
            className="p-2 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body (Scrollable) */}
        <div className="p-6 overflow-y-auto">

          {/* Recharts Bar Chart */}
          <div className="mb-8 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-300 mb-4 uppercase tracking-wider">Mean Score Comparison</h3>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 20, right: 30, left: 0, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis
                    dataKey="subject"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: '#64748b', fontSize: 12 }}
                    angle={-45}
                    textAnchor="end"
                  />
                  <YAxis
                    domain={[0, 100]}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: '#64748b', fontSize: 12 }}
                  />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f1f5f9' }} />
                  <Bar dataKey="mean" radius={[4, 4, 0, 0]} maxBarSize={50}>
                    {data.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={getBarColor(entry.grade)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Detailed Data Table */}
          <div>
            <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-300 mb-3 uppercase tracking-wider">Detailed Subject Breakdown</h3>
            <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
              <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300">
                <thead className="bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Subject</th>
                    <th className="px-4 py-3 font-semibold">Assigned Teacher</th> {/* ✅ ADDED: Table Column Header */}
                    <th className="px-4 py-3 font-semibold">Class Mean</th>
                    <th className="px-4 py-3 font-semibold">Grade</th>
                    <th className="px-4 py-3 font-semibold">Highest Score</th>
                    <th className="px-4 py-3 font-semibold">Lowest Score</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {data.map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-100 flex items-center gap-2">
                        {idx === 0 && <div title="Top Subject"><Award className="w-4 h-4 text-amber-500 dark:text-amber-400" /></div>}
                        {idx === data.length - 1 && <div title="Needs Attention"><AlertCircle className="w-4 h-4 text-red-500 dark:text-red-400" /></div>}
                        {row.subject}
                      </td>
                      {/* ✅ ADDED: Dynamic cell displaying responsible faculty with context styling on unassigned profiles */}
                      <td className="px-4 py-3 font-medium">
                        <span className={row.teacher === "Unassigned" ? "text-rose-600 dark:text-rose-400 italic font-normal" : "text-slate-700 dark:text-slate-200"}>
                          {row.teacher}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-semibold">{row.mean}%</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-1 rounded text-xs font-bold ${
                          row.grade.startsWith('A') ? 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-400' :
                          row.grade.startsWith('B') ? 'bg-blue-100 dark:bg-blue-500/10 text-blue-800 dark:text-blue-400' :
                          row.grade.startsWith('C') ? 'bg-amber-100 dark:bg-amber-500/10 text-amber-800 dark:text-amber-400' :
                          'bg-red-100 dark:bg-red-500/10 text-red-800 dark:text-red-400'
                        }`}>
                          {row.grade}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-emerald-600 dark:text-emerald-400 font-medium">{row.highest}%</td>
                      <td className="px-4 py-3 text-red-600 dark:text-red-400 font-medium">{row.lowest}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
