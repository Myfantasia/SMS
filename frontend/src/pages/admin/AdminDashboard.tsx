import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom'; // NEW: Added to pull the name from the Layout
import { Users, GraduationCap, UserSquare2, Banknote, School } from 'lucide-react';

// Import our layout components
import AttendanceChart from '../../components/AttendanceChart';
import FinanceChart from '../../components/FinanceChart';
import EventCalendar from '../../components/EventCalendar';
import Announcements from '../../components/Announcements';
import StudentCountChart from '../../components/StudentCountChart'; 
import EventList from '../../components/EventList'; 

interface DashboardMetrics {
  student_count: number;
  teacher_count: number;
  parent_count?: number; 
  revenue?: number;      
  message: string;
}

// Define the type for calendar value
type ValuePiece = Date | null;
type Value = ValuePiece | [ValuePiece, ValuePiece];

export default function AdminDashboard() {
  // --- NEW: Grab the dynamic name from the Layout wrapper ---
  const { userName } = useOutletContext<{ userName: string }>();

  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  
  // State to control the Calendar and Event List
  const [selectedDate, setSelectedDate] = useState<Value>(new Date());

  // --- MOCK DATA FOR CHARTS --- 
  const attendanceData = [
    { name: 'Mon', present: 110, absent: 10 },
    { name: 'Tue', present: 115, absent: 5 },
    { name: 'Wed', present: 105, absent: 15 },
    { name: 'Thu', present: 118, absent: 2 },
    { name: 'Fri', present: 100, absent: 20 },
  ];

  const financeData = [
    { name: 'Jan', income: 4000, expense: 2400 },
    { name: 'Feb', income: 5000, expense: 2100 },
    { name: 'Mar', income: 4500, expense: 3000 },
    { name: 'Apr', income: 6000, expense: 2800 },
  ];

  const noticesData = [
    { id: 1, message: "End of term exams start next week.", by: "Admin", date: "2026-03-05" },
    { id: 2, message: "Staff meeting on Friday at 4PM.", by: "Principal", date: "2026-03-02" },
  ];

  // --- Mock Events Data ---
  // We use today's date dynamically for testing so something always shows up!
  const todayString = new Date().toISOString().split('T')[0];
  const allEvents = [
    { id: 1, title: 'Math Olympiad', time: '10:00 AM - 12:00 PM', date: todayString, description: 'Inter-school math competition in the main hall.' },
    { id: 2, title: 'Staff Meeting', time: '2:00 PM - 4:00 PM', date: todayString, description: 'Discussing term progress.' },
    { id: 3, title: 'Science Fair', time: '9:00 AM - 3:00 PM', date: '2026-03-05', description: 'Students presenting their term projects.' },
  ];

  useEffect(() => {
    fetch('http://localhost:8000/api/dashboard-stats/', {
      credentials: 'include'
    }) 
      .then((res) => res.json())
      .then((data) => {
        setMetrics(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to fetch dashboard stats", err);
        setLoading(false);
      });
  }, []);

  // Logic to filter events based on calendar click
  // Ensure selectedDate is a single Date object before formatting
  const formattedSelectedDate = selectedDate instanceof Date 
    ? selectedDate.toISOString().split('T')[0] 
    : '';

  const filteredEvents = allEvents.filter((event) => event.date === formattedSelectedDate);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col xl:flex-row gap-6">
      
      {/* LEFT COLUMN: Takes up roughly 2/3 of the screen on large displays */}
      <div className="w-full xl:w-2/3 flex flex-col gap-8">
        
        {/* --- UPGRADED Welcome Banner --- */}
        <div className="relative bg-linear-to-r from-blue-700 via-blue-600 to-blue-500 p-8 rounded-2xl shadow-lg flex justify-between items-center text-white overflow-hidden">
          <div className="relative z-10">
            {/* UPDATED: Now dynamically using the context userName passed from Layout */}
            <h2 className="text-3xl font-extrabold mb-1">
              Welcome back, {userName}! 👋
            </h2>
            <p className="text-blue-100 font-medium text-sm md:text-base">
              Here is what's happening in your institution today.
            </p>
          </div>
          <div className="hidden md:block relative z-10">
            <School className="w-20 h-20 text-white opacity-20 transform rotate-12" />
          </div>
          {/* Decorative Glow Effects */}
          <div className="absolute -right-10 -top-10 w-48 h-48 bg-white opacity-10 rounded-full blur-3xl pointer-events-none"></div>
          <div className="absolute right-32 -bottom-10 w-32 h-32 bg-white opacity-10 rounded-full blur-2xl pointer-events-none"></div>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          
          {/* Student Card */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4 hover:shadow-md transition-shadow">
            <div className="p-4 bg-blue-50 text-blue-600 rounded-full">
              <Users className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-slate-500 text-sm font-medium">Total Students</h3>
              <h1 className="text-3xl font-extrabold text-slate-800">{metrics?.student_count || 0}</h1>
            </div>
          </div>

          {/* Teacher Card */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4 hover:shadow-md transition-shadow">
            <div className="p-4 bg-purple-50 text-purple-600 rounded-full">
              <GraduationCap className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-slate-500 text-sm font-medium">Total Teachers</h3>
              <h1 className="text-3xl font-extrabold text-slate-800">{metrics?.teacher_count || 0}</h1>
            </div>
          </div>

          {/* Parent Card */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4 hover:shadow-md transition-shadow">
            <div className="p-4 bg-emerald-50 text-emerald-600 rounded-full">
              <UserSquare2 className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-slate-500 text-sm font-medium">Total Parents</h3>
              <h1 className="text-3xl font-extrabold text-slate-800">{metrics?.parent_count || "--"}</h1>
            </div>
          </div>

          {/* Finance Card */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4 hover:shadow-md transition-shadow">
            <div className="p-4 bg-amber-50 text-amber-600 rounded-full">
              <Banknote className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-slate-500 text-sm font-medium">Total Revenue</h3>
              <h1 className="text-3xl font-extrabold text-slate-800">{metrics?.revenue ? `$${metrics.revenue}` : "--"}</h1>
            </div>
          </div>

        </div>

        {/* Charts Section */}
        <div className="flex flex-col gap-6">
          
          {/* Top Row: Radial Chart & Bar Chart */}
          <div className="flex flex-col lg:flex-row gap-6">
            <div className="w-full lg:w-1/3 h-96 lg:h-96">
               <StudentCountChart />
            </div>
            <div className="w-full lg:w-2/3 h-96 lg:h-96">
              <AttendanceChart data={attendanceData} />
            </div>
          </div>

          {/* Bottom Row: Finance Line Chart */}
          <div className="w-full h-96 lg:h-96 mt-4 lg:mt-0">
            <FinanceChart data={financeData} />
          </div>

        </div>

      </div>

      {/* RIGHT COLUMN: Takes up roughly 1/3 of the screen on large displays */}
      <div className="w-full xl:w-1/3 flex flex-col gap-8">
        
        {/* Pass state and updater to the calendar */}
        <EventCalendar 
          selectedDate={selectedDate} 
          onDateChange={setSelectedDate} 
        />
        
        {/* Pass filtered events to the list */}
        <EventList 
          events={filteredEvents} 
          selectedDate={selectedDate instanceof Date ? selectedDate : null} 
        />

        <div className="mt-2">
          <Announcements notices={noticesData} />
        </div>
        
      </div>

    </div>
  );
}