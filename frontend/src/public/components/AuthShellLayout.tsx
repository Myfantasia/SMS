import type { ComponentType, ReactNode } from 'react';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Paper from '@mui/material/Paper';
import Grid from '@mui/material/Grid';
import AuthVisualPanel, { type AuthVisualRole } from './AuthVisualPanel';

interface AuthShellLayoutProps {
  role?: AuthVisualRole;
  icon?: ComponentType<{ size?: number }>;
  kind?: string;
  children: ReactNode;
}

// Shared split-panel shell for every click/login/signup/wait-for-approval page --
// replaces static/css/auth_style.css's .auth-shell layout.
export default function AuthShellLayout({ role, icon, kind, children }: AuthShellLayoutProps) {
  return (
    <Container maxWidth="lg" sx={{ py: { xs: 4, md: 8 } }}>
      <Paper
        elevation={0}
        sx={{
          borderRadius: 4,
          overflow: 'hidden',
          border: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Grid container sx={{ alignItems: 'stretch' }}>
          <Grid size={{ xs: 12, md: 5 }} sx={{ display: 'flex' }}>
            <AuthVisualPanel role={role} icon={icon} kind={kind} />
          </Grid>
          <Grid size={{ xs: 12, md: 7 }} sx={{ display: 'flex' }}>
            <Box sx={{ p: { xs: 3, sm: 5 }, display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: { md: 560 }, width: '100%' }}>
              {children}
            </Box>
          </Grid>
        </Grid>
      </Paper>
    </Container>
  );
}
