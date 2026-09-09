import { createTheme, type ThemeOptions } from '@mui/material/styles';

// "Savanna dawn" -- a palette earned by the subject (a Kenyan CBC school platform),
// not the generic near-black-plus-indigo-accent default this file used to be. See
// the design plan for the full rationale.
export const INK = '#0D1210';
// Softened from the original #F3F5F1 -- still the cool, deliberately-not-cream base the
// palette calls for, just enough off pure-bright to be comfortable as a full-page wash.
export const PAPER = '#E7EAE3';
export const DAWN_GOLD = '#E0A63A';
export const ACACIA = '#2F5D44';
export const TERRACOTTA = '#C1502E';
export const SKY = '#2B7FB0';

// Each portal keeps its own hue through its whole journey (click -> login -> signup
// -> wait-for-approval), not just the visual-panel blob -- a real structural device,
// not decoration.
export const ROLE_ACCENTS: Record<string, string> = {
  admin: '#3B5BA5',
  teacher: ACACIA,
  student: SKY,
  parent: TERRACOTTA,
  staff: '#7A4FA3',
};

// The one recurring signature motif -- a thin ink-to-gold gradient line used under the
// navbar, atop every AuthVisualPanel, and behind the home hero.
export const HORIZON_GRADIENT = `linear-gradient(90deg, ${INK} 0%, ${TERRACOTTA} 45%, ${DAWN_GOLD} 100%)`;

export function getPublicTheme(mode: 'light' | 'dark') {
  const isDark = mode === 'dark';

  const options: ThemeOptions = {
    palette: {
      mode,
      primary: { main: DAWN_GOLD, contrastText: '#1A1400' },
      secondary: { main: ACACIA },
      error: { main: TERRACOTTA },
      background: {
        default: isDark ? INK : PAPER,
        // Off-white rather than pure #FFFFFF -- cards/forms sitting on the page
        // background no longer read as glaring white panels in daylight.
        paper: isDark ? '#161D1A' : '#F9FAF7',
      },
      text: {
        primary: isDark ? '#F3F1E9' : '#151816',
        secondary: isDark ? '#A9B3AC' : '#4B564E',
      },
      divider: isDark ? 'rgba(243,241,233,0.10)' : 'rgba(21,24,22,0.12)',
    },
    shape: { borderRadius: 14 },
    typography: {
      fontFamily: "'Lexend', 'Helvetica', 'Arial', sans-serif",
      h1: { fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700 },
      h2: { fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700 },
      h3: { fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700 },
      h4: { fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600 },
      h5: { fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600 },
      h6: { fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600 },
      button: { fontFamily: "'Lexend', sans-serif", textTransform: 'none', fontWeight: 600 },
      overline: { fontFamily: "'IBM Plex Mono', monospace", fontWeight: 500, letterSpacing: 2.5 },
    },
    components: {
      MuiButton: {
        styleOverrides: {
          root: { borderRadius: 12, paddingTop: 10, paddingBottom: 10 },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: { backgroundImage: 'none' },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            border: `1px solid ${isDark ? 'rgba(243,241,233,0.10)' : 'rgba(21,24,22,0.08)'}`,
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          label: { fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.72rem' },
        },
      },
    },
  };

  return createTheme(options);
}
