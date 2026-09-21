// deno-lint-ignore-file require-await -- fakes implementing an async interface for a synchronous return value.
import { assertEquals } from "@std/assert";
import { createHandler, type Deps, type Logger } from "./index.ts";
import type {
  ApplyResultRpcResult,
  ExistingAttemptRow,
  ProfileForStart,
  RateLimitResult,
  StartAttemptRpcResult,
  VerificationDb,
} from "./db.ts";
import type { IgnoredEvent, NormalizedResult, ProviderSession, SignatureVerification, VerificationProvider } from "./providers/types.ts";

// No network anywhere in this file: every dependency is a hand-written fake implementing the
// same interfaces index.ts depends on (VerificationDb, VerificationProvider, resolveCallerId).

function silentLogger(calls: Array<{ level: string; event: string; fields: Record<string, unknown> }>): Logger {
  return (level, event, fields) => {
    calls.push({ level, event, fields });
  };
}

interface FakeDbOptions {
  profile?: ProfileForStart | null;
  existing?: ExistingAttemptRow | null;
  lastAttempt?: number | null;
  rateLimit?: RateLimitResult;
  startResult?: StartAttemptRpcResult | Error;
  selfDeclaredDob?: string | null;
  applyResult?: ApplyResultRpcResult | Error;
}

interface FakeDbHandle {
  db: VerificationDb;
  calls: {
    setProviderReferenceArgs: Array<{ verificationId: string; providerReference: string }>;
    applyResultArgs: Array<{ outcome: string; verificationId: string }>;
  };
}

function makeFakeDb(opts: FakeDbOptions): FakeDbHandle {
  const calls: FakeDbHandle["calls"] = { setProviderReferenceArgs: [], applyResultArgs: [] };

  const db: VerificationDb = {
    async getProfileForStart() {
      return opts.profile ?? null;
    },
    async getExistingOpenAttempt() {
      return opts.existing ?? null;
    },
    async getLastAttemptNumber() {
      return opts.lastAttempt ?? null;
    },
    async checkAndIncrementStartRateLimit() {
      return opts.rateLimit ?? { count: 1, limited: false };
    },
    async callStartVerificationAttempt() {
      if (opts.startResult instanceof Error) throw opts.startResult;
      return opts.startResult ?? { id: "verif-new", state: "pending", attempt: 1 };
    },
    async setProviderReference(verificationId, providerReference) {
      calls.setProviderReferenceArgs.push({ verificationId, providerReference });
    },
    async getSelfDeclaredDobForVerification() {
      return opts.selfDeclaredDob ?? null;
    },
    async callApplyVerificationResult(input) {
      calls.applyResultArgs.push({ outcome: input.outcome, verificationId: input.verificationId });
      if (opts.applyResult instanceof Error) throw opts.applyResult;
      return opts.applyResult ?? { verificationState: "passed", profileStatus: "verified" };
    },
  };

  return { db, calls };
}

interface FakeProviderOptions {
  session?: ProviderSession;
  resumeSession?: ProviderSession;
  signature?: SignatureVerification;
  parsedEvent?: NormalizedResult | IgnoredEvent | Error;
}

interface FakeProviderHandle {
  provider: VerificationProvider;
  calls: {
    verifySignatureArgs: Array<{ rawBody: string; signatureHeader: string | null }>;
    parseWebhookEventCalled: boolean;
  };
}

function makeFakeProvider(opts: FakeProviderOptions): FakeProviderHandle {
  const calls: FakeProviderHandle["calls"] = { verifySignatureArgs: [], parseWebhookEventCalled: false };

  const provider: VerificationProvider = {
    name: "persona",
    async createSession() {
      return opts.session ?? { providerReference: "inq_new", sessionUrl: "https://verify.example/new" };
    },
    async resumeSession() {
      return opts.resumeSession ?? opts.session ?? { providerReference: "inq_existing", sessionUrl: "https://verify.example/existing" };
    },
    async verifySignature(input) {
      calls.verifySignatureArgs.push({ rawBody: input.rawBody, signatureHeader: input.signatureHeader });
      return opts.signature ?? { valid: true };
    },
    parseWebhookEvent(_rawBody) {
      calls.parseWebhookEventCalled = true;
      if (opts.parsedEvent instanceof Error) throw opts.parsedEvent;
      return opts.parsedEvent ?? { ignored: true, eventName: "inquiry.created" };
    },
  };

  return { provider, calls };
}

/** Mirrors `_shared/supabase.ts`'s `callerUid`: never throws, null is the 401 signal. */
function makeFakeResolveCallerId(userId: string | null): (req: Request) => Promise<string | null> {
  return (req: Request) => {
    const header = req.headers.get("authorization") ?? req.headers.get("Authorization");
    if (!header || !/^Bearer\s+.+/i.test(header.trim())) return Promise.resolve(null);
    return Promise.resolve(userId);
  };
}

