import { Link, useLocation } from 'react-router-dom';
import { 
  Home, 
  GraduationCap, 
  Users, 
  UserSquare2, 
  CheckSquare, 
  CircleDollarSign, 
  Megaphone, 
  UserPlus, 
  User, 
  LogOut,
  Library,       // <-- NEW: For the Academics Hub
  Layers,        // For Classes
  BookOpen,      // For Subjects
  FileSignature, // For Exams
  FileEdit,      // For Assignments
  Award,         // For Results
  Calendar,       // For Events
  CalendarDays,
  ClipboardList,
  CheckCircle,
  CalendarClock,
  ListChecks,
  ShieldCheck,
  ShieldAlert,
  BookMarked,  // For Curriculum
  GitBranch,   // For Pathway
  Briefcase,   // For Staff
  Trash2       // For Trash
} from 'lucide-react';
import { clearActivity } from '../libs/sessionExpiry';

interface MenuProps {
  userRole: 'admin' | 'teacher' | 'student' | 'parent' | 'staff';
  isClassTeacher?: boolean;
  permissions?: string[];
}

type Role = 'admin' | 'teacher' | 'student' | 'parent';

interface MenuItemDef {
  icon: typeof Home;
  label: string;
  href: string;
  visible: Role[];
  requiresClassTeacher?: boolean;
  requiredPermission?: string;
}

// Staff has no fixed capability set the way the other four roles do — a Librarian and a
// Finance Officer are both "staff" but should see completely different sidebars. So unlike
// menuItems below (gated by a static per-role visible[] list), this is gated per-item by
// the actual RBAC permission code an admin granted via Roles & Permissions. Kept in sync
// with the module cards in pages/staff/StaffDashboard.tsx.
interface StaffMenuItemDef {
  icon: typeof Home;
  label: string;
  href: string;
  permission: string;
}

const staffMenuItems: StaffMenuItemDef[] = [
  { icon: CircleDollarSign, label: "Fees & Salary", href: "/staff-dashboard/finance", permission: "finance.view" },
  { icon: Megaphone, label: "Notices", href: "/staff-dashboard/notices", permission: "notices.edit" },
  { icon: Calendar, label: "Events", href: "/staff-dashboard/events", permission: "events.edit" },
  { icon: CalendarClock, label: "Leave Requests", href: "/staff-dashboard/leave-requests", permission: "leave.view" },
  { icon: Layers, label: "Classes", href: "/staff-dashboard/classes", permission: "classes.view" },
  { icon: BookMarked, label: "Curriculum", href: "/staff-dashboard/curriculum", permission: "curriculum.view" },
  { icon: CalendarDays, label: "Timetable", href: "/staff-dashboard/timetable", permission: "timetable.view" },
  { icon: CheckSquare, label: "Attendance", href: "/staff-dashboard/attendance", permission: "attendance.view" },
  { icon: FileSignature, label: "Exams", href: "/staff-dashboard/exams", permission: "exams.view" },
  { icon: Award, label: "Results", href: "/staff-dashboard/results", permission: "results.view" },
  { icon: FileEdit, label: "Assignments", href: "/staff-dashboard/assignments", permission: "assignments.view" },
  { icon: ClipboardList, label: "Allocations", href: "/staff-dashboard/allocations", permission: "allocations.view" },
];

