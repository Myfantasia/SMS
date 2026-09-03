import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Users, GraduationCap, UserSquare2, Briefcase, School, Calendar, Clock, Quote, TrendingUp } from 'lucide-react';

// Import our layout components
import TodayAttendanceCard from '../../components/TodayAttendanceCard';
import FinanceChart from '../../components/Finance/FinanceChart';
import EventCalendar from '../../components/EventCalendar';
import Announcements from '../../components/Announcements';
import StudentCountChart from '../../components/StudentCountChart';
import EventList from '../../components/lists pages/EventList';
import QuickActions from '../../components/QuickActions';
import RecentActivity from '../../components/RecentActivity';
import api from '../../libs/axiosInstance';

interface DashboardMetrics {
  student_count: number;
  teacher_count: number;
  parent_count?: number;
  staff_count?: number;
  student_new_30d?: number;
  teacher_new_30d?: number;
  parent_new_30d?: number;
  staff_new_30d?: number;
  message: string;
}

// Renders "+N this month" under a stat card's count, muted emerald when there's real
// growth or slate when N is 0 -- never fabricates a number when the field is absent.
function TrendLine({ value }: { value?: number }) {
  if (value === undefined || value === null) return null;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold mt-1 ${value > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'}`}>
      <TrendingUp className="w-3 h-3" />
      +{value} this month
    </span>
  );
}

// Matches the Django Notice model (see NoticesHub.tsx)
interface SchoolNotice {
  id: number;
  title: string;
  message: string;
  date: string;
  by: string;
  is_urgent: boolean;
}

// Matches the Django Event model (see EventsHub.tsx)
interface SchoolEvent {
  id: number;
  title: string;
  description: string;
  start_time: string;
  end_time: string;
  event_type: string;
  is_active: boolean;
}

// Define the type for calendar value
type ValuePiece = Date | null;
type Value = ValuePiece | [ValuePiece, ValuePiece];

const MOTIVATIONAL_QUOTES = [
  "Education is the most powerful weapon which you can use to change the world.",
  "The beautiful thing about learning is that no one can take it away from you.",
  "Success is not final, failure is not fatal: it is the courage to continue that counts.",
  "Your attitude, not your aptitude, will determine your altitude.",
  "It always seems impossible until it's done."
];

