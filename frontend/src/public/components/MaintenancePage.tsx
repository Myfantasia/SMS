import Container from '@mui/material/Container';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import { Wrench } from 'lucide-react';
import { Link as RouterLink } from 'react-router-dom';

// Ports templates/school/maintenance.html, shown by PublicShell whenever a call to
// /api/public/* comes back 503 (MaintenanceModeMiddleware, school/middleware.py).
export default function MaintenancePage() {
  return (
    <Container maxWidth="sm" sx={{ py: 10, textAlign: 'center' }}>
      <Stack spacing={3} sx={{
        alignItems: "center"
      }}>
        <Box sx={{ color: 'primary.main' }}>
          <Wrench size={56} />
        </Box>
        <Typography variant="h4" sx={{
          fontWeight: 800
        }}>Under Maintenance</Typography>
        <Typography variant="body1" sx={{
          color: "text.secondary"
        }}>
          MyFantasia is currently undergoing scheduled maintenance. Portal access for
          students, teachers, and parents is temporarily unavailable. We'll be back
          shortly — thank you for your patience.
        </Typography>
        <Stack direction="row" spacing={2}>
          <Button component={RouterLink} to="/" variant="contained">Home</Button>
          <Button component={RouterLink} to="/system-status" variant="outlined">System Status</Button>
          <Button component={RouterLink} to="/contactus" variant="outlined">Contact Us</Button>
        </Stack>
      </Stack>
    </Container>
  );
}
