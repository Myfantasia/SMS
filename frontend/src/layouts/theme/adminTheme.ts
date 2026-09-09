import { createTheme } from '@mui/material/styles';

// Admin-dashboard MUI theme — same createTheme pattern as
// frontend/src/public/theme/publicTheme.ts, but keyed to the dashboard's existing
// blue/slate palette (DashboardLayouts.tsx's sidebar logo gradient + Tailwind slate-50/200/800
// backgrounds/text) instead of the public site's "Savanna dawn" gold/terracotta identity —
// new MUI admin components should read as part of the same dashboard, not a different app.
// Light-mode values are unchanged from before dark mode existed, since every existing
// dashboard page already leans on these exact hex values via raw Tailwind slate-* classes.
const LIGHT = {
  primary: '#2563EB', primaryDark: '#1D4ED8',
  // One notch deeper than the original #F8FAFC (slate-50) -- pure-white cards were nearly
  // blending into the canvas, reading as flat/glaring rather than elevated. slate-100 gives
  // real separation without darkening the cards themselves.
  bgDefault: '#F1F5F9', bgPaper: '#FFFFFF',
  textPrimary: '#1E293B', textSecondary: '#64748B',
  divider: '#E2E8F0', dividerHover: '#CBD5E1',
};

// Dark mode is new — tokens use Tailwind's own slate scale (slate-950/900/800/700/400/100) so
// MUI's palette and the navbar/sidebar's raw Tailwind `dark:` utility classes land on the exact
// same hex values, giving a real elevation hierarchy (canvas < surface < hover) instead of one
// flat inverted gray. Primary is brightened one step (blue-500 vs light mode's blue-600) since
// the darker blue reads low-contrast against a near-black surface.
const DARK = {
  primary: '#3B82F6', primaryDark: '#60A5FA',
  bgDefault: '#020617', bgPaper: '#0F172A',
  textPrimary: '#F1F5F9', textSecondary: '#94A3B8',
  divider: '#334155', dividerHover: '#475569',
};

export function getAdminTheme(mode: 'light' | 'dark' = 'light') {
  const tokens = mode === 'dark' ? DARK : LIGHT;

  return createTheme({
    palette: {
      mode,
      primary: { main: tokens.primary, dark: tokens.primaryDark, contrastText: '#FFFFFF' },
      secondary: { main: tokens.textPrimary },
      background: { default: tokens.bgDefault, paper: tokens.bgPaper },
      text: { primary: tokens.textPrimary, secondary: tokens.textSecondary },
      divider: tokens.divider,
    },
    shape: { borderRadius: 10 },
    typography: {
      fontFamily: 'inherit',
      button: { textTransform: 'none', fontWeight: 600 },
    },
    components: {
      MuiButton: {
        styleOverrides: {
          root: { borderRadius: 8, boxShadow: 'none' },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: { backgroundImage: 'none' },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: { border: `1px solid ${tokens.divider}`, boxShadow: 'none' },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { fontWeight: 500 },
        },
      },
      // Tailwind's preflight resets every <fieldset> to border:0/margin:0/padding:0 globally
      // (there's no CssBaseline here to counter it — see DashboardLayouts.tsx). MUI's own
      // outlined-variant border lives on a `.MuiOutlinedInput-notchedOutline` fieldset, and
      // that reset can win the cascade depending on stylesheet injection order, silently
      // stripping every outlined TextField/Select down to bare unstyled text. Setting the
      // border explicitly here (not relying on the notched-outline default) makes every
      // outlined field in the dashboard immune to that regardless of load order.
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            '& .MuiOutlinedInput-notchedOutline': { borderColor: tokens.divider, borderWidth: 1.5 },
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: tokens.dividerHover },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: tokens.primary, borderWidth: 2 },
          },
        },
      },
    },
  });
}
