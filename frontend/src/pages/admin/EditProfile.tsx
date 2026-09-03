import { useEffect, useState, type ReactNode } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Save, UserCog, Star, Calendar, Eye } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../libs/axiosInstance';
import SearchableSelect from '../../components/common/SearchableSelect';

interface SubjectOption {
  id: number;
  code: string;
  name: string;
}

interface ClassStreamOption {
  value: string;
  label: string;
}

// Shared input/select/textarea recipe -- bg-slate-50/dark:slate-800 surface, focus ring
// gets a dark companion too so the ring stays visible against the darker background.
const INPUT_CLS = "w-full p-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500/20 dark:focus:ring-blue-400/20 focus:border-blue-500 dark:focus:border-blue-400 outline-none bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 transition-all";
const INPUT_CLS_WHITE = "w-full p-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500/20 dark:focus:ring-blue-400/20 focus:border-blue-500 dark:focus:border-blue-400 outline-none bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 transition-all";
const LABEL_CLS = "block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1";

// One independent card in the form's grid — wide screens fit two of these side by side
// instead of every section stacking in one narrow column.
function FieldCard({ title, span, children }: { title: string; span?: string; children: ReactNode }) {
  return (
    <div className={`bg-white dark:bg-slate-900 rounded-2xl shadow-sm dark:shadow-none border border-slate-100 dark:border-slate-700 p-6 sm:p-8 ${span ?? ''}`}>
      <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100 border-b border-slate-100 dark:border-slate-700 pb-2 mb-4">{title}</h3>
      {children}
    </div>
  );
}

