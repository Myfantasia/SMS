import React from 'react';
import { Users, UserX, Clock, FileCheck, AlertCircle, CheckCircle2, Activity } from 'lucide-react';

// --- MOCK DATA (To be replaced by Django API aggregations) ---
const MOCK_KPIS = {
  totalStudents: 850,
  present: 812,
  absent: 25,
  lateExcused: 13,
  totalClasses: 24,
  submittedClasses: 18,
};

const MOCK_EXCEPTIONS = [
  { id: 1, student: 'John Doe', class: 'Form 2 West', status: 'Absent', remarks: 'Unwell - Parent called', time: '08:15 AM' },
  { id: 2, student: 'Sarah Williams', class: 'Grade 9 East', status: 'Late', remarks: 'Traffic delay', time: '08:42 AM' },
  { id: 3, student: 'Michael Johnson', class: 'Form 1 Alpha', status: 'Absent', remarks: 'No reason provided', time: '09:01 AM' },
  { id: 4, student: 'Jane Smith', class: 'Form 3 North', status: 'Excused', remarks: 'Dental appointment', time: '09:15 AM' },
];

const MOCK_PENDING_REGISTERS = [
  { id: 1, name: 'Form 4 South', teacher: 'Mr. Omondi' },
  { id: 2, name: 'Grade 8 West', teacher: 'Mrs. Kariuki' },
  { id: 3, name: 'Form 2 East', teacher: 'Ms. Wanjiku' },
];

const MOCK_SUBMITTED_REGISTERS = [
  { id: 4, name: 'Form 1 Alpha', teacher: 'Mr. Chege', time: '08:10 AM' },
  { id: 5, name: 'Grade 9 East', teacher: 'Mrs. Mutua', time: '08:15 AM' },
];

export default function AdminOverviewTab() {
  const submissionPercentage = Math.round((MOCK_KPIS.submittedClasses / MOCK_KPIS.totalClasses) * 100);
  const attendancePercentage = Math.round((MOCK_KPIS.present / MOCK_KPIS.totalStudents) * 100);

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
            <p className="text-xs text-slate-400">{MOCK_KPIS.present} / {MOCK_KPIS.totalStudents} Students</p>
          </div>
        </div>

        {/* Absences */}
        <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 flex items-center gap-4">
          <div className="p-3 bg-red-100 text-red-600 rounded-lg">
            <UserX className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-500">Total Absent</p>
            <h4 className="text-2xl font-bold text-slate-800">{MOCK_KPIS.absent}</h4>
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
            <h4 className="text-2xl font-bold text-slate-800">{MOCK_KPIS.lateExcused}</h4>
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
              <h4 className="text-2xl font-bold text-slate-800">{MOCK_KPIS.submittedClasses} <span className="text-sm text-slate-400 font-normal">/ {MOCK_KPIS.totalClasses}</span></h4>
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
            <span className="bg-orange-100 text-orange-700 text-xs font-bold px-2 py-1 rounded-full">{MOCK_PENDING_REGISTERS.length}</span>
          </div>
          <div className="p-4 flex-1 overflow-y-auto max-h-[400px]">
            {MOCK_PENDING_REGISTERS.length === 0 ? (
              <div className="text-center text-slate-400 py-8 flex flex-col items-center">
                <CheckCircle2 className="w-8 h-8 text-emerald-400 mb-2" />
                <p>All registers submitted!</p>
              </div>
            ) : (
              <ul className="space-y-3">
                {MOCK_PENDING_REGISTERS.map(reg => (
                  <li key={reg.id} className="flex items-center justify-between p-3 bg-orange-50/50 border border-orange-100 rounded-lg">
                    <div>
                      <p className="font-semibold text-slate-800 text-sm">{reg.name}</p>
                      <p className="text-xs text-slate-500">{reg.teacher}</p>
                    </div>
                    <button className="text-xs font-semibold text-orange-600 hover:text-orange-800">Remind</button>
                  </li>
                ))}
              </ul>
            )}
            
            <h4 className="font-semibold text-slate-500 text-xs uppercase tracking-wider mt-6 mb-3">Recently Submitted</h4>
            <ul className="space-y-2">
              {MOCK_SUBMITTED_REGISTERS.map(reg => (
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
                {MOCK_EXCEPTIONS.map(exc => (
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
            {MOCK_EXCEPTIONS.length === 0 && (
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