import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Bell, UserPlus, Users, FileEdit, ClipboardCheck, BookOpen, CreditCard, CalendarClock, GraduationCap, ShieldAlert, Cog } from 'lucide-react';
import api from '../libs/axiosInstance';

interface NotificationBellProps {
  role: string;
}

// --- Upgraded Interfaces for our API data ---
interface PendingApprovals {
  pending_teachers: number;
  pending_students: number;
  pending_parents: number;
  pending_admins: number;
  pending_leaves: number;
  timetable_warnings: number; // ✅ Linked to Django Cache layer count
  total_pending: number;
}

interface TeacherActionItems {
  pending_assignments: number;
  pending_exams: number;
  pending_leaves: number;
}

interface StudentActionItems {
  due_assignments: number;
  unread_notices: number;
}

interface ParentActionItems {
  fee_reminders: number;
  attendance_alerts: number;
}

// Real notifications from the Notification model (recipient/title/message) — currently the
// only thing that writes to it is report card publishing, but any future feature can reuse
// the same feed since it's a single self-service endpoint scoped to the logged-in user.
interface RealNotification {
  id: number;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
  action_url: string | null;
}

export default function NotificationBell({ role }: NotificationBellProps) {
  const [pendingData, setPendingData] = useState<PendingApprovals>({
    pending_teachers: 0, pending_students: 0, pending_parents: 0, pending_admins: 0, pending_leaves: 0, timetable_warnings: 0, total_pending: 0
  });

  const [teacherActions, setTeacherActions] = useState<TeacherActionItems>({
    pending_assignments: 0, pending_exams: 0, pending_leaves: 0,
  });

  // These two roles have no real backing endpoint for due_assignments/unread_notices/
  // fee_reminders yet (flagged, out of scope here) — fixed at 0 like admin/teacher's
  // genuinely-fetched counts start, instead of seeding fake numbers that render as real
  // data. No setter: nothing populates these until a real endpoint exists.
  const [studentActions] = useState<StudentActionItems>({
    due_assignments: 0, unread_notices: 0
  });

  const [parentActions] = useState<ParentActionItems>({
    fee_reminders: 0, attendance_alerts: 0
  });

  const [realNotifications, setRealNotifications] = useState<RealNotification[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Click-open + outside-click-to-close, matching ChatSidebar's overflow-menu pattern —
  // consistent with the rest of the app and touch-friendly (hover-open isn't).
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  useEffect(() => {
    const fetchRoleData = () => {
      if (role === 'admin') {
        api.get('/api/pending-approvals/')
          .then((res) => setPendingData(res.data))
          .catch((err) => console.error("Failed to fetch pending approvals", err));
        // Real, backend-driven notifications — this is how an admin finds out a background
        // job (timetable generation, allocation rollover/bulk-allocate, bulk results) they
        // triggered has finished, since those return instantly and complete later. Same
        // feed student/parent already use below.
        api.get('/api/core/notifications/')
          .then((res) => setRealNotifications(res.data.results))
          .catch((err) => console.error("Failed to fetch notifications", err));

      } else if (role === 'teacher') {
        api.get('/api/teacher/dashboard-overview/')
          .then((res) => {
            const data = res.data;
            if (data.status === 'success' && data.data.action_items) {
              setTeacherActions({
                pending_assignments: data.data.action_items.pending_assignments || 0,
                pending_exams: data.data.action_items.pending_exams || 0,
                pending_leaves: data.data.action_items.pending_leaves || 0,
              });
            }
          })
          .catch((err) => console.error("Failed to fetch teacher actions", err));
      } else if (role === 'student' || role === 'parent') {
        // Real, backend-driven notifications (e.g. "Report Card Published") — replaces the
        // previous hardcoded placeholder counts for these two roles.
        api.get('/api/core/notifications/')
          // Paginated now (NotificationViewSet.pagination_class) — the bell dropdown only
          // ever showed recent notifications anyway, so the first page covers it.
          .then((res) => setRealNotifications(res.data.results))
          .catch((err) => console.error("Failed to fetch notifications", err));
      }
    };

    fetchRoleData();
    // A background job (timetable/rollover/bulk-allocate/bulk-results) can finish minutes
    // after the triggering page was left — the page that submitted it shows its own result
    // via pollJob(), but the bell is what lets the operator find out from anywhere else in
    // the app. Poll instead of only fetching on mount so that notice actually arrives.
    const intervalId = setInterval(fetchRoleData, 30000);
    return () => clearInterval(intervalId);
  }, [role]);

  const markNotificationRead = (id: number) => {
    setRealNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    api.patch(`/api/core/notifications/${id}/`, { is_read: true })
      .catch((err) => console.error("Failed to mark notification as read", err));
  };

  const unreadRealNotifications = realNotifications.filter(n => !n.is_read);

  const markAllRead = () => {
    unreadRealNotifications.forEach(n => markNotificationRead(n.id));
  };

  // Calculate the total notifications based dynamically on the role
  let totalNotifications = 0;
  if (role === 'admin') totalNotifications = pendingData.total_pending + unreadRealNotifications.length;
  if (role === 'teacher') totalNotifications = teacherActions.pending_assignments + teacherActions.pending_exams + teacherActions.pending_leaves;
  if (role === 'student') totalNotifications = studentActions.due_assignments + unreadRealNotifications.length;
  if (role === 'parent') totalNotifications = parentActions.fee_reminders + unreadRealNotifications.length;

  // Red is reserved for genuinely time-sensitive items (leave/timetable clashes needing
  // a decision); everything else is informational and reads as amber instead of always-red.
  let hasUrgent = false;
  if (role === 'admin') hasUrgent = pendingData.timetable_warnings > 0 || pendingData.pending_leaves > 0
    || unreadRealNotifications.some(n => n.title.toLowerCase().includes('failed'));
  if (role === 'teacher') hasUrgent = teacherActions.pending_leaves > 0;
  if (role === 'parent') hasUrgent = parentActions.attendance_alerts > 0;

  return (
    <div ref={containerRef} className="relative flex items-center justify-center">

      {/* Bell Icon Container */}
      <button
        type="button"
        onClick={() => setIsOpen(prev => !prev)}
        className="bg-amber-50 dark:bg-amber-500/10 text-amber-500 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-500/20 hover:text-amber-600 dark:hover:text-amber-300 transition-colors rounded-full w-9 h-9 flex items-center justify-center cursor-pointer relative z-10"
        title="Notifications"
        aria-label="Notifications"
      >
        <Bell className="w-4 h-4" />

        {/* Notification Badge */}
        {totalNotifications > 0 && (
          <div className={`absolute -top-1 -right-1 w-5 h-5 flex items-center justify-center text-white rounded-full text-[11px] font-bold border-2 border-white dark:border-slate-900 shadow-sm ${hasUrgent ? 'bg-red-500 animate-pulse' : 'bg-amber-500'}`}>
            {totalNotifications}
          </div>
        )}
      </button>

      {isOpen && (
      <div className="absolute top-12 right-0 w-72 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl dark:shadow-none rounded-xl flex flex-col z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150 origin-top-right">
        <div className="bg-slate-50 dark:bg-slate-800/60 px-4 py-3 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center">
          <span className="font-bold text-slate-700 dark:text-slate-100 text-sm">Action Required</span>
          {(role === 'admin' || role === 'student' || role === 'parent') && unreadRealNotifications.length > 0 && (
            <button type="button" onClick={markAllRead} className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300">
              Mark all read
            </button>
          )}
        </div>

        <div className="flex flex-col max-h-96 overflow-y-auto">
          
          {/* ========================================== */}
          {/* 1. ADMIN PANEL VIEW COLLECTION */}
          {/* ========================================== */}
          {role === 'admin' && (
            <>
              {/* ✅ NEW: Timetable Warning Alert Card Dropdown */}
              {pendingData.timetable_warnings > 0 && (
                <Link to="/admin-dashboard/timetable" className="px-4 py-3 border-b border-rose-100 dark:border-rose-500/20 bg-rose-50/30 dark:bg-rose-500/10 hover:bg-rose-50 dark:hover:bg-rose-500/15 transition-colors flex items-start gap-3">
                  <div className="bg-rose-100 dark:bg-rose-500/20 p-2 rounded-full mt-1">
                    <FileEdit className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-rose-900 dark:text-rose-300">Timetable Clashes</p>
                    <p className="text-xs text-rose-600 dark:text-rose-400">{pendingData.timetable_warnings} lessons sitting in Unscheduled Basket.</p>
                  </div>
                </Link>
              )}

              {pendingData.pending_teachers > 0 && (
                <Link to="/admin-dashboard/approvals/teachers" className="px-4 py-3 border-b border-slate-50 dark:border-slate-700/60 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors flex items-start gap-3">
                  <div className="bg-blue-100 dark:bg-blue-500/20 p-2 rounded-full mt-1"><UserPlus className="w-4 h-4 text-blue-600 dark:text-blue-400" /></div>
                  <div>
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Teacher Approvals</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{pendingData.pending_teachers} new teachers waiting.</p>
                  </div>
                </Link>
              )}
              {pendingData.pending_students > 0 && (
                <Link to="/admin-dashboard/approvals/students" className="px-4 py-3 border-b border-slate-50 dark:border-slate-700/60 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors flex items-start gap-3">
                  <div className="bg-emerald-100 dark:bg-emerald-500/20 p-2 rounded-full mt-1"><UserPlus className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /></div>
                  <div>
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Student Approvals</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{pendingData.pending_students} new students waiting.</p>
                  </div>
                </Link>
              )}
              {pendingData.pending_parents > 0 && (
                <Link to="/admin-dashboard/approvals/parents" className="px-4 py-3 border-b border-slate-50 dark:border-slate-700/60 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors flex items-start gap-3">
                  <div className="bg-purple-100 dark:bg-purple-500/20 p-2 rounded-full mt-1"><Users className="w-4 h-4 text-purple-600 dark:text-purple-400" /></div>
                  <div>
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Parent Approvals</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{pendingData.pending_parents} accounts waiting.</p>
                  </div>
                </Link>
              )}
              {pendingData.pending_admins > 0 && (
                <Link to="/admin-dashboard/approvals/admins" className="px-4 py-3 border-b border-slate-50 dark:border-slate-700/60 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors flex items-start gap-3">
                  <div className="bg-rose-100 dark:bg-rose-500/20 p-2 rounded-full mt-1"><ShieldAlert className="w-4 h-4 text-rose-600 dark:text-rose-400" /></div>
                  <div>
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Admin Approvals</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{pendingData.pending_admins} new admins waiting for review.</p>
                  </div>
                </Link>
              )}
              {pendingData.pending_leaves > 0 && (
                <Link to="/admin-dashboard/approvals/leave" className="px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors flex items-start gap-3">
                  <div className="bg-amber-100 dark:bg-amber-500/20 p-2 rounded-full mt-1"><CalendarClock className="w-4 h-4 text-amber-600 dark:text-amber-400" /></div>
                  <div>
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Leave Approvals</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{pendingData.pending_leaves} requests awaiting your decision.</p>
                  </div>
                </Link>
              )}

              {/* Background job completions (timetable generation, rollover, bulk-allocate,
                  bulk results) — the operator finds out here even if they left the page
                  that submitted it. Failures render in rose, successes in emerald. */}
              {realNotifications.map((n) => {
                const isFailure = n.title.toLowerCase().includes('failed');
                const content = (
                  <>
                    <div className={`p-2 rounded-full mt-1 ${isFailure ? 'bg-rose-100 dark:bg-rose-500/20' : 'bg-emerald-100 dark:bg-emerald-500/20'}`}>
                      <Cog className={`w-4 h-4 ${isFailure ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{n.title}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{n.message}</p>
                    </div>
                  </>
                );
                const rowClass = `px-4 py-3 border-b border-slate-50 dark:border-slate-700/60 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors flex items-start gap-3 cursor-pointer ${!n.is_read ? (isFailure ? 'bg-rose-50/40 dark:bg-rose-500/10' : 'bg-emerald-50/40 dark:bg-emerald-500/10') : ''}`;
                return n.action_url ? (
                  <Link key={n.id} to={n.action_url} className={rowClass} onClick={() => !n.is_read && markNotificationRead(n.id)}>
                    {content}
                  </Link>
                ) : (
                  <div key={n.id} className={rowClass} onClick={() => !n.is_read && markNotificationRead(n.id)}>
                    {content}
                  </div>
                );
              })}
            </>
          )}

          {/* ========================================== */}
          {/* 2. TEACHER UI */}
          {/* ========================================== */}
          {role === 'teacher' && (
            <>
              {teacherActions.pending_assignments > 0 && (
                <Link to="/teacher-dashboard/assignments" className="px-4 py-3 border-b border-slate-50 dark:border-slate-700/60 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors flex items-start gap-3">
                  <div className="bg-amber-100 dark:bg-amber-500/20 p-2 rounded-full mt-1"><FileEdit className="w-4 h-4 text-amber-600 dark:text-amber-400" /></div>
                  <div>
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Ungraded Assignments</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{teacherActions.pending_assignments} submissions need marking.</p>
                  </div>
                </Link>
              )}
              {teacherActions.pending_exams > 0 && (
                <Link to="/teacher-dashboard/exams" className="px-4 py-3 border-b border-slate-50 dark:border-slate-700/60 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors flex items-start gap-3">
                  <div className="bg-rose-100 dark:bg-rose-500/20 p-2 rounded-full mt-1"><ClipboardCheck className="w-4 h-4 text-rose-600 dark:text-rose-400" /></div>
                  <div>
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Draft Exams</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{teacherActions.pending_exams} exams awaiting finalization.</p>
                  </div>
                </Link>
              )}
              {teacherActions.pending_leaves > 0 && (
                <Link to="/teacher-dashboard/leave-requests" className="px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors flex items-start gap-3">
                  <div className="bg-amber-100 dark:bg-amber-500/20 p-2 rounded-full mt-1"><CalendarClock className="w-4 h-4 text-amber-600 dark:text-amber-400" /></div>
                  <div>
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Leave Status</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{teacherActions.pending_leaves} application(s) awaiting admin decision.</p>
                  </div>
                </Link>
              )}
            </>
          )}

          {/* ========================================== */}
          {/* 3. STUDENT UI */}
          {/* ========================================== */}
          {role === 'student' && (
            <>
              {studentActions.due_assignments > 0 && (
                <div className="px-4 py-3 border-b border-slate-50 dark:border-slate-700/60 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors flex items-start gap-3 cursor-pointer">
                  <div className="bg-blue-100 dark:bg-blue-500/20 p-2 rounded-full mt-1"><BookOpen className="w-4 h-4 text-blue-600 dark:text-blue-400" /></div>
                  <div>
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Homework Due</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">You have {studentActions.due_assignments} pending assignments.</p>
                  </div>
                </div>
              )}
              {realNotifications.map((n) => (
                <div
                  key={n.id}
                  onClick={() => !n.is_read && markNotificationRead(n.id)}
                  className={`px-4 py-3 border-b border-slate-50 dark:border-slate-700/60 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors flex items-start gap-3 cursor-pointer ${!n.is_read ? 'bg-emerald-50/40 dark:bg-emerald-500/10' : ''}`}
                >
                  <div className="bg-emerald-100 dark:bg-emerald-500/20 p-2 rounded-full mt-1"><GraduationCap className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /></div>
                  <div>
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{n.title}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{n.message}</p>
                  </div>
                </div>
              ))}
            </>
          )}

          {/* ========================================== */}
          {/* 4. PARENT UI */}
          {/* ========================================== */}
          {role === 'parent' && (
            <>
              {parentActions.fee_reminders > 0 && (
                <div className="px-4 py-3 border-b border-slate-50 dark:border-slate-700/60 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors flex items-start gap-3 cursor-pointer">
                  <div className="bg-red-100 dark:bg-red-500/20 p-2 rounded-full mt-1"><CreditCard className="w-4 h-4 text-red-600 dark:text-red-400" /></div>
                  <div>
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Fee Reminder</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">You have a pending fee balance.</p>
                  </div>
                </div>
              )}
              {realNotifications.map((n) => (
                <div
                  key={n.id}
                  onClick={() => !n.is_read && markNotificationRead(n.id)}
                  className={`px-4 py-3 border-b border-slate-50 dark:border-slate-700/60 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors flex items-start gap-3 cursor-pointer ${!n.is_read ? 'bg-emerald-50/40 dark:bg-emerald-500/10' : ''}`}
                >
                  <div className="bg-emerald-100 dark:bg-emerald-500/20 p-2 rounded-full mt-1"><GraduationCap className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /></div>
                  <div>
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{n.title}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{n.message}</p>
                  </div>
                </div>
              ))}
            </>
          )}

          {totalNotifications === 0 && (
            <div className="px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
              You are all caught up! No pending tasks.
            </div>
          )}

        </div>
      </div>
      )}
    </div>
  );
}