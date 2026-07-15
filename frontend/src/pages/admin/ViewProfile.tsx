import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Phone, Mail, MapPin, BookOpen, Layers, Star, Edit, ShieldAlert, UserX, Heart } from 'lucide-react';
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

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8">
        <div className="flex items-center gap-4 mb-8 border-b border-slate-100 pb-6">

          {/* PROFILE PICTURE LOGIC */}
          <div className="relative shrink-0">
            {profile.profile_pic ? (
              <img
                src={profile.profile_pic}
                alt={profile.name}
                className="w-16 h-16 rounded-full object-cover border-2 border-indigo-100 shadow-sm"
              />
            ) : (
              <div className="w-16 h-16 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-2xl font-bold uppercase">
                {profile.name.charAt(0)}
              </div>
            )}
            {isClassTeacher && (
              <span title="Class Teacher" className="absolute -top-1 -right-1 w-6 h-6 bg-amber-400 border-2 border-white rounded-full flex items-center justify-center">
                <Star className="w-3 h-3 fill-white text-white" />
              </span>
            )}
          </div>

          <div>
            <h1 className="text-2xl font-extrabold text-slate-800">{profile.name}</h1>
            <p className="text-slate-500 capitalize text-sm mt-0.5">{userType.slice(0, -1)} &middot; {profile.username}</p>
            {isClassTeacher && (
              <span className="inline-flex items-center gap-1.5 mt-2 text-xs font-bold bg-amber-50 text-amber-700 px-2.5 py-1 rounded-full">
                <Star className="w-3 h-3 fill-amber-500 text-amber-500" /> Class Teacher &middot; {profile.class_teacher_of}
              </span>
            )}
            {isFlaggedStudent && (
              <span className={`inline-flex items-center gap-1.5 mt-2 text-xs font-bold px-2.5 py-1 rounded-full ${ENROLLMENT_BADGE[profile.enrollment_state] || 'bg-slate-100 text-slate-600'}`}>
                <ShieldAlert className="w-3 h-3" /> {profile.enrollment_state}
              </span>
            )}
            {userType === 'parents' && (
              <span className={`inline-flex items-center gap-1.5 mt-2 text-xs font-bold px-2.5 py-1 rounded-full ${hasNoChildrenLinked ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                {hasNoChildrenLinked ? <UserX className="w-3 h-3" /> : <Heart className="w-3 h-3" />}
                {profile.relationship}{hasNoChildrenLinked ? ' · No children linked' : ''}
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="flex items-center gap-3">
            <Mail className="w-5 h-5 text-slate-400" />
            <div>
              <p className="text-xs text-slate-400 font-semibold uppercase tracking-wide">Email Address</p>
              <p className="text-slate-800">{profile.email || "N/A"}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Phone className="w-5 h-5 text-slate-400" />
            <div>
              <p className="text-xs text-slate-400 font-semibold uppercase tracking-wide">Mobile Number</p>
              <p className="text-slate-800">{profile.mobile || "N/A"}</p>
            </div>
          </div>

          {profile.address && (
            <div className="flex items-center gap-3">
              <MapPin className="w-5 h-5 text-slate-400" />
              <div>
                <p className="text-xs text-slate-400 font-semibold uppercase tracking-wide">Home Address</p>
                <p className="text-slate-800">{profile.address}</p>
              </div>
            </div>
          )}

          <div className="flex items-center gap-3">
            <BookOpen className="w-5 h-5 text-slate-400" />
            <div>
              <p className="text-xs text-slate-400 font-semibold uppercase tracking-wide">
                {userType === 'students' ? 'Class Enrolled' : userType === 'teachers' ? 'Subjects Specialized' : 'Linked Children'}
              </p>
              <p className="text-slate-800 font-medium">
                {profile.class || profile.subjects || profile.children || "N/A"}
              </p>
            </div>
          </div>
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
  );
}
