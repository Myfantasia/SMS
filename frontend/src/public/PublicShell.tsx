import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { getPublicTheme } from './theme/publicTheme';
import { useThemeMode } from './theme/useThemeMode';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import MaintenancePage from './components/MaintenancePage';
import { fetchCsrfCookie } from './api/publicApi';

// Root layout for every public route (mounted at "/" in App.tsx). Bootstraps the
// CSRF cookie once before any child form becomes submittable -- see api_csrf's
// docstring in school/views/public_api_views.py for why this is required, not just
// nice-to-have, now that no public page is server-rendered by Django any more.
export default function PublicShell() {
  const { mode, toggleMode } = useThemeMode();
  const theme = getPublicTheme(mode);
  const [status, setStatus] = useState<'loading' | 'ready' | 'maintenance'>('loading');

  useEffect(() => {
    let cancelled = false;
    fetchCsrfCookie()
      .then(() => {
        if (!cancelled) setStatus('ready');
      })
      .catch((error) => {
        if (cancelled) return;
        setStatus(error?.response?.status === 503 ? 'maintenance' : 'ready');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {status === 'maintenance' ? (
        <MaintenancePage />
      ) : status === 'loading' ? (
        <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
          <CircularProgress />
        </Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
          <Navbar mode={mode} onToggleMode={toggleMode} />
          <Box component="main" sx={{ flexGrow: 1 }}>
            <Outlet />
          </Box>
          <Footer />
        </Box>
      )}
    </ThemeProvider>
  );
}
