// The only data path `media-open` uses to read `messages` media columns and
// to reach `private.can_read_conversation` / `private.open_limited_media`.
// docs/chat-media-plan.md §3 (schema), §4 (open path).
//
// `private` is not in config.toml's exposed `schemas`, so PostgREST --
// therefore `serviceClient()` from `_shared/supabase.ts` -- can never reach
// `private.open_limited_media` or `private.can_read_conversation` under any
// role. A direct Postgres connection is the only path, same pattern as
// `identity/db.ts`: every statement runs inside a transaction that starts
// with `set local role service_role`, so the session's effective privileges
// are exactly the grants migration 0003/0010 hand `service_role`.
//
// ASSUMED SQL SURFACE -- migration 0010 does not exist yet at the time this
// was written (docs/chat-media-plan.md §11 builds this function against
// 0010's spec, not its landed code). Every statement below is exactly what
// this function needs; if 0010 lands with different column or RPC names,
// this file is the only place that needs to change. See README.md's
// "Assumed schema" section for the full list, restated in one place for the
// migration author.
//
// Nothing here logs a row, a path, or the connection string.

import postgres from "postgres";
import { firstEnv } from "../_shared/env.ts";

export type MediaKind = "photo" | "video";

export interface MessageMediaRow {
  conversation_id: string;
  sender_id: string;
  media_kind: MediaKind;
  media_path: string;
  media_poster_path: string | null;
  view_limit: number;
  views_used: number;
}

/** What `private.open_limited_media` hands back on a successful, counted open. */
export interface OpenedMedia {
  media_path: string;
  media_poster_path: string | null;
  media_kind: MediaKind;
  views_used: number;
  view_limit: number;
  /** `view_limit - views_used`, computed by the RPC itself — never recomputed here. */
  views_remaining: number;
}

/**
 * The surface `router.ts` depends on. `index_test.ts` supplies a fake
 * implementation, so routing and authorization are testable with no network.
 */
export interface Db {
  /**
   * `select ... from public.messages where id = $1 and view_limit is not
   * null`. Folds plan §4 step 2's "not found or `view_limit is null` -> same
   * refusal" into the query itself: a keep-in-chat message (`view_limit is
   * null`) reads back as null here, identical to a message that doesn't
   * exist.
   */
  getMessageMedia(messageId: string): Promise<MessageMediaRow | null>;
  /** `select private.can_read_conversation($1, $2)`. */
  canReadConversation(conversationId: string, viewerId: string): Promise<boolean>;
  /**
   * `select ... from private.open_limited_media($1, $2)` -- assumed
   * `security definer`, one transaction, row-locked (plan §4 step 4).
   * Assumed to return zero rows for every refusal reason (not the
   * recipient, already exhausted, message vanished under it) rather than
   * raising, so a plain empty result reads back as `null` here. Belt and
   * braces: a thrown error from the call itself is *also* caught and
   * treated as `null` -- the plan says "any failure -> caught as
   * notFound(), no sub-reason surfaces" (§4 step 4), so this function
   * cannot let a refusal-by-exception turn into a 500. A real outage
   * (connection loss, etc.) surfacing here as a 404 instead of a 500 is the
   * accepted cost of that generic-refusal posture; `router.ts`'s own
   * try/catch still turns a failure *above* this call (e.g. in
   * `getMessageMedia` or `canReadConversation`) into a proper 500.
   */
  openLimitedMedia(messageId: string, viewerId: string): Promise<OpenedMedia | null>;
}

// deno.land's postgres.js build ships loose types for the tagged-template
// client, so the handle is kept untyped here on purpose, exactly like
// `identity/db.ts`. The typed surface this module exposes is `Db` above.
// deno-lint-ignore no-explicit-any
type Sql = any;

let pool: Sql | undefined;

/** Lazily opened pooled client (Supavisor transaction mode). */
function sql(): Sql {
  if (!pool) {
    pool = postgres(firstEnv("MEDIA_OPEN_DB_URL", "SUPABASE_DB_URL"), {
      max: 3,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false, // transaction-mode pooler cannot keep prepared statements
      onnotice: () => {}, // never let server notices reach the log
    });
  }
  return pool;
}

/** Runs `fn` in a transaction whose role is downgraded to `service_role`. */
function asServiceRole<T>(fn: (tx: Sql) => Promise<T>): Promise<T> {
  return sql().begin(async (tx: Sql): Promise<T> => {
    await tx`set local role service_role`;
    return await fn(tx);
  }) as Promise<T>;
}

export function createDb(): Db {
  return {
    async getMessageMedia(messageId) {
      const rows = await asServiceRole<MessageMediaRow[]>((tx) =>
        tx`
          select conversation_id, sender_id, media_kind, media_path,
                 media_poster_path, view_limit, views_used
            from public.messages
           where id = ${messageId}::uuid
             and view_limit is not null
        `
      );
      return rows[0] ?? null;
    },

    async canReadConversation(conversationId, viewerId) {
      const rows = await asServiceRole<{ can_read: boolean }[]>((tx) =>
        tx`
          select private.can_read_conversation(
            ${conversationId}::uuid, ${viewerId}::uuid
          ) as can_read
        `
      );
      return rows[0]?.can_read === true;
    },

    async openLimitedMedia(messageId, viewerId) {
      try {
        const rows = await asServiceRole<OpenedMedia[]>((tx) =>
          tx`
            select media_path, media_poster_path, media_kind, views_used, view_limit, views_remaining
              from private.open_limited_media(${messageId}::uuid, ${viewerId}::uuid)
          `
        );
        return rows[0] ?? null;
      } catch {
        // See the Db interface doc above: any failure from this specific
        // call collapses to "refused", never a 500.
        return null;
      }
    },
  };
}
