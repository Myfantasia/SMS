import Box from '@mui/material/Box';
import { HORIZON_GRADIENT } from '../theme/publicTheme';

interface HorizonBandProps {
  height?: number;
}

// The one recurring signature motif -- see the design plan's "horizon band" section.
// Used under the navbar, atop AuthVisualPanel, and behind the home hero.
export default function HorizonBand({ height = 3 }: HorizonBandProps) {
  return <Box aria-hidden sx={{ height, width: '100%', background: HORIZON_GRADIENT }} />;
}
