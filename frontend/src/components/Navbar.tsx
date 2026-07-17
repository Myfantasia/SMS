import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { Search, MessageCircle, User, LogOut, ChevronDown } from 'lucide-react';
import { useChat } from './chats/ChatProvider';
import NotificationBell from './Notifications';
import api from '../libs/axiosInstance';
import { clearActivity } from '../libs/sessionExpiry';

interface NavbarProps {
  role: string;
  userName?: string;
}

// Turns "/admin-dashboard/leave-requests" into "Leave Requests", root into "Dashboard".
function getPageTitle(pathname: string, role: string): string {
  const base = `/${role}-dashboard`;
  const rest = pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
  const segment = rest.split('/').filter(Boolean)[0];
  if (!segment) return "Dashboard";
  return segment
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function Navbar({ role, userName = "Admin" }: NavbarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [realUserName, setRealUserName] = useState(userName);

  const { unreadCount } = useChat();

  const firstLetter = realUserName !== "Loading..." && realUserName ? realUserName.charAt(0).toUpperCase() : "";
  const pageTitle = getPageTitle(location.pathname, role);

  // Fetch User Profile (Universal for all roles)
useEffect(() => {
  api.get('/api/my-profile/')
    .then(res => {
      const data = res.data;
      if (data.status === 'success') {
        const fullName = `${data.data.first_name} ${data.data.last_name}`.trim();
        setRealUserName(fullName || data.data.username);
      }
    })
    .catch(err => console.error("Failed to fetch user profile", err));
}, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/${role}-dashboard/search?q=${encodeURIComponent(searchQuery)}`);
      setSearchQuery(""); 
    }
  };

  return (
    <div className="flex items-center justify-between gap-6 h-16 px-6 md:px-8 bg-white/80 backdrop-blur-md border-b border-slate-200/80 sticky top-0 z-40">

      {/* PAGE TITLE */}
      <div className="flex flex-col min-w-0 shrink-0">
        <h1 className="text-base md:text-lg font-bold text-slate-800 truncate leading-tight">{pageTitle}</h1>
        <span className="hidden sm:block text-[11px] text-slate-400 font-medium capitalize">{role} workspace</span>
      </div>

      {/* SEARCH BAR */}
      <form
        onSubmit={handleSearch}
        className="hidden md:flex items-center gap-2 text-xs rounded-full ring-1 ring-slate-200 px-4 py-2 bg-slate-50 transition-all focus-within:ring-2 focus-within:ring-blue-500 focus-within:bg-white flex-1 max-w-sm"
      >
        <Search className="w-4 h-4 text-slate-400 shrink-0" />
        <input
          type="text"
          placeholder="Search students, staff..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-transparent outline-none text-slate-700 placeholder:text-slate-400"
        />
      </form>

      {/* Icons and User Details */}
      <div className="flex items-center gap-3 md:gap-5 justify-end shrink-0">

        {/* MESSAGE HUB LINK */}
        <Link
          to={`/${role}-dashboard/messages`}
          title="Communication Hub"
          className="bg-slate-100 hover:bg-blue-50 hover:text-blue-600 transition-colors rounded-full w-9 h-9 flex items-center justify-center cursor-pointer relative text-slate-600"
        >
          <MessageCircle className="w-4 h-4" />
          {unreadCount > 0 && (
            <div className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 flex items-center justify-center bg-blue-500 text-white rounded-full text-[10px] font-bold border border-white shadow-sm">
              {unreadCount}
            </div>
          )}
        </Link>

        {/* NOTIFICATION COMPONENT */}
        <NotificationBell role={role} />

        <div className="hidden md:block w-px h-8 bg-slate-200" />

        {/* PROFILE DROPDOWN */}
        <div className="group relative flex items-center justify-center gap-2 cursor-pointer">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-600 to-blue-700 flex items-center justify-center text-white font-bold text-sm ring-2 ring-white shadow-sm relative z-10 shrink-0">
            {firstLetter}
          </div>
          {/* User Name & Role (desktop only, next to avatar) */}
          <div className="hidden lg:flex flex-col text-left">
            <span className="text-xs leading-3 font-bold text-slate-700 max-w-28 truncate">{realUserName}</span>
            <span className="text-[10px] text-slate-400 mt-1 capitalize">{role}</span>
          </div>
          <ChevronDown className="hidden lg:block w-3.5 h-3.5 text-slate-400 group-hover:rotate-180 transition-transform duration-200" />

          <div className="absolute top-9 right-0 w-52 h-4 bg-transparent z-0"></div>
          <div className="absolute top-11 right-0 w-52 bg-white border border-slate-200 shadow-xl rounded-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible translate-y-1 group-hover:translate-y-0 transition-all duration-200 flex flex-col z-50 py-2">
            <div className="px-4 py-2 border-b border-slate-100 lg:hidden">
              <p className="text-sm font-bold text-slate-700 truncate">{realUserName}</p>
              <p className="text-[11px] text-slate-400 capitalize">{role}</p>
            </div>
            <Link to={`/${role}-dashboard/profile`} className="flex items-center gap-3 px-4 py-2 hover:bg-slate-50 text-slate-700 transition-colors text-sm font-medium">
              <User className="w-4 h-4 text-slate-400" />
              My Profile
            </Link>
            <hr className="my-1 border-slate-100" />
            <a href="http://localhost:8000/logout" onClick={clearActivity} className="flex items-center gap-3 px-4 py-2 hover:bg-red-50 text-red-600 transition-colors text-sm font-medium">
              <LogOut className="w-4 h-4" />
              Logout
            </a>
          </div>
        </div>

      </div>
    </div>
  );
}