import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Search,
  MessageSquarePlus,
  Users,
  Megaphone,
  MoreVertical,
  UserRoundCheck,
  LogOut,
  Trash2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useChat } from './ChatProvider';
import api from '../../libs/axiosInstance';
import { getThreadIcon, getThreadColor, getThreadSubtitle } from '../../libs/chatDisplay';
import type { IInboxThread } from '../../libs/chat';

// --- NEW: IMPORT THE MODALS ---
import SearchDirectoryModal from './SearchDirectoryModal';
import AdminGroupModal from './AdminGroupModal';
import ParticipantsPanel from './ParticipantsPanel';

function leaveActionLabel(type: string): string {
  if (type === 'Direct') return 'Delete Conversation';
  if (type === 'Broadcast') return 'Leave Broadcast';
  return 'Leave Group';
}

export default function ChatSidebar() {
  const { inboxThreads, activeThreadId, setActiveThread, leaveConversation } = useChat();
  const [localSearch, setLocalSearch] = useState('');

  // --- NEW: MODAL STATE CONTROL ---
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [groupMode, setGroupMode] = useState<'Group' | 'Broadcast' | null>(null);
  const [participantsThread, setParticipantsThread] = useState<IInboxThread | null>(null);

  // --- ROW OVERFLOW MENU STATE ---
  const [openMenuThreadId, setOpenMenuThreadId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // --- NEW: RBAC PROFILE STATE ---
  const [userRole, setUserRole] = useState<'Admin' | 'Teacher' | 'Parent' | null>(null);

  // Fetch the active user's structural clearance level on mount
  useEffect(() => {
    api.get('/api/my-profile/')
      .then(res => {
        if (res.data.status === 'success') {
          const roleRaw = String(res.data.data.role || '').toLowerCase();

          // ---> THE FIX: Treat the generic "user" string as an Admin <---
          if (roleRaw.includes('admin') || roleRaw === 'user') setUserRole('Admin');
          else if (roleRaw.includes('teacher')) setUserRole('Teacher');
          else if (roleRaw.includes('parent')) setUserRole('Parent');
          else console.warn("Received unknown role from backend:", roleRaw);
        }
      })
      .catch(err => console.error("Could not trace profile role for RBAC:", err));
  }, []);

  // Guard rails based on role status
  const canBroadcast = userRole === 'Admin';
  const canCreateGroup = userRole === 'Admin' || userRole === 'Teacher';

  // Close the row overflow menu on any outside click
  useEffect(() => {
    if (!openMenuThreadId) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuThreadId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openMenuThreadId]);

  // 1. LOCAL FILTERING: Instantly search existing chats without hitting Django
  const filteredThreads = useMemo(() => {
    if (!localSearch.trim()) return inboxThreads;
    return inboxThreads.filter(thread =>
      thread.chat_name.toLowerCase().includes(localSearch.toLowerCase())
    );
  }, [inboxThreads, localSearch]);

  // 2. TIME FORMATTER: Makes raw ISO dates look like "10:30 AM" or "Oct 12"
  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    if (isToday) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const handleLeaveClick = (thread: IInboxThread) => {
    setOpenMenuThreadId(null);
    const actionLabel = leaveActionLabel(thread.type);
    const confirmCopy = thread.type === 'Direct'
      ? 'Delete this conversation? It will disappear from your inbox.'
      : `${actionLabel}? You'll stop receiving messages from this ${thread.type.toLowerCase()}.`;

    toast((t) => (
      <div className="flex flex-col gap-3 min-w-50">
        <span className="text-sm font-medium text-slate-800">{confirmCopy}</span>
        <div className="flex justify-end gap-2 mt-1">
          <button
            onClick={() => toast.dismiss(t.id)}
            className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={async () => {
              toast.dismiss(t.id);
              try {
                await leaveConversation(thread.thread_id);
                toast.success(`${actionLabel === 'Delete Conversation' ? 'Conversation deleted' : actionLabel + 'd'}.`);
              } catch (err) {
                console.error('Failed to leave conversation', err);
                toast.error('Something went wrong. Please try again.');
              }
            }}
            className="px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
          >
            {actionLabel}
          </button>
        </div>
      </div>
    ), { duration: 10000, id: `leave-${thread.thread_id}` });
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 border-r border-slate-200 relative">

      {/* ========================================== */}
      {/* HEADER & ACTION BUTTONS */}
      {/* ========================================== */}
      <div className="p-4 border-b border-slate-200 bg-white">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-slate-800">Messages</h2>

          {/* Admin / Teacher Superpower Action Buttons */}
          <div className="flex gap-2">

            {/* Standard 1-on-1 Search Modal Trigger */}
            <button
              className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-full transition-colors"
              title="New Direct Message"
              onClick={() => setIsSearchOpen(true)}
            >
              <MessageSquarePlus className="w-4 h-4" />
            </button>

            {/* Admin & Teacher Group Builder Modal Trigger */}
            {canCreateGroup && (
              <button
                className="p-2 bg-slate-100 hover:bg-blue-100 text-slate-600 hover:text-blue-600 rounded-full transition-colors hidden md:block"
                title="Create Group Chat"
                onClick={() => setGroupMode('Group')}
              >
                <Users className="w-4 h-4" />
              </button>
            )}

            {/* Admin Broadcast Modal Trigger: STRICTLY GUARDED */}
            {canBroadcast && (
              <button
                className="p-2 bg-slate-100 hover:bg-orange-100 text-slate-600 hover:text-orange-600 rounded-full transition-colors hidden md:block"
                title="Send School Broadcast"
                onClick={() => setGroupMode('Broadcast')}
              >
                <Megaphone className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Local Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search conversations..."
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-slate-100 border-none rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-700 placeholder-slate-400"
          />
        </div>
      </div>

      {/* ========================================== */}
      {/* SCROLLABLE INBOX LIST */}
      {/* ========================================== */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {filteredThreads.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">
            {inboxThreads.length === 0 ? "No active conversations yet." : "No matching conversations."}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {filteredThreads.map((thread) => {
              const isActive = activeThreadId === thread.thread_id;
              const isMenuOpen = openMenuThreadId === thread.thread_id;

              return (
                <li key={thread.thread_id} className="relative group/row">
                  <button
                    onClick={() => setActiveThread(thread.thread_id)}
                    className={`w-full text-left p-4 hover:bg-white transition-colors flex items-start gap-3 relative
                      ${isActive ? 'bg-white shadow-[inset_4px_0_0_0_#2563eb]' : 'bg-transparent'}
                    `}
                  >
                    {/* Dynamic Avatar Container */}
                    <div className={`relative shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${getThreadColor(thread.type)}`}>
                      {getThreadIcon(thread.type)}

                      {/* Unread Red Dot (Bottom Right of Avatar) */}
                      {thread.has_unread && (
                        <div className="absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-blue-500 border-2 border-white rounded-full"></div>
                      )}
                    </div>

                    {/* Chat Name & Timestamp */}
                    <div className="flex-1 min-w-0 pr-6">
                      <div className="flex items-baseline justify-between mb-0.5">
                        <h3 className={`text-sm truncate pr-2 ${thread.has_unread ? 'font-bold text-slate-900' : 'font-semibold text-slate-700'}`}>
                          {thread.chat_name}
                        </h3>
                        <span className={`text-[10px] whitespace-nowrap ${thread.has_unread ? 'text-blue-600 font-semibold' : 'text-slate-400'}`}>
                          {formatTime(thread.updated_at)}
                        </span>
                      </div>

                      {/* Last message preview, falling back to a type-based subtitle */}
                      <p className="text-xs text-slate-500 truncate">
                        {thread.last_message || getThreadSubtitle(thread.type)}
                      </p>
                    </div>
                  </button>

                  {/* Row Overflow Menu Trigger */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenMenuThreadId(isMenuOpen ? null : thread.thread_id);
                    }}
                    className={`absolute top-4 right-3 p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all
                      ${isMenuOpen ? 'opacity-100 bg-slate-100' : 'opacity-0 group-hover/row:opacity-100'}`}
                    title="Conversation options"
                    aria-label="Conversation options"
                  >
                    <MoreVertical className="w-4 h-4" />
                  </button>

                  {isMenuOpen && (
                    <div
                      ref={menuRef}
                      className="absolute top-11 right-3 z-20 bg-white border border-slate-200 shadow-[0_8px_30px_rgb(0,0,0,0.12)] rounded-xl p-1.5 flex flex-col gap-0.5 w-48"
                    >
                      {thread.type !== 'Direct' && (
                        <button
                          type="button"
                          onClick={() => {
                            setOpenMenuThreadId(null);
                            setParticipantsThread(thread);
                          }}
                          className="flex items-center gap-2.5 px-3 py-2 hover:bg-slate-50 rounded-lg text-slate-700 text-sm font-medium transition-colors w-full text-left"
                        >
                          <UserRoundCheck className="w-4 h-4 text-slate-400" />
                          View Participants
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleLeaveClick(thread)}
                        className="flex items-center gap-2.5 px-3 py-2 hover:bg-red-50 rounded-lg text-red-600 text-sm font-medium transition-colors w-full text-left"
                      >
                        {thread.type === 'Direct' ? <Trash2 className="w-4 h-4" /> : <LogOut className="w-4 h-4" />}
                        {leaveActionLabel(thread.type)}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ========================================== */}
      {/* RENDER THE ATTACHED MODALS */}
      {/* ========================================== */}
      <SearchDirectoryModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
      />

      <AdminGroupModal
        isOpen={!!groupMode}
        mode={groupMode || 'Group'} // Default fallback if null
        onClose={() => setGroupMode(null)}
      />

      <ParticipantsPanel
        isOpen={!!participantsThread}
        onClose={() => setParticipantsThread(null)}
        threadId={participantsThread?.thread_id || null}
        threadName={participantsThread?.chat_name || ''}
      />

    </div>
  );
}
