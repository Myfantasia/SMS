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
  // Bumped in every effect cleanup so a stale connection's async callbacks can tell
  // they've been superseded by a later run and go inert — see useChatSocket.ts, which
  // shares this exact pattern for the same zombie-reconnect race.
  const generationRef = useRef(0);
  const onUpdateRef = useRef(onUpdate);
  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  useEffect(() => {
    const myGeneration = generationRef.current;
    reconnectAttemptRef.current = 0;

    if (!enabled) {
      return;
    }

    const connect = () => {
      if (generationRef.current !== myGeneration) return;

      const socket = new WebSocket(`${WS_BASE}/ws/inbox/`);
      socketRef.current = socket;

      socket.onopen = () => {
        if (generationRef.current !== myGeneration) return;
        reconnectAttemptRef.current = 0;
      };

      socket.onmessage = (event) => {
        if (generationRef.current !== myGeneration) return;
        const data = JSON.parse(event.data);
        if (data.type === 'inbox.update') {
          onUpdateRef.current(data as InboxUpdateEvent);
        }
      };

      socket.onclose = () => {
        if (generationRef.current !== myGeneration) return;
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
      generationRef.current += 1;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [enabled]);
}
