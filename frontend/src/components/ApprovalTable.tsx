// ApprovalTable.tsx
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  CheckCircle2, XCircle, UserPlus, ShieldCheck, Eye, Loader2, X,
  Mail, Phone, MapPin, BookOpen, Hash, Wallet, Users, Heart, Calendar, Briefcase,
} from 'lucide-react';
import api from '../libs/axiosInstance';
import CodeRevealModal from './common/CodeRevealModal';

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
  job_title?: string;
  requested_role?: string;
  // Kept extra_info as a fallback just in case
  extra_info?: string;
}

type UserType = 'students' | 'teachers' | 'parents' | 'admins' | 'staff';

interface ApprovalTableProps {
  userType: UserType;
}

const AVATAR_COLOR: Record<UserType, string> = {
  teachers: 'bg-purple-100 text-purple-700',
  students: 'bg-blue-100 text-blue-700',
  parents: 'bg-emerald-100 text-emerald-700',
  admins: 'bg-rose-100 text-rose-700',
  staff: 'bg-amber-100 text-amber-700',
};

function formatDate(value?: string | null) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// A single labeled fact in the review modal — used for every "icon + label + value" row.
function DetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className="text-slate-400 mt-0.5 shrink-0">{icon}</div>
      <div className="min-w-0">
        <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-wide">{label}</p>
        <p className="text-sm text-slate-800 font-medium break-words">{value}</p>
      </div>
    </div>
  );
}

