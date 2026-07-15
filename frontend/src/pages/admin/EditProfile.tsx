import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, UserCog, Star } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../libs/axiosInstance';

export default function EditProfile() {
  const { userType, id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Read-only context about the teacher's homeroom assignment (set elsewhere, in Class Operations)
  const [classTeacherInfo, setClassTeacherInfo] = useState<{ is_class_teacher: boolean; class_teacher_of: string | null }>({
    is_class_teacher: false,
    class_teacher_of: null,
  });

  // Expanded Unified Form State
  const [formData, setFormData] = useState({
    first_name: '', last_name: '', username: '', email: '',
    mobile: '', address: '', status: 'true',
    class: '', roll: '', fee: '', parent_name: '', parent_mobile: '',
    subjects: '', id_number: '', salary: '',
    relationship: '', children_rolls: '', children_display: '',
    enrollment_state: 'Active', enrollment_notes: ''
  });

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const response = await api.get(`/api/user/${userType}/${id}/`);
        const data = response.data;

        if (data.status === 'success') {
          const d = data.data;
          setFormData({
            first_name: d.first_name || '',
            last_name: d.last_name || '',
            username: d.username || '',
            email: d.email || '',
            mobile: d.mobile || '',
            address: d.address || '',
            status: d.status === true ? 'true' : 'false',
            class: d.class || '',
            roll: d.roll || '',
            fee: d.fee !== undefined && d.fee !== null ? String(d.fee) : '',
            parent_name: d.parent_name || '',
            parent_mobile: d.parent_mobile || '',
            subjects: d.subjects || '',
            id_number: d.id_number || '',
            salary: d.salary !== undefined && d.salary !== null ? String(d.salary) : '',
            relationship: d.relationship || 'Father',
            children_rolls: d.children_rolls || '',
            children_display: d.children_display || '',
            enrollment_state: d.enrollment_state || 'Active',
            enrollment_notes: d.enrollment_notes || ''
          });
          setClassTeacherInfo({
            is_class_teacher: !!d.is_class_teacher,
            class_teacher_of: d.class_teacher_of || null,
          });
        }
      } catch (error) {
        console.error("Failed to fetch profile", error);
        toast.error("Could not fetch user profile details.");
      }
      setLoading(false);
    };

    fetchProfile();
  }, [userType, id]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      // 1. Build common base payload required by all accounts
      const payload: Record<string, any> = {
        first_name: formData.first_name,
        last_name: formData.last_name,
        username: formData.username,
        email: formData.email,
        mobile: formData.mobile,
        status: formData.status === 'true' // Explicit string-to-boolean normalization
      };

      // Address field is used for students and teachers, but excluded for parents
      if (userType !== 'parents') {
        payload.address = formData.address;
      }

      // 2. Perform context-aware trimming to selectively append relevant fields
      if (userType === 'students') {
        payload.class = formData.class;
        payload.roll = formData.roll;
        payload.parent_name = formData.parent_name;
        payload.parent_mobile = formData.parent_mobile;
        // Normalize empty string entries into absolute null states or zero values
        payload.fee = formData.fee === '' ? 0 : Number(formData.fee);
        payload.enrollment_state = formData.enrollment_state;
        payload.enrollment_notes = formData.enrollment_notes;
      }
      else if (userType === 'teachers') {
        payload.id_number = formData.id_number;
        payload.subjects = formData.subjects;
        payload.salary = formData.salary === '' ? 0 : Number(formData.salary);
      }
      else if (userType === 'parents') {
        payload.relationship = formData.relationship;
        payload.children_rolls = formData.children_rolls;
      }

      // 3. Dispatch the scrubbed payload structure
      const response = await api.post(`/api/user/${userType}/${id}/edit/`, payload);
      const data = response.data;

      if (data.status === 'success') {
        toast.success('Profile updated successfully!');
        navigate(`/admin-dashboard/${userType}`);
      } else {
        toast.error('Failed to update profile: ' + data.message);
      }
    } catch (error: any) {
      console.error('Error saving profile', error);
      const errMsg = error.response?.data?.message || 'An error occurred while saving the profile.';
      toast.error(errMsg);
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="max-w-4xl space-y-6 animate-pulse">
        <div className="h-6 w-40 bg-slate-200 rounded-lg"></div>
        <div className="h-125 bg-slate-200 rounded-2xl"></div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-blue-600 mb-6 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Directory
      </button>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8">
        <div className="mb-8 border-b border-slate-100 pb-4 flex flex-wrap justify-between items-center gap-3">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-2xl text-blue-600 bg-blue-50">
              <UserCog className="w-7 h-7" strokeWidth={2.5} />
            </div>
            <div>
              <h1 className="text-2xl font-extrabold text-slate-800 capitalize">Edit {userType?.slice(0, -1)} Profile</h1>
              <p className="text-slate-500 text-sm mt-0.5">Update personal, academic, and system information below.</p>
            </div>
          </div>
          {classTeacherInfo.is_class_teacher && (
            <span className="inline-flex items-center gap-1.5 text-xs font-bold bg-amber-50 text-amber-700 px-3 py-1.5 rounded-full">
              <Star className="w-3.5 h-3.5 fill-amber-500 text-amber-500" /> Class Teacher &middot; {classTeacherInfo.class_teacher_of}
            </span>
          )}
        </div>

        {userType === 'teachers' && classTeacherInfo.is_class_teacher && (
          <p className="text-xs text-slate-400 -mt-4 mb-6">
            Homeroom assignment is managed from Class Operations, not here.
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-8">

          {/* SECTION 1: Core Account Details */}
          <div>
            <h3 className="text-lg font-semibold text-slate-800 border-b border-slate-100 pb-2 mb-4">Account Details</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">First Name</label>
                <input type="text" name="first_name" value={formData.first_name} onChange={handleChange} title="First Name" className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none bg-slate-50 transition-all" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Last Name</label>
                <input type="text" name="last_name" value={formData.last_name} onChange={handleChange} title="Last Name" placeholder="Enter last name" className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none bg-slate-50 transition-all" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Username (System ID)</label>
                <input type="text" name="username" value={formData.username} onChange={handleChange} title="Username" className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none bg-slate-50 transition-all" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Email Address</label>
                <input type="email" name="email" value={formData.email} onChange={handleChange} title="Email Address" className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none bg-slate-50 transition-all" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Mobile Number</label>
                <input type="text" name="mobile" value={formData.mobile} onChange={handleChange} title="Mobile Number" className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none bg-slate-50 transition-all" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Account Status</label>
                <select name="status" value={formData.status} onChange={handleChange} title="Account Status" className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none bg-slate-50 transition-all cursor-pointer">
                  <option value="true">Active / Approved</option>
                  <option value="false">Pending / Suspended</option>
                </select>
              </div>

              {userType !== 'parents' && (
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Home Address</label>
                  <input type="text" name="address" value={formData.address} onChange={handleChange} title="Home Address" className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none bg-slate-50 transition-all" />
                </div>
              )}
            </div>
          </div>

          {/* SECTION 2: Specific Role Details */}
          <div>
            <h3 className="text-lg font-semibold text-slate-800 border-b border-slate-100 pb-2 mb-4">
              {userType === 'students' ? 'Academic & Parent Details' : userType === 'teachers' ? 'Professional Details' : 'Relationship Details'}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

              {/* STUDENT FIELDS */}
              {userType === 'students' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Admission Number (Roll)</label>
                    <input type="text" name="roll" value={formData.roll} onChange={handleChange} title="Admission Number" className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none bg-slate-50 transition-all" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Class Enrolled</label>
                    <input type="text" name="class" value={formData.class} onChange={handleChange} title="Class Enrolled" className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none bg-slate-50 transition-all" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Fee Balance</label>
                    <input type="number" name="fee" value={formData.fee} onChange={handleChange} title="Fee Balance" className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none bg-slate-50 transition-all" />
                  </div>
                  <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6 mt-2">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Parent/Guardian Name</label>
                      <input type="text" name="parent_name" value={formData.parent_name} onChange={handleChange} title="Parent/Guardian Name" className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none bg-slate-50 transition-all" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Parent Mobile</label>
                      <input type="text" name="parent_mobile" value={formData.parent_mobile} onChange={handleChange} title="Parent Mobile" className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none bg-slate-50 transition-all" />
                    </div>
                  </div>

                  <div className="md:col-span-2 bg-amber-50 p-5 rounded-xl border border-amber-100 mt-2">
                    <h4 className="font-bold text-amber-900 mb-3 text-sm uppercase tracking-wider">Enrollment Status</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="enrollment_state" className="block text-sm font-medium text-amber-800 mb-1">Status</label>
                        <select id="enrollment_state" name="enrollment_state" value={formData.enrollment_state} onChange={handleChange} className="w-full p-2 border border-amber-200 rounded-lg focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none bg-white transition-all cursor-pointer">
                          <option value="Active">Active</option>
                          <option value="Suspended">Suspended</option>
                          <option value="Expelled">Expelled</option>
                          <option value="Transferred">Transferred Out</option>
                        </select>
                      </div>
                    </div>
                    {formData.enrollment_state !== 'Active' && (
                      <div className="mt-4">
                        <label htmlFor="enrollment_notes" className="block text-sm font-medium text-amber-800 mb-1">Reason / Notes</label>
                        <textarea id="enrollment_notes" name="enrollment_notes" value={formData.enrollment_notes} onChange={handleChange} rows={2} placeholder="Why is this student flagged?" className="w-full p-2 border border-amber-200 rounded-lg focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none bg-white transition-all resize-none" />
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* TEACHER FIELDS */}
              {userType === 'teachers' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">National ID Number</label>
                    <input type="text" name="id_number" value={formData.id_number} onChange={handleChange} title="National ID Number" className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none bg-slate-50 transition-all" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Monthly Salary (Ksh)</label>
                    <input type="number" name="salary" value={formData.salary} onChange={handleChange} title="Monthly Salary (Ksh)" className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none bg-slate-50 transition-all" />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-slate-700 mb-1">Subjects Taught (Comma separated)</label>
                    <input type="text" name="subjects" value={formData.subjects} onChange={handleChange} title="Subjects Taught" className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none bg-slate-50 transition-all" />
                  </div>
                </>
              )}

              {/* PARENT FIELDS */}
              {userType === 'parents' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Relationship to Child</label>
                    <select name="relationship" value={formData.relationship} onChange={handleChange} title="Relationship to Child" className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none bg-slate-50 transition-all cursor-pointer">
                      <option value="Father">Father</option>
                      <option value="Mother">Mother</option>
                      <option value="Guardian">Guardian</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>

                  <div className="md:col-span-2 bg-blue-50 p-5 rounded-xl border border-blue-100 mt-2">
                    <h4 className="font-bold text-blue-900 mb-3 text-sm uppercase tracking-wider">Linked Children Management</h4>

                    <div className="mb-4 bg-white p-3 rounded-lg border border-blue-50 shadow-sm">
                      <span className="block text-xs font-semibold text-slate-500 mb-1">Currently Linked Students:</span>
                      <p className="text-slate-800 font-medium">
                        {formData.children_display ? formData.children_display : <span className="text-red-500 italic">No students currently linked.</span>}
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-blue-800 mb-1">Update Linked Admission Numbers (Rolls)</label>
                      <input
                        type="text"
                        name="children_rolls"
                        value={formData.children_rolls}
                        onChange={handleChange}
                        placeholder="e.g. 1001, 1005"
                        className="w-full p-2 border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none bg-white transition-all"
                      />
                      <p className="text-xs text-blue-600 mt-2">Enter the admission numbers separated by commas to update the links. To remove all children, clear this field.</p>
                    </div>
                  </div>
                </>
              )}

            </div>
          </div>

          <div className="flex justify-end pt-4 border-t border-slate-100 mt-8">
            <button type="submit" disabled={saving} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-lg font-medium transition-colors shadow-sm disabled:bg-blue-300">
              <Save className="w-5 h-5" />
              {saving ? 'Saving Changes...' : 'Save All Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
