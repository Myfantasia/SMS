import { useParams, Navigate } from 'react-router-dom';
import { GraduationCap, Users, UserSquare2 } from 'lucide-react';
import ApprovalTable from '../../components/ApprovalTable';

const TYPE_META = {
  teachers: { icon: GraduationCap, color: 'text-purple-600 bg-purple-50' },
  students: { icon: Users, color: 'text-blue-600 bg-blue-50' },
  parents: { icon: UserSquare2, color: 'text-emerald-600 bg-emerald-50' },
} as const;

export default function PendingApprovals() {
  // Extract the specific user category from the browser URL
  const { userType } = useParams<{ userType: string }>();

  // Validate the URL parameter to prevent errors
  const validTypes = ['students', 'teachers', 'parents'] as const;
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
          <h1 className="text-2xl font-extrabold text-slate-800 capitalize">{userType} Approvals</h1>
          <p className="text-slate-500 text-sm mt-0.5">Review and manage new account registrations.</p>
        </div>
      </div>

      <ApprovalTable userType={userType as 'students' | 'teachers' | 'parents'} />
    </div>
  );
}
