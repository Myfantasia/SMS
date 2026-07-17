import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../libs/axiosInstance';
import type { IMessage } from '../libs/chat';

export type ChatSocketStatus = 'connecting' | 'open' | 'closed';

interface TypingUser {
  user_id: number;
  user_name: string;
}

interface AttachmentRef {
  attachment_url: string;
  attachment_name: string;
}

const WS_BASE = 'ws://localhost:8000'; // matches axiosInstance.ts's direct-to-:8000 convention
const MAX_BACKOFF_MS = 15000;
const TYPING_INDICATOR_TTL_MS = 3000;

/**
 * Owns the WebSocket connection for a single chat thread: connects, reconnects with
 * backoff on drop, backfills history via ThreadMessageHistoryAPI on every (re)connect
 * so nothing sent while disconnected is missed, and exposes send/edit/delete/typing.
 */
export function useChatSocket(threadId: string | null) {
  const [messages, setMessages] = useState<IMessage[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ChatSocketStatus>('closed');
  const [typingUser, setTypingUser] = useState<TypingUser | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);

  const backfill = useCallback(async (tId: string) => {
    try {
      const response = await api.get(`/api/chat/messages/${tId}/`);
      setMessages(response.data.messages);
    } catch (err) {
      console.error('Failed to load chat history', err);
    }
  }, []);

  const upsertMessage = useCallback((incoming: IMessage) => {
    setMessages(prev => {
      const idx = prev.findIndex(m => m.id === incoming.id);
      if (idx === -1) return [...prev, incoming];
      const next = [...prev];
      next[idx] = incoming;
      return next;
    });
  }, []);

  useEffect(() => {
    unmountedRef.current = false;
    setMessages([]);
    setTypingUser(null);
    reconnectAttemptRef.current = 0;

    if (!threadId) {
      setConnectionStatus('closed');
      return;
    }

    const connect = () => {
      setConnectionStatus('connecting');
      const socket = new WebSocket(`${WS_BASE}/ws/chat/${threadId}/`);
      socketRef.current = socket;

      socket.onopen = () => {
        reconnectAttemptRef.current = 0;
        setConnectionStatus('open');
        backfill(threadId);
      };

      socket.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === 'message') {
          upsertMessage(data.message as IMessage);
        } else if (data.type === 'typing') {
          setTypingUser({ user_id: data.user_id, user_name: data.user_name });
          if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = setTimeout(() => setTypingUser(null), TYPING_INDICATOR_TTL_MS);
        } else if (data.type === 'error') {
          console.error('Chat error:', data.message);
        }
      };

      socket.onclose = () => {
        setConnectionStatus('closed');
        if (unmountedRef.current) return;
        const delay = Math.min(1000 * 2 ** reconnectAttemptRef.current, MAX_BACKOFF_MS);
        reconnectAttemptRef.current += 1;
        reconnectTimerRef.current = setTimeout(connect, delay);
      };

      socket.onerror = () => {
        socket.close();
      };
    };

    connect();

    return () => {
      unmountedRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [threadId, backfill, upsertMessage]);

  const send = useCallback((payload: Record<string, unknown>): boolean => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }, []);

  const sendMessage = useCallback((messageBody: string, attachment?: AttachmentRef) => {
    return send({
      type: 'send',
      message_body: messageBody,
      attachment_url: attachment?.attachment_url,
      attachment_name: attachment?.attachment_name,
    });
  }, [send]);

  const editMessage = useCallback((messageId: number, messageBody: string) => {
    return send({ type: 'edit', message_id: messageId, message_body: messageBody });
  }, [send]);

  const deleteMessage = useCallback((messageId: number) => {
    return send({ type: 'delete', message_id: messageId });
  }, [send]);

  const sendTyping = useCallback(() => {
    return send({ type: 'typing' });
  }, [send]);

  return {
    messages,
    connectionStatus,
    typingUser,
    sendMessage,
    editMessage,
    deleteMessage,
    sendTyping,
  };
}
