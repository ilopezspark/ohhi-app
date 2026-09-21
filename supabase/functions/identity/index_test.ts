// Routing, authorization, rate limiting and log hygiene for the four routes.
// Exercises router.ts (which index.ts only wires up) against a fake Db and fake
// crypto, so nothing here opens a socket.

import { assert, assertEquals, assertNotEquals } from "@std/assert";
import type { CardRow, Db, IdentityRow, WriteResult } from "./db.ts";
import {
  createHandler,
  RATE_LIMIT_MAX,
  resetRateLimit,
  type RouterDeps,
  routeSegments,
} from "./router.ts";

const OWNER = "11111111-1111-4111-8111-111111111111";
const VIEWER = "22222222-2222-4222-8222-222222222222";
const STRANGER = "33333333-3333-4333-8333-333333333333";

const WRITE_RESULT: WriteResult = {
  key_version: 1,
  fields_filled: 0,
  updated_at: "2026-09-21T00:00:00.000Z",
};

// A fake "ciphertext": the crypto fake below JSON-encodes the payload straight
// into the bytes, so a route that returns plaintext it never decrypted, or
// decrypts with the wrong domain key, shows up as a mismatch.
const enc = new TextEncoder();
const dec = new TextDecoder();

function fakeCiphertext(domain: string, payload: unknown): Uint8Array {
  return enc.encode(JSON.stringify({ domain, payload }));
}

interface FakeState {
  identity?: IdentityRow | null;
  card?: CardRow | null;
  shareActive?: boolean;
  failWith?: Error;
}

interface Harness {
  handle: (req: Request) => Promise<Response>;
  calls: string[];
  logs: Record<string, unknown>[];
  writes: unknown[][];
}

function harness(state: FakeState, uid: string | null = OWNER): Harness {
  const calls: string[] = [];
  const writes: unknown[][] = [];
  const logs: Record<string, unknown>[] = [];

  const db: Db = {
    getIdentity(userId, callerId) {
      calls.push(`getIdentity:${userId}:${callerId}`);
      if (state.failWith) return Promise.reject(state.failWith);
      return Promise.resolve(state.identity ?? null);
    },
    getCard(userId) {
      calls.push(`getCard:${userId}`);
      if (state.failWith) return Promise.reject(state.failWith);
      return Promise.resolve(state.card ?? null);
    },
    cardShareIsActive(ownerId, viewerId) {
      calls.push(`cardShareIsActive:${ownerId}:${viewerId}`);
      return Promise.resolve(state.shareActive === true);
    },
    writeIdentity(userId, ciphertext, keyVersion, fieldsFilled, isPublic) {
      calls.push(`writeIdentity:${userId}`);
      writes.push([userId, ciphertext, keyVersion, fieldsFilled, isPublic]);
      return Promise.resolve({ ...WRITE_RESULT, fields_filled: fieldsFilled });
    },
    writeCard(userId, ciphertext, keyVersion, fieldsFilled) {
      calls.push(`writeCard:${userId}`);
      writes.push([userId, ciphertext, keyVersion, fieldsFilled]);
      return Promise.resolve({ ...WRITE_RESULT, fields_filled: fieldsFilled });
    },
  };

  const deps: RouterDeps = {
    db,
    callerUid: () => Promise.resolve(uid),
    encrypt: (domain, payload) =>
      Promise.resolve({ ciphertext: fakeCiphertext(domain, payload), keyVersion: 1 }),
    decrypt: (domain, ciphertext) => {
      const parsed = JSON.parse(dec.decode(ciphertext));
      if (parsed.domain !== domain) {
        return Promise.reject(new Error("wrong domain key"));
      }
      return Promise.resolve(parsed.payload);
    },
    log: (entry) => logs.push(entry),
  };

  resetRateLimit();
  return { handle: createHandler(deps), calls, logs, writes };
}

