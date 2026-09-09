import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import { DAWN_GOLD, TERRACOTTA } from '../theme/publicTheme';

// Shared "savanna dawn" gradient-text treatment -- extracted from Home.tsx, where it
// was originally a local helper, once the same old indigo (#818cf8 -> #c084fc) span
// turned up duplicated across every static content page. Replaces that leftover
// pre-redesign gradient with the real palette everywhere it appears.
export default function GradientWord({ children }: { children: ReactNode }) {
  return (
    <Box
      component="span"
      sx={{
        background: `linear-gradient(100deg, ${DAWN_GOLD}, ${TERRACOTTA})`,
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
      }}
    >
      {children}
    </Box>
  );
}
