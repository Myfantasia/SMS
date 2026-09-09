import Box from '@mui/material/Box';
import GradientWord from '../components/GradientWord';
import Container from '@mui/material/Container';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Paper from '@mui/material/Paper';
import Divider from '@mui/material/Divider';
import {
  CalendarCheck, Coffee, FileWarning, DoorOpen,
  Trophy, BookOpenCheck, Drama, Megaphone, AlertCircle, Receipt, Shirt,
  FileText, MapPin, Clock,
} from 'lucide-react';

// Ports templates/school/pages/events.html verbatim -- confirmed 100% static/hardcoded
// content (the Django view passed no context despite its docstring). The original used
// jsPDF (a CDN library, not a project dependency) to generate a downloadable PDF from
// each memo card on click -- out of scope for this UI-only rewrite, so the memo cards
// below render as plain static content with the "Download" affordance dropped.

const TIMELINE = [
  { month: 'JAN', day: '08', badge: 'Admissions', color: '#3b82f6', icon: DoorOpen, title: 'Term 1 Grand Opening', body: 'The gates of MyFantasia swing open! We welcome our new Form 1 cohort for their orientation week at the Multi-Purpose Hall. Continuing students must report by 4:00 PM.' },
  { month: 'FEB', day: '26', badge: 'Half Term', color: '#f59e0b', icon: Coffee, title: 'Mid-Term Recess', body: 'A well-deserved breather for the entire fraternity. Students break for the midterm recess to recharge. Parents are reminded that pick-up begins strictly at 1:00 PM to avoid congestion on the main road.' },
  { month: 'MAR', day: '15', badge: 'Exams', color: '#ef4444', icon: FileWarning, title: 'Form 4 Mock Examinations', body: 'The crucible of excellence. Our Form 4 candidates face their first major hurdle—the Joint Districts Mock Exams. Absolute silence is observed near the Tuition Block.', active: true },
  { month: 'APR', day: '05', badge: 'Closing', color: '#10b981', icon: CalendarCheck, title: 'Term 1 Closing Day', body: 'We close the chapter on Term 1. Parents can access digital report forms via the Student Portal from 9:00 AM. Have a restful April holiday!' },
];

const UPCOMING = [
  { day: '14', month: 'FEB', cat: 'Sports', color: '#10b981', icon: Trophy, title: 'Inter-House Athletics', body: 'Kasarani Stadium Annex. All parents invited to cheer for Simba & Chui Houses.', time: '8:00 AM', place: 'Kasarani' },
  { day: '28', month: 'FEB', cat: 'Academic', color: '#3b82f6', icon: BookOpenCheck, title: 'Form 4 Prayer Day', body: 'Dedication service for KCSE Candidates. Guest Speaker: Dr. P.L.O Lumumba.', time: '9:30 AM', place: 'Main Hall' },
  { day: '15', month: 'MAR', cat: 'Culture', color: '#a855f7', icon: Drama, title: 'Drama Festivals', body: 'Our French Play "L\'Avenir" proceeds to the regionals in Mombasa.', time: 'All Day', place: 'Mombasa' },
];

const NOTICES = [
  { icon: AlertCircle, priority: true, title: 'Mid-Term Break Dates', badge: 'NEW', body: 'School breaks for half-term on Feb 26th. Reporting back date is March 2nd by 4:00 PM.', posted: 'Posted: Yesterday by Admin' },
  { icon: Receipt, priority: false, title: 'Term 1 Fee Balance', body: 'All fee balances must be cleared before the commencement of mock exams on March 15th.', posted: 'Posted: 2 days ago by Accounts' },
  { icon: Shirt, priority: false, title: 'Uniform Inspection', body: 'Strict uniform inspection will be conducted at the gate tomorrow morning. Ensure black leather shoes.', posted: 'Posted: 3 days ago by Deputy Principal' },
];

