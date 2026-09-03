import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { Search, MessageCircle, User, LogOut, ChevronDown, Menu as MenuIcon, Sun, Moon, GraduationCap, UserCog, Users as UsersIcon, Briefcase, ArrowRight, Loader2 } from 'lucide-react';
import { useChat } from './chats/ChatProvider';
import NotificationBell from './Notifications';
import api from '../libs/axiosInstance';
import { clearActivity } from '../libs/sessionExpiry';
import { ROLE_ACCENTS } from '../public/theme/publicTheme';

interface SearchResult {
  id: number;
  name: string;
  username: string;
  type: 'students' | 'teachers' | 'parents' | 'staff';
  role_label: string;
}

// Same visual vocabulary as UserDirectoryTable's AVATAR_COLOR / GROUP_OPTIONS ordering,
// so a result found here reads as "the same kind of thing" the moment you land on the
// directory list — one color-per-role convention instead of two.
const TYPE_META: Record<SearchResult['type'], { label: string; icon: React.ElementType; chip: string }> = {
  students: { label: 'Students', icon: GraduationCap, chip: 'bg-blue-100 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400' },
  teachers: { label: 'Teachers', icon: UserCog, chip: 'bg-purple-100 dark:bg-purple-500/10 text-purple-700 dark:text-purple-400' },
  parents: { label: 'Parents', icon: UsersIcon, chip: 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
  staff: { label: 'Staff', icon: Briefcase, chip: 'bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400' },
};
const TYPE_ORDER: SearchResult['type'][] = ['students', 'teachers', 'parents', 'staff'];

interface NavbarProps {
  role: string;
  userName?: string;
  onMenuClick?: () => void;
  mode?: 'light' | 'dark';
  onToggleMode?: () => void;
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

export default function Navbar({ role, userName = "Admin", onMenuClick, mode = 'light', onToggleMode }: NavbarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [realUserName, setRealUserName] = useState(userName);

  // --- Universal search dropdown state ---
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const searchRootRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestQueryRef = useRef('');

  const { unreadCount } = useChat();

  const firstLetter = realUserName !== "Loading..." && realUserName ? realUserName.charAt(0).toUpperCase() : "";
  const pageTitle = getPageTitle(location.pathname, role);
  // Ties the logged-in chrome to the same per-portal identity color the public site's
  // login/signup journey already uses (publicTheme.ts ROLE_ACCENTS) instead of a hardcoded blue.
  const roleAccent = ROLE_ACCENTS[role] ?? '#2563EB';

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

  // Debounced live search, same 250ms/2-char-minimum pattern used by the parent signup
  // child-search and the Add User modal's student linker — a query result only ever
  // overwrites state if it's still the latest one in flight (latestQueryRef), so a fast
  // typist never sees an older, slower response clobber a newer one.
  useEffect(() => {
    const trimmed = searchQuery.trim();
    latestQueryRef.current = trimmed;
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (trimmed.length < 2) {
      setSearchResults(null);
      setSearchLoading(false);
      return;
    }

    setSearchLoading(true);
    debounceRef.current = setTimeout(() => {
      api.get('/api/search/', { params: { q: trimmed } })
        .then((res) => {
          if (latestQueryRef.current !== trimmed) return;
          setSearchResults(res.data.status === 'success' ? res.data.data : []);
          setSearchLoading(false);
          setActiveIndex(-1);
        })
        .catch(() => {
          if (latestQueryRef.current !== trimmed) return;
          setSearchResults([]);
          setSearchLoading(false);
        });
    }, 250);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchQuery]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchRootRef.current && !searchRootRef.current.contains(e.target as Node)) {
        setIsSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const flatResults = useMemo(() => {
    if (!searchResults) return [];
    return [...searchResults].sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type));
  }, [searchResults]);

  const goToResult = (result: SearchResult) => {
    navigate(`/${role}-dashboard/${result.type}/view/${result.id}`);
    setSearchQuery("");
    setSearchResults(null);
    setIsSearchOpen(false);
  };

  const viewAllResults = () => {
    if (!searchQuery.trim()) return;
    navigate(`/${role}-dashboard/search?q=${encodeURIComponent(searchQuery)}`);
    setSearchQuery("");
    setSearchResults(null);
    setIsSearchOpen(false);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (activeIndex >= 0 && flatResults[activeIndex]) {
      goToResult(flatResults[activeIndex]);
    } else {
      viewAllResults();
    }
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsSearchOpen(false);
      (e.target as HTMLInputElement).blur();
      return;
    }
    if (!flatResults.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % flatResults.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? flatResults.length - 1 : i - 1));
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 md:gap-6 h-16 px-3 md:px-8 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-700/60 sticky top-0 z-40">

      {/* HAMBURGER — opens the sidebar drawer, only relevant below `lg` where the sidebar is off-canvas */}
      <button
        type="button"
        onClick={onMenuClick}
        aria-label="Toggle menu"
        className="lg:hidden shrink-0 w-9 h-9 flex items-center justify-center rounded-full text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
      >
        <MenuIcon className="w-5 h-5" />
      </button>

      {/* PAGE TITLE */}
      <div className="flex flex-col min-w-0 shrink-0">
        <h1 className="text-base md:text-lg font-bold text-slate-800 dark:text-slate-100 truncate leading-tight">{pageTitle}</h1>
        <span className="hidden sm:block text-[11px] text-slate-400 dark:text-slate-500 font-medium capitalize">{role} workspace</span>
      </div>

      {/* SEARCH BAR + LIVE DROPDOWN */}
      <div className="hidden md:block relative flex-1 max-w-sm" ref={searchRootRef}>
        <form
          onSubmit={handleSearch}
          className="flex items-center gap-2 text-xs rounded-full ring-1 ring-slate-200 dark:ring-slate-700 px-4 py-2 bg-slate-50 dark:bg-slate-800 transition-all focus-within:ring-2 focus-within:ring-blue-500 dark:focus-within:ring-blue-400 focus-within:bg-white dark:focus-within:bg-slate-800"
        >
          {searchLoading ? (
            <Loader2 className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0 animate-spin" />
          ) : (
            <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" />
          )}
          <input
            type="text"
            placeholder="Search students, teachers, parents, staff..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setIsSearchOpen(true)}
            onKeyDown={handleSearchKeyDown}
            className="w-full bg-transparent outline-none text-slate-700 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500"
          />
          <kbd className="hidden lg:inline-flex items-center gap-0.5 shrink-0 px-1.5 py-0.5 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-[10px] font-semibold text-slate-400 dark:text-slate-400">
            &#8984;K
          </kbd>
        </form>

        {isSearchOpen && searchQuery.trim().length >= 2 && (
          <div className="absolute left-0 right-0 top-full mt-2 z-50 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl dark:shadow-none overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="max-h-96 overflow-y-auto py-2">
              {searchLoading && flatResults.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-slate-400 dark:text-slate-500">Searching…</div>
              ) : flatResults.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-slate-400 dark:text-slate-500">
                  No matches for "<span className="font-semibold text-slate-500 dark:text-slate-400">{searchQuery}</span>"
                </div>
              ) : (
                TYPE_ORDER.map((type) => {
                  const group = flatResults.filter((r) => r.type === type);
                  if (!group.length) return null;
                  const meta = TYPE_META[type];
                  const Icon = meta.icon;
                  return (
                    <div key={type} className="mb-1 last:mb-0">
                      <div className="px-4 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                        {meta.label}
                      </div>
                      {group.map((result) => {
                        const flatIdx = flatResults.indexOf(result);
                        const isActive = flatIdx === activeIndex;
                        return (
                          <button
                            key={`${result.type}-${result.id}`}
                            type="button"
                            onMouseEnter={() => setActiveIndex(flatIdx)}
                            onClick={() => goToResult(result)}
                            className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${
                              isActive ? 'bg-slate-50 dark:bg-slate-800' : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                            }`}
                          >
                            <span className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${meta.chip}`}>
                              <Icon className="w-4 h-4" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{result.name}</span>
                              <span className="block text-[11px] text-slate-400 dark:text-slate-500 truncate">{result.role_label} &middot; {result.username}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  );
                })
              )}
            </div>
            {flatResults.length > 0 && (
              <button
                type="button"
                onClick={viewAllResults}
                className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-bold text-blue-600 dark:text-blue-400 bg-slate-50 dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              >
                View all results for "{searchQuery}" <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Icons and User Details */}
      <div className="flex items-center gap-3 md:gap-5 justify-end shrink-0">

        {/* THEME TOGGLE */}
        <button
          type="button"
          onClick={onToggleMode}
          title={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label="Toggle theme"
          className="bg-indigo-50 dark:bg-indigo-500/10 text-indigo-500 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 hover:text-indigo-600 dark:hover:text-indigo-300 transition-colors rounded-full w-9 h-9 flex items-center justify-center cursor-pointer"
        >
          {mode === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>

        {/* MESSAGE HUB LINK */}
        <Link
          to={`/${role}-dashboard/messages`}
          title="Communication Hub"
          className="bg-blue-50 dark:bg-blue-500/10 text-blue-500 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-500/20 hover:text-blue-600 dark:hover:text-blue-300 transition-colors rounded-full w-9 h-9 flex items-center justify-center cursor-pointer relative"
        >
          <MessageCircle className="w-4 h-4" />
          {unreadCount > 0 && (
            <div className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 flex items-center justify-center bg-blue-500 text-white rounded-full text-[10px] font-bold border border-white dark:border-slate-900 shadow-sm">
              {unreadCount}
            </div>
          )}
        </Link>

        {/* NOTIFICATION COMPONENT */}
        <NotificationBell role={role} />

        <div className="hidden md:block w-px h-8 bg-slate-200 dark:bg-slate-700" />

        {/* PROFILE DROPDOWN */}
        <div className="group relative flex items-center justify-center gap-2 cursor-pointer">
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm ring-2 ring-white dark:ring-slate-900 shadow-sm relative z-10 shrink-0"
            style={{ backgroundColor: roleAccent }}
          >
            {firstLetter}
          </div>
          {/* User Name & Role (desktop only, next to avatar) */}
          <div className="hidden lg:flex flex-col text-left">
            <span className="text-xs leading-3 font-bold text-slate-700 dark:text-slate-200 max-w-28 truncate">{realUserName}</span>
            <span className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 capitalize">{role}</span>
          </div>
          <ChevronDown className="hidden lg:block w-3.5 h-3.5 text-slate-400 dark:text-slate-500 group-hover:rotate-180 transition-transform duration-200" />

          <div className="absolute top-9 right-0 w-52 h-4 bg-transparent z-0"></div>
          <div className="absolute top-11 right-0 w-52 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xl rounded-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible translate-y-1 group-hover:translate-y-0 transition-all duration-200 flex flex-col z-50 py-2">
            <div className="px-4 py-2 border-b border-slate-100 dark:border-slate-700 lg:hidden">
              <p className="text-sm font-bold text-slate-700 dark:text-slate-200 truncate">{realUserName}</p>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 capitalize">{role}</p>
            </div>
            <Link to={`/${role}-dashboard/profile`} className="flex items-center gap-3 px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-200 transition-colors text-sm font-medium">
              <User className="w-4 h-4 text-slate-400 dark:text-slate-500" />
              My Profile
            </Link>
            <hr className="my-1 border-slate-100 dark:border-slate-700" />
            <a href="http://localhost:8000/logout" onClick={clearActivity} className="flex items-center gap-3 px-4 py-2 hover:bg-red-50 dark:hover:bg-red-500/10 text-red-600 dark:text-red-400 transition-colors text-sm font-medium">
              <LogOut className="w-4 h-4" />
              Logout
            </a>
          </div>
        </div>

      </div>
    </div>
  );
}