const menuItems: { title: string; items: MenuItemDef[] }[] = [
  {
    title: "MANAGEMENT",
    items: [
      // General
      { icon: Home, label: "Dashboard", href: "/admin-dashboard", visible: ["admin", "teacher", "student", "parent"] },
      
      // People
      { icon: GraduationCap, label: "Teachers", href: "/admin-dashboard/teachers", visible: ["admin", "teacher"] },
      { icon: Users, label: "Students", href: "/admin-dashboard/students", visible: ["admin", "teacher"] },
      { icon: UserSquare2, label: "Parents", href: "/admin-dashboard/parents", visible: ["admin", "teacher"] },
      { icon: Briefcase, label: "Staff", href: "/admin-dashboard/staff", visible: ["admin"] },
      
      // Academic Structure (Teachers & Admins build this)
      { icon: Library, label: "Academics", href: "/admin-dashboard/academics", visible: ["admin"] }, // <-- UPDATED ICON
      { icon: BookMarked, label: "Curriculum", href: "/admin-dashboard/curriculum", visible: ["admin", "teacher"] },
      { icon: Layers, label: "Classes", href: "/admin-dashboard/classes", visible: ["admin", "teacher"] },
      { icon: BookOpen, label: "Subjects", href: "/admin-dashboard/subjects", visible: ["admin", "teacher", "student"] },
      { icon: ListChecks, label: "My Electives", href: "/admin-dashboard/my-electives", visible: ["student"] },
      { icon: GitBranch, label: "My Pathway", href: "/admin-dashboard/my-pathway", visible: ["student"] },
      { icon: ClipboardList, label: "Allocations", href: "/admin-dashboard/allocations", visible: ["admin"] },

      { icon: CalendarDays, label: "Timetable", href: "/admin-dashboard/timetable", visible: ["admin", "teacher"] },
      
      // Assessment & Evaluation (Students take them, Parents view them)
      { icon: FileSignature, label: "Exams", href: "/admin-dashboard/exams", visible: ["admin", "teacher", "student", "parent"] },
      { icon: FileEdit, label: "Assignments", href: "/admin-dashboard/assignments", visible: ["admin", "teacher", "student", "parent"] },
      { icon: Award, label: "Results", href: "/admin-dashboard/results", visible: ["admin", "teacher", "student", "parent"] },

      // Tracking & Operations
      { icon: CheckSquare, label: "Attendance", href: "/admin-dashboard/attendance", visible: ["admin", "teacher"], requiresClassTeacher: true },
      { icon: Calendar, label: "Events", href: "/admin-dashboard/events", visible: ["admin", "teacher", "student", "parent"] },
      { icon: Megaphone, label: "Notices", href: "/admin-dashboard/notices", visible: ["admin", "teacher", "student", "parent"] },
      { icon: ListChecks, label: "My Tasks", href: "/admin-dashboard/tasks", visible: ["student"] },
      { icon: CalendarClock, label: "Leave Requests", href: "/admin-dashboard/leave-requests", visible: ["admin"] },
      { icon: CalendarClock, label: "Apply Leave", href: "/admin-dashboard/leave-requests", visible: ["teacher"] },
      { icon: GitBranch, label: "Pathway Requests", href: "/admin-dashboard/pathway-requests", visible: ["admin", "teacher"], requiresClassTeacher: true },
      
      // Sensitive Data
      { icon: CircleDollarSign, label: "Fees & Salary", href: "/admin-dashboard/finance", visible: ["admin"] },
    ],
  },
  {
    title: "APPROVALS",
    items: [
      { icon: UserPlus, label: "Pending Teachers", href: "/admin-dashboard/approvals/teachers", visible: ["admin"] },
      { icon: UserPlus, label: "Pending Students", href: "/admin-dashboard/approvals/students", visible: ["admin"] },
      { icon: UserPlus, label: "Pending Parents", href: "/admin-dashboard/approvals/parents", visible: ["admin"] },
      { icon: ShieldAlert, label: "Pending Admins", href: "/admin-dashboard/approvals/admins", visible: ["admin"] },
      { icon: Briefcase, label: "Pending Staff", href: "/admin-dashboard/approvals/staff", visible: ["admin"] },
      { icon: CheckCircle, label: "Approve Leave", href: "/admin-dashboard/approvals/leave", visible: ["admin"] },
    ],
  },
  {
    title: "SYSTEM",
    items: [
      { icon: ShieldCheck, label: "Roles & Permissions", href: "/admin-dashboard/roles-permissions", visible: ["admin"] },
      { icon: Trash2, label: "Trash", href: "/admin-dashboard/trash", visible: ["admin"], requiredPermission: "trash.view" },
    ],
  },
  {
    title: "USER",
    items: [
      { icon: User, label: "Profile", href: "/admin-dashboard/profile", visible: ["admin", "teacher", "student", "parent"] },
      { icon: LogOut, label: "Logout", href: "http://localhost:8000/logout/", visible: ["admin", "teacher", "student", "parent"] },
    ],
  },
];

