import { useState, type FormEvent } from 'react';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Link from '@mui/material/Link';
import Alert from '@mui/material/Alert';
import { ShieldCheck, ShieldHalf, KeyRound, LogIn, CircleCheck } from 'lucide-react';
import AuthShellLayout from '../../components/AuthShellLayout';
import FormFieldErrors from '../../components/FormFieldErrors';
import SubmitButton from '../../components/SubmitButton';
import PasswordField from '../../components/PasswordField';
import { loginAdmin, parseApiError, type PostLoginDestination } from '../../api/publicApi';

const SUCCESS_HOLD_MS = 650;

// Ports templates/school/admin/adminlogin.html verbatim for copy/field labels, including
// the 2-step verification flow driven by school/views/public_api_views.py's api_login_admin
// (same endpoint for both steps, branching server-side on whether verification_code is
// present in the POST body -- see the plan brief for the exact response-shape contract).
export default function AdminLogin() {
  const navigate = useNavigate();
  const [step, setStep] = useState<'login' | 'verify'>('login');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [verificationEmail, setVerificationEmail] = useState('');
  const [code, setCode] = useState('');

  const [generalError, setGeneralError] = useState('');
  const [verifyError, setVerifyError] = useState('');
  const [verifiedMessage, setVerifiedMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [succeeded, setSucceeded] = useState(false);

  const goToDestination = (data: PostLoginDestination) => {
    if (data.destination === 'dashboard') navigate(data.path);
    else if (data.destination === 'wait-for-approval') {
      navigate('/wait-for-approval', { state: { role: data.role, visual_icon: data.visual_icon, wait_note: data.wait_note } });
    } else if (data.destination === 'external') window.location.href = data.url;
    else navigate('/portal');
  };

  const handleLoginSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setGeneralError('');
    setVerifiedMessage('');
    setSubmitting(true);
    try {
      const res = await loginAdmin({ email, password });
      const data = res.data;
      if (data.status === 'success') {
        setSucceeded(true);
        setTimeout(() => goToDestination(data), SUCCESS_HOLD_MS);
        return;
      } else if (data.status === 'needs_verification') {
        setVerificationEmail(data.verification_email);
        setVerifyError('');
        setStep('verify');
      } else {
        setGeneralError(data.message || 'Invalid email or password.');
      }
    } catch (err) {
      setGeneralError(parseApiError(err)?.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifySubmit = async (e: FormEvent) => {
    e.preventDefault();
    setVerifyError('');
    setSubmitting(true);
    try {
      const res = await loginAdmin({ verification_code: code, verify_email: verificationEmail });
      const data = res.data;
      if (data.status === 'success' && data.verified) {
        // Correct code, but this was just account verification, not a login -- drop back
        // to the plain login form and show the success message, matching the original
        // template's behavior exactly (no auto-navigation).
        setSucceeded(true);
        setTimeout(() => {
          setStep('login');
          setVerifiedMessage(data.message);
          setCode('');
          setSucceeded(false);
          setSubmitting(false);
        }, SUCCESS_HOLD_MS);
        return;
      } else if (data.status === 'success') {
        setSucceeded(true);
        setTimeout(() => goToDestination(data), SUCCESS_HOLD_MS);
        return;
      }
    } catch (err) {
      const data = parseApiError(err);
      if (data?.needs_verification) {
        setVerifyError(data.message || 'Incorrect verification code. Please try again.');
      } else {
        // Session expired / too many attempts -- restart from the plain login form.
        setStep('login');
        setGeneralError(data?.message || 'Verification session expired. Please log in again to restart.');
      }
    }
    setSubmitting(false);
  };

  if (step === 'verify') {
    return (
      <AuthShellLayout role="admin" icon={ShieldCheck}>
        <Box sx={{ mb: 3, textAlign: 'center' }}>
          <Box sx={{ width: 56, height: 56, mx: 'auto', mb: 1.5, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: 'primary.main', color: '#1A1400' }}>
            <ShieldHalf size={26} />
          </Box>
          <Typography variant="h5">Verify Your Account</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            An administrator approved your application. Enter the code they gave you to finish activating your account.
          </Typography>
        </Box>

        <FormFieldErrors generalMessage={verifyError} />

        <Box component="form" onSubmit={handleVerifySubmit}>
          <Stack spacing={2.5}>
            <TextField
              label="Verification Code" value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              required fullWidth autoFocus
              placeholder="6-digit code"
              slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: 6, style: { fontFamily: "'IBM Plex Mono', monospace", letterSpacing: 4, fontSize: '1.1rem' } } }}
            />
            <SubmitButton
              icon={<KeyRound size={18} />}
              idleLabel="Verify & Activate"
              busyLabel="Verifying…"
              successLabel="Verified"
              submitting={submitting}
              succeeded={succeeded}
            />
          </Stack>
        </Box>

        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 3, textAlign: 'center' }}>
          Don&apos;t have a code yet?{' '}
          <Link component="button" type="button" onClick={() => { setStep('login'); setVerifyError(''); }} sx={{ fontWeight: 600 }}>
            Back to Login
          </Link>
        </Typography>
      </AuthShellLayout>
    );
  }

  return (
    <AuthShellLayout role="admin" icon={ShieldCheck}>
      <Box sx={{ mb: 3, textAlign: 'center' }}>
        <Box sx={{ width: 56, height: 56, mx: 'auto', mb: 1.5, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: 'primary.main', color: '#1A1400' }}>
          <ShieldCheck size={26} />
        </Box>
        <Typography variant="h5">Admin Portal</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>Secure Access Gateway</Typography>
      </Box>

      {verifiedMessage && (
        <Alert severity="success" icon={<CircleCheck size={20} />} sx={{ mb: 3 }}>{verifiedMessage}</Alert>
      )}
      <FormFieldErrors generalMessage={generalError} />

      <Box component="form" onSubmit={handleLoginSubmit}>
        <Stack spacing={2.5}>
          <TextField label="Email Address" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required fullWidth autoFocus />
          <PasswordField label="Password" value={password} onChange={(e) => setPassword(e.target.value)} required fullWidth />

          <SubmitButton
            icon={<LogIn size={18} />}
            idleLabel="Login"
            busyLabel="Signing in…"
            successLabel="Success — redirecting…"
            submitting={submitting}
            succeeded={succeeded}
          />

          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
            <Link component={RouterLink} to="/password-reset?role=admin" variant="body2">Forgot Password?</Link>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              New? <Link component={RouterLink} to="/adminsignup" sx={{ fontWeight: 600 }}>Sign Up</Link>
            </Typography>
          </Stack>
        </Stack>
      </Box>
    </AuthShellLayout>
  );
}
