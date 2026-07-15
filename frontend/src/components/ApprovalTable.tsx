// ApprovalTable.tsx
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { CheckCircle2, XCircle, UserPlus } from 'lucide-react';
import api from '../libs/axiosInstance';

// Updated to include the new backend fields
interface PendingUser {
  id: number;
  name: string;
  username: string;
  email: string;
  // Dynamic fields that change based on user type
  class?: string;
  subjects?: string;
  children?: string;
  // Kept extra_info as a fallback just in case
  extra_info?: string;
}

interface ApprovalTableProps {
  userType: 'students' | 'teachers' | 'parents';
}

const AVATAR_COLOR: Record<ApprovalTableProps['userType'], string> = {
  teachers: 'bg-purple-100 text-purple-700',
  students: 'bg-blue-100 text-blue-700',
  parents: 'bg-emerald-100 text-emerald-700',
};

export default function ApprovalTable({ userType }: ApprovalTableProps) {
  const [users, setUsers] = useState<PendingUser[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [busyId, setBusyId] = useState<number | null>(null);

  useEffect(() => {
    const fetchPendingUsers = async () => {
      setLoading(true);
      try {
        const response = await api.get(`/api/pending-users/${userType}/`);
        const data = response.data;

        if (data.status === 'success') {
          setUsers(data.data);
        }
      } catch (error) {
        console.error("Failed to fetch pending users", error);
      }
      setLoading(false);
    };

    fetchPendingUsers();
  }, [userType]);

  const handleAction = async (id: number, action: 'approve' | 'reject') => {
    setBusyId(id);
    try {
      const response = await api.post('/api/process-approval/', {
        user_type: userType,
        id,
        action
      });

      const data = response.data;

      if (data.status === 'success') {
        toast.success(`User successfully ${action}ed.`);
        setUsers(users.filter(user => user.id !== id));
      } else {
        toast.error("Action failed: " + data.message);
      }
    } catch (error: any) {
      console.error(`Failed to ${action} user`, error);
      const errMsg = error.response?.data?.message || `Failed to complete action. Ensure you are signed in as an administrator.`;
      toast.error(errMsg);
    } finally {
      setBusyId(null);
    }
  };

  const secondaryColumnLabel = userType === 'students' ? 'Class' : userType === 'teachers' ? 'Subjects' : 'Linked Students';

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 animate-pulse space-y-4">
        <div className="h-8 w-56 bg-slate-200 rounded-lg"></div>
        {[1, 2, 3].map((i) => <div key={i} className="h-14 bg-slate-100 rounded-xl"></div>)}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="p-5 border-b border-slate-100 flex items-center gap-2">
        <h2 className="text-base font-bold text-slate-800 capitalize">Pending {userType}</h2>
        <span className="bg-amber-100 text-amber-700 text-xs font-bold px-2.5 py-1 rounded-full">{users.length}</span>
      </div>

      {users.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-3">
          <UserPlus className="w-12 h-12 text-slate-300" />
          <p className="text-sm font-medium">No pending {userType} requiring approval at this time.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-400 uppercase text-[11px] tracking-wider">
                <th className="py-3 px-5 font-bold">Name</th>
                <th className="py-3 px-5 font-bold">Username / ID</th>
                <th className="py-3 px-5 font-bold">Email</th>
                <th className="py-3 px-5 font-bold">{secondaryColumnLabel}</th>
                <th className="py-3 px-5 font-bold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-slate-50/70 transition-colors">
                  <td className="py-3 px-5">
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${AVATAR_COLOR[userType]}`}>
                        {user.name.charAt(0).toUpperCase()}
                      </div>
                      <span className="font-semibold text-slate-800">{user.name}</span>
                    </div>
                  </td>
                  <td className="py-3 px-5 text-slate-500">{user.username}</td>
                  <td className="py-3 px-5 text-slate-500">{user.email}</td>
                  <td className="py-3 px-5 text-slate-500 text-sm">
                    {userType === 'students' && (user.class || user.extra_info || <span className="text-slate-300 italic">N/A</span>)}
                    {userType === 'teachers' && (user.subjects || user.extra_info || <span className="text-slate-300 italic">None listed</span>)}
                    {userType === 'parents' && (user.children || user.extra_info || <span className="text-slate-300 italic">No children linked</span>)}
                  </td>
                  <td className="py-3 px-5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        disabled={busyId === user.id}
                        onClick={() => handleAction(user.id, 'approve')}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-xs font-bold transition-colors disabled:opacity-60 whitespace-nowrap"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" /> Approve
                      </button>
                      <button
                        disabled={busyId === user.id}
                        onClick={() => handleAction(user.id, 'reject')}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 rounded-lg text-xs font-bold transition-colors disabled:opacity-60 whitespace-nowrap"
                      >
                        <XCircle className="w-3.5 h-3.5" /> Reject
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
