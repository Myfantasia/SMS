import { useState, type FormEvent } from 'react';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Link from '@mui/material/Link';
import { Users, UserRoundCog, ArrowRight } from 'lucide-react';
import AuthShellLayout from '../../components/AuthShellLayout';
import FormFieldErrors from '../../components/FormFieldErrors';
import SubmitButton from '../../components/SubmitButton';
import PasswordField from '../../components/PasswordField';
import { loginParent, parseApiError, type PostLoginDestination } from '../../api/publicApi';

const SUCCESS_HOLD_MS = 650;

// Ports templates/school/parents/parentlogin.html verbatim for copy/field labels.
export default function ParentLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [generalError, setGeneralError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [succeeded, setSucceeded] = useState(false);

  const goToDestination = (data: PostLoginDestination) => {
    if (data.destination === 'dashboard') navigate(data.path);
    else if (data.destination === 'wait-for-approval') {
      navigate('/wait-for-approval', { state: { role: data.role, visual_icon: data.visual_icon, wait_note: data.wait_note } });
    } else if (data.destination === 'external') window.location.href = data.url;
    else navigate('/portal');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setGeneralError('');
    setSubmitting(true);
    try {
      const res = await loginParent({ email, password });
      if (res.data.status === 'success') {
        setSucceeded(true);
        setTimeout(() => goToDestination(res.data), SUCCESS_HOLD_MS);
        return;
      } else {
        setGeneralError(res.data.message || 'Invalid email or password.');
      }
    } catch (err) {
      setGeneralError(parseApiError(err)?.message || 'Something went wrong. Please try again.');
    }
    setSubmitting(false);
  };

  return (
    <AuthShellLayout role="parent" icon={Users}>
      <Box sx={{ mb: 3, textAlign: 'center' }}>
        <Box sx={{ width: 56, height: 56, mx: 'auto', mb: 1.5, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: 'primary.main', color: '#1A1400' }}>
          <UserRoundCog size={26} />
        </Box>
        <Typography variant="h5">Parent Login</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>Welcome back to the parent portal.</Typography>
      </Box>

      <FormFieldErrors generalMessage={generalError} />

      <Box component="form" onSubmit={handleSubmit}>
        <Stack spacing={2.5}>
          <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required fullWidth autoFocus />
          <PasswordField label="Password" value={password} onChange={(e) => setPassword(e.target.value)} required fullWidth />

          <Box sx={{ textAlign: 'right', mt: -1.5 }}>
            <Link component={RouterLink} to="/password-reset?role=parent" variant="body2" sx={{ fontWeight: 600 }}>Forgot Password?</Link>
          </Box>

          <SubmitButton
            icon={<ArrowRight size={18} />}
            idleLabel="Sign In"
            busyLabel="Signing in…"
            successLabel="Success — redirecting…"
            submitting={submitting}
            succeeded={succeeded}
          />
        </Stack>
      </Box>

      <Typography variant="body2" sx={{ color: 'text.secondary', mt: 3, textAlign: 'center' }}>
        New Parent? <Link component={RouterLink} to="/parentsignup" sx={{ fontWeight: 600 }}>Link your child here</Link>
      </Typography>
    </AuthShellLayout>
  );
}
