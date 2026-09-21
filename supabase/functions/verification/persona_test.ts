import { assert, assertEquals, assertThrows } from "@std/assert";
import { makePersonaProvider, verifyPersonaSignature } from "./providers/persona.ts";
import type { IgnoredEvent, NormalizedResult } from "./providers/types.ts";

const SECRET = "wbhsec_test_secret";

async function sign(timestampSeconds: number, rawBody: string, secret = SECRET): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestampSeconds}.${rawBody}`));
  const hex = Array.from(new Uint8Array(sigBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `t=${timestampSeconds},v1=${hex}`;
}

const NOW = 1_726_000_000; // arbitrary fixed epoch seconds for deterministic tests
const TOLERANCE = 300; // 5 minutes, matches index.ts's default

// ---------------------------------------------------------------------------------------------
// Signature verification: valid / invalid / stale / replayed
// ---------------------------------------------------------------------------------------------

Deno.test("verifyPersonaSignature: valid signature over the exact raw body verifies", async () => {
  const rawBody = JSON.stringify({ data: { id: "evt_1" } });
  const header = await sign(NOW, rawBody);
  const result = await verifyPersonaSignature({
    rawBody,
    signatureHeader: header,
    secret: SECRET,
    nowSeconds: NOW,
    toleranceSeconds: TOLERANCE,
  });
  assertEquals(result, { valid: true });
});

Deno.test("verifyPersonaSignature: missing header is rejected", async () => {
  const result = await verifyPersonaSignature({
    rawBody: "{}",
    signatureHeader: null,
    secret: SECRET,
    nowSeconds: NOW,
    toleranceSeconds: TOLERANCE,
  });
  assertEquals(result, { valid: false, reason: "missing_header" });
});

Deno.test("verifyPersonaSignature: malformed header (no t=/v1= pairs) is rejected", async () => {
  const result = await verifyPersonaSignature({
    rawBody: "{}",
    signatureHeader: "not-a-real-signature-header",
    secret: SECRET,
    nowSeconds: NOW,
    toleranceSeconds: TOLERANCE,
  });
  assertEquals(result, { valid: false, reason: "malformed_header" });
});

Deno.test("verifyPersonaSignature: tampered signature is rejected (body changed after signing)", async () => {
  const signedBody = JSON.stringify({ data: { id: "evt_1" } });
  const header = await sign(NOW, signedBody);
  const tamperedBody = JSON.stringify({ data: { id: "evt_1_tampered" } });

  const result = await verifyPersonaSignature({
    rawBody: tamperedBody,
    signatureHeader: header,
    secret: SECRET,
    nowSeconds: NOW,
    toleranceSeconds: TOLERANCE,
  });
  assertEquals(result, { valid: false, reason: "no_matching_signature" });
});

Deno.test("verifyPersonaSignature: wrong secret is rejected", async () => {
  const rawBody = "{}";
  const header = await sign(NOW, rawBody, "wrong_secret");
  const result = await verifyPersonaSignature({
    rawBody,
    signatureHeader: header,
    secret: SECRET,
    nowSeconds: NOW,
    toleranceSeconds: TOLERANCE,
  });
  assertEquals(result, { valid: false, reason: "no_matching_signature" });
});

Deno.test("verifyPersonaSignature: a stale timestamp outside tolerance is rejected even with a correct HMAC", async () => {
  const rawBody = "{}";
  const staleTimestamp = NOW - TOLERANCE - 60; // 1 minute past the 5-minute window
  const header = await sign(staleTimestamp, rawBody);
  const result = await verifyPersonaSignature({
    rawBody,
    signatureHeader: header,
    secret: SECRET,
    nowSeconds: NOW,
    toleranceSeconds: TOLERANCE,
  });
  assertEquals(result, { valid: false, reason: "timestamp_out_of_tolerance" });
});

Deno.test("verifyPersonaSignature: a timestamp inside the tolerance boundary verifies", async () => {
  const rawBody = "{}";
  const header = await sign(NOW - TOLERANCE, rawBody);
  const result = await verifyPersonaSignature({
    rawBody,
    signatureHeader: header,
    secret: SECRET,
    nowSeconds: NOW,
    toleranceSeconds: TOLERANCE,
  });
  assertEquals(result, { valid: true });
});

Deno.test("verifyPersonaSignature: key-rotation header (two space-separated pairs) verifies on the matching one", async () => {
  const rawBody = "{}";
  const oldPair = await sign(NOW, rawBody, "old_secret");
  const newPair = await sign(NOW, rawBody, SECRET);
  const result = await verifyPersonaSignature({
    rawBody,
    signatureHeader: `${oldPair} ${newPair}`,
    secret: SECRET,
    nowSeconds: NOW,
    toleranceSeconds: TOLERANCE,
  });
  assertEquals(result, { valid: true });
});

Deno.test("verifyPersonaSignature: whitespace-only body variants still verify (guards a parse-then-reserialize regression)", async () => {
  // The exact bytes Persona sent, including incidental whitespace a JSON.stringify round-trip
  // would normalize away. Verifying against rawBody directly (never re-serialized) must still
  // pass — this is the regression plan §8 assertion 5 calls out by name.
  const rawBody = '{\n  "data": {\n    "id": "evt_whitespace"\n  }\n}\n';
  const header = await sign(NOW, rawBody);
  const result = await verifyPersonaSignature({
    rawBody,
    signatureHeader: header,
    secret: SECRET,
    nowSeconds: NOW,
    toleranceSeconds: TOLERANCE,
  });
  assertEquals(result, { valid: true });
});

Deno.test("verifyPersonaSignature: a replayed (previously-seen) valid signature still verifies here — dedup is the DB's job, not the adapter's", async () => {
  // private.verification_webhook_events (migration 0003), applied via
  // private.apply_verification_result, is the actual idempotency boundary (plan §3). The adapter
  // has no state and must not try to reject a replay itself — verifying the same valid signature
  // twice in a row must both times return valid: true.
  const rawBody = JSON.stringify({ data: { id: "evt_replay" } });
  const header = await sign(NOW, rawBody);
  const first = await verifyPersonaSignature({
    rawBody,
    signatureHeader: header,
    secret: SECRET,
    nowSeconds: NOW,
    toleranceSeconds: TOLERANCE,
  });
  const second = await verifyPersonaSignature({
    rawBody,
    signatureHeader: header,
    secret: SECRET,
    nowSeconds: NOW,
    toleranceSeconds: TOLERANCE,
  });
  assertEquals(first, { valid: true });
  assertEquals(second, { valid: true });
});

// ---------------------------------------------------------------------------------------------
// parseWebhookEvent: event-name -> normalized outcome mapping
// ---------------------------------------------------------------------------------------------

const VERIFICATION_ID = "33333333-3333-3333-3333-333333333333";

function inquiryEnvelope(eventId: string, eventName: string, inquiryAttributes: Record<string, unknown>, relationships?: Record<string, unknown>) {
  return JSON.stringify({
    data: {
      id: eventId,
      attributes: {
        name: eventName,
        payload: {
          data: {
            id: "inq_abc123",
            attributes: { "reference-id": VERIFICATION_ID, ...inquiryAttributes },
            relationships: relationships ?? {},
          },
        },
      },
    },
  });
}

const provider = makePersonaProvider({
  apiKey: "test_key",
  webhookSecret: SECRET,
  inquiryTemplateId: "itmpl_test",
});

Deno.test("parseWebhookEvent: inquiry.approved maps to outcome 'passed'", () => {
  const raw = inquiryEnvelope("evt_approved", "inquiry.approved", { status: "approved" });
  const result = provider.parseWebhookEvent(raw) as NormalizedResult;
  assertEquals(result.outcome, "passed");
  assertEquals(result.eventId, "evt_approved");
  assertEquals(result.eventName, "inquiry.approved");
  assertEquals(result.verificationId, VERIFICATION_ID);
});

Deno.test("parseWebhookEvent: inquiry.declined maps to outcome 'failed'", () => {
  const raw = inquiryEnvelope("evt_declined", "inquiry.declined", { status: "declined" });
  const result = provider.parseWebhookEvent(raw) as NormalizedResult;
  assertEquals(result.outcome, "failed");
});

Deno.test("parseWebhookEvent: inquiry.marked-for-review maps to outcome 'needs_review'", () => {
  const raw = inquiryEnvelope("evt_review", "inquiry.marked-for-review", { status: "needs_review" });
  const result = provider.parseWebhookEvent(raw) as NormalizedResult;
  assertEquals(result.outcome, "needs_review");
});

Deno.test("parseWebhookEvent: an unrecognized/irrelevant event name (e.g. inquiry.created) is ignored, not thrown", () => {
  const raw = inquiryEnvelope("evt_created", "inquiry.created", { status: "created" });
  const result = provider.parseWebhookEvent(raw) as IgnoredEvent;
  assertEquals(result.ignored, true);
  assertEquals(result.eventName, "inquiry.created");
});

Deno.test("parseWebhookEvent: missing data.id throws (shape failure -> 400)", () => {
  assertThrows(() => provider.parseWebhookEvent(JSON.stringify({ data: {} })));
});

Deno.test("parseWebhookEvent: missing data.attributes.name throws", () => {
  assertThrows(() => provider.parseWebhookEvent(JSON.stringify({ data: { id: "evt_1" } })));
});

Deno.test("parseWebhookEvent: an actionable event missing reference-id throws rather than guessing a verification id", () => {
  const raw = JSON.stringify({
    data: {
      id: "evt_no_ref",
      attributes: {
        name: "inquiry.approved",
        payload: { data: { id: "inq_1", attributes: { status: "approved" } } },
      },
    },
  });
  assertThrows(() => provider.parseWebhookEvent(raw));
});

Deno.test("parseWebhookEvent: extracts a flat attributes.birthdate when present", () => {
  const raw = inquiryEnvelope("evt_dob_flat", "inquiry.approved", { status: "approved", birthdate: "2001-05-17" });
  const result = provider.parseWebhookEvent(raw) as NormalizedResult;
  assertEquals(result.documentDob, "2001-05-17");
});

Deno.test("parseWebhookEvent: extracts attributes.fields.birthdate.value when the flat field is absent", () => {
  const raw = inquiryEnvelope("evt_dob_fields", "inquiry.approved", {
    status: "approved",
    fields: { birthdate: { value: "1999-12-01" } },
  });
  const result = provider.parseWebhookEvent(raw) as NormalizedResult;
  assertEquals(result.documentDob, "1999-12-01");
});

Deno.test("parseWebhookEvent: documentDob is null, not thrown, when neither shape is present", () => {
  const raw = inquiryEnvelope("evt_no_dob", "inquiry.approved", { status: "approved" });
  const result = provider.parseWebhookEvent(raw) as NormalizedResult;
  assertEquals(result.documentDob, null);
});

Deno.test("parseWebhookEvent: extracts relationships.account.data.id as providerAccountReference", () => {
  const raw = inquiryEnvelope(
    "evt_account",
    "inquiry.approved",
    { status: "approved" },
    { account: { data: { id: "acc_stable_person_1" } } },
  );
  const result = provider.parseWebhookEvent(raw) as NormalizedResult;
  assertEquals(result.providerAccountReference, "acc_stable_person_1");
});

Deno.test("parseWebhookEvent: providerAccountReference is null when no account relationship is present", () => {
  const raw = inquiryEnvelope("evt_no_account", "inquiry.approved", { status: "approved" });
  const result = provider.parseWebhookEvent(raw) as NormalizedResult;
  assertEquals(result.providerAccountReference, null);
});

Deno.test("makePersonaProvider: name is 'persona' (used as the provider column value)", () => {
  assert(provider.name === "persona");
});
