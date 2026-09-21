// purge-drain edge function (docs/edge-purge-plan.md).
//
// Invoked only by `private.invoke_purge_drain()` via pg_net (migration
// 20260918000003_edge_support.sql §3), which posts an empty JSON body and
// carries the shared secret in the `x-purge-drain-secret` header. That
// header, compared in constant time against this function's own
// `PURGE_DRAIN_SECRET` secret, is the sole authentication -- checked before
// any query runs. `verify_jwt = false` for this function in
// supabase/config.toml, because the caller is Postgres/pg_net, never a
// Supabase user with a JWT.
//
// The function takes no request parameters (docs/edge-purge-plan.md §4): the
// batch and the auth-scrub cohort are always chosen server-side from
// `storage_purge_queue` / `users_private.purged_at`, never from anything in
// the request.

import { apiError, internalError, json } from "../_shared/http.ts";
import { requiredEnv } from "../_shared/env.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { createDbClient, type DbClient } from "./db.ts";
import { drainBatch, type StorageClient } from "./drain.ts";
import { scrubPurgedUsers, type AdminClient } from "./scrub.ts";

const SECRET_HEADER = "x-purge-drain-secret";
const BATCH_SIZE = 200;
const TIME_BUDGET_MS = 45_000;

/**
 * SHA-256 both sides before comparing so the result is constant-time
 * regardless of the provided header's length or how much of a prefix it
 * shares with the real secret -- a byte-wise compare over the raw strings
 * (even a "constant time" loop with a length check up front) leaks length,
 * and JS's `===` short-circuits on the first mismatched byte.
 */
export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [da, dbBytes] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const va = new Uint8Array(da);
  const vb = new Uint8Array(dbBytes);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

export interface Deps {
  db: DbClient;
  storage: StorageClient;
  admin: AdminClient;
  now: () => Date;
  timeBudgetMs: number;
  batchSize: number;
}

export interface RunSummary {
  claimed: number;
  drainedOk: number;
  drainedFailed: number;
  deadLettered: number;
  authScrubbed: number;
  error: string | null;
}

/**
 * The whole run: loop batches until `claim_purge_batch()` returns empty or
 * the time budget is spent, then the auth-scrub pass, then one
 * `private.purge_runs` row. A backlog bigger than the time budget drains
 * over successive nightly invocations rather than in one call
 * (docs/edge-purge-plan.md's build note).
 *
 * Every step is safe to re-run: claiming leases via `attempts`/
 * `next_attempt_at` rather than deleting, "not found" is a no-op success,
 * and the scrub step is deterministic per uid (§6).
 */
export async function runPurgeDrain(deps: Deps): Promise<RunSummary> {
  const { db, storage, admin, now, timeBudgetMs, batchSize } = deps;
  const startedAt = now();
  const runId = await db.startPurgeRun(startedAt);

  let claimed = 0;
  let drainedOk = 0;
  let drainedFailed = 0;
  let deadLettered = 0;
  let authScrubbed = 0;
  let runError: string | null = null;

  try {
    const deadline = now().getTime() + timeBudgetMs;
    for (;;) {
      const batch = await db.claimPurgeBatch(batchSize);
      if (batch.length === 0) break;
      claimed += batch.length;

      const result = await drainBatch(db, storage, batch, now);
      drainedOk += result.processed;
      drainedFailed += result.failed;
      deadLettered += result.deadLettered;

      if (now().getTime() >= deadline) break;
    }

    const scrubResult = await scrubPurgedUsers(db, admin);
    authScrubbed = scrubResult.scrubbed;
    if (scrubResult.errors.length > 0) {
      runError = `auth-scrub: ${scrubResult.errors.length} error(s)`;
    }
  } catch (err) {
    runError = err instanceof Error ? err.message : String(err);
  } finally {
    await db.finishPurgeRun(runId, {
      finished_at: now(),
      claimed,
      drained_ok: drainedOk,
      drained_failed: drainedFailed,
      dead_lettered: deadLettered,
      auth_scrubbed: authScrubbed,
      error: runError,
    });
  }

  // Counts only, never an object path or bucket name -- both embed a purged
  // user's id as their first path segment (purge_user()'s enqueue query in
  // migration 20260918000002_core_schema.sql), which must not appear at info
  // level.
  console.log(JSON.stringify({
    msg: "purge-drain run complete",
    claimed,
    drainedOk,
    drainedFailed,
    deadLettered,
    authScrubbed,
    error: runError,
  }));

  return { claimed, drainedOk, drainedFailed, deadLettered, authScrubbed, error: runError };
}

function buildProdDeps(): Deps {
  const client = serviceClient();
  return {
    db: createDbClient(),
    storage: client.storage as unknown as StorageClient,
    admin: client.auth.admin as unknown as AdminClient,
    now: () => new Date(),
    timeBudgetMs: TIME_BUDGET_MS,
    batchSize: BATCH_SIZE,
  };
}

/**
 * `buildDeps` is injectable so `index_test.ts` can exercise the secret-header
 * gate and the run-summary plumbing with fakes, never touching the network
 * or the real env vars.
 */
export async function handleRequest(
  req: Request,
  buildDeps: () => Deps = buildProdDeps,
): Promise<Response> {
  let expectedSecret: string;
  try {
    expectedSecret = requiredEnv("PURGE_DRAIN_SECRET");
  } catch {
    // Misconfigured deploy (the secret was never set), not a caller
    // problem -- distinct from "wrong/missing header", which is 401 below.
    return internalError();
  }

  const provided = req.headers.get(SECRET_HEADER);
  const authorized = provided !== null && (await timingSafeEqual(provided, expectedSecret));
  if (!authorized) {
    // Generic on purpose: a missing header and a wrong header get the same
    // response, with no body detail beyond "unauthenticated" (docs/edge-purge-plan.md §4).
    return apiError("unauthenticated", "A valid invocation secret is required.", 401);
  }

  let deps: Deps;
  try {
    deps = buildDeps();
  } catch {
    return internalError();
  }

  try {
    const summary = await runPurgeDrain(deps);
    return json(summary, summary.error ? 500 : 200);
  } catch {
    return internalError();
  } finally {
    await deps.db.close();
  }
}

// Guarded so importing this module from a test (index_test.ts) never opens a
// real listener -- Deno.serve only runs when this file is executed directly,
// which is how the edge runtime invokes it.
if (import.meta.main) {
  Deno.serve((req) => handleRequest(req));
}
