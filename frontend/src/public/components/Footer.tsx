import { Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Avatar from '@mui/material/Avatar';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import Divider from '@mui/material/Divider';
import { MessageCircle, MapPin, Phone, Mail } from 'lucide-react';
import HorizonBand from './HorizonBand';

const PLATFORM_LINKS = [
  { label: 'About Institution', to: '/aboutus' },
  { label: 'Blog & Articles', to: '/blog' },
  { label: 'Admin Portal', to: '/adminclick' },
  { label: 'Student Portal', to: '/studentclick' },
  { label: 'Teacher Portal', to: '/teacherclick' },
  { label: 'Parent Portal', to: '/parentclick' },
];

const SUPPORT_LINKS = [
  { label: 'Help Center', to: '/contactus' },
  { label: 'Events & Updates', to: '/events' },
  { label: 'System Status', to: '/system-status' },
  { label: 'Privacy Policy', to: '/privacy-policy' },
  { label: 'Terms of Service', to: '/terms-of-service' },
];

// Every icon here is a real, working channel -- no placeholder "#" hrefs. Social
// profiles are deliberately left out until the school actually has ones to link to;
// a dead social icon reads as less professional than not showing one at all.
const CONTACT_CHANNELS = [
  { label: 'WhatsApp', icon: MessageCircle, href: 'https://wa.me/254712345678' },
  { label: 'Call us', icon: Phone, href: 'tel:+254712345678' },
  { label: 'Email us', icon: Mail, href: 'mailto:info@myfantasia.sc.ke' },
];

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <Box component="footer" sx={{ bgcolor: 'background.paper', mt: 8 }}>
      <HorizonBand height={3} />
      <Container maxWidth="lg" sx={{ py: 6 }}>
        <Grid container spacing={4}>
          <Grid size={{ xs: 12, md: 4 }}>
            <Stack
              direction="row"
              spacing={1.25}
              sx={{
                alignItems: "center",
                mb: 1.5
              }}>
              <Avatar sx={{ bgcolor: 'primary.main', width: 32, height: 32, fontWeight: 800 }}>M</Avatar>
              <Typography variant="subtitle1" sx={{
                fontWeight: 800
              }}>MYFANTASIA</Typography>
            </Stack>
            <Typography
              variant="body2"
              sx={{
                color: "text.secondary",
                maxWidth: 320,
                mb: 2
              }}>
              Empowering the next generation of learners with secure, intelligent, and
              seamless school management technology.
            </Typography>
            <Stack direction="row" spacing={1}>
              {CONTACT_CHANNELS.map((c) => (
                <IconButton
                  key={c.label}
                  size="small"
                  aria-label={c.label}
                  href={c.href}
                  target={c.href.startsWith('http') ? '_blank' : undefined}
                  rel={c.href.startsWith('http') ? 'noopener' : undefined}
                >
                  <c.icon size={18} />
                </IconButton>
              ))}
            </Stack>
          </Grid>

          <Grid size={{ xs: 6, md: 2.5 }}>
            <Typography
              variant="subtitle2"
              sx={{
                fontWeight: 700,
                mb: 1.5
              }}>Platform</Typography>
            <Stack spacing={1}>
              {PLATFORM_LINKS.map((l) => (
                <Link key={l.to} component={RouterLink} to={l.to} underline="hover" variant="body2" sx={{
                  color: "text.secondary"
                }}>
                  {l.label}
                </Link>
              ))}
            </Stack>
          </Grid>

          <Grid size={{ xs: 6, md: 2.5 }}>
            <Typography
              variant="subtitle2"
              sx={{
                fontWeight: 700,
                mb: 1.5
              }}>Support</Typography>
            <Stack spacing={1}>
              {SUPPORT_LINKS.map((l) => (
                <Link key={l.to} component={RouterLink} to={l.to} underline="hover" variant="body2" sx={{
                  color: "text.secondary"
                }}>
                  {l.label}
                </Link>
              ))}
            </Stack>
          </Grid>

          <Grid size={{ xs: 12, md: 3 }}>
            <Typography
              variant="subtitle2"
              sx={{
                fontWeight: 700,
                mb: 1.5
              }}>Contact Us</Typography>
            <Stack spacing={1.25}>
              <Stack direction="row" spacing={1.25} sx={{
                alignItems: "flex-start"
              }}>
                <MapPin size={16} style={{ marginTop: 2 }} />
                <Typography variant="body2" sx={{
                  color: "text.secondary"
                }}>Karen Plains Rd, Nairobi</Typography>
              </Stack>
              <Stack direction="row" spacing={1.25} sx={{
                alignItems: "flex-start"
              }}>
                <Phone size={16} style={{ marginTop: 2 }} />
                <Link href="tel:+254712345678" underline="hover" variant="body2" sx={{ color: "text.secondary" }}>
                  +254 712 345 678
                </Link>
              </Stack>
              <Stack direction="row" spacing={1.25} sx={{
                alignItems: "flex-start"
              }}>
                <Mail size={16} style={{ marginTop: 2 }} />
                <Link href="mailto:info@myfantasia.sc.ke" underline="hover" variant="body2" sx={{ color: "text.secondary" }}>
                  info@myfantasia.sc.ke
                </Link>
              </Stack>
            </Stack>
          </Grid>
        </Grid>

        <Divider sx={{ my: 4 }} />

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{
          justifyContent: "space-between"
        }}>
          <Typography variant="caption" sx={{
            color: "text.secondary"
          }}>
            © {year} MyFantasia School Management System. All Rights Reserved.
          </Typography>
          <Typography variant="caption" sx={{
            color: "text.secondary"
          }}>Designed for Excellence.</Typography>
        </Stack>
      </Container>
    </Box>
  );
}