export default function ApprovalTable({ userType }: ApprovalTableProps) {
  const [users, setUsers] = useState<PendingUser[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  // Admin approval is two-step: clicking "Approve" generates a one-time code that
  // has to be relayed to the applicant out-of-band (no email/SMS is wired up), so
  // it needs to be shown clearly rather than flashed in a toast that disappears.
  const [codeReveal, setCodeReveal] = useState<{ name: string; code: string } | null>(null);

  // Review modal: a deliberate "look before you approve" step. Clicking a row fetches
  // the applicant's full profile (the same endpoint the directory View page uses) rather
  // than acting on just the few columns visible in the table.
  const [reviewUser, setReviewUser] = useState<PendingUser | null>(null);
  const [reviewData, setReviewData] = useState<any | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);

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

  const openReview = async (user: PendingUser) => {
    setReviewUser(user);
    setReviewData(null);
    setReviewLoading(true);
    try {
      const response = await api.get(`/api/user/${userType}/${user.id}/`);
      const data = response.data;
      if (data.status === 'success') {
        setReviewData(data.data);
      } else {
        toast.error('Failed to load applicant details.');
      }
    } catch (error) {
      console.error("Failed to load applicant details", error);
      toast.error('Failed to load applicant details.');
    }
    setReviewLoading(false);
  };

  const closeReview = () => {
    setReviewUser(null);
    setReviewData(null);
  };

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
        if (userType === 'admins' && action === 'approve' && data.verification_code) {
          const applicant = users.find(u => u.id === id);
          setCodeReveal({ name: applicant?.name || 'this applicant', code: data.verification_code });
        } else {
          toast.success(`User successfully ${action}ed.`);
        }
        setUsers(users.filter(user => user.id !== id));
        closeReview();
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

  const secondaryColumnLabel = userType === 'students' ? 'Class' : userType === 'teachers' ? 'Subjects' : userType === 'parents' ? 'Linked Students' : userType === 'staff' ? 'Job Title / Requested Role' : 'Status';

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

      {userType === 'admins' && users.length > 0 && (
        <div className="px-5 py-3 bg-rose-50/60 border-b border-rose-100 text-xs text-rose-700 flex items-start gap-2">
          <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" />
          <p>Approving an admin does not grant access immediately. It generates a one-time code you must relay to the applicant yourself — they enter it on the admin login page to finish activating their account.</p>
        </div>
      )}

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
                    {userType === 'admins' && <span className="text-amber-600 font-medium">Awaiting review</span>}
                    {userType === 'staff' && (
                      <div className="flex flex-col">
                        <span>{user.job_title || <span className="text-slate-300 italic">Not specified</span>}</span>
                        <span className="text-xs text-slate-400">
                          Role: {user.requested_role && user.requested_role !== 'None selected' ? user.requested_role : <span className="italic">None selected</span>}
                        </span>
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-5 text-right">
                    <div className="flex items-center justify-end">
                      <button
                        disabled={busyId === user.id}
                        onClick={() => openReview(user)}
                        className="flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-bold transition-colors disabled:opacity-60 whitespace-nowrap"
                      >
                        <Eye className="w-3.5 h-3.5" /> Review Application
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* REVIEW MODAL — the deliberate "see everything, then decide" step */}
      {reviewUser && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white flex items-center justify-between px-6 py-4 border-b border-slate-100 z-10">
              <h3 className="text-base font-bold text-slate-800">Application Review</h3>
              <button onClick={closeReview} title="Close" className="text-slate-400 hover:text-slate-700 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {reviewLoading || !reviewData ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
                <Loader2 className="w-6 h-6 animate-spin" />
                <p className="text-sm">Loading applicant details…</p>
              </div>
            ) : (
              <div className="p-6">
                {/* Identity header */}
                <div className="flex items-center gap-4 mb-6 pb-6 border-b border-slate-100">
                  {reviewData.profile_pic ? (
                    <img src={reviewData.profile_pic} alt={reviewData.name} className="w-14 h-14 rounded-full object-cover border-2 border-slate-100 shrink-0" />
                  ) : (
                    <div className={`w-14 h-14 rounded-full flex items-center justify-center font-bold text-xl shrink-0 ${AVATAR_COLOR[userType]}`}>
                      {(reviewData.name || reviewUser.name).charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <h4 className="text-lg font-extrabold text-slate-800 truncate">{reviewData.name || reviewUser.name}</h4>
                    <p className="text-sm text-slate-400 capitalize">{userType.slice(0, -1)} applicant &middot; {reviewData.username}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <DetailRow icon={<Mail className="w-4 h-4" />} label="Email Address" value={reviewData.email || 'N/A'} />
                  {reviewData.mobile && <DetailRow icon={<Phone className="w-4 h-4" />} label="Mobile Number" value={reviewData.mobile} />}
                  {reviewData.address && <DetailRow icon={<MapPin className="w-4 h-4" />} label="Home Address" value={reviewData.address} />}

                  {/* TEACHER-SPECIFIC */}
                  {userType === 'teachers' && (
                    <>
                      {reviewData.id_number && <DetailRow icon={<Hash className="w-4 h-4" />} label="National ID Number" value={reviewData.id_number} />}
                      {!!reviewData.salary && <DetailRow icon={<Wallet className="w-4 h-4" />} label="Proposed Monthly Salary" value={`Ksh ${Number(reviewData.salary).toLocaleString()}`} />}
                      {reviewData.subjects && <DetailRow icon={<BookOpen className="w-4 h-4" />} label="Subjects Listed" value={reviewData.subjects} />}
                      {formatDate(reviewData.joindate) && <DetailRow icon={<Calendar className="w-4 h-4" />} label="Applied On" value={formatDate(reviewData.joindate)} />}
                    </>
                  )}

                  {/* STUDENT-SPECIFIC */}
                  {userType === 'students' && (
                    <>
                      {reviewData.class && <DetailRow icon={<BookOpen className="w-4 h-4" />} label="Requested Class" value={reviewData.class} />}
                      {reviewData.roll && <DetailRow icon={<Hash className="w-4 h-4" />} label="Admission / Roll No." value={reviewData.roll} />}
                      {reviewData.parent_name && <DetailRow icon={<Users className="w-4 h-4" />} label="Parent / Guardian on File" value={`${reviewData.parent_name}${reviewData.parent_mobile ? ` · ${reviewData.parent_mobile}` : ''}`} />}
                    </>
                  )}

                  {/* PARENT-SPECIFIC */}
                  {userType === 'parents' && (
                    <>
                      {reviewData.relationship && <DetailRow icon={<Heart className="w-4 h-4" />} label="Relationship to Child" value={reviewData.relationship} />}
                    </>
                  )}

                  {/* STAFF-SPECIFIC */}
                  {userType === 'staff' && (
                    <>
                      {reviewData.job_title && <DetailRow icon={<Briefcase className="w-4 h-4" />} label="Job Title" value={reviewData.job_title} />}
                      {reviewData.id_number && <DetailRow icon={<Hash className="w-4 h-4" />} label="National ID Number" value={reviewData.id_number} />}
                      <DetailRow icon={<ShieldCheck className="w-4 h-4" />} label="Requested Access Role" value={reviewData.requested_role || <span className="italic text-slate-400">None selected</span>} />
                    </>
                  )}
                </div>

                {/* STUDENT FAMILY DETAILS */}
                {userType === 'students' && (reviewData.father_name || reviewData.mother_name || reviewData.guardian_name) && (
                  <div className="mt-6 pt-6 border-t border-slate-100">
                    <div className="flex items-center gap-2 mb-3 text-slate-800">
                      <Heart className="w-4 h-4 text-rose-500" />
                      <h5 className="text-sm font-bold uppercase tracking-wide">Family &amp; Guardian Details</h5>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {reviewData.father_name && (
                        <div className="bg-slate-50 border border-slate-100 rounded-lg p-3">
                          <p className="text-[11px] text-slate-400 font-semibold uppercase">Father</p>
                          <p className="text-sm font-medium text-slate-800">{reviewData.father_name}</p>
                          {reviewData.father_mobile && <p className="text-xs text-slate-500">{reviewData.father_mobile}</p>}
                        </div>
                      )}
                      {reviewData.mother_name && (
                        <div className="bg-slate-50 border border-slate-100 rounded-lg p-3">
                          <p className="text-[11px] text-slate-400 font-semibold uppercase">Mother</p>
                          <p className="text-sm font-medium text-slate-800">{reviewData.mother_name}</p>
                          {reviewData.mother_mobile && <p className="text-xs text-slate-500">{reviewData.mother_mobile}</p>}
                        </div>
                      )}
                      {reviewData.guardian_name && (
                        <div className="bg-slate-50 border border-slate-100 rounded-lg p-3">
                          <p className="text-[11px] text-slate-400 font-semibold uppercase">
                            Guardian{reviewData.guardian_relationship ? ` (${reviewData.guardian_relationship})` : ''}
                          </p>
                          <p className="text-sm font-medium text-slate-800">{reviewData.guardian_name}</p>
                          {reviewData.guardian_mobile && <p className="text-xs text-slate-500">{reviewData.guardian_mobile}</p>}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* PARENT'S LINKED CHILDREN */}
                {userType === 'parents' && reviewData.children_detail && reviewData.children_detail.length > 0 && (
                  <div className="mt-6 pt-6 border-t border-slate-100">
                    <div className="flex items-center gap-2 mb-3 text-slate-800">
                      <Users className="w-4 h-4 text-emerald-500" />
                      <h5 className="text-sm font-bold uppercase tracking-wide">Linked Children</h5>
                    </div>
                    <div className="space-y-2">
                      {reviewData.children_detail.map((c: { id: number; name: string; roll: string; class: string }) => (
                        <div key={c.id} className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                          <p className="text-sm font-medium text-slate-800">{c.name} <span className="text-slate-400 font-normal">({c.roll})</span></p>
                          <span className="text-xs text-slate-500">{c.class}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {userType === 'admins' && (
                  <div className="mt-6 px-4 py-3 bg-rose-50/60 border border-rose-100 rounded-xl text-xs text-rose-700 flex items-start gap-2">
                    <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" />
                    <p>This grants the highest privilege level in the system. Approving generates a one-time code you'll need to relay to the applicant directly — verify their identity first.</p>
                  </div>
                )}

                {/* DECISION */}
                <div className="mt-8 pt-6 border-t border-slate-100 flex items-center justify-end gap-3">
                  <button
                    disabled={busyId === reviewUser.id}
                    onClick={() => handleAction(reviewUser.id, 'reject')}
                    className="flex items-center gap-2 px-4 py-2.5 bg-red-50 hover:bg-red-100 text-red-700 rounded-xl text-sm font-bold transition-colors disabled:opacity-60"
                  >
                    <XCircle className="w-4 h-4" /> Reject
                  </button>
                  <button
                    disabled={busyId === reviewUser.id}
                    onClick={() => handleAction(reviewUser.id, 'approve')}
                    className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold transition-colors disabled:opacity-60 shadow-sm"
                  >
                    <CheckCircle2 className="w-4 h-4" /> Approve
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {codeReveal && (
        <CodeRevealModal
          title="Verification Code Generated"
          description={
            <>Relay this code to <span className="font-semibold text-slate-700">{codeReveal.name}</span> so they can enter it on the admin login page and activate their account.</>
          }
          code={codeReveal.code}
          onClose={() => setCodeReveal(null)}
        />
      )}
    </div>
  );
}
