// Direct Postgres connection to reach the `private` schema
// (docs/edge-verification-plan.md §4).
//
// `private` is not in config.toml's exposed `schemas`, so PostgREST -- and therefore
// `serviceClient()` from `_shared/supabase.ts` -- can never reach
// `private.start_verification_attempt()` or `private.apply_verification_result()`. Per
// `supabase/functions/_shared/README.md`'s note under `supabase.ts`: a function that needs
// `private.*` "must open its own Postgres connection -- see identity/db.ts for the pattern
// (postgres.js over the pooler, `set local role service_role`)". This file follows that pattern:
// every statement runs inside a transaction that first does `set local role service_role`, so
// the session's effective privileges are exactly what migration 0003 grants `service_role` on
// this domain -- the connecting role (the platform's `postgres`) is a member of it, same as
// identity/db.ts and purge-drain/db.ts.
//
// `_shared/` did not exist yet when this file was first written; it appeared mid-build (the
// `identity` function's own scope) and this file was updated to depend on it, per this
// function's build brief ("if _shared/... exist ... import from them").

import postgres, { type Sql, type TransactionSql } from "postgres";
import { firstEnv } from "../_shared/env.ts";
import type { VerificationRowState } from "./transitions.ts";

export interface ProfileForStart {
  status: string;
  verificationStatus: string;
}

export interface ExistingAttemptRow {
  id: string;
  state: VerificationRowState;
  attempt: number;
  providerReference: string | null;
}

export interface StartAttemptRpcResult {
  id: string;
  state: VerificationRowState;
  attempt: number;
}

export interface ApplyResultRpcResult {
  verificationState: VerificationRowState;
  profileStatus: string;
}

export interface RateLimitResult {
  count: number;
  limited: boolean;
}

/** Everything index.ts needs from Postgres, as an interface so index_test.ts can supply a fake
 * with no network (task requirement). The concrete implementation is makePostgresVerificationDb
 * below; nothing outside this file (and its test double) should import `postgres` directly. */
export interface VerificationDb {
  getProfileForStart(userId: string): Promise<ProfileForStart | null>;
  getExistingOpenAttempt(userId: string): Promise<ExistingAttemptRow | null>;
  getLastAttemptNumber(userId: string): Promise<number | null>;
  /** Increments and returns the current hour-window's request count for decision 29's 5/hour
   * limit (plan §7/§9 Q5), backed by private.verification_start_rate_limit (migration 0003). */
  checkAndIncrementStartRateLimit(userId: string, limitPerHour: number): Promise<RateLimitResult>;
  /** private.start_verification_attempt (migration 0003). Throws on the RPC's own exceptions;
   * index.ts maps the message text to an HTTP status via transitions.ts's *_ERROR_PATTERN regexes. */
  callStartVerificationAttempt(userId: string): Promise<StartAttemptRpcResult>;
  /** Plain UPDATE, not an RPC: verifications has no client policies at all (migration 0002), so a
   * service-role connection can write provider_reference directly — the "the function is the
   * only writer of profiles.verification_status, and only via apply_verification_result"
   * constraint is specifically about `profiles`, not this column on `verifications`. */
  setProviderReference(verificationId: string, providerReference: string): Promise<void>;
  /** Joined through `verifications` because the webhook handler only ever has verificationId in
   * hand (round-tripped via the provider's reference-id), never userId directly. */
  getSelfDeclaredDobForVerification(verificationId: string): Promise<string | null>;
  /** private.apply_verification_result (migration 0003). Throws on the RPC's own exceptions;
   * index.ts checks the message against transitions.ts's NOT_OPEN_ERROR_PATTERN to distinguish a
   * refused transition (200 + warning log) from a genuine failure (500). */
  callApplyVerificationResult(input: {
    verificationId: string;
    eventId: string;
    provider: string;
    outcome: VerificationRowState; // 'passed' | 'failed' | 'needs_review'; never 'pending' here
    providerAccountReference: string | null;
  }): Promise<ApplyResultRpcResult>;
}

let pool: Sql | undefined;

/** Lazily opened pooled client (Supavisor transaction mode), same settings as identity/db.ts. */
function sql(): Sql {
  if (!pool) {
    pool = postgres(firstEnv("VERIFICATION_DB_URL", "SUPABASE_DB_URL"), {
      max: 3,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false, // transaction-mode pooler cannot keep prepared statements
      onnotice: () => {}, // never let server notices reach the log
    });
  }
  return pool;
}

