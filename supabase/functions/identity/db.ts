// The only data path that touches `payload_ciphertext`.
// docs/edge-identity-plan.md §2 (reads) and §4 (writes); payload v2 per
// docs/design/profile-restructure/reconcile.md C1-C3, C6 and migration 0023.
//
// A direct Postgres connection, not PostgREST: `private` is not in
// config.toml's exposed `schemas`, so `supabase-js`'s `.rpc()` cannot reach
// `private.share_is_active`, `private.write_identity` or `private.write_card`
// under ANY role. A Postgres-protocol connection is the only path (plan §2).
//
// Every statement runs inside a transaction that first does
// `set local role service_role`, so the session's effective privileges are
// exactly the grants `service_role` holds. Ciphertext is still only ever
// written by `private.write_identity` / `private.write_card` (one statement
// each, so ciphertext, key_version and fields_filled never split). Payload v2
// adds one plaintext follow-up UPDATE in the same transaction for the columns
// those RPCs do not know about (`payload_version`, and the four audiences on
// `user_identity`, migration 0023). That UPDATE relies on `service_role`'s
// table privileges on the two tables (the platform default; 0002 only revokes
// from anon and authenticated).
//
// `is_public` is never set directly: 0023's trigger `user_identity_audience_sync`
// keeps it equal to `identity_audience = 'everyone'`, and whichever of the two
// a statement changes wins. The RPC gets the stored is_public back on an
// existing row (no change), and the audience UPDATE then drives it.
//
// Nothing here logs a row, a ciphertext, a typed entry, or the connection string.

import postgres from "postgres";
import { firstEnv } from "../_shared/env.ts";
import type { Audience, Audiences } from "./fields.ts";
import { DIRTY_TEXT_MESSAGE, ValidationError } from "./validate.ts";

/** What the owner's own row holds, as read under the write lock. */
export interface StoredIdentity {
  is_public: boolean;
  payload_ciphertext: Uint8Array | null;
  key_version: number;
  /** 1 = v1 (`{pronouns, orientation}`), 2 = v2. Migration 0023. */
  payload_version: number;
  audiences: Audiences;
}

export interface IdentityRow extends StoredIdentity {
  /**
   * private.is_blocked(user_id, caller) — symmetric, either direction blocks —
   * OR the row's owner is not visible (migration 0014, decision 90:
   * private.is_visible_user is false for a suspended, banned or deleted
   * account), OR the caller is not a verified adult (migration 0021, decision
   * 97: private.is_verified_adult; nobody sees anyone before verification).
   * Either way the router refuses a non-owner with the same 404; the owner's
   * own read never consults this flag.
   */
  blocked: boolean;
  /**
   * private.profile_gate_open(owner, caller) (0015): the pair's conversation
   * is open. Admits an `after_hi` card. Only evaluated when some card is
   * `after_hi` and the caller is not the owner; false otherwise.
   */
  gate_open: boolean;
}

export interface CardRow {
  payload_ciphertext: Uint8Array | null;
  key_version: number;
  payload_version: number;
}

/** Public columns echoed by a PUT. Never includes plaintext or ciphertext. */
export interface WriteResult {
  key_version: number;
  fields_filled: number;
  updated_at: string;
}

export interface IdentityWrite {
  ciphertext: Uint8Array;
  keyVersion: number;
  fieldsFilled: number;
  /**
   * Passed to `private.write_identity`, which always sets `is_public`. Callers
   * pass the STORED value for an existing row, so the RPC changes nothing
   * there and the trigger `user_identity_audience_sync` (0023) derives
   * `is_public` from the `identity_audience` update that follows. For a new
   * row, the value `audiences.identity` implies (`everyone` -> true).
   */
  isPublic: boolean;
  /** The four audience columns; `identity_audience` is what drives is_public. */
  audiences: Audiences;
}

export interface CardWrite {
  ciphertext: Uint8Array;
  keyVersion: number;
  fieldsFilled: number;
}

/** Helpers bound to the write transaction, handed to the router's builder. */
export interface TxTools {
  /**
   * The 0018 word filter: `private.text_is_clean` over each text, inside the
   * write transaction. Throws ValidationError(DIRTY_TEXT_MESSAGE) on the first
   * dirty one; the message never names the text or the term.
   */
  assertClean(texts: readonly string[]): Promise<void>;
}

/**
 * The surface the router depends on. `index_test.ts` supplies a fake
 * implementation, so routing and authorization are testable with no network.
 */
