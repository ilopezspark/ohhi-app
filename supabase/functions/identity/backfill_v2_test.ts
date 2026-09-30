// backfill_v2.ts against a fake store and fake crypto: no database, no keys.

import { assertEquals } from "@std/assert";
import type { CardRow, CardWrite, IdentityWrite, StoredIdentity } from "./db.ts";
import { type Audiences, defaultAudiences, emptyIdentity } from "./fields.ts";
import type { MapReport } from "./mapping.ts";
import { type BackfillCrypto, type BackfillStore, backfillUser } from "./backfill_v2.ts";

const USER = "11111111-1111-4111-8111-111111111111";

const enc = new TextEncoder();
const dec = new TextDecoder();
const seal = (domain: string, payload: unknown) =>
  enc.encode(JSON.stringify({ domain, payload }));
const open = (bytes: Uint8Array) => JSON.parse(dec.decode(bytes));

const crypto: BackfillCrypto = {
  encrypt: (domain, payload) =>
    Promise.resolve({ ciphertext: seal(domain, payload), keyVersion: 1 }),
  decrypt: (domain, ciphertext) => {
    const parsed = open(ciphertext);
    return parsed.domain === domain
      ? Promise.resolve(parsed.payload)
      : Promise.reject(new Error("wrong key"));
  },
};

interface Fake {
  store: BackfillStore;
  identityWrites: IdentityWrite[];
  cardWrites: CardWrite[];
  notices: MapReport[];
  filtered: string[];
}

function fake(opts: {
  identity?: StoredIdentity | null;
  card?: CardRow | null;
  dirty?: string[];
}): Fake {
  const identityWrites: IdentityWrite[] = [];
  const cardWrites: CardWrite[] = [];
  const notices: MapReport[] = [];
  const filtered: string[] = [];
  const store: BackfillStore = {
    lockIdentity: () => Promise.resolve(opts.identity ?? null),
    lockCard: () => Promise.resolve(opts.card ?? null),
    dirtyTexts: (texts) => {
      filtered.push(...texts);
      return Promise.resolve(new Set(texts.filter((t) => opts.dirty?.includes(t))));
    },
    writeIdentity: (_u, w) => {
      identityWrites.push(w);
      return Promise.resolve();
    },
    writeCard: (_u, w) => {
      cardWrites.push(w);
      return Promise.resolve();
    },
    insertNotice: (_u, payload) => {
      notices.push(payload);
      return Promise.resolve();
    },
  };
  return { store, identityWrites, cardWrites, notices, filtered };
}

function identity(
  payload: unknown,
  opts: { version?: number; audience?: Audiences["identity"]; isPublic?: boolean } = {},
): StoredIdentity {
  const audience = opts.audience ?? "everyone";
  return {
    is_public: opts.isPublic ?? audience === "everyone",
    payload_ciphertext: seal("identity", payload),
    key_version: 1,
    payload_version: opts.version ?? 1,
    audiences: { ...defaultAudiences(), identity: audience },
  };
}

function card(payload: unknown, version = 1): CardRow {
  return {
    payload_ciphertext: seal("card", payload),
    key_version: 1,
    payload_version: version,
  };
}

const v1Card = (over: Record<string, string[]> = {}) => ({
  into: [],
  safer_sex: [],
  kinks: [],
  hard_nos: [],
  ...over,
});

Deno.test("backfill: an exact v1 identity row becomes v2 with no notice", async () => {
  // Hosted today: one row, pronouns and orientation, public.
  const f = fake({ identity: identity({ pronouns: "she/her", orientation: ["bi"] }) });
  const out = await backfillUser(USER, f.store, crypto);
  assertEquals(out, { identity: "migrated", card: "unchanged", notice: null });
  assertEquals(f.identityWrites.length, 1);
  const w = f.identityWrites[0];
  assertEquals(open(w.ciphertext).payload, {
    ...emptyIdentity(),
    pronouns: ["she/her"],
    orientation: ["bi"],
  });
  assertEquals(w.fieldsFilled, 2);
  // Audiences and is_public are carried through unchanged (ruling 1).
  assertEquals(w.isPublic, true);
  assertEquals(w.audiences, defaultAudiences());
  assertEquals(f.notices, []);
  assertEquals(f.filtered, []);
});

