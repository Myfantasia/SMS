import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import Link from '@mui/material/Link';
import CircularProgress from '@mui/material/CircularProgress';
import { alpha } from '@mui/material/styles';
import { Hourglass, Info, LogOut } from 'lucide-react';
import AuthShellLayout from '../components/AuthShellLayout';
import type { AuthVisualRole } from '../components/AuthVisualPanel';
import { fetchAfterLoginDestination } from '../api/publicApi';
import api from '../../libs/axiosInstance';

interface WaitInfo {
  role: string;
  visual_icon: string;
  wait_note: string;
}

// Ports templates/school/_wait_for_approval_card.html verbatim. Reached either via
// navigate('/wait-for-approval', {state}) straight off a login/signup page (avoids a
// redundant API round-trip), or directly (e.g. a hard refresh) -- in which case it falls
// back to GET /api/public/afterlogin/, redirecting elsewhere if the account has since
// been approved (or belongs to a role that shouldn't be here at all).
export default function WaitForApproval() {
  const location = useLocation();
  const navigate = useNavigate();
  const stateInfo = (location.state as WaitInfo | null) || null;

  const [waitInfo, setWaitInfo] = useState<WaitInfo | null>(stateInfo);
  const [loading, setLoading] = useState(!stateInfo);
  const [firstName, setFirstName] = useState('');

  useEffect(() => {
    if (waitInfo) return;
    fetchAfterLoginDestination()
      .then((res) => {
        const data = res.data;
        if (data.destination === 'wait-for-approval') {
          setWaitInfo({ role: data.role, visual_icon: data.visual_icon, wait_note: data.wait_note });
        } else if (data.destination === 'dashboard') {
          navigate(data.path, { replace: true });
        } else if (data.destination === 'external') {
          window.location.href = data.url;
        } else {
          navigate('/portal', { replace: true });
        }
      })
      .catch(() => navigate('/portal', { replace: true }))
      .finally(() => setLoading(false));
    // Only run once on mount -- navigate/waitInfo intentionally excluded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    api.get('/api/my-profile/')
      .then((res) => setFirstName(res.data?.data?.first_name || ''))
      .catch(() => {});
  }, []);

  if (loading || !waitInfo) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '60vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <AuthShellLayout role={waitInfo.role as AuthVisualRole} kind="APPLICATION STATUS">
      <Stack
        spacing={2.5}
        sx={{
          alignItems: "center",
          textAlign: "center"
        }}>
        <Box sx={{ width: 64, height: 64, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: 'warning.main', color: '#fff' }}>
          <Hourglass size={30} />
        </Box>
        <Box>
          <Typography variant="h5" sx={{
            fontWeight: 800
          }}>Application Under Review</Typography>
          <Typography variant="body2" sx={{
            color: "text.secondary"
          }}>
            Hi {firstName || 'there'}, thanks for applying.
          </Typography>
        </Box>

        <Paper variant="outlined" sx={{ p: 2.5, width: '100%', borderColor: 'warning.main', bgcolor: (theme) => alpha(theme.palette.warning.main, 0.08) }}>
          <Typography
            variant="subtitle2"
            sx={{
              fontWeight: 800,
              mb: 0.5
            }}>
            Status: Pending Admin Approval
          </Typography>
          <Typography variant="body2" sx={{
            color: "text.secondary"
          }}>{waitInfo.wait_note}</Typography>
        </Paper>

        <Stack
          direction="row"
          spacing={0.75}
          sx={{
            alignItems: "flex-start",
            color: "text.secondary"
          }}>
          <Info size={14} style={{ marginTop: 3, flexShrink: 0 }} />
          <Typography variant="caption">
            You&apos;ll get full access the moment an administrator approves your account — no need to re-apply.
          </Typography>
        </Stack>

        <Link
          href="http://localhost:8000/logout"
          underline="hover"
          color="error"
          sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, fontWeight: 600, mt: 1 }}
        >
          <LogOut size={16} /> Logout for Now
        </Link>
      </Stack>
    </AuthShellLayout>
  );
}
