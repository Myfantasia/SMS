// AdminInvitesPanel.tsx
// Lives on the Admins approval page (PendingApprovals.tsx), alongside the applications
// list. Two independent concerns share this panel because both revolve around "a
// short-lived secret an existing admin hands to someone else":
//   1. Signup invite codes — gate /adminsignup for anyone but the bootstrap admin.
//   2. Post-approval verification codes — the 2FA-style code an applicant enters at
//      login after being approved. Only status + regenerate live here; generation on
//      first approval still happens inline in ApprovalTable.
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { KeyRound, ShieldCheck, Ban, RotateCw, Loader2 } from 'lucide-react';
import api from '../../libs/axiosInstance';
import CodeRevealModal from '../common/CodeRevealModal';

interface InviteCode {
  id: number;
  code_preview: string;
  status: 'Active' | 'Used' | 'Expired' | 'Revoked';
  created_at: string;
  expires_at: string;
  created_by: string;
  used_at: string | null;
  used_by: string | null;
}

interface PendingVerification {
  id: number;
  name: string;
  email: string;
  username: string;
  code_generated_at: string | null;
  expires_at: string | null;
  attempts_used: number;
}

const STATUS_COLOR: Record<InviteCode['status'], string> = {
  Active: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  Used: 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400',
  Expired: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400',
  Revoked: 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400',
};

