import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import { GraduationCap, UserPlus, Wand2, ImageUp } from 'lucide-react';
import AuthShellLayout from '../../components/AuthShellLayout';
import FormFieldErrors from '../../components/FormFieldErrors';
import SuccessModal from '../../components/SuccessModal';
import SubmitButton from '../../components/SubmitButton';
import PasswordField from '../../components/PasswordField';
import { signupStudent, fetchStudentSignupClassStreams, parseApiError } from '../../api/publicApi';
import { DAWN_GOLD } from '../../theme/publicTheme';

interface ClassStreamOption {
  id: number;
  name: string;
}

// Ports templates/school/students/studentsignup.html verbatim for copy/field labels, and
// StudentUserForm + StudentExtraForm (school/forms.py) for field names/required-ness.
// The show/hide/required conditional logic for family-structure fields reproduces
// static/js/student_signup.js as React state instead of DOM toggling.
export default function StudentSignup() {
  const navigate = useNavigate();
  const [classStreams, setClassStreams] = useState<ClassStreamOption[]>([]);
  const [profilePic, setProfilePic] = useState<File | null>(null);
  const [fields, setFields] = useState({
    first_name: '', last_name: '', username: '', password: '', password2: '',
    family_structure: '', single_parent_type: '',
    father_name: '', father_mobile: '', mother_name: '', mother_mobile: '',
    guardian_name: '', guardian_mobile: '', guardian_relationship: '',
    cl: '', mobile: '', address: '',
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>();
  const [generalError, setGeneralError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    fetchStudentSignupClassStreams()
      .then((res) => setClassStreams(res.data.class_streams))
      .catch(() => setClassStreams([]));
  }, []);

  const set = (key: keyof typeof fields) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setFields((f) => ({ ...f, [key]: e.target.value }));

  const structure = fields.family_structure;
  const showBothOrSingle = structure === 'both' || structure === 'single';
  const showFather = structure === 'both' || (structure === 'single' && fields.single_parent_type === 'Father');
  const showMother = structure === 'both' || (structure === 'single' && fields.single_parent_type === 'Mother');
  const showGuardian = structure === 'guardian';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFieldErrors(undefined);
    setGeneralError('');
    setSubmitting(true);
    try {
      const res = await signupStudent({ ...fields, profile_pic: profilePic ?? undefined });
      setSuccessMessage(res.data.message);
    } catch (err) {
      const data = parseApiError(err);
      if (data?.field_errors) setFieldErrors(data.field_errors);
      else setGeneralError(data?.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShellLayout role="student" icon={GraduationCap} kind="REGISTRATION">
      <SuccessModal
        open={Boolean(successMessage)}
        message={successMessage}
        onClose={() => navigate('/studentlogin')}
      />

      <Box sx={{ mb: 3, textAlign: 'center' }}>
        <Box sx={{ width: 56, height: 56, mx: 'auto', mb: 1.5, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: 'primary.main', color: '#fff' }}>
          <GraduationCap size={26} />
        </Box>
        <Typography variant="h5" sx={{
          fontWeight: 800
        }}>Student Admission</Typography>
        <Typography variant="body2" sx={{
          color: "text.secondary"
        }}>Register for the new academic term.</Typography>
      </Box>

      <FormFieldErrors errors={fieldErrors} generalMessage={generalError} />

      <Box component="form" onSubmit={handleSubmit} encType="multipart/form-data">
        <Grid container spacing={2.5}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="First Name" value={fields.first_name} onChange={set('first_name')} required fullWidth placeholder="e.g. Kamau" />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="Last Name" value={fields.last_name} onChange={set('last_name')} required fullWidth placeholder="e.g. Ochieng" />
          </Grid>

          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Username (Admission No)" value={fields.username} onChange={set('username')} required fullWidth
              placeholder="e.g. ADM-2026001" slotProps={{ htmlInput: { maxLength: 20 } }}
              helperText="Max 20 characters. This becomes your admission number and login."
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <PasswordField label="Password" value={fields.password} onChange={set('password')} required fullWidth placeholder="Create a strong password" slotProps={{ htmlInput: { minLength: 8 } }} />
          </Grid>

          <Grid size={{ xs: 12, sm: 6 }}>
            <PasswordField label="Confirm Password" value={fields.password2} onChange={set('password2')} required fullWidth placeholder="Repeat password" />
          </Grid>

          <Grid size={12}>
            <TextField
              select label="Family Structure" value={fields.family_structure}
              onChange={set('family_structure')} required fullWidth
              helperText="This determines which contact details we ask for below."
            >
              <MenuItem value="both">Both Parents</MenuItem>
              <MenuItem value="single">Single Parent</MenuItem>
              <MenuItem value="guardian">Guardian</MenuItem>
            </TextField>
          </Grid>

          {showBothOrSingle && (
            <>
              {structure === 'single' && (
                <Grid size={12}>
                  <TextField
                    select label="This parent is the child's" value={fields.single_parent_type}
                    onChange={set('single_parent_type')} required fullWidth
                  >
                    <MenuItem value="Mother">Mother</MenuItem>
                    <MenuItem value="Father">Father</MenuItem>
                  </TextField>
                </Grid>
              )}

              {showFather && (
                <>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField label="Father's Name" value={fields.father_name} onChange={set('father_name')} required fullWidth placeholder="e.g. Mr. John Doe" />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField label="Father's Mobile" value={fields.father_mobile} onChange={set('father_mobile')} required fullWidth placeholder="e.g. 0733 000 111" />
                  </Grid>
                </>
              )}

              {showMother && (
                <>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField label="Mother's Name" value={fields.mother_name} onChange={set('mother_name')} required fullWidth placeholder="e.g. Mrs. Jane Doe" />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField label="Mother's Mobile" value={fields.mother_mobile} onChange={set('mother_mobile')} required fullWidth placeholder="e.g. 0722 000 000" />
                  </Grid>
                </>
              )}
            </>
          )}

          {showGuardian && (
            <>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField label="Guardian's Name" value={fields.guardian_name} onChange={set('guardian_name')} required fullWidth placeholder="e.g. Mrs. Wanjiru Kamau" />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField label="Guardian's Mobile" value={fields.guardian_mobile} onChange={set('guardian_mobile')} required fullWidth placeholder="e.g. 0722 000 000" />
              </Grid>
              <Grid size={12}>
                <TextField
                  label="Relationship to Child (e.g. Aunt, Grandfather)"
                  value={fields.guardian_relationship} onChange={set('guardian_relationship')} fullWidth placeholder="e.g. Aunt"
                />
              </Grid>
            </>
          )}

          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              select label="Current Grade / Stream" value={fields.cl} onChange={set('cl')} required fullWidth
            >
              {classStreams.length === 0 && <MenuItem value="" disabled>No class streams available yet.</MenuItem>}
              {classStreams.map((s) => (
                <MenuItem key={s.id} value={String(s.id)}>{s.name}</MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="Mobile (Optional)" value={fields.mobile} onChange={set('mobile')} fullWidth placeholder="e.g. 0712 345 678" />
          </Grid>

          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="Home Address" value={fields.address} onChange={set('address')} required fullWidth placeholder="e.g. Plot 45, Buruburu" />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <Paper variant="outlined" sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 1.5, height: '100%' }}>
              <Wand2 size={18} color={DAWN_GOLD} />
              <Typography variant="body2">
                Assigning <b>@student.myfantasia.com</b> automatically.
              </Typography>
            </Paper>
          </Grid>

          <Grid size={12}>
            <Typography
              variant="body2"
              sx={{
                fontWeight: 600,
                mb: 1
              }}>Student Photo (Passport Size)</Typography>
            <Button component="label" variant="outlined" startIcon={<ImageUp size={18} />}>
              {profilePic ? profilePic.name : 'Choose Photo'}
              <input
                type="file" hidden accept="image/png, image/jpeg, image/jpg"
                onChange={(e) => setProfilePic(e.target.files?.[0] ?? null)}
              />
            </Button>
            <Typography
              variant="caption"
              sx={{
                color: "text.secondary",
                display: "block",
                mt: 1
              }}>
              Must be a clear JPG/PNG image. Max size: 3MB.
            </Typography>
          </Grid>

          <Grid size={12}>
            <Stack spacing={2}>
              <SubmitButton
                icon={<UserPlus size={18} />}
                idleLabel="Submit Application"
                busyLabel="Submitting…"
                successLabel="Submitted"
                submitting={submitting}
                succeeded={false}
              />
              <Typography
                variant="body2"
                sx={{
                  color: "text.secondary",
                  textAlign: "center"
                }}>
                Already admitted? <Link component={RouterLink} to="/studentlogin" sx={{
                fontWeight: 600
              }}>Access Portal</Link>
              </Typography>
            </Stack>
          </Grid>
        </Grid>
      </Box>
    </AuthShellLayout>
  );
}
