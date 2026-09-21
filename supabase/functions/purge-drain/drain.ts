// Group-by-bucket Storage drain for one already-claimed batch
// (docs/edge-purge-plan.md §2). The storage client is injected so
// `drain_test.ts` never touches the network.

import { isDeadLettered, nextAttemptAt } from "./backoff.ts";
import type { DbClient, PurgeQueueRow } from "./db.ts";

export interface StorageError {
  message: string;
  status?: number;
}

export interface StorageRemoveResult {
  error: StorageError | null;
}

/**
 * Structurally matches supabase-js's `SupabaseClient['storage']` for
 * `.from(bucket).remove(paths)`, narrowed to only what this file calls.
 */
export interface StorageClient {
  from(bucket: string): {
    remove(paths: string[]): Promise<StorageRemoveResult>;
  };
}

export interface DrainBatchResult {
  claimed: number;
  processed: number;
  failed: number;
  deadLettered: number;
}

/**
 * Storage's "the object is already gone" signal -- treated as success
 * (docs/edge-purge-plan.md §2: "Object not found: treat as success -- the
 * goal state (object gone) already holds"). Matched loosely on shape because
 * the exact error the Storage API surfaces for a missing key isn't pinned
 * down by the design note.
 */
export function isNotFoundError(error: StorageError | null | undefined): boolean {
  if (!error) return false;
  if (error.status === 404) return true;
  const message = (error.message ?? "").toLowerCase();
  return (
    message.includes("not found") ||
    message.includes("not_found") ||
    message.includes("does not exist")
  );
}

export function groupByBucket(rows: PurgeQueueRow[]): Map<string, PurgeQueueRow[]> {
  const groups = new Map<string, PurgeQueueRow[]>();
  for (const row of rows) {
    const list = groups.get(row.bucket_id);
    if (list) {
      list.push(row);
    } else {
      groups.set(row.bucket_id, [row]);
    }
  }
  return groups;
}

/**
 * Drains exactly the rows passed in -- never claims a fresh batch itself.
 * `index.ts` owns the claim/loop/time-budget; this stays a pure "given
 * already-leased rows, drain them and write back the outcome" step, which is
 * what `drain_test.ts` exercises directly.
 *
 * Every branch is idempotent and safe to re-run: `markProcessed` on an
 * already-processed id is a harmless overwrite, and a retried "not found"
 * still just marks processed.
 */
export async function drainBatch(
  db: DbClient,
  storage: StorageClient,
  rows: PurgeQueueRow[],
  now: () => Date = () => new Date(),
): Promise<DrainBatchResult> {
  let processed = 0;
  let failed = 0;
  let deadLettered = 0;

  for (const [bucket, bucketRows] of groupByBucket(rows)) {
    const paths = bucketRows.map((row) => row.object_name);
    const { error } = await storage.from(bucket).remove(paths);

    if (!error || isNotFoundError(error)) {
      for (const row of bucketRows) {
        await db.markProcessed(row.id);
        processed++;
      }
      continue;
    }

    // The whole-bucket call failed for a reason other than "not found" --
    // isolate object-by-object so one bad key doesn't block write-back for
    // the rest of the bucket's batch.
    for (const row of bucketRows) {
      const single = await storage.from(bucket).remove([row.object_name]);
      if (!single.error || isNotFoundError(single.error)) {
        await db.markProcessed(row.id);
        processed++;
        continue;
      }

      const { attempts } = await db.markFailed(
        row.id,
        single.error.message,
        (attemptsAtWrite) => nextAttemptAt(attemptsAtWrite, now),
      );
      failed++;
      if (isDeadLettered(attempts)) deadLettered++;
    }
  }

  return { claimed: rows.length, processed, failed, deadLettered };
}
