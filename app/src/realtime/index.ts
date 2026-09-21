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
 * Chat/messages subscriptions are the social slice's to add here later.
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

const topicFor = (campusId: string): string => `presence:campus:${campusId}`;

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
   * Called on foreground. supabase-js auto-reconnects its socket, but a
   * session that was backgrounded may have missed events entirely, so this
   * refreshes the realtime auth token (the JWT may have rotated while the app
   * slept) and signals an invalidation regardless of socket state.
   */
  reconnect(): void {
    void this.setAuth();
    this.handlers?.onInvalidate?.('foreground');
  }

  unsubscribe(): void {
    if (this.channel) {
      void this.client.removeChannel(this.channel);
      this.channel = null;
    }
    this.campusId = null;
    this.handlers = null;
  }

  /** Current topic, or null when not subscribed. Used by tests. */
  currentTopic(): string | null {
    return this.campusId ? topicFor(this.campusId) : null;
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
  singleton?.unsubscribe();
  singleton = null;
}
