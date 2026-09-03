import { useEffect, useState } from 'react';
import { User, Mail, ShieldAlert, KeyRound, CheckCircle2 } from 'lucide-react';
import api from '../../libs/axiosInstance';
import PasswordInput from '../../components/common/PasswordInput';

export default function ParentProfile() {
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

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

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();

    if (newPassword !== confirmPassword) {
      setMessage({ type: 'error', text: 'New passwords do not match!' });
      return;
    }

    setSaving(true);
    setMessage({ type: '', text: '' });

    try {
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

  if (loading) return <div className="p-6 text-slate-500 dark:text-slate-400 animate-pulse">Loading your profile...</div>;
  if (!profile) return <div className="p-6 text-red-500 dark:text-red-400">Failed to load profile data. Make sure you are logged in.</div>;

  const displayInitial = profile.first_name ? profile.first_name.charAt(0) : (profile.username ? profile.username.charAt(0) : 'U');

  return (
    <div className="max-w-4xl space-y-6">
      <div className="mb-6 flex items-center gap-4">
        <div className="p-3 rounded-2xl text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10">
          <User className="w-7 h-7" strokeWidth={2.5} />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800 dark:text-slate-100">My Profile</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-0.5">Manage your account settings and update your password.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

        {/* Profile Info Card */}
        <div className="md:col-span-1 bg-white dark:bg-slate-900 rounded-2xl shadow-sm dark:shadow-none border border-slate-100 dark:border-slate-700 p-6 flex flex-col items-center text-center">
          <div className="w-24 h-24 bg-blue-100 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-full flex items-center justify-center text-4xl font-bold uppercase mb-4 shadow-inner">
            {displayInitial}
          </div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">
            {profile.first_name || profile.username} {profile.last_name}
          </h2>
          <span className="bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs font-bold px-3 py-1 rounded-full mt-2 uppercase tracking-wide">
            {profile.role}
          </span>

          <div className="w-full mt-8 space-y-4 text-left border-t border-slate-50 dark:border-slate-800 pt-6">
            <div className="flex items-center gap-3 text-slate-600 dark:text-slate-300">
              <User className="w-4 h-4 text-slate-400 dark:text-slate-500" />
              <div className="text-sm">
                <p className="text-xs text-slate-400 dark:text-slate-500 uppercase font-semibold">Username</p>
                <p className="font-medium text-slate-800 dark:text-slate-100">{profile.username}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 text-slate-600 dark:text-slate-300">
              <Mail className="w-4 h-4 text-slate-400 dark:text-slate-500" />
              <div className="text-sm">
                <p className="text-xs text-slate-400 dark:text-slate-500 uppercase font-semibold">Email</p>
                <p className="font-medium text-slate-800 dark:text-slate-100">{profile.email || "No email provided"}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Change Password Card */}
        <div className="md:col-span-2 bg-white dark:bg-slate-900 rounded-2xl shadow-sm dark:shadow-none border border-slate-100 dark:border-slate-700 p-6">
          <div className="flex items-center gap-2 mb-6 border-b border-slate-50 dark:border-slate-800 pb-4">
            <ShieldAlert className="w-5 h-5 text-slate-400 dark:text-slate-500" />
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Security Details</h3>
          </div>

          <form onSubmit={handlePasswordChange} className="space-y-5 max-w-md">

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Current Password</label>
              <PasswordInput
                icon={KeyRound}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="pl-10 w-full p-2.5 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-lg focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 dark:focus:border-blue-400"
                placeholder="Enter current password"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">New Password</label>
              <PasswordInput
                icon={KeyRound}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="pl-10 w-full p-2.5 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-lg focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 dark:focus:border-blue-400"
                placeholder="Enter new password"
                required
                minLength={8}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Confirm New Password</label>
              <PasswordInput
                icon={CheckCircle2}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="pl-10 w-full p-2.5 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-lg focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 dark:focus:border-blue-400"
                placeholder="Confirm new password"
                required
              />
            </div>

            {message.text && (
              <div className={`p-3 rounded-md text-sm ${message.type === 'error' ? 'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 border border-red-100 dark:border-red-500/20' : 'bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400 border border-green-100 dark:border-green-500/20'}`}>
                {message.text}
              </div>
            )}

            <button
              type="submit"
              disabled={saving}
              className="w-full bg-slate-800 hover:bg-slate-900 dark:bg-slate-700 dark:hover:bg-slate-600 text-white font-medium py-2.5 px-4 rounded-lg transition-colors disabled:bg-slate-400 dark:disabled:bg-slate-600"
            >
              {saving ? 'Updating Password...' : 'Update Password'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