const TRIPS = [
  { date: '12 MAR', title: 'Geography Field Work', loc: "Hell's Gate, Naivasha", body: 'Form 3 Geography students will hike the gorges and visit the Olkaria Geothermal Plant to study faulting and renewable energy in action.', action: 'View Itinerary' },
  { date: '10 AUG', title: 'Annual Coastal Tour', loc: 'Mombasa & Diani', body: 'Sun, sand, and history! A 5-day tour visiting Fort Jesus, Haller Park, and the Marine Park. Open to all students. Slots are filling fast!', action: 'Register Now' },
  { date: '20 MAY', title: 'Silicon Savannah Tech Tour', loc: 'Nairobi Tech Hubs', body: 'The Computer Club visits Microsoft ADC and Konza City to witness the future of African tech innovation firsthand.', action: 'Club Members Only' },
];

const MEMOS = [
  { title: 'Fee Structure 2026', sub: 'Updated Jan 2026', body: 'The official Fee Structure for the year 2026 — Term 1: KES 45,000, Term 2: KES 35,000, Term 3: KES 20,000. All payments via M-PESA Paybill 522522, Account Number: Student Admission Number. Strictly no cash payments allowed.' },
  { title: 'Term 1 Newsletter', sub: "Principal's Desk", body: 'Welcome to Term 1, 2026. We are excited to announce our new CBC curriculum integration for Grade 9. Please ensure all students have the required textbooks by the end of the week. Sports day is scheduled for 14th Feb at Kasarani.' },
  { title: 'Uniform Policy', sub: 'Form 1 Intake Guide', body: 'Strict adherence to school uniform is required. Boys: Grey Trousers, White Shirt, School Tie, Navy Pullover. Girls: Navy Skirt, White Blouse, School Tie, Navy Pullover. Black leather shoes only — canvas shoes are for sports only.' },
  { title: 'Transport Routes', sub: 'Pick-up Points', body: 'Bus Route 1: Kitengela - Syokimau - School. Bus Route 2: Thika Road - Garden City - School. Bus Route 3: Westlands - CBD - School. Morning Pick-up: 6:00 AM at first stop.' },
];

