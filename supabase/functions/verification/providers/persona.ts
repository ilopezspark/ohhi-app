// Persona adapter (decision 25). Implements providers/types.ts's VerificationProvider.
//
// Sources consulted (fetched during this build, 21 Sep 2026 — re-check before shipping, Persona's
// docs are not versioned in this repo):
//   - https://docs.withpersona.com/quickstart-webhooks
//       Persona-Signature header shape, HMAC-SHA256 over "{timestamp}.{raw body}".
//   - https://docs.withpersona.com/webhooks-best-practices
//       Same signature scheme confirmed independently; no documented timestamp-tolerance
//       recommendation (we apply the plan's own ~5 minute default, §3); duplicate/out-of-order
//       delivery is explicitly possible, which is why apply_verification_result()'s idempotency
//       ledger — not this adapter — is the real dedup boundary.
//   - https://docs.withpersona.com/api-reference/webhooks/inquiry-events/webhook-inquiry-created
//       Event envelope shape: data.id (the event's own id), data.attributes.name (event name),
//       data.attributes.payload.data (the affected Inquiry object).
//   - https://docs.withpersona.com/api-reference/webhooks/inquiry-events/webhook-inquiry-approved
//   - https://docs.withpersona.com/api-reference/webhooks/inquiry-events/webhook-inquiry-declined
//   - https://docs.withpersona.com/api-reference/webhooks/inquiry-events/webhook-inquiry-marked-for-review
//       Confirm the three event names this adapter acts on: inquiry.approved, inquiry.declined,
//       inquiry.marked-for-review.
//   - https://docs.withpersona.com/api-reference/inquiries/retrieve-an-inquiry
//       Inquiry object shape: attributes["reference-id"], relationships.account.data.id.
//   - https://docs.withpersona.com/api-reference/webhooks/verification-events/webhook-verification-submitted
//       A document "birthdate" field exists on Persona payloads (format YYYY-MM-DD) but its exact
//       JSON path on an *Inquiry*-level webhook (vs. a nested Verification object) was not
//       confirmed — see extractDocumentDob() below.
//
// // TODO(persona): confirm every field access below against a real sandbox webhook payload and
// the live API reference before this adapter reaches production; the docs site's structured
// content did not yield a single confirmed end-to-end example payload during this build, only
// per-field confirmations from separate pages.

import type { IgnoredEvent, NormalizedResult, SignatureVerification, VerificationProvider } from "./types.ts";
import type { VerificationOutcome } from "../transitions.ts";

/** inquiry.approved -> passed, inquiry.declined -> failed, inquiry.marked-for-review ->
 * needs_review (decision 26 routes DOB mismatches here too, applied by index.ts after this
 * mapping, not inside it). Every other recognized event name is an IgnoredEvent. */
const EVENT_NAME_TO_OUTCOME: Record<string, VerificationOutcome> = {
  "inquiry.approved": "passed",
  "inquiry.declined": "failed",
  "inquiry.marked-for-review": "needs_review",
};

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  // Deno doesn't expose crypto.timingSafeEqual synchronously the way Node does; hex strings are
  // fixed-alphabet and (for a correct signature) fixed-length, so a manual constant-time compare
  // over their char codes is equivalent to comparing the underlying bytes.
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Parses "t=169...,v1=abcdef... t=169...,v1=012345..." (space-separated during key rotation,
 * per quickstart-webhooks) into pairs. Malformed segments are dropped, not thrown on — an
 * attacker-controlled header should never crash the handler. */
function parseSignatureHeader(header: string): Array<{ t: string; v1: string }> {
  const pairs: Array<{ t: string; v1: string }> = [];
  for (const part of header.trim().split(/\s+/)) {
    const kv: Record<string, string> = {};
    for (const segment of part.split(",")) {
      const eq = segment.indexOf("=");
      if (eq === -1) continue;
      kv[segment.slice(0, eq).trim()] = segment.slice(eq + 1).trim();
    }
    if (kv.t && kv.v1) pairs.push({ t: kv.t, v1: kv.v1 });
  }
  return pairs;
}

