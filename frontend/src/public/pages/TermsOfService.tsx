import Box from '@mui/material/Box';
import GradientWord from '../components/GradientWord';
import Container from '@mui/material/Container';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Link from '@mui/material/Link';
import { Link as RouterLink } from 'react-router-dom';
import {
  FileSignature, CheckCircle2, UserCog, Gavel, Smartphone,
  FolderOpen, ServerCog, Scale, RotateCw, Mail,
} from 'lucide-react';

// Ports templates/school/pages/terms.html verbatim for legal copy, including the
// table-of-contents anchor-link behavior (plain in-page <a href="#section-id">).

const TOC = [
  { id: 'acceptance', label: 'Acceptance of Terms' },
  { id: 'accounts', label: 'Accounts & Access' },
  { id: 'acceptable-use', label: 'Acceptable Use' },
  { id: 'fees', label: 'Fees & Payments' },
  { id: 'content', label: 'Content & Records' },
  { id: 'availability', label: 'Availability' },
  { id: 'liability', label: 'Limitation of Liability' },
  { id: 'changes', label: 'Changes to These Terms' },
  { id: 'contact-terms', label: 'Contact Us' },
];

const SECTIONS = [
  {
    id: 'acceptance', icon: CheckCircle2, title: 'Acceptance of Terms',
    body: (
      <Typography sx={{
        color: "text.secondary"
      }}>
        By logging into or otherwise using this portal — as an administrator, teacher, student,
        or parent — you agree to these Terms of Service and to our{' '}
        <Link component={RouterLink} to="/privacy-policy">Privacy Policy</Link>. If you do not
        agree, please do not use the system and contact the school administration directly instead.
      </Typography>
    ),
  },
  {
    id: 'accounts', icon: UserCog, title: 'Accounts & Access',
    body: (
      <Box component="ul" sx={{ color: 'text.secondary', pl: 3, m: 0 }}>
        <li>Accounts are role-specific (Admin, Teacher, Student, Parent) and are provisioned or approved by the school administration.</li>
        <li>Parent accounts must be verified against an existing, matching student record before approval.</li>
        <li>You are responsible for keeping your login credentials confidential and for all activity carried out under your account.</li>
        <li>Impersonating another user, or attempting to access records outside your role&apos;s permissions, is strictly prohibited.</li>
      </Box>
    ),
  },
  {
    id: 'acceptable-use', icon: Gavel, title: 'Acceptable Use',
    body: (
      <>
        <Typography sx={{
          color: "text.secondary",
          mb: 2
        }}>
          You agree to use the portal only for its intended purpose — managing and following
          academic, attendance, financial, and administrative activity related to the school.
          You agree not to:
        </Typography>
        <Box component="ul" sx={{ color: 'text.secondary', pl: 3, m: 0 }}>
          <li>Attempt to bypass authentication, probe for vulnerabilities, or interfere with the normal operation of the system.</li>
          <li>Upload or submit content that is unlawful, abusive, or infringes on someone else&apos;s rights.</li>
          <li>Share, scrape, or redistribute another student&apos;s or family&apos;s academic or personal records.</li>
          <li>Use the messaging or notice features to send unsolicited or harassing communication.</li>
        </Box>
      </>
    ),
  },
  {
    id: 'fees', icon: Smartphone, title: 'Fees & Payments',
    body: (
      <Typography sx={{
        color: "text.secondary"
      }}>
        Fee balances shown on the portal are for reference and are reconciled against payments
        made via M-PESA Paybill. In case of any discrepancy between a displayed balance and an
        actual payment made, please raise it with the school accounts office or through{' '}
        <Link component={RouterLink} to="/contactus">Contact Us</Link> promptly so it can be corrected.
      </Typography>
    ),
  },
  {
    id: 'content', icon: FolderOpen, title: 'Content & Records',
    body: (
      <Typography sx={{
        color: "text.secondary"
      }}>
        Academic records, attendance, assignments, and results entered into the system remain the
        property of the school. Users may view and, where their role permits (e.g. a teacher
        grading an assignment), edit only the records relevant to their role. The school reserves
        the right to correct erroneous entries.
      </Typography>
    ),
  },
  {
    id: 'availability', icon: ServerCog, title: 'Availability',
    body: (
      <Typography sx={{
        color: "text.secondary"
      }}>
        We aim to keep the portal available at all times, but scheduled maintenance, upgrades, or
        circumstances outside our control may occasionally make it temporarily unavailable.
        Current operational status is published on our{' '}
        <Link component={RouterLink} to="/system-status">System Status</Link> page.
      </Typography>
    ),
  },
  {
    id: 'liability', icon: Scale, title: 'Limitation of Liability',
    body: (
      <Typography sx={{
        color: "text.secondary"
      }}>
        The portal is provided on an &quot;as available&quot; basis. While we take reasonable
        care to keep information accurate and the system secure, the school is not liable for
        indirect or incidental loss arising from temporary unavailability, data entry errors by
        third parties, or events beyond our reasonable control.
      </Typography>
    ),
  },
  {
    id: 'changes', icon: RotateCw, title: 'Changes to These Terms',
    body: (
      <Typography sx={{
        color: "text.secondary"
      }}>
        We may update these Terms of Service from time to time to reflect changes to the platform
        or school policy. The &quot;Last updated&quot; date at the top of this page reflects the
        most recent revision. Continued use of the portal after an update constitutes acceptance
        of the revised terms.
      </Typography>
    ),
  },
  {
    id: 'contact-terms', icon: Mail, title: 'Contact Us',
    body: (
      <Typography sx={{
        color: "text.secondary"
      }}>
        Questions about these terms can be sent through our{' '}
        <Link component={RouterLink} to="/contactus">Contact page</Link>.
      </Typography>
    ),
  },
];

