import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import GradientWord from '../components/GradientWord';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Link from '@mui/material/Link';
import CircularProgress from '@mui/material/CircularProgress';
import { Signal, Circle } from 'lucide-react';
import { fetchSystemStatus } from '../api/publicApi';

interface Service {
  name: string;
  operational: boolean;
}

export default function SystemStatus() {
  const [services, setServices] = useState<Service[] | null>(null);
  const [allOperational, setAllOperational] = useState(true);

  useEffect(() => {
    fetchSystemStatus().then((res) => {
      setServices(res.data.services);
      setAllOperational(res.data.all_operational);
    });
  }, []);

  return (
    <Container maxWidth="md" sx={{ py: { xs: 5, md: 8 } }}>
      <Stack
        spacing={1.5}
        sx={{
          alignItems: "center",
          mb: 5,
          textAlign: 'center'
        }}>
        <Chip icon={<Signal size={14} />} label="Status" size="small" />
        <Typography variant="h3" sx={{ fontSize: { xs: '2rem', md: '2.4rem' } }}>
          System <GradientWord>Status</GradientWord>
        </Typography>
        <Typography variant="body1" sx={{
          color: "text.secondary"
        }}>
          Current operational status of the MyFantasia portal and its core services.
        </Typography>
      </Stack>

      {services === null ? (
        <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        <>
          <Paper
            variant="outlined"
            sx={{
              p: 3, mb: 3, display: 'flex', alignItems: 'center', gap: 2,
              borderColor: allOperational ? 'success.main' : 'error.main',
            }}
          >
            <Circle size={14} color={allOperational ? '#10b981' : '#ef4444'} fill={allOperational ? '#10b981' : '#ef4444'} />
            <Box>
              <Typography variant="subtitle1" sx={{
                fontWeight: 700
              }}>
                {allOperational ? 'All Systems Operational' : 'Some Systems Are Experiencing Issues'}
              </Typography>
              <Typography variant="body2" sx={{
                color: "text.secondary"
              }}>
                {allOperational
                  ? 'Every core service is running normally as of your latest page load.'
                  : 'One or more services below are currently degraded. Please check back shortly.'}
              </Typography>
            </Box>
          </Paper>

          <Paper variant="outlined">
            {services.map((service, i) => (
              <Box
                key={service.name}
                sx={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  px: 3, py: 2, borderTop: i > 0 ? '1px solid' : 'none', borderColor: 'divider',
                }}
              >
                <Typography variant="body2" sx={{
                  fontWeight: 600
                }}>{service.name}</Typography>
                <Chip
                  size="small"
                  icon={<Circle size={10} fill="currentColor" />}
                  label={service.operational ? 'Operational' : 'Degraded'}
                  color={service.operational ? 'success' : 'error'}
                  variant="outlined"
                />
              </Box>
            ))}
          </Paper>

          <Typography
            variant="body2"
            sx={{
              color: "text.secondary",
              mt: 4,
              textAlign: 'center'
            }}>
            This page reflects a live check of the platform performed when it loads (including
            a real database connectivity check) rather than a fixed historical uptime log. If
            something looks wrong on your end that isn't shown here, please let us know via{' '}
            <Link component={RouterLink} to="/contactus">Contact Us</Link>.
          </Typography>
        </>
      )}
    </Container>
  );
}
