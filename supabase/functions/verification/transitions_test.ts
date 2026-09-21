import { assertEquals } from "@std/assert";
import {
  ALREADY_VERIFIED_ERROR_PATTERN,
  applyOutcome,
  ATTEMPT_CAP_ERROR_PATTERN,
  NOT_ALLOWED_ERROR_PATTERN,
  NOT_OPEN_ERROR_PATTERN,
  planStartAttempt,
} from "./transitions.ts";

// ---------------------------------------------------------------------------------------------
// applyOutcome — every row of docs/edge-verification-plan.md §1's transition table
// ---------------------------------------------------------------------------------------------

Deno.test("applyOutcome: pending + approved -> passed / verified", () => {
  const result = applyOutcome("pending", "passed");
  assertEquals(result, {
    allowed: true,
    fromState: "pending",
    toState: "passed",
    toProfileStatus: "verified",
    forcedByDenylist: false,
  });
});

Deno.test("applyOutcome: pending + declined -> failed / id_failed", () => {
  const result = applyOutcome("pending", "failed");
  assertEquals(result, {
    allowed: true,
    fromState: "pending",
    toState: "failed",
    toProfileStatus: "id_failed",
    forcedByDenylist: false,
  });
});

Deno.test("applyOutcome: pending + flagged -> needs_review / manual_review", () => {
  const result = applyOutcome("pending", "needs_review");
  assertEquals(result, {
    allowed: true,
    fromState: "pending",
    toState: "needs_review",
    toProfileStatus: "manual_review",
    forcedByDenylist: false,
  });
});

Deno.test("applyOutcome: needs_review + reviewer approves -> passed / verified", () => {
  const result = applyOutcome("needs_review", "passed");
  assertEquals(result, {
    allowed: true,
    fromState: "needs_review",
    toState: "passed",
    toProfileStatus: "verified",
    forcedByDenylist: false,
  });
});

Deno.test("applyOutcome: needs_review + reviewer rejects -> failed / id_failed", () => {
  const result = applyOutcome("needs_review", "failed");
  assertEquals(result, {
    allowed: true,
    fromState: "needs_review",
    toState: "failed",
    toProfileStatus: "id_failed",
    forcedByDenylist: false,
  });
});

Deno.test("applyOutcome: passed + any further callback -> refused", () => {
  const result = applyOutcome("passed", "passed");
  assertEquals(result.allowed, false);
  if (!result.allowed) {
    assertEquals(result.fromState, "passed");
    assertEquals(NOT_OPEN_ERROR_PATTERN.test(result.reason), true);
  }
});

Deno.test("applyOutcome: passed + a declined callback -> still refused, not silently accepted", () => {
  const result = applyOutcome("passed", "failed");
  assertEquals(result.allowed, false);
});

Deno.test("applyOutcome: failed + a fresh webhook delivery -> refused (only start_verification_attempt reopens it)", () => {
  const result = applyOutcome("failed", "passed");
  assertEquals(result.allowed, false);
  if (!result.allowed) {
    assertEquals(NOT_OPEN_ERROR_PATTERN.test(result.reason), true);
  }
});

Deno.test("applyOutcome: denylist re-check forces failed regardless of a passing outcome", () => {
  const result = applyOutcome("pending", "passed", { denylisted: true });
  assertEquals(result, {
    allowed: true,
    fromState: "pending",
    toState: "failed",
    toProfileStatus: "id_failed",
    forcedByDenylist: true,
  });
});

Deno.test("applyOutcome: denylist re-check on needs_review also forces failed", () => {
  const result = applyOutcome("needs_review", "passed", { denylisted: true });
  assertEquals(result.allowed, true);
  if (result.allowed) {
    assertEquals(result.toState, "failed");
    assertEquals(result.toProfileStatus, "id_failed");
  }
});

// ---------------------------------------------------------------------------------------------
// planStartAttempt — every refusal/allow branch of private.start_verification_attempt()
// ---------------------------------------------------------------------------------------------

Deno.test("planStartAttempt: already verified is refused", () => {
  const plan = planStartAttempt({
    profileStatus: "active",
    verificationStatus: "verified",
    existing: null,
    lastAttempt: null,
  });
  assertEquals(plan, { kind: "refused", reason: "already_verified" });
  assertEquals(ALREADY_VERIFIED_ERROR_PATTERN.test("already verified"), true);
});

Deno.test("planStartAttempt: profile status outside active/onboarding is refused", () => {
  for (const status of ["paused", "suspended", "banned", "deleted", "closed_age"]) {
    const plan = planStartAttempt({
      profileStatus: status,
      verificationStatus: "email_verified",
      existing: null,
      lastAttempt: null,
    });
    assertEquals(plan, { kind: "refused", reason: "not_eligible" }, `status=${status}`);
  }
  assertEquals(NOT_ALLOWED_ERROR_PATTERN.test("not allowed"), true);
});

Deno.test("planStartAttempt: active and onboarding are both eligible", () => {
  for (const status of ["active", "onboarding"]) {
    const plan = planStartAttempt({
      profileStatus: status,
      verificationStatus: "email_verified",
      existing: null,
      lastAttempt: null,
    });
    assertEquals(plan, { kind: "new", attempt: 1 }, `status=${status}`);
  }
});

Deno.test("planStartAttempt: an in-flight pending row wins over a new insert (409 case)", () => {
  const existing = { id: "11111111-1111-1111-1111-111111111111", state: "pending" as const, attempt: 1 };
  const plan = planStartAttempt({
    profileStatus: "active",
    verificationStatus: "id_pending",
    existing,
    lastAttempt: 1,
  });
  assertEquals(plan, { kind: "existing", attempt: existing });
});

Deno.test("planStartAttempt: an in-flight needs_review row also wins (idempotent, not a second insert)", () => {
  const existing = { id: "22222222-2222-2222-2222-222222222222", state: "needs_review" as const, attempt: 2 };
  const plan = planStartAttempt({
    profileStatus: "active",
    verificationStatus: "manual_review",
    existing,
    lastAttempt: 2,
  });
  assertEquals(plan, { kind: "existing", attempt: existing });
});

Deno.test("planStartAttempt: a 4th attempt is refused (decision 27's permanent-block default)", () => {
  const plan = planStartAttempt({
    profileStatus: "active",
    verificationStatus: "id_failed",
    existing: null,
    lastAttempt: 3,
  });
  assertEquals(plan, { kind: "refused", reason: "attempt_cap_reached" });
  assertEquals(ATTEMPT_CAP_ERROR_PATTERN.test("verification attempt cap reached (decision 8 default: permanent block)"), true);
});

Deno.test("planStartAttempt: a restart after a failed attempt increments the attempt number", () => {
  const plan = planStartAttempt({
    profileStatus: "active",
    verificationStatus: "id_failed",
    existing: null,
    lastAttempt: 1,
  });
  assertEquals(plan, { kind: "new", attempt: 2 });
});

Deno.test("planStartAttempt: the very first attempt for a brand new user has no lastAttempt", () => {
  const plan = planStartAttempt({
    profileStatus: "onboarding",
    verificationStatus: "email_verified",
    existing: null,
    lastAttempt: null,
  });
  assertEquals(plan, { kind: "new", attempt: 1 });
});
