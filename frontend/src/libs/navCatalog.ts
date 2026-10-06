import {
  Home, GraduationCap, Users, UserSquare2, CheckSquare, CircleDollarSign, Megaphone, UserPlus,
  User, LogOut, Library, Layers, BookOpen, FileSignature, FileEdit, Award, Calendar, CalendarDays,
  ClipboardList, CheckCircle, CalendarClock, ListChecks, ShieldCheck, ShieldAlert, BookMarked,
  GitBranch, Briefcase, Newspaper, Trash2, MessagesSquare,
} from 'lucide-react';

// THE navigation catalog for every dashboard. The sidebar (components/Menu.tsx) and the staff
// and teacher home pages all read from here, so adding a module -- e.g. a new staff sub-system
// -- is ONE entry here, plus its route in App.tsx and its backend permission code. Nothing
// else lists modules.
//
// Who sees an item:
//   admin / student / parent -> exactly the items whose `visible` list contains their role.
//   teacher / staff          -> permission-driven, because an admin decides what each of them
//                               may do (Roles & Permissions):
//     * `visible` includes the role  -> a default entry; if `permission` is set the user must
//                                       also hold it (so removing it from a role removes the entry).
//     * `alsoFor` includes the role  -> shown only to users who hold `permission`; this is how a
//                                       Finance Officer gets Fees & Salary, or a teacher given an
//                                       extra role gains a module.
// Hrefs are written /admin-dashboard/... and rewritten to the viewer's own dashboard prefix.
// An entry is only useful if the matching <Route> exists in that dashboard's group in App.tsx.

export type DashboardRole = 'admin' | 'teacher' | 'student' | 'parent' | 'staff';
export type GrantableRole = 'teacher' | 'staff';

export interface NavItem {
  icon: typeof Home;
  label: string;
  href: string;
  visible: DashboardRole[];
  /** Code a teacher/staff member must hold to see this entry (see header comment). */
  permission?: string;
  /** Roles that see this entry only by holding `permission`, not by default. */
  alsoFor?: GrantableRole[];
  requiresClassTeacher?: boolean;
  requiresPathwayChoice?: boolean;
  /** Extra gate applied to every role (used by Trash). */
  requiredPermission?: string;
  /** Code that upgrades a view-only grant to full management; drives the "Can edit" badge. */
  editCode?: string;
  /** One line shown on the staff/teacher home card for this module. */
  description?: string;
  /** Show a home-page card even though no permission unlocks it (baseline self-service, e.g. My Leave). */
  homeCard?: boolean;
}

export interface NavSection { title: string; items: NavItem[] }

const EVERYONE: DashboardRole[] = ['admin', 'teacher', 'student', 'parent', 'staff'];

