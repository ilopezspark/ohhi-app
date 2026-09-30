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

import type {
  DocumentDobSource,
  IgnoredEvent,
  NormalizedResult,
  SignatureVerification,
  VerificationProvider,
} from "./types.ts";
import type { VerificationOutcome } from "../transitions.ts";

/** inquiry.approved -> passed, inquiry.declined -> failed, inquiry.marked-for-review ->
 * needs_review. The age decision (decision 97) is applied by index.ts and the SQL function after
 * this mapping, never inside it. Every other recognized event name is an IgnoredEvent. */
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

/** Persona's JSON:API type for a government ID verification object, and the only status whose
 * extracted birth date we accept as read from a verified document. */
const GOVERNMENT_ID_TYPE = "verification/government-id";
const PASSED_STATUS = "passed";

export interface ExtractedDob {
  /** Raw value exactly as found (validated later by age.ts, never here). null: nothing usable. */
  value: string | null;
  source: DocumentDobSource;
}

/**
 * Birth date from the verified government ID (decision 97: the DOCUMENT's date is the source of
 * truth for age). Deliberately defensive: every access is optional, nothing here throws, and a
 * value is only returned as a raw string for age.ts to validate.
 *
 * Preference order:
 *   1. `payload.included[]` objects of type `verification/government-id` with
 *      `attributes.status = 'passed'`: `attributes.birthdate`. This is the date Persona read off
 *      the ID that passed. If two passed government-ID verifications disagree, the result is
 *      "conflict" (null): never pick one.
 *   2. The inquiry's `attributes.fields.birthdate.value`, which Persona fills from the verified
 *      ID in a Government ID + Selfie template.
 *   3. The inquiry's flat `attributes.birthdate` (older API versions).
 * 2 and 3 are only used when no passed government-ID object is in the payload at all.
 *
 * // TODO(persona): confirm against one real sandbox `inquiry.approved` payload: (a) that the
 * webhook's `payload.included` carries the verification objects (the API returns them for
 * `GET /inquiries/{id}?include=verifications`; whether the webhook body includes them depends on
 * the webhook's settings), (b) the `verification/government-id` type string and its
 * `attributes.birthdate` key, and (c) that the template does not let the person type the
 * `birthdate` field themselves (if it does, fallbacks 2 and 3 must be removed and only 1 kept).
 * Until confirmed, a payload with none of the three shapes fails verification with a neutral
 * reason (the person can retry), which is the safe direction.
 */
export function extractDocumentDob(inquiryData: Record<string, unknown>, included: unknown): ExtractedDob {
  if (Array.isArray(included)) {
    const dates = new Set<string>();
    let sawGovernmentId = false;
    for (const item of included) {
      if (!item || typeof item !== "object") continue;
      const obj = item as Record<string, unknown>;
      if (obj.type !== GOVERNMENT_ID_TYPE) continue;
      const attrs = obj.attributes as Record<string, unknown> | undefined;
      if (!attrs || attrs.status !== PASSED_STATUS) continue;
      sawGovernmentId = true;
      if (typeof attrs.birthdate === "string" && attrs.birthdate.length > 0) dates.add(attrs.birthdate);
    }
    if (dates.size > 1) return { value: null, source: "conflict" };
    if (dates.size === 1) return { value: [...dates][0], source: "government_id" };
    // A passed government ID with no birth date on it: do not fall back to inquiry fields that
    // may have come from somewhere else.
    if (sawGovernmentId) return { value: null, source: null };
  }

  const attributes = inquiryData?.attributes as Record<string, unknown> | undefined;
  if (!attributes) return { value: null, source: null };

  const fields = attributes.fields as Record<string, unknown> | undefined;
  const birthdateField = fields?.birthdate as Record<string, unknown> | undefined;
  if (birthdateField && typeof birthdateField.value === "string" && birthdateField.value.length > 0) {
    return { value: birthdateField.value, source: "inquiry_fields" };
  }

  if (typeof attributes.birthdate === "string" && attributes.birthdate.length > 0) {
    return { value: attributes.birthdate, source: "inquiry_attribute" };
  }

  return { value: null, source: null };
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

      const dob = extractDocumentDob(inquiryData as Record<string, unknown>, data?.attributes?.payload?.included);

      const result: NormalizedResult = {
        eventId,
        eventName,
        verificationId,
        outcome,
        providerAccountReference: extractAccountReference(inquiryData as Record<string, unknown>),
        documentDob: dob.value,
        documentDobSource: dob.source,
      };
      return result;
    },
  };
}
