import { Link as RouterLink } from 'react-router-dom';
import Container from '@mui/material/Container';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import GradientWord from '../components/GradientWord';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import { ArrowRight, ShieldCheck, Presentation, GraduationCap, Users, Briefcase } from 'lucide-react';
import { ROLE_ACCENTS } from '../theme/publicTheme';

const ROLES = [
  { key: 'admin', icon: ShieldCheck, title: 'Administrator', body: 'Manage staff, admissions, and system settings.', to: '/adminclick' },
  { key: 'teacher', icon: Presentation, title: 'Teacher', body: 'Mark attendance, upload results, and view schedule.', to: '/teacherclick' },
  { key: 'student', icon: GraduationCap, title: 'Student', body: 'View assignments, exam results, and fee status.', to: '/studentclick' },
  { key: 'parent', icon: Users, title: 'Parent', body: "Monitor child's progress and communicate with school.", to: '/parentclick' },
  { key: 'staff', icon: Briefcase, title: 'Staff', body: 'Librarian, finance, front office, and other support roles.', to: '/staffclick' },
];

export default function PortalSelection() {
  return (
    <Container maxWidth="lg" sx={{ py: { xs: 5, md: 8 } }}>
      <Stack
        spacing={1}
        sx={{
          alignItems: "center",
          mb: 6,
          textAlign: 'center'
        }}>
        <Typography variant="h3" sx={{ fontSize: { xs: '2rem', md: '2.6rem' } }}>
          <GradientWord>Welcome to MyFantasia</GradientWord>
        </Typography>
        <Typography variant="body1" sx={{
          color: "text.secondary"
        }}>Please select your role to access the management dashboard.</Typography>
      </Stack>

      <Grid container spacing={3} sx={{
        justifyContent: "center"
      }}>
        {ROLES.map((role) => {
          const accent = ROLE_ACCENTS[role.key];
          return (
            <Grid key={role.key} size={{ xs: 12, sm: 6, md: 4 }}>
              <Card sx={{ height: '100%', borderTop: `3px solid ${accent}` }}>
                <CardActionArea component={RouterLink} to={role.to} sx={{ height: '100%', p: 1 }}>
                  <CardContent sx={{ textAlign: 'center' }}>
                    <Box
                      sx={{
                        width: 56, height: 56, mx: 'auto', mb: 2, borderRadius: '50%',
                        display: 'grid', placeItems: 'center', bgcolor: `${accent}1a`, color: accent,
                      }}
                    >
                      <role.icon size={26} />
                    </Box>
                    <Typography
                      variant="h6"
                      sx={{
                        fontWeight: 700,
                        mb: 1
                      }}>{role.title}</Typography>
                    <Typography
                      variant="body2"
                      sx={{
                        color: "text.secondary",
                        mb: 2
                      }}>{role.body}</Typography>
                    <Stack
                      direction="row"
                      spacing={0.5}
                      sx={{
                        justifyContent: "center",
                        alignItems: "center",
                        color: accent,
                        fontWeight: 700
                      }}>
                      <span>Proceed</span>
                      <ArrowRight size={16} />
                    </Stack>
                  </CardContent>
                </CardActionArea>
              </Card>
            </Grid>
          );
        })}
      </Grid>
    </Container>
  );
}
