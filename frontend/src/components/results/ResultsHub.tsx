import { useState } from 'react';
import { BarChart3, FileText, TrendingUp } from 'lucide-react';
import ClassPerformanceSummary from './ClassPerformanceSummary';
import StudentReportCardViewer from './StudentReportCardViewer';
import ResultsAnalytics from './ResultAnalytics';
// import StudentReports from './StudentReports';
// import ResultsAnalytics from './ResultsAnalytics';

interface ResultsHubProps {
  role: 'admin' | 'teacher' | 'student' | 'parent';
}

export default function ResultsHub({ role }: ResultsHubProps) {
  // We use tabs to keep the UI clean and focused
  const [activeTab, setActiveTab] = useState<'performance' | 'reports' | 'analytics'>('performance');

  // If a student or parent logs in, they get a completely different, simplified view
  if (role === 'student' || role === 'parent') {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-4">My Academic Results</h1>
        {/* We will build the Student/Parent view later */}
        <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200">
          <p className="text-slate-500">Student report card viewer will load here.</p>
        </div>
      </div>
    );
  }

  // Admin & Teacher View
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Results & Analytics</h1>
        <p className="text-slate-500 text-sm mt-1">
          Review published exam broadsheets, class performance, and student report cards.
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="bg-white p-1 rounded-lg border border-slate-200 inline-flex space-x-1 shadow-sm">
        <button
          onClick={() => setActiveTab('performance')}
          className={`px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition-colors ${
            activeTab === 'performance'
              ? 'bg-blue-50 text-blue-700'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <BarChart3 className="w-4 h-4" />
          Class Performance
        </button>
        <button
          onClick={() => setActiveTab('reports')}
          className={`px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition-colors ${
            activeTab === 'reports'
              ? 'bg-blue-50 text-blue-700'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <FileText className="w-4 h-4" />
          Student Report Cards
        </button>
        <button
          onClick={() => setActiveTab('analytics')}
          className={`px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition-colors ${
            activeTab === 'analytics'
              ? 'bg-blue-50 text-blue-700'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <TrendingUp className="w-4 h-4" />
          School Analytics
        </button>
      </div>

      {/* Dynamic Content Area */}
      <div className="mt-6">
        {activeTab === 'performance' && (
          <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200">
            <h2 className="text-lg font-semibold text-slate-800 mb-4">Class Performance Summary</h2>
            <p className="text-slate-500 text-sm">
              The ClassPerformanceSummary component will load here. This will contain the filters for Academic Year, Term, and Class Stream, followed by the data tables.
            </p>
            <ClassPerformanceSummary role={role} />
          </div>
        )}

        {activeTab === 'reports' && (
          <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200">
            <h2 className="text-lg font-semibold text-slate-800 mb-4">Student Report Cards</h2>
            <p className="text-slate-500 text-sm">
              The StudentReports component will load here. This will handle the 8-4-4 and CBC report card generation.
            </p>
            <StudentReportCardViewer role={role} />
          </div>
        )}

        {activeTab === 'analytics' && (
          <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200">
            <h2 className="text-lg font-semibold text-slate-800 mb-4">School-Wide Trends</h2>
            <p className="text-slate-500 text-sm">
              The ResultsAnalytics component will load here. This will show graphical data, top/bottom performers, and subject deficit alerts.
            </p>
            <ResultsAnalytics role={role}/>
          </div>
        )}
      </div>
    </div>
  );
}