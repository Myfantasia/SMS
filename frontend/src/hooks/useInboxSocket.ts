import { useEffect, useRef } from 'react';

export type InboxSocketStatus = 'connecting' | 'open' | 'closed';

export interface InboxUpdateEvent {
  type: 'inbox.update';
  thread_id: string;
  message_body: string;
  sender_id: number | null;
  sender_name: string;
  updated_at: string;
}

const WS_BASE = 'ws://localhost:8000'; // matches useChatSocket.ts's direct-to-:8000 convention
const MAX_BACKOFF_MS = 15000;

/**
 * One persistent socket per logged-in user, relaying live pings for messages sent
 * in any thread they participate in — including threads that aren't currently open —
 * so the sidebar can update without a full inbox refetch. Mirrors useChatSocket.ts's
 * reconnect/backoff pattern, but this socket only ever relays pings: nothing to
 * accumulate, so it just forwards each event to the caller via onUpdate.
 */
export function useInboxSocket(enabled: boolean, onUpdate: (event: InboxUpdateEvent) => void) {
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);
  const onUpdateRef = useRef(onUpdate);
  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  useEffect(() => {
    unmountedRef.current = false;
    reconnectAttemptRef.current = 0;

    if (!enabled) {
      return;
    }

    const connect = () => {
      const socket = new WebSocket(`${WS_BASE}/ws/inbox/`);
      socketRef.current = socket;

      socket.onopen = () => {
        reconnectAttemptRef.current = 0;
      };

      socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'inbox.update') {
          onUpdateRef.current(data as InboxUpdateEvent);
        }
      };

      socket.onclose = () => {
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
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [enabled]);
}
