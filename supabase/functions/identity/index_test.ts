// Routing, authorization, audiences, card sharing, the word filter, rate
// limiting and log hygiene. Exercises router.ts (which index.ts only wires up)
// against a fake Db and fake crypto, so nothing here opens a socket.

import { assert, assertEquals, assertNotEquals } from "@std/assert";
import type {
  CardRow,
  CardWrite,
  Db,
  IdentityRow,
  IdentityWrite,
  StoredIdentity,
  TxTools,
  WriteResult,
} from "./db.ts";
import { type Audiences, defaultAudiences, emptyCard, emptyIdentity } from "./fields.ts";
import {
  createHandler,
  RATE_LIMIT_MAX,
  resetRateLimit,
  routeLabel,
  type RouterDeps,
  routeSegments,
} from "./router.ts";
import { DIRTY_TEXT_MESSAGE, ValidationError } from "./validate.ts";

const OWNER = "11111111-1111-4111-8111-111111111111";
const VIEWER = "22222222-2222-4222-8222-222222222222";
const STRANGER = "33333333-3333-4333-8333-333333333333";

const WRITE_RESULT: WriteResult = {
  key_version: 1,
  fields_filled: 0,
  updated_at: "2026-09-30T00:00:00.000Z",
};

// A fake "ciphertext": the crypto fake below JSON-encodes the payload straight
// into the bytes, so a route that returns plaintext it never decrypted, or
// decrypts with the wrong domain key, shows up as a mismatch.
const enc = new TextEncoder();
const dec = new TextDecoder();

function fakeCiphertext(domain: string, payload: unknown): Uint8Array {
  return enc.encode(JSON.stringify({ domain, payload }));
}
function plaintextOf(
  ciphertext: Uint8Array,
): { domain: string; payload: Record<string, unknown> } {
  return JSON.parse(dec.decode(ciphertext));
}

interface FakeState {
  identity?: IdentityRow | null;
  card?: CardRow | null;
  /** private.card_share_sections: null = no active share. */
  shareSections?: string[] | null;
  /** Texts private.text_is_clean rejects. */
  dirty?: string[];
  failWith?: Error;
}

interface Harness {
  handle: (req: Request) => Promise<Response>;
  calls: string[];
  logs: Record<string, unknown>[];
  identityWrites: IdentityWrite[];
  cardWrites: CardWrite[];
  filtered: string[];
}

function fakeDb(
  state: FakeState,
  calls: string[],
  identityWrites: IdentityWrite[],
  cardWrites: CardWrite[],
  filtered: string[],
): Db {
  const tools: TxTools = {
    assertClean(texts) {
      calls.push("assertClean");
      filtered.push(...texts);
      if (texts.some((t) => state.dirty?.includes(t))) {
        return Promise.reject(new ValidationError(DIRTY_TEXT_MESSAGE));
      }
      return Promise.resolve();
    },
  };
  return {
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
    cardShareSections(ownerId, viewerId) {
      calls.push(`cardShareSections:${ownerId}:${viewerId}`);
      return Promise.resolve(
        state.shareSections === undefined ? null : state.shareSections,
      );
    },
    async updateIdentity(userId, build) {
      calls.push(`updateIdentity:${userId}`);
      const current: StoredIdentity | null = state.identity ?? null;
      const write = await build(current, tools);
      identityWrites.push(write);
      return { ...WRITE_RESULT, fields_filled: write.fieldsFilled };
    },
    async updateCard(userId, build) {
      calls.push(`updateCard:${userId}`);
      const write = await build(state.card ?? null, tools);
      cardWrites.push(write);
      return { ...WRITE_RESULT, fields_filled: write.fieldsFilled };
    },
  };
}

function fakeCrypto(): Pick<RouterDeps, "encrypt" | "decrypt"> {
  return {
    encrypt: (domain, payload) =>
      Promise.resolve({ ciphertext: fakeCiphertext(domain, payload), keyVersion: 1 }),
    decrypt: (domain, ciphertext) => {
      const parsed = plaintextOf(ciphertext);
      if (parsed.domain !== domain) {
        return Promise.reject(new Error("wrong domain key"));
      }
      return Promise.resolve(parsed.payload);
    },
  };
}

