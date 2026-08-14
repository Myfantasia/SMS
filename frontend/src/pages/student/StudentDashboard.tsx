import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  GraduationCap, CalendarCheck, FileEdit, Wallet,
  IdCard, ShieldAlert, ArrowRight, Bell, CalendarDays
} from 'lucide-react';
import api from '../../libs/axiosInstance';
import Announcements from '../../components/Announcements';

interface StudentProfile {
  name: string;
  roll: string;
  class_name: string;
  mobile: string | null;
  fee: number | null;
  profile_pic: string | null;
  enrollment_state: string;
  graduation_destination: string | null;
}

interface StudentNotice {
  id: number;
  title: string;
  message: string;
  date: string;
  by: string;
  is_urgent: boolean;
}

interface StudentDashboardData {
  profile: StudentProfile;
  notices: StudentNotice[];
  attendance: { present: number; total: number; percentage: number | null };
  action_items: { pending_assignments: number; unread_messages: number };
}

export default function StudentDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState<StudentDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.get('/api/student/dashboard-overview/')
      .then((res) => {
        if (res.data?.status === 'success') {
          setData(res.data.data);
        } else {
          setError(true);
        }
      })
      .catch((err) => {
        console.error("Failed to fetch student dashboard overview", err);
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
          <div className="h-44 bg-slate-200 rounded-2xl"></div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {[1, 2, 3].map(i => <div key={i} className="h-28 bg-slate-200 rounded-2xl"></div>)}
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
  const attendancePct = data.attendance.percentage;

  const quickLinks = [
    { label: "Results", to: "/student-dashboard/results", icon: IdCard, color: "text-emerald-600 bg-emerald-50" },
    { label: "Subjects", to: "/student-dashboard/subjects", icon: GraduationCap, color: "text-purple-600 bg-purple-50" },
    { label: "Notices", to: "/student-dashboard/notices", icon: Bell, color: "text-blue-600 bg-blue-50" },
    { label: "Events", to: "/student-dashboard/events", icon: CalendarDays, color: "text-amber-600 bg-amber-50" },
  ];

  return (
    <div className="flex flex-col xl:flex-row gap-6">
      <div className="w-full xl:w-2/3 flex flex-col gap-8">

        {/* Welcome Banner */}
        <div className="relative bg-linear-to-r from-indigo-700 via-indigo-600 to-blue-500 p-8 rounded-2xl shadow-lg flex justify-between items-center text-white overflow-hidden">
          <div className="relative z-10">
            <h2 className="text-3xl font-extrabold mb-1">{getGreeting()}, {firstName}! 🎓</h2>
            {data.profile.enrollment_state === 'Graduated' ? (
              <p className="text-indigo-100 font-medium text-sm md:text-base">
                Graduated
                {data.profile.graduation_destination
                  ? ` — placed at ${data.profile.graduation_destination}`
                  : ' — destination not yet recorded'}
              </p>
            ) : (
              <p className="text-indigo-100 font-medium text-sm md:text-base">
                {data.profile.class_name} &middot; Roll No. {data.profile.roll}
              </p>
            )}
          </div>
          <div className="hidden md:block relative z-10 opacity-20 transform rotate-12">
            <GraduationCap className="w-32 h-32 text-white" />
          </div>
          <div className="absolute -right-10 -top-10 w-48 h-48 bg-white opacity-10 rounded-full blur-3xl pointer-events-none"></div>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] hover:-translate-y-1 hover:shadow-lg transition-all duration-300 flex items-center gap-5">
            <div className="p-4 bg-blue-50 text-blue-600 rounded-2xl"><CalendarCheck className="w-7 h-7" strokeWidth={2.5} /></div>
            <div className="flex flex-col">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Attendance (30d)</span>
              <span className="text-3xl font-extrabold text-slate-800 leading-none">{attendancePct != null ? `${attendancePct}%` : "--"}</span>
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] hover:-translate-y-1 hover:shadow-lg transition-all duration-300 flex items-center gap-5">
            <div className="p-4 bg-amber-50 text-amber-600 rounded-2xl"><FileEdit className="w-7 h-7" strokeWidth={2.5} /></div>
            <div className="flex flex-col">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Pending Assignments</span>
              <span className="text-3xl font-extrabold text-slate-800 leading-none">{data.action_items.pending_assignments}</span>
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] hover:-translate-y-1 hover:shadow-lg transition-all duration-300 flex items-center gap-5">
            <div className="p-4 bg-emerald-50 text-emerald-600 rounded-2xl"><Wallet className="w-7 h-7" strokeWidth={2.5} /></div>
            <div className="flex flex-col">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">School Fees</span>
              <span className="text-3xl font-extrabold text-slate-800 leading-none">{data.profile.fee != null ? `$${data.profile.fee}` : "--"}</span>
            </div>
          </div>
        </div>

        {/* Quick Links */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {quickLinks.map((link) => (
            <button
              key={link.label}
              onClick={() => navigate(link.to)}
              className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all flex flex-col items-start gap-3 text-left"
            >
              <div className={`p-2.5 rounded-xl ${link.color}`}><link.icon className="w-5 h-5" /></div>
              <span className="text-sm font-bold text-slate-700 flex items-center gap-1">
                {link.label} <ArrowRight className="w-3.5 h-3.5 opacity-40" />
              </span>
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
