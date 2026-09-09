import { Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import { ShieldCheck, UserCog, UserPlus, LogIn, Users2, Wallet, ClipboardCheck, BarChart3 } from 'lucide-react';
import AuthShellLayout from '../../components/AuthShellLayout';
import { ROLE_ACCENTS } from '../../theme/publicTheme';

const CAPABILITIES = [
  { icon: Users2, label: 'Manage TSC staff records & NEMIS uploads' },
  { icon: Wallet, label: 'Oversee school finances & M-PESA reconciliation' },
  { icon: ClipboardCheck, label: 'Approve new accounts across every role' },
  { icon: BarChart3, label: 'Real-time reports across every class' },
];

// Ports templates/school/admin/adminclick.html verbatim for copy/button labels/routes,
// with added supporting content (photo + concrete capabilities) so this gateway page
// doesn't feel like a bare placeholder between the portal picker and the real form.
export default function AdminClick() {
  const accent = ROLE_ACCENTS.admin;
  return (
    <AuthShellLayout role="admin" icon={ShieldCheck} kind="GATEWAY">
      <Stack spacing={3} sx={{ alignItems: 'center', textAlign: 'center' }}>
        <Box sx={{ width: 64, height: 64, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: 'primary.main', color: '#1A1400' }}>
          <UserCog size={30} />
        </Box>
        <Box>
          <Typography variant="h5">Admin Gateway</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>Manage the entire school ecosystem from here.</Typography>
        </Box>

        <Paper
          elevation={0}
          sx={{ width: '100%', maxWidth: 420, overflow: 'hidden', borderRadius: 3, border: '1px solid', borderColor: 'divider', position: 'relative' }}
        >
          <Box component="img" src="/images/admin-team.jpg" alt="Administrators collaborating on school operations" sx={{ width: '100%', height: 150, objectFit: 'cover', display: 'block' }} />
        </Paper>

        <Stack spacing={1.25} sx={{ width: '100%', maxWidth: 420, textAlign: 'left' }}>
          {CAPABILITIES.map((c) => (
            <Stack key={c.label} direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              <Box sx={{ width: 30, height: 30, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: `${accent}1a`, color: accent, flexShrink: 0 }}>
                <c.icon size={15} />
              </Box>
              <Typography variant="body2">{c.label}</Typography>
            </Stack>
          ))}
        </Stack>

        <Stack spacing={1.5} sx={{ width: '100%', maxWidth: 340 }}>
          <Button component={RouterLink} to="/adminsignup" variant="outlined" size="large" startIcon={<UserPlus size={18} />}>
            Register New Admin
          </Button>
          <Button component={RouterLink} to="/adminlogin" variant="contained" size="large" startIcon={<LogIn size={18} />} sx={{ bgcolor: 'primary.main', color: '#1A1400' }}>
            Login to Dashboard
          </Button>
        </Stack>

        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Not an Admin? <Link component={RouterLink} to="/" sx={{ fontWeight: 600 }}>Return Home</Link>
        </Typography>
      </Stack>
    </AuthShellLayout>
  );
}
