import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Phone, Mail, MapPin, BookOpen, Layers, Star, Edit, ShieldAlert, UserX, Heart, Users, ShieldCheck, Wallet, Hash, Calendar } from 'lucide-react';
import api from '../../libs/axiosInstance';

const ENROLLMENT_BADGE: Record<string, string> = {
  Suspended: 'bg-amber-50 text-amber-700',
  Expelled: 'bg-red-50 text-red-700',
  Transferred: 'bg-slate-100 text-slate-600',
};

interface AllocationItem {
  class_id: number;
  class_name: string;
  subject_name: string;
  subject_code?: string;
}

// A single labeled fact, icon in a soft neutral circle — used throughout the contact
// and role-specific detail grids so every fact reads with the same quiet rhythm.
function DetailChip({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-9 h-9 rounded-full bg-slate-50 text-slate-500 flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-slate-400 font-semibold uppercase tracking-wide">{label}</p>
        <p className="text-slate-800 font-medium truncate">{value}</p>
      </div>
    </div>
  );
}

// Quick-glance summary numbers at the top of a teacher's profile — salary, teaching
// load, workload — the facts an admin scans for before reading anything else.
function StatPill({ icon, label, value, tint }: { icon: React.ReactNode; label: string; value: React.ReactNode; tint: string }) {
  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${tint}`}>
      {icon}
      <div className="min-w-0">
        <p className="text-lg font-extrabold leading-none">{value}</p>
        <p className="text-[11px] font-semibold uppercase tracking-wide opacity-70 mt-1">{label}</p>
      </div>
    </div>
  );
}

export default function ViewProfile() {
  const { userType, id } = useParams();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const isAdmin = window.location.pathname.includes('admin-dashboard');
  const basePath = '/' + (window.location.pathname.split('/')[1] || 'admin-dashboard');

useEffect(() => {
  const fetchProfileAndAllocations = async () => {
    setLoading(true);
    try {
      // 1. Fetch core profile information using our centralized Axios instance
      const response = await api.get(`/api/user/${userType}/${id}/`);
      const data = response.data;

      if (data.status === 'success') {
        const mergedData = data.data;

        // 2. Conditional Fetch: Only query allocations if processing a teacher profile
        if (userType === 'teachers') {
          try {
            const allocResponse = await api.get(`/api/teacher-allocations/${id}/`);
            const allocData = allocResponse.data;

            if (allocData.status === 'success') {
              // Dynamically append the tracking arrays to the base object profiles
              mergedData.allocations = allocData.data;
            } else {
              mergedData.allocations = [];
            }
          } catch (allocError) {
            console.error("Failed to fetch teacher allocations", allocError);
            mergedData.allocations = []; // Fallback gracefully on tracking network failure
          }
        }

        setProfile(mergedData);
      } else {
        alert("Error loading profile");
      }
    } catch (error) {
      console.error("Failed to fetch profile", error);
    }
    setLoading(false);
  };

  fetchProfileAndAllocations();
}, [userType, id]);

  if (loading) {
    return (
      <div className="max-w-3xl space-y-6 animate-pulse">
        <div className="h-6 w-40 bg-slate-200 rounded-lg"></div>
        <div className="h-80 bg-slate-200 rounded-2xl"></div>
      </div>
    );
  }
  if (!profile) return <div className="p-6 text-red-500">Profile not found.</div>;

  const isClassTeacher = userType === 'teachers' && profile.is_class_teacher;
  const isFlaggedStudent = userType === 'students' && profile.enrollment_state && profile.enrollment_state !== 'Active';
  const hasNoChildrenLinked = userType === 'parents' && !profile.children_rolls;
  const isPendingStaff = userType === 'staff' && profile.status === false;

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-blue-600 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to Directory
        </button>
        {isAdmin && (
          <button
            onClick={() => navigate(`${basePath}/${userType}/edit/${id}`)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
          >
            <Edit className="w-4 h-4" /> Edit Profile
          </button>
        )}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">

        {/* COVER BAND + OVERLAPPING AVATAR */}
        <div className="relative h-24 bg-gradient-to-r from-blue-600 via-blue-600 to-indigo-600">
          <div
            className="absolute inset-0 opacity-[0.15]"
            style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '18px 18px' }}
            aria-hidden="true"
          />
        </div>

        <div className="relative px-8 pb-8">
          <div className="flex items-end gap-4 -mt-10 mb-6">
            {/* PROFILE PICTURE LOGIC */}
            <div className="relative shrink-0">
              {profile.profile_pic ? (
                <img
                  src={profile.profile_pic}
                  alt={profile.name}
                  className="w-20 h-20 rounded-full object-cover ring-4 ring-white shadow-sm"
                />
              ) : (
                <div className="w-20 h-20 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-2xl font-bold uppercase ring-4 ring-white shadow-sm">
                  {profile.name.charAt(0)}
                </div>
              )}
              {isClassTeacher && (
                <span title="Class Teacher" className="absolute -top-1 -right-1 w-6 h-6 bg-amber-400 border-2 border-white rounded-full flex items-center justify-center">
                  <Star className="w-3 h-3 fill-white text-white" />
                </span>
              )}
            </div>

            <div className="pb-1 min-w-0">
              <h1 className="text-2xl font-extrabold text-slate-800 truncate">{profile.name}</h1>
              <p className="text-slate-500 capitalize text-sm mt-0.5">{userType.slice(0, -1)} &middot; {profile.username}</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 mb-6">
            {isClassTeacher && (
              <span className="inline-flex items-center gap-1.5 text-xs font-bold bg-amber-50 text-amber-700 px-2.5 py-1 rounded-full">
                <Star className="w-3 h-3 fill-amber-500 text-amber-500" /> Class Teacher &middot; {profile.class_teacher_of}
              </span>
            )}
            {isFlaggedStudent && (
              <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full ${ENROLLMENT_BADGE[profile.enrollment_state] || 'bg-slate-100 text-slate-600'}`}>
                <ShieldAlert className="w-3 h-3" /> {profile.enrollment_state}
              </span>
            )}
            {userType === 'parents' && (
              <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full ${hasNoChildrenLinked ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                {hasNoChildrenLinked ? <UserX className="w-3 h-3" /> : <Heart className="w-3 h-3" />}
                {profile.relationship}{hasNoChildrenLinked ? ' · No children linked' : ''}
              </span>
            )}
            {userType === 'staff' && (
              <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full ${isPendingStaff ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                {isPendingStaff ? <ShieldAlert className="w-3 h-3" /> : <ShieldCheck className="w-3 h-3" />}
                {isPendingStaff ? 'Pending Approval' : 'Active Account'}
              </span>
            )}
          </div>

          {/* TEACHER STAT SUMMARY — the numbers an admin scans for first */}
          {userType === 'teachers' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8">
              <StatPill
                icon={<Wallet className="w-5 h-5 text-emerald-600 shrink-0" />}
                label="Monthly Salary"
                value={profile.salary ? `Ksh ${Number(profile.salary).toLocaleString()}` : 'Not set'}
                tint="bg-emerald-50/60 border-emerald-100 text-emerald-800"
              />
              <StatPill
                icon={<BookOpen className="w-5 h-5 text-indigo-600 shrink-0" />}
                label="Subjects Qualified"
                value={profile.qualified_subject_names?.length ?? 0}
                tint="bg-indigo-50/60 border-indigo-100 text-indigo-800"
              />
              <StatPill
                icon={<Layers className="w-5 h-5 text-blue-600 shrink-0" />}
                label="Classes Assigned"
                value={profile.allocations?.length ?? 0}
                tint="bg-blue-50/60 border-blue-100 text-blue-800"
              />
            </div>
          )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <DetailChip icon={<Mail className="w-4 h-4" />} label="Email Address" value={profile.email || "N/A"} />
          <DetailChip icon={<Phone className="w-4 h-4" />} label="Mobile Number" value={profile.mobile || "N/A"} />

          {profile.address && (
            <DetailChip icon={<MapPin className="w-4 h-4" />} label="Home Address" value={profile.address} />
          )}

          <DetailChip
            icon={<BookOpen className="w-4 h-4" />}
            label={userType === 'students' ? 'Class Enrolled' : userType === 'teachers' ? 'Subjects Specialized' : userType === 'staff' ? 'Job Title' : 'Linked Children'}
            value={profile.class || profile.subjects || profile.job_title || profile.children_display || "N/A"}
          />

          {userType === 'students' && (
            <>
              <DetailChip icon={<Hash className="w-4 h-4" />} label="Admission / Roll No." value={profile.roll || "N/A"} />
              <DetailChip
                icon={<Wallet className="w-4 h-4" />}
                label="Fee Balance"
                value={profile.fee !== null && profile.fee !== undefined ? profile.fee : "N/A"}
              />
            </>
          )}

          {userType === 'teachers' && (
            <>
              <DetailChip icon={<Hash className="w-4 h-4" />} label="National ID Number" value={profile.id_number || "N/A"} />
              <DetailChip
                icon={<Calendar className="w-4 h-4" />}
                label="Date Joined"
                value={profile.joindate
                  ? new Date(profile.joindate).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
                  : "N/A"}
              />
            </>
          )}

          {userType === 'staff' && (
            <>
              <DetailChip icon={<Hash className="w-4 h-4" />} label="National ID Number" value={profile.id_number || "N/A"} />
              <DetailChip
                icon={<Calendar className="w-4 h-4" />}
                label="Date Joined"
                value={profile.joindate
                  ? new Date(profile.joindate).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
                  : "N/A"}
              />
            </>
          )}
        </div>

        {/* --- ENROLLMENT NOTES (Suspended/Expelled/Transferred students) --- */}
        {isFlaggedStudent && profile.enrollment_notes && (
          <div className="mt-6 pt-6 border-t border-slate-100">
            <div className="flex items-center gap-2 mb-2 text-slate-800">
              <ShieldAlert className="w-4 h-4 text-amber-500" />
              <h2 className="text-sm font-bold uppercase tracking-wide">Enrollment Notes</h2>
            </div>
            <p className="text-sm text-slate-600 bg-amber-50/50 border border-amber-100 rounded-lg p-3">{profile.enrollment_notes}</p>
          </div>
        )}

        {/* --- FAMILY / GUARDIAN DETAILS (Students) --- */}
        {userType === 'students' && (profile.father_name || profile.mother_name || profile.guardian_name) && (
          <div className="mt-8 pt-6 border-t border-slate-100">
            <div className="flex items-center gap-2 mb-4 text-slate-800">
              <Heart className="w-5 h-5 text-rose-500" />
              <h2 className="text-lg font-semibold">Family &amp; Guardian Details</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {profile.father_name && (
                <div className="bg-slate-50 border border-slate-100 rounded-lg p-4">
                  <p className="text-xs text-slate-400 font-semibold uppercase tracking-wide">Father</p>
                  <p className="text-slate-800 font-medium">{profile.father_name}</p>
                  {profile.father_mobile && <p className="text-sm text-slate-500 mt-0.5">{profile.father_mobile}</p>}
                </div>
              )}
              {profile.mother_name && (
                <div className="bg-slate-50 border border-slate-100 rounded-lg p-4">
                  <p className="text-xs text-slate-400 font-semibold uppercase tracking-wide">Mother</p>
                  <p className="text-slate-800 font-medium">{profile.mother_name}</p>
                  {profile.mother_mobile && <p className="text-sm text-slate-500 mt-0.5">{profile.mother_mobile}</p>}
                </div>
              )}
              {profile.guardian_name && (
                <div className="bg-slate-50 border border-slate-100 rounded-lg p-4">
                  <p className="text-xs text-slate-400 font-semibold uppercase tracking-wide">
                    Guardian{profile.guardian_relationship ? ` (${profile.guardian_relationship})` : ''}
                  </p>
                  <p className="text-slate-800 font-medium">{profile.guardian_name}</p>
                  {profile.guardian_mobile && <p className="text-sm text-slate-500 mt-0.5">{profile.guardian_mobile}</p>}
                </div>
              )}
            </div>
          </div>
        )}

        {/* --- LINKED PARENT PORTAL ACCOUNTS (Students) --- */}
        {userType === 'students' && profile.linked_parents && profile.linked_parents.length > 0 && (
          <div className="mt-8 pt-6 border-t border-slate-100">
            <div className="flex items-center gap-2 mb-4 text-slate-800">
              <Users className="w-5 h-5 text-emerald-500" />
              <h2 className="text-lg font-semibold">Linked Parent Portal Accounts</h2>
            </div>
            <div className="space-y-2">
              {profile.linked_parents.map((p: { id: number; name: string; relationship: string; mobile: string }) => (
                <Link
                  key={p.id}
                  to={`${basePath}/parents/view/${p.id}`}
                  className="flex items-center justify-between p-3 rounded-lg border border-slate-100 hover:border-emerald-200 hover:bg-emerald-50/50 transition"
                >
                  <div>
                    <p className="font-medium text-slate-800 text-sm">{p.name}</p>
                    <p className="text-xs text-slate-500">{p.relationship} &middot; {p.mobile}</p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* --- ELECTIVE SUBJECTS (Students) --- */}
        {userType === 'students' && profile.elective_subjects && profile.elective_subjects.length > 0 && (
          <div className="mt-8 pt-6 border-t border-slate-100">
            <div className="flex items-center gap-2 mb-4 text-slate-800">
              <BookOpen className="w-5 h-5 text-indigo-500" />
              <h2 className="text-lg font-semibold">Elective Subjects</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {profile.elective_subjects.map((s: { id: number; name: string; code: string }) => (
                <span key={s.id} className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-100">
                  {s.name} {s.code && `(${s.code})`}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* --- LINKED CHILDREN DETAIL (Parents) --- */}
        {userType === 'parents' && profile.children_detail && profile.children_detail.length > 0 && (
          <div className="mt-8 pt-6 border-t border-slate-100">
            <div className="flex items-center gap-2 mb-4 text-slate-800">
              <Users className="w-5 h-5 text-emerald-500" />
              <h2 className="text-lg font-semibold">Linked Children</h2>
            </div>
            <div className="space-y-2">
              {profile.children_detail.map((c: { id: number; name: string; roll: string; class: string; enrollment_state: string }) => (
                <Link
                  key={c.id}
                  to={`${basePath}/students/view/${c.id}`}
                  className="flex items-center justify-between p-3 rounded-lg border border-slate-100 hover:border-emerald-200 hover:bg-emerald-50/50 transition"
                >
                  <div>
                    <p className="font-medium text-slate-800 text-sm">{c.name} <span className="text-slate-400 font-normal">({c.roll})</span></p>
                    <p className="text-xs text-slate-500">{c.class}</p>
                  </div>
                  {c.enrollment_state !== 'Active' && (
                    <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">{c.enrollment_state}</span>
                  )}
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* --- ASSIGNED RBAC ROLES (Staff) --- */}
        {userType === 'staff' && (
          <div className="mt-8 pt-6 border-t border-slate-100">
            <div className="flex items-center gap-2 mb-4 text-slate-800">
              <ShieldCheck className="w-5 h-5 text-purple-500" />
              <h2 className="text-lg font-semibold">Roles &amp; Access</h2>
            </div>
            {profile.assigned_roles && profile.assigned_roles.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {profile.assigned_roles.map((r: string) => (
                  <span key={r} className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-purple-50 text-purple-700 border border-purple-100">
                    {r}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500 bg-slate-50 p-4 rounded-lg border border-dashed border-slate-200">
                No roles currently granted. {profile.requested_role && `They applied requesting "${profile.requested_role}".`}
              </p>
            )}
            {isAdmin && (
              <Link
                to={`${basePath}/roles-permissions`}
                className="inline-flex items-center gap-1.5 mt-3 text-sm text-blue-600 font-medium hover:underline"
              >
                Manage in Roles &amp; Permissions
              </Link>
            )}
          </div>
        )}

        {/* --- QUALIFIED SUBJECTS (Teachers) --- */}
        {userType === 'teachers' && profile.qualified_subject_names && profile.qualified_subject_names.length > 0 && (
          <div className="mt-8 pt-6 border-t border-slate-100">
            <div className="flex items-center gap-2 mb-4 text-slate-800">
              <BookOpen className="w-5 h-5 text-indigo-500" />
              <h2 className="text-lg font-semibold">Qualified to Teach</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {profile.qualified_subject_names.map((name: string) => (
                <span key={name} className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-100">
                  {name}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* --- CLASS ALLOCATIONS WORKLOAD SECTION --- */}
        {userType === 'teachers' && profile.allocations && (
          <div className="mt-8 pt-6 border-t border-slate-100">
            <div className="flex items-center gap-2 mb-4 text-slate-800">
              <Layers className="w-5 h-5 text-indigo-500" />
              <h2 className="text-lg font-semibold">Assigned Classes & Workload</h2>
            </div>

            {profile.allocations.length === 0 ? (
              <p className="text-sm text-slate-500 bg-slate-50 p-4 rounded-lg border border-dashed border-slate-200">
                This teacher is currently not allocated to teach any classes for the active term.
              </p>
            ) : (
              <div className="border border-slate-100 rounded-xl overflow-hidden bg-slate-50">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-100 text-slate-500 uppercase text-[11px] tracking-wider font-semibold">
                      <th className="py-2.5 px-4">Assigned Class</th>
                      <th className="py-2.5 px-4">Subject Taught</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {profile.allocations.map((alloc: AllocationItem, index: number) => (
                      <tr key={index} className="hover:bg-slate-50 transition-colors">
                        <td className="py-3 px-4 font-medium text-slate-800">
                          {alloc.class_name}
                        </td>
                        <td className="py-3 px-4 text-slate-600">
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-100">
                            {alloc.subject_name} {alloc.subject_code && `(${alloc.subject_code})`}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        </div>
      </div>
    </div>
  );
}
