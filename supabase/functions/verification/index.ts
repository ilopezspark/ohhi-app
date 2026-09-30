// Verification edge function (decision 8, decision 19's second half, handoff-0002 item 8).
// docs/edge-verification-plan.md is the design; this implements its §1/§2 flow with the SQL
// objects from supabase/migrations/20260918000003_edge_support.sql, and the 18+ document check
// (decision 97) with private.apply_checked_verification_result from
// supabase/migrations/20260918000021_verified_adults_only.sql.
//
// Two routes, one function: POST /verification/start, POST /verification/webhook. `verify_jwt`
// is a per-*function*, not per-route, setting in supabase/config.toml — and /webhook must be
// reachable with no Supabase JWT at all (Persona has no Supabase session), so
// `[functions.verification]` sets `verify_jwt = false` for the whole function. That means
// /start's JWT check has to happen here, in code: handleStart() below uses `_shared/supabase.ts`'s
// `callerUid()` (anon-key client + `getUser()`) on the incoming bearer token itself, before
// anything touches private.start_verification_attempt() (mirrors docs/edge-identity-plan.md §2's
// "never trust a body user_id"). /webhook's only trust boundary is the signature check in
// handleWebhook, run before any JSON.parse (plan §3).

import { apiError, internalError, json, notFound, rateLimited, unauthenticated } from "../_shared/http.ts";
import { optionalEnv, requiredEnv } from "../_shared/env.ts";
import { callerUid } from "../_shared/supabase.ts";
import { makePostgresVerificationDb, type VerificationDb } from "./db.ts";
import { makePersonaProvider } from "./providers/persona.ts";
import type { VerificationProvider } from "./providers/types.ts";
import { classifyDocumentDob, type DocumentDobDecision } from "./age.ts";
import {
  ALREADY_VERIFIED_ERROR_PATTERN,
  ATTEMPT_CAP_ERROR_PATTERN,
  NOT_ALLOWED_ERROR_PATTERN,
  NOT_OPEN_ERROR_PATTERN,
  planStartAttempt,
  type VerificationOutcome,
} from "./transitions.ts";

export type LogLevel = "info" | "warn" | "error";
export type Logger = (level: LogLevel, event: string, fields: Record<string, unknown>) => void;

export interface Deps {
  db: VerificationDb;
  provider: VerificationProvider;
  /** Production: `_shared/supabase.ts`'s `callerUid` (anon-key client + `getUser()`), which
   * never throws — null is the 401 signal. Kept injectable so index_test.ts can supply a fake
   * with no network (§8 test requirement: "auth on /start"). */
  resolveCallerId: (req: Request) => Promise<string | null>;
  webhookSecret: string;
  /** Decision 29 default: 5/hour. */
  rateLimitPerHour: number;
  /** Plan §3 default: ~5 minutes. */
  webhookToleranceSeconds: number;
  /** The clock the age decision uses (age.ts). Production: `() => new Date()`. */
  now: () => Date;
  log: Logger;
}

/**
 * Decision 97 (owner ruling, 30 September 2026): the person is let in only when the verified
 * government ID shows 18 or over. The self-entered date of birth plays no part: the 366-day
 * tolerance decision 26 allowed is gone, and the document's date is what the SQL function stores.
 *
 *   provider outcome   document date (age.ts)     sent to SQL
 *   passed             adult                      passed + date      -> verified
 *   passed             minor                      passed + date      -> SQL closes (closed_age)
 *   passed             missing/malformed/future/  failed, no date    -> id_failed (neutral; the
 *                      implausible/conflict                             person may retry)
 *   needs_review       adult or minor             needs_review + date (SQL closes a minor now)
 *   needs_review       unusable                   needs_review, no date (a human decides; a later
 *                                                  approval is checked again here)
 *   failed             anything                   failed, no date
 *
 * SQL recomputes the age from the date it is given and is the authority; this function never
 * sends an unvalidated provider value as a date.
 */