export interface Db {
  /** callerId drives the row's `blocked` and `gate_open` flags. */
  getIdentity(userId: string, callerId: string): Promise<IdentityRow | null>;
  getCard(userId: string): Promise<CardRow | null>;
  /**
   * private.card_share_sections(owner, viewer) (0023): the gated sections the
   * active card share ticked, `[]` for none, or null when there is no active
   * share (it folds in private.share_is_active: revoked, blocked, hidden
   * owner, unverified reader all give null).
   */
  cardShareSections(ownerId: string, viewerId: string): Promise<string[] | null>;
  /**
   * Read-modify-write of the owner's identity row under `select … for update`.
   * `build` gets the current row (null if never written) and the transaction's
   * tools, and returns what to write; a throw rolls the transaction back.
   */
  updateIdentity(
    userId: string,
    build: (current: StoredIdentity | null, tools: TxTools) => Promise<IdentityWrite>,
  ): Promise<WriteResult>;
  /** Same, for the private card. */
  updateCard(
    userId: string,
    build: (current: CardRow | null, tools: TxTools) => Promise<CardWrite>,
  ): Promise<WriteResult>;
}

// The deno.land build of postgres.js ships loose types for the tagged-template
// client, so the handle is kept untyped here on purpose. The typed surface this
// module exposes is the `Db` interface above, which is what the router uses.
// deno-lint-ignore no-explicit-any
export type Sql = any;

let pool: Sql | undefined;

/** Lazily opened pooled client (Supavisor transaction mode). */
export function sql(): Sql {
  if (!pool) {
    pool = postgres(firstEnv("IDENTITY_DB_URL", "SUPABASE_DB_URL"), {
      max: 3,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false, // transaction-mode pooler cannot keep prepared statements
      onnotice: () => {}, // never let server notices reach the log
    });
  }
  return pool;
}

/** Closes the pool. Only the one-off scripts (backfill_v2.ts) call this. */
export async function closePool(): Promise<void> {
  if (pool) {
    const p = pool;
    pool = undefined;
    await p.end({ timeout: 5 });
  }
}

/** Runs `fn` in a transaction whose role is downgraded to `service_role`. */
export function asServiceRole<T>(fn: (tx: Sql) => Promise<T>): Promise<T> {
  return sql().begin(async (tx: Sql): Promise<T> => {
    await tx`set local role service_role`;
    return await fn(tx);
  }) as Promise<T>;
}

/** `private.text_is_clean` over each text, stopping at the first dirty one. */
export async function assertCleanTx(tx: Sql, texts: readonly string[]): Promise<void> {
  for (const text of texts) {
    const rows: { clean: boolean }[] = await tx`
      select private.text_is_clean(${text}::text) as clean
    `;
    if (rows[0]?.clean !== true) throw new ValidationError(DIRTY_TEXT_MESSAGE);
  }
}

/**
 * A `text[]` result as a JS array. postgres.js normally parses arrays itself;
 * this also accepts the raw `{a,b}` literal in case type fetching is off
 * behind the pooler. Section names are bare identifiers, so no quoting.
 * null stays null (no active share).
 */
export function parseTextArray(value: unknown): string[] | null {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (typeof value === "string" && value.startsWith("{") && value.endsWith("}")) {
    const body = value.slice(1, -1).trim();
    return body.length === 0
      ? []
      : body.split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
  }
  return null;
}

interface RawIdentityRow {
  is_public: boolean;
  payload_ciphertext: Uint8Array | null;
  key_version: number;
  payload_version: number;
  identity_audience: string;
  background_audience: string;
  lifestyle_audience: string;
  around_audience: string;
  blocked?: boolean;
  gate_open?: boolean;
}

export function toStoredIdentity(raw: RawIdentityRow): StoredIdentity {
  return {
    is_public: raw.is_public,
    payload_ciphertext: raw.payload_ciphertext,
    key_version: raw.key_version,
    payload_version: raw.payload_version,
    audiences: {
      identity: raw.identity_audience as Audience,
      background: raw.background_audience as Audience,
      lifestyle: raw.lifestyle_audience as Audience,
      around: raw.around_audience as Audience,
    },
  };
}

/** Writes an identity payload v2 and its plaintext columns, in the caller's transaction. */
export async function writeIdentityTx(
  tx: Sql,
  userId: string,
  w: IdentityWrite,
): Promise<WriteResult> {
  await tx`
    select private.write_identity(
      ${userId}::uuid, ${w.ciphertext}::bytea, ${w.keyVersion}::smallint,
      ${w.fieldsFilled}::smallint, ${w.isPublic}::boolean
    )
  `;
  await tx`
    update public.user_identity
       set payload_version     = 2,
           identity_audience   = ${w.audiences.identity}::public.profile_audience,
           background_audience = ${w.audiences.background}::public.profile_audience,
           lifestyle_audience  = ${w.audiences.lifestyle}::public.profile_audience,
           around_audience     = ${w.audiences.around}::public.profile_audience
     where user_id = ${userId}::uuid
  `;
  const rows: WriteResult[] = await tx`
    select key_version, fields_filled, updated_at
      from public.user_identity
     where user_id = ${userId}::uuid
  `;
  return rows[0];
}