function harness(state: FakeState, uid: string | null = OWNER): Harness {
  const calls: string[] = [];
  const identityWrites: IdentityWrite[] = [];
  const cardWrites: CardWrite[] = [];
  const filtered: string[] = [];
  const logs: Record<string, unknown>[] = [];
  const deps: RouterDeps = {
    db: fakeDb(state, calls, identityWrites, cardWrites, filtered),
    callerUid: () => Promise.resolve(uid),
    ...fakeCrypto(),
    log: (entry) => logs.push(entry),
  };
  resetRateLimit();
  return { handle: createHandler(deps), calls, logs, identityWrites, cardWrites, filtered };
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A v2 identity payload with every card filled. */
const FULL_IDENTITY = {
  ...emptyIdentity(),
  pronouns: ["she/her", "they/them"],
  orientation: ["bi"],
  interested_in: ["women", "nonbinary people"],
  relationship: "single",
  languages: ["english", "tagalog"],
  faith: "catholic",
  faith_weight: "somewhat",
  drinking: "socially",
  kids: "not sure",
  when_free: ["evenings"],
  communication: ["i'm direct"],
  photos_content: ["don't screenshot"],
};

function identityRow(opts: {
  payload?: unknown;
  version?: number;
  audiences?: Partial<Audiences>;
  blocked?: boolean;
  gateOpen?: boolean;
  isPublic?: boolean;
} = {}): IdentityRow {
  const audiences = { ...defaultAudiences(), ...opts.audiences };
  return {
    is_public: opts.isPublic ?? audiences.identity === "everyone",
    payload_ciphertext: fakeCiphertext("identity", opts.payload ?? FULL_IDENTITY),
    key_version: 1,
    payload_version: opts.version ?? 2,
    audiences,
    blocked: opts.blocked ?? false,
    gate_open: opts.gateOpen ?? false,
  };
}

const FULL_CARD = {
  ...emptyCard(),
  shows_interest: ["food", "making time"],
  pace: "slow",
  hosting: "i can't host",
  safer_sex: ["condoms", "tested recently"],
  dynamics: ["switch"],
  practices: [],
  hard_nos: ["no calls", "no loud music"],
  privacy: ["keep this between us"],
};

function cardRow(payload: unknown = FULL_CARD, version = 2): CardRow {
  return {
    payload_ciphertext: fakeCiphertext("card", payload),
    key_version: 1,
    payload_version: version,
  };
}

async function bodyOf(res: Response): Promise<Record<string, unknown>> {
  return await res.json();
}

const NOT_FOUND = { error: { code: "not_found", message: "Not found." } };

// ---------------------------------------------------------------------------
// Path normalization and log labels
// ---------------------------------------------------------------------------

Deno.test("routing: both spellings of each route normalize to the same segments", () => {
  assertEquals(routeSegments("/functions/v1/identity"), []);
  assertEquals(routeSegments("/functions/v1/identity/identity"), []);
  assertEquals(routeSegments(`/functions/v1/identity/${OWNER}`), [OWNER]);
  assertEquals(routeSegments(`/functions/v1/identity/identity/${OWNER}`), [OWNER]);
  assertEquals(routeSegments("/functions/v1/identity/card"), ["card"]);
  assertEquals(routeSegments(`/functions/v1/identity/card/${OWNER}`), ["card", OWNER]);
  assertEquals(routeSegments(`/identity/card/${OWNER}/reveal/dynamics`), [
    "card",
    OWNER,
    "reveal",
    "dynamics",
  ]);
});

Deno.test("logs: user ids and a revealed section name are redacted from the route label", () => {
  assertEquals(routeLabel("GET", [OWNER]), "GET /:id");
  assertEquals(
    routeLabel("GET", ["card", OWNER, "reveal", "practices"]),
    "GET /card/:id/reveal/:section",
  );
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

Deno.test("auth: no verified caller is 401, and no DB call is made", async () => {
  const h = harness({ identity: identityRow() }, null);
  const res = await h.handle(get(`/identity/${OWNER}`));
  assertEquals(res.status, 401);
  assertEquals((await bodyOf(res)).error, {
    code: "unauthenticated",
    message: "A valid Supabase access token is required.",
  });
  assertEquals(h.calls, []);
});

Deno.test("auth: 401 is returned before the rate limit is consulted", async () => {
  const h = harness({}, null);
  for (let i = 0; i < RATE_LIMIT_MAX + 5; i++) {
    assertEquals((await h.handle(get("/identity"))).status, 401);
  }
});

// ---------------------------------------------------------------------------
// GET /identity/:user_id — owner
// ---------------------------------------------------------------------------

Deno.test("GET identity: the owner gets every card, the audiences and is_public", async () => {
  const h = harness({
    identity: identityRow({ audiences: { identity: "only_me", lifestyle: "after_hi" } }),
  }, OWNER);
  const res = await h.handle(get(`/identity/${OWNER}`));
  assertEquals(res.status, 200);
  const body = await bodyOf(res);
  assertEquals(body.user_id, OWNER);
  assertEquals(body.audiences, {
    identity: "only_me",
    background: "everyone",
    lifestyle: "after_hi",
    around: "everyone",
  });
  assertEquals(body.is_public, false);
  const cards = body.cards as Record<string, Record<string, unknown>>;
  assertEquals(Object.keys(cards), [
    "identity",
    "background",
    "lifestyle",
    "around",
    "before_you_message",
  ]);
  assertEquals(cards.identity, {
    pronouns: ["she/her", "they/them"],
    orientation: ["bi"],
    interested_in: ["women", "nonbinary people"],
    relationship: "single",
  });
  assertEquals(cards.background, {
    languages: ["english", "tagalog"],
    faith: "catholic",
    faith_weight: "somewhat",
    politics: null,
    politics_weight: null,
  });
  assertEquals(cards.lifestyle, {
    drinking: "socially",
    smoking: null,
    four_twenty: null,
    kids: "not sure",
  });
  assertEquals(cards.around, { when_free: ["evenings"], communication: ["i'm direct"] });
  assertEquals(cards.before_you_message, { photos_content: ["don't screenshot"] });
  // Transitional v1 keys.
  assertEquals(body.pronouns, "she/her");
  assertEquals(body.orientation, ["bi"]);
});

Deno.test("GET identity: the owner sees empty cards too, and never needs the gate", async () => {
  const h = harness({ identity: identityRow({ payload: {}, blocked: true }) }, OWNER);
  const body = await bodyOf(await h.handle(get(`/identity/${OWNER}`)));
  const cards = body.cards as Record<string, unknown>;
  assertEquals(Object.keys(cards).length, 5);
  assertEquals((cards.identity as Record<string, unknown>).pronouns, []);
  assertEquals(body.pronouns, null);
});

Deno.test("GET identity: a v1 row is mapped on read", async () => {
  const h = harness({
    identity: identityRow({
      payload: { pronouns: "she/her", orientation: ["bi"] },
      version: 1,
    }),
  }, OWNER);
  const body = await bodyOf(await h.handle(get(`/identity/${OWNER}`)));
  const cards = body.cards as Record<string, Record<string, unknown>>;
  assertEquals(cards.identity.pronouns, ["she/her"]);
  assertEquals(cards.identity.orientation, ["bi"]);
  assertEquals(cards.background.languages, []);
});

Deno.test("GET identity: a row that was never written is a 404, including for the owner", async () => {
  assertEquals(
    (await harness({ identity: null }, OWNER).handle(get(`/identity/${OWNER}`))).status,
    404,
  );
  const nullCipher = { ...identityRow(), payload_ciphertext: null };
  assertEquals(
    (await harness({ identity: nullCipher }, VIEWER).handle(get(`/identity/${OWNER}`)))
      .status,
    404,
  );
});

// ---------------------------------------------------------------------------
// GET /identity/:user_id — the audience matrix (ruling 1)
// ---------------------------------------------------------------------------

const MIXED = {
  identity: "everyone",
  background: "after_hi",
  lifestyle: "only_me",
  around: "after_hi",
} as const;

async function viewerCards(row: IdentityRow): Promise<[number, Record<string, unknown>]> {
  const res = await harness({ identity: row }, VIEWER).handle(get(`/identity/${OWNER}`));
  const body = await bodyOf(res);
  return [res.status, body];
}

Deno.test("audience: a stranger sees everyone cards and before-you-message only", async () => {
  const [status, body] = await viewerCards(
    identityRow({ audiences: MIXED, gateOpen: false }),
  );
  assertEquals(status, 200);
  assertEquals(Object.keys(body.cards as object), ["identity", "before_you_message"]);
  // Never the owner's settings.
  assertEquals(Object.hasOwn(body, "audiences"), false);
  assertEquals(Object.hasOwn(body, "is_public"), false);
});

Deno.test("audience: once a hi is answered (gate open) after_hi cards appear, only_me never", async () => {
  const [, body] = await viewerCards(identityRow({ audiences: MIXED, gateOpen: true }));
  assertEquals(Object.keys(body.cards as object), [
    "identity",
    "background",
    "around",
    "before_you_message",
  ]);
});

Deno.test("audience: after_hi with the gate closed is the same as only_me", async () => {
  const [, closed] = await viewerCards(
    identityRow({ audiences: { background: "after_hi" }, gateOpen: false }),
  );
  const [, hidden] = await viewerCards(
    identityRow({ audiences: { background: "only_me" }, gateOpen: true }),
  );
  assertEquals(closed, hidden);
});

Deno.test("audience: a blocked viewer is refused even when every card is everyone", async () => {
  const [status, body] = await viewerCards(identityRow({ blocked: true, gateOpen: true }));
  assertEquals(status, 404);
  assertEquals(body, NOT_FOUND);
});

Deno.test("audience: a hidden owner (suspended, banned, deleted) is the same 404", async () => {
  // private.is_visible_user folds into the row's `blocked` flag in SQL.
  const [status, body] = await viewerCards(identityRow({ blocked: true }));
  assertEquals(status, 404);
  assertEquals(body, NOT_FOUND);
});

Deno.test("audience: all only_me and nothing to message about is the same 404 as no row", async () => {
  const allHidden = identityRow({
    payload: { ...FULL_IDENTITY, photos_content: [] },
    audiences: {
      identity: "only_me",
      background: "only_me",
      lifestyle: "only_me",
      around: "only_me",
    },
    gateOpen: true,
  });
  const hidden = await harness({ identity: allHidden }, VIEWER).handle(
    get(`/identity/${OWNER}`),
  );
  const missing = await harness({ identity: null }, VIEWER).handle(
    get(`/identity/${STRANGER}`),
  );
  const blocked = await harness({ identity: identityRow({ blocked: true }) }, VIEWER)
    .handle(get(`/identity/${OWNER}`));
  assertEquals(hidden.status, 404);
  const text = await hidden.text();
  assertEquals(text, await missing.text());
  assertEquals(text, await blocked.text());
});

Deno.test("audience: photos & content is shown to everyone once filled, whatever the audiences", async () => {
  const [status, body] = await viewerCards(identityRow({
    audiences: {
      identity: "only_me",
      background: "only_me",
      lifestyle: "only_me",
      around: "only_me",
    },
  }));
  assertEquals(status, 200);
  assertEquals(body.cards, {
    before_you_message: { photos_content: ["don't screenshot"] },
  });
  // No identity card, so no transitional v1 keys either.
  assertEquals(Object.hasOwn(body, "pronouns"), false);
  assertEquals(Object.hasOwn(body, "orientation"), false);
});

Deno.test("audience: an empty card is omitted for a viewer, even when its audience is everyone", async () => {
  const [, body] = await viewerCards(identityRow({
    payload: { pronouns: ["he/him"] },
  }));
  assertEquals(Object.keys(body.cards as object), ["identity"]);
  assertEquals(body.pronouns, "he/him");
});

Deno.test("audience: a public v1 row still reads for a viewer, with the v1 keys", async () => {
  const [status, body] = await viewerCards(identityRow({
    payload: { pronouns: "they/them", orientation: ["queer"] },
    version: 1,
  }));
  assertEquals(status, 200);
  assertEquals(body.pronouns, "they/them");
  assertEquals(body.orientation, ["queer"]);
  assertEquals(
    (body.cards as Record<string, Record<string, unknown>>).identity.pronouns,
    ["they/them"],
  );
});

Deno.test("audience: getIdentity is asked with the caller, so SQL can compute block and gate", async () => {
  const h = harness({ identity: identityRow() }, VIEWER);
  await h.handle(get(`/identity/${OWNER}`));
  assertEquals(h.calls, [`getIdentity:${OWNER}:${VIEWER}`]);
});

// ---------------------------------------------------------------------------
// GET /identity/card/:user_id
// ---------------------------------------------------------------------------

Deno.test("GET card: the owner reads all nine sections without a share check", async () => {
  const h = harness({ card: cardRow() }, OWNER);
  const res = await h.handle(get(`/identity/card/${OWNER}`));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { user_id: OWNER, ...FULL_CARD, gated: [] });
  assert(!h.calls.some((c) => c.startsWith("cardShareSections")));
});

Deno.test("GET card: a v1 card is mapped on read (kinks split, into dropped)", async () => {
  const h = harness({
    card: cardRow(
      {
        into: ["men"],
        safer_sex: ["tested apr '26"],
        kinks: ["dom", "toys"],
        hard_nos: [],
      },
      1,
    ),
  }, OWNER);
  const body = await bodyOf(await h.handle(get(`/identity/card/${OWNER}`)));
  assertEquals(body.safer_sex, ["tested recently"]);
  assertEquals(body.dynamics, ["dominant"]);
  assertEquals(body.practices, ["toys"]);
  assertEquals(Object.hasOwn(body, "into"), false);
  assertEquals(Object.hasOwn(body, "kinks"), false);
});

Deno.test("GET card: a viewer with no active share is refused, asked owner-then-viewer", async () => {
  const h = harness({ card: cardRow(), shareSections: null }, VIEWER);
  const res = await h.handle(get(`/identity/card/${OWNER}`));
  assertEquals(res.status, 404);
  assertEquals(await res.json(), NOT_FOUND);
  assert(h.calls.includes(`cardShareSections:${OWNER}:${VIEWER}`));
  // No share, no ciphertext fetched.
  assert(!h.calls.some((c) => c.startsWith("getCard")));
});

Deno.test("GET card: a share with nothing ticked gives standard + boundaries and no covers", async () => {
  const h = harness({ card: cardRow(), shareSections: [] }, VIEWER);
  const res = await h.handle(get(`/identity/card/${OWNER}`));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    user_id: OWNER,
    shows_interest: ["food", "making time"],
    pace: "slow",
    living_situation: null,
    hosting: "i can't host",
    hard_nos: ["no calls", "no loud music"],
    privacy: ["keep this between us"],
    gated: [],
  });
});

