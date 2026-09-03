import { useState } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { GraduationCap, Users, UserSquare2, ShieldAlert, Briefcase } from 'lucide-react';
import ApprovalTable from '../../components/ApprovalTable';
import AdminInvitesPanel from '../../components/admin/AdminInvitesPanel';

const TYPE_META = {
  teachers: { icon: GraduationCap, color: 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-500/10' },
  students: { icon: Users, color: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10' },
  parents: { icon: UserSquare2, color: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10' },
  admins: { icon: ShieldAlert, color: 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10' },
  staff: { icon: Briefcase, color: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10' },
} as const;

type AdminTab = 'applications' | 'invites';

export default function PendingApprovals() {
  // Extract the specific user category from the browser URL
  const { userType } = useParams<{ userType: string }>();
  const [adminTab, setAdminTab] = useState<AdminTab>('applications');

  // Validate the URL parameter to prevent errors
  const validTypes = ['students', 'teachers', 'parents', 'admins', 'staff'] as const;
  if (!userType || !validTypes.includes(userType as typeof validTypes[number])) {
    return <Navigate to="/admin-dashboard" replace />;
  }

  const meta = TYPE_META[userType as keyof typeof TYPE_META];
  const Icon = meta.icon;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className={`p-3 rounded-2xl ${meta.color}`}>
          <Icon className="w-7 h-7" strokeWidth={2.5} />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800 dark:text-slate-100 capitalize">{userType} Approvals</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-0.5">Review and manage new account registrations.</p>
        </div>
      </div>

      {userType === 'admins' && (
        <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 rounded-xl p-1 w-max">
          <button
            onClick={() => setAdminTab('applications')}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${
              adminTab === 'applications' ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 shadow-sm dark:shadow-none' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            Pending Applications
          </button>
          <button
            onClick={() => setAdminTab('invites')}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${
              adminTab === 'invites' ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 shadow-sm dark:shadow-none' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            Invite Codes &amp; Verification
          </button>
        </div>
      )}

      {userType === 'admins' && adminTab === 'invites' ? (
        <AdminInvitesPanel />
      ) : (
        <ApprovalTable userType={userType as 'students' | 'teachers' | 'parents' | 'admins' | 'staff'} />
      )}
    </div>
  );
}
