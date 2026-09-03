import { useState } from 'react';
import RapidEntryTab from './RapidEntryTab';
import ReportsTab from './ReportsTab';
import { LayoutDashboard, CheckSquare, CalendarCheck } from 'lucide-react'; // Added icons for the dynamic tabs
import AdminOverviewTab from './AdminOverviewTab';

// 1. Define the expected prop
interface AttendanceHubProps {
  role: 'admin' | 'teacher' | 'student' | 'parent';
}

export default function AttendanceHub({ role }: AttendanceHubProps) {
  // 2. Admins default to 'overview', Teachers default to 'entry'
  const [activeTab, setActiveTab] = useState<'entry' | 'reports' | 'overview'>(
    role === 'admin' ? 'overview' : 'entry'
  );

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header & Tabs */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-2xl text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10">
            <CalendarCheck className="w-7 h-7" strokeWidth={2.5} />
          </div>
          <div>
            {/* Dynamic Header based on role */}
            <h1 className="text-2xl font-extrabold text-slate-800 dark:text-slate-100">
              {role === 'admin' ? 'School Attendance Overview' : 'My Class Attendance'}
            </h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm mt-0.5">
              {role === 'admin' ? 'Monitor school-wide daily registers.' : 'Submit your daily class register.'}
            </p>
          </div>
        </div>

        <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
          {/* Admin Only Tab */}
          {role === 'admin' && (
            <button
              onClick={() => setActiveTab('overview')}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-all flex items-center gap-2 ${activeTab === 'overview' ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm dark:shadow-none' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
            >
              <LayoutDashboard className="w-4 h-4" /> School Overview
            </button>
          )}

          {/* Shared Tab: Proxy Entry for Admin, Daily Register for Teacher */}
          {(role === 'admin' || role === 'teacher') && (
            <button
              onClick={() => setActiveTab('entry')}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-all flex items-center gap-2 ${activeTab === 'entry' ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm dark:shadow-none' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
            >
              <CheckSquare className="w-4 h-4" /> {role === 'admin' ? 'Proxy Entry' : 'Daily Register'}
            </button>
          )}

          {/* Shared Tab: Reports */}
          <button
            onClick={() => setActiveTab('reports')}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'reports' ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm dark:shadow-none' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
          >
            {role === 'admin' ? 'Master Reports' : 'My Reports'}
          </button>
        </div>
      </div>

      {/* Render Active Tab Component */}
      {activeTab === 'overview' && <AdminOverviewTab />}


      {/* 3. Pass the role prop down to RapidEntryTab */}
      {activeTab === 'entry' && <RapidEntryTab role={role} />}
      
      {activeTab === 'reports' && <ReportsTab />}
    </div>
  );
}