/** Runs `fn` in a transaction whose role is downgraded to `service_role`, matching
 * identity/db.ts and purge-drain/db.ts's structural enforcement: the only statements this
 * connection can run are ones `service_role` was actually granted.
 *
 * The `as unknown as T` mirrors purge-drain/db.ts's note: `Sql.begin()`'s declared return type
 * doesn't unify with a plain generic `T` for a callback like this one, even though the runtime
 * behavior (resolve with whatever the callback returns) is exactly `T`. */
async function asServiceRole<T>(fn: (tx: TransactionSql<Record<string, never>>) => Promise<T>): Promise<T> {
  const result = await sql().begin(async (tx) => {
    await tx`set local role service_role`;
    return await fn(tx);
  });
  return result as unknown as T;
}

export function makePostgresVerificationDb(): VerificationDb {
  return {
    async getProfileForStart(userId) {
      const rows = await asServiceRole<{ status: string; verification_status: string }[]>((tx) =>
        tx`
          select status, verification_status
            from public.profiles
           where id = ${userId}::uuid
        `
      );
      if (rows.length === 0) return null;
      return { status: rows[0].status, verificationStatus: rows[0].verification_status };
    },

    async getExistingOpenAttempt(userId) {
      const rows = await asServiceRole<
        { id: string; state: VerificationRowState; attempt: number; provider_reference: string | null }[]
      >((tx) =>
        tx`
          select id, state, attempt, provider_reference
            from public.verifications
           where user_id = ${userId}::uuid
             and state in ('pending', 'needs_review')
           order by attempt desc
           limit 1
        `
      );
      if (rows.length === 0) return null;
      const r = rows[0];
      return { id: r.id, state: r.state, attempt: r.attempt, providerReference: r.provider_reference };
    },

    async getLastAttemptNumber(userId) {
      const rows = await asServiceRole<{ attempt: number }[]>((tx) =>
        tx`
          select attempt
            from public.verifications
           where user_id = ${userId}::uuid
           order by attempt desc
           limit 1
        `
      );
      return rows.length === 0 ? null : rows[0].attempt;
    },

    async checkAndIncrementStartRateLimit(userId, limitPerHour) {
      const rows = await asServiceRole<{ request_count: number }[]>((tx) =>
        tx`
          insert into private.verification_start_rate_limit (user_id, window_start, request_count)
          values (${userId}::uuid, date_trunc('hour', now()), 1)
          on conflict (user_id, window_start) do update
            set request_count = private.verification_start_rate_limit.request_count + 1
          returning request_count
        `
      );
      const count = rows[0].request_count;
      return { count, limited: count > limitPerHour };
    },

    async callStartVerificationAttempt(userId) {
      const rows = await asServiceRole<{ id: string; state: VerificationRowState; attempt: number }[]>((tx) =>
        tx`select * from private.start_verification_attempt(${userId}::uuid)`
      );
      return rows[0];
    },

    async setProviderReference(verificationId, providerReference) {
      await asServiceRole((tx) =>
        tx`
          update public.verifications
             set provider_reference = ${providerReference}
           where id = ${verificationId}::uuid
        `
      );
    },

    async getSelfDeclaredDobForVerification(verificationId) {
      const rows = await asServiceRole<{ date_of_birth: string | null }[]>((tx) =>
        tx`
          select up.date_of_birth
            from public.users_private up
            join public.verifications v on v.user_id = up.user_id
           where v.id = ${verificationId}::uuid
        `
      );
      return rows.length === 0 ? null : rows[0].date_of_birth;
    },

    async callApplyVerificationResult(input) {
      const rows = await asServiceRole<{ verification_state: VerificationRowState; profile_status: string }[]>((tx) =>
        tx`
          select * from private.apply_verification_result(
            ${input.verificationId}::uuid,
            ${input.eventId}::text,
            ${input.provider}::text,
            ${input.outcome}::public.verification_attempt_state,
            ${input.providerAccountReference}::text
          )
        `
      );
      const r = rows[0];
      return { verificationState: r.verification_state, profileStatus: r.profile_status };
    },
  };
}
