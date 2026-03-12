// ApprovalTable.tsx
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';

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

export default function ApprovalTable({ userType }: ApprovalTableProps) {
  const [users, setUsers] = useState<PendingUser[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Fetch users when the component loads or when userType changes
  useEffect(() => {
    const fetchPendingUsers = async () => {
      setLoading(true);
      try {
        const response = await fetch(`http://127.0.0.1:8000/api/pending-users/${userType}/`, {
          credentials: 'include'
        });
        const data = await response.json();
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
    try {
      const response = await fetch('http://127.0.0.1:8000/api/process-approval/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_type: userType, id, action })
      });
      const data = await response.json();
      
      if (data.status === 'success') {
        toast.success(`User successfully ${action}ed.`);
        // Instantly remove the user from the UI without reloading
        setUsers(users.filter(user => user.id !== id));
      } else {
        toast.error("Action failed: " + data.message);
      }
    } catch (error) {
      console.error(`Failed to ${action} user`, error);
    }
  };

  if (loading) return <div className="p-4 text-gray-500 animate-pulse">Loading {userType}...</div>;

  return (
    <div className="bg-white p-6 rounded-lg shadow-md border border-gray-100">
      <h2 className="text-xl font-semibold mb-4 capitalize">Pending {userType} Approvals</h2>
      
      {users.length === 0 ? (
        <div className="text-gray-500 py-4">No pending {userType} requiring approval at this time.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 text-gray-700 uppercase text-sm">
                <th className="py-3 px-4 border-b">Name</th>
                <th className="py-3 px-4 border-b">Username / ID</th>
                <th className="py-3 px-4 border-b">Email</th>
                
                {/* Dynamically show the 4th column based on role */}
                {userType === 'students' && <th className="py-3 px-4 border-b">Class</th>}
                {userType === 'teachers' && <th className="py-3 px-4 border-b">Subjects</th>}
                {userType === 'parents' && <th className="py-3 px-4 border-b">Linked Students</th>}

                <th className="py-3 px-4 border-b text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-gray-50 transition">
                  <td className="py-3 px-4 border-b font-medium text-gray-800">{user.name}</td>
                  <td className="py-3 px-4 border-b text-gray-600">{user.username}</td>
                  <td className="py-3 px-4 border-b text-gray-600">{user.email}</td>
                  
                  {/* Dynamically render the 4th column data */}
                  {userType === 'students' && <td className="py-3 px-4 border-b text-gray-600">{user.class || user.extra_info}</td>}
                  {userType === 'teachers' && <td className="py-3 px-4 border-b text-gray-600">{user.subjects || user.extra_info}</td>}
                  {userType === 'parents' && <td className="py-3 px-4 border-b text-gray-600">{user.children || user.extra_info}</td>}

                  {/* FIX: Replaced text-right and space-x-2 with a Flexbox container */}
                  <td className="py-3 px-4 border-b">
                    <div className="flex items-center justify-end gap-2">
                      <button 
                        onClick={() => handleAction(user.id, 'approve')}
                        className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded text-sm font-medium transition whitespace-nowrap"
                      >
                        Approve
                      </button>
                      <button 
                        onClick={() => handleAction(user.id, 'reject')}
                        className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded text-sm font-medium transition whitespace-nowrap"
                      >
                        Reject
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