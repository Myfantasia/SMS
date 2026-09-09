import { useState, type FormEvent } from 'react';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Link from '@mui/material/Link';
import { GraduationCap, BookOpenCheck, LogIn, Info } from 'lucide-react';
import AuthShellLayout from '../../components/AuthShellLayout';
import FormFieldErrors from '../../components/FormFieldErrors';
import SubmitButton from '../../components/SubmitButton';
import PasswordField from '../../components/PasswordField';
import { loginStudent, parseApiError, type PostLoginDestination } from '../../api/publicApi';

const SUCCESS_HOLD_MS = 650;

// Ports templates/school/students/studentlogin.html verbatim for copy/field labels.
// Unlike the other 4 role logins, student login has no "Forgot Password" link -- the
// original template points students at their class teacher/school office instead.
export default function StudentLogin() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
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
      const res = await loginStudent({ username, password });
      if (res.data.status === 'success') {
        setSucceeded(true);
        setTimeout(() => goToDestination(res.data), SUCCESS_HOLD_MS);
        return;
      } else {
        setGeneralError(res.data.message || 'Invalid admission number or password.');
      }
    } catch (err) {
      setGeneralError(parseApiError(err)?.message || 'Something went wrong. Please try again.');
    }
    setSubmitting(false);
  };

  return (
    <AuthShellLayout role="student" icon={GraduationCap}>
      <Box sx={{ mb: 3, textAlign: 'center' }}>
        <Box sx={{ width: 56, height: 56, mx: 'auto', mb: 1.5, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: 'primary.main', color: '#1A1400' }}>
          <BookOpenCheck size={26} />
        </Box>
        <Typography variant="h5">Student Portal</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>Welcome back, Student</Typography>
      </Box>

      <FormFieldErrors generalMessage={generalError} />

      <Box component="form" onSubmit={handleSubmit}>
        <Stack spacing={2.5}>
          <TextField
            label="Admission Number" value={username} onChange={(e) => setUsername(e.target.value)}
            required fullWidth autoFocus
          />
          <PasswordField
            label="Password" value={password} onChange={(e) => setPassword(e.target.value)}
            required fullWidth
          />

          <Stack direction="row" spacing={0.75} sx={{ alignItems: 'flex-start', color: 'text.secondary' }}>
            <Info size={14} style={{ marginTop: 3, flexShrink: 0 }} />
            <Typography variant="caption">
              Forgot your password? Ask your class teacher or the school office to reset it for you.
            </Typography>
          </Stack>

          <SubmitButton
            icon={<LogIn size={18} />}
            idleLabel="Login"
            busyLabel="Signing in…"
            successLabel="Success — redirecting…"
            submitting={submitting}
            succeeded={succeeded}
          />
        </Stack>
      </Box>

      <Typography variant="body2" sx={{ color: 'text.secondary', mt: 3, textAlign: 'center' }}>
        New? <Link component={RouterLink} to="/studentsignup" sx={{ fontWeight: 600 }}>Register</Link>
      </Typography>
    </AuthShellLayout>
  );
}
