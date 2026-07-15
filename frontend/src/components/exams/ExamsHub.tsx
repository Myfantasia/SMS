import React, { useState } from 'react';
import { Settings, FileEdit, BarChart3, AlertCircle, FileText, ShieldCheck, FileSignature } from 'lucide-react';
import ExamSetupTab from './ExamSetupTab';
import RapidMarksEntry from './RapidMarksEntry';
import ResultsBroadsheet from './ResultsBroadSheet';
import ReportCardsTab from './ReportCardTab';
import MissingMarksVerification from './MissingMarkVerification';

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
    
    // NEW: Verification tab added securely to the array
    { id: 'verify', label: 'Marks Verification', icon: ShieldCheck },
    
    { id: 'reports', label: 'Broadsheets & Analytics', icon: BarChart3 },
    { id: 'reportcards', label: 'Report Cards', icon: FileText },
  ];

  // Restrict access for students and parents immediately
  // (They should ideally be routed to a purely read-only 'ResultsHub' instead)
  if (role === 'student' || role === 'parent') {
    return (
      <div className="flex flex-col items-center justify-center text-center p-8 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200 min-h-100">
        <div className="w-20 h-20 bg-slate-100 rounded-3xl flex items-center justify-center border border-slate-200/60 shadow-inner mb-6">
          <AlertCircle className="w-10 h-10 text-slate-400" />
        </div>
        <h2 className="text-2xl font-black text-slate-800 tracking-tight">Restricted Access</h2>
        <p className="text-sm text-slate-500 font-medium leading-relaxed max-w-md mt-2">
          Exam management is staff-only. Head to <strong className="text-blue-600">Results</strong> from the sidebar to view published grades and report cards.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-2xl text-rose-600 bg-rose-50">
            <FileSignature className="w-7 h-7" strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-slate-800">Examinations Management</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Manage exam sessions, grading configurations, and academic data entry.
            </p>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="bg-white p-1.5 rounded-2xl shadow-sm border border-slate-100 inline-flex w-full md:w-auto overflow-x-auto gap-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-6 py-2.5 text-sm font-medium rounded-xl transition-all whitespace-nowrap ${
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
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 min-h-125">
        
        {activeTab === 'setup' && (
          <div className="p-6">
            <ExamSetupTab />
          </div>
        )}

        {activeTab === 'entry' && (
          <div className="p-6">
            <RapidMarksEntry />
          </div>
        )}

        {/* NEW: Routing for the Verification Engine */}
        {activeTab === 'verify' && (
          <div className="p-6">
            <MissingMarksVerification />
          </div>
        )}

        {activeTab === 'reports' && (
          <div className="p-6">
            <ResultsBroadsheet role={role} />
          </div>
        )}

        {activeTab === 'reportcards' && (
          <div className="p-6">
            <ReportCardsTab role={role} />
          </div>
        )}
      </div>
    </div>
  );
};

export default ExamsHub;