function planOutcome(
  outcome: VerificationOutcome,
  rawDob: string | null,
  now: Date,
): { outcome: VerificationOutcome; documentDob: string | null; dobDecision: DocumentDobDecision["kind"]; dobReason?: string } {
  if (outcome === "failed") return { outcome, documentDob: null, dobDecision: "invalid", dobReason: "not_read" };
  const decision = classifyDocumentDob(rawDob, now);
  if (decision.kind === "invalid") {
    return {
      outcome: outcome === "passed" ? "failed" : outcome,
      documentDob: null,
      dobDecision: "invalid",
      dobReason: decision.reason,
    };
  }
  return { outcome, documentDob: decision.dob, dobDecision: decision.kind };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function handleStart(req: Request, deps: Deps): Promise<Response> {
  const userId = await deps.resolveCallerId(req);
  if (!userId) {
    return unauthenticated();
  }

  const rateLimit = await deps.db.checkAndIncrementStartRateLimit(userId, deps.rateLimitPerHour);
  if (rateLimit.limited) {
    deps.log("warn", "verification_start_rate_limited", { userId, count: rateLimit.count });
    return rateLimited("too many verification start requests; try again later");
  }

  const profile = await deps.db.getProfileForStart(userId);
  if (!profile) {
    // Not in plan §2's error table (401/403/409/422/502); folded into the generic 403 refusal
    // class rather than inventing an undocumented 404 for a case that shouldn't reach an
    // authenticated, already-onboarded caller in practice.
    return apiError("not_allowed", "not eligible to start verification", 403);
  }

  const existing = await deps.db.getExistingOpenAttempt(userId);
  const lastAttempt = await deps.db.getLastAttemptNumber(userId);

  const plan = planStartAttempt({
    profileStatus: profile.status,
    verificationStatus: profile.verificationStatus,
    existing: existing ? { id: existing.id, state: existing.state, attempt: existing.attempt } : null,
    lastAttempt,
  });

  if (plan.kind === "refused") {
    if (plan.reason === "attempt_cap_reached") {
      return apiError("attempt_cap_reached", "verification attempt cap reached; contact support", 422);
    }
    return apiError("not_allowed", "not eligible to start verification", 403);
  }

  // The RPC (private.start_verification_attempt) is still the actual source of truth — planned
  // above only to decide 200 vs 409 and to know whether to reuse an existing provider session.
  // A race between the plan and the RPC call (another request completing first) is caught here:
  // the RPC's own exception text is what actually drives 403/422 when it disagrees with the plan.
  let rpcResult;
  try {
    rpcResult = await deps.db.callStartVerificationAttempt(userId);
  } catch (err) {
    const message = messageOf(err);
    if (ALREADY_VERIFIED_ERROR_PATTERN.test(message) || NOT_ALLOWED_ERROR_PATTERN.test(message)) {
      return apiError("not_allowed", "not eligible to start verification", 403);
    }
    if (ATTEMPT_CAP_ERROR_PATTERN.test(message)) {
      return apiError("attempt_cap_reached", "verification attempt cap reached; contact support", 422);
    }
    deps.log("error", "verification_start_rpc_failed", { userId, message });
    return internalError();
  }

  const isExistingInFlight = plan.kind === "existing" && plan.attempt.id === rpcResult.id;

  try {
    if (isExistingInFlight) {
      const providerReference = existing?.providerReference ?? null;
      const session = providerReference
        ? await deps.provider.resumeSession({ verificationId: rpcResult.id, providerReference })
        : await deps.provider.createSession({ verificationId: rpcResult.id, userId });

      if (!providerReference) {
        await deps.db.setProviderReference(rpcResult.id, session.providerReference);
      }

      return json(
        {
          verification_id: rpcResult.id,
          provider: deps.provider.name,
          session_url: session.sessionUrl,
          attempt: rpcResult.attempt,
        },
        409,
      );
    }

    const session = await deps.provider.createSession({ verificationId: rpcResult.id, userId });
    await deps.db.setProviderReference(rpcResult.id, session.providerReference);

    return json({
      verification_id: rpcResult.id,
      provider: deps.provider.name,
      session_url: session.sessionUrl,
      attempt: rpcResult.attempt,
    });
  } catch (err) {
    const message = messageOf(err);
    deps.log("error", "verification_provider_session_failed", {
      userId,
      verificationId: rpcResult.id,
      message,
    });
    return apiError("provider_error", "failed to create verification session", 502);
  }
}

async function handleWebhook(req: Request, deps: Deps): Promise<Response> {
  // Raw body first, always — before any JSON.parse, per plan §3. `req.text()` gives the exact
  // bytes as received; nothing here re-serializes and compares.
  const rawBody = await req.text();
  const signatureHeader = req.headers.get("persona-signature") ?? req.headers.get("Persona-Signature");

  const sig = await deps.provider.verifySignature({
    rawBody,
    signatureHeader,
    secret: deps.webhookSecret,
    nowSeconds: Math.floor(Date.now() / 1000),
    toleranceSeconds: deps.webhookToleranceSeconds,
  });

  if (!sig.valid) {
    // Never log rawBody (PII, plan §3 log hygiene) — only the reason the check failed.
    deps.log("warn", "verification_webhook_signature_invalid", { reason: sig.reason ?? "unknown" });
    return apiError("invalid_signature", "signature verification failed", 400);
  }

  let parsed;
  try {
    parsed = deps.provider.parseWebhookEvent(rawBody);
  } catch (err) {
    deps.log("warn", "verification_webhook_parse_failed", { message: messageOf(err) });
    return apiError("invalid_payload", "unable to parse webhook payload", 400);
  }

  if ("ignored" in parsed) {
    deps.log("info", "verification_webhook_ignored", { eventName: parsed.eventName });
    return json({ received: true, ignored: true });
  }

  const plan = planOutcome(parsed.outcome, parsed.documentDob, deps.now());

  if (plan.dobDecision === "invalid" && parsed.outcome !== "failed") {
    // Never the date itself: only that it was unusable, why, and where the adapter looked.
    deps.log("info", "verification_document_dob_unusable", {
      verificationId: parsed.verificationId,
      eventId: parsed.eventId,
      reason: plan.dobReason,
      source: parsed.documentDobSource,
      providerOutcome: parsed.outcome,
      sentOutcome: plan.outcome,
    });
  }

  try {
    const result = await deps.db.callApplyVerificationResult({
      verificationId: parsed.verificationId,
      eventId: parsed.eventId,
      provider: deps.provider.name,
      outcome: plan.outcome,
      providerAccountReference: parsed.providerAccountReference,
      documentDob: plan.documentDob,
    });

    deps.log("info", "verification_webhook_applied", {
      verificationId: parsed.verificationId,
      eventId: parsed.eventId,
      eventName: parsed.eventName,
      newState: result.verificationState,
      newProfileStatus: result.profileStatus,
      newAccountStatus: result.accountStatus,
    });
    return json({ received: true });
  } catch (err) {
    const message = messageOf(err);

    if (NOT_OPEN_ERROR_PATTERN.test(message)) {
      // Refused per plan §1 (already-terminal row). Still 200 so the provider stops retrying;
      // the warning log is the only record that something was refused.
      deps.log("warn", "verification_webhook_refused_transition", {
        verificationId: parsed.verificationId,
        eventId: parsed.eventId,
        reason: message,
      });
      return json({ received: true, refused: true });
    }

    deps.log("error", "verification_webhook_apply_failed", {
      verificationId: parsed.verificationId,
      eventId: parsed.eventId,
      message,
    });
    return internalError();
  }
}

export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") {
      return notFound();
    }

    const pathname = new URL(req.url).pathname;

    if (pathname.endsWith("/start")) {
      return await handleStart(req, deps);
    }
    if (pathname.endsWith("/webhook")) {
      return await handleWebhook(req, deps);
    }

    return notFound();
  };
}