export default function AdminDashboard() {
  const { userName } = useOutletContext<{ userName: string }>();

  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [firstName, setFirstName] = useState<string>("");
  const [currentTime, setCurrentTime] = useState(new Date());
  
  // State to control the Calendar and Event List
  const [selectedDate, setSelectedDate] = useState<Value>(new Date());
  
  // Random quote state
  const [quote] = useState(() => MOTIVATIONAL_QUOTES[Math.floor(Math.random() * MOTIVATIONAL_QUOTES.length)]);

  // --- Live Clock Logic ---
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // --- Dynamic Greeting ---
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good Morning";
    if (hour < 18) return "Good Afternoon";
    return "Good Evening";
  };

  // --- MOCK DATA (no backing endpoint yet — flagged "Sample data" in the UI) ---
  const financeData = [
    { name: 'Jan', income: 4000, expense: 2400 },
    { name: 'Feb', income: 5000, expense: 2100 },
    { name: 'Mar', income: 4500, expense: 3000 },
    { name: 'Apr', income: 6000, expense: 2800 },
  ];

  // Live notices & events (from the Notices/Events hubs' endpoints)
  const [notices, setNotices] = useState<SchoolNotice[]>([]);
  const [events, setEvents] = useState<SchoolEvent[]>([]);

  useEffect(() => {
    api.get('/api/dashboard-stats/')
      .then((res) => {
        setMetrics(res.data);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to fetch dashboard stats", err);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    api.get('/api/core/notices/')
      // Paginated now (NoticeViewSet.pagination_class) — this widget only shows a
      // preview, so the first page's worth is all it ever needed anyway.
      .then((res) => setNotices(res.data.results))
      .catch((err) => console.error("Failed to fetch notices", err));

    api.get('/api/core/events/')
      .then((res) => setEvents(res.data))
      .catch((err) => console.error("Failed to fetch events", err));
  }, []);

  useEffect(() => {
    api.get('/api/my-profile/')
      .then((res) => {
        const data = res.data;
        if (data.status === 'success') {
          setFirstName(data.data.first_name || userName);
        }
      })
      .catch(err => console.error("Failed to fetch profile", err));
  }, [userName]);

  const formattedSelectedDate = selectedDate instanceof Date ? selectedDate.toISOString().split('T')[0] : '';
  const formatTimeRange = (start: string, end: string) => {
    const opts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
    return `${new Date(start).toLocaleTimeString(undefined, opts)} - ${new Date(end).toLocaleTimeString(undefined, opts)}`;
  };
  const filteredEvents = events
    .filter((event) => event.is_active && event.start_time.split('T')[0] === formattedSelectedDate)
    .map((event) => ({
      id: event.id,
      title: event.title,
      time: formatTimeRange(event.start_time, event.end_time),
      date: event.start_time.split('T')[0],
      description: event.description,
    }));
  const eventDates = new Set(events.filter((event) => event.is_active).map((event) => event.start_time.split('T')[0]));

  // --- PREMIUM SKELETON LOADER ---
  if (loading) {
    return (
      <div className="flex flex-col xl:flex-row gap-6 animate-pulse">
        <div className="w-full xl:w-2/3 flex flex-col gap-8">
          <div className="h-56 bg-slate-200 dark:bg-slate-800 rounded-2xl"></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[1, 2, 3, 4].map(i => <div key={i} className="h-28 bg-slate-200 dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700"></div>)}
          </div>
          <div className="flex flex-col lg:flex-row gap-6">
            <div className="w-full lg:w-1/3 h-96 bg-slate-200 dark:bg-slate-800 rounded-2xl"></div>
            <div className="w-full lg:w-2/3 h-96 bg-slate-200 dark:bg-slate-800 rounded-2xl"></div>
          </div>
        </div>
        <div className="w-full xl:w-1/3 flex flex-col gap-8">
          <div className="h-80 bg-slate-200 dark:bg-slate-800 rounded-2xl"></div>
          <div className="h-96 bg-slate-200 dark:bg-slate-800 rounded-2xl"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col xl:flex-row gap-6">
      <div className="w-full xl:w-2/3 flex flex-col gap-8">
        
        {/* --- UPGRADED Welcome Banner --- */}
        {/* Deepened toward the admin role-accent (#3B5BA5, same hue as the navbar avatar)
            instead of Tailwind's stock blue-500/600/700 -- the old gradient was the single
            brightest/most saturated element on the page ("too bright" feedback). */}
        <div className="relative p-8 rounded-2xl shadow-lg dark:shadow-none flex justify-between items-center text-white overflow-hidden" style={{ background: 'linear-gradient(to right, #24345E, #2E4577, #3B5BA5)' }}>
          <div className="relative z-10 space-y-4">
            <div>
              <h2 className="text-3xl font-extrabold mb-1">
                {getGreeting()}, {firstName || userName}! 👋
              </h2>
              <p className="text-blue-100 font-medium text-sm md:text-base">
                Here is what's happening in your institution today.
              </p>
            </div>

            {/* DateTime & Quote Display */}
            <div className="flex flex-col md:flex-row md:items-center gap-4 text-sm bg-white/10 p-4 rounded-xl backdrop-blur-sm border border-white/10 w-fit">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-blue-200" />
                <span>{currentTime.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-blue-200" />
                <span className="font-mono">{currentTime.toLocaleTimeString()}</span>
              </div>
            </div>
            
            <div className="flex items-start gap-2 max-w-lg italic text-blue-50 text-sm">
                <Quote className="w-4 h-4 shrink-0 mt-1" />
                <p>"{quote}"</p>
            </div>
          </div>

          <div className="hidden md:block relative z-10 opacity-20 transform rotate-12">
            <School className="w-32 h-32 text-white" />
          </div>
          
          <div className="absolute -right-10 -top-10 w-48 h-48 bg-white opacity-10 rounded-full blur-3xl pointer-events-none"></div>
          <div className="absolute right-32 -bottom-10 w-32 h-32 bg-white opacity-10 rounded-full blur-2xl pointer-events-none"></div>
        </div>

        {/* --- Quick Actions --- */}
        <QuickActions />

        {/* --- UPGRADED Metrics Grid (60-30-10 Typography Rule) --- */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          
          <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] dark:shadow-none hover:-translate-y-1 hover:shadow-lg dark:hover:shadow-none transition-all duration-300 flex items-center gap-5 cursor-default">
            <div className="p-4 bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-2xl"><Users className="w-7 h-7" strokeWidth={2.5} /></div>
            <div className="flex flex-col">
              <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">Total Students</span>
              <span className="text-3xl font-extrabold text-slate-800 dark:text-slate-100 leading-none">{metrics?.student_count || 0}</span>
              <TrendLine value={metrics?.student_new_30d} />
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] dark:shadow-none hover:-translate-y-1 hover:shadow-lg dark:hover:shadow-none transition-all duration-300 flex items-center gap-5 cursor-default">
            <div className="p-4 bg-purple-50 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400 rounded-2xl"><GraduationCap className="w-7 h-7" strokeWidth={2.5} /></div>
            <div className="flex flex-col">
              <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">Total Teachers</span>
              <span className="text-3xl font-extrabold text-slate-800 dark:text-slate-100 leading-none">{metrics?.teacher_count || 0}</span>
              <TrendLine value={metrics?.teacher_new_30d} />
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] dark:shadow-none hover:-translate-y-1 hover:shadow-lg dark:hover:shadow-none transition-all duration-300 flex items-center gap-5 cursor-default">
            <div className="p-4 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-2xl"><UserSquare2 className="w-7 h-7" strokeWidth={2.5} /></div>
            <div className="flex flex-col">
              <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">Total Parents</span>
              <span className="text-3xl font-extrabold text-slate-800 dark:text-slate-100 leading-none">{metrics?.parent_count || "--"}</span>
              <TrendLine value={metrics?.parent_new_30d} />
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] dark:shadow-none hover:-translate-y-1 hover:shadow-lg dark:hover:shadow-none transition-all duration-300 flex items-center gap-5 cursor-default">
            <div className="p-4 bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-2xl"><Briefcase className="w-7 h-7" strokeWidth={2.5} /></div>
            <div className="flex flex-col">
              <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">Total Staff</span>
              <span className="text-3xl font-extrabold text-slate-800 dark:text-slate-100 leading-none">{metrics?.staff_count ?? "--"}</span>
              <TrendLine value={metrics?.staff_new_30d} />
            </div>
          </div>

        </div>

        {/* Charts Section */}
        <div className="flex flex-col gap-6">
          <div className="flex flex-col lg:flex-row gap-6">
            <div className="w-full lg:w-1/3 h-96 lg:h-96"><StudentCountChart /></div>
            <div className="w-full lg:w-2/3 h-96 lg:h-96"><TodayAttendanceCard /></div>
          </div>
          <div className="w-full h-[34rem] mt-4 lg:mt-0"><FinanceChart data={financeData} /></div>
        </div>
      </div>

      {/* RIGHT COLUMN */}
      <div className="w-full xl:w-1/3 flex flex-col gap-8">
        <EventCalendar selectedDate={selectedDate} onDateChange={setSelectedDate} eventDates={eventDates} />
        <EventList events={filteredEvents} selectedDate={selectedDate instanceof Date ? selectedDate : null} />
        <RecentActivity />
        <div className="mt-2">
          <Announcements
            notices={[...notices]
              .sort((a, b) => (a.is_urgent === b.is_urgent ? 0 : a.is_urgent ? -1 : 1) || b.date.localeCompare(a.date))
              .slice(0, 6)
              .map((n) => ({ id: n.id, message: n.title ? `${n.title} — ${n.message}` : n.message, by: n.by, date: n.date, is_urgent: n.is_urgent }))}
          />
        </div>
      </div>
    </div>
  );
}