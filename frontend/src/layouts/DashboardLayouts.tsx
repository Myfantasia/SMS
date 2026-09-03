import { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { School, X } from 'lucide-react';
import Menu from '../components/Menu';
import Navbar from '../components/Navbar';
import ForcedPasswordChangeGate from '../components/ForcedPasswordChangeGate';
import { ChatProvider } from '../components/chats/ChatProvider';
import api from '../libs/axiosInstance';
import toast from 'react-hot-toast';
import { recordActivity, redirectToSignInIfSessionExpired, SIGN_IN_URL } from '../libs/sessionExpiry';
import { getAdminTheme } from './theme/adminTheme';
import { useDashboardThemeMode } from './theme/useDashboardThemeMode';

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
  const [requiresPathwayChoice, setRequiresPathwayChoice] = useState(false);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [authStatus, setAuthStatus] = useState<'checking' | 'authorized' | 'denied'>('checking');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const { mode, toggleMode } = useDashboardThemeMode();
  const adminTheme = getAdminTheme(mode);

  // 1. DYNAMIC FETCH — also acts as the auth gate for this route group.
  useEffect(() => {
    let cancelled = false;

    api.get('/api/my-profile/')
      .then((res) => {
        if (cancelled) return;
        if (res.data?.data) {
          const { id, first_name, last_name, is_class_teacher, requires_pathway_choice, permissions, must_change_password } = res.data.data;
          setUserId(id ?? null);
          setUserName(`${first_name} ${last_name}`);
          setIsClassTeacher(!!is_class_teacher);
          setRequiresPathwayChoice(!!requires_pathway_choice);
          setPermissions(permissions || []);
          setMustChangePassword(!!must_change_password);
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
      <div data-dashboard-theme={mode} className="h-screen w-screen flex flex-col items-center justify-center bg-slate-100 dark:bg-slate-950">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 dark:border-blue-400 mb-4"></div>
        <p className="text-slate-500 dark:text-slate-400 font-medium">
          {authStatus === 'denied' ? 'Redirecting to login...' : 'Verifying session...'}
        </p>
      </div>
    );
  }

  // A temporary/admin-reset password blocks all dashboard access until the user sets
  // their own new one — checked after the session gate above so we know who they are.
  if (mustChangePassword) {
    return (
      <ThemeProvider theme={adminTheme}>
        <ForcedPasswordChangeGate onSuccess={() => setMustChangePassword(false)} />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme={adminTheme}>
    <ChatProvider>
    <div data-dashboard-theme={mode} className="h-screen flex bg-slate-100 dark:bg-slate-950 font-sans overflow-hidden">

      {/* Mobile backdrop — closes the drawer on outside tap, only relevant below `lg` */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-slate-900/40 z-40 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar Navigation — an off-canvas drawer below `lg`, a permanent rail at `lg` and up.
          Below `lg` the drawer must close itself once a link is actually followed, otherwise
          it stays open covering the page the user just tapped into — closing on click here
          (rather than an effect keyed on the route) avoids a state update loop. */}
      <div
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('a')) setMobileMenuOpen(false);
        }}
        className={`fixed inset-y-0 left-0 z-50 w-72 max-w-[80%] px-4 py-4 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700 overflow-y-scroll scrollbar-hide flex flex-col transition-transform duration-300 ease-in-out
          ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
          lg:static lg:translate-x-0 lg:z-auto lg:w-[18%] xl:w-[16%] lg:shrink-0`}
      >
        <div className="flex items-center justify-between gap-2.5 mb-6 mt-1 px-1">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 to-blue-700 flex items-center justify-center shadow-sm shrink-0">
              <School className="w-5 h-5 text-white" />
            </div>
            <div className="flex flex-col leading-none min-w-0">
              <span className="font-extrabold text-lg text-slate-800 dark:text-slate-100 truncate">SMS Portal</span>
              <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium tracking-wide">School Management</span>
            </div>
          </div>
          {/* Close button — only relevant below `lg`, where the sidebar is an off-canvas drawer */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close menu"
            className="lg:hidden shrink-0 w-8 h-8 flex items-center justify-center rounded-full text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          >
            <X className="w-4.5 h-4.5" />
          </button>
        </div>
        <div className="h-px bg-slate-100 dark:bg-slate-800 mb-2" />
        <Menu userRole={role} isClassTeacher={isClassTeacher} requiresPathwayChoice={requiresPathwayChoice} permissions={permissions} />
      </div>

      {/* Main Content Pane */}
      <div className="flex-1 min-w-0 bg-slate-100 dark:bg-slate-950 flex flex-col overflow-hidden">

        {/* Universal Top Navbar */}
        <Navbar role={role} userName={userName} onMenuClick={() => setMobileMenuOpen((open) => !open)} mode={mode} onToggleMode={toggleMode} />

        {/* Dynamic Page Content */}
        <main className="p-4 md:p-8 overflow-y-auto flex-1 scrollbar-hide">
          <Outlet context={{ userId, userName, role, permissions } satisfies DashboardContextType} />
        </main>

      </div>
    </div>
    </ChatProvider>
    </ThemeProvider>
  );
}