export const NAV_SECTIONS: NavSection[] = [
  {
    title: 'MANAGEMENT',
    items: [
      { icon: Home, label: 'Dashboard', href: '/admin-dashboard', visible: EVERYONE },

      { icon: GraduationCap, label: 'Teachers', href: '/admin-dashboard/teachers', visible: ['admin', 'teacher'] },
      { icon: Users, label: 'Students', href: '/admin-dashboard/students', visible: ['admin', 'teacher'] },
      { icon: UserSquare2, label: 'Parents', href: '/admin-dashboard/parents', visible: ['admin', 'teacher'] },
      { icon: Briefcase, label: 'Staff', href: '/admin-dashboard/staff', visible: ['admin'] },

      { icon: Library, label: 'Academics', href: '/admin-dashboard/academics', visible: ['admin'] },
      { icon: BookMarked, label: 'Curriculum', href: '/admin-dashboard/curriculum', visible: ['admin', 'teacher'],
        permission: 'curriculum.view', alsoFor: ['staff'], editCode: 'curriculum.edit', description: 'View curriculum structure and pathways.' },
      { icon: Layers, label: 'Classes', href: '/admin-dashboard/classes', visible: ['admin', 'teacher'],
        permission: 'classes.view', alsoFor: ['staff'], editCode: 'classes.edit', description: 'View class, stream, and enrollment records.' },
      { icon: BookOpen, label: 'Subjects', href: '/admin-dashboard/subjects', visible: ['admin', 'teacher'],
        permission: 'curriculum.view', alsoFor: ['staff'], editCode: 'curriculum.edit', description: 'Browse subjects and who teaches them.' },
      { icon: BookOpen, label: 'My Subjects', href: '/admin-dashboard/subjects', visible: ['student'] },
      { icon: GitBranch, label: 'My Pathway', href: '/admin-dashboard/my-pathway', visible: ['student'], requiresPathwayChoice: true },
      { icon: ClipboardList, label: 'Allocations', href: '/admin-dashboard/allocations', visible: ['admin'],
        permission: 'allocations.view', alsoFor: ['teacher', 'staff'], editCode: 'allocations.edit', description: 'View subject-teacher allocations.' },

      { icon: CalendarDays, label: 'Timetable', href: '/admin-dashboard/timetable', visible: ['admin', 'teacher'],
        permission: 'timetable.view', alsoFor: ['staff'], editCode: 'timetable.edit', description: 'View the master school timetable.' },

      { icon: FileSignature, label: 'Exams', href: '/admin-dashboard/exams', visible: ['admin', 'teacher', 'student', 'parent'],
        permission: 'exams.view', alsoFor: ['staff'], editCode: 'exams.edit', description: 'View exam setup and marks entry data.' },
      { icon: FileEdit, label: 'Assignments', href: '/admin-dashboard/assignments', visible: ['admin', 'teacher', 'student', 'parent'],
        permission: 'assignments.view', alsoFor: ['staff'], editCode: 'assignments.edit', description: 'View assignment management data.' },
      { icon: Award, label: 'Results', href: '/admin-dashboard/results', visible: ['admin', 'teacher', 'student', 'parent'],
        permission: 'results.view', alsoFor: ['staff'], editCode: 'results.edit', description: 'View exam results and analytics.' },

      { icon: CheckSquare, label: 'Attendance', href: '/admin-dashboard/attendance', visible: ['admin', 'teacher'], requiresClassTeacher: true,
        permission: 'attendance.view', alsoFor: ['staff'], editCode: 'attendance.edit', description: 'View attendance registers.' },
      // Events and Notices are readable by every teacher; only those granted the edit code get
      // the post/manage controls, so staff get their own entry gated on that code.
      { icon: Calendar, label: 'Events', href: '/admin-dashboard/events', visible: ['admin', 'teacher', 'student', 'parent'] },
      { icon: Calendar, label: 'Events', href: '/admin-dashboard/events', visible: [],
        permission: 'events.edit', alsoFor: ['staff'], description: 'Post and manage school events.' },
      { icon: Megaphone, label: 'Notices', href: '/admin-dashboard/notices', visible: ['admin', 'teacher', 'student', 'parent'] },
      { icon: Megaphone, label: 'Notices', href: '/admin-dashboard/notices', visible: [],
        permission: 'notices.edit', alsoFor: ['staff'], description: 'Post and manage school notices.' },
      { icon: ListChecks, label: 'My Tasks', href: '/admin-dashboard/tasks', visible: ['student'] },
      // Leave: every teacher and staff member can apply (no permission needed); reviewing others'
      // requests is granted -- leave.approve to decide (staff may also hold leave.view to look).
      { icon: CalendarClock, label: 'Leave Requests', href: '/admin-dashboard/leave-requests', visible: ['admin'] },
      { icon: CalendarClock, label: 'Apply Leave', href: '/admin-dashboard/leave-requests', visible: ['teacher'] },
      { icon: CalendarClock, label: 'My Leave', href: '/admin-dashboard/leave-requests', visible: ['staff'],
        homeCard: true, description: 'Apply for leave and track your applications.' },
      { icon: ShieldCheck, label: 'Review Leave', href: '/admin-dashboard/leave-requests/review', visible: [],
        permission: 'leave.view', alsoFor: ['staff'], editCode: 'leave.approve',
        description: 'See leave requests; approvers can approve or reject them.' },
      { icon: ShieldCheck, label: 'Review Leave', href: '/admin-dashboard/leave-requests/review', visible: [],
        permission: 'leave.approve', alsoFor: ['teacher'],
        description: 'Approve or reject teacher and staff leave requests.' },
      { icon: GitBranch, label: 'Pathway Requests', href: '/admin-dashboard/pathway-requests', visible: ['admin', 'teacher'], requiresClassTeacher: true },
      { icon: MessagesSquare, label: 'Chat Admin Tools', href: '/admin-dashboard/messages', visible: [],
        permission: 'chat.manage', alsoFor: ['teacher', 'staff'], description: 'Audit log, broadcasts, and parent cohorts.' },

      { icon: CircleDollarSign, label: 'Fees & Salary', href: '/admin-dashboard/finance', visible: ['admin'],
        permission: 'finance.view', alsoFor: ['teacher', 'staff'], description: 'View fee collection and salary overview.' },
    ],
  },
  {
    title: 'APPROVALS',
    items: [
      { icon: UserPlus, label: 'Pending Teachers', href: '/admin-dashboard/approvals/teachers', visible: ['admin'] },
      { icon: UserPlus, label: 'Pending Students', href: '/admin-dashboard/approvals/students', visible: ['admin'] },
      { icon: UserPlus, label: 'Pending Parents', href: '/admin-dashboard/approvals/parents', visible: ['admin'] },
      { icon: ShieldAlert, label: 'Pending Admins', href: '/admin-dashboard/approvals/admins', visible: ['admin'] },
      { icon: Briefcase, label: 'Pending Staff', href: '/admin-dashboard/approvals/staff', visible: ['admin'] },
      { icon: CheckCircle, label: 'Approve Leave', href: '/admin-dashboard/approvals/leave', visible: ['admin'] },
    ],
  },
  {
    title: 'SYSTEM',
    items: [
      { icon: ShieldCheck, label: 'Roles & Permissions', href: '/admin-dashboard/roles-permissions', visible: ['admin'] },
      { icon: Trash2, label: 'Trash', href: '/admin-dashboard/trash', visible: ['admin'], requiredPermission: 'trash.view' },
      { icon: Newspaper, label: 'Blog & Alumni Content', href: '/admin-dashboard/content', visible: ['admin'] },
    ],
  },
  {
    title: 'USER',
    items: [
      { icon: User, label: 'Profile', href: '/admin-dashboard/profile', visible: EVERYONE },
      { icon: LogOut, label: 'Logout', href: 'http://localhost:8000/logout/', visible: EVERYONE },
    ],
  },
];

