import { useState } from 'react';
import { Link as RouterLink, NavLink } from 'react-router-dom';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Avatar from '@mui/material/Avatar';
import Typography from '@mui/material/Typography';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Drawer from '@mui/material/Drawer';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Divider from '@mui/material/Divider';
import {
  Sun, Moon, Menu as MenuIconLucide, X, ChevronDown, LogIn,
  ShieldCheck, GraduationCap, Presentation, Users, Briefcase,
} from 'lucide-react';
import HorizonBand from './HorizonBand';
import { ROLE_ACCENTS } from '../theme/publicTheme';

const NAV_LINKS = [
  { label: 'Home', to: '/' },
  { label: 'About', to: '/aboutus' },
  { label: 'Contact', to: '/contactus' },
  { label: 'Events & Updates', to: '/events' },
];

const PORTAL_LINKS = [
  { label: 'Admin', role: 'admin', to: '/adminclick', icon: ShieldCheck },
  { label: 'Student', role: 'student', to: '/studentclick', icon: GraduationCap },
  { label: 'Teacher', role: 'teacher', to: '/teacherclick', icon: Presentation },
  { label: 'Parent', role: 'parent', to: '/parentclick', icon: Users },
  { label: 'Staff', role: 'staff', to: '/staffclick', icon: Briefcase },
];

interface NavbarProps {
  mode: 'light' | 'dark';
  onToggleMode: () => void;
}

export default function Navbar({ mode, onToggleMode }: NavbarProps) {
  const [portalAnchor, setPortalAnchor] = useState<null | HTMLElement>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <Box sx={{ position: 'sticky', top: 0, zIndex: (t) => t.zIndex.appBar }}>
      <AppBar
        position="static"
        color="transparent"
        elevation={0}
        sx={{ backdropFilter: 'blur(12px)', bgcolor: 'background.default', borderBottom: '1px solid', borderColor: 'divider' }}
      >
        <Toolbar sx={{ maxWidth: 1300, width: '100%', mx: 'auto', px: { xs: 2, md: 3 }, py: 1 }}>
          <Stack
            component={RouterLink}
            to="/"
            direction="row"
            spacing={1.25}
            sx={{ alignItems: 'center', textDecoration: 'none', color: 'text.primary', mr: 4 }}
          >
            <Avatar sx={{ bgcolor: 'primary.main', color: '#1A1400', width: 36, height: 36, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>
              M
            </Avatar>
            <Typography variant="subtitle1" sx={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, letterSpacing: 0.3 }}>
              MYFANTASIA
            </Typography>
          </Stack>

          <Stack direction="row" spacing={0.5} sx={{ display: { xs: 'none', md: 'flex' }, flexGrow: 1 }}>
            {NAV_LINKS.map((link) => (
              <Button
                key={link.to}
                component={NavLink}
                to={link.to}
                end={link.to === '/'}
                color="inherit"
                sx={{ '&.active': { color: 'primary.main' } }}
              >
                {link.label}
              </Button>
            ))}
          </Stack>

          <Box sx={{ flexGrow: { xs: 1, md: 0 } }} />

          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', display: { xs: 'none', md: 'flex' } }}>
            <Button
              variant="contained"
              disableElevation
              endIcon={<ChevronDown size={16} />}
              startIcon={<LogIn size={16} />}
              onMouseEnter={(e) => setPortalAnchor(e.currentTarget)}
              onClick={(e) => setPortalAnchor(e.currentTarget)}
              sx={{ bgcolor: 'primary.main', color: '#1A1400', '&:hover': { bgcolor: 'primary.main', opacity: 0.9 } }}
            >
              Portal Sign In
            </Button>
            <Menu
              anchorEl={portalAnchor}
              open={Boolean(portalAnchor)}
              onClose={() => setPortalAnchor(null)}
              slotProps={{ list: { onMouseLeave: () => setPortalAnchor(null), sx: { minWidth: 220, py: 1 } } }}
            >
              {PORTAL_LINKS.map((link) => (
                <MenuItem
                  key={link.to}
                  component={RouterLink}
                  to={link.to}
                  onClick={() => setPortalAnchor(null)}
                  sx={{ py: 1.1, borderLeft: '3px solid transparent', '&:hover': { borderLeftColor: ROLE_ACCENTS[link.role] } }}
                >
                  <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                    <Box sx={{ color: ROLE_ACCENTS[link.role], display: 'flex' }}>
                      <link.icon size={17} />
                    </Box>
                    <span>{link.label}</span>
                  </Stack>
                </MenuItem>
              ))}
            </Menu>

            <IconButton onClick={onToggleMode} aria-label="Switch between light and dark mode" title="Switch theme">
              {mode === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
            </IconButton>
          </Stack>

          <IconButton onClick={onToggleMode} sx={{ display: { xs: 'inline-flex', md: 'none' }, mr: 0.5 }} aria-label="Switch theme">
            {mode === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
          </IconButton>
          <IconButton
            onClick={() => setDrawerOpen(true)}
            sx={{ display: { xs: 'inline-flex', md: 'none' } }}
            aria-label="Open menu"
          >
            <MenuIconLucide size={22} />
          </IconButton>
        </Toolbar>
      </AppBar>
      <HorizonBand />

      <Drawer anchor="right" open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <Box sx={{ width: 290 }} role="presentation">
          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1.75, borderBottom: '1px solid', borderColor: 'divider' }}>
            <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
              <Avatar sx={{ bgcolor: 'primary.main', color: '#1A1400', width: 30, height: 30, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif", fontSize: 14 }}>
                M
              </Avatar>
              <Typography variant="subtitle2" sx={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700 }}>
                MYFANTASIA
              </Typography>
            </Stack>
            <IconButton onClick={() => setDrawerOpen(false)} aria-label="Close menu" size="small">
              <X size={20} />
            </IconButton>
          </Stack>

          <List onClick={() => setDrawerOpen(false)} sx={{ py: 1 }}>
            {NAV_LINKS.map((link) => (
              <ListItemButton key={link.to} component={RouterLink} to={link.to}>
                <ListItemText primary={link.label} />
              </ListItemButton>
            ))}
          </List>
          <Divider />
          <Box sx={{ px: 2, pt: 2, pb: 1 }}>
            <Typography variant="overline" color="text.secondary">Portal Sign In</Typography>
          </Box>
          <List onClick={() => setDrawerOpen(false)} sx={{ pt: 0 }}>
            {PORTAL_LINKS.map((link) => (
              <ListItemButton
                key={link.to}
                component={RouterLink}
                to={link.to}
                sx={{ borderLeft: '3px solid transparent', '&:active, &:hover': { borderLeftColor: ROLE_ACCENTS[link.role] } }}
              >
                <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                  <Box sx={{ color: ROLE_ACCENTS[link.role], display: 'flex' }}>
                    <link.icon size={18} />
                  </Box>
                  <ListItemText primary={link.label} />
                </Stack>
              </ListItemButton>
            ))}
          </List>
        </Box>
      </Drawer>
    </Box>
  );
}
