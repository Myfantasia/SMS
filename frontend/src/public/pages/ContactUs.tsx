import { useState } from 'react';
import Container from '@mui/material/Container';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import GradientWord from '../components/GradientWord';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import Alert from '@mui/material/Alert';
import { Phone, MapPin, Mail, Clock, Send, ChevronDown, Navigation } from 'lucide-react';
import SuccessModal from '../components/SuccessModal';
import FormFieldErrors from '../components/FormFieldErrors';
import { submitContact, parseApiError } from '../api/publicApi';

// Karen Plains Rd, Karen -- Nairobi. A fixed lat/lng pin (rather than a text-search
// embed) so the map always points at this exact spot instead of Google's best guess
// at the address string.
const CAMPUS_COORDS = { lat: -1.3183, lng: 36.7076 };
const CAMPUS_MAPS_URL = `https://maps.google.com/?q=${CAMPUS_COORDS.lat},${CAMPUS_COORDS.lng}`;
const CAMPUS_DIRECTIONS_URL = `https://www.google.com/maps/dir/?api=1&destination=${CAMPUS_COORDS.lat},${CAMPUS_COORDS.lng}`;
const CAMPUS_EMBED_URL = `https://maps.google.com/maps?q=${CAMPUS_COORDS.lat},${CAMPUS_COORDS.lng}&z=16&output=embed`;

const QUICK_ACTIONS = [
  { icon: Phone, label: 'Hotline', value: '+254 712 345 678', href: 'tel:+254712345678' },
  { icon: MapPin, label: 'Visit Us', value: 'Karen Plains Rd, Nairobi', href: CAMPUS_MAPS_URL },
  { icon: Mail, label: 'Email', value: 'info@myfantasia.sc.ke', href: 'mailto:info@myfantasia.sc.ke' },
  { icon: Clock, label: 'Office Hours', value: 'Mon–Fri, 8:00 AM–5:00 PM', href: undefined },
];

const FAQS = [
  {
    q: 'How do I access the Parent, Student, or Teacher portal?',
    a: "Use the Portal menu in the navigation bar above and select your role. If you don't have login credentials yet, contact the school office to have your account set up.",
  },
  {
    q: 'I forgot my password — what do I do?',
    a: 'On the login page for your role, click Forgot Password and follow the reset instructions sent to your registered email address.',
  },
  {
    q: 'How do I pay school fees?',
    a: 'Fees are paid via M-PESA Paybill. Your balance and payment receipts appear on your portal dashboard once a payment is confirmed.',
  },
  {
    q: 'How long does a new parent account take to be approved?',
    a: 'New parent accounts are typically reviewed and approved within 1–2 working days once your account is matched against an existing student record.',
  },
  {
    q: 'Who do I contact about admissions?',
    a: 'Send us a message using the form above, or call our hotline during office hours — our admissions team will get back to you shortly.',
  },
];

