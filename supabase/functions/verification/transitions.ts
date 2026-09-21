// Pure state machine mirroring docs/edge-verification-plan.md §1's transition table and
// supabase/migrations/20260918000003_edge_support.sql's private.start_verification_attempt() /
// private.apply_verification_result(). No I/O, no Deno-specific APIs — safe to unit test in
// isolation (transitions_test.ts) and safe to import from index.ts for the same decisions the
// SQL makes, so the two never drift silently.
//
// The SQL functions remain the source of truth (they run under a row lock, this file does not).
// index.ts uses this module to (a) decide HTTP status codes / response shapes before or after
// calling the RPCs, and (b) log the *expected* transition alongside the RPC's actual result.

/** supabase/migrations/20260918000002_core_schema.sql: public.verification_attempt_state */
export type VerificationRowState = "pending" | "passed" | "failed" | "needs_review";

/** The provider-normalized result of a webhook callback (providers/types.ts NormalizedResult). */
export type VerificationOutcome = "passed" | "failed" | "needs_review";

/** supabase/migrations/20260918000002_core_schema.sql: public.verification_status (subset this
 * function ever writes — never 'unverified' or 'email_verified', those are set elsewhere). */
export type ProfileVerificationStatus = "id_pending" | "manual_review" | "verified" | "id_failed";

/** A `verifications` row only accepts a new outcome while it is in one of these states — mirrors
 * apply_verification_result()'s `if v_row.state not in ('pending', 'needs_review') then raise`. */
export const OPEN_STATES: readonly VerificationRowState[] = ["pending", "needs_review"];

export function isOpenState(state: VerificationRowState): boolean {
  return (OPEN_STATES as string[]).includes(state);
}

const OUTCOME_TO_PROFILE_STATUS: Record<VerificationRowState, ProfileVerificationStatus | null> = {
  passed: "verified",
  failed: "id_failed",
  needs_review: "manual_review",
  pending: null, // pending is never a webhook *result*, only start's initial state
};

export type ApplyOutcomeResult =
  | {
      allowed: true;
      fromState: VerificationRowState;
      toState: VerificationRowState;
      toProfileStatus: ProfileVerificationStatus;
      /** true when the outcome was overridden to 'failed' by the denylist re-check (plan §5),
       * regardless of what the provider actually reported. */
      forcedByDenylist: boolean;
    }
  | {
      allowed: false;
      fromState: VerificationRowState;
      /** Matches the shape of the Postgres exception text raised by apply_verification_result,
       * so index.ts can log something a human can grep for either way. */
      reason: string;
    };

/**
 * Mirrors apply_verification_result()'s decision, minus the DB round trip. `denylisted` should
 * only be known truthfully by the RPC itself (it re-checks server-side in the same transaction,
 * plan §4 step 4) — index.ts never computes this independently to decide behavior, it only
 * passes `false` here for pre-call logging and trusts the RPC's actual return value afterward.
 */
export function applyOutcome(
  fromState: VerificationRowState,
  outcome: VerificationOutcome,
  opts: { denylisted?: boolean } = {},
): ApplyOutcomeResult {
  if (!isOpenState(fromState)) {
    // Matches plan §1's refused list: a 'passed' row is a no-op on any further callback, a
    // 'failed' row only reopens via start_verification_attempt() (a new row), never via a second
    // webhook delivery for the same row. Both are "refused" at this layer; index.ts turns both
    // into a 200 + structured warning rather than a 500 (§1: "so the provider does not retry
    // forever").
    return {
      allowed: false,
      fromState,
      reason: `verification is not open for a result (state=${fromState})`,
    };
  }

  const denylisted = opts.denylisted ?? false;
  const toState: VerificationRowState = denylisted ? "failed" : outcome;
  const toProfileStatus = OUTCOME_TO_PROFILE_STATUS[toState];

  if (toProfileStatus === null) {
    // Unreachable given VerificationOutcome's type, but keeps this function total rather than
    // trusting the caller never passes something malformed after a refactor.
    throw new Error(`outcome '${outcome}' has no profile_status mapping`);
  }

  return { allowed: true, fromState, toState, toProfileStatus, forcedByDenylist: denylisted };
}

// ---------------------------------------------------------------------------------------------
// /verification/start — mirrors private.start_verification_attempt()
// ---------------------------------------------------------------------------------------------

export interface ExistingAttempt {
  id: string;
  state: VerificationRowState;
  attempt: number;
}

export interface StartAttemptInput {
  /** public.user_status */
  profileStatus: string;
  /** public.verification_status */
  verificationStatus: string;
  /** Most recent row in ('pending', 'needs_review') for this user, if any. */
  existing: ExistingAttempt | null;
  /** Most recent attempt number across all of this user's rows, regardless of state. */
  lastAttempt: number | null;
}

export type StartAttemptPlan =
  | { kind: "refused"; reason: "already_verified" | "not_eligible" | "attempt_cap_reached" }
  | { kind: "existing"; attempt: ExistingAttempt }
  | { kind: "new"; attempt: number };

/**
 * Mirrors start_verification_attempt()'s checks, in the same order, without touching the DB.
 * Used by index.ts to shape the HTTP response (200 vs 409 vs 403 vs 422) around the RPC call,
 * and by transitions_test.ts to exercise every row of plan §1/§9 Q3 directly.
 */
export function planStartAttempt(input: StartAttemptInput): StartAttemptPlan {
  if (input.verificationStatus === "verified") {
    return { kind: "refused", reason: "already_verified" };
  }

  if (input.profileStatus !== "active" && input.profileStatus !== "onboarding") {
    return { kind: "refused", reason: "not_eligible" };
  }

  if (input.existing) {
    return { kind: "existing", attempt: input.existing };
  }

  if (input.lastAttempt !== null && input.lastAttempt >= 3) {
    // Decision 27 / plan §9 Q3 default: permanent block, no cooldown-then-retry.
    return { kind: "refused", reason: "attempt_cap_reached" };
  }

  return { kind: "new", attempt: (input.lastAttempt ?? 0) + 1 };
}

/** Matches the text apply_verification_result() raises for a non-open row (migration 0003).
 * index.ts greps the RPC error message against this to distinguish "refused transition, still
 * 200" from a genuine 500. Kept in one place so a wording change in the migration only needs a
 * matching change here, not a hunt through index.ts. */
export const NOT_OPEN_ERROR_PATTERN = /not open for a result/i;

/** Matches the exception text start_verification_attempt() raises for each refusal, so index.ts
 * can map a caught Postgres error to the same HTTP codes planStartAttempt() would have predicted,
 * without parsing SQLSTATE codes it doesn't control the wording of. */
export const ALREADY_VERIFIED_ERROR_PATTERN = /already verified/i;
export const NOT_ALLOWED_ERROR_PATTERN = /not allowed/i;
export const ATTEMPT_CAP_ERROR_PATTERN = /attempt cap reached/i;
