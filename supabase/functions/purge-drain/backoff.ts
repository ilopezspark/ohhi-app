// Pure backoff math for the storage_purge_queue write-back
// (docs/edge-purge-plan.md §2). No I/O and no implicit `Date.now()` -- every
// caller passes a clock in, so every branch here is deterministic under test.

/**
 * Matches claim_purge_batch()'s own `attempts < 5` predicate (migration
 * 20260918000003_edge_support.sql): once a row's `attempts` column reaches
 * this value, the next claim query no longer selects it. That *is* the
 * dead-letter state -- no separate flag on the row, per the design note.
 */
export const DEAD_LETTER_THRESHOLD = 5;

const BACKOFF_BASE_MINUTES = 1;
const BACKOFF_CAP_MINUTES = 60;

/**
 * `2 ^ attempts` minutes, capped around an hour
 * (docs/edge-purge-plan.md §2: "next_attempt_at with backoff ... capped
 * around an hour").
 */
export function backoffMinutes(attempts: number): number {
  if (!Number.isInteger(attempts) || attempts < 0) {
    throw new RangeError(`attempts must be a non-negative integer, got ${attempts}`);
  }
  const minutes = BACKOFF_BASE_MINUTES * Math.pow(2, attempts);
  return Math.min(minutes, BACKOFF_CAP_MINUTES);
}

/**
 * The `next_attempt_at` value to write back on a transient failure.
 * `now` defaults to the real clock; pass a fixed one in tests.
 */
export function nextAttemptAt(attempts: number, now: () => Date = () => new Date()): Date {
  const minutes = backoffMinutes(attempts);
  return new Date(now().getTime() + minutes * 60_000);
}

/**
 * True once `attempts` has reached the threshold claim_purge_batch() stops
 * leasing at -- i.e. this row is now dead-lettered and will not be retried
 * again on its own.
 */
export function isDeadLettered(attempts: number): boolean {
  return attempts >= DEAD_LETTER_THRESHOLD;
}