function get(path: string): Request {
  return new Request(`https://p.supabase.co/functions/v1${path}`, {
    headers: { Authorization: "Bearer token" },
  });
}

function put(path: string, body: unknown): Request {
  return new Request(`https://p.supabase.co/functions/v1${path}`, {
    method: "PUT",
    headers: { Authorization: "Bearer token", "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const identityRow = (isPublic: boolean, blocked = false): IdentityRow => ({
  is_public: isPublic,
  blocked,
  payload_ciphertext: fakeCiphertext("identity", {
    pronouns: "she/her",
    orientation: ["bi"],
  }),
  key_version: 1,
});

const cardRow = (): CardRow => ({
  payload_ciphertext: fakeCiphertext("card", {
    into: ["top"],
    safer_sex: ["condoms"],
    kinks: [],
    hard_nos: [],
  }),
  key_version: 1,
});

// ---------------------------------------------------------------------------
// Path normalization
// ---------------------------------------------------------------------------

Deno.test("routing: both spellings of each route normalize to the same segments", () => {
  assertEquals(routeSegments("/functions/v1/identity"), []);
  assertEquals(routeSegments("/functions/v1/identity/identity"), []);
  assertEquals(routeSegments(`/functions/v1/identity/${OWNER}`), [OWNER]);
  assertEquals(routeSegments(`/functions/v1/identity/identity/${OWNER}`), [OWNER]);
  assertEquals(routeSegments("/functions/v1/identity/card"), ["card"]);
  assertEquals(routeSegments(`/functions/v1/identity/card/${OWNER}`), ["card", OWNER]);
  // The edge runtime hands the function a path without the /functions/v1 mount.
  assertEquals(routeSegments(`/identity/card/${OWNER}`), ["card", OWNER]);
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

Deno.test("auth: no verified caller is 401, and no DB call is made", async () => {
  const h = harness({ identity: identityRow(true) }, null);
  const res = await h.handle(get(`/identity/${OWNER}`));
  assertEquals(res.status, 401);
  assertEquals((await res.json()).error.code, "unauthenticated");
  assertEquals(h.calls, []);
});

Deno.test("auth: 401 is returned before the rate limit is consulted", async () => {
  const h = harness({}, null);
  for (let i = 0; i < RATE_LIMIT_MAX + 5; i++) {
    assertEquals((await h.handle(get("/identity"))).status, 401);
  }
});

// ---------------------------------------------------------------------------
// GET /identity/:user_id
// ---------------------------------------------------------------------------

Deno.test("GET identity: the owner reads their own private row", async () => {
  const h = harness({ identity: identityRow(false) }, OWNER);
  const res = await h.handle(get(`/identity/${OWNER}`));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    user_id: OWNER,
    pronouns: "she/her",
    orientation: ["bi"],
    is_public: false,
  });
});

Deno.test("GET identity: a non-owner is refused when is_public is false", async () => {
  const h = harness({ identity: identityRow(false) }, VIEWER);
  const res = await h.handle(get(`/identity/${OWNER}`));
  assertEquals(res.status, 404);
  assertEquals(await res.json(), { error: { code: "not_found", message: "Not found." } });
});

Deno.test("GET identity: a non-owner reads it once is_public is true", async () => {
  const h = harness({ identity: identityRow(true) }, VIEWER);
  const res = await h.handle(get(`/identity/${OWNER}`));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.pronouns, "she/her");
  // Never card keys on an identity response.
  assertEquals(
    Object.keys(body).sort(),
    ["is_public", "orientation", "pronouns", "user_id"],
  );
});

Deno.test("GET identity: a blocked non-owner is refused even when is_public is true", async () => {
  // private.is_blocked is symmetric (either direction blocks), so the fake's
  // single `blocked` flag stands in for both directions — the direction split
  // lives in the SQL function itself, already covered elsewhere.
  const h = harness({ identity: identityRow(true, true) }, VIEWER);
  const res = await h.handle(get(`/identity/${OWNER}`));
  assertEquals(res.status, 404);
  assertEquals(await res.json(), { error: { code: "not_found", message: "Not found." } });
});

Deno.test("GET identity: a non-owner who is not blocked reads a public row", async () => {
  const h = harness({ identity: identityRow(true, false) }, VIEWER);
  const res = await h.handle(get(`/identity/${OWNER}`));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).pronouns, "she/her");
});

