import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../api/client';

/**
 * The one subscription manager (`docs/app-architecture-plan.md` §6).
 *
 * v1 subscribes to exactly one topic: `presence:campus:<campus_id>`, the only
 * broadcast the schema fires. It comes from `public.broadcast_here_now()`, an
 * `after update of here_now_until on public.profiles` trigger:
 *
 * ```sql
 * perform realtime.send(
 *   jsonb_build_object('user_id', new.id, 'here_now', new.here_now_until > now()),
 *   'here_now',
 *   'presence:campus:' || new.campus_id::text,
 *   true                      -- private topic
 * );
 * ```
 *
 * So the payload is `{ user_id, here_now }` and **never a tier or a
 * coordinate**. The `campus presence topic` policy on `realtime.messages`
 * restricts each subscriber to their own campus's topic, and the `true`
 * argument makes it a private channel — which is why `subscribe()` below sets
 * the realtime auth token first; without it the join is rejected.
 *
 * The chat slice adds the second and third subscriptions below
 * (`subscribeConversation`, `subscribeMessageList`). Those are
 * `postgres_changes` on `public.messages` — a different mechanism from the
 * broadcast above: the table is on the `supabase_realtime` publication and its
 * select policy (`can_read_conversation`) is applied **per subscriber**, so a
 * shadow-accepted thread never reaches the blocker on the live feed either.
 * That also means they are ordinary (non-private) channels: `config.private`
 * governs broadcast/presence authorization, not row-level replication.
 */

export interface HereNowEvent {
  user_id: string;
  here_now: boolean;
}

export type SubscriptionStatus = 'subscribed' | 'closed' | 'error';

export interface CampusPresenceHandlers {
  /**
   * A here-now flip for someone on this campus. Callers must merge it into a
   * grid row they already hold and **drop any `user_id` they don't** — that is
   * what keeps a blocked pair from learning about each other through the
   * broadcast, since neither is ever in the other's `grid_for_me()` result.
   */
  onHereNow: (event: HereNowEvent) => void;
  /**
   * Fired on every successful (re)subscribe, including reconnects. The grid
   * treats it as an invalidation signal: the socket may have missed events
   * while it was down, so refetch rather than trusting it to have caught up
   * (architecture plan §6, "Reconnect").
   */
  onInvalidate?: (reason: 'subscribed' | 'foreground') => void;
  onStatusChange?: (status: SubscriptionStatus) => void;
}

/**
 * A `public.messages` row as it arrives over `postgres_changes`. Every column
 * is replicated (the table has a full select grant to `authenticated`), but
 * treat it as unvalidated wire data: `parseMessagePayload` below is the only
 * way into the handlers.
 */
export interface MessageEvent {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string | null;
  media_path: string | null;
  created_at: string;
}

export interface ConversationMessageHandlers {
  /** A new message in this thread, from either participant (my own inserts echo back). */
  onMessage: (message: MessageEvent) => void;
  /**
   * Fired on every successful (re)subscribe and on foreground. The socket may
   * have missed inserts while it was down, so refetch the thread rather than
   * trusting it to have caught up.
   */
  onInvalidate?: (reason: 'subscribed' | 'foreground') => void;
  onStatusChange?: (status: SubscriptionStatus) => void;
}

export interface MessageListHandlers {
  /**
   * Any message insert in any conversation the subscriber can read. RLS does
   * the narrowing — there is no client-side filter that could substitute for
   * it, and none is attempted.
   */
  onMessage: (message: MessageEvent) => void;
  onInvalidate?: (reason: 'subscribed' | 'foreground') => void;
  onStatusChange?: (status: SubscriptionStatus) => void;
}

const topicFor = (campusId: string): string => `presence:campus:${campusId}`;
const conversationTopicFor = (conversationId: string): string => `messages:conversation:${conversationId}`;
const MESSAGE_LIST_TOPIC = 'messages:list';

/**
 * Validates a `postgres_changes` INSERT payload into a `MessageEvent`.
 *
 * Same defensive posture as `parseHereNowPayload`: a shape change degrades to
 * "ignore the event" (both screens also refetch on reconnect) rather than
 * throwing inside a socket callback. Never log the record — it carries another
 * user's id and their message body.
 */
export function parseMessagePayload(message: unknown): MessageEvent | null {
  const record = (message as { new?: unknown } | null)?.new as
    | Record<string, unknown>
    | undefined;
  if (!record) return null;

  const { id, conversation_id: conversationId, sender_id: senderId, created_at: createdAt } = record;
  if (typeof id !== 'string') return null;
  if (typeof conversationId !== 'string') return null;
  if (typeof senderId !== 'string') return null;
  if (typeof createdAt !== 'string') return null;

  return {
    id,
    conversation_id: conversationId,
    sender_id: senderId,
    body: typeof record.body === 'string' ? record.body : null,
    media_path: typeof record.media_path === 'string' ? record.media_path : null,
    created_at: createdAt,
  };
}

