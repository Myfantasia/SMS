import { useEffect } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import { CheckCircle2 } from 'lucide-react';

interface SuccessModalProps {
  open: boolean;
  message: string;
  onClose: () => void;
}

// Ports templates/school/success_popup.html + static/js/success_popup.js -- shown
// after any signup that flashes a "signup_success"-tagged message, auto-dismissing
// after 15s of no interaction, same as the original.
export default function SuccessModal({ open, message, onClose }: SuccessModalProps) {
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(onClose, 15000);
    return () => clearTimeout(timer);
  }, [open, onClose]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogContent sx={{ textAlign: 'center', pt: 5 }}>
        <Box sx={{ color: 'success.main', mb: 2 }}>
          <CheckCircle2 size={56} />
        </Box>
        <Typography
          variant="h6"
          sx={{
            fontWeight: 700,
            mb: 1
          }}>Success!</Typography>
        <Typography variant="body2" sx={{
          color: "text.secondary"
        }}>{message}</Typography>
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'center', pb: 3 }}>
        <Button variant="contained" onClick={onClose}>Continue</Button>
      </DialogActions>
    </Dialog>
  );
}