Deno.test("GET card: ticked sections come back as cover names only, never content", async () => {
  const h = harness(
    { card: cardRow(), shareSections: ["practices", "safer_sex", "dynamics"] },
    VIEWER,
  );
  const body = await bodyOf(await h.handle(get(`/identity/card/${OWNER}`)));
  // Group order; practices is ticked but empty, so it gets no cover.
  assertEquals(body.gated, ["safer_sex", "dynamics"]);
  for (const key of ["safer_sex", "dynamics", "practices"]) {
    assertEquals(Object.hasOwn(body, key), false, key);
  }
  assertEquals(JSON.stringify(body).includes("condoms"), false);
  assertEquals(JSON.stringify(body).includes("switch"), false);
});

Deno.test("GET card: an unticked gated section is not even named", async () => {
  const h = harness({ card: cardRow(), shareSections: ["safer_sex"] }, VIEWER);
  const body = await bodyOf(await h.handle(get(`/identity/card/${OWNER}`)));
  assertEquals(body.gated, ["safer_sex"]);
});

Deno.test("GET card: revoke and vanish take effect on the next read (share -> null)", async () => {
  const state: FakeState = { card: cardRow(), shareSections: ["safer_sex"] };
  const h = harness(state, VIEWER);
  assertEquals((await h.handle(get(`/identity/card/${OWNER}`))).status, 200);
  // Revoked, blocked, owner hidden or viewer unverified: card_share_sections is null.
  state.shareSections = null;
  const after = await h.handle(get(`/identity/card/${OWNER}`));
  assertEquals(after.status, 404);
  assertEquals(await after.json(), NOT_FOUND);
  assertEquals(
    (await h.handle(get(`/identity/card/${OWNER}/reveal/safer_sex`))).status,
    404,
  );
});

