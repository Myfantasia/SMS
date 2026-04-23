import React, { useState } from 'react';
import { Settings, FileEdit, BarChart3, AlertCircle, FileText } from 'lucide-react'; // Added FileText for the new tab
import ExamSetupTab from './ExamSetupTab';
import RapidMarksEntry from './RapidMarksEntry';
import ResultsBroadsheet from './ResultsBroadSheet';
import ReportCardsTab from './ReportCardTab'; // NEW IMPORT

interface ExamsHubProps {
  role: 'admin' | 'teacher' | 'student' | 'parent';
}

const ExamsHub: React.FC<ExamsHubProps> = ({ role }) => {
  // Determine the default tab based on the user's role
  // Admins default to setup, teachers default to marks entry
  const [activeTab, setActiveTab] = useState<string>(role === 'admin' ? 'setup' : 'entry');

  // Define tabs based on RBAC
  const tabs = [
    ...(role === 'admin' 
      ? [{ id: 'setup', label: 'Exam Setup & Grading', icon: Settings }] 
      : []
    ),
    { id: 'entry', label: 'Rapid Marks Entry', icon: FileEdit },
    { id: 'reports', label: 'Broadsheets & Analytics', icon: BarChart3 },
    { id: 'reportcards', label: 'Report Cards', icon: FileText }, // NEW TAB
  ];

  // Restrict access for students and parents immediately 
  // (They should ideally be routed to a purely read-only 'ResultsHub' instead)
  if (role === 'student' || role === 'parent') {
    return (
      <div className="flex items-center justify-center h-64 bg-white rounded-lg border border-slate-200 shadow-sm p-8">
        <div className="flex flex-col items-center text-slate-500">
          <AlertCircle className="w-12 h-12 mb-4 text-slate-400" />
          <h2 className="text-xl font-semibold text-slate-700">Restricted Access</h2>
          <p className="mt-2 text-center">Students and parents should view performance via the Results menu.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Examinations Management</h1>
          <p className="text-sm text-slate-500 mt-1">
            Manage exam sessions, grading configurations, and academic data entry.
          </p>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="bg-white p-1 rounded-lg shadow-sm border border-slate-200 inline-flex w-full md:w-auto overflow-x-auto">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-6 py-2.5 text-sm font-medium rounded-md transition-all whitespace-nowrap ${
                isActive
                  ? 'bg-slate-800 text-white shadow'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Active Tab Content Area */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 min-h-125">
        {activeTab === 'setup' && (
          <div className="p-6">
            <h2 className="text-lg font-semibold text-slate-700 mb-4">Exam Setup Module (Admin Only)</h2>
            <p className="text-slate-500 mb-4">The ExamSetupTab component will load here, allowing creation of Terms and CATs.</p>
            <ExamSetupTab />
          </div>
        )}

        {activeTab === 'entry' && (
          <div className="p-6">
            <h2 className="text-lg font-semibold text-slate-700 mb-4">Rapid Marks Entry Grid</h2>
            <p className="text-slate-500 mb-4">The RapidMarksEntry spreadsheet component will load here for data entry.</p>
            <RapidMarksEntry />
          </div>
        )}

        {activeTab === 'reports' && (
          <div className="p-6">
            <h2 className="text-lg font-semibold text-slate-700 mb-4">Broadsheets & Analytics</h2>
            <p className="text-slate-500 mb-4">The ResultsBroadsheet component will load here, displaying final aggregated ranks and CBC rubrics.</p>
            <ResultsBroadsheet />
          </div>
        )}

        {/* NEW ACTIVE TAB CONTENT */}
        {activeTab === 'reportcards' && (
          <div className="p-6">
            <ReportCardsTab />
          </div>
        )}
      </div>
    </div>
  );
};

export default ExamsHub;