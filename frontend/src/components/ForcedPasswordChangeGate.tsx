import { useState } from 'react';
import { ShieldAlert, KeyRound, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../libs/axiosInstance';
import PasswordInput from './common/PasswordInput';

interface ForcedPasswordChangeGateProps {
  onSuccess: () => void;
}

// Full-screen block shown instead of the dashboard whenever the account has a
// temporary password (set by an admin/class-teacher reset) that hasn't been
// replaced yet — reuses the same /api/my-profile/ endpoint every role's own
// "My Profile" page already uses to change a password.
export default function ForcedPasswordChangeGate({ onSuccess }: ForcedPasswordChangeGateProps) {
  const [tempPassword, setTempPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError("New passwords don't match.");
      return;
    }

    setSaving(true);
    try {
      const response = await api.post('/api/my-profile/', {
        current_password: tempPassword,
        new_password: newPassword,
      });
      const data = response.data;
      if (data.status === 'success') {
        toast.success('Password set successfully — welcome back!');
        onSuccess();
      } else {
        setError(data.message || 'Failed to set new password.');
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to set new password.');
    }
    setSaving(false);
  };

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm dark:shadow-none border border-slate-100 dark:border-slate-700 max-w-md w-full p-8">
        <div className="w-14 h-14 rounded-2xl bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center mb-5">
          <ShieldAlert className="w-7 h-7" />
        </div>
        <h1 className="text-xl font-extrabold text-slate-800 dark:text-slate-100 mb-1.5">Set a New Password</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
          Your password was reset by an administrator. For your account's security, you need to
          set a new password of your own before you can continue.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Temporary Password</label>
            <PasswordInput
              value={tempPassword}
              onChange={(e) => setTempPassword(e.target.value)}
              placeholder="The password you just logged in with"
              className="w-full p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500/20 dark:focus:ring-blue-400/20 focus:border-blue-500 dark:focus:border-blue-400 outline-none bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 transition-all"
              required
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">New Password</label>
            <PasswordInput
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500/20 dark:focus:ring-blue-400/20 focus:border-blue-500 dark:focus:border-blue-400 outline-none bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 transition-all"
              required
              minLength={8}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Confirm New Password</label>
            <PasswordInput
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500/20 dark:focus:ring-blue-400/20 focus:border-blue-500 dark:focus:border-blue-400 outline-none bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 transition-all"
              required
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-xl font-bold transition-colors disabled:bg-blue-300 dark:disabled:bg-blue-900/60 mt-2"
          >
            {saving ? (
              'Saving…'
            ) : (
              <>
                <KeyRound className="w-4 h-4" /> Set New Password
              </>
            )}
          </button>
        </form>

        <p className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500 mt-5">
          <CheckCircle2 className="w-3.5 h-3.5" /> This only takes a moment — you'll land straight in your dashboard afterward.
        </p>
      </div>
    </div>
  );
}