/**
 * `realtime.send` from Postgres delivers the jsonb as the broadcast payload,
 * but supabase-js has shipped both shapes over its v2 line — `{ payload: {…} }`
 * and a doubly-wrapped `{ payload: { payload: {…} } }` — depending on whether
 * the message came from the database or from a client `send()`. Unwrap
 * defensively and validate, so a shape change degrades to "ignore the event"
 * (the grid still polls) rather than throwing inside the socket callback.
 */
export function parseHereNowPayload(message: unknown): HereNowEvent | null {
  const outer = (message as { payload?: unknown } | null)?.payload;
  const inner = (outer as { payload?: unknown } | null)?.payload;
  const candidate = (inner ?? outer) as { user_id?: unknown; here_now?: unknown } | null;

  if (!candidate || typeof candidate.user_id !== 'string') return null;
  if (typeof candidate.here_now !== 'boolean') return null;

  return { user_id: candidate.user_id, here_now: candidate.here_now };
}

export class RealtimeManager {
  private readonly client: SupabaseClient<any, any, any>;
  private channel: RealtimeChannel | null = null;
  private campusId: string | null = null;
  private handlers: CampusPresenceHandlers | null = null;

  /**
   * One channel per open thread, keyed by conversation id. A map rather than a
   * single slot because a stack push (list -> thread -> profile -> thread) can
   * legitimately hold two threads mounted at once during the transition.
   */
  private conversationChannels = new Map<
    string,
    { channel: RealtimeChannel; handlers: ConversationMessageHandlers }
  >();

  private listChannel: { channel: RealtimeChannel; handlers: MessageListHandlers } | null = null;

  constructor(client: SupabaseClient<any, any, any> = supabase as SupabaseClient<any, any, any>) {
    this.client = client;
  }

  /**
   * Subscribes to this campus's presence topic. Re-subscribing to the same
   * campus is a no-op (handlers are updated in place); switching campuses
   * tears the old channel down first. Returns an unsubscribe function.
   */
  subscribeCampusPresence(campusId: string, handlers: CampusPresenceHandlers): () => void {
    if (this.channel && this.campusId === campusId) {
      this.handlers = handlers;
      return () => this.unsubscribe();
    }

    this.unsubscribe();
    this.campusId = campusId;
    this.handlers = handlers;

    // Private channel: the socket needs the user's JWT before the join, or
    // the `campus presence topic` policy can't evaluate `auth.uid()`.
    void this.setAuth();

    const channel = this.client.channel(topicFor(campusId), {
      config: { private: true },
    });

    channel.on('broadcast', { event: 'here_now' }, (message: unknown) => {
      const event = parseHereNowPayload(message);
      // Never log the message: it carries another user's id.
      if (event) this.handlers?.onHereNow(event);
    });

    channel.subscribe((status: string) => {
      if (status === 'SUBSCRIBED') {
        this.handlers?.onStatusChange?.('subscribed');
        this.handlers?.onInvalidate?.('subscribed');
        return;
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        this.handlers?.onStatusChange?.('error');
        return;
      }
      if (status === 'CLOSED') this.handlers?.onStatusChange?.('closed');
    });

    this.channel = channel;
    return () => this.unsubscribe();
  }

