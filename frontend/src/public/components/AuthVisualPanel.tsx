import type { ComponentType } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import {
  ShieldCheck, GraduationCap, Presentation, Users, Briefcase,
  CalendarCheck, LineChart, TableProperties, ClipboardCheck, MessageCircle,
  Wallet, UsersRound, BarChart3, Bell, ListChecks, CalendarDays, Inbox,
  Lock, MailCheck, UserCheck,
} from 'lucide-react';
import { ROLE_ACCENTS, HORIZON_GRADIENT, DAWN_GOLD } from '../theme/publicTheme';

export type AuthVisualRole = 'admin' | 'teacher' | 'student' | 'parent' | 'staff' | undefined;

interface AuthVisualPanelProps {
  role?: AuthVisualRole;
  icon?: ComponentType<{ size?: number }>;
  kind?: string;
}

const COPY: Record<string, { title: string; tagline: string }> = {
  student: { title: 'Welcome to your Student Portal', tagline: 'Track results, attendance, and your timetable — all in one place.' },
  teacher: { title: 'Welcome to your Teacher Workspace', tagline: 'Manage classes, mark results, and message parents with ease.' },
  parent: { title: "Stay close to their School Journey", tagline: 'Real-time visibility into attendance, fees, and academic results.' },
  admin: { title: 'Command Center for Your School', tagline: 'Run staff, students, and school operations from one dashboard.' },
  staff: { title: 'Welcome to the Staff Hub', tagline: 'Everything you need to support the school, in one place.' },
  default: { title: 'Your Account, Kept Secure', tagline: "We'll only ever ask you to reset your password through this page — never by email or phone call." },
};

const BADGES: Record<string, { label: string; icon: ComponentType<{ size?: number }> }[]> = {
  student: [
    { label: 'Attendance', icon: CalendarCheck },
    { label: 'Results', icon: LineChart },
    { label: 'Timetable', icon: TableProperties },
  ],
  teacher: [
    { label: 'Gradebook', icon: ClipboardCheck },
    { label: 'Timetable', icon: TableProperties },
    { label: 'Messages', icon: MessageCircle },
  ],
  parent: [
    { label: 'Fees', icon: Wallet },
    { label: 'Attendance', icon: CalendarCheck },
    { label: 'Results', icon: LineChart },
  ],
  admin: [
    { label: 'Staff', icon: UsersRound },
    { label: 'Reports', icon: BarChart3 },
    { label: 'Alerts', icon: Bell },
  ],
  staff: [
    { label: 'Tasks', icon: ListChecks },
    { label: 'Schedule', icon: CalendarDays },
    { label: 'Inbox', icon: Inbox },
  ],
  default: [
    { label: 'Encrypted', icon: Lock },
    { label: 'Emailed Link', icon: MailCheck },
    { label: 'Verified', icon: UserCheck },
  ],
};

const DEFAULT_ICONS: Record<string, ComponentType<{ size?: number }>> = {
  admin: ShieldCheck, teacher: Presentation, student: GraduationCap, parent: Users, staff: Briefcase,
};

export default function AuthVisualPanel({ role, icon, kind = 'PORTAL' }: AuthVisualPanelProps) {
  const key = role ?? 'default';
  const { title, tagline } = COPY[key];
  const badges = BADGES[key];
  const accent = role ? ROLE_ACCENTS[role] : DAWN_GOLD;
  const BlobIcon = icon ?? DEFAULT_ICONS[key] ?? ShieldCheck;

  return (
    <Box
      aria-hidden
      sx={{
        display: { xs: 'none', md: 'flex' },
        flexDirection: 'column',
        justifyContent: 'space-between',
        position: 'relative',
        overflow: 'hidden',
        p: 5,
        height: '100%',
        width: '100%',
        minHeight: 560,
        color: '#fff',
        background: `radial-gradient(circle at 20% 15%, ${accent}66, transparent 60%), linear-gradient(160deg, #161D1A, #0D1210)`,
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0, left: 0, right: 0,
          height: 4,
          background: HORIZON_GRADIENT,
        },
      }}
    >
      <Box>
        <Typography variant="overline" sx={{ opacity: 0.75, color: accent }}>
          MYFANTASIA {kind}
        </Typography>
        <Typography
          variant="h4"
          sx={{
            fontWeight: 800,
            mt: 1,
            mb: 1.5
          }}>
          {title}
        </Typography>
        <Typography variant="body1" sx={{ opacity: 0.8, maxWidth: 340 }}>
          {tagline}
        </Typography>
      </Box>

      <Stack
        spacing={3}
        sx={{
          alignItems: "center",
          my: 4
        }}>
        <Box
          sx={{
            width: 120, height: 120, borderRadius: '50%',
            display: 'grid', placeItems: 'center',
            background: `${accent}33`, border: `1px solid ${accent}66`,
          }}
        >
          <BlobIcon size={52} />
        </Box>
      </Stack>

      <Stack spacing={1.5} sx={{
        alignItems: "flex-start"
      }}>
        {badges.map((badge) => (
          <Chip
            key={badge.label}
            icon={<badge.icon size={14} />}
            label={badge.label}
            size="small"
            sx={{ bgcolor: 'rgba(255,255,255,0.08)', color: '#fff', '& .MuiChip-icon': { color: '#fff' } }}
          />
        ))}
      </Stack>
    </Box>
  );
}