/** Writes a card payload v2, in the caller's transaction. */
export async function writeCardTx(
  tx: Sql,
  userId: string,
  w: CardWrite,
): Promise<WriteResult> {
  await tx`
    select private.write_card(
      ${userId}::uuid, ${w.ciphertext}::bytea, ${w.keyVersion}::smallint,
      ${w.fieldsFilled}::smallint
    )
  `;
  await tx`
    update public.user_private_card
       set payload_version = 2
     where user_id = ${userId}::uuid
  `;
  const rows: WriteResult[] = await tx`
    select key_version, fields_filled, updated_at
      from public.user_private_card
     where user_id = ${userId}::uuid
  `;
  return rows[0];
}

/** The owner's identity row under a row lock, or null. */
export async function lockIdentityTx(
  tx: Sql,
  userId: string,
): Promise<StoredIdentity | null> {
  const rows: RawIdentityRow[] = await tx`
    select is_public, payload_ciphertext, key_version, payload_version,
           identity_audience::text   as identity_audience,
           background_audience::text as background_audience,
           lifestyle_audience::text  as lifestyle_audience,
           around_audience::text     as around_audience
      from public.user_identity
     where user_id = ${userId}::uuid
       for update
  `;
  return rows[0] ? toStoredIdentity(rows[0]) : null;
}

/** The owner's card row under a row lock, or null. */
export async function lockCardTx(tx: Sql, userId: string): Promise<CardRow | null> {
  const rows: CardRow[] = await tx`
    select payload_ciphertext, key_version, payload_version
      from public.user_private_card
     where user_id = ${userId}::uuid
       for update
  `;
  return rows[0] ?? null;
}

export function createDb(): Db {
  return {
    async getIdentity(userId, callerId) {
      const rows = await asServiceRole<RawIdentityRow[]>((tx) =>
        tx`
          select is_public, payload_ciphertext, key_version, payload_version,
                 identity_audience::text   as identity_audience,
                 background_audience::text as background_audience,
                 lifestyle_audience::text  as lifestyle_audience,
                 around_audience::text     as around_audience,
                 (private.is_blocked(user_id, ${callerId}::uuid)
                  or not private.is_visible_user(user_id)
                  or not private.is_verified_adult(${callerId}::uuid)) as blocked,
                 (case
                    when user_id = ${callerId}::uuid then false
                    when 'after_hi'::public.profile_audience in
                         (identity_audience, background_audience,
                          lifestyle_audience, around_audience)
                      then private.profile_gate_open(user_id, ${callerId}::uuid)
                    else false
                  end) as gate_open
            from public.user_identity
           where user_id = ${userId}::uuid
        `
      );
      const raw = rows[0];
      if (!raw) return null;
      return {
        ...toStoredIdentity(raw),
        blocked: raw.blocked === true,
        gate_open: raw.gate_open === true,
      };
    },

    async getCard(userId) {
      const rows = await asServiceRole<CardRow[]>((tx) =>
        tx`
          select payload_ciphertext, key_version, payload_version
            from public.user_private_card
           where user_id = ${userId}::uuid
        `
      );
      return rows[0] ?? null;
    },

    async cardShareSections(ownerId, viewerId) {
      const rows = await asServiceRole<{ sections: string[] | null }[]>((tx) =>
        tx`
          select private.card_share_sections(${ownerId}::uuid, ${viewerId}::uuid) as sections
        `
      );
      return parseTextArray(rows[0]?.sections);
    },

    updateIdentity(userId, build) {
      return asServiceRole<WriteResult>(async (tx: Sql) => {
        const current = await lockIdentityTx(tx, userId);
        const write = await build(current, {
          assertClean: (texts) => assertCleanTx(tx, texts),
        });
        return await writeIdentityTx(tx, userId, write);
      });
    },

    updateCard(userId, build) {
      return asServiceRole<WriteResult>(async (tx: Sql) => {
        const current = await lockCardTx(tx, userId);
        const write = await build(current, {
          assertClean: (texts) => assertCleanTx(tx, texts),
        });
        return await writeCardTx(tx, userId, write);
      });
    },
  };
}
