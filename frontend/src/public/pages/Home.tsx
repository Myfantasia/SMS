import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Paper from '@mui/material/Paper';
import {
  ArrowRight, CheckCircle2, Wifi, UserCheck, ShieldCheck, Presentation, Users, GraduationCap,
  FileSignature, Umbrella, Trophy, CalendarCheck, CalendarPlus, Smartphone, FileText, BookOpen,
  Wallet, MousePointerClick, KeyRound, LineChart,
} from 'lucide-react';
import { fetchHome } from '../api/publicApi';
import { useParallax } from '../theme/useParallax';
import { ROLE_ACCENTS, DAWN_GOLD, TERRACOTTA, ACACIA } from '../theme/publicTheme';
import GradientWord from '../components/GradientWord';
import ImagePaginationGallery, { type GallerySlide } from '../components/ImagePaginationGallery';

interface RecentEvent {
  id: number;
  title: string;
  description: string | null;
  start_time: string;
  event_type: string;
}

const PORTAL_CARDS = [
  { icon: ShieldCheck, role: 'admin', title: 'Administration', body: 'Manage TSC staff records, NEMIS uploads, and school finances.', to: '/adminclick' },
  { icon: Presentation, role: 'teacher', title: 'Teachers', body: 'Upload CBC assessment scores and manage daily class attendance.', to: '/teacherclick' },
  { icon: Users, role: 'parent', title: 'Parents', body: 'View fee balances, download receipts, and check term dates.', to: '/parentclick' },
  { icon: GraduationCap, role: 'student', title: 'Students', body: 'Access revision materials, library logs, and assignment portals.', to: '/studentclick' },
];

const EVENT_META: Record<string, { color: string; icon: typeof FileSignature }> = {
  Exam: { color: TERRACOTTA, icon: FileSignature },
  Holiday: { color: '#2B7FB0', icon: Umbrella },
  Meeting: { color: DAWN_GOLD, icon: Users },
  Sports: { color: '#7A4FA3', icon: Trophy },
};
const DEFAULT_EVENT_META = { color: ACACIA, icon: CalendarCheck };

const INFO_ITEMS = [
  { icon: Smartphone, title: 'Real-time Updates', body: 'Receive SMS alerts for school entry/exit and term dates directly to your phone.' },
  { icon: FileText, title: 'M-PESA Integration', body: 'Pay school fees seamlessly via Paybill with instant receipt generation and balance updates.' },
  { icon: BookOpen, title: 'CBC Compliant', body: 'Full support for the Competency Based Curriculum assessment rubrics and reporting.' },
];

const BEYOND_THE_CLASSROOM: GallerySlide[] = [
  {
    src: '/images/gallery-science-lab.jpg', tag: 'SCIENCE & INNOVATION',
    title: 'Labs Built for Real Experiments, Not Just Diagrams',
    body: 'Fully equipped Physics, Chemistry, and Biology labs give every CBC and 8-4-4 learner real bench time — home to the 2024 National Chemistry Trophy.',
  },
  {
    src: '/images/gallery-coding-lab.jpg', tag: 'SILICON SAVANNAH LAB',
    title: 'Grade 9 Learners Ship Their First Apps',
    body: 'Our coding lab pairs CBC Digital Literacy learners with mentors from Westlands tech firms, opened in 2024 as part of the school\'s digital-first push.',
  },
  {
    src: '/images/gallery-library-aisle.jpg', tag: 'LIBRARY & LEARNING COMMONS',
    title: 'A Quiet Corner for Every Kind of Research',
    body: 'Thousands of volumes and a dedicated study commons support independent revision, university application prep, and just the love of reading.',
  },
  {
    src: '/images/gallery-athletics.jpg', tag: 'ATHLETICS & TRACK',
    title: 'Regional-Qualifying Sprinters Train Here Every Term',
    body: 'Our all-weather track hosts inter-house meets and feeds county and regional athletics competitions across every age group.',
  },
  {
    src: '/images/gallery-football.jpg', tag: 'RUGBY & FOOTBALL',
    title: 'Home to the Reigning Regional Rugby Champions',
    body: 'Our "Fantasians" XV and competitive football program run structured coaching from Form 1 through Form 4, on and off the pitch.',
  },
  {
    src: '/images/gallery-basketball.jpg', tag: 'BASKETBALL & INDOOR SPORTS',
    title: 'Indoor Courts, Inter-House Leagues, County Titles',
    body: 'Basketball, volleyball, and indoor athletics keep the co-curricular calendar full well beyond the rugby season.',
  },
  {
    src: '/images/gallery-drama.jpg', tag: 'PERFORMING ARTS',
    title: 'National Drama Festival Champions Since 2012',
    body: 'The stage is taken as seriously as the science lab — original scripts, music, and choreography built entirely by Fantasian students.',
  },
  {
    src: '/images/gallery-clubs.jpg', tag: 'CLUBS & SOCIETIES',
    title: 'From ICT Club to Model United Nations',
    body: 'Structured after-hours time turns interests into real skills — St. John Ambulance first-aid training, MUN diplomacy, and more.',
  },
  {
    src: '/images/gallery-graduation.jpg', tag: 'GRADUATION & BEYOND',
    title: '98% of Graduates Transition Directly to University',
    body: 'Every CBC and 8-4-4 journey through Myfantasia builds toward this moment — and the SMS portal keeps parents and students informed the whole way.',
  },
];

