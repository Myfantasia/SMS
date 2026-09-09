// AddUserModal.tsx
// Admin-only "quick add" account creation, opened from UserDirectoryTable's header.
// Unlike public self-signup (school/views/public_api_views.py), this bypasses the
// pending-approval queue entirely — accounts go live immediately with a server-generated
// temp password (api_admin_create_user, school/views/views.py), shown once via
// CodeRevealModal exactly like the existing admin-invite/verification-code reveal flows.
// Field depth (photo upload, student family/guardian details) mirrors the real signup
// pages (frontend/src/public/pages/**/*Signup.tsx) — everything here is optional since
// an admin fills it out on someone else's behalf, unlike the applicant filling it in
// themselves, but the fields exist so the profile isn't left thinner than a self-signup.
import { useEffect, useMemo, useState, useRef, type FormEvent, type ReactNode } from 'react';
import { X, UserPlus, Loader2, ImageUp, Search, User as UserIcon, GraduationCap, Users, BookOpen, Briefcase, type LucideIcon } from 'lucide-react';
import api from '../libs/axiosInstance';
import SearchableSelect from './common/SearchableSelect';
import CodeRevealModal from './common/CodeRevealModal';

type UserType = 'students' | 'teachers' | 'parents' | 'staff';

interface Props {
  userType: UserType;
  onClose: () => void;
  onCreated: () => void;
}

interface SubjectOption { id: number; name: string; }
interface RoleOption { id: number; name: string; }
interface StudentResult {
  id: number;
  roll: string;
  first_name: string;
  last_name: string;
  class_name: string | null;
  already_linked: boolean;
}

const TITLE: Record<UserType, string> = {
  students: 'Add Student',
  teachers: 'Add Teacher',
  parents: 'Add Parent',
  staff: 'Add Staff Member',
};

const INPUT_CLS = 'w-full border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 dark:focus:border-blue-400 transition';
const LABEL_CLS = 'block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5';