Deno.test("backfill: a typed pronoun is filtered; a clean one is kept", async () => {
  const f = fake({ identity: identity({ pronouns: "ey/em", orientation: [] }) });
  const out = await backfillUser(USER, f.store, crypto);
  assertEquals(f.filtered, ["ey/em"]);
  assertEquals(open(f.identityWrites[0].ciphertext).payload.pronouns, ["ey/em"]);
  assertEquals(out.notice, null);
});

Deno.test("backfill: a dirty typed pronoun is held back and noticed", async () => {
  const f = fake({
    identity: identity({ pronouns: "bad/word", orientation: ["gay"] }),
    dirty: ["bad/word"],
  });
  const out = await backfillUser(USER, f.store, crypto);
  assertEquals(open(f.identityWrites[0].ciphertext).payload.pronouns, []);
  assertEquals(out.notice, { moved: [], held_back: ["pronouns"], removed: [] });
  assertEquals(f.notices, [{ moved: [], held_back: ["pronouns"], removed: [] }]);
});

Deno.test("backfill: a pronoun over 16 characters is held back without a filter call", async () => {
  const f = fake({
    identity: identity({ pronouns: "whatever feels right", orientation: [] }),
  });
  const out = await backfillUser(USER, f.store, crypto);
  assertEquals(f.filtered, []);
  assertEquals(out.notice?.held_back, ["pronouns"]);
});

Deno.test("backfill: a v1 card is split into v2 sections", async () => {
  const f = fake({
    card: card(v1Card({
      safer_sex: ["condoms", "tested apr '26"],
      kinks: ["dom", "light bondage", "toys", "open to discuss"],
      hard_nos: ["no pics unasked", "no loud music"],
    })),
  });
  const out = await backfillUser(USER, f.store, crypto);
  assertEquals(out, { identity: "unchanged", card: "migrated", notice: null });
  const payload = open(f.cardWrites[0].ciphertext).payload;
  assertEquals(payload.safer_sex, ["condoms", "tested recently"]);
  assertEquals(payload.dynamics, [
    "dominant",
    "would rather talk about it than pick from a list",
  ]);
  assertEquals(payload.practices, ["bondage", "toys"]);
  assertEquals(payload.hard_nos, ["no pics unasked", "no loud music"]);
  assertEquals(f.cardWrites[0].fieldsFilled, 4);
});

Deno.test("backfill: into moves to interested_in only when the identity card is only_me", async () => {
  const f = fake({
    identity: identity({ pronouns: null, orientation: ["queer"] }, { audience: "only_me" }),
    card: card(v1Card({ into: ["women", "nonbinary people"] })),
  });
  const out = await backfillUser(USER, f.store, crypto);
  assertEquals(out.identity, "migrated");
  assertEquals(open(f.identityWrites[0].ciphertext).payload.interested_in, [
    "women",
    "nonbinary people",
  ]);
  assertEquals(f.identityWrites[0].audiences.identity, "only_me");
  assertEquals(out.notice, { moved: ["interested_in"], held_back: [], removed: [] });
});

Deno.test("backfill: into is held back when moving it would publish it", async () => {
  for (const audience of ["everyone", "after_hi"] as const) {
    const f = fake({
      identity: identity({ pronouns: "he/him", orientation: [] }, { audience }),
      card: card(v1Card({ into: ["men"] })),
    });
    const out = await backfillUser(USER, f.store, crypto);
    assertEquals(open(f.identityWrites[0].ciphertext).payload.interested_in, [], audience);
    assertEquals(
      out.notice,
      { moved: [], held_back: ["interested_in"], removed: [] },
      audience,
    );
  }
});