function formatDateTime(value?: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function AdminInvitesPanel() {
  const [invites, setInvites] = useState<InviteCode[]>([]);
  const [invitesLoading, setInvitesLoading] = useState(true);
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [generating, setGenerating] = useState(false);
  const [revokingId, setRevokingId] = useState<number | null>(null);

  const [pendingVerification, setPendingVerification] = useState<PendingVerification[]>([]);
  const [verificationLoading, setVerificationLoading] = useState(true);
  const [regeneratingId, setRegeneratingId] = useState<number | null>(null);

  const [reveal, setReveal] = useState<{ title: string; description: React.ReactNode; code: string } | null>(null);

  const loadInvites = async () => {
    setInvitesLoading(true);
    try {
      const response = await api.get('/api/admin-invites/');
      if (response.data.status === 'success') setInvites(response.data.data);
    } catch (error) {
      console.error('Failed to load invite codes', error);
    }
    setInvitesLoading(false);
  };

  const loadPendingVerification = async () => {
    setVerificationLoading(true);
    try {
      const response = await api.get('/api/admin-verification-status/');
      if (response.data.status === 'success') setPendingVerification(response.data.data);
    } catch (error) {
      console.error('Failed to load pending verification list', error);
    }
    setVerificationLoading(false);
  };

  useEffect(() => {
    loadInvites();
    loadPendingVerification();
  }, []);

  const generateInvite = async () => {
    setGenerating(true);
    try {
      const response = await api.post('/api/admin-invites/generate/', { expires_in_days: expiresInDays });
      if (response.data.status === 'success') {
        setReveal({
          title: 'Admin Invite Code Generated',
          description: <>Relay this code to whoever you're inviting — they'll enter it on the admin signup form. It expires on {formatDateTime(response.data.expires_at)}.</>,
          code: response.data.code,
        });
        loadInvites();
      } else {
        toast.error(response.data.message || 'Failed to generate invite code.');
      }
    } catch (error: any) {
      console.error('Failed to generate invite code', error);
      toast.error(error.response?.data?.message || 'Failed to generate invite code.');
    }
    setGenerating(false);
  };

  const revokeInvite = async (id: number) => {
    setRevokingId(id);
    try {
      const response = await api.post(`/api/admin-invites/${id}/revoke/`);
      if (response.data.status === 'success') {
        toast.success('Invite code revoked.');
        loadInvites();
      } else {
        toast.error(response.data.message || 'Failed to revoke invite code.');
      }
    } catch (error: any) {
      console.error('Failed to revoke invite code', error);
      toast.error(error.response?.data?.message || 'Failed to revoke invite code.');
    }
    setRevokingId(null);
  };

  const regenerateCode = async (entry: PendingVerification) => {
    setRegeneratingId(entry.id);
    try {
      const response = await api.post(`/api/admin-verification-status/${entry.id}/regenerate/`);
      if (response.data.status === 'success') {
        setReveal({
          title: 'Verification Code Regenerated',
          description: <>The previous code for <span className="font-semibold text-slate-700 dark:text-slate-200">{entry.name}</span> is no longer valid. Relay this new one — it expires in 30 minutes.</>,
          code: response.data.verification_code,
        });
        loadPendingVerification();
      } else {
        toast.error(response.data.message || 'Failed to regenerate code.');
      }
    } catch (error: any) {
      console.error('Failed to regenerate code', error);
      toast.error(error.response?.data?.message || 'Failed to regenerate code.');
    }
    setRegeneratingId(null);
  };

  return (
    <div className="space-y-6">
      {/* SIGNUP INVITE CODES */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm dark:shadow-none overflow-hidden">
        <div className="p-5 border-b border-slate-100 dark:border-slate-700 flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
          <h2 className="text-base font-bold text-slate-800 dark:text-slate-100">Signup Invite Codes</h2>
        </div>

        <div className="p-5 flex flex-wrap items-end gap-3 border-b border-slate-100 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/40">
          <div>
            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">Valid for</label>
            <select
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(Number(e.target.value))}
              className="border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-sm outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 focus:border-indigo-500 dark:focus:border-indigo-400"
            >
              <option value={1}>1 day</option>
              <option value={3}>3 days</option>
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
            </select>
          </div>
          <button
            disabled={generating}
            onClick={generateInvite}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-bold transition-colors disabled:opacity-60"
          >
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
            Generate Invite Code
          </button>
          <p className="text-xs text-slate-400 dark:text-slate-500 max-w-sm">Single-use. Shown only once — copy or relay it immediately after generating.</p>
        </div>

        {invitesLoading ? (
          <div className="p-6 space-y-2 animate-pulse">
            {[1, 2].map(i => <div key={i} className="h-10 bg-slate-100 dark:bg-slate-800 rounded-lg"></div>)}
          </div>
        ) : invites.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-400 dark:text-slate-500">No invite codes generated yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800 text-slate-400 dark:text-slate-500 uppercase text-[11px] tracking-wider">
                  <th className="py-2.5 px-5 font-bold">Code</th>
                  <th className="py-2.5 px-5 font-bold">Status</th>
                  <th className="py-2.5 px-5 font-bold">Generated By</th>
                  <th className="py-2.5 px-5 font-bold">Expires</th>
                  <th className="py-2.5 px-5 font-bold">Used By</th>
                  <th className="py-2.5 px-5 font-bold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                {invites.map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/70 transition-colors">
                    <td className="py-2.5 px-5 font-mono text-sm text-slate-600 dark:text-slate-300">...{inv.code_preview}</td>
                    <td className="py-2.5 px-5">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${STATUS_COLOR[inv.status]}`}>{inv.status}</span>
                    </td>
                    <td className="py-2.5 px-5 text-sm text-slate-600 dark:text-slate-300">{inv.created_by}</td>
                    <td className="py-2.5 px-5 text-sm text-slate-500 dark:text-slate-400">{formatDateTime(inv.expires_at)}</td>
                    <td className="py-2.5 px-5 text-sm text-slate-500 dark:text-slate-400">{inv.used_by || '—'}</td>
                    <td className="py-2.5 px-5 text-right">
                      {inv.status === 'Active' && (
                        <button
                          disabled={revokingId === inv.id}
                          onClick={() => revokeInvite(inv.id)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-50 dark:bg-red-500/10 hover:bg-red-100 dark:hover:bg-red-500/20 text-red-700 dark:text-red-400 rounded-lg text-xs font-bold transition-colors disabled:opacity-60"
                        >
                          <Ban className="w-3.5 h-3.5" /> Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* AWAITING VERIFICATION */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm dark:shadow-none overflow-hidden">
        <div className="p-5 border-b border-slate-100 dark:border-slate-700 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
          <h2 className="text-base font-bold text-slate-800 dark:text-slate-100">Awaiting Verification</h2>
          <span className="bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 text-xs font-bold px-2.5 py-1 rounded-full">{pendingVerification.length}</span>
        </div>

        {verificationLoading ? (
          <div className="p-6 space-y-2 animate-pulse">
            {[1, 2].map(i => <div key={i} className="h-10 bg-slate-100 dark:bg-slate-800 rounded-lg"></div>)}
          </div>
        ) : pendingVerification.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-400 dark:text-slate-500">No approved admins are currently waiting to verify their code.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800 text-slate-400 dark:text-slate-500 uppercase text-[11px] tracking-wider">
                  <th className="py-2.5 px-5 font-bold">Applicant</th>
                  <th className="py-2.5 px-5 font-bold">Code Generated</th>
                  <th className="py-2.5 px-5 font-bold">Expires</th>
                  <th className="py-2.5 px-5 font-bold">Attempts</th>
                  <th className="py-2.5 px-5 font-bold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                {pendingVerification.map((entry) => (
                  <tr key={entry.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/70 transition-colors">
                    <td className="py-2.5 px-5">
                      <p className="font-semibold text-slate-800 dark:text-slate-100 text-sm">{entry.name}</p>
                      <p className="text-xs text-slate-400 dark:text-slate-500">{entry.email}</p>
                    </td>
                    <td className="py-2.5 px-5 text-sm text-slate-500 dark:text-slate-400">{formatDateTime(entry.code_generated_at)}</td>
                    <td className="py-2.5 px-5 text-sm text-slate-500 dark:text-slate-400">{formatDateTime(entry.expires_at)}</td>
                    <td className="py-2.5 px-5 text-sm text-slate-500 dark:text-slate-400">{entry.attempts_used}/5</td>
                    <td className="py-2.5 px-5 text-right">
                      <button
                        disabled={regeneratingId === entry.id}
                        onClick={() => regenerateCode(entry)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 dark:bg-indigo-500/10 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 text-indigo-700 dark:text-indigo-400 rounded-lg text-xs font-bold transition-colors disabled:opacity-60"
                      >
                        {regeneratingId === entry.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5" />}
                        Regenerate Code
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {reveal && (
        <CodeRevealModal
          title={reveal.title}
          description={reveal.description}
          code={reveal.code}
          onClose={() => setReveal(null)}
        />
      )}
    </div>
  );
}
