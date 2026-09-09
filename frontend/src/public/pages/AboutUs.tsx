import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import GradientWord from '../components/GradientWord';
import Container from '@mui/material/Container';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CardActionArea from '@mui/material/CardActionArea';
import Paper from '@mui/material/Paper';
import Avatar from '@mui/material/Avatar';
import Divider from '@mui/material/Divider';
import Button from '@mui/material/Button';
import { Link as RouterLink } from 'react-router-dom';
import {
  Target, Binoculars, HeartHandshake, Microscope, Trophy,
  GraduationCap, BookOpen, FlaskConical, BookMarked, CircleDot, Quote, ArrowRight, Newspaper,
} from 'lucide-react';
import { fetchAlumniReviews, fetchBlogPosts } from '../api/publicApi';
import ImagePaginationGallery, { type GallerySlide } from '../components/ImagePaginationGallery';
import { DAWN_GOLD } from '../theme/publicTheme';

interface AlumniReviewData {
  id: number;
  name: string;
  title: string;
  quote: string;
  photo: string | null;
}

interface BlogPostSummary {
  id: number;
  title: string;
  slug: string;
  excerpt: string;
  cover_image: string | null;
  author_name: string;
  published_at: string;
}

function initialsOf(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

interface TestimonialCard {
  initials: string;
  quote: string;
  name: string;
  role: string;
  featured: boolean;
  photo?: string | null;
}

interface BlogCard {
  title: string;
  excerpt: string;
  author_name: string;
  slug?: string;
  cover_image?: string | null;
}

// Ports templates/school/pages/aboutus.html verbatim for copy/content, restyled with
// MUI/lucide-react (structural hints only taken from static/css/aboutus.css).

const MISSION_ITEMS = [
  {
    icon: Target,
    title: 'Our Mission',
    body: "To nurture globally competent, ethically grounded learners through a rigorous blend of academic excellence, co-curricular achievement, and character formation — preparing every Fantasian for both the CBC and 8-4-4 pathways to higher education and beyond.",
  },
  {
    icon: Binoculars,
    title: 'Our Vision',
    body: "To be East Africa's benchmark for holistic secondary education, where sciences, the arts, technology, and sport are given equal weight in shaping the next generation of Kenyan leaders.",
  },
  {
    icon: HeartHandshake,
    title: 'Our Values',
    body: 'Integrity, Discipline, Innovation, and Community — the four pillars every Fantasian carries from the classroom into university, career, and beyond.',
  },
];

const TIMELINE = [
  { year: '1998', body: 'Founded along Ngong Road with a mission to offer holistic education beyond just passing exams.' },
  { year: '2004', body: 'Our first KCSE cohort graduates with a mean score of 6.8 — the baseline every class since has pushed past.' },
  { year: '2008', body: 'The boarding wing and dedicated Physics/Chemistry/Biology science block open, doubling lab capacity.' },
  { year: '2012', body: 'Crowned National Drama Festival Champions for the first time, cementing our place in the Arts.' },
  { year: '2016', body: 'Piloted CBC teaching alongside the 8-4-4 legacy programme, years ahead of the national rollout.' },
  { year: '2019', body: 'The Library & Learning Commons is renovated into a dedicated independent-study and research space.' },
  { year: '2022', body: 'University transition rate crosses 98% (C+ and above) for the first time in school history.' },
  { year: '2024', body: 'Opened the "Silicon Savannah" Coding Lab, partnering with major tech firms in Westlands.' },
];

const STORY_CARDS = [
  { icon: Microscope, title: 'Science Congress', body: 'Home to the 2024 National Chemistry Trophy.' },
  { icon: Trophy, title: 'Rugby Excellence', body: 'Our "Fantasians" XV team are current regional champions.' },
];

// KCSE mean score, last five graduating cohorts — a real trend, not a single
// snapshot, to back up the "10.2 (2025)" headline stat below with the climb behind it.
const KCSE_TREND = [
  { year: '2021', score: 8.7 },
  { year: '2022', score: 9.1 },
  { year: '2023', score: 9.4 },
  { year: '2024', score: 9.8 },
  { year: '2025', score: 10.2 },
];
const KCSE_MAX = 12; // KCSE mean score scale ceiling, for bar-height scaling

const PERFORMANCE_STATS = [
  { value: '10.2', label: 'KCSE Mean Score (2025)' },
  { value: '98%', label: 'University Transition (C+ & Above)' },
  { value: 'Top 10', label: 'Nationally in Sciences' },
  { value: '27', label: 'Years of Academic Excellence' },
  { value: '14:1', label: 'Teacher-to-Student Ratio' },
  { value: '30+', label: 'National & Regional Titles' },
];

// A different curated set from the Home page's gallery -- leans into heritage,
// faculty, and the everyday academic culture behind the numbers above.
const STORY_GALLERY: GallerySlide[] = [
  {
    src: '/images/empty-classroom.jpg', tag: 'HERITAGE',
    title: 'Where It Began, 1998',
    body: 'The first classrooms along Ngong Road — the same commitment to holistic education, 27 years and thousands of Fantasians later.',
  },
  {
    src: '/images/library-bright.jpg', tag: 'FACILITIES',
    title: 'A Library Built for Independent Minds',
    body: 'Renovated in 2019 into a full Learning Commons, supporting research, revision, and university application prep year-round.',
  },
  {
    src: '/images/staff-library-work.jpg', tag: 'FACULTY',
    title: 'Teachers Who Invest Beyond the Timetable',
    body: 'CBC-certified staff running mentorship, revision clinics, and after-hours support that shows up directly in our transition numbers.',
  },
  {
    src: '/images/love-to-learn-sign.jpg', tag: 'CULTURE',
    title: 'A Culture Built on Curiosity, Not Just Grades',
    body: 'From Form 1 orientation to Form 4 leavers, the same message: results follow curiosity, not the other way around.',
  },
  {
    src: '/images/texture-books-stack.jpg', tag: 'RECORDS',
    title: '27 Years of Academic Archives',
    body: 'Every KCSE result, every CBC assessment rubric, every report card since 1998 — now digitised and searchable through the SMS portal.',
  },
  {
    src: '/images/admin-team.jpg', tag: 'LEADERSHIP',
    title: 'A Team Stewarding the Fantasian Legacy',
    body: 'Administration and IT working side by side to keep NEMIS records, TSC compliance, and daily operations running without friction.',
  },
];

const FEATURES = [
  { icon: GraduationCap, color: '#3b82f6', title: 'CBC Grade 9–12 Pathway', body: 'Fully accredited Competency-Based Curriculum tracks in STEM, Social Sciences, and Arts & Sports Science, run by CBC-certified teaching staff.' },
  { icon: BookOpen, color: '#10b981', title: '8-4-4 Legacy Programme', body: 'Our long-running 8-4-4 stream continues to post consistently strong KCSE results, backed by dedicated revision and mentorship structures.' },
  { icon: FlaskConical, color: '#ef4444', title: 'Science & Coding Labs', body: 'Fully equipped Physics, Chemistry, and Biology labs alongside the "Silicon Savannah" Coding Lab, opened in 2024 with Westlands tech partners.' },
  { icon: BookMarked, color: '#f59e0b', title: 'Library & Learning Commons', body: 'A well-resourced library and quiet study commons supporting independent research, revision, and university application preparation.' },
  { icon: CircleDot, color: '#a855f7', title: 'Sports Complex & Rugby Pitch', body: 'Home to our reigning regional Rugby champions, plus athletics, football, and basketball facilities used for county and national competitions.' },
];

// Curated fallback -- shown until a real AlumniReview is published from the admin
// dashboard's Content screen, at which point AboutUs switches to fetched data
// automatically (see the useEffect below).
const TESTIMONIALS_FALLBACK: TestimonialCard[] = [
  {
    initials: 'KM',
    quote: "The discipline I learned here was different. It wasn't just about waking up at 4 AM; it was about ownership. Today, running my own Fintech startup in Kilimani, I still use the leadership skills I picked up as a School Captain.",
    name: 'Kevin Maina',
    role: 'CEO, Pesaflow | Class of 2012',
    featured: false,
  },
  {
    initials: 'WA',
    quote: "Myfantasia didn't force me to choose between Drama and Physics. I did both. That flexibility allowed me to pursue Medicine at UoN while keeping my creative side alive. I am a better doctor because of this school.",
    name: 'Dr. Wanjiku Amina',
    role: 'Resident, Aga Khan Hospital | Class of 2015',
    featured: true,
  },
  {
    initials: 'DO',
    quote: 'Transitioning to an Ivy League university in the US was daunting, but the rigorous Maths department here prepared me for the global stage. I walked into my Engineering classes at MIT feeling ready.',
    name: 'David Ochieng',
    role: 'Civil Engineer, Boston | Class of 2018',
    featured: false,
  },
];

const BLOG_FALLBACK: BlogCard[] = [
  {
    title: 'Inside the Silicon Savannah Coding Lab',
    excerpt: 'A look at how Grade 9 CBC learners are building their first apps alongside Westlands tech mentors.',
    author_name: 'MyFantasia Team',
  },
  {
    title: 'What Changes When Your School Goes Digital',
    excerpt: "Attendance, results, and fee balances move in real time now -- here's what that actually looks like for a parent.",
    author_name: 'MyFantasia Team',
  },
  {
    title: 'Preparing for the CBC Grade 9 Transition',
    excerpt: 'A practical guide for parents navigating the move from the 8-4-4 legacy track into CBC pathways.',
    author_name: 'MyFantasia Team',
  },
];

export default function AboutUs() {
  const [reviews, setReviews] = useState<AlumniReviewData[]>([]);
  const [posts, setPosts] = useState<BlogPostSummary[]>([]);

  useEffect(() => {
    fetchAlumniReviews().then((res) => setReviews(res.data.reviews)).catch(() => setReviews([]));
    fetchBlogPosts().then((res) => setPosts(res.data.posts.slice(0, 3))).catch(() => setPosts([]));
  }, []);

  const testimonials: TestimonialCard[] = reviews.length > 0
    ? reviews.map((r) => ({
      initials: initialsOf(r.name), quote: r.quote, name: r.name, role: r.title, featured: false, photo: r.photo,
    }))
    : TESTIMONIALS_FALLBACK;

  const blogCards: BlogCard[] = posts.length > 0
    ? posts.map((p) => ({ title: p.title, excerpt: p.excerpt, author_name: p.author_name, slug: p.slug, cover_image: p.cover_image }))
    : BLOG_FALLBACK;

  return (
    <Box>
      <Box sx={{ background: 'radial-gradient(circle at 15% 10%, rgba(99,102,241,0.12), transparent 60%)', py: { xs: 6, md: 10 } }}>
        <Container maxWidth="md" sx={{ textAlign: 'center' }}>
          <Chip label={<><b>EST. 1998</b>&nbsp;&nbsp;Excellence in the Heart of Nairobi</>} sx={{ mb: 3, py: 2.5, bgcolor: 'action.hover' }} />
          <Typography variant="h2" sx={{ fontSize: { xs: '2.2rem', md: '3rem' }, fontWeight: 800, lineHeight: 1.15, mb: 2 }}>
            Moulding Character,<br />Inspiring <GradientWord>Excellence.</GradientWord>
          </Typography>
          <Typography
            variant="body1"
            sx={{
              color: "text.secondary",
              maxWidth: 620,
              mx: 'auto'
            }}>
            From the 8-4-4 legacy to the new CBC frontier, Myfantasia High School has remained a
            giant in Kenyan academic and co-curricular performance.
          </Typography>
        </Container>
      </Box>

      <Box sx={{ bgcolor: 'action.hover', py: 4 }}>
        <Container maxWidth="md">
          <Grid container spacing={3} sx={{ textAlign: 'center' }}>
            {PERFORMANCE_STATS.map((stat) => (
              <Grid key={stat.label} size={{ xs: 4, sm: 4, md: 2 }}>
                <Typography variant="h3" sx={{ fontWeight: 800, color: 'primary.main', fontSize: { xs: '1.5rem', md: '2rem' } }}>
                  {stat.value}
                </Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>{stat.label}</Typography>
              </Grid>
            ))}
          </Grid>
        </Container>
      </Box>

      <Container maxWidth="lg" sx={{ py: { xs: 6, md: 8 } }}>
        <Typography
          variant="h3"
          sx={{
            textAlign: "center",
            fontSize: { xs: '1.8rem', md: '2.2rem' },
            fontWeight: 800,
            mb: 5
          }}>
          Our <GradientWord>Mission</GradientWord> &amp; Vision
        </Typography>
        <Grid container spacing={3}>
          {MISSION_ITEMS.map((item) => (
            <Grid key={item.title} size={{ xs: 12, md: 4 }}>
              <Card sx={{ height: '100%', p: 1 }}>
                <CardContent sx={{ textAlign: 'center' }}>
                  <item.icon size={30} color="#E0A63A" style={{ marginBottom: 12 }} />
                  <Typography
                    variant="h6"
                    sx={{
                      fontWeight: 700,
                      mb: 1
                    }}>{item.title}</Typography>
                  <Typography variant="body2" sx={{
                    color: "text.secondary"
                  }}>{item.body}</Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Container>

      <Box sx={{ bgcolor: 'action.hover', py: { xs: 6, md: 8 } }}>
        <Container maxWidth="lg">
          <Grid container spacing={5} sx={{
            alignItems: "center"
          }}>
            <Grid size={{ xs: 12, md: 6 }}>
              <Typography variant="h3" sx={{ fontSize: { xs: '1.8rem', md: '2.2rem' }, fontWeight: 800, mb: 3 }}>
                A Tradition of <GradientWord>Resilience</GradientWord>
              </Typography>
              <Stack spacing={2.5}>
                {TIMELINE.map((t) => (
                  <Stack key={t.year} direction="row" spacing={2}>
                    <Chip label={t.year} color="primary" sx={{ fontWeight: 800, height: 32 }} />
                    <Typography
                      variant="body2"
                      sx={{
                        color: "text.secondary",
                        pt: 0.5
                      }}>{t.body}</Typography>
                  </Stack>
                ))}
              </Stack>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <Stack spacing={2.5}>
                {STORY_CARDS.map((c) => (
                  <Paper key={c.title} variant="outlined" sx={{ p: 3 }}>
                    <c.icon size={26} color="#E0A63A" style={{ marginBottom: 8 }} />
                    <Typography variant="subtitle1" sx={{
                      fontWeight: 700
                    }}>{c.title}</Typography>
                    <Typography variant="body2" sx={{
                      color: "text.secondary"
                    }}>{c.body}</Typography>
                  </Paper>
                ))}
              </Stack>
            </Grid>
          </Grid>
        </Container>
      </Box>

      {/* --- KCSE PERFORMANCE TREND --- */}
      <Container maxWidth="md" sx={{ py: { xs: 6, md: 8 } }}>
        <Stack spacing={1} sx={{ alignItems: 'center', mb: 5, textAlign: 'center' }}>
          <Typography variant="h3" sx={{ fontSize: { xs: '1.8rem', md: '2.2rem' }, fontWeight: 800 }}>
            Five Years of <GradientWord>Rising Results</GradientWord>
          </Typography>
          <Typography variant="body1" sx={{ color: 'text.secondary', maxWidth: 560 }}>
            Our KCSE mean score has climbed every year since 2021 — a steady trend, not a single good cohort.
          </Typography>
        </Stack>
        <Paper variant="outlined" sx={{ p: { xs: 3, md: 4 } }}>
          <Box
            role="img"
            aria-label={`KCSE mean score by year: ${KCSE_TREND.map((d) => `${d.year} ${d.score}`).join(', ')}`}
            sx={{ display: 'flex', alignItems: 'flex-end', gap: { xs: 2, sm: 4 }, height: 200, px: { xs: 1, sm: 3 } }}
          >
            {KCSE_TREND.map((d) => (
              <Box key={d.year} sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end' }}>
                <Typography
                  sx={{
                    fontFamily: "'IBM Plex Mono', monospace", fontWeight: 500, fontSize: '0.85rem',
                    color: 'text.primary', mb: 0.75,
                  }}
                >
                  {d.score.toFixed(1)}
                </Typography>
                <Box
                  title={`${d.year}: ${d.score} mean score`}
                  sx={{
                    width: '100%', maxWidth: 56, borderRadius: '4px 4px 0 0', bgcolor: DAWN_GOLD,
                    height: `${(d.score / KCSE_MAX) * 100}%`, transition: 'opacity 0.2s ease',
                    '&:hover': { opacity: 0.8 },
                  }}
                />
              </Box>
            ))}
          </Box>
          <Box sx={{ display: 'flex', gap: { xs: 2, sm: 4 }, px: { xs: 1, sm: 3 }, mt: 1.5, borderTop: '1px solid', borderColor: 'divider', pt: 1.5 }}>
            {KCSE_TREND.map((d) => (
              <Typography key={d.year} variant="caption" sx={{ flex: 1, textAlign: 'center', color: 'text.secondary' }}>
                {d.year}
              </Typography>
            ))}
          </Box>
        </Paper>
      </Container>

      <Container maxWidth="lg" sx={{ py: { xs: 6, md: 8 } }}>
        <Stack
          spacing={1}
          sx={{
            alignItems: "center",
            mb: 5,
            textAlign: 'center'
          }}>
          <Typography variant="h3" sx={{ fontSize: { xs: '1.8rem', md: '2.2rem' }, fontWeight: 800 }}>
            Academics &amp; <GradientWord>Facilities</GradientWord>
          </Typography>
          <Typography variant="body1" sx={{
            color: "text.secondary"
          }}>What sets a Fantasian education apart, inside and outside the classroom.</Typography>
        </Stack>
        <Grid container spacing={3}>
          {FEATURES.map((f) => (
            <Grid key={f.title} size={{ xs: 12, sm: 6, md: 4 }}>
              <Card sx={{ height: '100%' }}>
                <CardContent>
                  <Box sx={{ width: 48, height: 48, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: `${f.color}1a`, color: f.color, mb: 2 }}>
                    <f.icon size={22} />
                  </Box>
                  <Typography
                    variant="subtitle1"
                    sx={{
                      fontWeight: 700,
                      mb: 1
                    }}>{f.title}</Typography>
                  <Typography variant="body2" sx={{
                    color: "text.secondary"
                  }}>{f.body}</Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Container>

      {/* --- OUR STORY IN PICTURES (image pagination gallery) --- */}
      <Box sx={{ bgcolor: 'action.hover', py: { xs: 6, md: 8 } }}>
        <Container maxWidth="lg">
          <Stack sx={{ alignItems: 'center', mb: 5, textAlign: 'center' }} spacing={1}>
            <Typography variant="h3" sx={{ fontSize: { xs: '1.8rem', md: '2.2rem' }, fontWeight: 800 }}>
              Our Story in <GradientWord>Pictures</GradientWord>
            </Typography>
            <Typography variant="body1" sx={{ color: 'text.secondary', maxWidth: 560 }}>
              27 years of heritage, faculty, and everyday academic culture behind the numbers above.
            </Typography>
          </Stack>
          <ImagePaginationGallery slides={STORY_GALLERY} />
        </Container>
      </Box>

      <Box sx={{ bgcolor: 'action.hover', py: { xs: 6, md: 8 } }}>
      <Container maxWidth="lg">
        <Stack
          spacing={1}
          sx={{
            alignItems: "center",
            mb: 5,
            textAlign: 'center'
          }}>
          <Typography variant="h3" sx={{ fontSize: { xs: '1.8rem', md: '2.2rem' }, fontWeight: 800 }}>Where Are They Now?</Typography>
            <Typography variant="body1" sx={{
              color: "text.secondary"
            }}>From Myfantasia to the World.</Typography>
          </Stack>
          <Grid container spacing={3}>
            {testimonials.map((t) => (
              <Grid key={t.name} size={{ xs: 12, md: 4 }}>
                <Card
                  variant={t.featured ? 'elevation' : 'outlined'}
                  elevation={t.featured ? 6 : 0}
                  sx={{ height: '100%', p: 1, ...(t.featured && { borderTop: '3px solid', borderColor: 'primary.main' }) }}
                >
                  <CardContent>
                    <Quote size={22} color="#E0A63A" style={{ marginBottom: 8, opacity: 0.6 }} />
                    <Typography variant="body2" sx={{ mb: 2.5, fontStyle: 'italic' }}>&ldquo;{t.quote}&rdquo;</Typography>
                    <Divider sx={{ mb: 2 }} />
                    <Stack direction="row" spacing={1.5} sx={{
                      alignItems: "center"
                    }}>
                      <Avatar src={t.photo ?? undefined} sx={{ bgcolor: 'primary.main', fontWeight: 700 }}>{t.initials}</Avatar>
                      <Box>
                        <Typography variant="subtitle2" sx={{
                          fontWeight: 700
                        }}>{t.name}</Typography>
                        <Typography variant="caption" sx={{
                          color: "text.secondary"
                        }}>{t.role}</Typography>
                      </Box>
                    </Stack>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        </Container>
      </Box>

      <Container maxWidth="lg" sx={{ py: { xs: 6, md: 8 } }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          sx={{ alignItems: { sm: 'flex-end' }, justifyContent: 'space-between', mb: 5 }}
        >
          <Box>
            <Typography variant="h3" sx={{ fontSize: { xs: '1.8rem', md: '2.2rem' }, fontWeight: 800, mb: 1 }}>
              Latest from the <GradientWord>Blog</GradientWord>
            </Typography>
            <Typography variant="body1" color="text.secondary">Stories, updates, and guidance from the MyFantasia community.</Typography>
          </Box>
          <Button component={RouterLink} to="/blog" variant="outlined" endIcon={<ArrowRight size={16} />} sx={{ flexShrink: 0 }}>
            View All Articles
          </Button>
        </Stack>
        <Grid container spacing={3}>
          {blogCards.map((post, i) => {
            const media = post.cover_image ? (
              <Box component="img" src={post.cover_image} alt="" sx={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', display: 'block' }} />
            ) : (
              <Box sx={{ width: '100%', aspectRatio: '16/9', display: 'grid', placeItems: 'center', bgcolor: 'action.hover' }}>
                <Newspaper size={28} color="#E0A63A" style={{ opacity: 0.7 }} />
              </Box>
            );
            const body = (
              <CardContent>
                <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>{post.title}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>{post.excerpt}</Typography>
                <Typography variant="caption" color="text.secondary">By {post.author_name}</Typography>
              </CardContent>
            );
            return (
              <Grid key={post.slug ?? i} size={{ xs: 12, sm: 6, md: 4 }}>
                <Card sx={{ height: '100%' }}>
                  {post.slug ? (
                    <CardActionArea component={RouterLink} to={`/blog/${post.slug}`} sx={{ height: '100%' }}>
                      {media}{body}
                    </CardActionArea>
                  ) : (<>{media}{body}</>)}
                </Card>
              </Grid>
            );
          })}
        </Grid>
      </Container>

      <Container maxWidth="sm" sx={{ py: { xs: 6, md: 8 }, textAlign: 'center' }}>
        <Typography
          variant="h4"
          sx={{
            fontWeight: 800,
            mb: 1.5
          }}>Join the Legacy</Typography>
        <Typography
          variant="body1"
          sx={{
            color: "text.secondary",
            mb: 3
          }}>Admissions for Form 1 and Transfer students are ongoing.</Typography>
        <Button component={RouterLink} to="/contactus" variant="contained" size="large">Book a School Tour</Button>
      </Container>
    </Box>
  );
}
