// Direct Postgres connection to reach the `private` schema
// (docs/edge-purge-plan.md §2/§4).
//
// `private` is not in config.toml's exposed `schemas`, so PostgREST -- and
// therefore `serviceClient()` from `_shared/supabase.ts` -- can never reach
// `private.claim_purge_batch()`, `private.purge_runs`, or the write-back
// columns on `private.storage_purge_queue`. See
// `supabase/functions/_shared/README.md`'s note under `supabase.ts`: a
// function that needs `private.*` "must open its own Postgres connection --
// see identity/db.ts for the pattern (postgres.js over the pooler, `set
// local role service_role`)".
//
// Deviation to note: `identity/db.ts` does not exist yet at the time this was
// written (the identity function isn't scaffolded), so this file is a fresh
// implementation of the pattern the README describes, not a copy of it. It
// lives here rather than in `_shared/` because this repo's `_shared/` is
// explicitly scoped to helpers every function needs (env/http/two Supabase
// clients) and this purge-drain-specific connection (claim/write-back/
// purge_runs queries) doesn't fit that contract without a broader
// cross-function design pass. If `identity/db.ts` lands with a matching
// shape later, this can be replaced with a shared import per that README's
// own rule ("change a signature only by changing every caller in the same
// pass").

import postgres, { type Sql, type TransactionSql } from "postgres";
import { firstEnv } from "../_shared/env.ts";

export interface PurgeQueueRow {
  id: string;
  bucket_id: string;
  object_name: string;
}

export interface PurgeRunPatch {
  finished_at: Date;
  claimed: number;
  drained_ok: number;
  drained_failed: number;
  dead_lettered: number;
  auth_scrubbed: number;
  error: string | null;
}

export interface ScrubCandidate {
  user_id: string;
  /**
   * Carried through even though the SQL query already filters on it, so
   * `scrub.ts` can re-assert "never touch a user whose deleted_at is null"
   * itself -- the same defense-in-depth style migration 0003 uses elsewhere
   * (e.g. `apply_verification_result`'s explicit denylist re-check).
   */
  deleted_at: string | null;
}

export interface DbClient {
  /** `private.claim_purge_batch(p_limit)` -- leases up to `limit` rows. */
  claimPurgeBatch(limit: number): Promise<PurgeQueueRow[]>;
  /** Idempotent: safe to call again for an already-processed row. */
  markProcessed(id: string): Promise<void>;
  /**
   * Reads the row's current `attempts` (already incremented by the claim)
   * inside the same transaction as the write, then writes `last_error` and
   * whatever `computeNextAttemptAt(attempts)` returns. Returns `attempts` so
   * the caller can tell whether this write just dead-lettered the row.
   */
  markFailed(
    id: string,
    lastError: string,
    computeNextAttemptAt: (attempts: number) => Date,
  ): Promise<{ attempts: number }>;
  /**
   * Users eligible for the auth scrub: `purged_at` set (decision 30/31) and,
   * defensively, `deleted_at` set too -- the function must never touch a
   * user whose `deleted_at` is null, and `purge_user()` only ever sets
   * `purged_at` after `deleted_at` already holds, but the query re-asserts
   * it rather than trusting that invariant silently.
   */
  purgedNotYetScrubbedCohort(): Promise<ScrubCandidate[]>;
  /** Inserts the one `private.purge_runs` row for this invocation, returns its id. */
  startPurgeRun(startedAt: Date): Promise<string>;
  /** Fills in the rest of that row once the run finishes (success or not). */
  finishPurgeRun(id: string, patch: PurgeRunPatch): Promise<void>;
  close(): Promise<void>;
}

/**
 * Opens the direct connection. `PURGE_DRAIN_DB_URL` overrides the shared
 * `SUPABASE_DB_URL` if both are set, matching the fallback pattern
 * `_shared/env.ts`'s `firstEnv` doc comment names as the convention
 * (`IDENTITY_DB_URL` then `SUPABASE_DB_URL` there; `PURGE_DRAIN_DB_URL` here).
 */
export function createDbClient(): DbClient {
  const url = firstEnv("PURGE_DRAIN_DB_URL", "SUPABASE_DB_URL");
  const sql = postgres(url, { prepare: false, max: 1 });
  return wrapSql(sql);
}

/**
 * Builds a `DbClient` around an already-open `postgres.js` `Sql` instance.
 * Split out from `createDbClient()` so a future integration test could point
 * this at a real (test) database without going through env vars; the unit
 * tests in this directory (`drain_test.ts`, `scrub_test.ts`, `index_test.ts`)
 * use hand-written fakes of `DbClient` instead and never call this.
 */
export function wrapSql(sql: Sql): DbClient {
  async function withServiceRole<T>(fn: (tx: TransactionSql<Record<string, never>>) => Promise<T>): Promise<T> {
    // The pooler connection is not `service_role` by default; every RPC/table
    // this file touches is granted to `service_role` only (migration 0003),
    // so each statement runs inside a transaction that elevates to it first,
    // matching the pattern _shared/README.md describes.
    //
    // The `as unknown as T` below works around a postgres.js typings quirk:
    // `Sql.begin()`'s declared return type (`UnwrapPromiseArray<T>`) doesn't
    // unify with a plain generic `T` for a callback like this one, even
    // though the runtime behavior (resolve with whatever the callback
    // returns) is exactly `T`.
    const result = await sql.begin(async (tx) => {
      await tx`set local role service_role`;
      return await fn(tx);
    });
    return result as unknown as T;
  }

  return {
    async claimPurgeBatch(limit) {
      return await withServiceRole(async (tx) => {
        const rows = await tx<PurgeQueueRow[]>`
          select id, bucket_id, object_name
            from private.claim_purge_batch(${limit})
        `;
        return rows.map((r) => ({ id: r.id, bucket_id: r.bucket_id, object_name: r.object_name }));
      });
    },

    async markProcessed(id) {
      await withServiceRole(async (tx) => {
        await tx`
          update private.storage_purge_queue
             set processed_at = now(), last_error = null
           where id = ${id}
        `;
      });
    },

    async markFailed(id, lastError, computeNextAttemptAt) {
      return await withServiceRole(async (tx) => {
        const [current] = await tx<{ attempts: number }[]>`
          select attempts from private.storage_purge_queue where id = ${id} for update
        `;
        const attempts = current?.attempts ?? 0;
        const nextAttemptAt = computeNextAttemptAt(attempts);
        await tx`
          update private.storage_purge_queue
             set last_error = ${lastError}, next_attempt_at = ${nextAttemptAt}
           where id = ${id}
        `;
        return { attempts };
      });
    },

    async purgedNotYetScrubbedCohort() {
      return await withServiceRole(async (tx) => {
        return await tx<ScrubCandidate[]>`
          select user_id, deleted_at
            from public.users_private
           where purged_at is not null
             and deleted_at is not null
        `;
      });
    },

    async startPurgeRun(startedAt) {
      return await withServiceRole(async (tx) => {
        const [row] = await tx<{ id: string }[]>`
          insert into private.purge_runs (started_at) values (${startedAt}) returning id
        `;
        return row.id;
      });
    },

    async finishPurgeRun(id, patch) {
      await withServiceRole(async (tx) => {
        await tx`
          update private.purge_runs
             set finished_at = ${patch.finished_at},
                 claimed = ${patch.claimed},
                 drained_ok = ${patch.drained_ok},
                 drained_failed = ${patch.drained_failed},
                 dead_lettered = ${patch.dead_lettered},
                 auth_scrubbed = ${patch.auth_scrubbed},
                 error = ${patch.error}
           where id = ${id}
        `;
      });
    },

    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}
