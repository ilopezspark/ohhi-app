// Provider-agnostic adapter interface (docs/edge-verification-plan.md, intro: "validated against
// three candidates before build: Stripe Identity, Persona, Veriff... Design is provider-agnostic
// via an adapter interface"). Persona is the only implementation today (decision 25); a Stripe
// Identity or Veriff adapter would implement the same interface and be swapped in index.ts.

import type { VerificationOutcome } from "../transitions.ts";

/** Returned by createSession() / resumeSession(); stored as verifications.provider_reference and
 * handed back to the client so it can launch the hosted verification flow. */
export interface ProviderSession {
  /** The provider's own id for this inquiry/session (verifications.provider_reference). */
  providerReference: string;
  /** URL or token the client uses to launch the hosted flow (plan §2's `session_url`). */
  sessionUrl: string;
}

/** The result of parsing one webhook delivery into something transitions.ts and
 * private.apply_verification_result() can consume, once a signature has already verified. */
export interface NormalizedResult {
  /** The provider's own id for *this event* — the idempotency key (plan §3), never re-derived
   * from the payload's business fields. */
  eventId: string;
  /** The provider's event type name (e.g. "inquiry.approved"), for structured logging only —
   * never used for authorization or state decisions, those go through `outcome`. */
  eventName: string;
  /** verifications.id, round-tripped through the provider as the session's client reference
   * (plan §1 step 2) — never trusted from anywhere else in the request. */
  verificationId: string;
  outcome: VerificationOutcome;
  /** Stable per-person identifier (decision 8); null until the provider assigns one, per plan §5. */
  providerAccountReference: string | null;
  /** Document DOB from the callback, if the provider includes one on this event (decision 26).
   * null means "not present on this event," not "confirmed absent from the identity" — the
   * mismatch check in index.ts only runs when this is non-null. */
  documentDob: string | null; // ISO 'YYYY-MM-DD'
}

/** A webhook delivery this adapter recognizes but that carries no verification outcome (e.g. an
 * "inquiry created" event) — a deliberate no-op, not a parse failure. */
export interface IgnoredEvent {
  ignored: true;
  eventName: string;
}

export interface SignatureVerification {
  valid: boolean;
  /** Present when valid is false — logged (never the payload itself) so a rejected webhook is
   * diagnosable from structured logs alone. */
  reason?: "missing_header" | "malformed_header" | "no_matching_signature" | "timestamp_out_of_tolerance";
}

export interface VerificationProvider {
  readonly name: string;

  /** POST /verification/start: create a new hosted verification session for this attempt. */
  createSession(input: { verificationId: string; userId: string }): Promise<ProviderSession>;

  /** POST /verification/start's 409 (in-flight) path: return a usable session for an inquiry
   * that was already created for this verification row, per plan §1: "returns existing session"
   * rather than starting a second one. */
  resumeSession(input: { verificationId: string; providerReference: string }): Promise<ProviderSession>;

  /** Verify the raw-body signature before any JSON.parse (plan §3). `nowSeconds` is injectable
   * for tests; index.ts always passes the real clock. Async because HMAC computation goes
   * through SubtleCrypto, which has no synchronous API in Deno. */
  verifySignature(input: {
    rawBody: string;
    signatureHeader: string | null;
    secret: string;
    nowSeconds: number;
    toleranceSeconds: number;
  }): Promise<SignatureVerification>;

  /** Parse an already-signature-verified raw body into a normalized result or an ignored event.
   * Throws only for a payload whose *shape* is unusable (plan §2: 400 on parse/shape failure) —
   * never for a recognized-but-irrelevant event, which is IgnoredEvent instead. */
  parseWebhookEvent(rawBody: string): NormalizedResult | IgnoredEvent;
}