Deno.test("GET identity: the owner reads their own row while blocked with someone else", async () => {
  const h = harness({ identity: identityRow(false, true) }, OWNER);
  const res = await h.handle(get(`/identity/${OWNER}`));
  assertEquals(res.status, 200);
});

Deno.test("GET identity: a nonexistent user is byte-identical to an unauthorized 404", async () => {
  const missing = await harness({ identity: null }, VIEWER).handle(
    get(`/identity/${STRANGER}`),
  );
  const denied = await harness({ identity: identityRow(false) }, VIEWER)
    .handle(get(`/identity/${OWNER}`));
  assertEquals(missing.status, denied.status);
  assertEquals(await missing.text(), await denied.text());
});

Deno.test("GET identity: a row with a null ciphertext is a 404, not a crash", async () => {
  const h = harness({
    identity: { is_public: true, payload_ciphertext: null, key_version: 1, blocked: false },
  }, VIEWER);
  assertEquals((await h.handle(get(`/identity/${OWNER}`))).status, 404);
});

// ---------------------------------------------------------------------------
// GET /card/:user_id
// ---------------------------------------------------------------------------

Deno.test("GET card: the owner reads their own card without a share check", async () => {
  const h = harness({ card: cardRow() }, OWNER);
  const res = await h.handle(get(`/identity/card/${OWNER}`));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    user_id: OWNER,
    into: ["top"],
    safer_sex: ["condoms"],
    kinks: [],
    hard_nos: [],
  });
  assert(!h.calls.some((c) => c.startsWith("cardShareIsActive")));
});

Deno.test("GET card: a non-owner with no active share is refused", async () => {
  const h = harness({ card: cardRow(), shareActive: false }, VIEWER);
  const res = await h.handle(get(`/identity/card/${OWNER}`));
  assertEquals(res.status, 404);
  assertEquals((await res.json()).error.code, "not_found");
  // Asked in the owner/viewer order the SQL helper expects.
  assert(h.calls.includes(`cardShareIsActive:${OWNER}:${VIEWER}`));
});

Deno.test("GET card: a non-owner with an active share reads it", async () => {
  const h = harness({ card: cardRow(), shareActive: true }, VIEWER);
  const res = await h.handle(get(`/identity/card/${OWNER}`));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).into, ["top"]);
});

Deno.test("GET card: a card response carries no identity keys", async () => {
  const h = harness({ card: cardRow() }, OWNER);
  const body = await (await h.handle(get(`/identity/card/${OWNER}`))).json();
  for (const key of ["pronouns", "orientation", "is_public"]) {
    assertEquals(Object.hasOwn(body, key), false, key);
  }
});

// ---------------------------------------------------------------------------
// PUT /identity and PUT /card
// ---------------------------------------------------------------------------

Deno.test("PUT identity: writes for the caller only and echoes public columns", async () => {
  const h = harness({}, OWNER);
  const res = await h.handle(
    put("/identity", { pronouns: "she/her", orientation: ["bi"], is_public: true }),
  );
  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    user_id: OWNER,
    key_version: 1,
    fields_filled: 2,
    updated_at: WRITE_RESULT.updated_at,
  });
  assertEquals(h.calls, [`writeIdentity:${OWNER}`]);
  const [userId, ciphertext, , fieldsFilled, isPublic] = h.writes[0];
  assertEquals(userId, OWNER);
  assertEquals(fieldsFilled, 2);
  assertEquals(isPublic, true);
  // The encrypted payload holds the plaintext fields and nothing else.
  assertEquals(JSON.parse(dec.decode(ciphertext as Uint8Array)), {
    domain: "identity",
    payload: { pronouns: "she/her", orientation: ["bi"] },
  });
});