function baseDeps(overrides: Partial<Deps> = {}): { deps: Deps; logs: Array<{ level: string; event: string; fields: Record<string, unknown> }> } {
  const logs: Array<{ level: string; event: string; fields: Record<string, unknown> }> = [];
  const { db } = makeFakeDb({});
  const { provider } = makeFakeProvider({});
  const deps: Deps = {
    db,
    provider,
    resolveCallerId: makeFakeResolveCallerId("user-1"),
    webhookSecret: "secret",
    rateLimitPerHour: 5,
    webhookToleranceSeconds: 300,
    dobMismatchToleranceDays: 366,
    log: silentLogger(logs),
    ...overrides,
  };
  return { deps, logs };
}

// ---------------------------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------------------------

Deno.test("routing: GET is never allowed, even on a valid path", async () => {
  const { deps } = baseDeps();
  const handler = createHandler(deps);
  const res = await handler(new Request("https://fn.local/verification/start", { method: "GET" }));
  assertEquals(res.status, 404);
});

Deno.test("routing: an unknown POST path is 404", async () => {
  const { deps } = baseDeps();
  const handler = createHandler(deps);
  const res = await handler(new Request("https://fn.local/verification/nope", { method: "POST" }));
  assertEquals(res.status, 404);
});

// ---------------------------------------------------------------------------------------------
// /start — auth
// ---------------------------------------------------------------------------------------------

Deno.test("/start: missing Authorization header is 401, and no DB/provider call happens", async () => {
  const { db, calls } = makeFakeDb({});
  const { deps } = baseDeps({ db });
  const handler = createHandler(deps);
  const res = await handler(new Request("https://fn.local/verification/start", { method: "POST", body: "{}" }));
  assertEquals(res.status, 401);
  assertEquals(calls.setProviderReferenceArgs.length, 0);
});

Deno.test("/start: an Authorization header without 'Bearer ' is 401", async () => {
  const { deps } = baseDeps();
  const handler = createHandler(deps);
  const res = await handler(
    new Request("https://fn.local/verification/start", {
      method: "POST",
      headers: { authorization: "Basic abc123" },
    }),
  );
  assertEquals(res.status, 401);
});

Deno.test("/start: a JWT the auth client rejects is 401", async () => {
  const { deps } = baseDeps({ resolveCallerId: makeFakeResolveCallerId(null) });
  const handler = createHandler(deps);
  const res = await handler(
    new Request("https://fn.local/verification/start", {
      method: "POST",
      headers: { authorization: "Bearer bad.jwt.token" },
    }),
  );
  assertEquals(res.status, 401);
});

Deno.test("/start: rate limit exceeded is 429 before any RPC is attempted", async () => {
  const { db } = makeFakeDb({ rateLimit: { count: 6, limited: true } });
  const { deps } = baseDeps({ db });
  const handler = createHandler(deps);
  const res = await handler(
    new Request("https://fn.local/verification/start", {
      method: "POST",
      headers: { authorization: "Bearer good.jwt" },
    }),
  );
  assertEquals(res.status, 429);
});

// ---------------------------------------------------------------------------------------------
// /start — happy paths and refusals
// ---------------------------------------------------------------------------------------------

const REQ_HEADERS = { authorization: "Bearer good.jwt" };

Deno.test("/start: eligible profile with no in-flight attempt creates a new session (200)", async () => {
  const { db, calls } = makeFakeDb({
    profile: { status: "active", verificationStatus: "email_verified" },
    existing: null,
    lastAttempt: null,
    startResult: { id: "verif-1", state: "pending", attempt: 1 },
  });
  const { provider } = makeFakeProvider({
    session: { providerReference: "inq_1", sessionUrl: "https://verify.example/1" },
  });
  const { deps } = baseDeps({ db, provider });
  const handler = createHandler(deps);

  const res = await handler(new Request("https://fn.local/verification/start", { method: "POST", headers: REQ_HEADERS }));
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(body, { verification_id: "verif-1", provider: "persona", session_url: "https://verify.example/1", attempt: 1 });
  assertEquals(calls.setProviderReferenceArgs, [{ verificationId: "verif-1", providerReference: "inq_1" }]);
});