Deno.test("GET card: an active share but no card row is the same 404", async () => {
  const res = await harness({ card: null, shareSections: [] }, VIEWER)
    .handle(get(`/identity/card/${OWNER}`));
  assertEquals(res.status, 404);
});

Deno.test("GET card: a card response carries no identity keys", async () => {
  const body = await bodyOf(
    await harness({ card: cardRow() }, OWNER).handle(
      get(`/identity/card/${OWNER}`),
    ),
  );
  for (const key of ["pronouns", "orientation", "is_public", "interested_in", "cards"]) {
    assertEquals(Object.hasOwn(body, key), false, key);
  }
});

// ---------------------------------------------------------------------------
// GET /identity/card/:user_id/reveal/:section
// ---------------------------------------------------------------------------

Deno.test("reveal: a ticked section returns just that section's values", async () => {
  const h = harness({ card: cardRow(), shareSections: ["safer_sex", "dynamics"] }, VIEWER);
  const res = await h.handle(get(`/identity/card/${OWNER}/reveal/safer_sex`));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    user_id: OWNER,
    section: "safer_sex",
    values: ["condoms", "tested recently"],
  });
});

Deno.test("reveal: an unticked section is a 404", async () => {
  const h = harness({ card: cardRow(), shareSections: ["safer_sex"] }, VIEWER);
  const res = await h.handle(get(`/identity/card/${OWNER}/reveal/dynamics`));
  assertEquals(res.status, 404);
  assertEquals(await res.json(), NOT_FOUND);
  assert(!h.calls.some((c) => c.startsWith("getCard")));
});