export default function EditProfile() {
  const { userType, id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Real eligibility source (TeacherExtra.qualified_subjects) — every allocation/eligibility
  // check reads this, not the legacy free-text 'subjects' field.
  const [allSubjects, setAllSubjects] = useState<SubjectOption[]>([]);
  const [qualifiedSubjectIds, setQualifiedSubjectIds] = useState<number[]>([]);

  // Class/stream picker for students — must submit the real ClassStream id, not its
  // display name (the backend only accepts an integer class_id; a free-text name was
  // silently ignored, so class re-assignment via this form never actually applied).
  const [classOptions, setClassOptions] = useState<ClassStreamOption[]>([]);
  const [classId, setClassId] = useState<string>('');

  // Read-only context about the teacher's homeroom assignment (set elsewhere, in Class Operations)
  const [classTeacherInfo, setClassTeacherInfo] = useState<{ is_class_teacher: boolean; class_teacher_of: string | null }>({
    is_class_teacher: false,
    class_teacher_of: null,
  });
  // Read-only context shown in the header — not editable here, just useful to see at a glance.
  const [joinDate, setJoinDate] = useState<string | null>(null);

  // Expanded Unified Form State
  const [formData, setFormData] = useState({
    first_name: '', last_name: '', username: '', email: '',
    mobile: '', address: '', status: 'true',
    class: '', roll: '', fee: '', parent_name: '', parent_mobile: '',
    family_structure: '', single_parent_type: '',
    father_name: '', father_mobile: '', mother_name: '', mother_mobile: '',
    guardian_name: '', guardian_mobile: '', guardian_relationship: '',
    subjects: '', id_number: '', salary: '',
    relationship: '', children_rolls: '', children_display: '',
    enrollment_state: 'Active', enrollment_notes: '', job_title: ''
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
            family_structure: d.family_structure || '',
            single_parent_type: d.single_parent_type || '',
            father_name: d.father_name || '',
            father_mobile: d.father_mobile || '',
            mother_name: d.mother_name || '',
            mother_mobile: d.mother_mobile || '',
            guardian_name: d.guardian_name || '',
            guardian_mobile: d.guardian_mobile || '',
            guardian_relationship: d.guardian_relationship || '',
            subjects: d.subjects || '',
            id_number: d.id_number || '',
            salary: d.salary !== undefined && d.salary !== null ? String(d.salary) : '',
            relationship: d.relationship || 'Father',
            children_rolls: d.children_rolls || '',
            children_display: d.children_display || '',
            enrollment_state: d.enrollment_state || 'Active',
            enrollment_notes: d.enrollment_notes || '',
            job_title: d.job_title || ''
          });
          setClassTeacherInfo({
            is_class_teacher: !!d.is_class_teacher,
            class_teacher_of: d.class_teacher_of || null,
          });
          setQualifiedSubjectIds(d.qualified_subject_ids || []);
          setClassId(d.cl_id ? String(d.cl_id) : '');
          setJoinDate(d.joindate || null);
        }

        if (userType === 'teachers') {
          const subjRes = await api.get('/api/manage-subjects/');
          if (subjRes.data.status === 'success') {
            setAllSubjects(subjRes.data.data);
          }
        }

        if (userType === 'students') {
          const classRes = await api.get('/api/manage-classes/');
          if (classRes.data.status === 'success') {
            const options: ClassStreamOption[] = [];
            classRes.data.data.forEach((grade: { grade_name: string; streams: { id: number; name: string }[] }) => {
              grade.streams.forEach((s) => {
                options.push({ value: String(s.id), label: `${grade.grade_name} — ${s.name}` });
              });
            });
            setClassOptions(options);
          }
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
        payload.class_id = classId;
        payload.roll = formData.roll;
        payload.parent_name = formData.parent_name;
        payload.parent_mobile = formData.parent_mobile;
        // Sent even when blank — the backend only recomputes the summary above from
        // these when at least one of them is actually filled in, so this never wipes
        // out a legacy free-text parent_name that predates the structured fields.
        payload.family_structure = formData.family_structure;
        payload.single_parent_type = formData.single_parent_type;
        payload.father_name = formData.father_name;
        payload.father_mobile = formData.father_mobile;
        payload.mother_name = formData.mother_name;
        payload.mother_mobile = formData.mother_mobile;
        payload.guardian_name = formData.guardian_name;
        payload.guardian_mobile = formData.guardian_mobile;
        payload.guardian_relationship = formData.guardian_relationship;
        // Normalize empty string entries into absolute null states or zero values
        payload.fee = formData.fee === '' ? 0 : Number(formData.fee);
        payload.enrollment_state = formData.enrollment_state;
        payload.enrollment_notes = formData.enrollment_notes;
      }
      else if (userType === 'teachers') {
        payload.id_number = formData.id_number;
        payload.qualified_subject_ids = qualifiedSubjectIds;
        payload.salary = formData.salary === '' ? 0 : Number(formData.salary);
      }
      else if (userType === 'parents') {
        payload.relationship = formData.relationship;
        payload.children_rolls = formData.children_rolls;
      }
      else if (userType === 'staff') {
        payload.id_number = formData.id_number;
        payload.job_title = formData.job_title;
      }

      // 3. Dispatch the scrubbed payload structure
      const response = await api.post(`/api/user/${userType}/${id}/edit/`, payload);
      const data = response.data;

      if (data.status === 'success') {
        toast.success('Profile updated successfully!');
        if (data.warnings && data.warnings.length > 0) {
          data.warnings.forEach((w: string) => toast(w, { icon: '⚠️', duration: 6000 }));
        }
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
      <div className="max-w-7xl mx-auto space-y-6 animate-pulse">
        <div className="h-6 w-40 bg-slate-200 dark:bg-slate-800 rounded-lg"></div>
        <div className="h-32 bg-slate-200 dark:bg-slate-800 rounded-2xl"></div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div className="h-64 bg-slate-200 dark:bg-slate-800 rounded-2xl"></div>
          <div className="h-64 bg-slate-200 dark:bg-slate-800 rounded-2xl"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm font-medium text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 mb-6 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Directory
      </button>

      {/* HEADER CARD — icon, title, read-only context badges. Editable content lives in
          the card grid below so a wide screen tiles form sections instead of one long
          scrolling column. */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm dark:shadow-none border border-slate-100 dark:border-slate-700 p-8 mb-6">
        <div className="flex flex-wrap justify-between items-center gap-3">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-2xl text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10">
              <UserCog className="w-7 h-7" strokeWidth={2.5} />
            </div>
            <div>
              <h1 className="text-2xl font-extrabold text-slate-800 dark:text-slate-100 capitalize">Edit {userType?.slice(0, -1)} Profile</h1>
              <p className="text-slate-500 dark:text-slate-400 text-sm mt-0.5">Update personal, academic, and system information below.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {classTeacherInfo.is_class_teacher && (
              <span className="inline-flex items-center gap-1.5 text-xs font-bold bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 px-3 py-1.5 rounded-full">
                <Star className="w-3.5 h-3.5 fill-amber-500 text-amber-500" /> Class Teacher &middot; {classTeacherInfo.class_teacher_of}
              </span>
            )}
            {userType === 'teachers' && joinDate && (
              <span className="inline-flex items-center gap-1.5 text-xs font-bold bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 px-3 py-1.5 rounded-full">
                <Calendar className="w-3.5 h-3.5" /> Joined {new Date(joinDate).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
              </span>
            )}
            <Link
              to={`/admin-dashboard/${userType}/view/${id}`}
              className="inline-flex items-center gap-1.5 text-xs font-bold bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 px-3 py-1.5 rounded-full hover:bg-blue-100 dark:hover:bg-blue-500/20 transition-colors"
            >
              <Eye className="w-3.5 h-3.5" /> View Full Profile
            </Link>
          </div>
        </div>

        {userType === 'teachers' && classTeacherInfo.is_class_teacher && (
          <p className="text-xs text-slate-400 dark:text-slate-500 -mt-1 mt-4">
            Homeroom assignment is managed from Class Operations, not here.
          </p>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">

        <FieldCard title="Account Details">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            <div>
              <label className={LABEL_CLS}>First Name</label>
              <input type="text" name="first_name" value={formData.first_name} onChange={handleChange} title="First Name" className={INPUT_CLS} required />
            </div>
            <div>
              <label className={LABEL_CLS}>Last Name</label>
              <input type="text" name="last_name" value={formData.last_name} onChange={handleChange} title="Last Name" placeholder="Enter last name" className={INPUT_CLS} required />
            </div>
            <div>
              <label className={LABEL_CLS}>Username (System ID)</label>
              <input type="text" name="username" value={formData.username} onChange={handleChange} title="Username" className={INPUT_CLS} required />
            </div>
            <div>
              <label className={LABEL_CLS}>Email Address</label>
              <input type="email" name="email" value={formData.email} onChange={handleChange} title="Email Address" className={INPUT_CLS} required />
            </div>
            <div>
              <label className={LABEL_CLS}>Mobile Number</label>
              <input type="text" name="mobile" value={formData.mobile} onChange={handleChange} title="Mobile Number" className={INPUT_CLS} />
            </div>
            <div>
              <label className={LABEL_CLS}>Account Status</label>
              <select name="status" value={formData.status} onChange={handleChange} title="Account Status" className={`${INPUT_CLS} cursor-pointer`}>
                <option value="true">Active / Approved</option>
                <option value="false">Pending / Suspended</option>
              </select>
            </div>

            {userType !== 'parents' && (
              <div className="md:col-span-2 xl:col-span-3">
                <label className={LABEL_CLS}>Home Address</label>
                <input type="text" name="address" value={formData.address} onChange={handleChange} title="Home Address" className={INPUT_CLS} />
              </div>
            )}
          </div>
        </FieldCard>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

          {/* STUDENT FIELDS */}
          {userType === 'students' && (
            <>
              <FieldCard title="Academic & Parent Summary">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className={LABEL_CLS}>Admission Number (Roll)</label>
                    <input type="text" name="roll" value={formData.roll} onChange={handleChange} title="Admission Number" className={INPUT_CLS} />
                  </div>
                  <div>
                    <label className={LABEL_CLS}>Class Enrolled</label>
                    <SearchableSelect
                      value={classId}
                      onChange={setClassId}
                      aria-label="Class Enrolled"
                      placeholder="-- Not Assigned --"
                      searchPlaceholder="Search grade or stream…"
                      options={classOptions}
                    />
                  </div>
                  <div>
                    <label className={LABEL_CLS}>Fee Balance</label>
                    <input type="number" name="fee" value={formData.fee} onChange={handleChange} title="Fee Balance" className={INPUT_CLS} />
                  </div>
                  <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6 mt-2">
                    <div>
                      <label className={LABEL_CLS}>Parent/Guardian Name <span className="font-normal text-slate-400 dark:text-slate-500">(summary)</span></label>
                      <input type="text" name="parent_name" value={formData.parent_name} onChange={handleChange} title="Parent/Guardian Name" className={INPUT_CLS} />
                    </div>
                    <div>
                      <label className={LABEL_CLS}>Parent Mobile <span className="font-normal text-slate-400 dark:text-slate-500">(summary)</span></label>
                      <input type="text" name="parent_mobile" value={formData.parent_mobile} onChange={handleChange} title="Parent Mobile" className={INPUT_CLS} />
                    </div>
                    <p className="md:col-span-2 text-xs text-slate-400 dark:text-slate-500 -mt-3">
                      This is a display summary. Fill in Father / Mother / Guardian details in the Family Structure card and it recomputes automatically — editing it directly only matters for accounts with no structured details yet.
                    </p>
                  </div>
                </div>
              </FieldCard>

              <FieldCard title="Enrollment Status">
                <div className="bg-amber-50 dark:bg-amber-500/10 p-5 rounded-xl border border-amber-100 dark:border-amber-500/20">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="enrollment_state" className="block text-sm font-medium text-amber-800 dark:text-amber-300 mb-1">Status</label>
                      <select id="enrollment_state" name="enrollment_state" value={formData.enrollment_state} onChange={handleChange} className="w-full p-2 border border-amber-200 dark:border-amber-500/30 rounded-lg focus:ring-2 focus:ring-amber-500/20 dark:focus:ring-amber-400/20 focus:border-amber-500 dark:focus:border-amber-400 outline-none bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 transition-all cursor-pointer">
                        <option value="Active">Active</option>
                        <option value="Suspended">Suspended</option>
                        <option value="Expelled">Expelled</option>
                        <option value="Transferred">Transferred Out</option>
                      </select>
                    </div>
                  </div>
                  {formData.enrollment_state !== 'Active' && (
                    <div className="mt-4">
                      <label htmlFor="enrollment_notes" className="block text-sm font-medium text-amber-800 dark:text-amber-300 mb-1">Reason / Notes</label>
                      <textarea id="enrollment_notes" name="enrollment_notes" value={formData.enrollment_notes} onChange={handleChange} rows={2} placeholder="Why is this student flagged?" className="w-full p-2 border border-amber-200 dark:border-amber-500/30 rounded-lg focus:ring-2 focus:ring-amber-500/20 dark:focus:ring-amber-400/20 focus:border-amber-500 dark:focus:border-amber-400 outline-none bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 transition-all resize-none" />
                    </div>
                  )}
                </div>
              </FieldCard>

              <FieldCard title="Family Structure" span="xl:col-span-2">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">Structure</label>
                    <select name="family_structure" value={formData.family_structure} onChange={handleChange} className={`${INPUT_CLS_WHITE} cursor-pointer`}>
                      <option value="">Not set</option>
                      <option value="both">Both Parents</option>
                      <option value="single">Single Parent</option>
                      <option value="guardian">Guardian</option>
                    </select>
                  </div>

                  {formData.family_structure === 'single' && (
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">This parent is the child's</label>
                      <select name="single_parent_type" value={formData.single_parent_type} onChange={handleChange} className={`${INPUT_CLS_WHITE} cursor-pointer`}>
                        <option value="">Select one</option>
                        <option value="Mother">Mother</option>
                        <option value="Father">Father</option>
                      </select>
                    </div>
                  )}

                  {(formData.family_structure === 'both' || (formData.family_structure === 'single' && formData.single_parent_type === 'Father')) && (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">Father's Name</label>
                        <input type="text" name="father_name" value={formData.father_name} onChange={handleChange} className={INPUT_CLS_WHITE} />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">Father's Mobile</label>
                        <input type="text" name="father_mobile" value={formData.father_mobile} onChange={handleChange} className={INPUT_CLS_WHITE} />
                      </div>
                    </>
                  )}

                  {(formData.family_structure === 'both' || (formData.family_structure === 'single' && formData.single_parent_type === 'Mother')) && (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">Mother's Name</label>
                        <input type="text" name="mother_name" value={formData.mother_name} onChange={handleChange} className={INPUT_CLS_WHITE} />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">Mother's Mobile</label>
                        <input type="text" name="mother_mobile" value={formData.mother_mobile} onChange={handleChange} className={INPUT_CLS_WHITE} />
                      </div>
                    </>
                  )}

                  {formData.family_structure === 'guardian' && (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">Guardian's Name</label>
                        <input type="text" name="guardian_name" value={formData.guardian_name} onChange={handleChange} className={INPUT_CLS_WHITE} />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">Guardian's Mobile</label>
                        <input type="text" name="guardian_mobile" value={formData.guardian_mobile} onChange={handleChange} className={INPUT_CLS_WHITE} />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">Relationship to Child</label>
                        <input type="text" name="guardian_relationship" value={formData.guardian_relationship} onChange={handleChange} placeholder="e.g. Aunt, Grandfather" className={INPUT_CLS_WHITE} />
                      </div>
                    </>
                  )}
                </div>
              </FieldCard>
            </>
          )}

          {/* TEACHER FIELDS */}
          {userType === 'teachers' && (
            <>
              <FieldCard title="Professional Details">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className={LABEL_CLS}>National ID Number</label>
                    <input type="text" name="id_number" value={formData.id_number} onChange={handleChange} title="National ID Number" className={INPUT_CLS} />
                  </div>
                  <div>
                    <label className={LABEL_CLS}>Monthly Salary (Ksh)</label>
                    <input type="number" name="salary" value={formData.salary} onChange={handleChange} title="Monthly Salary (Ksh)" className={INPUT_CLS} />
                  </div>
                </div>
              </FieldCard>

              <FieldCard title="Qualified Subjects">
                <p className="text-xs text-slate-400 dark:text-slate-500 mb-2">
                  Determines eligibility in Teacher Allocation — only checked subjects can be assigned to this teacher.
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-3 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800 max-h-56 overflow-y-auto">
                  {allSubjects.map((subj) => {
                    const checked = qualifiedSubjectIds.includes(subj.id);
                    return (
                      <label
                        key={subj.id}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-sm transition-colors ${checked ? 'border-blue-300 dark:border-blue-500/40 bg-blue-50 dark:bg-blue-500/10 text-blue-800 dark:text-blue-300 font-medium' : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            setQualifiedSubjectIds(prev =>
                              checked ? prev.filter(id => id !== subj.id) : [...prev, subj.id]
                            );
                          }}
                          className="accent-blue-600"
                        />
                        {subj.name}
                      </label>
                    );
                  })}
                  {allSubjects.length === 0 && (
                    <p className="col-span-full text-sm text-slate-400 dark:text-slate-500 py-2">Loading subjects…</p>
                  )}
                </div>
              </FieldCard>
            </>
          )}

          {/* STAFF FIELDS */}
          {userType === 'staff' && (
            <FieldCard title="Job Details">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className={LABEL_CLS}>Job Title</label>
                  <input type="text" name="job_title" value={formData.job_title} onChange={handleChange} title="Job Title" placeholder="e.g. Librarian, Finance Officer" className={INPUT_CLS} />
                </div>
                <div>
                  <label className={LABEL_CLS}>National ID Number</label>
                  <input type="text" name="id_number" value={formData.id_number} onChange={handleChange} title="National ID Number" className={INPUT_CLS} />
                </div>
                <div className="md:col-span-2 bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/20 rounded-xl p-4 text-sm text-blue-800 dark:text-blue-300">
                  Job title is for display only. To grant this person actual access to modules like Finance or Library, assign them a Role on the <strong>Roles &amp; Permissions</strong> page.
                </div>
              </div>
            </FieldCard>
          )}

          {/* PARENT FIELDS */}
          {userType === 'parents' && (
            <FieldCard title="Relationship & Linked Children" span="xl:col-span-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
                <div>
                  <label className={LABEL_CLS}>Relationship to Child</label>
                  <select name="relationship" value={formData.relationship} onChange={handleChange} title="Relationship to Child" className={`${INPUT_CLS} cursor-pointer`}>
                    <option value="Father">Father</option>
                    <option value="Mother">Mother</option>
                    <option value="Guardian">Guardian</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </div>

              <div className="bg-blue-50 dark:bg-blue-500/10 p-5 rounded-xl border border-blue-100 dark:border-blue-500/20">
                <h4 className="font-bold text-blue-900 dark:text-blue-300 mb-3 text-sm uppercase tracking-wider">Linked Children Management</h4>

                <div className="mb-4 bg-white dark:bg-slate-900 p-3 rounded-lg border border-blue-50 dark:border-blue-500/20 shadow-sm dark:shadow-none">
                  <span className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Currently Linked Students:</span>
                  <p className="text-slate-800 dark:text-slate-100 font-medium">
                    {formData.children_display ? formData.children_display : <span className="text-red-500 dark:text-red-400 italic">No students currently linked.</span>}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-blue-800 dark:text-blue-300 mb-1">Update Linked Admission Numbers (Rolls)</label>
                  <input
                    type="text"
                    name="children_rolls"
                    value={formData.children_rolls}
                    onChange={handleChange}
                    placeholder="e.g. 1001, 1005"
                    className="w-full p-2 border border-blue-200 dark:border-blue-500/30 rounded-lg focus:ring-2 focus:ring-blue-500/20 dark:focus:ring-blue-400/20 focus:border-blue-500 dark:focus:border-blue-400 outline-none bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 transition-all"
                  />
                  <p className="text-xs text-blue-600 dark:text-blue-400 mt-2">Enter the admission numbers separated by commas to update the links. To remove all children, clear this field.</p>
                </div>
              </div>
            </FieldCard>
          )}

        </div>

        <div className="flex justify-end pt-4">
          <button type="submit" disabled={saving} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 hover:-translate-y-0.5 hover:shadow-md text-white px-8 py-3 rounded-lg font-medium transition-all shadow-sm disabled:bg-blue-300 dark:disabled:bg-blue-900/60">
            <Save className="w-5 h-5" />
            {saving ? 'Saving Changes...' : 'Save All Changes'}
          </button>
        </div>
      </form>
    </div>
  );
}
