import { useState, useMemo } from 'react';
import { 
  Search, 
  MessageSquarePlus, 
  Users, 
  Megaphone,
  User
} from 'lucide-react';
import { useChat } from './ChatProvider';

// --- NEW: IMPORT THE MODALS ---
import SearchDirectoryModal from './SearchDirectoryModal';
import AdminGroupModal from './AdminGroupModal';

export default function ChatSidebar() {
  const { inboxThreads, activeThreadId, setActiveThread } = useChat();
  const [localSearch, setLocalSearch] = useState('');

  // --- NEW: MODAL STATE CONTROL ---
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [groupMode, setGroupMode] = useState<'Group' | 'Broadcast' | null>(null);

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

  // 3. ICON SELECTOR: Chooses the right icon based on the thread type
  const getThreadIcon = (type: string) => {
    switch (type) {
      case 'Group': return <Users className="w-4 h-4 text-slate-500" />;
      case 'Broadcast': return <Megaphone className="w-4 h-4 text-orange-500" />;
      default: return <User className="w-4 h-4 text-blue-500" />;
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 border-r border-slate-200 relative">
      
      {/* ========================================== */}
      {/* HEADER & ACTION BUTTONS */}
      {/* ========================================== */}
      <div className="p-4 border-b border-slate-200 bg-white">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-slate-800">Messages</h2>
          
          {/* Admin Superpower Action Buttons */}
          <div className="flex gap-2">
            
            {/* Standard 1-on-1 Search Modal Trigger */}
            <button 
              className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-full transition-colors"
              title="New Direct Message"
              onClick={() => setIsSearchOpen(true)} // <-- UPDATED
            >
              <MessageSquarePlus className="w-4 h-4" />
            </button>

            {/* Admin Group Builder Modal Trigger */}
            <button 
              className="p-2 bg-slate-100 hover:bg-blue-100 text-slate-600 hover:text-blue-600 rounded-full transition-colors hidden md:block"
              title="Create Group Chat"
              onClick={() => setGroupMode('Group')} // <-- UPDATED
            >
              <Users className="w-4 h-4" />
            </button>

            {/* Admin Broadcast Modal Trigger */}
            <button 
              className="p-2 bg-slate-100 hover:bg-orange-100 text-slate-600 hover:text-orange-600 rounded-full transition-colors hidden md:block"
              title="Send School Broadcast"
              onClick={() => setGroupMode('Broadcast')} // <-- UPDATED
            >
              <Megaphone className="w-4 h-4" />
            </button>
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
              
              return (
                <li key={thread.thread_id}>
                  <button
                    onClick={() => setActiveThread(thread.thread_id)}
                    className={`w-full text-left p-4 hover:bg-white transition-colors flex items-start gap-3 relative
                      ${isActive ? 'bg-white shadow-[inset_4px_0_0_0_#2563eb]' : 'bg-transparent'}
                    `}
                  >
                    {/* Dynamic Avatar Container */}
                    <div className={`relative shrink-0 w-10 h-10 rounded-full flex items-center justify-center
                      ${thread.type === 'Broadcast' ? 'bg-orange-100' : 
                        thread.type === 'Group' ? 'bg-slate-200' : 'bg-blue-100'}
                    `}>
                      {getThreadIcon(thread.type)}
                      
                      {/* Unread Red Dot (Bottom Right of Avatar) */}
                      {thread.has_unread && (
                        <div className="absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-blue-500 border-2 border-white rounded-full"></div>
                      )}
                    </div>

                    {/* Chat Name & Timestamp */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between mb-0.5">
                        <h3 className={`text-sm truncate pr-2 ${thread.has_unread ? 'font-bold text-slate-900' : 'font-semibold text-slate-700'}`}>
                          {thread.chat_name}
                        </h3>
                        <span className={`text-[10px] whitespace-nowrap ${thread.has_unread ? 'text-blue-600 font-semibold' : 'text-slate-400'}`}>
                          {formatTime(thread.updated_at)}
                        </span>
                      </div>
                      
                      {/* Sub-label based on type */}
                      <p className="text-xs text-slate-500 truncate">
                        {thread.type === 'Broadcast' ? 'Official Notice' : 
                         thread.type === 'Group' ? 'Group Collaboration' : 'Direct Message'}
                      </p>
                    </div>
                  </button>
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

    </div>
  );
}