import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';
import Link from '@mui/material/Link';
import { Briefcase, Send } from 'lucide-react';
import AuthShellLayout from '../../components/AuthShellLayout';
import FormFieldErrors from '../../components/FormFieldErrors';
import SuccessModal from '../../components/SuccessModal';
import SubmitButton from '../../components/SubmitButton';
import PasswordField from '../../components/PasswordField';
import { signupStaff, fetchStaffSignupRoles, parseApiError, type PostLoginDestination } from '../../api/publicApi';

interface RoleOption {
  id: number;
  name: string;
}

// Ports templates/school/staff/staffsignup.html verbatim for copy/field labels, and the
// raw-POST validation cascade in api_signup_staff (school/views/public_api_views.py) for
// field names/required-ness. Auto-logs-in on success, same navigation contract as login.
export default function StaffSignup() {
  const navigate = useNavigate();
  const [roleOptions, setRoleOptions] = useState<RoleOption[]>([]);
  const [selectedRole, setSelectedRole] = useState<RoleOption | null>(null);
  const [fields, setFields] = useState({
    first_name: '', last_name: '', job_title: '', email: '',
    id_number: '', username: '', password: '', password2: '', mobile: '', address: '',
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>();
  const [generalError, setGeneralError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [destination, setDestination] = useState<PostLoginDestination | null>(null);

  useEffect(() => {
    fetchStaffSignupRoles()
      .then((res) => setRoleOptions(res.data.roles))
      .catch(() => setRoleOptions([]));
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
      const res = await signupStaff({ ...fields, role_id: selectedRole?.id });
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
    else navigate('/stafflogin');
  };

  return (
    <AuthShellLayout role="staff" icon={Briefcase} kind="REGISTRATION">
      <SuccessModal open={Boolean(successMessage)} message={successMessage} onClose={handleSuccessClose} />

      <Box sx={{ mb: 3, textAlign: 'center' }}>
        <Box sx={{ width: 56, height: 56, mx: 'auto', mb: 1.5, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: 'primary.main', color: '#fff' }}>
          <Briefcase size={26} />
        </Box>
        <Typography variant="h5" sx={{
          fontWeight: 800
        }}>Staff Application</Typography>
        <Typography variant="body2" sx={{
          color: "text.secondary"
        }}>Join the school&apos;s support staff. Fill in your details below for Admin approval.</Typography>
      </Box>

      <FormFieldErrors errors={fieldErrors} generalMessage={generalError} />

      <Box component="form" onSubmit={handleSubmit}>
        <Grid container spacing={2.5}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="First Name" value={fields.first_name} onChange={set('first_name')} required fullWidth placeholder="e.g. John" />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="Last Name" value={fields.last_name} onChange={set('last_name')} required fullWidth placeholder="e.g. Ochieng" />
          </Grid>

          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="Job Title" value={fields.job_title} onChange={set('job_title')} required fullWidth placeholder="e.g. Librarian, Finance Officer" />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="Email Address" type="email" value={fields.email} onChange={set('email')} required fullWidth placeholder="e.g. staff@example.com" />
          </Grid>

          <Grid size={12}>
            <Autocomplete
              options={roleOptions}
              getOptionLabel={(o) => o.name}
              isOptionEqualToValue={(o, v) => o.id === v.id}
              value={selectedRole}
              onChange={(_e, value) => setSelectedRole(value)}
              renderInput={(params) => (
                <TextField
                  {...params} label="Staff Type" required
                  helperText="This tells the Admin which access level to grant once approved — they can always adjust it later."
                />
              )}
            />
          </Grid>

          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="National ID Number" type="number" value={fields.id_number} onChange={set('id_number')} required fullWidth placeholder="e.g. 12345678" />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="Username" value={fields.username} onChange={set('username')} required fullWidth placeholder="e.g. j.ochieng" />
          </Grid>

          <Grid size={{ xs: 12, sm: 6 }}>
            <PasswordField label="Password" value={fields.password} onChange={set('password')} required fullWidth placeholder="Create a strong password" slotProps={{ htmlInput: { minLength: 8 } }} />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="Mobile Number" value={fields.mobile} onChange={set('mobile')} required fullWidth placeholder="712 345 678" />
          </Grid>

          <Grid size={{ xs: 12, sm: 6 }}>
            <PasswordField label="Confirm Password" value={fields.password2} onChange={set('password2')} required fullWidth placeholder="Repeat password" />
          </Grid>

          <Grid size={12}>
            <TextField label="Home Address" value={fields.address} onChange={set('address')} required fullWidth placeholder="e.g. Buruburu, Nairobi" />
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
                Already approved? <Link component={RouterLink} to="/stafflogin" sx={{
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
