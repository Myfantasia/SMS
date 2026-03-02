import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Search, MessageCircle, Bell, User, LogOut, UserPlus, Users } from 'lucide-react';

interface NavbarProps {
  role: string;
  userName?: string;
}

// Define an interface for our API data
interface PendingApprovals {
  pending_teachers: number;
  pending_students: number;
  pending_parents: number;
  total_pending: number;
}

export default function Navbar({ role, userName = "Admin" }: NavbarProps) {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  
  // State to hold the live data from Django
  const [pendingData, setPendingData] = useState<PendingApprovals>({
    pending_teachers: 0,
    pending_students: 0,
    pending_parents: 0,
    total_pending: 0
  });

  // Extract the first letter of the user's name for the dynamic avatar
  const firstLetter = userName !== "Loading..." && userName ? userName.charAt(0).toUpperCase() : "";

  // Fetch the pending approvals when the Navbar loads
  useEffect(() => {
    fetch('http://localhost:8000/api/pending-approvals/')
      .then((res) => res.json())
      .then((data) => {
        setPendingData(data);
      })
      .catch((err) => {
        console.error("Failed to fetch pending approvals", err);
      });
  }, []);

  // Handles the search bar submission
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/admin-dashboard/search?q=${encodeURIComponent(searchQuery)}`);
      setSearchQuery(""); 
    }
  };

  return (
    <div className="flex items-center justify-between p-4 bg-white border-b border-slate-200 shadow-sm h-16 px-8 z-50">
        
      {/* 1. FUNCTIONAL SEARCH BAR */}
      <form 
        onSubmit={handleSearch}
        className="hidden md:flex items-center gap-2 text-xs rounded-full ring-[1.5px] ring-slate-300 px-3 py-1 bg-slate-50 transition-all focus-within:ring-blue-500"
      >
        <Search className="w-4 h-4 text-slate-400" />
        <input 
          type="text" 
          placeholder="Search students, staff..." 
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-64 p-1 bg-transparent outline-none text-slate-700" 
        />
      </form>

      {/* Icons and User Details */}
      <div className="flex items-center gap-6 justify-end w-full">
        
        {/* 2. FUNCTIONAL MESSAGE HUB LINK */}
        <Link 
          to="/admin-dashboard/messages" 
          title="Communication Hub"
          className="bg-slate-100 hover:bg-slate-200 transition-colors rounded-full w-9 h-9 flex items-center justify-center cursor-pointer"
        >
          <MessageCircle className="w-4 h-4 text-slate-600" />
        </Link>

        {/* 3. FUNCTIONAL NOTIFICATION DROPDOWN */}
        <div className="group relative bg-slate-100 hover:bg-slate-200 transition-colors rounded-full w-9 h-9 flex items-center justify-center cursor-pointer">
          <Bell className="w-4 h-4 text-slate-600" />
          
          {/* Notification Badge - Only shows if there is actually something pending! */}
          {pendingData.total_pending > 0 && (
            <div className="absolute -top-1 -right-1 w-5 h-5 flex items-center justify-center bg-red-500 text-white rounded-full text-[10px] font-bold border-2 border-white shadow-sm">
              {pendingData.total_pending}
            </div>
          )}

          {/* Notification Alert Panel */}
          <div className="absolute top-10 right-0 w-72 bg-white border border-slate-200 shadow-xl rounded-xl hidden group-hover:flex flex-col z-50 overflow-hidden">
            <div className="bg-slate-50 px-4 py-3 border-b border-slate-100 flex justify-between items-center">
              <span className="font-bold text-slate-700 text-sm">Action Required</span>
            </div>
            
            <div className="flex flex-col">
              
              {/* Teacher Approvals Alert */}
              {pendingData.pending_teachers > 0 && (
                <Link to="/admin-dashboard/approve-teachers" className="px-4 py-3 border-b border-slate-50 hover:bg-slate-50 transition-colors flex items-start gap-3">
                  <div className="bg-blue-100 p-2 rounded-full mt-1">
                    <UserPlus className="w-4 h-4 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-700">Teacher Approvals</p>
                    <p className="text-xs text-slate-500">{pendingData.pending_teachers} new teachers waiting for approval.</p>
                  </div>
                </Link>
              )}

              {/* Student Approvals Alert */}
              {pendingData.pending_students > 0 && (
                <Link to="/admin-dashboard/approve-students" className="px-4 py-3 border-b border-slate-50 hover:bg-slate-50 transition-colors flex items-start gap-3">
                  <div className="bg-emerald-100 p-2 rounded-full mt-1">
                    <UserPlus className="w-4 h-4 text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-700">Student Approvals</p>
                    <p className="text-xs text-slate-500">{pendingData.pending_students} new students waiting for verification.</p>
                  </div>
                </Link>
              )}

              {/* Parent Approvals Alert */}
              {pendingData.pending_parents > 0 && (
                <Link to="/admin-dashboard/approve-parents" className="px-4 py-3 hover:bg-slate-50 transition-colors flex items-start gap-3">
                  <div className="bg-purple-100 p-2 rounded-full mt-1">
                    <Users className="w-4 h-4 text-purple-600" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-700">Parent Approvals</p>
                    <p className="text-xs text-slate-500">{pendingData.pending_parents} parent accounts waiting for verification.</p>
                  </div>
                </Link>
              )}

              {/* Empty State if everything is caught up */}
              {pendingData.total_pending === 0 && (
                <div className="px-4 py-6 text-center text-sm text-slate-500">
                  You are all caught up! No pending approvals.
                </div>
              )}

            </div>
          </div>
        </div>

        {/* User Name & Role */}
        <div className="flex flex-col text-right">
          <span className="text-xs leading-3 font-bold text-slate-700">{userName}</span>
          <span className="text-[10px] text-slate-500 mt-1 capitalize">{role}</span>
        </div>

        {/* 4. FUNCTIONAL PROFILE DROPDOWN WITH DYNAMIC INITIAL */}
        <div className="group relative flex items-center justify-center">
          
          {/* Dynamic First-Letter Avatar */}
          <div className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold cursor-pointer hover:bg-blue-700 transition-colors shadow-sm">
            {firstLetter}
          </div>
          
          <div className="absolute top-10 right-0 w-48 bg-white border border-slate-200 shadow-xl rounded-xl hidden group-hover:flex flex-col z-50 py-2">
            <Link to="/admin-dashboard/profile" className="flex items-center gap-3 px-4 py-2 hover:bg-slate-50 text-slate-700 transition-colors text-sm font-medium">
              <User className="w-4 h-4 text-slate-400" />
              My Profile
            </Link>
            
            <hr className="my-1 border-slate-100" />
            
            {/* Hard-link to the Django backend to clear the session cookie */}
            <a href="http://localhost:8000/logout" className="flex items-center gap-3 px-4 py-2 hover:bg-red-50 text-red-600 transition-colors text-sm font-medium">
              <LogOut className="w-4 h-4" />
              Logout
            </a>
          </div>
        </div>
        
      </div>
    </div>
  );
}