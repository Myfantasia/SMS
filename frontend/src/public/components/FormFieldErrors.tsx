import Box from '@mui/material/Box';
import Alert from '@mui/material/Alert';
import Typography from '@mui/material/Typography';

interface FormFieldErrorsProps {
  errors?: Record<string, string[]>;
  generalMessage?: string;
}

// Ports templates/school/form_errors.html -- a single consolidated error box listing
// every field's errors, plus any non-field message (e.g. "Invalid or expired invite
// code.") passed separately.
export default function FormFieldErrors({ errors, generalMessage }: FormFieldErrorsProps) {
  const hasFieldErrors = errors && Object.keys(errors).length > 0;
  if (!hasFieldErrors && !generalMessage) return null;

  return (
    <Alert severity="error" sx={{ mb: 3 }}>
      {generalMessage && <Typography variant="body2">{generalMessage}</Typography>}
      {hasFieldErrors && (
        <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
          {Object.entries(errors!).map(([field, messages]) =>
            messages.map((msg, i) => (
              <li key={`${field}-${i}`}>
                <Typography variant="body2">{msg}</Typography>
              </li>
            )),
          )}
        </Box>
      )}
    </Alert>
  );
}
