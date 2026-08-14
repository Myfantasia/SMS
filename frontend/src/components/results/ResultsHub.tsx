import { useState } from 'react';
import { BarChart3, FileText, TrendingUp, Award, Sparkles, Clock } from 'lucide-react';
import ClassPerformanceSummary from './ClassPerformanceSummary';
import StudentReportCardViewer from './StudentReportCardViewer';
import ResultsAnalytics from './ResultAnalytics';
import PromotionPanel from './PromotionPanel';

interface ResultsHubProps {
  role: 'admin' | 'teacher' | 'student' | 'parent';
}

export default function ResultsHub({ role }: ResultsHubProps) {
  // We use tabs to keep the UI clean and focused
  const [activeTab, setActiveTab] = useState<'performance' | 'reports' | 'analytics' | 'promotion'>('performance');

  // If a student or parent logs in, they get a completely different, simplified view
  if (role === 'student' || role === 'parent') {
    return (
      <div className="flex flex-col items-center justify-center text-center p-8 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200 min-h-100">
        <div className="relative mb-6">
          <div className="w-20 h-20 bg-amber-100/80 rounded-3xl flex items-center justify-center border border-amber-200/60 shadow-inner">
            <Award className="w-10 h-10 text-amber-600" />
          </div>
          <div className="absolute -top-2 -right-2 w-8 h-8 bg-indigo-500 text-white rounded-full flex items-center justify-center shadow-md">
            <Sparkles className="w-4 h-4" />
          </div>
        </div>
        <span className="px-3 py-1 bg-amber-100 text-amber-800 text-[10px] font-black uppercase tracking-wider rounded-md border border-amber-200 inline-flex items-center gap-1.5 mb-3">
          <Clock className="w-3 h-3" /> Coming Soon
        </span>
        <h2 className="text-2xl font-black text-slate-800 tracking-tight">My Academic Results</h2>
        <p className="text-sm text-slate-500 font-medium leading-relaxed max-w-md mt-2">
          A personal report card viewer is on the way. In the meantime, published exam results are announced through Notices.
        </p>
      </div>
    );
  }

  const tabs = [
    { id: 'performance' as const, label: 'Class Performance', icon: BarChart3 },
    { id: 'reports' as const, label: 'Student Report Cards', icon: FileText },
    { id: 'analytics' as const, label: 'School Analytics', icon: TrendingUp },
    ...(role === 'admin' ? [{ id: 'promotion' as const, label: 'Promotion', icon: Award }] : []),
  ];

  // Admin & Teacher View
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-2xl text-yellow-600 bg-yellow-50">
          <Award className="w-7 h-7" strokeWidth={2.5} />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">Results & Analytics</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Review published exam broadsheets, class performance, and student report cards.
          </p>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="bg-white p-1.5 rounded-2xl border border-slate-100 inline-flex gap-1 shadow-sm">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2 transition-colors ${
              activeTab === tab.id
                ? 'bg-blue-50 text-blue-700'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Dynamic Content Area */}
      <div>
        {activeTab === 'performance' && (
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
            <h2 className="text-lg font-semibold text-slate-800 mb-4">Class Performance Summary</h2>
            <ClassPerformanceSummary role={role} />
          </div>
        )}

        {activeTab === 'reports' && (
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
            <h2 className="text-lg font-semibold text-slate-800 mb-4">Student Report Cards</h2>
            <StudentReportCardViewer role={role} />
          </div>
        )}

        {activeTab === 'analytics' && (
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
            <h2 className="text-lg font-semibold text-slate-800 mb-4">School-Wide Trends</h2>
            <ResultsAnalytics role={role}/>
          </div>
        )}

        {activeTab === 'promotion' && role === 'admin' && (
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
            <PromotionPanel />
          </div>
        )}
      </div>
    </div>
  );
}
