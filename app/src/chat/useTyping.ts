import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../api/client';

/**
 * The typing indicator (owner ruling, 30 September 2026), over migration
 * 0026's private broadcast channel, one per conversation:
 * `conversation:<id>`, event `typing`, payload `{ user_id, at }` (epoch ms).
 *
 * Nothing is stored: a broadcast is a live nudge between two open threads.
 * Receiving needs `can_read_conversation` (RLS on `realtime.messages`), so a
 * join that errors means "not allowed" and the indicator simply never shows.
 * No error line, ever.
 *
 * Sending: at most one event every `TYPING_THROTTLE_MS` while the composer has
 * text. There is no "stopped typing" event; the receiver lets the indicator
 * go `TYPING_EXPIRY_MS` after the last one, or the moment their message lands.
 * A locked composer (`composerState.canSend` false) never sends. A
 * shadow-accepted blocked party's composer is live (decision 12), so their
 * app still sends exactly as usual; the server refuses the write and the
 * refusal is swallowed here, so nothing on their screen changes.
 *
 * This is its own channel, not part of `realtime/`'s manager: that manager's
 * thread channel is a non-private `postgres_changes` channel
 * (`messages:conversation:<id>`), and broadcast authorization needs
 * `private: true`. The topics differ, so the two never collide.
 *
 * Subscribed while the thread is focused; blurring or leaving it tears the
 * channel down.
 */

export const TYPING_EVENT = 'typing';
/** At most one `typing` broadcast this often while typing. */
export const TYPING_THROTTLE_MS = 2000;
/** The indicator goes this long after the last event. */
export const TYPING_EXPIRY_MS = 4000;

/** Canonical lowercase uuid: the topic policy (0026) accepts nothing else. */
export const typingTopicFor = (conversationId: string): string => `conversation:${conversationId.toLowerCase()}`;

export interface TypingEvent {
  user_id: string;
  at: number;
}

/**
 * A broadcast as supabase-js hands it over: `{ event, payload: {...} }`, and
 * on some v2 releases a doubly wrapped `{ payload: { payload: {...} } }`.
 * Anything else is ignored rather than thrown inside a socket callback.
 */
export function parseTypingPayload(message: unknown): TypingEvent | null {
  const outer = (message as { payload?: unknown } | null)?.payload;
  const inner = (outer as { payload?: unknown } | null)?.payload;
  const candidate = (inner ?? outer) as { user_id?: unknown; at?: unknown } | null;
  if (!candidate || typeof candidate.user_id !== 'string') return null;
  return { user_id: candidate.user_id, at: typeof candidate.at === 'number' ? candidate.at : Date.now() };
}

interface Options {
  conversationId: string | null | undefined;
  meId: string | null;
  /** When known, only this person's events count. */
  otherId: string | null;
  /** False while the thread is gone or not yet loaded: no channel at all. */
  enabled: boolean;
}

export interface TypingState {
  /** The other person is typing right now. Never true for my own events. */
  otherTyping: boolean;
  /** Call on every change to a non-empty composer; throttled here. */
  notifyTyping: () => void;
  /** Their message arrived: the indicator goes at once. */
  hideTyping: () => void;
}

export function useTyping({ conversationId, meId, otherId, enabled }: Options): TypingState {
  const [otherTyping, setOtherTyping] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const readyRef = useRef(false);
  const lastSentRef = useRef(0);
  const expiryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idsRef = useRef({ meId, otherId });
  idsRef.current = { meId, otherId };

  const clearExpiry = useCallback(() => {
    if (expiryRef.current) clearTimeout(expiryRef.current);
    expiryRef.current = null;
  }, []);

  const hideTyping = useCallback(() => {
    clearExpiry();
    setOtherTyping(false);
  }, [clearExpiry]);

  useEffect(() => clearExpiry, [clearExpiry]);

  useFocusEffect(
    useCallback(() => {
      if (!conversationId || !enabled) return undefined;
      let cancelled = false;
      let channel: RealtimeChannel | null = null;

      const onBroadcast = (message: unknown) => {
        const event = parseTypingPayload(message);
        const { meId: me, otherId: other } = idsRef.current;
        // Never my own, never before I know who I am, never a third party.
        if (!event || !me || event.user_id === me) return;
        if (other && event.user_id !== other) return;
        setOtherTyping(true);
        if (expiryRef.current) clearTimeout(expiryRef.current);
        expiryRef.current = setTimeout(() => {
          expiryRef.current = null;
          setOtherTyping(false);
        }, TYPING_EXPIRY_MS);
      };

      const start = async () => {
        try {
          // A private channel's join is authorized with the user's JWT.
          await supabase.realtime.setAuth();
        } catch {
          // A failed token refresh shows up as a refused join, handled below.
        }
        if (cancelled) return;
        try {
          channel = supabase.channel(typingTopicFor(conversationId), { config: { private: true } });
          channel.on('broadcast', { event: TYPING_EVENT }, onBroadcast);
          channel.subscribe((status: string) => {
            // Anything but a live join (a refusal, a timeout, a close) just
            // means no indicator and no sending: never an error line.
            readyRef.current = status === 'SUBSCRIBED';
          });
          channelRef.current = channel;
        } catch {
          channel = null;
          channelRef.current = null;
        }
      };
      void start();

      return () => {
        cancelled = true;
        readyRef.current = false;
        channelRef.current = null;
        clearExpiry();
        setOtherTyping(false);
        if (channel) {
          try {
            void Promise.resolve(supabase.removeChannel(channel)).catch(() => undefined);
          } catch {
            // Already gone.
          }
        }
      };
    }, [conversationId, enabled, clearExpiry])
  );

  const notifyTyping = useCallback(() => {
    const channel = channelRef.current;
    const me = idsRef.current.meId;
    if (!channel || !readyRef.current || !me) return;
    const now = Date.now();
    if (now - lastSentRef.current < TYPING_THROTTLE_MS) return;
    lastSentRef.current = now;
    try {
      // A refused write (a blocked party, decision 12) comes back as 'error'
      // or a rejection; either way it is dropped without a word.
      void Promise.resolve(
        channel.send({ type: 'broadcast', event: TYPING_EVENT, payload: { user_id: me, at: now } })
      ).catch(() => undefined);
    } catch {
      // Same: nothing to show.
    }
  }, []);

  return { otherTyping, notifyTyping, hideTyping };
}
