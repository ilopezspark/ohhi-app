import type { PostgrestError } from '@supabase/supabase-js';

/**
 * Every schema-defined refusal (block, unmet share, unverified sender,
 * denylisted verification) surfaces as the same 42501 / 'not allowed' code,
 * intentionally indistinguishable from each other and from "not found"
 * (decision 24, defect H — see docs/app-architecture-plan.md §3). Screens
 * must render the same generic copy for this — never "blocked", "denied",
 * or "forbidden".
 */
export class RefusedError extends Error {
  constructor() {
    super("That didn't work.");
    this.name = 'RefusedError';
  }
}

/**
 * The thing the call was about is not there for the caller any more: a
 * message into a thread whose other participant has vanished (`conversation
 * not found`, migration 0014 / decision 90), or a hi back to a hi whose
 * sender has (`hi not found`). The server words both exactly as it words an
 * id that never existed, so this says nothing about *why*; screens treat it
 * as "gone" (drop it from the cache, leave quietly) and never retry.
 */
export class GoneError extends Error {
  constructor() {
    super("this isn't available anymore.");
    this.name = 'GoneError';
  }
}

/**
 * A write RPC refused its input with `22023` (invalid_parameter_value) —
 * migration 0015's `set_my_*` field writers ("at most 3 prompts", "usual
 * places must not repeat", …). Unlike a refusal this says nothing about
 * another person, so the reason may be shown: `message` is already the
 * app's own lowercase copy for it (`profile/fields.ts#friendlyFieldError`),
 * never the raw server text.
 */
export class InvalidInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidInputError';
  }
}

/** Any RPC/edge-function failure that isn't the refusal convention above. */
export class UnknownError extends Error {
  override cause?: unknown;

  constructor(cause?: unknown) {
    super('Something went wrong. Please try again.');
    this.name = 'UnknownError';
    this.cause = cause;
  }
}

const REFUSAL_CODE = '42501';
const REFUSAL_MESSAGE = 'not allowed';
const GONE_MESSAGES = new Set(['conversation not found', 'hi not found']);

/**
 * Maps a raw Supabase/Postgres error to one of the client-side error types
 * above. `src/api/*.ts` calls this on every RPC/table error so no screen ever
 * branches on `error.message` to infer *why* a call failed — that
 * reconstructs the exact leak decision 24 exists to prevent.
 *
 * Idempotent: an error that is already one of the types above comes back
 * unchanged, so a screen re-mapping what an `api/` function threw keeps a
 * refusal a refusal instead of demoting it to "something went wrong".
 */
export function mapSupabaseError(
  error: PostgrestError | Error | unknown
): RefusedError | GoneError | UnknownError | InvalidInputError {
  if (
    error instanceof RefusedError ||
    error instanceof GoneError ||
    error instanceof UnknownError ||
    error instanceof InvalidInputError
  ) {
    return error;
  }

  const code = (error as { code?: string } | null | undefined)?.code;
  const message = (error as { message?: string } | null | undefined)?.message;

  if (code === REFUSAL_CODE || message === REFUSAL_MESSAGE) {
    return new RefusedError();
  }

  if (message !== undefined && GONE_MESSAGES.has(message)) {
    return new GoneError();
  }

  return new UnknownError(error);
}

/**
 * True for the two outcomes a write toward a vanished person or thread can
 * have (decision 90): the generic refusal (a hi, a first message or a share
 * to a hidden or nonexistent user) and "gone" (a message into a vanished
 * thread, a hi back to a vanished sender). Screens use it only to decide
 * to re-check and drop the target from their caches, never to word copy.
 */
export function isUnavailableError(error: unknown): boolean {
  return error instanceof RefusedError || error instanceof GoneError;
}