export default function TermsOfService() {
  return (
    <Box>
      <Box sx={{ background: 'radial-gradient(circle at 15% 10%, rgba(99,102,241,0.12), transparent 60%)', py: { xs: 6, md: 8 } }}>
        <Container maxWidth="md" sx={{ textAlign: 'center' }}>
          <Chip icon={<FileSignature size={14} />} label="Terms" sx={{ mb: 3, fontWeight: 700 }} />
          <Typography variant="h2" sx={{ fontSize: { xs: '2rem', md: '2.8rem' }, fontWeight: 800, mb: 2 }}>
            Terms of <GradientWord>Service</GradientWord>
          </Typography>
          <Typography
            variant="body1"
            sx={{
              color: "text.secondary",
              maxWidth: 640,
              mx: 'auto',
              mb: 1.5
            }}>
            The rules that govern use of the MyFantasia school management portal by students,
            parents, teachers, and administrators.
          </Typography>
          <Typography variant="caption" sx={{
            color: "text.disabled"
          }}>Last updated: January 2026</Typography>
        </Container>
      </Box>

      <Container maxWidth="lg" sx={{ py: { xs: 5, md: 7 } }}>
        <Grid container spacing={5}>
          <Grid size={{ xs: 12, md: 3.5 }}>
            <Paper variant="outlined" sx={{ p: 3, position: { md: 'sticky' }, top: { md: 96 } }}>
              <Typography
                variant="subtitle2"
                sx={{
                  fontWeight: 700,
                  mb: 1.5
                }}>On this page</Typography>
              <Stack spacing={1} component="ol" sx={{ listStyle: 'none', pl: 0, m: 0 }}>
                {TOC.map((t, i) => (
                  <Box component="li" key={t.id}>
                    <Link href={`#${t.id}`} underline="hover" variant="body2" sx={{
                      color: "text.secondary"
                    }}>
                      {i + 1}. {t.label}
                    </Link>
                  </Box>
                ))}
              </Stack>
            </Paper>
          </Grid>

          <Grid size={{ xs: 12, md: 8.5 }}>
            <Stack spacing={5}>
              {SECTIONS.map((s) => (
                <Box key={s.id} id={s.id} sx={{ scrollMarginTop: 96 }}>
                  <Stack
                    direction="row"
                    spacing={1.5}
                    sx={{
                      alignItems: "center",
                      mb: 1.5
                    }}>
                    <s.icon size={20} color="#E0A63A" />
                    <Typography variant="h6" sx={{
                      fontWeight: 700
                    }}>{s.title}</Typography>
                  </Stack>
                  {s.body}
                </Box>
              ))}
            </Stack>
          </Grid>
        </Grid>
      </Container>
    </Box>
  );
}