Deno.test("backfill: into with no identity row at all is held back", async () => {
  const f = fake({ card: card(v1Card({ into: ["everyone"] })) });
  const out = await backfillUser(USER, f.store, crypto);
  assertEquals(f.identityWrites, []);
  assertEquals(out.notice?.held_back, ["interested_in"]);
});

Deno.test("backfill: into merges into an already-v2 only_me identity, but never over a v2 choice", async () => {
  const empty = fake({
    identity: identity({ ...emptyIdentity(), pronouns: ["she/her"] }, {
      version: 2,
      audience: "only_me",
    }),
    card: card(v1Card({ into: ["men"] })),
  });
  const merged = await backfillUser(USER, empty.store, crypto);
  assertEquals(merged.identity, "updated");
  const payload = open(empty.identityWrites[0].ciphertext).payload;
  assertEquals(payload.interested_in, ["men"]);
  assertEquals(payload.pronouns, ["she/her"]);

  const chosen = fake({
    identity: identity({ ...emptyIdentity(), interested_in: ["women"] }, {
      version: 2,
      audience: "only_me",
    }),
    card: card(v1Card({ into: ["men"] })),
  });
  const kept = await backfillUser(USER, chosen.store, crypto);
  assertEquals(kept.identity, "unchanged");
  assertEquals(chosen.identityWrites, []);
  assertEquals(kept.notice, { moved: [], held_back: [], removed: ["into"] });
});

Deno.test("backfill: no-home values are removed and noticed by field name only", async () => {
  const f = fake({
    identity: identity({ pronouns: "she/her", orientation: ["fluid"] }),
    card: card(v1Card({ into: ["top"], safer_sex: ["undetectable"], kinks: ["tickling"] })),
  });
  const out = await backfillUser(USER, f.store, crypto);
  assertEquals(out.notice, {
    moved: [],
    held_back: [],
    removed: ["orientation", "into", "safer_sex", "kinks"],
  });
  const text = JSON.stringify(f.notices);
  for (const value of ["fluid", "top", "undetectable", "tickling", "she/her"]) {
    assertEquals(text.includes(value), false, value);
  }
});

Deno.test("backfill: hard nos past the typed cap are held back", async () => {
  const f = fake({
    card: card(v1Card({ hard_nos: ["a1", "a2", "a3", "a4", "a5", "a6"] })),
  });
  const out = await backfillUser(USER, f.store, crypto);
  assertEquals(open(f.cardWrites[0].ciphertext).payload.hard_nos.length, 5);
  assertEquals(out.notice?.held_back, ["hard_nos"]);
});

Deno.test("backfill: idempotent — rows already on v2 are not touched and nothing is noticed", async () => {
  const f = fake({
    identity: identity({ ...emptyIdentity(), pronouns: ["she/her"] }, { version: 2 }),
    card: card({ pace: "slow" }, 2),
  });
  const out = await backfillUser(USER, f.store, crypto);
  assertEquals(out, { identity: "unchanged", card: "unchanged", notice: null });
  assertEquals(f.identityWrites, []);
  assertEquals(f.cardWrites, []);
  assertEquals(f.notices, []);
});

Deno.test("backfill: no rows at all is a no-op", async () => {
  const f = fake({});
  assertEquals(await backfillUser(USER, f.store, crypto), {
    identity: "unchanged",
    card: "unchanged",
    notice: null,
  });
});

Deno.test("backfill: a row with no ciphertext is left alone", async () => {
  const f = fake({
    identity: { ...identity({}), payload_ciphertext: null },
    card: { payload_ciphertext: null, key_version: 1, payload_version: 1 },
  });
  const out = await backfillUser(USER, f.store, crypto);
  assertEquals(out.notice, null);
  assertEquals(f.identityWrites, []);
  assertEquals(f.cardWrites, []);
});
