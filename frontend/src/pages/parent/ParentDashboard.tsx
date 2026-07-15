import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, GraduationCap, CalendarCheck, Wallet, ShieldAlert, ChevronRight, Bell
} from 'lucide-react';
import api from '../../libs/axiosInstance';
import Announcements from '../../components/Announcements';

interface ParentProfile {
  name: string;
  mobile: string | null;
  relationship: string;
}

interface ChildOverview {
  id: number;
  name: string;
  roll: string;
  class_name: string;
  fee: number | null;
  attendance: { present: number; total: number; percentage: number | null };
}

interface ParentNotice {
  id: number;
  title: string;
  message: string;
  date: string;
  by: string;
  is_urgent: boolean;
}

interface ParentDashboardData {
  profile: ParentProfile;
  children: ChildOverview[];
  notices: ParentNotice[];
  action_items: { unread_messages: number };
}

export default function ParentDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState<ParentDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.get('/api/parent/dashboard-overview/')
      .then((res) => {
        if (res.data?.status === 'success') {
          setData(res.data.data);
        } else {
          setError(true);
        }
      })
      .catch((err) => {
        console.error("Failed to fetch parent dashboard overview", err);
        setError(true);
      })
      .finally(() => setLoading(false));
  }, []);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good Morning";
    if (hour < 18) return "Good Afternoon";
    return "Good Evening";
  };

  if (loading) {
    return (
      <div className="flex flex-col xl:flex-row gap-6 animate-pulse">
        <div className="w-full xl:w-2/3 flex flex-col gap-8">
          <div className="h-32 bg-slate-200 rounded-2xl"></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {[1, 2].map(i => <div key={i} className="h-40 bg-slate-200 rounded-2xl"></div>)}
          </div>
        </div>
        <div className="w-full xl:w-1/3 h-96 bg-slate-200 rounded-2xl"></div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-8 text-center text-slate-500">
        <ShieldAlert className="w-10 h-10 mx-auto mb-3 text-slate-300" />
        Couldn't load your dashboard right now. Please refresh the page.
      </div>
    );
  }

  const firstName = data.profile.name.split(' ')[0];

  return (
    <div className="flex flex-col xl:flex-row gap-6">
      <div className="w-full xl:w-2/3 flex flex-col gap-8">

        {/* Welcome Banner */}
        <div className="relative bg-linear-to-r from-emerald-700 via-emerald-600 to-teal-500 p-8 rounded-2xl shadow-lg flex justify-between items-center text-white overflow-hidden">
          <div className="relative z-10">
            <h2 className="text-3xl font-extrabold mb-1">{getGreeting()}, {firstName}! 👋</h2>
            <p className="text-emerald-100 font-medium text-sm md:text-base">
              Keeping you updated on {data.children.length === 1 ? "your child's" : "your children's"} progress.
            </p>
          </div>
          <div className="hidden md:block relative z-10 opacity-20 transform rotate-12">
            <Users className="w-32 h-32 text-white" />
          </div>
          <div className="absolute -right-10 -top-10 w-48 h-48 bg-white opacity-10 rounded-full blur-3xl pointer-events-none"></div>
        </div>

        {/* Children Overview */}
        <div className="flex flex-col gap-4">
          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest">Your Children</h3>

          {data.children.length === 0 ? (
            <div className="bg-white p-8 rounded-2xl border border-slate-100 text-center text-slate-400 text-sm">
              No linked student profiles yet. Contact the school office if this looks wrong.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {data.children.map((child) => (
                <div
                  key={child.id}
                  className="bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-all overflow-hidden"
                >
                  <div className="p-5 flex items-center gap-3 border-b border-slate-50">
                    <div className="w-11 h-11 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold shrink-0">
                      {child.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-slate-800 truncate">{child.name}</p>
                      <p className="text-xs text-slate-400">{child.class_name} &middot; Roll {child.roll}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 divide-x divide-slate-50">
                    <div className="p-4 flex items-center gap-2">
                      <CalendarCheck className="w-4 h-4 text-blue-500 shrink-0" />
                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Attendance</p>
                        <p className="text-sm font-bold text-slate-700">
                          {child.attendance.percentage != null ? `${child.attendance.percentage}%` : "--"}
                        </p>
                      </div>
                    </div>
                    <div className="p-4 flex items-center gap-2">
                      <Wallet className="w-4 h-4 text-amber-500 shrink-0" />
                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Fees</p>
                        <p className="text-sm font-bold text-slate-700">{child.fee != null ? `$${child.fee}` : "--"}</p>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => navigate('/parent-dashboard/results')}
                    className="w-full flex items-center justify-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 py-2.5 transition-colors"
                  >
                    View Results <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick Links */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Results", to: "/parent-dashboard/results", icon: ChevronRight, color: "text-emerald-600 bg-emerald-50" },
            { label: "Exams", to: "/parent-dashboard/exams", icon: GraduationCap, color: "text-purple-600 bg-purple-50" },
            { label: "Notices", to: "/parent-dashboard/notices", icon: Bell, color: "text-blue-600 bg-blue-50" },
            { label: "Events", to: "/parent-dashboard/events", icon: Users, color: "text-amber-600 bg-amber-50" },
          ].map((link) => (
            <button
              key={link.label}
              onClick={() => navigate(link.to)}
              className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all flex flex-col items-start gap-3 text-left"
            >
              <div className={`p-2.5 rounded-xl ${link.color}`}><link.icon className="w-5 h-5" /></div>
              <span className="text-sm font-bold text-slate-700">{link.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* RIGHT COLUMN */}
      <div className="w-full xl:w-1/3 flex flex-col gap-8">
        <Announcements
          notices={data.notices.map((n) => ({
            id: n.id,
            message: n.title ? `${n.title} — ${n.message}` : n.message,
            by: n.by,
            date: n.date,
            is_urgent: n.is_urgent,
          }))}
        />
      </div>
    </div>
  );
}
