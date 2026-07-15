import { useState, useEffect } from 'react';
import { Users, UserX, Clock, FileCheck, AlertCircle, CheckCircle2, Activity, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../libs/axiosInstance';
import type { AttendanceOverviewData } from '../../libs/types';

export default function AdminOverviewTab() {
  const [data, setData] = useState<AttendanceOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchOverview = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.get('/attendance/overview/');
        setData(res.data);
      } catch (err: any) {
        console.error("Error fetching attendance overview:", err);
        const msg = err.response?.data?.error || "Failed to load attendance overview.";
        setError(msg);
        toast.error(msg);
      } finally {
        setLoading(false);
      }
    };
    fetchOverview();
  }, []);

  if (loading) {
    return (
      <div className="bg-white p-16 rounded-xl shadow-sm border border-slate-200 flex flex-col items-center justify-center gap-3 text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin" />
        Loading school-wide attendance overview...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-white p-16 rounded-xl shadow-sm border border-red-200 text-center">
        <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-3" />
        <p className="text-red-600 font-medium">{error || 'No data available.'}</p>
      </div>
    );
  }

  const { kpis, pending_registers, submitted_registers, exceptions } = data;
  const submissionPercentage = kpis.total_classes > 0 ? Math.round((kpis.submitted_classes / kpis.total_classes) * 100) : 0;
  const attendancePercentage = kpis.total_students > 0 ? Math.round((kpis.present / kpis.total_students) * 100) : 0;

  return (
    <div className="space-y-6">

      {/* 1. KPI Pulse Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Attendance Rate */}
        <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 flex items-center gap-4">
          <div className="p-3 bg-emerald-100 text-emerald-600 rounded-lg">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-500">Present Today</p>
            <h4 className="text-2xl font-bold text-slate-800">{attendancePercentage}%</h4>
            <p className="text-xs text-slate-400">{kpis.present} / {kpis.total_students} Recorded</p>
          </div>
        </div>

        {/* Absences */}
        <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 flex items-center gap-4">
          <div className="p-3 bg-red-100 text-red-600 rounded-lg">
            <UserX className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-500">Total Absent</p>
            <h4 className="text-2xl font-bold text-slate-800">{kpis.absent}</h4>
            <p className="text-xs text-red-500 font-medium">Requires attention</p>
          </div>
        </div>

        {/* Late/Excused */}
        <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 flex items-center gap-4">
          <div className="p-3 bg-orange-100 text-orange-600 rounded-lg">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-500">Late / Excused</p>
            <h4 className="text-2xl font-bold text-slate-800">{kpis.late + kpis.excused}</h4>
            <p className="text-xs text-slate-400">Logged exceptions</p>
          </div>
        </div>

        {/* Register Submissions */}
        <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 flex items-center gap-4">
          <div className="p-3 bg-blue-100 text-blue-600 rounded-lg">
            <FileCheck className="w-6 h-6" />
          </div>
          <div className="w-full">
            <p className="text-sm font-semibold text-slate-500">Registers In</p>
            <div className="flex items-end justify-between mb-1">
              <h4 className="text-2xl font-bold text-slate-800">{kpis.submitted_classes} <span className="text-sm text-slate-400 font-normal">/ {kpis.total_classes}</span></h4>
            </div>
            {/* Mini Progress Bar */}
            <div className="w-full bg-slate-100 rounded-full h-1.5">
              <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${submissionPercentage}%` }}></div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* 2. Submission Tracker (The "Naughty List") */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 lg:col-span-1 overflow-hidden flex flex-col">
          <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-orange-500" /> Pending Registers
            </h3>
            <span className="bg-orange-100 text-orange-700 text-xs font-bold px-2 py-1 rounded-full">{pending_registers.length}</span>
          </div>
          <div className="p-4 flex-1 overflow-y-auto max-h-[400px]">
            {pending_registers.length === 0 ? (
              <div className="text-center text-slate-400 py-8 flex flex-col items-center">
                <CheckCircle2 className="w-8 h-8 text-emerald-400 mb-2" />
                <p>All registers submitted!</p>
              </div>
            ) : (
              <ul className="space-y-3">
                {pending_registers.map(reg => (
                  <li key={reg.id} className="flex items-center justify-between p-3 bg-orange-50/50 border border-orange-100 rounded-lg">
                    <div>
                      <p className="font-semibold text-slate-800 text-sm">{reg.name}</p>
                      <p className="text-xs text-slate-500">{reg.teacher}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <h4 className="font-semibold text-slate-500 text-xs uppercase tracking-wider mt-6 mb-3">Recently Submitted</h4>
            {submitted_registers.length === 0 ? (
              <p className="text-xs text-slate-400 px-1">None yet today.</p>
            ) : (
              <ul className="space-y-2">
                {submitted_registers.map(reg => (
                  <li key={reg.id} className="flex items-center justify-between p-2 rounded-lg">
                    <div className="flex items-center gap-3">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                      <div>
                        <p className="font-medium text-slate-700 text-sm">{reg.name}</p>
                        <p className="text-xs text-slate-400">{reg.teacher}</p>
                      </div>
                    </div>
                    <span className="text-xs text-slate-400 font-medium">{reg.time}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* 3. Live Exceptions Feed (The Watchlist) */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 lg:col-span-2 overflow-hidden flex flex-col">
          <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              <Activity className="w-4 h-4 text-blue-500" /> Live Exceptions Feed
            </h3>
            <span className="text-xs font-semibold text-slate-500">Today's Anomalies</span>
          </div>
          <div className="p-0 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-white border-b border-slate-100 text-slate-400 text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-3 font-semibold">Student</th>
                  <th className="px-6 py-3 font-semibold">Class</th>
                  <th className="px-6 py-3 font-semibold">Status</th>
                  <th className="px-6 py-3 font-semibold">Remarks</th>
                  <th className="px-6 py-3 font-semibold">Time Logged</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {exceptions.map(exc => (
                  <tr key={exc.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 font-medium text-slate-800">{exc.student}</td>
                    <td className="px-6 py-4 text-slate-500">{exc.class}</td>
                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-1 rounded-md text-xs font-bold ${
                        exc.status === 'Absent' ? 'bg-red-100 text-red-700' :
                        exc.status === 'Late' ? 'bg-orange-100 text-orange-700' :
                        'bg-blue-100 text-blue-700'
                      }`}>
                        {exc.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-slate-600 italic text-xs">{exc.remarks || '-'}</td>
                    <td className="px-6 py-4 text-slate-400 text-xs font-medium">{exc.time}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {exceptions.length === 0 && (
              <div className="text-center py-10 text-slate-400">
                No exceptions logged yet today.
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
