/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { IInboxThread } from '../../libs/chat';

// --- FIREBASE IMPORTS ---
import { signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { auth } from '../../firebaseConfig';
import api from '../../libs/axiosInstance';


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

  // Tracks whether the Firebase auth bridge has finished logging in.
  // The inbox must NOT fetch until this is true.
  const [isFirebaseReady, setIsFirebaseReady] = useState<boolean>(false);

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

  // ==========================================
  // STEP 1: FIREBASE AUTHENTICATION BRIDGE
  // Must complete FIRST — sets isFirebaseReady when done
  // ==========================================
  useEffect(() => {
    const authenticateFirebase = async () => {
      try {
        // 1. Ask Django for the Firebase Custom Token
        const response = await api.get('/api/chat/firebase-token/');
        const firebaseToken = response.data.firebase_token;

        localStorage.setItem('my_chat_email', response.data.user_email);

        // 2. Use the token to sign into Firebase
        await signInWithCustomToken(auth, firebaseToken);
        console.log("✅ Successfully logged into Firebase!");

      } catch (err) {
        console.error("❌ Failed to authenticate with Firebase:", err);
      } finally {
        // Whether it succeeded or failed, unblock the inbox fetch
        setIsFirebaseReady(true);
      }
    };

    if (!auth.currentUser) {
      authenticateFirebase();
    } else {
      // Already logged in (e.g. on hot reload), unblock immediately
      setIsFirebaseReady(true);
    }
  }, []);

  // ==========================================
  // STEP 2: FETCH INBOX — only after Firebase bridge is done
  // onAuthStateChanged confirms the token is active before calling Django
  // ==========================================
  useEffect(() => {
    if (!isFirebaseReady) return; // Gate: wait for bridge to finish

    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser) {
        refreshInbox(); // Token is live in interceptor — safe to call Django
      } else {
        setIsLoading(false); // Not logged in, stop the spinner
      }
    });

    return () => unsubscribe();
  }, [isFirebaseReady, refreshInbox]);

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