export default function Events() {
  return (
    <Box>
      <Box sx={{ background: 'radial-gradient(circle at 15% 10%, rgba(99,102,241,0.12), transparent 60%)', py: { xs: 6, md: 9 } }}>
        <Container maxWidth="md" sx={{ textAlign: 'center' }}>
          <Chip icon={<CalendarCheck size={14} />} label="TERM 1 • 2026" sx={{ mb: 3, fontWeight: 700 }} />
          <Typography variant="h2" sx={{ fontSize: { xs: '2.2rem', md: '3rem' }, fontWeight: 800, mb: 2 }}>
            The <GradientWord>Pulse</GradientWord> of MyFantasia
          </Typography>
          <Typography
            variant="body1"
            sx={{
              color: "text.secondary",
              maxWidth: 640,
              mx: 'auto'
            }}>
            Experience the vibrant heartbeat of our campus—from the intense focus of the exam halls
            to the roaring energy of the rugby pitch and the adventures of our study tours.
          </Typography>
        </Container>
      </Box>

      <Container maxWidth="md" sx={{ py: { xs: 6, md: 8 } }}>
        <Stack
          spacing={1}
          sx={{
            alignItems: "center",
            mb: 5,
            textAlign: 'center'
          }}>
          <Typography variant="h3" sx={{ fontSize: { xs: '1.8rem', md: '2.2rem' }, fontWeight: 800 }}>
            Academic <GradientWord>Calendar</GradientWord>
          </Typography>
          <Typography variant="body1" sx={{
            color: "text.secondary"
          }}>The big picture for Term 1.</Typography>
        </Stack>

        <Stack spacing={3}>
          {TIMELINE.map((t) => (
            <Stack key={t.title} direction="row" spacing={2.5} sx={{
              alignItems: "flex-start"
            }}>
              <Box
                sx={{
                  flexShrink: 0, width: 64, height: 64, borderRadius: '50%', display: 'grid', placeItems: 'center',
                  bgcolor: t.active ? 'primary.main' : 'action.hover', color: t.active ? '#fff' : 'text.primary',
                  border: t.active ? 'none' : '1px solid', borderColor: 'divider',
                }}
              >
                <Stack spacing={0} sx={{
                  alignItems: "center"
                }}>
                  <Typography variant="caption" sx={{ lineHeight: 1, fontWeight: 700 }}>{t.month}</Typography>
                  <Typography variant="subtitle1" sx={{ lineHeight: 1.3, fontWeight: 800 }}>{t.day}</Typography>
                </Stack>
              </Box>
              <Paper variant="outlined" sx={{ p: 2.5, flex: 1, ...(t.active && { borderColor: 'primary.main', borderWidth: 2 }) }}>
                <Chip size="small" icon={<t.icon size={13} />} label={t.badge} sx={{ mb: 1, bgcolor: `${t.color}1a`, color: t.color, fontWeight: 700 }} />
                <Typography
                  variant="subtitle1"
                  sx={{
                    fontWeight: 700,
                    mb: 0.5
                  }}>{t.title}</Typography>
                <Typography variant="body2" sx={{
                  color: "text.secondary"
                }}>{t.body}</Typography>
              </Paper>
            </Stack>
          ))}
        </Stack>
      </Container>

      <Box sx={{ bgcolor: 'action.hover', py: { xs: 6, md: 8 } }}>
        <Container maxWidth="lg">
          <Stack
            spacing={1}
            sx={{
              alignItems: "center",
              mb: 5,
              textAlign: 'center'
            }}>
            <Typography variant="h3" sx={{ fontSize: { xs: '1.8rem', md: '2.2rem' }, fontWeight: 800 }}>
              Upcoming <GradientWord>Events</GradientWord>
            </Typography>
            <Typography variant="body1" sx={{
              color: "text.secondary"
            }}>Specific dates you can&apos;t miss.</Typography>
          </Stack>
          <Grid container spacing={3}>
            {UPCOMING.map((e) => (
              <Grid key={e.title} size={{ xs: 12, sm: 6, md: 4 }}>
                <Card sx={{ height: '100%' }}>
                  <CardContent>
                    <Stack
                      direction="row"
                      spacing={2}
                      sx={{
                        alignItems: "center",
                        mb: 2
                      }}>
                      <Box sx={{ textAlign: 'center', bgcolor: `${e.color}1a`, color: e.color, borderRadius: 2, px: 1.5, py: 0.75 }}>
                        <Typography
                          variant="h6"
                          sx={{
                            fontWeight: 800,
                            lineHeight: 1
                          }}>{e.day}</Typography>
                        <Typography variant="caption" sx={{
                          fontWeight: 700
                        }}>{e.month}</Typography>
                      </Box>
                      <Chip size="small" icon={<e.icon size={13} />} label={e.cat} sx={{ bgcolor: `${e.color}1a`, color: e.color, fontWeight: 700 }} />
                    </Stack>
                    <Typography
                      variant="subtitle1"
                      sx={{
                        fontWeight: 700,
                        mb: 1
                      }}>{e.title}</Typography>
                    <Typography
                      variant="body2"
                      sx={{
                        color: "text.secondary",
                        mb: 2
                      }}>{e.body}</Typography>
                    <Stack direction="row" spacing={2} sx={{
                      color: "text.secondary"
                    }}>
                      <Stack direction="row" spacing={0.5} sx={{
                        alignItems: "center"
                      }}><Clock size={14} /><Typography variant="caption">{e.time}</Typography></Stack>
                      <Stack direction="row" spacing={0.5} sx={{
                        alignItems: "center"
                      }}><MapPin size={14} /><Typography variant="caption">{e.place}</Typography></Stack>
                    </Stack>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        </Container>
      </Box>

      <Container maxWidth="md" sx={{ py: { xs: 6, md: 8 } }}>
        <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 } }}>
          <Stack spacing={0.5} sx={{ mb: 3 }}>
            <Typography variant="h4" sx={{ fontSize: { xs: '1.5rem', md: '1.8rem' }, fontWeight: 800 }}>
              Student <GradientWord>Notices</GradientWord>
            </Typography>
            <Typography variant="body2" sx={{
              color: "text.secondary"
            }}>Official circulars from the Principal&apos;s Desk.</Typography>
          </Stack>
          <Stack divider={<Divider />} spacing={2.5}>
            {NOTICES.map((n) => (
              <Stack key={n.title} direction="row" spacing={2}>
                <Box sx={{ color: n.priority ? 'error.main' : 'primary.main', mt: 0.5 }}>
                  <n.icon size={20} />
                </Box>
                <Box sx={{ flex: 1 }}>
                  <Stack direction="row" spacing={1} sx={{
                    alignItems: "center"
                  }}>
                    <Typography variant="subtitle2" sx={{
                      fontWeight: 700
                    }}>{n.title}</Typography>
                    {n.badge && <Chip size="small" label={n.badge} color="error" sx={{ height: 18, fontSize: '0.65rem', fontWeight: 700 }} />}
                  </Stack>
                  <Typography
                    variant="body2"
                    sx={{
                      color: "text.secondary",
                      mt: 0.5,
                      mb: 0.5
                    }}>{n.body}</Typography>
                  <Typography variant="caption" sx={{
                    color: "text.disabled"
                  }}>{n.posted}</Typography>
                </Box>
              </Stack>
            ))}
          </Stack>
        </Paper>
      </Container>

      <Box sx={{ bgcolor: 'action.hover', py: { xs: 6, md: 8 } }}>
        <Container maxWidth="lg">
          <Stack
            spacing={1}
            sx={{
              alignItems: "center",
              mb: 5,
              textAlign: 'center'
            }}>
            <Typography variant="h3" sx={{ fontSize: { xs: '1.8rem', md: '2.2rem' }, fontWeight: 800 }}>
              Upcoming <GradientWord>Adventures</GradientWord>
            </Typography>
            <Typography variant="body1" sx={{
              color: "text.secondary"
            }}>Learning extends beyond the four walls of the classroom.</Typography>
          </Stack>
          <Grid container spacing={3}>
            {TRIPS.map((t) => (
              <Grid key={t.title} size={{ xs: 12, sm: 6, md: 4 }}>
                <Card sx={{ height: '100%' }}>
                  <Box sx={{ position: 'relative', height: 140, bgcolor: 'primary.main', display: 'grid', placeItems: 'center' }}>
                    <Chip label={t.date} sx={{ position: 'absolute', top: 12, right: 12, bgcolor: 'rgba(0,0,0,0.55)', color: '#fff', fontWeight: 700 }} />
                    <MapPin size={36} color="#fff" style={{ opacity: 0.85 }} />
                  </Box>
                  <CardContent>
                    <Typography variant="subtitle1" sx={{
                      fontWeight: 700
                    }}>{t.title}</Typography>
                    <Stack
                      direction="row"
                      spacing={0.5}
                      sx={{
                        alignItems: "center",
                        color: "text.secondary",
                        mb: 1
                      }}>
                      <MapPin size={13} /><Typography variant="caption">{t.loc}</Typography>
                    </Stack>
                    <Typography
                      variant="body2"
                      sx={{
                        color: "text.secondary",
                        mb: 2
                      }}>{t.body}</Typography>
                    <Chip label={t.action} size="small" variant="outlined" />
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        </Container>
      </Box>

      <Container maxWidth="md" sx={{ py: { xs: 6, md: 8 } }}>
        <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 } }}>
          <Stack
            direction="row"
            spacing={1.5}
            sx={{
              alignItems: "center",
              mb: 0.5
            }}>
            <Megaphone size={22} color="#E0A63A" />
            <Typography variant="h5" sx={{
              fontWeight: 800
            }}>Official Downloads</Typography>
          </Stack>
          <Typography
            variant="body2"
            sx={{
              color: "text.secondary",
              mb: 3
            }}>
            Official circulars from the school office.
          </Typography>
          <Grid container spacing={2}>
            {MEMOS.map((m) => (
              <Grid key={m.title} size={{ xs: 12, sm: 6 }}>
                <Paper variant="outlined" sx={{ p: 2.5, display: 'flex', gap: 2, alignItems: 'flex-start', height: '100%' }}>
                  <Box sx={{ color: 'primary.main', flexShrink: 0 }}><FileText size={22} /></Box>
                  <Box>
                    <Typography variant="subtitle2" sx={{
                      fontWeight: 700
                    }}>{m.title}</Typography>
                    <Typography
                      variant="caption"
                      sx={{
                        color: "text.secondary",
                        display: "block",
                        mb: 1
                      }}>{m.sub}</Typography>
                    <Typography variant="body2" sx={{
                      color: "text.secondary"
                    }}>{m.body}</Typography>
                  </Box>
                </Paper>
              </Grid>
            ))}
          </Grid>
        </Paper>
      </Container>
    </Box>
  );
}
