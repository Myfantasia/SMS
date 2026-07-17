/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import type { IInboxThread } from '../../libs/chat';
import api from '../../libs/axiosInstance';
import { useInboxSocket } from '../../hooks/useInboxSocket';
import type { InboxUpdateEvent } from '../../hooks/useInboxSocket';


// ==========================================
// 1. DEFINE THE SHAPE OF OUR GLOBAL STATE
// ==========================================
interface ChatContextType {
  inboxThreads: IInboxThread[];
  activeThreadId: string | null;
  unreadCount: number;
  isLoading: boolean;
  error: string | null;
  setActiveThread: (threadId: string | null) => void;
  refreshInbox: () => Promise<void>;
  leaveConversation: (threadId: string) => Promise<void>;
}

// Create the context with a null default
const ChatContext = createContext<ChatContextType | null>(null);

// ==========================================
// 2. THE PROVIDER COMPONENT (The Brain)
// ==========================================
export const ChatProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [inboxThreads, setInboxThreads] = useState<IInboxThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Read inside the inbox-socket callback below without re-subscribing the socket
  // every time the user switches threads.
  const activeThreadIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  // Dynamically calculate the red badge number for the Navbar
  const unreadCount = inboxThreads.filter(thread => thread.has_unread).length;

  // Function to pull the latest inbox data from Django
  const refreshInbox = useCallback(async () => {
    try {
      const response = await api.get('/api/chat/inbox/');
      setInboxThreads(response.data.inbox);
      setError(null);
    } catch (err) {
      console.error("Failed to fetch chat inbox", err);
      setError("Could not load messages.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // DashboardLayouts.tsx already gates dashboard rendering on a real (session-based)
  // auth check before this provider ever mounts, so the inbox can load immediately.
  useEffect(() => {
    refreshInbox();
  }, [refreshInbox]);

  // Live sidebar updates: patch the affected row in place so a message arriving in a
  // background thread reorders/re-previews without a full inbox refetch. Falls back to
  // one refreshInbox() call if the ping is for a thread we don't have yet (e.g. someone
  // just added this user to a brand-new group).
  const handleInboxUpdate = useCallback((event: InboxUpdateEvent) => {
    setInboxThreads(prevThreads => {
      const idx = prevThreads.findIndex(t => t.thread_id === event.thread_id);
      if (idx === -1) {
        refreshInbox();
        return prevThreads;
      }

      const isActive = activeThreadIdRef.current === event.thread_id;
      const updated: IInboxThread = {
        ...prevThreads[idx],
        last_message: event.message_body,
        updated_at: event.updated_at,
        has_unread: isActive ? prevThreads[idx].has_unread : true,
      };

      const next = prevThreads.filter(t => t.thread_id !== event.thread_id);
      next.unshift(updated);
      return next;
    });
  }, [refreshInbox]);

  useInboxSocket(true, handleInboxUpdate);

  // Leaves a thread on the caller's behalf — "Delete Conversation" (Direct), "Leave
  // Group", or "Leave Broadcast" all resolve to this same backend call, differing only
  // in the confirmation copy the sidebar shows before calling it.
  const leaveConversation = useCallback(async (threadId: string) => {
    await api.post(`/api/chat/leave/${threadId}/`);
    setInboxThreads(prevThreads => prevThreads.filter(t => t.thread_id !== threadId));
    setActiveThreadId(prev => (prev === threadId ? null : prev));
  }, []);

  // Function to handle clicking on a chat room
  const handleSetActiveThread = async (threadId: string | null) => {
    setActiveThreadId(threadId);

    if (!threadId) return;

    // Find the thread the user just clicked
    const clickedThread = inboxThreads.find(t => t.thread_id === threadId);

    // If it was unread, we need to clear the badge and ping Django
    if (clickedThread && clickedThread.has_unread) {
      // 1. Optimistic UI Update: Instantly clear the red dot on the screen
      setInboxThreads(prevThreads =>
        prevThreads.map(t =>
          t.thread_id === threadId ? { ...t, has_unread: false } : t
        )
      );

      // 2. Silent Backend Ping: Tell Django they read it
      try {
        await api.post(`/api/chat/read/${threadId}/`);
      } catch (err) {
        console.error("Failed to mark thread as read in database", err);
        // Note: Even if this fails, we keep the UI clean. They can try again later.
      }
    }
  };

  return (
    <ChatContext.Provider
      value={{
        inboxThreads,
        activeThreadId,
        unreadCount,
        isLoading,
        error,
        setActiveThread: handleSetActiveThread,
        refreshInbox,
        leaveConversation,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
};

// ==========================================
// 3. THE CUSTOM HOOK (For easy access)
// ==========================================
// FIX: The eslint-disable comment at the top of the file allows this export
export const useChat = (): ChatContextType => {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChat must be used within a ChatProvider. Did you forget to wrap your app?');
  }
  return context;
};