Deno.test("reveal: a ticked but empty section is a 404", async () => {
  const h = harness({ card: cardRow(), shareSections: ["practices"] }, VIEWER);
  assertEquals(
    (await h.handle(get(`/identity/card/${OWNER}/reveal/practices`))).status,
    404,
  );
});

Deno.test("reveal: only gated sections can be revealed; anything else is a 404 with no DB call", async () => {
  const h = harness({ card: cardRow(), shareSections: ["safer_sex"] }, VIEWER);
  for (const section of ["hard_nos", "pace", "into", "kinks", "constructor", "SAFER_SEX"]) {
    assertEquals(
      (await h.handle(get(`/identity/card/${OWNER}/reveal/${section}`))).status,
      404,
      section,
    );
  }
  assertEquals(h.calls, []);
});

Deno.test("reveal: no active share is a 404", async () => {
  const h = harness({ card: cardRow(), shareSections: null }, VIEWER);
  assertEquals(
    (await h.handle(get(`/identity/card/${OWNER}/reveal/safer_sex`))).status,
    404,
  );
});

Deno.test("reveal: the owner can reveal their own section without a share", async () => {
  const h = harness({ card: cardRow() }, OWNER);
  const res = await h.handle(get(`/identity/card/${OWNER}/reveal/dynamics`));
  assertEquals(res.status, 200);
  assertEquals((await bodyOf(res)).values, ["switch"]);
  assert(!h.calls.some((c) => c.startsWith("cardShareSections")));
});

Deno.test("reveal: the log line names neither the owner nor the section", async () => {
  const h = harness({ card: cardRow(), shareSections: ["safer_sex"] }, VIEWER);
  await h.handle(get(`/identity/card/${OWNER}/reveal/safer_sex`));
  assertEquals(h.logs[0].route, "GET /card/:id/reveal/:section");
  const logged = JSON.stringify(h.logs);
  assertEquals(logged.includes(OWNER), false);
  assertEquals(logged.includes("safer_sex"), false);
});