/** Exported separately (in addition to being wired into the provider object below) so
 * persona_test.ts can exercise it without constructing a full provider. */
export async function verifyPersonaSignature(input: {
  rawBody: string;
  signatureHeader: string | null;
  secret: string;
  nowSeconds: number;
  toleranceSeconds: number;
}): Promise<SignatureVerification> {
  if (!input.signatureHeader) {
    return { valid: false, reason: "missing_header" };
  }

  const pairs = parseSignatureHeader(input.signatureHeader);
  if (pairs.length === 0) {
    return { valid: false, reason: "malformed_header" };
  }

  let sawTimestampInTolerance = false;
  for (const { t, v1 } of pairs) {
    const tsNum = Number(t);
    if (!Number.isFinite(tsNum)) continue;
    const withinTolerance = Math.abs(input.nowSeconds - tsNum) <= input.toleranceSeconds;
    if (withinTolerance) sawTimestampInTolerance = true;

    // Compute against the raw body exactly as received — never JSON.parse'd and re-serialized
    // (plan §3: "Never re-serialize then compare"; also guards the whitespace-only-payload
    // regression named in plan §8 assertion 5).
    const expected = await hmacSha256Hex(input.secret, `${t}.${input.rawBody}`);
    if (timingSafeEqual(expected, v1) && withinTolerance) {
      return { valid: true };
    }
  }

  if (!sawTimestampInTolerance) {
    return { valid: false, reason: "timestamp_out_of_tolerance" };
  }
  return { valid: false, reason: "no_matching_signature" };
}

/** // TODO(persona): confirm the exact JSON path. Tried both shapes seen across Persona's docs
 * during this build: a flat `attributes.birthdate` (seen on a Verification-object reference page)
 * and the more common Persona "fields" wrapper `attributes.fields.birthdate.value` (seen on
 * Inquiry-object pages). Returns null — "not present," handled as "skip the mismatch check," not
 * "confirmed no DOB" — if neither shape matches. */
function extractDocumentDob(inquiryData: Record<string, unknown>): string | null {
  const attributes = inquiryData?.attributes as Record<string, unknown> | undefined;
  if (!attributes) return null;

  if (typeof attributes.birthdate === "string") return attributes.birthdate;

  const fields = attributes.fields as Record<string, unknown> | undefined;
  const birthdateField = fields?.birthdate as Record<string, unknown> | undefined;
  if (birthdateField && typeof birthdateField.value === "string") return birthdateField.value;

  return null;
}

function extractAccountReference(inquiryData: Record<string, unknown>): string | null {
  // // TODO(persona): confirm relationships.account.data.id is present on inquiry.approved /
  // inquiry.declined / inquiry.marked-for-review payloads specifically (only confirmed against
  // the Inquiry retrieval reference page, not a webhook example). This is decision 8's stable
  // per-person identifier — get it wrong and the denylist (plan §5) silently stops working.
  const relationships = inquiryData?.relationships as Record<string, unknown> | undefined;
  const account = relationships?.account as Record<string, unknown> | undefined;
  const data = account?.data as Record<string, unknown> | undefined;
  return typeof data?.id === "string" ? data.id : null;
}

