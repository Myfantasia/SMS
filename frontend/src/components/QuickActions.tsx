import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Users, GraduationCap, Megaphone, CalendarRange, ShieldCheck, UserPlus, UserCog, ClipboardList } from 'lucide-react';

interface Tile {
  label: string;
  to: string;
  icon: ReactNode;
  chip: string;
}

const TILES: Tile[] = [
  {
    label: 'Students',
    to: '/admin-dashboard/students',
    icon: <Users className="w-5 h-5" strokeWidth={2.5} />,
    chip: 'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400',
  },
  {
    label: 'Teachers',
    to: '/admin-dashboard/teachers',
    icon: <GraduationCap className="w-5 h-5" strokeWidth={2.5} />,
    chip: 'bg-purple-50 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400',
  },
  {
    label: 'Post Notice',
    to: '/admin-dashboard/notices',
    icon: <Megaphone className="w-5 h-5" strokeWidth={2.5} />,
    chip: 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400',
  },
  {
    label: 'Timetable',
    to: '/admin-dashboard/timetable',
    icon: <CalendarRange className="w-5 h-5" strokeWidth={2.5} />,
    chip: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  },
];

const APPROVAL_TYPES: { label: string; type: string; icon: ReactNode }[] = [
  { label: 'Teachers', type: 'teachers', icon: <UserPlus className="w-4 h-4 text-blue-500 dark:text-blue-400" /> },
  { label: 'Students', type: 'students', icon: <UserPlus className="w-4 h-4 text-emerald-500 dark:text-emerald-400" /> },
  { label: 'Parents', type: 'parents', icon: <UserCog className="w-4 h-4 text-purple-500 dark:text-purple-400" /> },
  { label: 'Admins', type: 'admins', icon: <ShieldCheck className="w-4 h-4 text-rose-500 dark:text-rose-400" /> },
  { label: 'Leave requests', type: 'leave', icon: <ClipboardList className="w-4 h-4 text-amber-500 dark:text-amber-400" /> },
];

function ActionTile({ to, icon, chip, label }: Tile) {
  return (
    <Link
      to={to}
      className="flex-1 min-w-[7.5rem] flex flex-col items-center gap-2 py-4 px-2 rounded-2xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-700 shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] dark:shadow-none hover:-translate-y-1 hover:shadow-lg dark:hover:shadow-none transition-all duration-300"
    >
      <div className={`p-3 rounded-xl ${chip}`}>{icon}</div>
      <span className="text-xs font-bold text-slate-600 dark:text-slate-300 text-center">{label}</span>
    </Link>
  );
}

export default function QuickActions() {
  return (
    <div className="flex flex-wrap gap-3">
      {TILES.map((tile) => (
        <ActionTile key={tile.label} {...tile} />
      ))}

      {/* Approvals tile opens a small type-picker, mirroring the profile-menu hover pattern in Navbar.tsx */}
      <div className="group relative flex-1 min-w-[7.5rem]">
        <button
          type="button"
          className="w-full flex flex-col items-center gap-2 py-4 px-2 rounded-2xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-700 shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] dark:shadow-none hover:-translate-y-1 hover:shadow-lg dark:hover:shadow-none transition-all duration-300 cursor-pointer"
        >
          <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400">
            <ShieldCheck className="w-5 h-5" strokeWidth={2.5} />
          </div>
          <span className="text-xs font-bold text-slate-600 dark:text-slate-300 text-center">Approvals</span>
        </button>

        <div className="absolute top-[calc(100%-0.5rem)] left-1/2 -translate-x-1/2 w-4 h-4 bg-transparent z-0"></div>
        <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 w-44 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xl rounded-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible translate-y-1 group-hover:translate-y-0 transition-all duration-200 flex flex-col z-50 py-2">
          {APPROVAL_TYPES.map((a) => (
            <Link
              key={a.type}
              to={a.type === 'leave' ? '/admin-dashboard/approvals/leave' : `/admin-dashboard/approvals/${a.type}`}
              className="flex items-center gap-3 px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-200 transition-colors text-sm font-medium"
            >
              {a.icon}
              {a.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