// ---------------------------------------------------------------------------
// PUT /identity — the v1 onboarding body (reconcile C9)
// ---------------------------------------------------------------------------

Deno.test("PUT identity v1: onboarding's exact body creates a v2 row", async () => {
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
  assertEquals(h.calls, [`updateIdentity:${OWNER}`]);
  const w = h.identityWrites[0];
  assertEquals(w.fieldsFilled, 2);
  assertEquals(w.isPublic, true);
  assertEquals(w.audiences, defaultAudiences());
  assertEquals(plaintextOf(w.ciphertext), {
    domain: "identity",
    payload: { ...emptyIdentity(), pronouns: ["she/her"], orientation: ["bi"] },
  });
});

Deno.test("PUT identity v1: is_public false on a new row means only_me", async () => {
  const h = harness({}, OWNER);
  await h.handle(put("/identity", { pronouns: null, orientation: [], is_public: false }));
  assertEquals(h.identityWrites[0].audiences.identity, "only_me");
  assertEquals(h.identityWrites[0].isPublic, false);
});

Deno.test("PUT identity v1: merges into a v2 row without touching other fields or cards", async () => {
  const h = harness({
    identity: identityRow({ audiences: { identity: "after_hi", background: "only_me" } }),
  }, OWNER);
  await h.handle(
    put("/identity", { pronouns: "she/her", orientation: ["queer"], is_public: false }),
  );
  const w = h.identityWrites[0];
  const payload = plaintextOf(w.ciphertext).payload;
  assertEquals(payload.pronouns, ["she/her", "they/them"]);
  assertEquals(payload.orientation, ["queer"]);
  assertEquals(payload.languages, ["english", "tagalog"]);
  assertEquals(payload.photos_content, ["don't screenshot"]);
  // after_hi is already not public, so is_public false keeps it.
  assertEquals(w.audiences, {
    ...defaultAudiences(),
    identity: "after_hi",
    background: "only_me",
  });
  // An existing row gets its stored is_public back; the 0023 trigger lets the
  // identity_audience update drive it.
  assertEquals(w.isPublic, false);
});

Deno.test("PUT identity v1: is_public true on an only_me row opens the identity card only", async () => {
  const h = harness({
    identity: identityRow({ audiences: { identity: "only_me", lifestyle: "only_me" } }),
  }, OWNER);
  await h.handle(put("/identity", { pronouns: null, orientation: [], is_public: true }));
  const w = h.identityWrites[0];
  assertEquals(w.audiences.identity, "everyone");
  assertEquals(w.audiences.lifestyle, "only_me");
  assertEquals(
    w.isPublic,
    false,
    "the stored value, unchanged; the trigger follows the audience",
  );
});

Deno.test("PUT identity v1: a v1 stored row is mapped, then merged, then written as v2", async () => {
  const h = harness({
    identity: identityRow({
      payload: { pronouns: "ze/hir", orientation: ["gay"] },
      version: 1,
    }),
  }, OWNER);
  await h.handle(
    put("/identity", {
      pronouns: "ze/hir",
      orientation: ["gay", "queer"],
      is_public: true,
    }),
  );
  const payload = plaintextOf(h.identityWrites[0].ciphertext).payload;
  assertEquals(payload.pronouns, ["ze/hir"]);
  assertEquals(payload.orientation, ["gay", "queer"]);
  assertEquals(Object.keys(payload).length, 16);
});

Deno.test("PUT identity v1: a typed pronoun goes through the word filter", async () => {
  const h = harness({ dirty: ["rude/word"] }, OWNER);
  const clean = await h.handle(
    put("/identity", { pronouns: "ey/em", orientation: [], is_public: true }),
  );
  assertEquals(clean.status, 200);
  assertEquals(h.filtered, ["ey/em"]);

  const dirty = await h.handle(
    put("/identity", { pronouns: "rude/word", orientation: [], is_public: true }),
  );
  assertEquals(dirty.status, 400);
  assertEquals(await dirty.json(), {
    error: { code: "validation_failed", message: "that text can't be used" },
  });
  assertEquals(h.identityWrites.length, 1, "the dirty write never lands");
});

// ---------------------------------------------------------------------------
// PUT /identity — v2 patch
// ---------------------------------------------------------------------------

Deno.test("PUT identity v2: a partial patch changes only the keys it names", async () => {
  const h = harness({ identity: identityRow() }, OWNER);
  const res = await h.handle(put("/identity", {
    relationship: "seeing someone",
    drinking: null,
    politics: "left",
    politics_weight: "matters some",
    audiences: { lifestyle: "after_hi", around: "only_me" },
  }));
  assertEquals(res.status, 200);
  const w = h.identityWrites[0];
  const payload = plaintextOf(w.ciphertext).payload;
  assertEquals(payload.relationship, "seeing someone");
  assertEquals(payload.drinking, null);
  assertEquals(payload.politics, "left");
  assertEquals(payload.politics_weight, "matters some");
  assertEquals(payload.pronouns, ["she/her", "they/them"]);
  assertEquals(payload.faith, "catholic");
  assertEquals(w.audiences, {
    identity: "everyone",
    background: "everyone",
    lifestyle: "after_hi",
    around: "only_me",
  });
  // 12 filled before; drinking cleared (-1), politics and its weight set (+2).
  assertEquals(w.fieldsFilled, 13);
  assertEquals((await res.json()).fields_filled, 13);
});

