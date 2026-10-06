import { useEffect, useState } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { Briefcase, ChevronRight, Sparkles } from 'lucide-react';
import type { DashboardContextType } from '../../layouts/DashboardLayouts';
import { getGrantedModules } from '../../libs/navCatalog';
import api from '../../libs/axiosInstance';

// Staff accounts carry zero fixed capabilities of their own — everything shown here is derived
// from whatever Role(s) an admin assigned via Roles & Permissions. This is the launcher a
// Librarian, Finance Officer, Secretary, etc. land on after login: only the modules their
// assigned permission codes actually unlock. The module list itself lives in libs/navCatalog.ts
// (shared with the sidebar), so a new module shows up here automatically, and because the layout
// keeps `permissions` current, cards appear and disappear live when an admin changes the roles.

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

  const unlockedModules = getGrantedModules('staff', permissions);
  // Cards that came from an assigned role (as opposed to baseline ones like My Leave).
  const hasRoleModules = unlockedModules.some((m) => !!m.item.permission);

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-2xl text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10">
          <Briefcase className="w-7 h-7" strokeWidth={2.5} />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800 dark:text-slate-100">
            Welcome, {profile?.first_name || 'there'}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {profile?.job_title || 'Staff'} &middot; {unlockedModules.length} module{unlockedModules.length !== 1 ? 's' : ''} available to you
          </p>
        </div>
      </div>

      {!hasRoleModules && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm dark:shadow-none border border-slate-100 dark:border-slate-700 p-6 flex items-start gap-4">
          <Sparkles className="w-6 h-6 text-slate-300 dark:text-slate-600 shrink-0 mt-0.5" />
          <div>
            <h2 className="text-base font-bold text-slate-700 dark:text-slate-200">No modules assigned yet</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-xl">
              Your account is approved, but an administrator hasn't assigned you a Role yet.
              Once they do — from Roles &amp; Permissions — the modules it grants will appear here automatically.
            </p>
          </div>
        </div>
      )}

      {unlockedModules.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {unlockedModules.map(({ item, canEdit }) => (
            <button
              key={`${item.label}-${item.href}`}
              onClick={() => navigate(item.href.replace('/admin-dashboard', '/staff-dashboard'))}
              className="text-left bg-white dark:bg-slate-900 rounded-2xl shadow-sm dark:shadow-none border border-slate-100 dark:border-slate-700 p-5 hover:border-blue-300 dark:hover:border-blue-500/40 hover:shadow-md dark:hover:shadow-none transition group"
            >
              <div className="flex items-start justify-between">
                <div className="p-2.5 rounded-xl bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 mb-4">
                  <item.icon className="w-5 h-5" />
                </div>
                <ChevronRight className="w-4 h-4 text-slate-300 dark:text-slate-600 group-hover:text-blue-500 dark:group-hover:text-blue-400 transition" />
              </div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-slate-800 dark:text-slate-100">{item.label}</h3>
                {item.editCode && (
                  <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${
                    canEdit
                      ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                  }`}>
                    {canEdit ? 'Can edit' : 'View only'}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{item.description}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
