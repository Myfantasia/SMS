import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Bell, UserPlus, Users, FileEdit, ClipboardCheck, BookOpen, CreditCard, CalendarClock, GraduationCap, ShieldAlert } from 'lucide-react';
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

  const [studentActions, setStudentActions] = useState<StudentActionItems>({
    due_assignments: 2, unread_notices: 1 // Default baseline states
  });

  const [parentActions, setParentActions] = useState<ParentActionItems>({
    fee_reminders: 1, attendance_alerts: 0
  });

  const [realNotifications, setRealNotifications] = useState<RealNotification[]>([]);

  useEffect(() => {
    if (role === 'admin') {
      api.get('/api/pending-approvals/')
        .then((res) => setPendingData(res.data))
        .catch((err) => console.error("Failed to fetch pending approvals", err));

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
        .then((res) => setRealNotifications(res.data))
        .catch((err) => console.error("Failed to fetch notifications", err));
    }
  }, [role]);

  const markNotificationRead = (id: number) => {
    setRealNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    api.patch(`/api/core/notifications/${id}/`, { is_read: true })
      .catch((err) => console.error("Failed to mark notification as read", err));
  };

  const unreadRealNotifications = realNotifications.filter(n => !n.is_read).length;

  // Calculate the total notifications based dynamically on the role
  let totalNotifications = 0;
  if (role === 'admin') totalNotifications = pendingData.total_pending;
  if (role === 'teacher') totalNotifications = teacherActions.pending_assignments + teacherActions.pending_exams + teacherActions.pending_leaves;
  if (role === 'student') totalNotifications = studentActions.due_assignments + unreadRealNotifications;
  if (role === 'parent') totalNotifications = parentActions.fee_reminders + unreadRealNotifications;

  return (
    <div className="group relative flex items-center justify-center">
      
      {/* Bell Icon Container */}
      <div className="bg-slate-100 hover:bg-slate-200 transition-colors rounded-full w-9 h-9 flex items-center justify-center cursor-pointer relative z-10">
        <Bell className="w-4 h-4 text-slate-600" />
        
        {/* Notification Badge */}
        {totalNotifications > 0 && (
          <div className="absolute -top-1 -right-1 w-5 h-5 flex items-center justify-center bg-red-500 text-white rounded-full text-[10px] font-bold border-2 border-white shadow-sm animate-pulse opacity-100">
            {totalNotifications}
          </div>
        )}
      </div>

      <div className="absolute top-9 right-0 w-24 h-4 bg-transparent z-0"></div>

      {/* Notification Alert Panel */}
      <div className="absolute top-12 right-0 w-72 bg-white border border-slate-200 shadow-xl rounded-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-300 flex flex-col z-50 overflow-hidden">
        <div className="bg-slate-50 px-4 py-3 border-b border-slate-100 flex justify-between items-center">
          <span className="font-bold text-slate-700 text-sm">Action Required</span>
        </div>
        
        <div className="flex flex-col">
          
          {/* ========================================== */}
          {/* 1. ADMIN PANEL VIEW COLLECTION */}
          {/* ========================================== */}
          {role === 'admin' && (
            <>
              {/* ✅ NEW: Timetable Warning Alert Card Dropdown */}
              {pendingData.timetable_warnings > 0 && (
                <Link to="/admin-dashboard/timetable" className="px-4 py-3 border-b border-rose-100 bg-rose-50/30 hover:bg-rose-50 transition-colors flex items-start gap-3">
                  <div className="bg-rose-100 p-2 rounded-full mt-1">
                    <FileEdit className="w-4 h-4 text-rose-600" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-rose-900">Timetable Clashes</p>
                    <p className="text-xs text-rose-600">{pendingData.timetable_warnings} lessons sitting in Unscheduled Basket.</p>
                  </div>
                </Link>
              )}

              {pendingData.pending_teachers > 0 && (
                <Link to="/admin-dashboard/approvals/teachers" className="px-4 py-3 border-b border-slate-50 hover:bg-slate-50 transition-colors flex items-start gap-3">
                  <div className="bg-blue-100 p-2 rounded-full mt-1"><UserPlus className="w-4 h-4 text-blue-600" /></div>
                  <div>
                    <p className="text-sm font-semibold text-slate-700">Teacher Approvals</p>
                    <p className="text-xs text-slate-500">{pendingData.pending_teachers} new teachers waiting.</p>
                  </div>
                </Link>
              )}
              {pendingData.pending_students > 0 && (
                <Link to="/admin-dashboard/approvals/students" className="px-4 py-3 border-b border-slate-50 hover:bg-slate-50 transition-colors flex items-start gap-3">
                  <div className="bg-emerald-100 p-2 rounded-full mt-1"><UserPlus className="w-4 h-4 text-emerald-600" /></div>
                  <div>
                    <p className="text-sm font-semibold text-slate-700">Student Approvals</p>
                    <p className="text-xs text-slate-500">{pendingData.pending_students} new students waiting.</p>
                  </div>
                </Link>
              )}
              {pendingData.pending_parents > 0 && (
                <Link to="/admin-dashboard/approvals/parents" className="px-4 py-3 border-b border-slate-50 hover:bg-slate-50 transition-colors flex items-start gap-3">
                  <div className="bg-purple-100 p-2 rounded-full mt-1"><Users className="w-4 h-4 text-purple-600" /></div>
                  <div>
                    <p className="text-sm font-semibold text-slate-700">Parent Approvals</p>
                    <p className="text-xs text-slate-500">{pendingData.pending_parents} accounts waiting.</p>
                  </div>
                </Link>
              )}
              {pendingData.pending_admins > 0 && (
                <Link to="/admin-dashboard/approvals/admins" className="px-4 py-3 border-b border-slate-50 hover:bg-slate-50 transition-colors flex items-start gap-3">
                  <div className="bg-rose-100 p-2 rounded-full mt-1"><ShieldAlert className="w-4 h-4 text-rose-600" /></div>
                  <div>
                    <p className="text-sm font-semibold text-slate-700">Admin Approvals</p>
                    <p className="text-xs text-slate-500">{pendingData.pending_admins} new admins waiting for review.</p>
                  </div>
                </Link>
              )}
              {pendingData.pending_leaves > 0 && (
                <Link to="/admin-dashboard/approvals/leave" className="px-4 py-3 hover:bg-slate-50 transition-colors flex items-start gap-3">
                  <div className="bg-amber-100 p-2 rounded-full mt-1"><CalendarClock className="w-4 h-4 text-amber-600" /></div>
                  <div>
                    <p className="text-sm font-semibold text-slate-700">Leave Approvals</p>
                    <p className="text-xs text-slate-500">{pendingData.pending_leaves} requests awaiting your decision.</p>
                  </div>
                </Link>
              )}
            </>
          )}

          {/* ========================================== */}
          {/* 2. TEACHER UI */}
          {/* ========================================== */}
          {role === 'teacher' && (
            <>
              {teacherActions.pending_assignments > 0 && (
                <Link to="/teacher-dashboard/assignments" className="px-4 py-3 border-b border-slate-50 hover:bg-slate-50 transition-colors flex items-start gap-3">
                  <div className="bg-amber-100 p-2 rounded-full mt-1"><FileEdit className="w-4 h-4 text-amber-600" /></div>
                  <div>
                    <p className="text-sm font-semibold text-slate-700">Ungraded Assignments</p>
                    <p className="text-xs text-slate-500">{teacherActions.pending_assignments} submissions need marking.</p>
                  </div>
                </Link>
              )}
              {teacherActions.pending_exams > 0 && (
                <Link to="/teacher-dashboard/exams" className="px-4 py-3 border-b border-slate-50 hover:bg-slate-50 transition-colors flex items-start gap-3">
                  <div className="bg-rose-100 p-2 rounded-full mt-1"><ClipboardCheck className="w-4 h-4 text-rose-600" /></div>
                  <div>
                    <p className="text-sm font-semibold text-slate-700">Draft Exams</p>
                    <p className="text-xs text-slate-500">{teacherActions.pending_exams} exams awaiting finalization.</p>
                  </div>
                </Link>
              )}
              {teacherActions.pending_leaves > 0 && (
                <Link to="/teacher-dashboard/leave-requests" className="px-4 py-3 hover:bg-slate-50 transition-colors flex items-start gap-3">
                  <div className="bg-amber-100 p-2 rounded-full mt-1"><CalendarClock className="w-4 h-4 text-amber-600" /></div>
                  <div>
                    <p className="text-sm font-semibold text-slate-700">Leave Status</p>
                    <p className="text-xs text-slate-500">{teacherActions.pending_leaves} application(s) awaiting admin decision.</p>
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
                <div className="px-4 py-3 border-b border-slate-50 hover:bg-slate-50 transition-colors flex items-start gap-3 cursor-pointer">
                  <div className="bg-blue-100 p-2 rounded-full mt-1"><BookOpen className="w-4 h-4 text-blue-600" /></div>
                  <div>
                    <p className="text-sm font-semibold text-slate-700">Homework Due</p>
                    <p className="text-xs text-slate-500">You have {studentActions.due_assignments} pending assignments.</p>
                  </div>
                </div>
              )}
              {realNotifications.map((n) => (
                <div
                  key={n.id}
                  onClick={() => !n.is_read && markNotificationRead(n.id)}
                  className={`px-4 py-3 border-b border-slate-50 hover:bg-slate-50 transition-colors flex items-start gap-3 cursor-pointer ${!n.is_read ? 'bg-emerald-50/40' : ''}`}
                >
                  <div className="bg-emerald-100 p-2 rounded-full mt-1"><GraduationCap className="w-4 h-4 text-emerald-600" /></div>
                  <div>
                    <p className="text-sm font-semibold text-slate-700">{n.title}</p>
                    <p className="text-xs text-slate-500">{n.message}</p>
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
                <div className="px-4 py-3 border-b border-slate-50 hover:bg-slate-50 transition-colors flex items-start gap-3 cursor-pointer">
                  <div className="bg-red-100 p-2 rounded-full mt-1"><CreditCard className="w-4 h-4 text-red-600" /></div>
                  <div>
                    <p className="text-sm font-semibold text-slate-700">Fee Reminder</p>
                    <p className="text-xs text-slate-500">You have a pending fee balance.</p>
                  </div>
                </div>
              )}
              {realNotifications.map((n) => (
                <div
                  key={n.id}
                  onClick={() => !n.is_read && markNotificationRead(n.id)}
                  className={`px-4 py-3 border-b border-slate-50 hover:bg-slate-50 transition-colors flex items-start gap-3 cursor-pointer ${!n.is_read ? 'bg-emerald-50/40' : ''}`}
                >
                  <div className="bg-emerald-100 p-2 rounded-full mt-1"><GraduationCap className="w-4 h-4 text-emerald-600" /></div>
                  <div>
                    <p className="text-sm font-semibold text-slate-700">{n.title}</p>
                    <p className="text-xs text-slate-500">{n.message}</p>
                  </div>
                </div>
              ))}
            </>
          )}

          {totalNotifications === 0 && (
            <div className="px-4 py-6 text-center text-sm text-slate-500">
              You are all caught up! No pending tasks.
            </div>
          )}

        </div>
      </div>
    </div>
  );
}