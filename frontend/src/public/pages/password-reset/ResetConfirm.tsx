import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams, Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import LinearProgress from '@mui/material/LinearProgress';
import { KeyRound, Check, TriangleAlert } from 'lucide-react';
import AuthShellLayout from '../../components/AuthShellLayout';
import FormFieldErrors from '../../components/FormFieldErrors';
import SubmitButton from '../../components/SubmitButton';
import PasswordField from '../../components/PasswordField';
import { checkPasswordResetToken, submitPasswordReset, parseApiError } from '../../api/publicApi';

const SUCCESS_HOLD_MS = 650;

// Ports templates/school/password_reset/password_reset_confirm.html verbatim for copy.
// A simple length/variety heuristic stands in for password_reset.js's exact strength
// score (a nice-to-have per the brief, not required to reproduce precisely).
function passwordStrength(pw: string): { pct: number; label: string; color: 'error' | 'warning' | 'success' } {
  if (!pw) return { pct: 0, label: 'At least 8 characters, and not all numbers', color: 'error' };
  let score = 0;
  if (pw.length >= 8) score += 1;
  if (pw.length >= 12) score += 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 1;
  if (/\d/.test(pw)) score += 1;
  if (/[^a-zA-Z0-9]/.test(pw)) score += 1;
  if (score <= 1) return { pct: 25, label: 'Weak', color: 'error' };
  if (score <= 3) return { pct: 60, label: 'Okay', color: 'warning' };
  return { pct: 100, label: 'Strong', color: 'success' };
}

export default function ResetConfirm() {
  const navigate = useNavigate();
  const { uidb64, token } = useParams<{ uidb64: string; token: string }>();

  // Starts already "not checking" when the route itself is malformed (no uidb64/token) --
  // `valid` defaults to false, so that case renders the same "invalid link" state as a
  // real expired/bad token without ever needing a synchronous setState inside the effect.
  const [checking, setChecking] = useState(Boolean(uidb64 && token));
  const [valid, setValid] = useState(false);
  const [password1, setPassword1] = useState('');
  const [password2, setPassword2] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>();
  const [generalError, setGeneralError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [succeeded, setSucceeded] = useState(false);

  useEffect(() => {
    if (!uidb64 || !token) return;
    checkPasswordResetToken(uidb64, token)
      .then((res) => setValid(Boolean(res.data.valid)))
      .catch(() => setValid(false))
      .finally(() => setChecking(false));
  }, [uidb64, token]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!uidb64 || !token) return;
    setFieldErrors(undefined);
    setGeneralError('');
    setSubmitting(true);
    try {
      await submitPasswordReset(uidb64, token, { new_password1: password1, new_password2: password2 });
      setSucceeded(true);
      setTimeout(() => navigate('/password-reset-complete'), SUCCESS_HOLD_MS);
      return;
    } catch (err) {
      const data = parseApiError(err);
      if (data?.field_errors) setFieldErrors(data.field_errors);
      else if (data?.valid === false) setValid(false);
      else setGeneralError(data?.message || 'Something went wrong. Please try again.');
    }
    setSubmitting(false);
  };

  const strength = passwordStrength(password1);

  if (checking) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '60vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <AuthShellLayout icon={KeyRound} kind="ACCOUNT SECURITY">
      <Box sx={{ mb: 3, textAlign: 'center' }}>
        <Box sx={{ width: 56, height: 56, mx: 'auto', mb: 1.5, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: 'primary.main', color: '#fff' }}>
          <KeyRound size={26} />
        </Box>
        <Typography variant="h5" sx={{
          fontWeight: 800
        }}>Reset Password</Typography>
        <Typography variant="body2" sx={{
          color: "text.secondary"
        }}>Secure your account with a new password.</Typography>
      </Box>

      {valid ? (
        <>
          <FormFieldErrors errors={fieldErrors} generalMessage={generalError} />
          <Box component="form" onSubmit={handleSubmit}>
            <Stack spacing={2.5}>
              <Box>
                <PasswordField
                  label="New Password" value={password1}
                  onChange={(e) => setPassword1(e.target.value)} required fullWidth
                  placeholder="Enter new password"
                />
                <Box sx={{ mt: 1 }}>
                  <LinearProgress variant="determinate" value={strength.pct} color={strength.color} sx={{ height: 6, borderRadius: 3 }} />
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>{strength.label}</Typography>
                </Box>
              </Box>

              <PasswordField
                label="Confirm Password" value={password2}
                onChange={(e) => setPassword2(e.target.value)} required fullWidth
                placeholder="Repeat password"
                error={Boolean(password2) && password2 !== password1}
                helperText={Boolean(password2) && password2 !== password1 ? 'Passwords do not match!' : ' '}
              />

              <SubmitButton
                icon={<Check size={18} />}
                idleLabel="Change Password"
                busyLabel="Updating…"
                successLabel="Password changed"
                submitting={submitting}
                succeeded={succeeded}
              />
            </Stack>
          </Box>
        </>
      ) : (
        <Stack
          spacing={2.5}
          sx={{
            alignItems: "center",
            textAlign: "center"
          }}>
          <TriangleAlert size={40} color="#dc2626" />
          <Typography sx={{
            color: "text.secondary"
          }}>This password reset link is invalid or has expired.</Typography>
          <Button component={RouterLink} to="/password-reset" variant="outlined">Request a New Link</Button>
        </Stack>
      )}
    </AuthShellLayout>
  );
}