export default function ContactUs() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>();
  const [generalError, setGeneralError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldErrors(undefined);
    setGeneralError('');
    setSubmitting(true);
    try {
      await submitContact({ Name: name, Email: email, Message: message });
      setShowSuccess(true);
      setName('');
      setEmail('');
      setMessage('');
    } catch (err) {
      const data = parseApiError(err);
      if (data?.field_errors) setFieldErrors(data.field_errors);
      else setGeneralError(data?.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 5, md: 8 } }}>
      <SuccessModal
        open={showSuccess}
        message="Thank you for contacting Myfantasia High School. We will be in touch shortly."
        onClose={() => setShowSuccess(false)}
      />

      <Grid container spacing={4} sx={{ mb: 8 }}>
        <Grid size={{ xs: 12, md: 5 }}>
          <Chip label="NAIROBI CAMPUS" size="small" sx={{ mb: 2, fontWeight: 700 }} />
          <Typography variant="h3" sx={{ fontSize: { xs: '2rem', md: '2.4rem' }, fontWeight: 800, mb: 2 }}>
            Let's Start a Conversation
          </Typography>
          <Typography
            variant="body1"
            sx={{
              color: "text.secondary",
              mb: 3
            }}>
            Whether you're a parent seeking admission or an alumni reconnecting, we are here.
          </Typography>
          <Stack spacing={1.5} sx={{ mb: 3 }}>
            {QUICK_ACTIONS.map((action) => (
              <Paper
                key={action.label}
                component={action.href ? 'a' : 'div'}
                href={action.href}
                target={action.href?.startsWith('http') ? '_blank' : undefined}
                rel={action.href?.startsWith('http') ? 'noopener' : undefined}
                variant="outlined"
                sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 1.5, textDecoration: 'none', color: 'text.primary' }}
              >
                <Box sx={{ width: 36, height: 36, borderRadius: '50%', bgcolor: 'primary.main', color: '#fff', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                  <action.icon size={16} />
                </Box>
                <Box>
                  <Typography
                    variant="caption"
                    sx={{
                      color: "text.secondary",
                      display: "block"
                    }}>{action.label}</Typography>
                  <Typography variant="body2" sx={{
                    fontWeight: 600
                  }}>{action.value}</Typography>
                </Box>
              </Paper>
            ))}
          </Stack>
        </Grid>

        <Grid size={{ xs: 12, md: 7 }}>
          <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 } }} component="form" onSubmit={handleSubmit}>
            <Typography
              variant="h5"
              sx={{
                fontWeight: 700,
                mb: 0.5
              }}>Send a Message</Typography>
            <Typography
              variant="body2"
              sx={{
                color: "text.secondary",
                mb: 3
              }}>We typically reply within 2 hours.</Typography>

            {generalError && <Alert severity="error" sx={{ mb: 2 }}>{generalError}</Alert>}
            <FormFieldErrors errors={fieldErrors} />

            <Stack spacing={2.5}>
              <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} required fullWidth slotProps={{ htmlInput: { maxLength: 30 } }} />
              <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required fullWidth />
              <TextField
                label="Message" value={message} onChange={(e) => setMessage(e.target.value)}
                required fullWidth multiline rows={4} slotProps={{ htmlInput: { maxLength: 500 } }}
              />
              <Button type="submit" variant="contained" size="large" disabled={submitting} endIcon={<Send size={16} />}>
                Send Message
              </Button>
            </Stack>
          </Paper>
        </Grid>
      </Grid>

      <Box sx={{ mb: 8 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          sx={{ alignItems: { sm: 'flex-end' }, justifyContent: 'space-between', mb: 3 }}
        >
          <Box>
            <Typography variant="h4" sx={{ fontSize: { xs: '1.6rem', md: '2rem' }, fontWeight: 800, mb: 0.5 }}>
              Find Us on <GradientWord>Campus</GradientWord>
            </Typography>
            <Typography variant="body2" color="text.secondary">Karen Plains Rd, Nairobi — Mon–Fri, 8:00 AM–5:00 PM.</Typography>
          </Box>
          <Button
            href={CAMPUS_DIRECTIONS_URL}
            target="_blank"
            rel="noopener"
            variant="outlined"
            endIcon={<Navigation size={16} />}
            sx={{ flexShrink: 0 }}
          >
            Get Directions
          </Button>
        </Stack>
        <Paper variant="outlined" sx={{ overflow: 'hidden', borderRadius: 3 }}>
          <Box
            component="iframe"
            title="MyFantasia campus location map"
            src={CAMPUS_EMBED_URL}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            sx={{ width: '100%', height: { xs: 320, md: 460 }, border: 0, display: 'block' }}
          />
        </Paper>
      </Box>

      <Stack
        spacing={1}
        sx={{
          alignItems: "center",
          mb: 4,
          textAlign: 'center'
        }}>
        <Typography variant="h4" sx={{ fontSize: { xs: '1.6rem', md: '2rem' } }}>
          Frequently Asked <GradientWord>Questions</GradientWord>
        </Typography>
        <Typography variant="body1" sx={{
          color: "text.secondary"
        }}>Quick answers before you reach out.</Typography>
      </Stack>

      <Box sx={{ maxWidth: 760, mx: 'auto' }}>
        {FAQS.map((faq) => (
          <Accordion key={faq.q} variant="outlined" disableGutters>
            <AccordionSummary expandIcon={<ChevronDown size={18} />}>
              <Typography sx={{
                fontWeight: 600
              }}>{faq.q}</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Typography sx={{
                color: "text.secondary"
              }}>{faq.a}</Typography>
            </AccordionDetails>
          </Accordion>
        ))}
      </Box>
    </Container>
  );
}
