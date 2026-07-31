import { useEffect, useState } from 'react';
import { User, Mail, ShieldAlert, KeyRound, CheckCircle2, Copy, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../libs/axiosInstance';
import SearchableSelect, { SearchableSelectOption } from '../../components/common/SearchableSelect';
import PasswordInput from '../../components/common/PasswordInput';

const RESETTABLE_USER_TYPES: { value: string; label: string }[] = [
  { value: 'students', label: 'Student' },
  { value: 'teachers', label: 'Teacher' },
  { value: 'parents', label: 'Parent' },
  { value: 'staff', label: 'Staff' },
];

export default function AdminProfile() {
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  // Reset-someone-else's-password: admin-only, and deliberately can't target another
  // admin — that account can only ever be changed via its own owner's "My Profile".
  const [resetUserType, setResetUserType] = useState('students');
  const [resetUserId, setResetUserId] = useState('');
  const [userOptions, setUserOptions] = useState<SearchableSelectOption[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [passwordReveal, setPasswordReveal] = useState<{ username: string; newPassword: string; emailNotified: boolean } | null>(null);

  // Load account overview metadata from server sessions safely
  useEffect(() => {
    api.get('/api/my-profile/')
      .then(res => {
        const data = res.data;
        if (data.status === 'success') {
          setProfile(data.data);
        } else {
          console.error("Profile fetch error:", data.message);
        }
      })
      .catch(err => console.error("Error fetching profile", err))
      .finally(() => setLoading(false));
  }, []);

  // Refetch the picker's options whenever the target user-type changes; reset the
  // previously chosen user since it belonged to the old list.
  useEffect(() => {
    let cancelled = false;
    const loadUsers = async () => {
      setLoadingUsers(true);
      setResetUserId('');
      try {
        const res = await api.get(`/api/approved-users/${resetUserType}/`);
        if (cancelled) return;
        const list = Array.isArray(res.data?.data) ? res.data.data : [];
        setUserOptions(list.map((u: { id: number; name: string; username: string }) => ({
          value: String(u.id),
          label: u.name,
          sublabel: u.username,
        })));
      } catch (err) {
        console.error('Error fetching users to reset', err);
      } finally {
        if (!cancelled) setLoadingUsers(false);
      }
    };
    loadUsers();
    return () => { cancelled = true; };
  }, [resetUserType]);

  const handleResetUserPassword = async () => {
    if (!resetUserId) return;
    const target = userOptions.find(o => o.value === resetUserId);
    if (!window.confirm(`Reset ${target?.label || 'this user'}'s password? Their current password will stop working immediately.`)) {
      return;
    }
    setResetting(true);
    try {
      const response = await api.post('/api/admin/reset-user-password/', { user_type: resetUserType, id: resetUserId });
      const data = response.data;
      if (data.status === 'success') {
        toast.success('Password reset successfully.');
        setPasswordReveal({ username: data.username, newPassword: data.new_password, emailNotified: data.email_notified });
        setResetUserId('');
      } else {
        toast.error(data.message || 'Failed to reset password.');
      }
    } catch (error: any) {
      console.error('Failed to reset password', error);
      toast.error(error.response?.data?.message || 'Failed to reset password.');
    }
    setResetting(false);
  };

  const copyResetPassword = () => {
    if (!passwordReveal) return;
    navigator.clipboard?.writeText(passwordReveal.newPassword);
    toast.success('Password copied to clipboard.');
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (newPassword !== confirmPassword) {
      setMessage({ type: 'error', text: 'New passwords do not match!' });
      return;
    }

    setSaving(true);
    setMessage({ type: '', text: '' });

    try {
      // Swapped out native fetch for structural Axios post routing
      const response = await api.post('/api/my-profile/', { 
        current_password: currentPassword, 
        new_password: newPassword 
      });
      
      const data = response.data;
      
      if (data.status === 'success') {
        setMessage({ type: 'success', text: 'Password successfully updated! You can now use it on your next login.' });
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        setMessage({ type: 'error', text: data.message });
      }
    } catch (error: any) {
      console.error("Error updating password:", error);
      const errorPayload = error.response?.data?.message || 'An error occurred while updating the password.';
      setMessage({ type: 'error', text: errorPayload });
    }
    setSaving(false);
  };

  if (loading) return <div className="p-6 text-slate-500 animate-pulse">Loading your profile...</div>;
  if (!profile) return <div className="p-6 text-red-500">Failed to load profile data. Make sure you are logged in.</div>;

  const displayInitial = profile.first_name ? profile.first_name.charAt(0) : (profile.username ? profile.username.charAt(0) : 'U');

  return (
    <div className="max-w-4xl space-y-6">
      <div className="mb-6 flex items-center gap-4">
        <div className="p-3 rounded-2xl text-blue-600 bg-blue-50">
          <User className="w-7 h-7" strokeWidth={2.5} />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">My Profile</h1>
          <p className="text-slate-500 text-sm mt-0.5">Manage your account settings and update your password.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* Profile Info Card */}
        <div className="md:col-span-1 bg-white rounded-2xl shadow-sm border border-slate-100 p-6 flex flex-col items-center text-center">
          <div className="w-24 h-24 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-4xl font-bold uppercase mb-4 shadow-inner">
            {displayInitial}
          </div>
          <h2 className="text-xl font-bold text-slate-800">
            {profile.first_name || profile.username} {profile.last_name}
          </h2>
          <span className="bg-blue-50 text-blue-600 text-xs font-bold px-3 py-1 rounded-full mt-2 uppercase tracking-wide">
            {profile.role}
          </span>
          
          <div className="w-full mt-8 space-y-4 text-left border-t border-slate-50 pt-6">
            <div className="flex items-center gap-3 text-slate-600">
              <User className="w-4 h-4 text-slate-400" />
              <div className="text-sm">
                <p className="text-xs text-slate-400 uppercase font-semibold">Username</p>
                <p className="font-medium text-slate-800">{profile.username}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 text-slate-600">
              <Mail className="w-4 h-4 text-slate-400" />
              <div className="text-sm">
                <p className="text-xs text-slate-400 uppercase font-semibold">Email</p>
                <p className="font-medium text-slate-800">{profile.email || "No email provided"}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Change Password Card */}
        <div className="md:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <div className="flex items-center gap-2 mb-6 border-b border-slate-50 pb-4">
            <ShieldAlert className="w-5 h-5 text-slate-400" />
            <h3 className="text-lg font-bold text-slate-800">Security Details</h3>
          </div>

          <form onSubmit={handlePasswordChange} className="space-y-5 max-w-md">
            
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Current Password</label>
              <PasswordInput
                icon={KeyRound}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="pl-10 w-full p-2.5 border border-slate-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                placeholder="Enter current password"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">New Password</label>
              <PasswordInput
                icon={KeyRound}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="pl-10 w-full p-2.5 border border-slate-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                placeholder="Enter new password"
                required
                minLength={8}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Confirm New Password</label>
              <PasswordInput
                icon={CheckCircle2}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="pl-10 w-full p-2.5 border border-slate-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                placeholder="Confirm new password"
                required
              />
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

      {/* Reset Another User's Password — admin-only, and deliberately can't target
          another admin account (that one can only ever change its own password). */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
        <div className="flex items-center gap-2 mb-6 border-b border-slate-50 pb-4">
          <Users className="w-5 h-5 text-slate-400" />
          <div>
            <h3 className="text-lg font-bold text-slate-800">Reset a User's Password</h3>
            <p className="text-xs text-slate-400 mt-0.5">Applies to students, teachers, parents and staff. Admin accounts can only reset their own password.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl items-end">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">User Type</label>
            <select
              value={resetUserType}
              onChange={(e) => setResetUserType(e.target.value)}
              className="w-full p-2.5 border border-slate-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-sm bg-white"
            >
              {RESETTABLE_USER_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-1">Select User</label>
            <SearchableSelect
              options={userOptions}
              value={resetUserId}
              onChange={setResetUserId}
              placeholder={loadingUsers ? 'Loading…' : 'Search by name or username…'}
              searchPlaceholder="Type a name or username…"
              emptyMessage="No matches found."
              disabled={loadingUsers}
            />
          </div>
        </div>

        <button
          onClick={handleResetUserPassword}
          disabled={!resetUserId || resetting}
          className="mt-4 flex items-center gap-2 px-4 py-2.5 bg-amber-50 text-amber-700 text-sm font-semibold rounded-lg hover:bg-amber-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <KeyRound className="w-4 h-4" /> {resetting ? 'Resetting…' : 'Reset Password'}
        </button>
      </div>

      {passwordReveal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 text-center">
            <div className="w-14 h-14 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-4">
              <KeyRound className="w-7 h-7" />
            </div>
            <h3 className="text-lg font-bold text-slate-800 mb-1">Password Reset</h3>
            <p className="text-sm text-slate-500 mb-5">
              This is shown only once. Relay it to <span className="font-semibold text-slate-700">{passwordReveal.username}</span> out-of-band — they'll be required to set their own new password immediately after logging in with it.
            </p>
            <div className="flex items-center justify-center gap-2 bg-slate-50 border border-slate-200 rounded-xl py-4 mb-5">
              <span className="text-xl font-extrabold tracking-wide text-slate-800 break-all">{passwordReveal.newPassword}</span>
              <button onClick={copyResetPassword} className="p-2 rounded-lg hover:bg-slate-200 transition-colors shrink-0" title="Copy password">
                <Copy className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            {passwordReveal.emailNotified && (
              <p className="flex items-center justify-center gap-1.5 text-xs text-emerald-600 font-medium mb-5">
                <CheckCircle2 className="w-3.5 h-3.5" /> A notice was also emailed to their address on file.
              </p>
            )}
            <button
              onClick={() => setPasswordReveal(null)}
              className="w-full py-2.5 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-sm font-bold transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}