import { useEffect, useState } from 'react';
import { User, Mail, ShieldAlert, KeyRound, CheckCircle2 } from 'lucide-react';

export default function AdminProfile() {
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  
  // Added currentPassword state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  useEffect(() => {
    fetch('http://localhost:8000/api/my-profile/', { credentials: 'include' })
      .then(res => res.json())
      .then(data => {
        if (data.status === 'success') {
          setProfile(data.data);
        } else {
          console.error("Profile fetch error:", data.message);
        }
      })
      .catch(err => console.error("Error fetching profile", err))
      .finally(() => setLoading(false));
  }, []);

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (newPassword !== confirmPassword) {
      setMessage({ type: 'error', text: 'New passwords do not match!' });
      return;
    }

    setSaving(true);
    setMessage({ type: '', text: '' });

    try {
      const response = await fetch('http://localhost:8000/api/my-profile/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        // Send BOTH the current password and the new password to Django
        body: JSON.stringify({ 
          current_password: currentPassword, 
          new_password: newPassword 
        })
      });
      const data = await response.json();
      
      if (data.status === 'success') {
        alert('Password successfully updated! You can now use it on your next login.');
        setMessage({ type: 'success', text: 'Password successfully updated! You can now use it on your next login.' });
        // Clear all fields on success
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        setMessage({ type: 'error', text: data.message });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'An error occurred while updating the password.' });
    }
    setSaving(false);
  };

  if (loading) return <div className="p-6 text-gray-500 animate-pulse">Loading your profile...</div>;
  if (!profile) return <div className="p-6 text-red-500">Failed to load profile data. Make sure you are logged in.</div>;

  const displayInitial = profile.first_name ? profile.first_name.charAt(0) : (profile.username ? profile.username.charAt(0) : 'U');

  return (
    <div className="p-6 max-w-4xl space-y-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-800">My Profile</h1>
        <p className="text-gray-500 mt-1">Manage your account settings and update your password.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* Profile Info Card */}
        <div className="md:col-span-1 bg-white rounded-xl shadow-md border border-gray-100 p-6 flex flex-col items-center text-center">
          <div className="w-24 h-24 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-4xl font-bold uppercase mb-4 shadow-inner">
            {displayInitial}
          </div>
          <h2 className="text-xl font-bold text-gray-800">
            {profile.first_name || profile.username} {profile.last_name}
          </h2>
          <span className="bg-blue-50 text-blue-600 text-xs font-bold px-3 py-1 rounded-full mt-2 uppercase tracking-wide">
            {profile.role}
          </span>
          
          <div className="w-full mt-8 space-y-4 text-left border-t border-gray-50 pt-6">
            <div className="flex items-center gap-3 text-gray-600">
              <User className="w-4 h-4 text-gray-400" />
              <div className="text-sm">
                <p className="text-xs text-gray-400 uppercase font-semibold">Username</p>
                <p className="font-medium text-gray-800">{profile.username}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 text-gray-600">
              <Mail className="w-4 h-4 text-gray-400" />
              <div className="text-sm">
                <p className="text-xs text-gray-400 uppercase font-semibold">Email</p>
                <p className="font-medium text-gray-800">{profile.email || "No email provided"}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Change Password Card */}
        <div className="md:col-span-2 bg-white rounded-xl shadow-md border border-gray-100 p-6">
          <div className="flex items-center gap-2 mb-6 border-b border-gray-50 pb-4">
            <ShieldAlert className="w-5 h-5 text-gray-400" />
            <h3 className="text-lg font-bold text-gray-800">Security Details</h3>
          </div>

          <form onSubmit={handlePasswordChange} className="space-y-5 max-w-md">
            
            {/* NEW: Current Password Field */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Current Password</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <KeyRound className="w-4 h-4 text-gray-400" />
                </div>
                <input 
                  type="password" 
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="pl-10 w-full p-2.5 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500" 
                  placeholder="Enter current password"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <KeyRound className="w-4 h-4 text-gray-400" />
                </div>
                <input 
                  type="password" 
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="pl-10 w-full p-2.5 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500" 
                  placeholder="Enter new password"
                  required
                  minLength={6}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Confirm New Password</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <CheckCircle2 className="w-4 h-4 text-gray-400" />
                </div>
                <input 
                  type="password" 
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="pl-10 w-full p-2.5 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500" 
                  placeholder="Confirm new password"
                  required
                />
              </div>
            </div>

            {message.text && (
              <div className={`p-3 rounded-md text-sm ${message.type === 'error' ? 'bg-red-50 text-red-600 border border-red-100' : 'bg-green-50 text-green-700 border border-green-100'}`}>
                {message.text}
              </div>
            )}

            <button 
              type="submit" 
              disabled={saving}
              className="w-full bg-slate-800 hover:bg-slate-900 text-white font-medium py-2.5 px-4 rounded-lg transition-colors disabled:bg-slate-400"
            >
              {saving ? 'Updating Password...' : 'Update Password'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}