Deno.test("PUT identity v2: audiences alone update a new row with an empty payload", async () => {
  const h = harness({}, OWNER);
  await h.handle(put("/identity", { audiences: { identity: "after_hi" } }));
  const w = h.identityWrites[0];
  assertEquals(w.fieldsFilled, 0);
  assertEquals(w.audiences.identity, "after_hi");
  assertEquals(w.isPublic, false);
  assertEquals(plaintextOf(w.ciphertext).payload, { ...emptyIdentity() });
});

Deno.test("PUT identity v2: only new typed entries are filtered, all in one call", async () => {
  const h = harness({
    identity: identityRow({
      payload: { ...FULL_IDENTITY, languages: ["english", "farsi"] },
    }),
  }, OWNER);
  await h.handle(put("/identity", {
    languages: ["english", "farsi", "yoruba"],
    orientation: ["bi", "sapphic"],
  }));
  assertEquals(h.filtered, ["sapphic", "yoruba"]);
  assertEquals(h.calls.filter((c) => c === "assertClean").length, 1);
});

Deno.test("PUT identity v2: no typed entries means no filter round trip", async () => {
  const h = harness({ identity: identityRow() }, OWNER);
  await h.handle(put("/identity", { languages: ["english", "french"], kids: "no kids" }));
  assertEquals(h.calls.includes("assertClean"), false);
});

Deno.test("PUT identity v2: a dirty typed entry is the neutral 400 and nothing is written", async () => {
  const h = harness({ identity: identityRow(), dirty: ["klingon slur"] }, OWNER);
  const res = await h.handle(put("/identity", { languages: ["english", "klingon slur"] }));
  assertEquals(res.status, 400);
  assertEquals((await bodyOf(res)).error, {
    code: "validation_failed",
    message: DIRTY_TEXT_MESSAGE,
  });
  assertEquals(h.identityWrites, []);
  assertEquals(JSON.stringify(h.logs).includes("klingon"), false);
});

Deno.test("PUT identity v2: a weight without its parent is a 400 and nothing is written", async () => {
  const h = harness({ identity: identityRow({ payload: {} }) }, OWNER);
  const res = await h.handle(put("/identity", { faith_weight: "important" }));
  assertEquals(res.status, 400);
  assertEquals(h.identityWrites, []);
});

Deno.test("PUT identity: audiences and is_public are columns, never part of the ciphertext", async () => {
  const h = harness({}, OWNER);
  await h.handle(put("/identity", { pronouns: null, orientation: [], is_public: true }));
  await h.handle(put("/identity", { kids: "no kids", audiences: { around: "only_me" } }));
  for (const w of h.identityWrites) {
    const payload = plaintextOf(w.ciphertext).payload;
    for (const key of ["is_public", "audiences", "identity_audience", "payload_version"]) {
      assertEquals(Object.hasOwn(payload, key), false, key);
    }
  }
});

Deno.test("PUT identity: a schema violation is a 400 and reaches no DB call", async () => {
  const h = harness({}, OWNER);
  for (
    const body of [
      { pronouns: null, orientation: ["martian", "venusian"], is_public: false },
      { relationship: "situationship" },
      { is_public: true },
      {},
    ]
  ) {
    const res = await h.handle(put("/identity", body));
    assertEquals(res.status, 400, JSON.stringify(body));
    assertEquals(((await bodyOf(res)).error as { code: string }).code, "validation_failed");
  }
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
// PUT /identity/card
// ---------------------------------------------------------------------------

Deno.test("PUT card v2: a new card from a partial patch", async () => {
  const h = harness({}, OWNER);
  const res = await h.handle(put("/identity/card", {
    pace: "take it as it comes",
    practices: ["rope", "toys"],
    hard_nos: ["no calls"],
  }));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).fields_filled, 3);
  assertEquals(h.calls, [`updateCard:${OWNER}`]);
  assertEquals(plaintextOf(h.cardWrites[0].ciphertext), {
    domain: "card",
    payload: {
      ...emptyCard(),
      pace: "take it as it comes",
      practices: ["rope", "toys"],
      hard_nos: ["no calls"],
    },
  });
});

Deno.test("PUT card v2: patches merge into the stored card", async () => {
  const h = harness({ card: cardRow() }, OWNER);
  await h.handle(put("/identity/card", { pace: null, privacy: [] }));
  const payload = plaintextOf(h.cardWrites[0].ciphertext).payload;
  assertEquals(payload.pace, null);
  assertEquals(payload.privacy, []);
  assertEquals(payload.safer_sex, ["condoms", "tested recently"]);
  assertEquals(h.cardWrites[0].fieldsFilled, 5);
});

