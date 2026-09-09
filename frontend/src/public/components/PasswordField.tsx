import { useState } from 'react';
import TextField, { type TextFieldProps } from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import { Eye, EyeOff } from 'lucide-react';

// Shared show/hide password field used by every login/signup/reset form -- none of
// them had this before (static/js/password_toggle.js's old eye-icon toggle, ported
// as a real MUI component instead of a DOM class-toggle).
export default function PasswordField(props: TextFieldProps) {
  const [visible, setVisible] = useState(false);

  return (
    <TextField
      {...props}
      type={visible ? 'text' : 'password'}
      slotProps={{
        ...props.slotProps,
        input: {
          ...(props.slotProps?.input as object),
          endAdornment: (
            <InputAdornment position="end">
              <IconButton
                onClick={() => setVisible((v) => !v)}
                edge="end"
                size="small"
                tabIndex={-1}
                aria-label={visible ? 'Hide password' : 'Show password'}
              >
                {visible ? <EyeOff size={18} /> : <Eye size={18} />}
              </IconButton>
            </InputAdornment>
          ),
        },
      }}
    />
  );
}