export interface NavContext {
  role: DashboardRole;
  permissions: string[];
  isClassTeacher: boolean;
  requiresPathwayChoice: boolean;
}

function isGrantable(role: DashboardRole): role is GrantableRole {
  return role === 'teacher' || role === 'staff';
}

/** Whether `item` appears in this user's sidebar. */
export function isNavItemVisible(item: NavItem, ctx: NavContext): boolean {
  const { role, permissions } = ctx;
  if (item.requiredPermission && !permissions.includes(item.requiredPermission)) return false;
  if (item.requiresClassTeacher && role === 'teacher' && !ctx.isClassTeacher) return false;
  if (item.requiresPathwayChoice && role === 'student' && !ctx.requiresPathwayChoice) return false;

  // admin, student, parent: fixed by role. (Admin is deliberately not re-checked against
  // permission codes: the Admin role holds them all, and the server is the real gate.)
  if (!isGrantable(role)) return item.visible.includes(role);

  // teacher, staff: driven by the permissions an admin assigned.
  if (item.visible.includes(role)) return !item.permission || permissions.includes(item.permission);
  return !!item.alsoFor?.includes(role) && !!item.permission && permissions.includes(item.permission);
}

export interface GrantedModule {
  item: NavItem;
  /** Whether the user also holds the edit-level code (or the module has no edit tier). */
  canEdit: boolean;
  /** True when the module is not in the role's default sidebar -- it came from an assigned role.
   *  Baseline cards (no permission needed) are never "added by role". */
  addedByRole: boolean;
}

/** Modules a teacher/staff member reaches through permissions, for the home-page cards. */
export function getGrantedModules(role: GrantableRole, permissions: string[]): GrantedModule[] {
  const modules: GrantedModule[] = [];
  for (const section of NAV_SECTIONS) {
    for (const item of section.items) {
      const baseline = !!item.homeCard && item.visible.includes(role);
      const granted = !!item.alsoFor?.includes(role) && !!item.permission && permissions.includes(item.permission);
      if (!baseline && !granted) continue;
      modules.push({
        item,
        canEdit: item.editCode ? permissions.includes(item.editCode) : true,
        addedByRole: !baseline && !item.visible.includes(role),
      });
    }
  }
  return modules;
}
