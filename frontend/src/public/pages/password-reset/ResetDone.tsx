import { useSearchParams, Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import { MailCheck, RotateCw } from 'lucide-react';
import AuthShellLayout from '../../components/AuthShellLayout';

// Ports templates/school/password_reset/password_reset_done.html verbatim for copy.
export default function ResetDone() {
  const [searchParams] = useSearchParams();
  const role = searchParams.get('role') || '';
  const retryUrl = `/password-reset${role ? `?role=${encodeURIComponent(role)}` : ''}`;

  return (
    <AuthShellLayout icon={MailCheck} kind="ACCOUNT SECURITY">
      <Stack
        spacing={2.5}
        sx={{
          alignItems: "center",
          textAlign: "center"
        }}>
        <Box sx={{ width: 56, height: 56, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: 'success.main', color: '#fff' }}>
          <MailCheck size={26} />
        </Box>
        <Box>
          <Typography
            variant="h5"
            sx={{
              fontWeight: 800,
              mb: 1
            }}>Check Your Email</Typography>
          <Typography
            variant="body2"
            sx={{
              color: "text.secondary",
              mb: 1.5
            }}>
            If that email matches an account, we&apos;ve sent a password reset link to it. The
            link expires in a few hours for your security.
          </Typography>
          <Typography variant="caption" sx={{
            color: "text.disabled"
          }}>
            Don&apos;t see it? Check your spam folder — or wait a few minutes and try again below.
          </Typography>
        </Box>
        <Stack spacing={1.5} sx={{ width: '100%', maxWidth: 320 }}>
          <Button component={RouterLink} to={retryUrl} variant="outlined" startIcon={<RotateCw size={16} />}>
            Try a Different Email
          </Button>
          <Button component={RouterLink} to="/" variant="contained">Return Home</Button>
        </Stack>
      </Stack>
    </AuthShellLayout>
  );
}
