// In-memory fakes shared by this directory's Deno tests. No network, no real
// Postgres/Supabase client -- every test in drain_test.ts, scrub_test.ts, and
// index_test.ts builds its scenario by seeding these and asserting on their
// resulting state.

import type { DbClient, PurgeQueueRow, PurgeRunPatch, ScrubCandidate } from "./db.ts";
import type { StorageClient, StorageError } from "./drain.ts";
import type { AdminClient, AdminUser } from "./scrub.ts";

export interface FakeQueueRow extends PurgeQueueRow {
  attempts: number;
  processed_at: Date | null;
  last_error: string | null;
  next_attempt_at: Date | null;
}

export interface FakePurgeRun extends PurgeRunPatch {
  id: string;
  started_at: Date;
}

/**
 * Mirrors the pieces of `private.storage_purge_queue` / `private.purge_runs`
 * / `public.users_private` that `DbClient` reads and writes, entirely in
 * memory. `claimPurgeBatch` is intentionally simple (no leasing semantics
 * beyond what the tests need) -- the real leasing/backoff query lives in SQL
 * (migration 20260918000003_edge_support.sql) and is out of scope for a Deno
 * unit test.
 */
export class FakeDb implements DbClient {
  queue = new Map<string, FakeQueueRow>();
  runs = new Map<string, FakePurgeRun>();
  cohort: ScrubCandidate[] = [];
  closed = false;
  private nextId = 1;

  seedQueueRow(row: Partial<FakeQueueRow> & { bucket_id: string; object_name: string }): FakeQueueRow {
    const full: FakeQueueRow = {
      id: row.id ?? `queue-${this.nextId++}`,
      bucket_id: row.bucket_id,
      object_name: row.object_name,
      attempts: row.attempts ?? 1,
      processed_at: row.processed_at ?? null,
      last_error: row.last_error ?? null,
      next_attempt_at: row.next_attempt_at ?? null,
    };
    this.queue.set(full.id, full);
    return full;
  }

  async claimPurgeBatch(limit: number): Promise<PurgeQueueRow[]> {
    const eligible = [...this.queue.values()]
      .filter((r) => r.processed_at === null)
      .slice(0, limit);
    for (const row of eligible) row.attempts += 1;
    return eligible.map((r) => ({ id: r.id, bucket_id: r.bucket_id, object_name: r.object_name }));
  }

  async markProcessed(id: string): Promise<void> {
    const row = this.queue.get(id);
    if (!row) throw new Error(`FakeDb.markProcessed: unknown id ${id}`);
    row.processed_at = new Date();
    row.last_error = null;
  }

  async markFailed(
    id: string,
    lastError: string,
    computeNextAttemptAt: (attempts: number) => Date,
  ): Promise<{ attempts: number }> {
    const row = this.queue.get(id);
    if (!row) throw new Error(`FakeDb.markFailed: unknown id ${id}`);
    row.last_error = lastError;
    row.next_attempt_at = computeNextAttemptAt(row.attempts);
    return { attempts: row.attempts };
  }

  async purgedNotYetScrubbedCohort(): Promise<ScrubCandidate[]> {
    return this.cohort;
  }

  async startPurgeRun(startedAt: Date): Promise<string> {
    const id = `run-${this.nextId++}`;
    this.runs.set(id, {
      id,
      started_at: startedAt,
      finished_at: null as unknown as Date,
      claimed: 0,
      drained_ok: 0,
      drained_failed: 0,
      dead_lettered: 0,
      auth_scrubbed: 0,
      error: null,
    });
    return id;
  }

  async finishPurgeRun(id: string, patch: PurgeRunPatch): Promise<void> {
    const run = this.runs.get(id);
    if (!run) throw new Error(`FakeDb.finishPurgeRun: unknown id ${id}`);
    Object.assign(run, patch);
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

type RemoveOutcome = { error: StorageError | null };

/**
 * Storage double: `remove()` looks up a per-(bucket, path) scripted outcome,
 * defaulting to success. `calls` records every invocation so tests can
 * assert grouping (one call per bucket) without inspecting internals.
 */
export class FakeStorage implements StorageClient {
  calls: Array<{ bucket: string; paths: string[] }> = [];
  private outcomes = new Map<string, RemoveOutcome>();

  /** Script the outcome for a `remove()` call whose paths exactly match `paths`. */
  script(bucket: string, paths: string[], outcome: RemoveOutcome) {
    this.outcomes.set(this.key(bucket, paths), outcome);
  }

  private key(bucket: string, paths: string[]): string {
    return `${bucket}::${[...paths].sort().join(",")}`;
  }

  from(bucket: string) {
    return {
      remove: async (paths: string[]) => {
        this.calls.push({ bucket, paths });
        const scripted = this.outcomes.get(this.key(bucket, paths));
        return scripted ?? { error: null };
      },
    };
  }
}

/** Admin API double for the auth-scrub step. Never actually deletes anything. */
export class FakeAdmin implements AdminClient {
  users = new Map<string, AdminUser>();
  updateCalls: Array<{ uid: string; attrs: Record<string, unknown> }> = [];
  deleteCalls: string[] = [];
  private getErrors = new Map<string, string>();
  private updateErrors = new Map<string, string>();

  seedUser(user: AdminUser) {
    this.users.set(user.id, user);
  }

  scriptGetError(uid: string, message: string) {
    this.getErrors.set(uid, message);
  }

  scriptUpdateError(uid: string, message: string) {
    this.updateErrors.set(uid, message);
  }

  async getUserById(uid: string) {
    const errorMessage = this.getErrors.get(uid);
    if (errorMessage) return { data: null, error: { message: errorMessage } };
    const user = this.users.get(uid) ?? null;
    return { data: { user }, error: null };
  }

  async updateUserById(
    uid: string,
    attrs: {
      email: string;
      phone: string;
      user_metadata: Record<string, never>;
      app_metadata: Record<string, never>;
      ban_duration: string;
    },
  ) {
    this.updateCalls.push({ uid, attrs });
    const errorMessage = this.updateErrors.get(uid);
    if (errorMessage) return { data: null, error: { message: errorMessage } };
    const existing = this.users.get(uid);
    if (existing) {
      existing.email = attrs.email;
      existing.phone = attrs.phone;
      existing.banned_until = "2999-01-01T00:00:00.000Z";
    }
    return { data: { user: existing ?? null }, error: null };
  }

  /** Exists only so a test can assert it is never called (decision 31: never delete the row). */
  async deleteUser(uid: string) {
    this.deleteCalls.push(uid);
    return { data: null, error: null };
  }
}
