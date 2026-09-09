import { useState, type FormEvent } from 'react';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Link from '@mui/material/Link';
import { ShieldCheck, UserPlus } from 'lucide-react';
import AuthShellLayout from '../../components/AuthShellLayout';
import FormFieldErrors from '../../components/FormFieldErrors';
import SuccessModal from '../../components/SuccessModal';
import SubmitButton from '../../components/SubmitButton';
import PasswordField from '../../components/PasswordField';
import { signupAdmin, parseApiError } from '../../api/publicApi';

// Ports templates/school/admin/adminsignup.html verbatim for copy/field labels, and
// AdminSigupForm (school/forms.py) for field names/required-ness.
export default function AdminSignup() {
  const navigate = useNavigate();
  const [fields, setFields] = useState({
    first_name: '', last_name: '', username: '', email: '',
    mobile: '', address: '', password: '', password2: '', invite_code: '',
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>();
  const [generalError, setGeneralError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  const set = (key: keyof typeof fields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFields((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFieldErrors(undefined);
    setGeneralError('');
    setSubmitting(true);
    try {
      const res = await signupAdmin(fields);
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
    <AuthShellLayout role="admin" icon={ShieldCheck} kind="REGISTRATION">
      <SuccessModal
        open={Boolean(successMessage)}
        message={successMessage}
        onClose={() => navigate('/adminlogin')}
      />

      <Box sx={{ mb: 3, textAlign: 'center' }}>
        <Box sx={{ width: 56, height: 56, mx: 'auto', mb: 1.5, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: 'primary.main', color: '#fff' }}>
          <ShieldCheck size={26} />
        </Box>
        <Typography variant="h5" sx={{
          fontWeight: 800
        }}>Admin Registration</Typography>
        <Typography variant="body2" sx={{
          color: "text.secondary"
        }}>Register as a system administrator.</Typography>
      </Box>

      <FormFieldErrors errors={fieldErrors} generalMessage={generalError} />

      <Box component="form" onSubmit={handleSubmit}>
        <Grid container spacing={2.5}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="First Name" value={fields.first_name} onChange={set('first_name')} required fullWidth placeholder="e.g. Jane" />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="Last Name" value={fields.last_name} onChange={set('last_name')} required fullWidth placeholder="e.g. Mwangi" />
          </Grid>

          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Username" value={fields.username} onChange={set('username')} required fullWidth
              placeholder="e.g. jane.mwangi" slotProps={{ htmlInput: { maxLength: 20 } }}
              helperText="Max 20 characters. You'll still sign in with your email, not this."
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="Email Address" type="email" value={fields.email} onChange={set('email')} required fullWidth placeholder="e.g. jane@myfantasia.com" />
          </Grid>

          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="Mobile Number" value={fields.mobile} onChange={set('mobile')} required fullWidth placeholder="+254 712 345 678" />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="Address" value={fields.address} onChange={set('address')} required fullWidth placeholder="Street, City" />
          </Grid>

          <Grid size={{ xs: 12, sm: 6 }}>
            <PasswordField
              label="Password" value={fields.password} onChange={set('password')} required fullWidth
              placeholder="Create a password" slotProps={{ htmlInput: { minLength: 8 } }} helperText="Minimum 8 characters."
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <PasswordField label="Confirm Password" value={fields.password2} onChange={set('password2')} required fullWidth placeholder="Repeat password" />
          </Grid>

          <Grid size={12}>
            <TextField
              label="Admin Invite Code (skip for the first admin account)"
              value={fields.invite_code} onChange={set('invite_code')} fullWidth
              placeholder="Provided by an existing administrator"
              helperText="Ask an existing admin for this — it's required for every account after the first."
            />
          </Grid>

          <Grid size={12}>
            <Stack spacing={2}>
              <SubmitButton
                icon={<UserPlus size={18} />}
                idleLabel="Register & Access Dashboard"
                busyLabel="Registering…"
                successLabel="Registered"
                submitting={submitting}
                succeeded={false}
              />
              <Typography
                variant="body2"
                sx={{
                  color: "text.secondary",
                  textAlign: "center"
                }}>
                Already an Admin? <Link component={RouterLink} to="/adminlogin" sx={{
                fontWeight: 600
              }}>Login here</Link>
              </Typography>
            </Stack>
          </Grid>
        </Grid>
      </Box>
    </AuthShellLayout>
  );
}