const HOW_IT_WORKS = [
  { icon: MousePointerClick, step: '01', title: 'Choose your portal', body: 'Pick Admin, Teacher, Student, Parent, or Staff — each has its own sign-in and dashboard.' },
  { icon: KeyRound, step: '02', title: 'Sign in securely', body: 'Session-based auth with rate-limited login attempts and email verification for new accounts.' },
  { icon: LineChart, step: '03', title: 'Track everything live', body: 'Attendance, results, fees, and messages update in real time — no refreshing, no waiting.' },
];

const STATS = [
  { value: '40+', label: 'Schools onboarded' },
  { value: '12k', label: 'Students & guardians linked' },
  { value: '98%', label: 'Fee reconciliation accuracy' },
  { value: '<2min', label: 'Average admin approval time' },
];

function truncateWords(text: string, maxWords: number) {
  const words = text.split(/\s+/);
  if (words.length <= maxWords) return text;
  return `${words.slice(0, maxWords).join(' ')}…`;
}

export default function Home() {
  const [events, setEvents] = useState<RecentEvent[] | null>(null);
  const sunOffset = useParallax(-0.12);
  const treesOffset = useParallax(-0.05);
  const badgeOffset1 = useParallax(0.06);
  const badgeOffset2 = useParallax(-0.08);

  useEffect(() => {
    fetchHome()
      .then((res) => setEvents(res.data.recent_events))
      .catch(() => setEvents([]));
  }, []);

  return (
    <Box sx={{ overflow: 'hidden' }}>
      {/* --- HERO --- */}
      <Box sx={{ position: 'relative', overflow: 'hidden' }}>
        {/* Parallax horizon layers */}
        <Box
          aria-hidden
          sx={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            background: (t) => t.palette.mode === 'dark'
              ? `radial-gradient(ellipse 900px 500px at 75% 15%, ${DAWN_GOLD}22, transparent 60%)`
              : `radial-gradient(ellipse 900px 500px at 75% 15%, ${DAWN_GOLD}33, transparent 60%)`,
          }}
        />
        <Box
          aria-hidden
          sx={{
            position: 'absolute', right: '4%', top: '8%', width: 160, height: 160, borderRadius: '50%',
            background: `radial-gradient(circle, ${DAWN_GOLD}bb, ${DAWN_GOLD}00 70%)`,
            transform: `translateY(${sunOffset}px)`, pointerEvents: 'none', filter: 'blur(2px)',
          }}
        />
        <Box
          aria-hidden
          sx={{
            position: 'absolute', left: 0, right: 0, bottom: -20, height: 140,
            transform: `translateY(${treesOffset}px)`, pointerEvents: 'none', opacity: 0.5,
            background: (t) => `repeating-linear-gradient(75deg, ${t.palette.mode === 'dark' ? '#000' : ACACIA}18 0 6px, transparent 6px 26px)`,
            maskImage: 'linear-gradient(to top, black, transparent)',
          }}
        />

        <Container maxWidth="lg" sx={{ py: { xs: 6, md: 10 }, position: 'relative' }}>
          <Grid container spacing={6} sx={{ alignItems: 'center' }}>
            <Grid size={{ xs: 12, md: 7 }}>
              <Chip
                label={<><b>NEMIS READY</b>&nbsp;&nbsp;Form 1 Intake &amp; CBC Grade 9 Admissions Open</>}
                sx={{ mb: 3, py: 2.5, bgcolor: 'action.hover', border: '1px solid', borderColor: 'divider' }}
              />
              <Typography variant="h1" sx={{ fontSize: { xs: '2.4rem', md: '3.6rem' }, lineHeight: 1.08, mb: 2.5 }}>
                The Heart of Your <GradientWord>School's Daily Life</GradientWord>
              </Typography>
              <Typography variant="body1" color="text.secondary" sx={{ mb: 4, maxWidth: 560, fontSize: '1.08rem', lineHeight: 1.7 }}>
                Streamline administrative tasks, empower teachers, and connect parents with
                real-time student progress. From the 8-4-4 legacy to the new CBC frontier, we
                offer one secure platform for the entire school community.
              </Typography>
              <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: "wrap", mb: 4 }}>
                <Button component={RouterLink} to="/portal" variant="contained" size="large" disableElevation endIcon={<ArrowRight size={18} />} sx={{ bgcolor: 'primary.main', color: '#1A1400' }}>
                  Access Management
                </Button>
                <Button component={RouterLink} to="/aboutus" variant="outlined" size="large">
                  School Information
                </Button>
              </Stack>
              <Stack direction="row" spacing={3} sx={{ flexWrap: 'wrap', color: 'text.secondary' }}>
                <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}><CheckCircle2 size={16} color={ACACIA} /><Typography variant="body2">KNEC Center</Typography></Stack>
                <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}><Wifi size={16} color={ACACIA} /><Typography variant="body2">Smart Campus</Typography></Stack>
                <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}><UserCheck size={16} color={ACACIA} /><Typography variant="body2">TSC Compliant</Typography></Stack>
              </Stack>
            </Grid>

            <Grid size={{ xs: 12, md: 5 }} sx={{ display: { xs: 'none', md: 'block' }, position: 'relative' }}>
              <Box sx={{ position: 'relative' }}>
                <Paper
                  elevation={0}
                  sx={{
                    borderRadius: 6, overflow: 'hidden', border: '1px solid', borderColor: 'divider',
                    aspectRatio: '4/5', position: 'relative',
                  }}
                >
                  <Box
                    component="img"
                    src="/images/hero-classroom.jpg"
                    alt="A teacher leading an engaged classroom discussion"
                    sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                  <Box sx={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 55%, rgba(13,18,16,0.75) 100%)' }} />
                  <Box sx={{ position: 'absolute', left: 20, right: 20, bottom: 18, color: '#fff' }}>
                    <Typography variant="subtitle2" sx={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700 }}>MyFantasia</Typography>
                    <Typography variant="caption" sx={{ opacity: 0.85 }}>Nairobi Campus</Typography>
                  </Box>
                </Paper>

                <Paper
                  component={RouterLink}
                  to="/studentclick"
                  elevation={6}
                  sx={{
                    position: 'absolute', top: '8%', left: -28, px: 2, py: 1.25, borderRadius: 3,
                    display: 'flex', alignItems: 'center', gap: 1.5, border: '1px solid', borderColor: 'divider',
                    transform: `translateY(${badgeOffset1}px)`, textDecoration: 'none', color: 'inherit',
                    cursor: 'pointer', transition: 'transform .2s ease, box-shadow .2s ease',
                    '&:hover': { transform: `translateY(${badgeOffset1 - 4}px)`, boxShadow: 8 },
                  }}
                >
                  <Box sx={{ width: 34, height: 34, borderRadius: 2, bgcolor: `${TERRACOTTA}22`, color: TERRACOTTA, display: 'grid', placeItems: 'center' }}>
                    <FileSignature size={16} />
                  </Box>
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.2 }}>Exam Results</Typography>
                    <Typography variant="caption" color="text.secondary">Term 1 CATs Released</Typography>
                  </Box>
                </Paper>

                <Paper
                  component={RouterLink}
                  to="/parentclick"
                  elevation={6}
                  sx={{
                    position: 'absolute', bottom: '10%', right: -24, px: 2, py: 1.25, borderRadius: 3,
                    display: 'flex', alignItems: 'center', gap: 1.5, border: '1px solid', borderColor: 'divider',
                    transform: `translateY(${badgeOffset2}px)`, textDecoration: 'none', color: 'inherit',
                    cursor: 'pointer', transition: 'transform .2s ease, box-shadow .2s ease',
                    '&:hover': { transform: `translateY(${badgeOffset2 - 4}px)`, boxShadow: 8 },
                  }}
                >
                  <Box sx={{ width: 34, height: 34, borderRadius: 2, bgcolor: `${ACACIA}22`, color: ACACIA, display: 'grid', placeItems: 'center' }}>
                    <Wallet size={16} />
                  </Box>
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.2 }}>Fees Paid</Typography>
                    <Typography variant="caption" color="text.secondary">via M-PESA</Typography>
                  </Box>
                </Paper>
              </Box>
            </Grid>
          </Grid>
        </Container>
      </Box>

      {/* --- STATS BAND --- */}
      <Box sx={{ borderTop: '1px solid', borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'action.hover' }}>
        <Container maxWidth="lg" sx={{ py: 4 }}>
          <Grid container spacing={3}>
            {STATS.map((stat) => (
              <Grid key={stat.label} size={{ xs: 6, sm: 3 }}>
                <Typography sx={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 500, fontSize: { xs: '1.5rem', md: '1.9rem' }, color: 'primary.main' }}>
                  {stat.value}
                </Typography>
                <Typography variant="body2" color="text.secondary">{stat.label}</Typography>
              </Grid>
            ))}
          </Grid>
        </Container>
      </Box>

      {/* --- PORTAL CARDS --- */}
      <Container maxWidth="lg" sx={{ py: { xs: 6, md: 8 } }}>
        <Stack sx={{ alignItems: 'center', mb: 5, textAlign: 'center' }} spacing={1}>
          <Typography variant="h3" sx={{ fontSize: { xs: '1.8rem', md: '2.2rem' } }}>
            Select Your <GradientWord>Portal</GradientWord>
          </Typography>
          <Typography variant="body1" color="text.secondary">Secure login gateways for administration, faculty, and families.</Typography>
        </Stack>

        <Grid container spacing={3}>
          {PORTAL_CARDS.map((card) => {
            const accent = ROLE_ACCENTS[card.role];
            return (
              <Grid key={card.to} size={{ xs: 12, sm: 6, md: 3 }}>
                <Card sx={{ height: '100%', p: 1, borderTop: `3px solid ${accent}`, transition: 'transform .2s ease', '&:hover': { transform: 'translateY(-6px)' } }}>
                  <CardContent>
                    <Box sx={{ width: 48, height: 48, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: `${accent}1a`, color: accent, mb: 2 }}>
                      <card.icon size={22} />
                    </Box>
                    <Typography variant="h6" sx={{ mb: 1 }}>{card.title}</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{card.body}</Typography>
                    <Button component={RouterLink} to={card.to} endIcon={<ArrowRight size={14} />} sx={{ px: 0, color: accent }}>
                      Login
                    </Button>
                  </CardContent>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      </Container>

      {/* --- HOW IT WORKS --- */}
      <Box sx={{ bgcolor: 'action.hover', py: { xs: 6, md: 8 }, borderTop: '1px solid', borderBottom: '1px solid', borderColor: 'divider' }}>
        <Container maxWidth="lg">
          <Stack sx={{ alignItems: 'center', mb: 5, textAlign: 'center' }} spacing={1}>
            <Typography variant="h3" sx={{ fontSize: { xs: '1.8rem', md: '2.2rem' } }}>
              How It <GradientWord>Works</GradientWord>
            </Typography>
            <Typography variant="body1" color="text.secondary">From portal pick to live dashboard in three steps.</Typography>
          </Stack>
          <Grid container spacing={4}>
            {HOW_IT_WORKS.map((item) => (
              <Grid key={item.step} size={{ xs: 12, sm: 4 }}>
                <Stack spacing={1.5}>
                  <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                    <Box sx={{ width: 44, height: 44, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: `${DAWN_GOLD}1a`, color: DAWN_GOLD, flexShrink: 0 }}>
                      <item.icon size={20} />
                    </Box>
                    <Typography sx={{ fontFamily: "'IBM Plex Mono', monospace", color: 'text.secondary', fontSize: '0.85rem' }}>{item.step}</Typography>
                  </Stack>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{item.title}</Typography>
                  <Typography variant="body2" color="text.secondary">{item.body}</Typography>
                </Stack>
              </Grid>
            ))}
          </Grid>
        </Container>
      </Box>

      {/* --- BEYOND THE CLASSROOM (image pagination gallery) --- */}
      <Box sx={{ bgcolor: 'action.hover', py: { xs: 6, md: 8 } }}>
        <Container maxWidth="lg">
          <Stack sx={{ alignItems: 'center', mb: 5, textAlign: 'center' }} spacing={1}>
            <Typography variant="h3" sx={{ fontSize: { xs: '1.8rem', md: '2.2rem' } }}>
              Beyond the <GradientWord>Classroom</GradientWord>
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 560 }}>
              Labs, pitches, stages, and clubs — a platform built around everything a Fantasian actually does, not just a dashboard.
            </Typography>
          </Stack>
          <ImagePaginationGallery slides={BEYOND_THE_CLASSROOM} />
        </Container>
      </Box>

      {/* --- CAMPUS PULSE --- */}
      <Container maxWidth="lg" sx={{ py: { xs: 6, md: 8 } }}>
        <Stack sx={{ alignItems: 'center', mb: 5, textAlign: 'center' }} spacing={1}>
          <Typography variant="h3" sx={{ fontSize: { xs: '1.8rem', md: '2.2rem' } }}>
            Campus <GradientWord>Pulse</GradientWord>
          </Typography>
          <Typography variant="body1" color="text.secondary">Keeping our community informed on the latest happenings.</Typography>
        </Stack>

        {events && events.length > 0 ? (
          <Grid container spacing={3}>
            {events.map((event) => {
              const meta = EVENT_META[event.event_type] ?? DEFAULT_EVENT_META;
              return (
                <Grid key={event.id} size={{ xs: 12, sm: 6, md: 4 }}>
                  <Card sx={{ height: '100%', borderTop: `3px solid ${meta.color}` }}>
                    <Box sx={{ height: 140, display: 'grid', placeItems: 'center', bgcolor: `${meta.color}1a`, color: meta.color }}>
                      <meta.icon size={40} />
                    </Box>
                    <CardContent>
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1.5 }}>
                        <Typography variant="caption" color="text.secondary">
                          {new Date(event.start_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </Typography>
                        <Chip label={event.event_type} size="small" sx={{ ml: 'auto', bgcolor: meta.color, color: '#fff' }} />
                      </Stack>
                      <Typography variant="subtitle1" sx={{ mb: 1 }}>{event.title}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {truncateWords(event.description || 'More details coming soon.', 28)}
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
              );
            })}
          </Grid>
        ) : events && events.length === 0 ? (
          <Paper variant="outlined" sx={{ p: 6, textAlign: 'center', borderStyle: 'dashed' }}>
            <CalendarPlus size={32} color={DAWN_GOLD} style={{ marginBottom: 12 }} />
            <Typography color="text.secondary">No campus updates published yet — check back soon.</Typography>
          </Paper>
        ) : null}
      </Container>

      {/* --- WHY PARENTS TRUST --- */}
      <Box sx={{ bgcolor: 'action.hover', py: { xs: 6, md: 8 } }}>
        <Container maxWidth="lg" sx={{ textAlign: 'center' }}>
          <Typography variant="h3" sx={{ fontSize: { xs: '1.8rem', md: '2.2rem' }, mb: 5 }}>
            Why Parents Trust <GradientWord>MyFantasia</GradientWord>
          </Typography>
          <Grid container spacing={5}>
            {INFO_ITEMS.map((item) => (
              <Grid key={item.title} size={{ xs: 12, sm: 4 }}>
                <Stack sx={{ alignItems: 'center' }} spacing={1.5}>
                  <Box sx={{ width: 56, height: 56, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: `${DAWN_GOLD}1a`, color: DAWN_GOLD }}>
                    <item.icon size={26} />
                  </Box>
                  <Typography variant="subtitle1">{item.title}</Typography>
                  <Typography variant="body2" color="text.secondary">{item.body}</Typography>
                </Stack>
              </Grid>
            ))}
          </Grid>
        </Container>
      </Box>

      {/* --- FINAL CTA --- */}
      <Container maxWidth="md" sx={{ py: { xs: 7, md: 10 }, textAlign: 'center' }}>
        <Typography variant="h3" sx={{ fontSize: { xs: '1.7rem', md: '2.1rem' }, mb: 1.5 }}>
          Ready to bring your school online?
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
          Admissions, attendance, results and fees — one platform, every role.
        </Typography>
        <Stack direction="row" spacing={2} useFlexGap sx={{ justifyContent: "center", flexWrap: "wrap" }}>
          <Button component={RouterLink} to="/portal" variant="contained" size="large" disableElevation sx={{ bgcolor: 'primary.main', color: '#1A1400' }} endIcon={<ArrowRight size={18} />}>
            Get Started
          </Button>
          <Button component={RouterLink} to="/contactus" variant="outlined" size="large">
            Talk to Us
          </Button>
        </Stack>
      </Container>
    </Box>
  );
}
