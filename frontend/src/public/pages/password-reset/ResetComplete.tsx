import { useEffect, useState } from 'react';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import { CircleCheck, LogIn } from 'lucide-react';
import AuthShellLayout from '../../components/AuthShellLayout';

// Ports templates/school/password_reset/password_reset_complete.html verbatim,
// including the 8-second auto-redirect countdown back to home.
export default function ResetComplete() {
  const navigate = useNavigate();
  const [seconds, setSeconds] = useState(8);

  useEffect(() => {
    if (seconds <= 0) {
      navigate('/');
      return;
    }
    const timer = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [seconds, navigate]);

  return (
    <AuthShellLayout icon={CircleCheck} kind="ACCOUNT SECURITY">
      <Stack
        spacing={2.5}
        sx={{
          alignItems: "center",
          textAlign: "center"
        }}>
        <Box sx={{ width: 56, height: 56, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: 'success.main', color: '#fff' }}>
          <CircleCheck size={26} />
        </Box>
        <Box>
          <Typography
            variant="h5"
            sx={{
              fontWeight: 800,
              mb: 1
            }}>Password Reset!</Typography>
          <Typography variant="body2" sx={{
            color: "text.secondary"
          }}>
            Your password has been successfully updated. You can now login with your new credentials.
          </Typography>
        </Box>

        <Button component={RouterLink} to="/" variant="contained" size="large" startIcon={<LogIn size={18} />}>
          Login Now
        </Button>
        <Typography variant="caption" sx={{
          color: "text.secondary"
        }}>
          Redirecting you home in {seconds}s — or click above to go now.
        </Typography>
      </Stack>
    </AuthShellLayout>
  );
}
