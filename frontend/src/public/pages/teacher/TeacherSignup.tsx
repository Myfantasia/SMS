import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import { Presentation, Send, ImageUp } from 'lucide-react';
import AuthShellLayout from '../../components/AuthShellLayout';
import FormFieldErrors from '../../components/FormFieldErrors';
import SuccessModal from '../../components/SuccessModal';
import SubmitButton from '../../components/SubmitButton';
import PasswordField from '../../components/PasswordField';
import { signupTeacher, fetchTeacherSignupSubjects, parseApiError, type PostLoginDestination } from '../../api/publicApi';

interface SubjectOption {
  id: number;
  name: string;
}

// Ports templates/school/teachers/teachersignup.html verbatim for copy/field labels, and
// the raw-POST validation cascade in api_signup_teacher (school/views/public_api_views.py)
// for field names/required-ness. Unlike student signup, this endpoint auto-logs-in on
// success, so it follows the same post-login navigation contract as the login pages.
export default function TeacherSignup() {
  const navigate = useNavigate();
  const [subjectOptions, setSubjectOptions] = useState<SubjectOption[]>([]);
  const [selectedSubjects, setSelectedSubjects] = useState<SubjectOption[]>([]);
  const [profilePic, setProfilePic] = useState<File | null>(null);
  const [fields, setFields] = useState({
    first_name: '', last_name: '', id_number: '', email: '', username: '',
    password: '', password2: '', mobile: '', address: '',
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>();
  const [generalError, setGeneralError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [destination, setDestination] = useState<PostLoginDestination | null>(null);

  useEffect(() => {
    fetchTeacherSignupSubjects()
      .then((res) => setSubjectOptions(res.data.subjects))
      .catch(() => setSubjectOptions([]));
  }, []);

  const set = (key: keyof typeof fields) => (e: ChangeEvent<HTMLInputElement>) =>
    setFields((f) => ({ ...f, [key]: e.target.value }));

  const goToDestination = (data: PostLoginDestination) => {
    if (data.destination === 'dashboard') navigate(data.path);
    else if (data.destination === 'wait-for-approval') {
      navigate('/wait-for-approval', { state: { role: data.role, visual_icon: data.visual_icon, wait_note: data.wait_note } });
    } else if (data.destination === 'external') window.location.href = data.url;
    else navigate('/portal');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFieldErrors(undefined);
    setGeneralError('');
    setSubmitting(true);
    try {
      const res = await signupTeacher({
        ...fields,
        subjects: selectedSubjects.map((s) => s.name),
        profile_pic: profilePic ?? undefined,
      });
      setSuccessMessage(res.data.message);
      if (res.data.destination) setDestination(res.data);
    } catch (err) {
      const data = parseApiError(err);
      if (data?.field_errors) setFieldErrors(data.field_errors);
      else setGeneralError(data?.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSuccessClose = () => {
    if (destination) goToDestination(destination);
    else navigate('/teacherlogin');
  };

  return (
    <AuthShellLayout role="teacher" icon={Presentation} kind="REGISTRATION">
      <SuccessModal open={Boolean(successMessage)} message={successMessage} onClose={handleSuccessClose} />

      <Box sx={{ mb: 3, textAlign: 'center' }}>
        <Box sx={{ width: 56, height: 56, mx: 'auto', mb: 1.5, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: 'primary.main', color: '#fff' }}>
          <Presentation size={26} />
        </Box>
        <Typography variant="h5" sx={{
          fontWeight: 800
        }}>Teacher Application</Typography>
        <Typography variant="body2" sx={{
          color: "text.secondary"
        }}>Join our esteemed faculty. Fill in your details below for Admin approval.</Typography>
      </Box>

      <FormFieldErrors errors={fieldErrors} generalMessage={generalError} />

      <Box component="form" onSubmit={handleSubmit} encType="multipart/form-data">
        <Grid container spacing={2.5}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="First Name" value={fields.first_name} onChange={set('first_name')} required fullWidth placeholder="e.g. John" />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="Last Name" value={fields.last_name} onChange={set('last_name')} required fullWidth placeholder="e.g. Ochieng" />
          </Grid>

          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="National ID Number" type="number" value={fields.id_number} onChange={set('id_number')} required fullWidth placeholder="e.g. 12345678" />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="Email Address" type="email" value={fields.email} onChange={set('email')} required fullWidth placeholder="e.g. mwalimu@example.com" />
          </Grid>

          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="Username (TSC No. / Alias)" value={fields.username} onChange={set('username')} required fullWidth placeholder="name_teacher" />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <PasswordField label="Password" value={fields.password} onChange={set('password')} required fullWidth placeholder="Create a strong password" slotProps={{ htmlInput: { minLength: 8 } }} />
          </Grid>

          <Grid size={{ xs: 12, sm: 6 }}>
            <PasswordField label="Confirm Password" value={fields.password2} onChange={set('password2')} required fullWidth placeholder="Repeat password" />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="Mobile Number" value={fields.mobile} onChange={set('mobile')} required fullWidth placeholder="712 345 678" />
          </Grid>

          <Grid size={12}>
            <TextField label="Home Address" value={fields.address} onChange={set('address')} required fullWidth placeholder="e.g. Buruburu, Nairobi" />
          </Grid>

          <Grid size={12}>
            <Autocomplete
              multiple
              options={subjectOptions}
              getOptionLabel={(o) => o.name}
              isOptionEqualToValue={(o, v) => o.id === v.id}
              value={selectedSubjects}
              onChange={(_e, value) => setSelectedSubjects(value)}
              renderInput={(params) => (
                <TextField
                  {...params} label="Subjects Taught" required={selectedSubjects.length === 0}
                  helperText="Select every subject you're qualified to teach — you can pick more than one."
                />
              )}
            />
          </Grid>

          <Grid size={12}>
            <Typography
              variant="body2"
              sx={{
                fontWeight: 600,
                mb: 1
              }}>Teacher&apos;s Photo</Typography>
            <Button component="label" variant="outlined" startIcon={<ImageUp size={18} />}>
              {profilePic ? profilePic.name : 'Choose Photo'}
              <input
                type="file" hidden accept="image/*" required
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
              Please upload a clear passport-sized photo — required.
            </Typography>
          </Grid>

          <Grid size={12}>
            <Stack spacing={2}>
              <SubmitButton
                icon={<Send size={18} />}
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
                Already approved? <Link component={RouterLink} to="/teacherlogin" sx={{
                fontWeight: 600
              }}>Login Here</Link>
              </Typography>
            </Stack>
          </Grid>
        </Grid>
      </Box>
    </AuthShellLayout>
  );
}
