import type { ReactNode } from 'react';
import Button, { type ButtonProps } from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import { Check } from 'lucide-react';

export type SubmitState = 'idle' | 'submitting' | 'success';

interface LoadingButtonProps extends Omit<ButtonProps, 'children'> {
  state: SubmitState;
  icon?: ReactNode;
  idleLabel: ReactNode;
  submittingLabel: ReactNode;
  successLabel: ReactNode;
}

// Shared submit-button treatment for every login/signup/password-reset form: a
// spinner + disabled state while the request is in flight, then a brief checkmark +
// "success" state the caller holds (via setTimeout) for ~600-700ms before calling
// navigate(...), so the async gap after a successful submit is never a silent jump.
// The caller owns the `state` (usually driven by its existing `submitting` flow plus
// one extra 'success' step) -- this component only renders it.
export default function LoadingButton({
  state, icon, idleLabel, submittingLabel, successLabel, sx, ...buttonProps
}: LoadingButtonProps) {
  const isSubmitting = state === 'submitting';
  const isSuccess = state === 'success';

  return (
    <Button
      {...buttonProps}
      disabled={buttonProps.disabled || isSubmitting || isSuccess}
      startIcon={
        isSubmitting ? <CircularProgress size={18} sx={{ color: 'inherit' }} />
          : isSuccess ? <Check size={18} />
          : icon
      }
      sx={[
        isSuccess ? {
          bgcolor: 'success.main',
          '&.Mui-disabled': { bgcolor: 'success.main', color: '#fff' },
        } : {},
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      {isSubmitting ? submittingLabel : isSuccess ? successLabel : idleLabel}
    </Button>
  );
}