function Section({ icon: Icon, title, subtitle, children }: { icon: LucideIcon; title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/40 p-4 space-y-4">
      <div className="flex items-start gap-2.5">
        <div className="w-7 h-7 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex items-center justify-center shrink-0 text-slate-500 dark:text-slate-400">
          <Icon className="w-3.5 h-3.5" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">{title}</h3>
          {subtitle && <p className="text-xs text-slate-400 dark:text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

export default function AddUserModal({ userType, onClose, onCreated }: Props) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [address, setAddress] = useState('');
  const [profilePic, setProfilePic] = useState<File | null>(null);

  // Students
  const [classOptions, setClassOptions] = useState<{ value: string; label: string }[]>([]);
  const [classId, setClassId] = useState('');
  const [fee, setFee] = useState('');
  const [familyStructure, setFamilyStructure] = useState('');
  const [singleParentType, setSingleParentType] = useState('');
  const [fatherName, setFatherName] = useState('');
  const [fatherMobile, setFatherMobile] = useState('');
  const [motherName, setMotherName] = useState('');
  const [motherMobile, setMotherMobile] = useState('');
  const [guardianName, setGuardianName] = useState('');
  const [guardianMobile, setGuardianMobile] = useState('');
  const [guardianRelationship, setGuardianRelationship] = useState('');

  // Teachers
  const [allSubjects, setAllSubjects] = useState<SubjectOption[]>([]);
  const [subjectNames, setSubjectNames] = useState<string[]>([]);
  const [subjectFilter, setSubjectFilter] = useState('');
  const [salary, setSalary] = useState('');
  const [idNumber, setIdNumber] = useState('');

  // Parents
  const [relationship, setRelationship] = useState('Father');
  const [studentQuery, setStudentQuery] = useState('');
  const [studentResults, setStudentResults] = useState<StudentResult[] | null>(null);
  const [linkedStudents, setLinkedStudents] = useState<StudentResult[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Staff
  const [jobTitle, setJobTitle] = useState('');
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [roleId, setRoleId] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ username: string; email: string; temp_password: string; email_sent: boolean } | null>(null);

  useEffect(() => {
    if (userType === 'students') {
      api.get('/api/manage-classes/').then((res) => {
        if (res.data.status === 'success') {
          const options: { value: string; label: string }[] = [];
          res.data.data.forEach((grade: { grade_name: string; streams: { id: number; name: string }[] }) => {
            grade.streams.forEach((s) => options.push({ value: String(s.id), label: `${grade.grade_name} — ${s.name}` }));
          });
          setClassOptions(options);
        }
      }).catch(() => {});
    } else if (userType === 'teachers') {
      api.get('/api/manage-subjects/').then((res) => {
        if (res.data.status === 'success') setAllSubjects(res.data.data);
      }).catch(() => {});
    } else if (userType === 'staff') {
      api.get('/api/public/signup/staff/roles/').then((res) => {
        if (res.data.status === 'success') setRoles(res.data.roles);
      }).catch(() => {});
    }
  }, [userType]);

  // Debounced child search for the parent flow — same 250ms/2-char-minimum pattern as the
  // public parent signup page (frontend/src/public/pages/parent/ParentSignup.tsx), just
  // reusing the authenticated axios instance instead of a pre-login fetch helper.
  useEffect(() => {
    if (userType !== 'parents') return;
    const trimmed = studentQuery.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (trimmed.length < 2) { setStudentResults(null); return; }
    debounceRef.current = setTimeout(() => {
      api.get(`/api/parentsignup/search-students/?q=${encodeURIComponent(trimmed)}`)
        .then((res) => setStudentResults(res.data.status === 'success' ? res.data.data : []))
        .catch(() => setStudentResults([]));
    }, 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [studentQuery, userType]);

  const filteredSubjects = useMemo(() => {
    const q = subjectFilter.trim().toLowerCase();
    if (!q) return allSubjects;
    return allSubjects.filter((s) => s.name.toLowerCase().includes(q));
  }, [allSubjects, subjectFilter]);

  const toggleSubject = (name: string) => {
    setSubjectNames((prev) => prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]);
  };

  const linkStudent = (s: StudentResult) => {
    setLinkedStudents((prev) => prev.some((c) => c.id === s.id) ? prev : [...prev, s]);
    setStudentResults(null);
    setStudentQuery('');
  };

  const unlinkStudent = (id: number) => {
    setLinkedStudents((prev) => prev.filter((c) => c.id !== id));
  };

  const structure = familyStructure;
  const showBothOrSingle = structure === 'both' || structure === 'single';
  const showFather = structure === 'both' || (structure === 'single' && singleParentType === 'Father');
  const showMother = structure === 'both' || (structure === 'single' && singleParentType === 'Mother');
  const showGuardian = structure === 'guardian';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim() || !username.trim()) {
      setError('First name, last name, and username are required.');
      return;
    }
    if (userType !== 'students' && !email.trim()) {
      setError('Email is required.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('user_type', userType);
      formData.append('first_name', firstName.trim());
      formData.append('last_name', lastName.trim());
      formData.append('username', username.trim());
      formData.append('email', email.trim());
      formData.append('mobile', mobile.trim());
      formData.append('address', address.trim());
      if (profilePic) formData.append('profile_pic', profilePic);

      if (userType === 'students') {
        if (classId) formData.append('class_stream_id', classId);
        if (fee) formData.append('fee', fee);
        if (familyStructure) formData.append('family_structure', familyStructure);
        if (singleParentType) formData.append('single_parent_type', singleParentType);
        if (showFather && fatherName) formData.append('father_name', fatherName.trim());
        if (showFather && fatherMobile) formData.append('father_mobile', fatherMobile.trim());
        if (showMother && motherName) formData.append('mother_name', motherName.trim());
        if (showMother && motherMobile) formData.append('mother_mobile', motherMobile.trim());
        if (showGuardian && guardianName) formData.append('guardian_name', guardianName.trim());
        if (showGuardian && guardianMobile) formData.append('guardian_mobile', guardianMobile.trim());
        if (showGuardian && guardianRelationship) formData.append('guardian_relationship', guardianRelationship.trim());
      } else if (userType === 'teachers') {
        formData.append('id_number', idNumber.trim());
        subjectNames.forEach((name) => formData.append('subjects', name));
        formData.append('salary', salary || '0');
      } else if (userType === 'parents') {
        formData.append('relationship', relationship);
        linkedStudents.forEach((s) => formData.append('student_ids', String(s.id)));
      } else {
        formData.append('job_title', jobTitle.trim());
        if (roleId) formData.append('role_id', roleId);
        formData.append('id_number', idNumber.trim());
      }

      const res = await api.post('/api/admin-create-user/', formData);
      if (res.data.status === 'success') {
        setResult({
          username: res.data.username,
          email: res.data.email,
          temp_password: res.data.temp_password,
          email_sent: res.data.email_sent,
        });
      } else {
        setError(res.data.message || 'Could not create account.');
      }
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(message || 'Could not create account. Please try again.');
    }
    setSubmitting(false);
  };

  const finishAndClose = () => {
    onCreated();
    onClose();
  };

  if (result) {
    return (
      <CodeRevealModal
        title="Account Created"
        description={
          <>
            <span className="font-semibold text-slate-700 dark:text-slate-200">{firstName} {lastName}</span>'s account is live.
            Username: <span className="font-semibold text-slate-700 dark:text-slate-200">{result.username}</span>.
            {result.email_sent ? ' A copy was also emailed to them.' : ' Relay this password to them directly.'}
          </>
        }
        code={result.temp_password}
        onClose={finishAndClose}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200 p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl dark:shadow-none border border-transparent dark:border-slate-700 w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
        <div className="p-5 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <UserPlus className="w-4.5 h-4.5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-800 dark:text-slate-100">{TITLE[userType]}</h2>
              <p className="text-xs text-slate-400 dark:text-slate-500">Creates a live account immediately — no approval queue.</p>
            </div>
          </div>
          <button onClick={onClose} title="Close" className="text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto p-6 space-y-4 bg-white dark:bg-slate-900">
          {error && (
            <div className="text-sm font-medium text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <Section icon={UserIcon} title="Personal Details">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={LABEL_CLS}>First Name</label>
                <input className={INPUT_CLS} value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
              </div>
              <div>
                <label className={LABEL_CLS}>Last Name</label>
                <input className={INPUT_CLS} value={lastName} onChange={(e) => setLastName(e.target.value)} required />
              </div>
              <div>
                <label className={LABEL_CLS}>Username</label>
                <input className={INPUT_CLS} value={username} onChange={(e) => setUsername(e.target.value)} required />
              </div>
              {userType !== 'students' && (
                <div>
                  <label className={LABEL_CLS}>Email</label>
                  <input type="email" className={INPUT_CLS} value={email} onChange={(e) => setEmail(e.target.value)} required />
                </div>
              )}
              <div>
                <label className={LABEL_CLS}>Mobile</label>
                <input className={INPUT_CLS} value={mobile} onChange={(e) => setMobile(e.target.value)} />
              </div>
              {userType !== 'parents' && (
                <div>
                  <label className={LABEL_CLS}>Address</label>
                  <input className={INPUT_CLS} value={address} onChange={(e) => setAddress(e.target.value)} />
                </div>
              )}
            </div>

            {userType !== 'parents' && (
              <div>
                <label className={LABEL_CLS}>Profile Photo (optional)</label>
                <label className="flex items-center gap-2 w-fit cursor-pointer text-sm font-medium border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                  <ImageUp className="w-4 h-4" />
                  {profilePic ? profilePic.name : 'Choose Photo'}
                  <input
                    type="file" className="hidden" accept="image/png, image/jpeg, image/jpg"
                    onChange={(e) => setProfilePic(e.target.files?.[0] ?? null)}
                  />
                </label>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">JPG or PNG, max 5MB.</p>
              </div>
            )}
          </Section>

          {userType === 'students' && (
            <>
              <Section icon={GraduationCap} title="Class & Enrollment">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className={LABEL_CLS}>Class</label>
                    <SearchableSelect
                      value={classId}
                      onChange={setClassId}
                      aria-label="Class"
                      placeholder="-- Not Assigned --"
                      searchPlaceholder="Search grade or stream…"
                      options={classOptions}
                    />
                  </div>
                  <div>
                    <label className={LABEL_CLS}>Fee Balance (optional)</label>
                    <input type="number" className={INPUT_CLS} value={fee} onChange={(e) => setFee(e.target.value)} />
                  </div>
                </div>
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  A login email is auto-generated for students using their name.
                </p>
              </Section>

              <Section icon={Users} title="Family / Guardian Details" subtitle="Optional — can also be filled in or changed later from Edit Profile.">
                <div>
                  <label className={LABEL_CLS}>Family Structure</label>
                  <select className={INPUT_CLS} value={familyStructure} onChange={(e) => setFamilyStructure(e.target.value)}>
                    <option value="">-- Not specified --</option>
                    <option value="both">Both Parents</option>
                    <option value="single">Single Parent</option>
                    <option value="guardian">Guardian</option>
                  </select>
                </div>

                {showBothOrSingle && (
                  <>
                    {structure === 'single' && (
                      <div>
                        <label className={LABEL_CLS}>This parent is the child's</label>
                        <select className={INPUT_CLS} value={singleParentType} onChange={(e) => setSingleParentType(e.target.value)}>
                          <option value="">-- Select --</option>
                          <option value="Mother">Mother</option>
                          <option value="Father">Father</option>
                        </select>
                      </div>
                    )}
                    {showFather && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className={LABEL_CLS}>Father's Name</label>
                          <input className={INPUT_CLS} value={fatherName} onChange={(e) => setFatherName(e.target.value)} placeholder="e.g. Mr. John Doe" />
                        </div>
                        <div>
                          <label className={LABEL_CLS}>Father's Mobile</label>
                          <input className={INPUT_CLS} value={fatherMobile} onChange={(e) => setFatherMobile(e.target.value)} placeholder="e.g. 0733 000 111" />
                        </div>
                      </div>
                    )}
                    {showMother && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className={LABEL_CLS}>Mother's Name</label>
                          <input className={INPUT_CLS} value={motherName} onChange={(e) => setMotherName(e.target.value)} placeholder="e.g. Mrs. Jane Doe" />
                        </div>
                        <div>
                          <label className={LABEL_CLS}>Mother's Mobile</label>
                          <input className={INPUT_CLS} value={motherMobile} onChange={(e) => setMotherMobile(e.target.value)} placeholder="e.g. 0722 000 000" />
                        </div>
                      </div>
                    )}
                  </>
                )}

                {showGuardian && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className={LABEL_CLS}>Guardian's Name</label>
                      <input className={INPUT_CLS} value={guardianName} onChange={(e) => setGuardianName(e.target.value)} placeholder="e.g. Mrs. Wanjiru Kamau" />
                    </div>
                    <div>
                      <label className={LABEL_CLS}>Guardian's Mobile</label>
                      <input className={INPUT_CLS} value={guardianMobile} onChange={(e) => setGuardianMobile(e.target.value)} placeholder="e.g. 0722 000 000" />
                    </div>
                    <div className="md:col-span-2">
                      <label className={LABEL_CLS}>Relationship to Child</label>
                      <input className={INPUT_CLS} value={guardianRelationship} onChange={(e) => setGuardianRelationship(e.target.value)} placeholder="e.g. Aunt, Grandfather" />
                    </div>
                  </div>
                )}
              </Section>
            </>
          )}

          {userType === 'teachers' && (
            <Section icon={BookOpen} title="Qualifications">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={LABEL_CLS}>National ID Number</label>
                  <input className={INPUT_CLS} value={idNumber} onChange={(e) => setIdNumber(e.target.value)} />
                </div>
                <div>
                  <label className={LABEL_CLS}>Monthly Salary (Ksh, optional)</label>
                  <input type="number" className={INPUT_CLS} value={salary} onChange={(e) => setSalary(e.target.value)} />
                </div>
              </div>
              <div>
                <label className={LABEL_CLS}>Qualified Subjects</label>
                <div className="relative mb-2">
                  <Search className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text" value={subjectFilter} onChange={(e) => setSubjectFilter(e.target.value)}
                    placeholder="Filter subjects…"
                    className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
                  />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-3 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 max-h-48 overflow-y-auto">
                  {filteredSubjects.map((subj) => {
                    const checked = subjectNames.includes(subj.name);
                    return (
                      <label
                        key={subj.id}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-sm transition-colors ${checked ? 'border-blue-300 dark:border-blue-500/40 bg-blue-50 dark:bg-blue-500/10 text-blue-800 dark:text-blue-300 font-medium' : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                      >
                        <input type="checkbox" checked={checked} onChange={() => toggleSubject(subj.name)} className="accent-blue-600" />
                        {subj.name}
                      </label>
                    );
                  })}
                  {allSubjects.length === 0 && (
                    <p className="col-span-full text-sm text-slate-400 dark:text-slate-500 py-2">Loading subjects…</p>
                  )}
                  {allSubjects.length > 0 && filteredSubjects.length === 0 && (
                    <p className="col-span-full text-sm text-slate-400 dark:text-slate-500 py-2">No subjects match "{subjectFilter}".</p>
                  )}
                </div>
                {subjectNames.length > 0 && (
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-1.5">{subjectNames.length} subject{subjectNames.length !== 1 ? 's' : ''} selected.</p>
                )}
              </div>
            </Section>
          )}

          {userType === 'parents' && (
            <Section icon={Users} title="Relationship & Children">
              <div>
                <label className={LABEL_CLS}>Relationship</label>
                <select className={INPUT_CLS} value={relationship} onChange={(e) => setRelationship(e.target.value)}>
                  <option value="Father">Father</option>
                  <option value="Mother">Mother</option>
                  <option value="Guardian">Guardian</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div className="relative">
                <label className={LABEL_CLS}>Link Children (optional — can be added later)</label>
                <input
                  className={INPUT_CLS}
                  value={studentQuery}
                  onChange={(e) => setStudentQuery(e.target.value)}
                  placeholder="Search by name or admission number…"
                />
                {studentResults && (
                  <div className="absolute left-0 right-0 mt-1 z-10 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg dark:shadow-none max-h-56 overflow-y-auto">
                    {studentResults.length === 0 ? (
                      <p className="px-3 py-3 text-xs text-slate-400 dark:text-slate-500 text-center">No students found.</p>
                    ) : studentResults.map((s) => {
                      const isSelected = linkedStudents.some((c) => c.id === s.id);
                      return (
                        <button
                          type="button"
                          key={s.id}
                          disabled={isSelected}
                          onClick={() => linkStudent(s)}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-slate-700 dark:text-slate-200 flex items-center justify-between transition-colors"
                        >
                          <span>{s.first_name} {s.last_name} <span className="text-slate-400 dark:text-slate-500">&middot; {s.roll}</span></span>
                          {s.class_name && <span className="text-xs text-slate-400 dark:text-slate-500">{s.class_name}</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              {linkedStudents.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {linkedStudents.map((s) => (
                    <span key={s.id} className="flex items-center gap-1.5 text-xs font-medium bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 pl-2.5 pr-1.5 py-1 rounded-full">
                      {s.first_name} {s.last_name}
                      <button type="button" onClick={() => unlinkStudent(s.id)} className="hover:text-emerald-900 dark:hover:text-emerald-200">
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </Section>
          )}

          {userType === 'staff' && (
            <Section icon={Briefcase} title="Role & Employment">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={LABEL_CLS}>Job Title</label>
                  <input className={INPUT_CLS} value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="e.g. Librarian" />
                </div>
                <div>
                  <label className={LABEL_CLS}>National ID Number</label>
                  <input className={INPUT_CLS} value={idNumber} onChange={(e) => setIdNumber(e.target.value)} />
                </div>
                <div className="md:col-span-2">
                  <label className={LABEL_CLS}>Role (optional — grants dashboard permissions)</label>
                  <SearchableSelect
                    value={roleId}
                    onChange={setRoleId}
                    aria-label="Role"
                    placeholder="-- Assign later --"
                    searchPlaceholder="Search roles…"
                    options={roles.map((r) => ({ value: String(r.id), label: r.name }))}
                  />
                </div>
              </div>
            </Section>
          )}
        </form>

        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-800 flex justify-end gap-3 border-t border-slate-100 dark:border-slate-700 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors font-medium"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 hover:-translate-y-0.5 hover:shadow-md transition-all font-medium flex items-center gap-2 disabled:bg-blue-300 dark:disabled:bg-blue-900/60"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {submitting ? 'Creating…' : 'Create Account'}
          </button>
        </div>
      </div>
    </div>
  );
}