Deno.test("/start: an in-flight attempt returns 409 and reuses the existing provider_reference via resumeSession", async () => {
  const existing: ExistingAttemptRow = { id: "verif-inflight", state: "pending", attempt: 1, providerReference: "inq_existing" };
  const { db, calls } = makeFakeDb({
    profile: { status: "active", verificationStatus: "id_pending" },
    existing,
    lastAttempt: 1,
    startResult: { id: "verif-inflight", state: "pending", attempt: 1 },
  });
  const { provider } = makeFakeProvider({
    resumeSession: { providerReference: "inq_existing", sessionUrl: "https://verify.example/resumed" },
  });
  const { deps } = baseDeps({ db, provider });
  const handler = createHandler(deps);

  const res = await handler(new Request("https://fn.local/verification/start", { method: "POST", headers: REQ_HEADERS }));
  const body = await res.json();

  assertEquals(res.status, 409);
  assertEquals(body.session_url, "https://verify.example/resumed");
  // resumeSession was used, not a second setProviderReference write for an already-known reference.
  assertEquals(calls.setProviderReferenceArgs.length, 0);
});

Deno.test("/start: profile not active/onboarding is refused with 403", async () => {
  const { db } = makeFakeDb({ profile: { status: "suspended", verificationStatus: "email_verified" } });
  const { deps } = baseDeps({ db });
  const handler = createHandler(deps);
  const res = await handler(new Request("https://fn.local/verification/start", { method: "POST", headers: REQ_HEADERS }));
  assertEquals(res.status, 403);
});

Deno.test("/start: already verified is refused with 403", async () => {
  const { db } = makeFakeDb({ profile: { status: "active", verificationStatus: "verified" } });
  const { deps } = baseDeps({ db });
  const handler = createHandler(deps);
  const res = await handler(new Request("https://fn.local/verification/start", { method: "POST", headers: REQ_HEADERS }));
  assertEquals(res.status, 403);
});

Deno.test("/start: a 4th attempt is refused with 422", async () => {
  const { db } = makeFakeDb({
    profile: { status: "active", verificationStatus: "id_failed" },
    existing: null,
    lastAttempt: 3,
  });
  const { deps } = baseDeps({ db });
  const handler = createHandler(deps);
  const res = await handler(new Request("https://fn.local/verification/start", { method: "POST", headers: REQ_HEADERS }));
  assertEquals(res.status, 422);
});

Deno.test("/start: the RPC itself refusing (race beyond the plan check) still maps to the right HTTP code", async () => {
  const { db } = makeFakeDb({
    profile: { status: "active", verificationStatus: "email_verified" },
    existing: null,
    lastAttempt: null,
    startResult: new Error("verification attempt cap reached (decision 8 default: permanent block)"),
  });
  const { deps } = baseDeps({ db });
  const handler = createHandler(deps);
  const res = await handler(new Request("https://fn.local/verification/start", { method: "POST", headers: REQ_HEADERS }));
  assertEquals(res.status, 422);
});

// ---------------------------------------------------------------------------------------------
// /webhook — raw body before parse, signature, routing to outcomes
// ---------------------------------------------------------------------------------------------

Deno.test("/webhook: the exact raw body bytes reach verifySignature before any JSON.parse happens", async () => {
  const rawBody = '{\n  "data": { "id": "evt_1" }\n}\n'; // deliberately not minified
  const { provider, calls } = makeFakeProvider({
    signature: { valid: true },
    parsedEvent: { ignored: true, eventName: "inquiry.created" },
  });
  const { deps } = baseDeps({ provider });
  const handler = createHandler(deps);

  const res = await handler(
    new Request("https://fn.local/verification/webhook", {
      method: "POST",
      headers: { "persona-signature": "t=1,v1=whatever" },
      body: rawBody,
    }),
  );

  assertEquals(res.status, 200);
  assertEquals(calls.verifySignatureArgs.length, 1);
  assertEquals(calls.verifySignatureArgs[0].rawBody, rawBody);
});

Deno.test("/webhook: invalid signature is 400 and the payload is never parsed", async () => {
  const { provider, calls } = makeFakeProvider({ signature: { valid: false, reason: "no_matching_signature" } });
  const { deps } = baseDeps({ provider });
  const handler = createHandler(deps);

  const res = await handler(
    new Request("https://fn.local/verification/webhook", {
      method: "POST",
      headers: { "persona-signature": "t=1,v1=bad" },
      body: "{}",
    }),
  );

  assertEquals(res.status, 400);
  assertEquals(calls.parseWebhookEventCalled, false);
});

Deno.test("/webhook: an ignored event type returns 200 without calling apply_verification_result", async () => {
  const { db, calls } = makeFakeDb({});
  const { provider } = makeFakeProvider({ parsedEvent: { ignored: true, eventName: "inquiry.created" } });
  const { deps } = baseDeps({ db, provider });
  const handler = createHandler(deps);

  const res = await handler(
    new Request("https://fn.local/verification/webhook", { method: "POST", body: "{}" }),
  );
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(body, { received: true, ignored: true });
  assertEquals(calls.applyResultArgs.length, 0);
});

