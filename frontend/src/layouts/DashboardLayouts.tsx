import { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { School } from 'lucide-react';
import Menu from '../components/Menu';
import Navbar from '../components/Navbar';
import api from '../libs/axiosInstance';
import toast from 'react-hot-toast';
import { recordActivity, redirectToSignInIfSessionExpired, SIGN_IN_URL } from '../libs/sessionExpiry';

interface LayoutProps {
  role: 'admin' | 'teacher' | 'student' | 'parent' | 'staff';
}

export interface DashboardContextType {
  userId: number | null;
  userName: string;
  role: string;
  permissions: string[];
}

export default function DashboardLayout({ role }: LayoutProps) {
  const [userId, setUserId] = useState<number | null>(null);
  const [userName, setUserName] = useState("Loading...");
  const [isClassTeacher, setIsClassTeacher] = useState(false);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [authStatus, setAuthStatus] = useState<'checking' | 'authorized' | 'denied'>('checking');

  // 1. DYNAMIC FETCH — also acts as the auth gate for this route group.
  useEffect(() => {
    let cancelled = false;

    api.get('/api/my-profile/')
      .then((res) => {
        if (cancelled) return;
        if (res.data?.data) {
          const { id, first_name, last_name, is_class_teacher, permissions } = res.data.data;
          setUserId(id ?? null);
          setUserName(`${first_name} ${last_name}`);
          setIsClassTeacher(!!is_class_teacher);
          setPermissions(permissions || []);
          setAuthStatus('authorized');
          recordActivity();
        } else {
          setAuthStatus('denied');
        }
      })
      .catch(() => {
        if (cancelled) return;
        // Any failure (401, network, etc.) means we can't confirm a session — fail closed.
        setAuthStatus('denied');
      });

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (authStatus === 'denied') {
      window.location.href = SIGN_IN_URL;
    }
  }, [authStatus]);

  // Idle-timeout watchdog: any mouse/keyboard/scroll activity resets the 3-hour clock, so
  // only a genuinely idle tab (no interaction, no API calls) gets signed out. Checked every
  // minute rather than waiting for the next 401, so an idle tab left open still gets bounced.
  useEffect(() => {
    if (authStatus !== 'authorized') return;

    let lastRecorded = 0;
    const THROTTLE_MS = 5_000; // avoid hammering localStorage on every mousemove
    const handleActivity = () => {
      const now = Date.now();
      if (now - lastRecorded > THROTTLE_MS) {
        lastRecorded = now;
        recordActivity();
      }
    };

    const events: (keyof WindowEventMap)[] = ['mousemove', 'keydown', 'mousedown', 'scroll', 'touchstart'];
    events.forEach((evt) => window.addEventListener(evt, handleActivity, { passive: true }));

    redirectToSignInIfSessionExpired();
    const intervalId = setInterval(redirectToSignInIfSessionExpired, 60_000);

    return () => {
      events.forEach((evt) => window.removeEventListener(evt, handleActivity));
      clearInterval(intervalId);
    };
  }, [authStatus]);

  // 2. GLOBAL COMMAND PALETTE LISTENER
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        toast("Command Palette open", { icon: '🔍' });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Block rendering of dashboard chrome and content until the session is confirmed.
  if (authStatus !== 'authorized') {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
        <p className="text-slate-500 font-medium">
          {authStatus === 'denied' ? 'Redirecting to login...' : 'Verifying session...'}
        </p>
      </div>
    );
  }

  return (
    <div className="h-screen flex bg-slate-50 font-sans">

      {/* Sidebar Navigation */}
      <div className="w-[16%] md:w-[10%] lg:w-[18%] xl:w-[16%] px-3 lg:px-4 py-4 bg-white border-r border-slate-200 overflow-y-scroll scrollbar-hide flex flex-col transition-all">
        <div className="flex items-center justify-center lg:justify-start gap-2.5 mb-6 mt-1 px-1">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 to-blue-700 flex items-center justify-center shadow-sm shrink-0">
            <School className="w-5 h-5 text-white" />
          </div>
          <div className="hidden lg:flex flex-col leading-none">
            <span className="font-extrabold text-lg text-slate-800">SMS Portal</span>
            <span className="text-[10px] text-slate-400 font-medium tracking-wide">School Management</span>
          </div>
        </div>
        <div className="hidden lg:block h-px bg-slate-100 mb-2" />
        <Menu userRole={role} isClassTeacher={isClassTeacher} permissions={permissions} />
      </div>

      {/* Main Content Pane */}
      <div className="w-[84%] md:w-[90%] lg:w-[82%] xl:w-[84%] bg-slate-50 flex flex-col overflow-hidden">

        {/* Universal Top Navbar */}
        <Navbar role={role} userName={userName} />

        {/* Dynamic Page Content */}
        <main className="p-4 md:p-8 overflow-y-auto flex-1 scrollbar-hide">
          <Outlet context={{ userId, userName, role, permissions } satisfies DashboardContextType} />
        </main>

      </div>
    </div>
  );
}