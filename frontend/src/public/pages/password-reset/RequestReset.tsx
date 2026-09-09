import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams, Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import { KeyRound, Send, Info } from 'lucide-react';
import AuthShellLayout from '../../components/AuthShellLayout';
import { requestPasswordReset } from '../../api/publicApi';

// Ports templates/school/password_reset/password_reset.html verbatim for copy. On
// submit, always proceeds to /password-reset/done regardless of outcome -- matches the
// backend's anti-enumeration design (api_password_reset_request never reveals whether
// the account existed, so the UI must not branch on that either), and mirrors the
// original Django view's own POST-then-redirect-to-done behavior.
const ROLE_LOGIN_URLS: Record<string, string> = {
  admin: '/adminlogin',
  student: '/studentlogin',
  teacher: '/teacherlogin',
  parent: '/parentlogin',
  staff: '/stafflogin',
};

export default function RequestReset() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const role = searchParams.get('role') || '';
  const loginUrl = ROLE_LOGIN_URLS[role] || '/portal';

  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await requestPasswordReset(email);
    } catch {
      // Intentionally ignored -- we proceed to the "check your email" page regardless,
      // matching the backend's "always looks successful" anti-enumeration behavior.
    } finally {
      navigate(`/password-reset/done${role ? `?role=${encodeURIComponent(role)}` : ''}`);
    }
  };

  return (
    <AuthShellLayout icon={KeyRound} kind="ACCOUNT SECURITY">
      <Box sx={{ mb: 3, textAlign: 'center' }}>
        <Box sx={{ width: 56, height: 56, mx: 'auto', mb: 1.5, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: 'primary.main', color: '#fff' }}>
          <KeyRound size={26} />
        </Box>
        <Typography variant="h5" sx={{
          fontWeight: 800
        }}>Forgot Password?</Typography>
        <Typography variant="body2" sx={{
          color: "text.secondary"
        }}>Enter your registered school email to receive a reset link.</Typography>
      </Box>

      <Box component="form" onSubmit={handleSubmit}>
        <Stack spacing={2.5}>
          <TextField
            label="Email Address" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            required fullWidth autoFocus placeholder="e.g. kamau.james@student.myfantasia.com"
          />
          <Button type="submit" variant="contained" size="large" disabled={submitting} startIcon={<Send size={18} />}>
            Send Reset Link
          </Button>
        </Stack>
      </Box>

      <Stack
        direction="row"
        spacing={0.75}
        sx={{
          alignItems: "flex-start",
          color: "text.secondary",
          mt: 2.5
        }}>
        <Info size={14} style={{ marginTop: 3, flexShrink: 0 }} />
        <Typography variant="caption">
          If that email matches an account, a reset link is on its way — the page looks the same
          either way, so this never reveals whether an account exists.
        </Typography>
      </Stack>

      <Typography
        variant="body2"
        sx={{
          color: "text.secondary",
          mt: 3,
          textAlign: 'center'
        }}>
        Remembered it? <Link component={RouterLink} to={loginUrl} sx={{
        fontWeight: 600
      }}>Back to Login</Link>
      </Typography>
    </AuthShellLayout>
  );
}
