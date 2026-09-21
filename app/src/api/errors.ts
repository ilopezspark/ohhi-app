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

/**
 * Maps a raw Supabase/Postgres error to one of the two client-side error
 * types above. `src/api/*.ts` calls this on every RPC/table error so no
 * screen ever branches on `error.message` to infer *why* a call failed —
 * that reconstructs the exact leak decision 24 exists to prevent.
 */
export function mapSupabaseError(error: PostgrestError | Error | unknown): RefusedError | UnknownError {
  const code = (error as { code?: string } | null | undefined)?.code;
  const message = (error as { message?: string } | null | undefined)?.message;

  if (code === REFUSAL_CODE || message === REFUSAL_MESSAGE) {
    return new RefusedError();
  }

  return new UnknownError(error);
}