  /**
   * Subscribes to inserts on `public.messages` for one open thread.
   *
   * Server-side filter (`conversation_id=eq.<id>`), not a client-side one: it
   * keeps the socket from carrying every thread's traffic to every mounted
   * screen, and it composes with — never replaces — the per-subscriber RLS the
   * publication applies. Re-subscribing to the same conversation swaps the
   * handlers in place. Returns an unsubscribe function; call it on unmount.
   */
  subscribeConversation(conversationId: string, handlers: ConversationMessageHandlers): () => void {
    const existing = this.conversationChannels.get(conversationId);
    if (existing) {
      existing.handlers = handlers;
      return () => this.unsubscribeConversation(conversationId);
    }

    void this.setAuth();

    const channel = this.client.channel(conversationTopicFor(conversationId));
    channel.on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      },
      (message: unknown) => {
        const event = parseMessagePayload(message);
        // Never log the payload: another user's id and message body.
        if (event) this.conversationChannels.get(conversationId)?.handlers.onMessage(event);
      }
    );

    channel.subscribe((status: string) => {
      const entry = this.conversationChannels.get(conversationId);
      if (status === 'SUBSCRIBED') {
        entry?.handlers.onStatusChange?.('subscribed');
        entry?.handlers.onInvalidate?.('subscribed');
        return;
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        entry?.handlers.onStatusChange?.('error');
        return;
      }
      if (status === 'CLOSED') entry?.handlers.onStatusChange?.('closed');
    });

    this.conversationChannels.set(conversationId, { channel, handlers });
    return () => this.unsubscribeConversation(conversationId);
  }

  unsubscribeConversation(conversationId: string): void {
    const entry = this.conversationChannels.get(conversationId);
    if (!entry) return;
    this.conversationChannels.delete(conversationId);
    void this.client.removeChannel(entry.channel);
  }

  /**
   * One list-level subscription across every `messages` insert the caller can
   * read — no filter, because RLS is the filter (a blocker's channel never
   * receives the blocked party's inserts, plan §3). The chat list patches the
   * affected row in place rather than refetching the whole list.
   *
   * Only one exists at a time; re-subscribing swaps the handlers.
   */
  subscribeMessageList(handlers: MessageListHandlers): () => void {
    if (this.listChannel) {
      this.listChannel.handlers = handlers;
      return () => this.unsubscribeMessageList();
    }

    void this.setAuth();

    const channel = this.client.channel(MESSAGE_LIST_TOPIC);
    channel.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages' },
      (message: unknown) => {
        const event = parseMessagePayload(message);
        if (event) this.listChannel?.handlers.onMessage(event);
      }
    );

    channel.subscribe((status: string) => {
      const entry = this.listChannel;
      if (status === 'SUBSCRIBED') {
        entry?.handlers.onStatusChange?.('subscribed');
        entry?.handlers.onInvalidate?.('subscribed');
        return;
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        entry?.handlers.onStatusChange?.('error');
        return;
      }
      if (status === 'CLOSED') entry?.handlers.onStatusChange?.('closed');
    });

    this.listChannel = { channel, handlers };
    return () => this.unsubscribeMessageList();
  }

  unsubscribeMessageList(): void {
    if (!this.listChannel) return;
    const { channel } = this.listChannel;
    this.listChannel = null;
    void this.client.removeChannel(channel);
  }

  /**
   * Called on foreground. supabase-js auto-reconnects its socket, but a
   * session that was backgrounded may have missed events entirely, so this
   * refreshes the realtime auth token (the JWT may have rotated while the app
   * slept) and signals an invalidation regardless of socket state — to the
   * campus presence subscriber and to every chat subscriber alike.
   */
  reconnect(): void {
    void this.setAuth();
    this.handlers?.onInvalidate?.('foreground');
    for (const entry of this.conversationChannels.values()) {
      entry.handlers.onInvalidate?.('foreground');
    }
    this.listChannel?.handlers.onInvalidate?.('foreground');
  }

  unsubscribe(): void {
    if (this.channel) {
      void this.client.removeChannel(this.channel);
      this.channel = null;
    }
    this.campusId = null;
    this.handlers = null;
  }

  /**
   * Tears down every channel this manager holds — campus presence, every open
   * thread, and the list. Sign-out / test seam; `unsubscribe()` above keeps
   * its narrower campus-presence-only meaning so existing callers are
   * unaffected.
   */
  unsubscribeAll(): void {
    this.unsubscribe();
    for (const conversationId of Array.from(this.conversationChannels.keys())) {
      this.unsubscribeConversation(conversationId);
    }
    this.unsubscribeMessageList();
  }

  /** Current topic, or null when not subscribed. Used by tests. */
  currentTopic(): string | null {
    return this.campusId ? topicFor(this.campusId) : null;
  }

  /** Subscribed thread topics, in subscription order. Used by tests. */
  conversationTopics(): string[] {
    return Array.from(this.conversationChannels.keys()).map(conversationTopicFor);
  }

  private async setAuth(): Promise<void> {
    try {
      // No-arg `setAuth()` pulls the current access token off the auth client.
      await this.client.realtime.setAuth();
    } catch {
      // A token refresh failure surfaces as a failed subscribe, which the
      // grid already tolerates (it polls). Nothing to report here.
    }
  }
}

let singleton: RealtimeManager | null = null;

export function getRealtimeManager(): RealtimeManager {
  if (!singleton) singleton = new RealtimeManager();
  return singleton;
}

/** Sign-out / test seam. */
export function resetRealtimeManager(): void {
  singleton?.unsubscribeAll();
  singleton = null;
}