Deno.test("PUT identity: is_public is a column, never part of the ciphertext", async () => {
  const h = harness({}, OWNER);
  await h.handle(put("/identity", { pronouns: null, orientation: [], is_public: true }));
  const payload = JSON.parse(dec.decode(h.writes[0][1] as Uint8Array)).payload;
  assertEquals(Object.hasOwn(payload, "is_public"), false);
});

Deno.test("PUT card: writes for the caller with the right fields_filled", async () => {
  const h = harness({}, OWNER);
  const res = await h.handle(
    put("/identity/card", {
      into: ["top"],
      safer_sex: ["condoms"],
      kinks: [],
      hard_nos: ["no drugs"],
    }),
  );
  assertEquals(res.status, 200);
  assertEquals((await res.json()).fields_filled, 3);
  assertEquals(h.calls, [`writeCard:${OWNER}`]);
});

Deno.test("PUT: a schema violation is a 400 and reaches no DB call", async () => {
  const h = harness({}, OWNER);
  const res = await h.handle(
    put("/identity", { pronouns: null, orientation: ["martian"], is_public: false }),
  );
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error.code, "validation_failed");
  assertEquals(h.calls, []);
});

Deno.test("PUT: malformed JSON is a 400 that does not echo the body", async () => {
  const h = harness({}, OWNER);
  const secret = "pronouns-the-caller-typed";
  const res = await h.handle(put("/identity", `{ "pronouns": "${secret}" `));
  assertEquals(res.status, 400);
  const text = await res.text();
  assertEquals(text.includes(secret), false);
  assertEquals(JSON.stringify(h.logs).includes(secret), false);
});

// ---------------------------------------------------------------------------
// Unknown routes and methods
// ---------------------------------------------------------------------------

