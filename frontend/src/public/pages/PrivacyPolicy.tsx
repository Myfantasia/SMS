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
  ShieldCheck, Database, ListChecks, Baby, Share2, Smartphone,
  Lock, Archive, UserCheck, Mail,
} from 'lucide-react';

// Ports templates/school/pages/privacy.html verbatim for legal copy, including the
// table-of-contents anchor-link behavior (plain in-page <a href="#section-id">).

const TOC = [
  { id: 'information-we-collect', label: 'Information We Collect' },
  { id: 'how-we-use-it', label: 'How We Use Your Information' },
  { id: 'childrens-data', label: "Children's & Student Data" },
  { id: 'sharing', label: 'How Information Is Shared' },
  { id: 'payments', label: 'Fees & Payment Data' },
  { id: 'security', label: 'Data Security' },
  { id: 'retention', label: 'Data Retention' },
  { id: 'your-rights', label: 'Your Rights' },
  { id: 'contact', label: 'Contact Us' },
];

const SECTIONS = [
  {
    id: 'information-we-collect', icon: Database, title: 'Information We Collect',
    body: (
      <>
        <Typography sx={{
          color: "text.secondary",
          mb: 2
        }}>
          To run the school&apos;s day-to-day operations, we collect the information necessary
          to enrol, teach, assess, and communicate with students and their families, including:
        </Typography>
        <Box component="ul" sx={{ color: 'text.secondary', pl: 3, m: 0 }}>
          <li><b>Identity &amp; contact details</b> — names, admission numbers, dates of birth, phone numbers, email addresses, and physical address.</li>
          <li><b>Academic records</b> — class/stream placement, subject enrolment, attendance, CATs, exam results, and report cards.</li>
          <li><b>Guardian information</b> — parent/guardian names, relationship, and contact details, used to verify and link parent accounts to the correct learner.</li>
          <li><b>Staff records</b> — teacher qualifications, TSC/ID numbers, subject allocations, and timetable assignments.</li>
          <li><b>Financial records</b> — fee balances and M-PESA payment confirmations (we do not store M-PESA PINs or full mobile money credentials).</li>
          <li><b>System usage</b> — login timestamps and basic activity logs used for security and troubleshooting.</li>
        </Box>
      </>
    ),
  },
  {
    id: 'how-we-use-it', icon: ListChecks, title: 'How We Use Your Information',
    body: (
      <>
        <Typography sx={{
          color: "text.secondary",
          mb: 2
        }}>
          Information collected through this system is used strictly to operate the school, specifically to:
        </Typography>
        <Box component="ul" sx={{ color: 'text.secondary', pl: 3, m: 0 }}>
          <li>Administer enrolment, attendance, timetabling, and academic assessment.</li>
          <li>Give parents and students real-time visibility into attendance, results, assignments, and fee balances.</li>
          <li>Process and reconcile fee payments made via M-PESA.</li>
          <li>Send notices, event updates, and important communications to the relevant audience.</li>
          <li>Meet regulatory and reporting obligations to bodies such as KNEC, TSC, and NEMIS where applicable.</li>
        </Box>
      </>
    ),
  },
  {
    id: 'childrens-data', icon: Baby, title: "Children's & Student Data",
    body: (
      <Typography sx={{
        color: "text.secondary"
      }}>
        Much of the data in this system belongs to minors. Student accounts and records are
        created and approved by the school administration, and parent accounts must be verified
        against an existing student record (matching admission number and name) before access to
        a child&apos;s data is granted. Students and parents can only view information relevant
        to their own household — a parent account can never browse another family&apos;s records.
      </Typography>
    ),
  },
  {
    id: 'sharing', icon: Share2, title: 'How Information Is Shared',
    body: (
      <>
        <Typography sx={{
          color: "text.secondary",
          mb: 2
        }}>
          We do not sell or rent student, parent, or staff information. Data is shared only:
        </Typography>
        <Box component="ul" sx={{ color: 'text.secondary', pl: 3, m: 0 }}>
          <li>Internally, on a role-appropriate basis — e.g. a teacher sees only the classes/streams they are allocated to, and a parent sees only their own children.</li>
          <li>With payment processors (M-PESA/Safaricom) strictly to confirm and reconcile fee payments.</li>
          <li>With government/regulatory bodies (KNEC, TSC, NEMIS) where the school is legally required to report.</li>
          <li>With service providers who host or maintain this platform, under confidentiality obligations.</li>
        </Box>
      </>
    ),
  },
  {
    id: 'payments', icon: Smartphone, title: 'Fees & Payment Data',
    body: (
      <Typography sx={{
        color: "text.secondary"
      }}>
        Fee payments are made via M-PESA Paybill directly to the school&apos;s account. This
        platform stores the resulting transaction reference, amount, and resulting balance so
        that receipts and statements can be generated — it does not process, store, or have
        access to M-PESA PINs or Safaricom account credentials.
      </Typography>
    ),
  },
  {
    id: 'security', icon: Lock, title: 'Data Security',
    body: (
      <Typography sx={{
        color: "text.secondary"
      }}>
        Access to student, parent, and staff records is protected by authenticated accounts with
        role-based permissions, so each user only reaches the data their role requires. We
        encourage everyone to keep login credentials private and to report suspected unauthorised
        access through the{' '}
        <Link component={RouterLink} to="/contactus">Contact Us</Link> page immediately.
      </Typography>
    ),
  },
  {
    id: 'retention', icon: Archive, title: 'Data Retention',
    body: (
      <Typography sx={{
        color: "text.secondary"
      }}>
        Academic and financial records are retained for as long as a student is enrolled and for
        a reasonable period afterward to satisfy academic reference and regulatory requirements
        (e.g. producing historical transcripts). Accounts for rejected or withdrawn applicants
        are removed by the administration once no longer needed.
      </Typography>
    ),
  },
  {
    id: 'your-rights', icon: UserCheck, title: 'Your Rights',
    body: (
      <Typography sx={{
        color: "text.secondary"
      }}>
        Parents, students, and staff may request a copy of the personal information held about
        them, ask for corrections to inaccurate records, or raise questions about how their data
        is used, by reaching out through the{' '}
        <Link component={RouterLink} to="/contactus">Contact Us</Link> page or directly with the
        school administration.
      </Typography>
    ),
  },
  {
    id: 'contact', icon: Mail, title: 'Contact Us',
    body: (
      <Typography sx={{
        color: "text.secondary"
      }}>
        Questions about this policy or how your data is handled can be sent through our{' '}
        <Link component={RouterLink} to="/contactus">Contact page</Link>, and the administration
        will respond directly.
      </Typography>
    ),
  },
];

export default function PrivacyPolicy() {
  return (
    <Box>
      <Box sx={{ background: 'radial-gradient(circle at 15% 10%, rgba(99,102,241,0.12), transparent 60%)', py: { xs: 6, md: 8 } }}>
        <Container maxWidth="md" sx={{ textAlign: 'center' }}>
          <Chip icon={<ShieldCheck size={14} />} label="Privacy" sx={{ mb: 3, fontWeight: 700 }} />
          <Typography variant="h2" sx={{ fontSize: { xs: '2rem', md: '2.8rem' }, fontWeight: 800, mb: 2 }}>
            Privacy <GradientWord>Policy</GradientWord>
          </Typography>
          <Typography
            variant="body1"
            sx={{
              color: "text.secondary",
              maxWidth: 640,
              mx: 'auto',
              mb: 1.5
            }}>
            How MyFantasia collects, uses, and protects the information of students, parents,
            teachers, and administrators on this platform.
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