Deno.test("/webhook: an approved event applies and returns 200", async () => {
  const normalized: NormalizedResult = {
    eventId: "evt_approved",
    eventName: "inquiry.approved",
    verificationId: "verif-1",
    outcome: "passed",
    providerAccountReference: "acc_1",
    documentDob: null,
  };
  const { db, calls } = makeFakeDb({ applyResult: { verificationState: "passed", profileStatus: "verified" } });
  const { provider } = makeFakeProvider({ parsedEvent: normalized });
  const { deps } = baseDeps({ db, provider });
  const handler = createHandler(deps);

  const res = await handler(new Request("https://fn.local/verification/webhook", { method: "POST", body: "{}" }));
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(body, { received: true });
  assertEquals(calls.applyResultArgs, [{ outcome: "passed", verificationId: "verif-1" }]);
});

Deno.test("/webhook: a refused transition (already-terminal row) is still 200, with a warning logged", async () => {
  const normalized: NormalizedResult = {
    eventId: "evt_declined_again",
    eventName: "inquiry.declined",
    verificationId: "verif-1",
    outcome: "failed",
    providerAccountReference: null,
    documentDob: null,
  };
  const { db } = makeFakeDb({
    applyResult: new Error("verification verif-1 is not open for a result (state=passed)"),
  });
  const { provider } = makeFakeProvider({ parsedEvent: normalized });
  const logs: Array<{ level: string; event: string; fields: Record<string, unknown> }> = [];
  const { deps } = baseDeps({ db, provider, log: silentLogger(logs) });
  const handler = createHandler(deps);

  const res = await handler(new Request("https://fn.local/verification/webhook", { method: "POST", body: "{}" }));
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(body, { received: true, refused: true });
  assertEquals(logs.some((l) => l.level === "warn" && l.event === "verification_webhook_refused_transition"), true);
});

Deno.test("/webhook: a genuine apply failure is 500, not swallowed as a refusal", async () => {
  const normalized: NormalizedResult = {
    eventId: "evt_x",
    eventName: "inquiry.approved",
    verificationId: "verif-1",
    outcome: "passed",
    providerAccountReference: null,
    documentDob: null,
  };
  const { db } = makeFakeDb({ applyResult: new Error("connection reset by peer") });
  const { provider } = makeFakeProvider({ parsedEvent: normalized });
  const { deps } = baseDeps({ db, provider });
  const handler = createHandler(deps);

  const res = await handler(new Request("https://fn.local/verification/webhook", { method: "POST", body: "{}" }));
  assertEquals(res.status, 500);
});

Deno.test("/webhook: a DOB mismatch beyond tolerance overrides 'passed' to 'needs_review' before calling apply (decision 26)", async () => {
  const normalized: NormalizedResult = {
    eventId: "evt_dob",
    eventName: "inquiry.approved",
    verificationId: "verif-1",
    outcome: "passed",
    providerAccountReference: null,
    documentDob: "1990-01-01",
  };
  const { db, calls } = makeFakeDb({
    selfDeclaredDob: "2001-06-15", // more than a year off from the document DOB
    applyResult: { verificationState: "needs_review", profileStatus: "manual_review" },
  });
  const { provider } = makeFakeProvider({ parsedEvent: normalized });
  const { deps } = baseDeps({ db, provider });
  const handler = createHandler(deps);

  const res = await handler(new Request("https://fn.local/verification/webhook", { method: "POST", body: "{}" }));

  assertEquals(res.status, 200);
  assertEquals(calls.applyResultArgs, [{ outcome: "needs_review", verificationId: "verif-1" }]);
});

Deno.test("/webhook: a DOB within tolerance does not override the outcome", async () => {
  const normalized: NormalizedResult = {
    eventId: "evt_dob_close",
    eventName: "inquiry.approved",
    verificationId: "verif-1",
    outcome: "passed",
    providerAccountReference: null,
    documentDob: "2001-06-15",
  };
  const { db, calls } = makeFakeDb({
    selfDeclaredDob: "2001-06-20", // 5 days off, within tolerance
    applyResult: { verificationState: "passed", profileStatus: "verified" },
  });
  const { provider } = makeFakeProvider({ parsedEvent: normalized });
  const { deps } = baseDeps({ db, provider });
  const handler = createHandler(deps);

  await handler(new Request("https://fn.local/verification/webhook", { method: "POST", body: "{}" }));

  assertEquals(calls.applyResultArgs, [{ outcome: "passed", verificationId: "verif-1" }]);
});

Deno.test("/webhook: malformed payload (parseWebhookEvent throws) is 400", async () => {
  const { provider } = makeFakeProvider({ parsedEvent: new Error("persona: webhook payload missing data.id") });
  const { deps } = baseDeps({ provider });
  const handler = createHandler(deps);

  const res = await handler(new Request("https://fn.local/verification/webhook", { method: "POST", body: "not json at all" }));
  assertEquals(res.status, 400);
});
