import { Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import { GraduationCap, UserPlus, LogIn, Info, LineChart, CalendarCheck, FileEdit, Wallet } from 'lucide-react';
import AuthShellLayout from '../../components/AuthShellLayout';
import { ROLE_ACCENTS } from '../../theme/publicTheme';

const CAPABILITIES = [
  { icon: LineChart, label: 'Track exam results & report cards' },
  { icon: CalendarCheck, label: 'View your class timetable & attendance' },
  { icon: FileEdit, label: 'Submit assignments online' },
  { icon: Wallet, label: 'Stay on top of fee balances' },
];

// Ports templates/school/students/studentclick.html verbatim for copy/button labels/routes,
// with added supporting content (photo + concrete capabilities).
export default function StudentClick() {
  const accent = ROLE_ACCENTS.student;
  return (
    <AuthShellLayout role="student" icon={GraduationCap} kind="GATEWAY">
      <Stack spacing={3} sx={{ alignItems: 'center', textAlign: 'center' }}>
        <Box sx={{ width: 64, height: 64, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: 'primary.main', color: '#1A1400' }}>
          <GraduationCap size={30} />
        </Box>
        <Box>
          <Typography variant="h5">Student Gateway</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>Access your classes, results, and attendance.</Typography>
        </Box>

        <Paper elevation={0} sx={{ width: '100%', maxWidth: 420, overflow: 'hidden', borderRadius: 3, border: '1px solid', borderColor: 'divider' }}>
          <Box component="img" src="/images/student-focused.jpg" alt="A student focused on classwork" sx={{ width: '100%', height: 150, objectFit: 'cover', display: 'block' }} />
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

        <Stack spacing={1} sx={{ width: '100%', maxWidth: 340 }}>
          <Button component={RouterLink} to="/studentsignup" variant="outlined" size="large" startIcon={<UserPlus size={18} />}>
            New Admission
          </Button>
          <Stack direction="row" spacing={0.75} sx={{ justifyContent: 'center', alignItems: 'flex-start', color: 'text.secondary', mb: 1 }}>
            <Info size={14} style={{ marginTop: 3, flexShrink: 0 }} />
            <Typography variant="caption">New student? Register with the admission details given by the school office.</Typography>
          </Stack>

          <Button component={RouterLink} to="/studentlogin" variant="contained" size="large" startIcon={<LogIn size={18} />} sx={{ bgcolor: 'primary.main', color: '#1A1400' }}>
            Login to Portal
          </Button>
          <Stack direction="row" spacing={0.75} sx={{ justifyContent: 'center', alignItems: 'flex-start', color: 'text.secondary' }}>
            <Info size={14} style={{ marginTop: 3, flexShrink: 0 }} />
            <Typography variant="caption">Already registered? Sign in with your admission number.</Typography>
          </Stack>
        </Stack>

        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Not a Student? <Link component={RouterLink} to="/" sx={{ fontWeight: 600 }}>Return Home</Link>
        </Typography>
      </Stack>
    </AuthShellLayout>
  );
}
