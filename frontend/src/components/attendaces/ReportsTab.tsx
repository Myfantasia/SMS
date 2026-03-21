import { Calendar } from 'lucide-react';

export default function ReportsTab() {
  return (
    <div className="bg-white p-12 rounded-xl shadow-sm border border-slate-200 text-center">
      <Calendar className="w-12 h-12 text-slate-300 mx-auto mb-4" />
      <h3 className="text-lg font-semibold text-slate-800">Attendance Analytics</h3>
      <p className="text-slate-500 mt-2">Charts and historical reports will appear here.</p>
    </div>
  );
}