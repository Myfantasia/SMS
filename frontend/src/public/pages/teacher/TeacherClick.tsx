import { Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import { Presentation, UserPlus, LogIn, Info, ArrowLeft, ClipboardCheck, TableProperties, MessageCircle, LineChart } from 'lucide-react';
import AuthShellLayout from '../../components/AuthShellLayout';
import { ROLE_ACCENTS } from '../../theme/publicTheme';

const CAPABILITIES = [
  { icon: ClipboardCheck, label: 'Upload CBC assessment scores & manage attendance' },
  { icon: MessageCircle, label: 'Message parents directly through the platform' },
  { icon: TableProperties, label: 'View your personal timetable' },
  { icon: LineChart, label: 'Review the Mwalimu gradebook' },
];

// Ports templates/school/teachers/teacherclick.html verbatim for copy/button labels/routes,
// with added supporting content (photo + concrete capabilities).
export default function TeacherClick() {
  const accent = ROLE_ACCENTS.teacher;
  return (
    <AuthShellLayout role="teacher" icon={Presentation} kind="GATEWAY">
      <Stack spacing={3} sx={{ alignItems: 'center', textAlign: 'center' }}>
        <Box sx={{ width: 64, height: 64, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: 'primary.main', color: '#1A1400' }}>
          <Presentation size={30} />
        </Box>
        <Box>
          <Typography variant="h5">Mwalimu Portal</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Welcome to the School Management System. Please select an option below to continue.
          </Typography>
        </Box>

        <Paper elevation={0} sx={{ width: '100%', maxWidth: 420, overflow: 'hidden', borderRadius: 3, border: '1px solid', borderColor: 'divider' }}>
          <Box component="img" src="/images/teacher-chalkboard.jpg" alt="A teacher leading a lesson" sx={{ width: '100%', height: 150, objectFit: 'cover', display: 'block' }} />
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
          <Button component={RouterLink} to="/teachersignup" variant="outlined" size="large" startIcon={<UserPlus size={18} />}>
            Apply for Teaching Position
          </Button>
          <Stack direction="row" spacing={0.75} sx={{ justifyContent: 'center', alignItems: 'flex-start', color: 'text.secondary', mb: 1 }}>
            <Info size={14} style={{ marginTop: 3, flexShrink: 0 }} />
            <Typography variant="caption">New applicant? Your account needs admin approval before you can log in.</Typography>
          </Stack>

          <Button component={RouterLink} to="/teacherlogin" variant="contained" size="large" startIcon={<LogIn size={18} />} sx={{ bgcolor: 'primary.main', color: '#1A1400' }}>
            Mwalimu Login
          </Button>
          <Stack direction="row" spacing={0.75} sx={{ justifyContent: 'center', alignItems: 'flex-start', color: 'text.secondary' }}>
            <Info size={14} style={{ marginTop: 3, flexShrink: 0 }} />
            <Typography variant="caption">Already an approved teacher? Sign in here.</Typography>
          </Stack>
        </Stack>

        <Button component={RouterLink} to="/" startIcon={<ArrowLeft size={16} />} color="inherit" sx={{ mt: 1 }}>
          Back to Home
        </Button>
      </Stack>
    </AuthShellLayout>
  );
}