Deno.test("routing: unknown paths and wrong methods are the generic 404", async () => {
  const h = harness({ identity: identityRow(true), card: cardRow() }, OWNER);
  const cases = [
    get("/identity/not-a-uuid"),
    get(`/identity/card/${OWNER}/extra`),
    get("/identity/card"),
    get("/identity"),
    put(`/identity/${OWNER}`, {}),
    put(`/identity/card/${OWNER}`, {}),
    new Request(`https://p.supabase.co/functions/v1/identity/${OWNER}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer token" },
    }),
  ];
  for (const req of cases) {
    const res = await h.handle(req);
    assertEquals(res.status, 404, `${req.method} ${req.url}`);
    assertEquals((await res.json()).error.code, "not_found");
  }
  assertEquals(h.calls, []);
});

// ---------------------------------------------------------------------------
// Rate limit (decision 22)
// ---------------------------------------------------------------------------

Deno.test("rate limit: the 31st request in a window is 429", async () => {
  const h = harness({ identity: identityRow(false) }, OWNER);
  for (let i = 0; i < RATE_LIMIT_MAX; i++) {
    assertEquals(
      (await h.handle(get(`/identity/${OWNER}`))).status,
      200,
      `request ${i + 1}`,
    );
  }
  const res = await h.handle(get(`/identity/${OWNER}`));
  assertEquals(res.status, 429);
  assertEquals((await res.json()).error.code, "rate_limited");
});

Deno.test("rate limit: the budget is per user, not global", async () => {
  const calls: string[] = [];
  let uid = OWNER;
  resetRateLimit();
  const handle = createHandler({
    db: {
      getIdentity: (id) => {
        calls.push(id);
        return Promise.resolve(identityRow(true));
      },
      getCard: () => Promise.resolve(null),
      cardShareIsActive: () => Promise.resolve(false),
      writeIdentity: () => Promise.resolve(WRITE_RESULT),
      writeCard: () => Promise.resolve(WRITE_RESULT),
    },
    callerUid: () => Promise.resolve(uid),
    encrypt: (d, p) => Promise.resolve({ ciphertext: fakeCiphertext(d, p), keyVersion: 1 }),
    decrypt: (_d, c) => Promise.resolve(JSON.parse(dec.decode(c)).payload),
    log: () => {},
  });
  for (let i = 0; i < RATE_LIMIT_MAX; i++) await handle(get(`/identity/${OWNER}`));
  assertEquals((await handle(get(`/identity/${OWNER}`))).status, 429);
  uid = VIEWER;
  assertEquals((await handle(get(`/identity/${OWNER}`))).status, 200);
});

Deno.test("rate limit: the window rolls over", async () => {
  let clock = 1_000_000;
  resetRateLimit();
  const handle = createHandler({
    db: {
      getIdentity: () => Promise.resolve(identityRow(true)),
      getCard: () => Promise.resolve(null),
      cardShareIsActive: () => Promise.resolve(false),
      writeIdentity: () => Promise.resolve(WRITE_RESULT),
      writeCard: () => Promise.resolve(WRITE_RESULT),
    },
    callerUid: () => Promise.resolve(OWNER),
    encrypt: (d, p) => Promise.resolve({ ciphertext: fakeCiphertext(d, p), keyVersion: 1 }),
    decrypt: (_d, c) => Promise.resolve(JSON.parse(dec.decode(c)).payload),
    now: () => clock,
    log: () => {},
  });
  for (let i = 0; i < RATE_LIMIT_MAX; i++) await handle(get(`/identity/${OWNER}`));
  assertEquals((await handle(get(`/identity/${OWNER}`))).status, 429);
  clock += 60_001;
  assertEquals((await handle(get(`/identity/${OWNER}`))).status, 200);
});

// ---------------------------------------------------------------------------
// Failure handling and log hygiene (§5)
// ---------------------------------------------------------------------------

Deno.test("errors: a DB failure is a 500 that leaks neither message nor body", async () => {
  const h = harness(
    { failWith: new Error("connection to db-host:5432 failed for user x") },
    OWNER,
  );
  const res = await h.handle(get(`/identity/${OWNER}`));
  assertEquals(res.status, 500);
  assertEquals(await res.json(), {
    error: { code: "internal_error", message: "Something went wrong." },
  });
  const logged = JSON.stringify(h.logs);
  assertEquals(logged.includes("db-host"), false);
  assert(logged.includes("Error"), "the failure class should still be logged");
});

Deno.test("errors: a decrypt failure is a 500, never a partial plaintext", async () => {
  // Card ciphertext parked in the identity row: the fake crypto refuses the
  // cross-domain key, standing in for a real GCM authentication failure.
  const h = harness({
    identity: {
      is_public: true,
      payload_ciphertext: fakeCiphertext("card", {}),
      key_version: 1,
      blocked: false,
    },
  }, VIEWER);
  assertEquals((await h.handle(get(`/identity/${OWNER}`))).status, 500);
});

Deno.test("logs: every line carries route/user/status and no payload", async () => {
  const h = harness({}, OWNER);
  await h.handle(
    put("/identity", { pronouns: "she/her", orientation: ["bi"], is_public: true }),
  );
  assertEquals(h.logs.length, 1);
  const entry = h.logs[0];
  assertEquals(entry.fn, "identity");
  assertEquals(entry.route, "PUT /");
  assertEquals(entry.user_id, OWNER);
  assertEquals(entry.status, 200);
  assertEquals(typeof entry.ms, "number");
  assertEquals(JSON.stringify(entry).includes("she/her"), false);
});

Deno.test("logs: a user id in the path is redacted from the route label", async () => {
  const h = harness({ identity: identityRow(false) }, OWNER);
  await h.handle(get(`/identity/${OWNER}`));
  assertEquals(h.logs[0].route, "GET /:id");
  assertNotEquals(String(h.logs[0].route).includes(OWNER), true);
});