function consoleLogger(): Logger {
  return (level, event, fields) => {
    const line = JSON.stringify({ level, event, ts: new Date().toISOString(), ...fields });
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  };
}

function buildRealDeps(): Deps {
  const personaApiKey = requiredEnv("PERSONA_API_KEY");
  const personaWebhookSecret = requiredEnv("PERSONA_WEBHOOK_SECRET");
  const personaTemplateId = requiredEnv("PERSONA_INQUIRY_TEMPLATE_ID");
  const personaApiBaseUrl = optionalEnv("PERSONA_API_BASE_URL");

  return {
    db: makePostgresVerificationDb(),
    provider: makePersonaProvider({
      apiKey: personaApiKey,
      webhookSecret: personaWebhookSecret,
      inquiryTemplateId: personaTemplateId,
      apiBaseUrl: personaApiBaseUrl,
    }),
    resolveCallerId: callerUid,
    webhookSecret: personaWebhookSecret,
    rateLimitPerHour: 5, // decision 29
    webhookToleranceSeconds: 5 * 60, // plan §3
    now: () => new Date(),
    log: consoleLogger(),
  };
}

// Only starts a listener when this file is run directly (`supabase functions serve` /
// deployment), never when index_test.ts imports createHandler — keeps the Deno test run free of
// network side effects, matching the "with fakes, no network" requirement.
if (import.meta.main) {
  Deno.serve(createHandler(buildRealDeps()));
}
