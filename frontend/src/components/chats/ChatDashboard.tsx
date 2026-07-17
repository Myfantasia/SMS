import { useChat } from './ChatProvider';
import ChatSidebar from './ChatSidebar';
import { MessageSquareDashed } from 'lucide-react';
import ChatWindow from './ChatWindow';


export default function ChatDashboard() {
  const { activeThreadId } = useChat();

  return (
    // The container takes up the full height minus the Navbar (approx 4rem/64px)
    <div className="flex h-[calc(100vh-4rem)] bg-white overflow-hidden">
      
      {/* ========================================== */}
      {/* LEFT COLUMN: THE SIDEBAR (INBOX) */}
      {/* ========================================== */}
      {/* On mobile: Hidden if a chat is open. On desktop: Always visible (1/3 width) */}
      <div 
        className={`w-full md:w-1/3 lg:w-1/4 border-r border-slate-200 bg-slate-50 flex flex-col
          ${activeThreadId ? 'hidden md:flex' : 'flex'}
        `}
      >
        <ChatSidebar />
      </div>

      {/* ========================================== */}
      {/* RIGHT COLUMN: THE ACTIVE CHAT WINDOW */}
      {/* ========================================== */}
      {/* On mobile: Hidden if NO chat is open. On desktop: Always takes remaining space */}
      <div 
        className={`flex-1 flex flex-col bg-white
          ${!activeThreadId ? 'hidden md:flex' : 'flex'}
        `}
      >
        {activeThreadId ? (
          // If they clicked a chat, show the actual conversation
          <ChatWindow />
        ) : (
          // The "Empty State" when they first load the page
          <div className="flex-1 flex flex-col items-center justify-center bg-slate-50 text-slate-400">
            <div className="w-24 h-24 bg-slate-100 rounded-full flex items-center justify-center mb-4 border border-slate-200 shadow-sm">
              <MessageSquareDashed className="w-10 h-10 text-slate-300" />
            </div>
            <h2 className="text-xl font-semibold text-slate-600 mb-2">Your Communication Hub</h2>
            <p className="text-sm text-slate-500 max-w-md text-center">
              Select a conversation from the left menu, or click the "New Chat" button to start messaging a teacher or parent.
            </p>
          </div>
        )}
      </div>

    </div>
  );
}