Deno.test("PUT card v2: a v1 stored card is mapped and rewritten as v2", async () => {
  const h = harness({
    card: cardRow({ into: ["men"], safer_sex: [], kinks: ["sub"], hard_nos: [] }, 1),
  }, OWNER);
  await h.handle(put("/identity/card", { privacy: ["i'm not out to everyone"] }));
  const payload = plaintextOf(h.cardWrites[0].ciphertext).payload;
  assertEquals(payload.dynamics, ["submissive"]);
  assertEquals(payload.privacy, ["i'm not out to everyone"]);
  assertEquals(Object.hasOwn(payload, "into"), false);
  assertEquals(Object.hasOwn(payload, "kinks"), false);
});

Deno.test("PUT card: the v1 body is a 400 with a pointer, and no DB call", async () => {
  const h = harness({}, OWNER);
  const res = await h.handle(put("/identity/card", {
    into: ["men"],
    safer_sex: ["condoms"],
    kinks: [],
    hard_nos: ["no drugs"],
  }));
  assertEquals(res.status, 400);
  assert(
    String((await bodyOf(res) as { error: { message: string } }).error.message)
      .includes("v1 card body is retired"),
  );
  assertEquals(h.calls, []);
});

Deno.test("PUT card: typed hard nos are filtered; stored ones are not re-checked", async () => {
  const h = harness({ card: cardRow(), dirty: ["no nasty word"] }, OWNER);
  const ok = await h.handle(put("/identity/card", {
    hard_nos: ["no calls", "no loud music", "no cologne"],
  }));
  assertEquals(ok.status, 200);
  assertEquals(h.filtered, ["no cologne"]);

  const bad = await h.handle(put("/identity/card", { hard_nos: ["no nasty word"] }));
  assertEquals(bad.status, 400);
  assertEquals((await bodyOf(bad)).error, {
    code: "validation_failed",
    message: DIRTY_TEXT_MESSAGE,
  });
  assertEquals(h.cardWrites.length, 1);
});

// ---------------------------------------------------------------------------
// Unknown routes and methods
// ---------------------------------------------------------------------------

Deno.test("routing: unknown paths and wrong methods are the generic 404", async () => {
  const h = harness({ identity: identityRow(), card: cardRow(), shareSections: [] }, OWNER);
  const cases = [
    get("/identity/not-a-uuid"),
    get(`/identity/card/${OWNER}/extra`),
    get(`/identity/card/${OWNER}/reveal`),
    get(`/identity/card/${OWNER}/reveal/safer_sex/more`),
    get(`/identity/card/${OWNER}/peek/safer_sex`),
    get("/identity/card"),
    get("/identity"),
    get("/identity/review"),
    put(`/identity/${OWNER}`, {}),
    put(`/identity/card/${OWNER}`, {}),
    put(`/identity/card/${OWNER}/reveal/safer_sex`, {}),
    new Request(`https://p.supabase.co/functions/v1/identity/review`, {
      method: "POST",
      headers: { Authorization: "Bearer token" },
    }),
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

function quietHandler(uid: () => string, now?: () => number) {
  resetRateLimit();
  return createHandler({
    db: fakeDb({ identity: identityRow() }, [], [], [], []),
    callerUid: () => Promise.resolve(uid()),
    ...fakeCrypto(),
    now,
    log: () => {},
  });
}

Deno.test("rate limit: the 31st request in a window is 429", async () => {
  const h = harness({ identity: identityRow() }, OWNER);
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
  let uid = OWNER;
  const handle = quietHandler(() => uid);
  for (let i = 0; i < RATE_LIMIT_MAX; i++) await handle(get(`/identity/${OWNER}`));
  assertEquals((await handle(get(`/identity/${OWNER}`))).status, 429);
  uid = VIEWER;
  assertEquals((await handle(get(`/identity/${OWNER}`))).status, 200);
});

Deno.test("rate limit: the window rolls over", async () => {
  let clock = 1_000_000;
  const handle = quietHandler(() => OWNER, () => clock);
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
  const row = { ...identityRow(), payload_ciphertext: fakeCiphertext("card", {}) };
  assertEquals(
    (await harness({ identity: row }, VIEWER).handle(get(`/identity/${OWNER}`))).status,
    500,
  );
  const card = { ...cardRow(), payload_ciphertext: fakeCiphertext("identity", {}) };
  assertEquals(
    (await harness({ card, shareSections: ["safer_sex"] }, VIEWER)
      .handle(get(`/identity/card/${OWNER}/reveal/safer_sex`))).status,
    500,
  );
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
  const h = harness({ identity: identityRow() }, OWNER);
  await h.handle(get(`/identity/${OWNER}`));
  assertEquals(h.logs[0].route, "GET /:id");
  assertNotEquals(String(h.logs[0].route).includes(OWNER), true);
});
