import { useState } from 'react';
import RapidEntryTab from './RapidEntryTab';
import ReportsTab from './ReportsTab';
import { LayoutDashboard, CheckSquare } from 'lucide-react'; // Added icons for the dynamic tabs
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
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header & Tabs */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          {/* Dynamic Header based on role */}
          <h1 className="text-2xl font-bold text-slate-800">
            {role === 'admin' ? 'School Attendance Overview' : 'My Class Attendance'}
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            {role === 'admin' ? 'Monitor school-wide daily registers.' : 'Submit your daily class register.'}
          </p>
        </div>
        
        <div className="flex bg-slate-100 p-1 rounded-lg">
          {/* Admin Only Tab */}
          {role === 'admin' && (
            <button
              onClick={() => setActiveTab('overview')}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-all flex items-center gap-2 ${activeTab === 'overview' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <LayoutDashboard className="w-4 h-4" /> School Overview
            </button>
          )}

          {/* Shared Tab: Proxy Entry for Admin, Daily Register for Teacher */}
          {(role === 'admin' || role === 'teacher') && (
            <button
              onClick={() => setActiveTab('entry')}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-all flex items-center gap-2 ${activeTab === 'entry' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <CheckSquare className="w-4 h-4" /> {role === 'admin' ? 'Proxy Entry' : 'Daily Register'}
            </button>
          )}

          {/* Shared Tab: Reports */}
          <button
            onClick={() => setActiveTab('reports')}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'reports' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            {role === 'admin' ? 'Master Reports' : 'My Reports'}
          </button>
        </div>
      </div>

      {/* Render Active Tab Component */}
      {activeTab === 'overview' && (
        <div className="bg-white p-12 rounded-xl shadow-sm border border-slate-200 text-center">
          <h3 className="text-lg font-semibold text-slate-800">Admin Live Overview</h3>
          <p className="text-slate-500 mt-2">A grid showing which teachers have submitted their registers today will go here.</p>
        </div>
      )}
      

      {/* Render Active Tab Component */}
      {activeTab === 'overview' && <AdminOverviewTab />}


      {/* 3. Pass the role prop down to RapidEntryTab */}
      {activeTab === 'entry' && <RapidEntryTab role={role} />}
      
      {activeTab === 'reports' && <ReportsTab />}
    </div>
  );
}