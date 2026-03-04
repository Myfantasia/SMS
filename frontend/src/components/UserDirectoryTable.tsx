import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, Edit, Trash2, AlertTriangle, X } from 'lucide-react'; // Added AlertTriangle and X

interface DirectoryUser {
  id: number;
  name: string;
  username: string;
  email: string;
  // Dynamic fields
  class?: string;
  subjects?: string;
  children?: string;
}

interface UserDirectoryTableProps {
  userType: 'students' | 'teachers' | 'parents';
}

export default function UserDirectoryTable({ userType }: UserDirectoryTableProps) {
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // --- NEW: MODAL STATE ---
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<{ id: number, name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const fetchUsers = async () => {
      setLoading(true);
      try {
        const response = await fetch(`http://127.0.0.1:8000/api/approved-users/${userType}/`);
        const data = await response.json();
        if (data.status === 'success') {
          setUsers(data.data);
        }
      } catch (error) {
        console.error("Failed to fetch users", error);
      }
      setLoading(false);
    };

    fetchUsers();
  }, [userType]);

  // --- NEW: OPENS THE MODAL ---
  const confirmDelete = (id: number, name: string) => {
    setUserToDelete({ id, name });
    setIsModalOpen(true);
  };

  // --- REPLACED handleDelete WITH THIS ---
  const executeDelete = async () => {
    if (!userToDelete) return;
    setIsDeleting(true);

    try {
      const response = await fetch('http://127.0.0.1:8000/api/delete-user/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_type: userType, id: userToDelete.id })
      });
      const data = await response.json();
      
      if (data.status === 'success') {
        // Remove from UI
        setUsers(users.filter(user => user.id !== userToDelete.id));
        // Close modal
        setIsModalOpen(false);
      } else {
        alert("Deletion failed: " + data.message);
      }
    } catch (error) {
      console.error("Failed to delete user", error);
    }
    
    setIsDeleting(false);
    setUserToDelete(null);
  };

  if (loading) return <div className="p-4 text-gray-500 animate-pulse">Loading {userType} directory...</div>;

  return (
    <div className="bg-white p-6 rounded-lg shadow-md border border-gray-100 relative">
      <h2 className="text-xl font-semibold mb-4 capitalize">Active {userType}</h2>
      
      {users.length === 0 ? (
        <div className="text-gray-500 py-4">No active {userType} found.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 text-gray-700 uppercase text-xs tracking-wider">
                <th className="py-3 px-4 border-b">Name</th>
                <th className="py-3 px-4 border-b">Username / ID</th>
                <th className="py-3 px-4 border-b">Email Address</th>
                
                {/* Dynamic Column Header based on Role */}
                {userType === 'students' && <th className="py-3 px-4 border-b">Class</th>}
                {userType === 'teachers' && <th className="py-3 px-4 border-b">Subjects Taught</th>}
                {userType === 'parents' && <th className="py-3 px-4 border-b">Linked Students</th>}

                <th className="py-3 px-4 border-b text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-gray-50 transition group">
                  <td className="py-3 px-4 border-b font-medium text-gray-800">{user.name}</td>
                  <td className="py-3 px-4 border-b text-gray-600">{user.username}</td>
                  <td className="py-3 px-4 border-b text-gray-600">{user.email}</td>
                  
                  {/* Dynamic Column Data based on Role */}
                  {userType === 'students' && <td className="py-3 px-4 border-b text-gray-600">{user.class}</td>}
                  {userType === 'teachers' && <td className="py-3 px-4 border-b text-gray-600">{user.subjects}</td>}
                  {userType === 'parents' && <td className="py-3 px-4 border-b text-gray-600">{user.children}</td>}

                  <td className="py-3 px-4 border-b text-right">
                    <div className="flex justify-end gap-3 opacity-80 group-hover:opacity-100 transition">
                      <Link to={`/admin-dashboard/${userType}/view/${user.id}`} title="View Profile" className="text-blue-500 hover:text-blue-700">
                        <Eye className="w-5 h-5" />
                      </Link>
                      <Link to={`/admin-dashboard/${userType}/edit/${user.id}`} title="Edit" className="text-amber-500 hover:text-amber-700">
                        <Edit className="w-5 h-5" />
                      </Link>
                      {/* UPDATED: Now triggers the modal instead of window.confirm */}
                      <button onClick={() => confirmDelete(user.id, user.name)} title="Delete" className="text-red-500 hover:text-red-700">
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* --- CUSTOM CONFIRMATION MODAL --- */}
      {isModalOpen && userToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
            
            {/* Modal Header */}
            <div className="bg-red-50 p-4 border-b border-red-100 flex items-center justify-between">
              <div className="flex items-center gap-2 text-red-600 font-bold">
                <AlertTriangle className="w-5 h-5" />
                Confirm Deletion
              </div>
              <button onClick={() => setIsModalOpen(false)} title="Close" className="text-red-400 hover:text-red-700 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 text-gray-700">
              <p className="mb-2">Are you absolutely sure you want to permanently delete <strong>{userToDelete.name}</strong>?</p>
              <p className="text-sm text-gray-500 bg-gray-50 p-3 rounded border border-gray-100">
                This action will erase their account, login credentials, and all related profile data from the PostgreSQL database. <strong>This cannot be undone.</strong>
              </p>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 bg-gray-50 flex justify-end gap-3 border-t border-gray-100">
              <button 
                onClick={() => setIsModalOpen(false)}
                disabled={isDeleting}
                className="px-4 py-2 text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors font-medium"
              >
                Cancel
              </button>
              <button 
                onClick={executeDelete}
                disabled={isDeleting}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium flex items-center gap-2"
              >
                {isDeleting ? 'Deleting...' : 'Yes, Delete Permanently'}
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}