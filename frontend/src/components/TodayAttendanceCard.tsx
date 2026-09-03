import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, UserX, Clock, FileCheck, AlertCircle, Loader2 } from 'lucide-react';
import api from '../libs/axiosInstance';
import type { AttendanceOverviewData } from '../libs/types';

export default function TodayAttendanceCard() {
  const [data, setData] = useState<AttendanceOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.get('/attendance/overview/')
      .then((res) => setData(res.data))
      .catch((err) => {
        console.error("Failed to fetch attendance overview", err);
        setError(true);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl w-full h-full p-4 border border-slate-100 dark:border-slate-700 shadow-sm dark:shadow-none flex flex-col">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-lg font-bold text-slate-700 dark:text-slate-100">Today's Attendance</h1>
        <Link to="/admin-dashboard/attendance" className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors">
          View Details →
        </Link>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-slate-400 dark:text-slate-500 gap-2">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading...
        </div>
      ) : error || !data ? (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 gap-2 text-center px-4">
          <AlertCircle className="w-8 h-8 text-slate-300 dark:text-slate-600" />
          <p className="text-sm">Couldn't load today's attendance.</p>
        </div>
      ) : (
        <div className="flex-1 grid grid-cols-2 gap-4">
          <div className="bg-emerald-50 dark:bg-emerald-500/10 rounded-xl p-4 flex flex-col justify-center">
            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 mb-1">
              <Users className="w-4 h-4" />
              <span className="text-[10px] font-bold uppercase tracking-widest">Present</span>
            </div>
            <span className="text-2xl font-extrabold text-slate-800 dark:text-slate-100">
              {data.kpis.total_students > 0 ? Math.round((data.kpis.present / data.kpis.total_students) * 100) : 0}%
            </span>
            <span className="text-xs text-slate-400 dark:text-slate-500">{data.kpis.present} / {data.kpis.total_students} recorded</span>
          </div>

          <div className="bg-red-50 dark:bg-red-500/10 rounded-xl p-4 flex flex-col justify-center">
            <div className="flex items-center gap-2 text-red-500 dark:text-red-400 mb-1">
              <UserX className="w-4 h-4" />
              <span className="text-[10px] font-bold uppercase tracking-widest">Absent</span>
            </div>
            <span className="text-2xl font-extrabold text-slate-800 dark:text-slate-100">{data.kpis.absent}</span>
            <span className="text-xs text-slate-400 dark:text-slate-500">students today</span>
          </div>

          <div className="bg-amber-50 dark:bg-amber-500/10 rounded-xl p-4 flex flex-col justify-center">
            <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 mb-1">
              <Clock className="w-4 h-4" />
              <span className="text-[10px] font-bold uppercase tracking-widest">Late / Excused</span>
            </div>
            <span className="text-2xl font-extrabold text-slate-800 dark:text-slate-100">{data.kpis.late + data.kpis.excused}</span>
            <span className="text-xs text-slate-400 dark:text-slate-500">logged exceptions</span>
          </div>

          <div className="bg-blue-50 dark:bg-blue-500/10 rounded-xl p-4 flex flex-col justify-center">
            <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 mb-1">
              <FileCheck className="w-4 h-4" />
              <span className="text-[10px] font-bold uppercase tracking-widest">Registers In</span>
            </div>
            <span className="text-2xl font-extrabold text-slate-800 dark:text-slate-100">
              {data.kpis.submitted_classes}<span className="text-sm text-slate-400 dark:text-slate-500 font-normal"> / {data.kpis.total_classes}</span>
            </span>
            <div className="w-full bg-white dark:bg-slate-800 rounded-full h-1.5 mt-2">
              <div
                className="bg-blue-500 dark:bg-blue-400 h-1.5 rounded-full"
                style={{ width: `${data.kpis.total_classes > 0 ? Math.round((data.kpis.submitted_classes / data.kpis.total_classes) * 100) : 0}%` }}
              ></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
