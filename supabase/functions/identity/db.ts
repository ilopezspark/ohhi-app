// The only data path that touches `payload_ciphertext`.
// docs/edge-identity-plan.md §2 (reads) and §4 (writes).
//
// A direct Postgres connection, not PostgREST: `private` is not in
// config.toml's exposed `schemas`, so `supabase-js`'s `.rpc()` cannot reach
// `private.share_is_active`, `private.write_identity` or `private.write_card`
// under ANY role. A Postgres-protocol connection is the only path (plan §2).
//
// Every statement runs inside a transaction that first does
// `set local role service_role`, so the session's effective privileges are
// exactly the grants migration 0003 hands `service_role` — the connecting role
// (the platform's `postgres`) is a member of it. That makes the brief's
// constraint structural rather than a code convention: the only writes this
// function can perform are `private.write_identity` and `private.write_card`,
// because those are the only write grants `service_role` holds on this domain.
//
// Nothing here logs a row, a ciphertext, or the connection string.

import postgres from "postgres";
import { firstEnv } from "../_shared/env.ts";

export interface IdentityRow {
  is_public: boolean;
  payload_ciphertext: Uint8Array | null;
  key_version: number;
  /** private.is_blocked(user_id, caller) — symmetric, either direction blocks. */
  blocked: boolean;
}

export interface CardRow {
  payload_ciphertext: Uint8Array | null;
  key_version: number;
}

/** Public columns echoed by a PUT. Never includes plaintext or ciphertext. */
export interface WriteResult {
  key_version: number;
  fields_filled: number;
  updated_at: string;
}

/**
 * The surface the router depends on. `index_test.ts` supplies a fake
 * implementation, so routing and authorization are testable with no network.
 */
export interface Db {
  /** callerId also drives the row's `blocked` flag (private.is_blocked). */
  getIdentity(userId: string, callerId: string): Promise<IdentityRow | null>;
  getCard(userId: string): Promise<CardRow | null>;
  /** private.share_is_active(owner, viewer, 'private_card', owner) — plan §0/§2. */
  cardShareIsActive(ownerId: string, viewerId: string): Promise<boolean>;
  writeIdentity(
    userId: string,
    ciphertext: Uint8Array,
    keyVersion: number,
    fieldsFilled: number,
    isPublic: boolean,
  ): Promise<WriteResult>;
  writeCard(
    userId: string,
    ciphertext: Uint8Array,
    keyVersion: number,
    fieldsFilled: number,
  ): Promise<WriteResult>;
}

// The deno.land build of postgres.js ships loose types for the tagged-template
// client, so the handle is kept untyped here on purpose. The typed surface this
// module exposes is the `Db` interface above, which is what the router uses.
// deno-lint-ignore no-explicit-any
type Sql = any;

let pool: Sql | undefined;

/** Lazily opened pooled client (Supavisor transaction mode). */
function sql(): Sql {
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

/** Runs `fn` in a transaction whose role is downgraded to `service_role`. */
function asServiceRole<T>(fn: (tx: Sql) => Promise<T>): Promise<T> {
  return sql().begin(async (tx: Sql): Promise<T> => {
    await tx`set local role service_role`;
    return await fn(tx);
  }) as Promise<T>;
}

export function createDb(): Db {
  return {
    async getIdentity(userId, callerId) {
      const rows = await asServiceRole<IdentityRow[]>((tx) =>
        tx`
          select is_public, payload_ciphertext, key_version,
                 private.is_blocked(user_id, ${callerId}::uuid) as blocked
            from public.user_identity
           where user_id = ${userId}
        `
      );
      return rows[0] ?? null;
    },

    async getCard(userId) {
      const rows = await asServiceRole<CardRow[]>((tx) =>
        tx`
          select payload_ciphertext, key_version
            from public.user_private_card
           where user_id = ${userId}
        `
      );
      return rows[0] ?? null;
    },

    async cardShareIsActive(ownerId, viewerId) {
      const rows = await asServiceRole<{ active: boolean }[]>((tx) =>
        tx`
          select private.share_is_active(
            ${ownerId}::uuid, ${viewerId}::uuid, 'private_card', ${ownerId}::uuid
          ) as active
        `
      );
      return rows[0]?.active === true;
    },

    writeIdentity(userId, ciphertext, keyVersion, fieldsFilled, isPublic) {
      return asServiceRole<WriteResult>(async (tx: Sql) => {
        await tx`
          select private.write_identity(
            ${userId}::uuid, ${ciphertext}::bytea, ${keyVersion}::smallint,
            ${fieldsFilled}::smallint, ${isPublic}::boolean
          )
        `;
        const rows: WriteResult[] = await tx`
          select key_version, fields_filled, updated_at
            from public.user_identity
           where user_id = ${userId}
        `;
        return rows[0];
      });
    },

    writeCard(userId, ciphertext, keyVersion, fieldsFilled) {
      return asServiceRole<WriteResult>(async (tx: Sql) => {
        await tx`
          select private.write_card(
            ${userId}::uuid, ${ciphertext}::bytea, ${keyVersion}::smallint,
            ${fieldsFilled}::smallint
          )
        `;
        const rows: WriteResult[] = await tx`
          select key_version, fields_filled, updated_at
            from public.user_private_card
           where user_id = ${userId}
        `;
        return rows[0];
      });
    },
  };
}
