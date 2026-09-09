import type { ReactNode } from 'react';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import { Check } from 'lucide-react';

interface SubmitButtonProps {
  idleLabel: string;
  busyLabel: string;
  successLabel: string;
  icon: ReactNode;
  submitting: boolean;
  succeeded: boolean;
}

// Shared loading/success treatment for every login/signup/password-reset submit --
// idle (icon + label) -> submitting (spinner + busy label, disabled) -> succeeded
// (checkmark + success label, held briefly before the page navigates away).
export default function SubmitButton({ idleLabel, busyLabel, successLabel, icon, submitting, succeeded }: SubmitButtonProps) {
  const label = succeeded ? successLabel : submitting ? busyLabel : idleLabel;
  const startIcon = succeeded
    ? <Check size={18} />
    : submitting
      ? <CircularProgress size={16} sx={{ color: 'inherit' }} />
      : icon;

  return (
    <Button
      type="submit"
      variant="contained"
      size="large"
      disabled={submitting || succeeded}
      startIcon={startIcon}
      sx={{
        bgcolor: succeeded ? 'success.main' : 'primary.main',
        color: succeeded ? '#fff' : '#1A1400',
        '&.Mui-disabled': { bgcolor: succeeded ? 'success.main' : 'primary.main', color: succeeded ? '#fff' : '#1A1400', opacity: 0.85 },
      }}
    >
      {label}
    </Button>
  );
}
