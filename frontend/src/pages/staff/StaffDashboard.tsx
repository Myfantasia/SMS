import { useEffect, useState } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import {
  Briefcase, BookMarked, CheckSquare, Calendar, Megaphone, CalendarClock,
  Award, FileSignature, FileEdit, CircleDollarSign, CalendarDays,
  ClipboardList, Layers, MessagesSquare, ChevronRight, Sparkles,
} from 'lucide-react';
import type { DashboardContextType } from '../../layouts/DashboardLayouts';
import api from '../../libs/axiosInstance';

// Staff accounts carry zero fixed capabilities of their own — everything shown here is
// derived from whatever Role(s) an admin assigned via Roles & Permissions. This is the
// launcher a Librarian, Finance Officer, Secretary, etc. land on after login: only the
// modules their assigned permission codes actually unlock.
const MODULES: { code: string; icon: typeof Briefcase; label: string; description: string; href: string }[] = [
  { code: 'finance.view', icon: CircleDollarSign, label: 'Fees & Salary', description: 'View fee collection and salary overview.', href: '/staff-dashboard/finance' },
  { code: 'notices.edit', icon: Megaphone, label: 'Notices', description: 'Post and manage school notices.', href: '/staff-dashboard/notices' },
  { code: 'events.edit', icon: Calendar, label: 'Events', description: 'Post and manage school events.', href: '/staff-dashboard/events' },
  { code: 'leave.view', icon: CalendarClock, label: 'Leave Requests', description: 'Review and manage staff leave requests.', href: '/staff-dashboard/leave-requests' },
  { code: 'classes.view', icon: Layers, label: 'Classes', description: 'View class, stream, and enrollment records.', href: '/staff-dashboard/classes' },
  { code: 'curriculum.view', icon: BookMarked, label: 'Curriculum', description: 'View curriculum structure and pathways.', href: '/staff-dashboard/curriculum' },
  { code: 'timetable.view', icon: CalendarDays, label: 'Timetable', description: 'View the master school timetable.', href: '/staff-dashboard/timetable' },
  { code: 'attendance.view', icon: CheckSquare, label: 'Attendance', description: 'View attendance registers.', href: '/staff-dashboard/attendance' },
  { code: 'exams.view', icon: FileSignature, label: 'Exams', description: 'View exam setup and marks entry data.', href: '/staff-dashboard/exams' },
  { code: 'results.view', icon: Award, label: 'Results', description: 'View exam results and analytics.', href: '/staff-dashboard/results' },
  { code: 'assignments.view', icon: FileEdit, label: 'Assignments', description: 'View assignment management data.', href: '/staff-dashboard/assignments' },
  { code: 'allocations.view', icon: ClipboardList, label: 'Allocations', description: 'View subject-teacher allocations.', href: '/staff-dashboard/allocations' },
  { code: 'chat.manage', icon: MessagesSquare, label: 'Chat Admin Tools', description: 'Audit log, broadcasts, and parent cohorts.', href: '/staff-dashboard/messages' },
];

interface Profile {
  first_name: string;
  last_name: string;
  job_title?: string | null;
}

export default function StaffDashboard() {
  const { permissions } = useOutletContext<DashboardContextType>();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    api.get('/api/my-profile/')
      .then((res) => { if (res.data?.status === 'success') setProfile(res.data.data); })
      .catch(() => {});
  }, []);

  const unlockedModules = MODULES.filter((m) => permissions.includes(m.code));

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-2xl text-blue-600 bg-blue-50">
          <Briefcase className="w-7 h-7" strokeWidth={2.5} />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">
            Welcome, {profile?.first_name || 'there'}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {profile?.job_title || 'Staff'} &middot; {unlockedModules.length} module{unlockedModules.length !== 1 ? 's' : ''} available to you
          </p>
        </div>
      </div>

      {unlockedModules.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-10 text-center space-y-3">
          <Sparkles className="w-8 h-8 text-slate-300 mx-auto" />
          <h2 className="text-lg font-bold text-slate-700">No modules assigned yet</h2>
          <p className="text-sm text-slate-500 max-w-md mx-auto">
            Your account is approved, but an administrator hasn't assigned you a Role yet.
            Once they do — from Roles &amp; Permissions — the modules it grants will appear here automatically.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {unlockedModules.map((m) => (
            <button
              key={m.code}
              onClick={() => navigate(m.href)}
              className="text-left bg-white rounded-2xl shadow-sm border border-slate-100 p-5 hover:border-blue-300 hover:shadow-md transition group"
            >
              <div className="flex items-start justify-between">
                <div className="p-2.5 rounded-xl bg-blue-50 text-blue-600 mb-4">
                  <m.icon className="w-5 h-5" />
                </div>
                <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-blue-500 transition" />
              </div>
              <h3 className="font-bold text-slate-800">{m.label}</h3>
              <p className="text-xs text-slate-500 mt-1">{m.description}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