export function makePersonaProvider(config: {
  apiKey: string;
  webhookSecret: string;
  inquiryTemplateId: string;
  /** // TODO(persona): confirm the real API base URL and whether "session" here means a hosted
   * one-time link (returns a URL) or a mobile SDK session-token — the plan's §2 response field is
   * named `session_url`, which assumes the former. */
  apiBaseUrl?: string;
}): VerificationProvider {
  const apiBaseUrl = config.apiBaseUrl ?? "https://withpersona.com/api/v1";

  return {
    name: "persona",

    async createSession({ verificationId }) {
      // // TODO(persona): confirm this endpoint/body shape. docs.withpersona.com's
      // "Create an Inquiry" reference page 404'd during this build; the JSON:API envelope below
      // (data.attributes.*) matches every other Persona payload this adapter confirmed elsewhere,
      // but the exact attribute keys and the response's session-url field are unverified.
      const res = await fetch(`${apiBaseUrl}/inquiries`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          data: {
            attributes: {
              "inquiry-template-id": config.inquiryTemplateId,
              // Round-trips verifications.id through Persona so the webhook can join back
              // without trusting anything else in the request (plan §1 step 2).
              "reference-id": verificationId,
            },
          },
        }),
      });

      if (!res.ok) {
        throw new Error(`persona: createSession failed (${res.status})`);
      }

      const body = await res.json();
      const inquiryId = body?.data?.id;
      // // TODO(persona): confirm where the hosted-flow URL actually comes from — possibly a
      // separate "generate one-time link" call rather than a field on the create response.
      const sessionUrl = body?.data?.attributes?.["session-url"] ??
        body?.meta?.["one-time-link"] ??
        null;

      if (typeof inquiryId !== "string" || typeof sessionUrl !== "string") {
        throw new Error("persona: createSession response missing inquiry id or session url");
      }

      return { providerReference: inquiryId, sessionUrl };
    },

    async resumeSession({ providerReference }) {
      // // TODO(persona): confirm the "regenerate a link for an existing inquiry" endpoint
      // (plausibly POST /inquiries/{id}/generate-one-time-link). Implemented as its own call
      // rather than re-running createSession(), because createSession() mints a *new* Persona
      // inquiry — reusing it for the 409/in-flight path would silently orphan the first inquiry
      // and desync provider_reference from what the client is actually completing.
      const res = await fetch(`${apiBaseUrl}/inquiries/${providerReference}/generate-one-time-link`, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.apiKey}` },
      });

      if (!res.ok) {
        throw new Error(`persona: resumeSession failed (${res.status})`);
      }

      const body = await res.json();
      const sessionUrl = body?.meta?.["one-time-link"] ?? body?.data?.attributes?.["session-url"] ?? null;
      if (typeof sessionUrl !== "string") {
        throw new Error("persona: resumeSession response missing session url");
      }

      return { providerReference, sessionUrl };
    },

    verifySignature(input) {
      return verifyPersonaSignature(input);
    },

    parseWebhookEvent(rawBody) {
      const json = JSON.parse(rawBody);
      const data = json?.data;
      if (!data || typeof data.id !== "string") {
        throw new Error("persona: webhook payload missing data.id");
      }

      const eventId: string = data.id;
      const eventName: unknown = data?.attributes?.name;
      if (typeof eventName !== "string") {
        throw new Error("persona: webhook payload missing data.attributes.name");
      }

      const outcome = EVENT_NAME_TO_OUTCOME[eventName];
      if (!outcome) {
        const ignored: IgnoredEvent = { ignored: true, eventName };
        return ignored;
      }

      const inquiryData = data?.attributes?.payload?.data;
      if (!inquiryData || typeof inquiryData !== "object") {
        throw new Error(`persona: webhook payload missing payload.data for event ${eventName}`);
      }

      const verificationId = (inquiryData as Record<string, unknown>)?.attributes &&
        (inquiryData as Record<string, Record<string, unknown>>).attributes["reference-id"];
      if (typeof verificationId !== "string" || verificationId.length === 0) {
        throw new Error(`persona: webhook payload missing reference-id for event ${eventName}`);
      }

      const result: NormalizedResult = {
        eventId,
        eventName,
        verificationId,
        outcome,
        providerAccountReference: extractAccountReference(inquiryData as Record<string, unknown>),
        documentDob: extractDocumentDob(inquiryData as Record<string, unknown>),
      };
      return result;
    },
  };
}
