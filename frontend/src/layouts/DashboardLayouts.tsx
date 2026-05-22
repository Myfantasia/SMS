import { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { School } from 'lucide-react';
import Menu from '../components/Menu';
import Navbar from '../components/Navbar';
import api from '../libs/axiosInstance';


interface LayoutProps {
  role: 'admin' | 'teacher' | 'student' | 'parent';
}

export default function DashboardLayout({ role }: LayoutProps) {
  const [userName, setUserName] = useState("Loading...");

  // Fetch the logged-in user's name from Django when the layout loads
  useEffect(() => {
    api.get('/api/dashboard-stats/')
      .then((res) => {
        if (res.data && res.data.admin_name) {
          setUserName(res.data.admin_name);
        } else {
          setUserName("Admin");
        }
      })
      .catch((err) => {
        console.error("Failed to fetch user details", err);
        setUserName("Admin"); // Fallback on error
      });
  }, []);

  return (
    <div className="h-screen flex bg-slate-50 font-sans">
      
      {/* Sidebar Navigation */}
      <div className="w-[16%] md:w-[10%] lg:w-[18%] xl:w-[16%] p-4 bg-white border-r border-slate-200 overflow-y-scroll scrollbar-hide flex flex-col">
        <div className="flex items-center justify-center lg:justify-start gap-3 mb-6 mt-2 text-blue-700">
          <School className="w-8 h-8" />
          <span className="hidden lg:block font-extrabold text-xl text-slate-800">SMS Portal</span>
        </div>
        <Menu userRole={role} />
      </div>

      {/* Main Content Pane */}
      <div className="w-[84%] md:w-[90%] lg:w-[82%] xl:w-[84%] bg-slate-50 flex flex-col overflow-hidden">
        
        {/* Universal Top Navbar - Now receiving dynamic userName */}
        <Navbar role={role} userName={userName} />

        {/* Dynamic Page Content */}
        <main className="p-8 overflow-y-auto flex-1 scrollbar-hide">
          {/* We pass the userName via context so AdminDashboard can use it for the Welcome Banner */}
          <Outlet context={{ userName }} />
        </main>
        
      </div>
    </div>
  );
}