export default function Menu({ userRole, isClassTeacher = false, permissions = [] }: MenuProps) {
  const location = useLocation();

  if (userRole === 'staff') {
    const visibleItems = staffMenuItems.filter((item) => permissions.includes(item.permission));
    return (
      <div className="mt-2 text-sm pb-8 flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <Link
            to="/staff-dashboard"
            title="Dashboard"
            className={`relative flex items-center justify-start gap-3 py-2.5 px-2 lg:px-3 rounded-xl transition-all duration-150 ${
              location.pathname === '/staff-dashboard'
                ? "bg-blue-600 text-white font-semibold shadow-sm shadow-blue-200"
                : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            }`}
          >
            <Home className={`w-[18px] h-[18px] shrink-0 ${location.pathname === '/staff-dashboard' ? "text-white" : "text-slate-400"}`} />
            <span className="block text-[13px]">Dashboard</span>
          </Link>
        </div>

        {visibleItems.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="block text-slate-400 font-bold mb-1 px-2 text-[10px] tracking-widest uppercase">
              Your Modules
            </span>
            {visibleItems.map((item) => {
              const isActive = location.pathname === item.href;
              return (
                <Link
                  to={item.href}
                  key={item.href}
                  title={item.label}
                  className={`relative flex items-center justify-start gap-3 py-2.5 px-2 lg:px-3 rounded-xl transition-all duration-150 ${
                    isActive
                      ? "bg-blue-600 text-white font-semibold shadow-sm shadow-blue-200"
                      : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                  }`}
                >
                  <item.icon className={`w-[18px] h-[18px] shrink-0 ${isActive ? "text-white" : "text-slate-400"}`} />
                  <span className="block text-[13px] truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        )}

        <div className="flex flex-col gap-1">
          <span className="block text-slate-400 font-bold mb-1 px-2 text-[10px] tracking-widest uppercase">
            User
          </span>
          <Link
            to="/staff-dashboard/profile"
            title="Profile"
            className={`relative flex items-center justify-start gap-3 py-2.5 px-2 lg:px-3 rounded-xl transition-all duration-150 ${
              location.pathname === '/staff-dashboard/profile'
                ? "bg-blue-600 text-white font-semibold shadow-sm shadow-blue-200"
                : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            }`}
          >
            <User className={`w-[18px] h-[18px] shrink-0 ${location.pathname === '/staff-dashboard/profile' ? "text-white" : "text-slate-400"}`} />
            <span className="block text-[13px]">Profile</span>
          </Link>
          <a
            href="http://localhost:8000/logout/"
            title="Logout"
            onClick={clearActivity}
            className="group flex items-center justify-start gap-3 py-2.5 px-2 lg:px-3 rounded-xl transition-colors text-red-500 hover:bg-red-50 hover:text-red-700 font-medium"
          >
            <LogOut className="w-[18px] h-[18px] shrink-0" />
            <span className="block text-[13px]">Logout</span>
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2 text-sm pb-8 flex flex-col gap-6">
      {menuItems.map((section) => {
        // Filter out items that the current user role is not allowed to see. A teacher who
        // isn't a class teacher for any stream never sees items flagged requiresClassTeacher
        // (e.g. Attendance) — admins and class-teacher-teachers are unaffected.
        const visibleItems = section.items.filter(item =>
          item.visible.includes(userRole) &&
          !(item.requiresClassTeacher && userRole === 'teacher' && !isClassTeacher) &&
          (!item.requiredPermission || permissions.includes(item.requiredPermission))
        );

        // If the entire section (like APPROVALS) is empty for a user, don't render the title at all
        if (visibleItems.length === 0) return null;

        return (
          <div className="flex flex-col gap-1" key={section.title}>
            <span className="block text-slate-400 font-bold mb-1 px-2 text-[10px] tracking-widest uppercase">
              {section.title}
            </span>
            {visibleItems.map((item) => {

              // 1. Force the logout link to use a standard 'a' tag to hit Django backend
              if (item.label === "Logout") {
                return (
                  <a
                    href={item.href}
                    key={item.label}
                    title={item.label}
                    onClick={clearActivity}
                    className="group flex items-center justify-start gap-3 py-2.5 px-2 lg:px-3 rounded-xl transition-colors text-red-500 hover:bg-red-50 hover:text-red-700 font-medium"
                  >
                    <item.icon className="w-[18px] h-[18px] shrink-0" />
                    <span className="block text-[13px]">{item.label}</span>
                  </a>
                );
              }

              // 2. UNIVERSAL DASHBOARD ROUTING
              let dynamicHref = item.href;
              if (dynamicHref.startsWith("/admin-dashboard")) {
                dynamicHref = dynamicHref.replace("/admin-dashboard", `/${userRole}-dashboard`);
              }

              const isActive = location.pathname === dynamicHref;
              const IconComponent = item.icon;

              return (
                <Link
                  to={dynamicHref}
                  key={item.label}
                  title={item.label}
                  className={`relative flex items-center justify-start gap-3 py-2.5 px-2 lg:px-3 rounded-xl transition-all duration-150 ${
                    isActive
                      ? "bg-blue-600 text-white font-semibold shadow-sm shadow-blue-200"
                      : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                  }`}
                >
                  <IconComponent className={`w-[18px] h-[18px] shrink-0 ${isActive ? "text-white" : "text-slate-400 group-hover:text-slate-600"}`} />
                  <span className="block text-[13px] truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}