import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  CARD_SECTION_SPECS,
  defaultAudiences,
  emptyCard,
  emptyIdentity,
  IDENTITY_FIELD_SPECS,
  type IdentityPayloadV2,
  PRACTICE_OPTIONS,
} from "./fields.ts";
import {
  applyCardPut,
  applyIdentityPut,
  CARD_GROUPS,
  CARD_SECTIONS,
  CHIP_MAX_LENGTH,
  COMMUNICATION_MAX_ITEMS,
  COMMUNICATION_OPTIONS,
  DIRTY_TEXT_MESSAGE,
  DYNAMICS_OPTIONS,
  FAITH_OPTIONS,
  HARD_NO_MAX_LENGTH,
  HARD_NO_MAX_TYPED,
  HARD_NO_OPTIONS,
  IDENTITY_CARDS,
  IDENTITY_FIELDS,
  type IdentityPut,
  isPublicFor,
  LANGUAGE_MAX_ITEMS,
  LANGUAGE_MAX_LENGTH,
  LANGUAGE_MAX_TYPED,
  LANGUAGE_OPTIONS,
  newTypedEntries,
  ORIENTATION_CHIP_MAX_LENGTH,
  ORIENTATION_CHIPS,
  ORIENTATION_MAX_ITEMS,
  PHOTOS_CONTENT_MAX_ITEMS,
  PHOTOS_CONTENT_OPTIONS,
  PRACTICE_GROUP_ORDER,
  PRACTICE_GROUPS,
  PRONOUN_MAX_LENGTH,
  PRONOUN_OPTIONS,
  readCardV2,
  readIdentityV2,
  RELATIONSHIP_OPTIONS,
  SAFER_SEX_OPTIONS,
  SINGLE_FIELDS,
  validateCardPut,
  validateIdentityPut,
  ValidationError,
} from "./validate.ts";
import * as VOCAB from "./vocab.ts";

function rejects(body: unknown, fragment?: string) {
  assertThrows(() => validateIdentityPut(body), ValidationError, fragment);
}
function rejectsCard(body: unknown, fragment?: string) {
  assertThrows(() => validateCardPut(body), ValidationError, fragment);
}
function v2(body: unknown) {
  const put = validateIdentityPut(body);
  assert(put.kind === "v2");
  return put;
}

// ---------------------------------------------------------------------------
// Vocabularies (brief §2/§3 verbatim, ruling 3, D11)
// ---------------------------------------------------------------------------

Deno.test("vocabulary: the owner's labels are kept as written (ruling 3)", () => {
  assert((RELATIONSHIP_OPTIONS as readonly string[]).includes("single"));
  assert(
    (VOCAB.SHOWS_INTEREST_OPTIONS as readonly string[]).length === 9,
    "how i show i like someone has nine chips",
  );
  assert(
    (DYNAMICS_OPTIONS as readonly string[]).includes("still figuring out what i like"),
  );
  assert(
    (DYNAMICS_OPTIONS as readonly string[]).includes(
      "would rather talk about it than pick from a list",
    ),
  );
});

Deno.test("vocabulary: list sizes match the brief", () => {
  const sizes: Record<string, number> = {
    PRONOUN_OPTIONS: 12,
    ORIENTATION_CHIPS: 13,
    INTERESTED_IN_OPTIONS: 6,
    RELATIONSHIP_OPTIONS: 11,
    LANGUAGE_OPTIONS: 19,
    FAITH_OPTIONS: 14,
    FAITH_WEIGHT_OPTIONS: 5,
    POLITICS_OPTIONS: 7,
    POLITICS_WEIGHT_OPTIONS: 3,
    DRINKING_OPTIONS: 6,
    SMOKING_OPTIONS: 6,
    FOUR_TWENTY_OPTIONS: 5,
    KIDS_OPTIONS: 6,
    WHEN_FREE_OPTIONS: 9,
    COMMUNICATION_OPTIONS: 9,
    PHOTOS_CONTENT_OPTIONS: 7,
    SHOWS_INTEREST_OPTIONS: 9,
    PACE_OPTIONS: 7,
    LIVING_SITUATION_OPTIONS: 7,
    HOSTING_OPTIONS: 5,
    SAFER_SEX_OPTIONS: 8,
    DYNAMICS_OPTIONS: 26,
    HARD_NO_OPTIONS: 20,
    PRIVACY_OPTIONS: 6,
  };
  const vocab = VOCAB as unknown as Record<string, readonly string[]>;
  for (const [name, size] of Object.entries(sizes)) {
    assertEquals(vocab[name].length, size, name);
  }
});

Deno.test("vocabulary: every chip is lowercase, trimmed, distinct and at most 60 characters", () => {
  const vocab = VOCAB as unknown as Record<string, unknown>;
  const lists = Object.entries(vocab).filter(([name, v]) =>
    Array.isArray(v) && (name.endsWith("_OPTIONS") || name.endsWith("_CHIPS"))
  ) as [string, string[]][];
  lists.push(["PRACTICE_OPTIONS", [...PRACTICE_OPTIONS]]);
  assert(lists.length >= 25);
  for (const [name, list] of lists) {
    assertEquals(new Set(list).size, list.length, `${name} has a duplicate`);
    for (const chip of list) {
      assertEquals(chip, chip.toLowerCase(), `${name}: ${chip}`);
      assertEquals(chip, chip.trim(), `${name}: ${chip}`);
      assert(chip.length > 0 && chip.length <= CHIP_MAX_LENGTH, `${name}: ${chip}`);
    }
  }
});

Deno.test("vocabulary: practices are stored flat and grouped for the picker (D11 adds toys)", () => {
  assertEquals([...PRACTICE_GROUP_ORDER], [
    "sensation",
    "restraint",
    "power",
    "roleplay",
    "display",
    "other",
  ]);
  assertEquals(
    PRACTICE_OPTIONS.length,
    PRACTICE_GROUP_ORDER.reduce((n, g) => n + PRACTICE_GROUPS[g].length, 0),
  );
  assertEquals(new Set(PRACTICE_OPTIONS).size, PRACTICE_OPTIONS.length);
  assert((PRACTICE_GROUPS.other as readonly string[]).includes("toys"));
  assert((PRACTICE_GROUPS.restraint as readonly string[]).includes("bondage"));
  assert(PRACTICE_GROUPS.other.includes("nothing yet, ask me later"));
});

Deno.test("vocabulary: the dated tested chip is retired in favour of 'tested recently'", () => {
  assert((SAFER_SEX_OPTIONS as readonly string[]).includes("tested recently"));
  rejectsCard({ safer_sex: ["tested apr '26"] }, "unknown value");
});

Deno.test("structure: cards cover the 16 identity keys once, groups cover the 9 card keys once", () => {
  const cardKeys = Object.values(IDENTITY_CARDS).flat();
  assertEquals([...cardKeys].sort(), [...IDENTITY_FIELDS].sort());
  const groupKeys = Object.values(CARD_GROUPS).flat();
  assertEquals([...groupKeys].sort(), [...CARD_SECTIONS].sort());
  assertEquals([...CARD_GROUPS.standard], [
    "shows_interest",
    "pace",
    "living_situation",
    "hosting",
  ]);
  assertEquals([...CARD_GROUPS.gated], ["safer_sex", "dynamics", "practices"]);
  assertEquals([...CARD_GROUPS.always_attached], ["hard_nos", "privacy"]);
});

Deno.test("structure: single fields are exactly the ones the brief marks single", () => {
  const singles = [
    ...IDENTITY_FIELDS.filter((f) => IDENTITY_FIELD_SPECS[f].kind === "single"),
    ...CARD_SECTIONS.filter((s) => CARD_SECTION_SPECS[s].kind === "single"),
  ];
  assertEquals(singles.sort(), [...SINGLE_FIELDS].sort());
});

// ---------------------------------------------------------------------------
// PUT /identity v1 body (onboarding, reconcile C9)
// ---------------------------------------------------------------------------

Deno.test("v1 body: the exact onboarding body is accepted", () => {
  assertEquals(
    validateIdentityPut({ pronouns: "she/her", orientation: ["bi"], is_public: true }),
    { kind: "v1", pronoun: "she/her", orientation: ["bi"], isPublic: true },
  );
  assertEquals(
    validateIdentityPut({ pronouns: null, orientation: [], is_public: false }),
    { kind: "v1", pronoun: null, orientation: [], isPublic: false },
  );
});

Deno.test("v1 body: a free-text pronoun up to 16 characters is one typed entry", () => {
  const put = validateIdentityPut({
    pronouns: "  per/pers  ",
    orientation: [],
    is_public: false,
  });
  assert(put.kind === "v1");
  assertEquals(put.pronoun, "per/pers");
  rejects(
    { pronouns: "p".repeat(PRONOUN_MAX_LENGTH + 1), orientation: [], is_public: false },
    "at most 16",
  );
});

Deno.test("v1 body: a listed pronoun typed in another case is stored as listed", () => {
  const put = validateIdentityPut({
    pronouns: "They/Them",
    orientation: [],
    is_public: true,
  });
  assert(put.kind === "v1");
  assertEquals(put.pronoun, "they/them");
});

Deno.test("v1 body: all three keys are required and nothing else is allowed", () => {
  rejects({ pronouns: null, is_public: false }, "Missing key");
  rejects({ orientation: [], is_public: false }, "Missing key");
  rejects(
    { pronouns: null, orientation: [], is_public: false, faith: null },
    "Unknown key",
  );
});

Deno.test("v1 body: wrong types and an empty pronoun are rejected", () => {
  rejects({ pronouns: 42, orientation: [], is_public: false }, "pronouns");
  rejects({ pronouns: ["she/her"], orientation: [], is_public: false }, "pronouns");
  rejects({ pronouns: "", orientation: [], is_public: false }, "null rather than");
  rejects({ pronouns: null, orientation: [], is_public: "yes" }, "is_public");
  rejects({ pronouns: null, orientation: "bi", is_public: false }, "orientation");
});

Deno.test("v1 body: orientation uses the v2 rules (13 chips, one typed, three total)", () => {
  const put = validateIdentityPut({
    pronouns: null,
    orientation: ["pan", "demisexual", "sapphic"],
    is_public: true,
  });
  assert(put.kind === "v1");
  assertEquals(put.orientation, ["pan", "demisexual", "sapphic"]);
  rejects(
    { pronouns: null, orientation: ["bi", "gay", "pan", "queer"], is_public: true },
    "at most 3",
  );
});

// ---------------------------------------------------------------------------
// PUT /identity v2 body
// ---------------------------------------------------------------------------

Deno.test("v2 body: a partial patch of any field, plus audiences", () => {
  const put = v2({
    relationship: "single",
    languages: ["english", "Spanish", "Tagalog"],
    faith: "catholic",
    faith_weight: "important",
    audiences: { background: "after_hi" },
  });
  assertEquals(put.patch, {
    relationship: "single",
    languages: ["english", "spanish", "tagalog"],
    faith: "catholic",
    faith_weight: "important",
  });
  assertEquals(put.audiences, { background: "after_hi" });
});

Deno.test("v2 body: audiences alone is a valid patch", () => {
  assertEquals(v2({ audiences: { identity: "only_me" } }).patch, {});
});

Deno.test("v2 body: an empty body, unknown keys and a bad audience are rejected", () => {
  rejects({}, "at least one");
  rejects({ audiences: {} }, "at least one");
  rejects({ looking_for: ["friends"] }, "Unknown key");
  rejects({ audiences: { before_you_message: "only_me" } }, "Unknown key");
  rejects({ audiences: { identity: "friends" } }, "audiences.identity");
  rejects({ audiences: "everyone" }, "audiences must be a JSON object");
});

Deno.test("v2 body: single fields take a listed string or null, never an array", () => {
  assertEquals(v2({ drinking: null }).patch, { drinking: null });
  rejects({ drinking: ["socially"] }, "string or null");
  rejects({ kids: "maybe" }, "unknown value");
  rejects({ relationship: "Single" }, "unknown value");
});

Deno.test("v2 body: fixed-only multi fields reject typed text and duplicates", () => {
  rejects({ interested_in: ["cats"] }, "unknown value");
  rejects({ when_free: ["mornings", "mornings"] }, "duplicate");
  rejects({ photos_content: "don't screenshot" }, "array of strings");
});

Deno.test("caps: pronouns — one typed entry of at most 16, three in total", () => {
  assertEquals(v2({ pronouns: ["she/her", "they/them", "ey/em"] }).patch.pronouns, [
    "she/her",
    "they/them",
    "ey/em",
  ]);
  rejects({ pronouns: ["ey/em", "per/pers"] }, "at most 1 typed entry");
  rejects({ pronouns: ["she/her", "he/him", "they/them", "ask me"] }, "at most 3");
  rejects({ pronouns: ["x".repeat(17)] }, "at most 16");
});

Deno.test("caps: orientation — one typed entry of at most 24", () => {
  assertEquals(
    v2({ orientation: ["x".repeat(ORIENTATION_CHIP_MAX_LENGTH)] }).patch.orientation,
    ["x".repeat(24)],
  );
  rejects({ orientation: ["x".repeat(25)] }, "at most 24");
  rejects({ orientation: ["sapphic", "fluid"] }, "at most 1 typed entry");
  assertEquals(ORIENTATION_MAX_ITEMS, 3);
  assertEquals(ORIENTATION_CHIPS.length, 13);
});

Deno.test("caps: languages — three typed of at most 24, eight in total", () => {
  const eight = [...LANGUAGE_OPTIONS.slice(0, 5), "farsi", "yoruba", "tamil"];
  assertEquals(v2({ languages: eight }).patch.languages, eight);
  assertEquals(LANGUAGE_MAX_ITEMS, 8);
  assertEquals(LANGUAGE_MAX_TYPED, 3);
  rejects({ languages: [...eight, "english"].slice(0, 9).concat("x") }, "at most 8");
  rejects({ languages: ["farsi", "yoruba", "tamil", "twi"] }, "at most 3 typed entries");
  rejects({ languages: ["x".repeat(LANGUAGE_MAX_LENGTH + 1)] }, "at most 24");
});

Deno.test("caps: communication at most 5, photos & content all 7", () => {
  assertEquals(COMMUNICATION_MAX_ITEMS, 5);
  rejects({ communication: COMMUNICATION_OPTIONS.slice(0, 6) }, "at most 5");
  assertEquals(PHOTOS_CONTENT_MAX_ITEMS, 7);
  assertEquals(
    v2({ photos_content: [...PHOTOS_CONTENT_OPTIONS] }).patch.photos_content,
    [...PHOTOS_CONTENT_OPTIONS],
  );
});

Deno.test("typed entries: trimmed, whitespace collapsed, no control characters, no blanks", () => {
  assertEquals(v2({ languages: ["  old   norse  "] }).patch.languages, ["old norse"]);
  rejects({ languages: ["old\nnorse"] }, "control characters");
  rejects({ languages: ["a\u0000b"] }, "control characters");
  rejects({ pronouns: ["   "] }, "at least 1 character");
  rejects({ orientation: ["bi", "BI"] }, "duplicate");
});

// ---------------------------------------------------------------------------
// applyIdentityPut
// ---------------------------------------------------------------------------

function stored(over: Partial<IdentityPayloadV2> = {}): IdentityPayloadV2 {
  return { ...emptyIdentity(), ...over };
}

Deno.test("apply v1: is_public maps onto the identity card's audience", () => {
  const put = (isPublic: boolean): IdentityPut => ({
    kind: "v1",
    pronoun: null,
    orientation: [],
    isPublic,
  });
  const aud = defaultAudiences();
  assertEquals(
    applyIdentityPut(put(true), stored(), { ...aud, identity: "only_me" })
      .audiences.identity,
    "everyone",
  );
  assertEquals(applyIdentityPut(put(false), stored(), aud).audiences.identity, "only_me");
  // after_hi is already not public: a false keeps it.
  assertEquals(
    applyIdentityPut(put(false), stored(), { ...aud, identity: "after_hi" }).audiences
      .identity,
    "after_hi",
  );
  // Other cards are never touched by the v1 body.
  const others = { ...aud, background: "only_me" as const, around: "after_hi" as const };
  const out = applyIdentityPut(put(true), stored(), others).audiences;
  assertEquals(out.background, "only_me");
  assertEquals(out.around, "after_hi");
});

Deno.test("apply v1: pronouns round-trip without losing a second pronoun; other fields kept", () => {
  const before = stored({
    pronouns: ["she/her", "they/them"],
    faith: "jewish",
    languages: ["english"],
  });
  const aud = defaultAudiences();
  const same = applyIdentityPut(
    { kind: "v1", pronoun: "she/her", orientation: ["queer"], isPublic: true },
    before,
    aud,
  ).payload;
  assertEquals(same.pronouns, ["she/her", "they/them"]);
  assertEquals(same.orientation, ["queer"]);
  assertEquals(same.faith, "jewish");
  assertEquals(same.languages, ["english"]);

  const changed = applyIdentityPut(
    { kind: "v1", pronoun: "he/him", orientation: [], isPublic: true },
    before,
    aud,
  ).payload;
  assertEquals(changed.pronouns, ["he/him"]);

  const cleared = applyIdentityPut(
    { kind: "v1", pronoun: null, orientation: [], isPublic: true },
    before,
    aud,
  ).payload;
  assertEquals(cleared.pronouns, []);
});

Deno.test("apply v2: keys present replace, keys absent stay; audiences merge per card", () => {
  const before = stored({ pronouns: ["she/her"], drinking: "socially", kids: "no kids" });
  const out = applyIdentityPut(
    v2({ drinking: null, when_free: ["evenings"], audiences: { lifestyle: "after_hi" } }),
    before,
    defaultAudiences(),
  );
  assertEquals(out.payload.pronouns, ["she/her"]);
  assertEquals(out.payload.drinking, null);
  assertEquals(out.payload.kids, "no kids");
  assertEquals(out.payload.when_free, ["evenings"]);
  assertEquals(out.audiences, { ...defaultAudiences(), lifestyle: "after_hi" });
});

Deno.test("apply v2: a weight is only valid while its parent is set", () => {
  const aud = defaultAudiences();
  assertThrows(
    () => applyIdentityPut(v2({ faith_weight: "important" }), stored(), aud),
    ValidationError,
    "faith_weight needs faith",
  );
  assertThrows(
    () =>
      applyIdentityPut(
        v2({ politics: null, politics_weight: "matters some" }),
        stored({ politics: "left" }),
        aud,
      ),
    ValidationError,
    "politics_weight needs politics",
  );
  // Setting the parent in the same patch, or already stored, is fine.
  assertEquals(
    applyIdentityPut(
      v2({ faith: FAITH_OPTIONS[0], faith_weight: "somewhat" }),
      stored(),
      aud,
    )
      .payload.faith_weight,
    "somewhat",
  );
  assertEquals(
    applyIdentityPut(
      v2({ politics_weight: "matters some" }),
      stored({ politics: "left" }),
      aud,
    )
      .payload.politics_weight,
    "matters some",
  );
  // Clearing the parent clears a stored weight.
  assertEquals(
    applyIdentityPut(
      v2({ faith: null }),
      stored({ faith: "hindu", faith_weight: "important" }),
      aud,
    )
      .payload.faith_weight,
    null,
  );
});

Deno.test("isPublicFor: is_public follows the identity card being everyone", () => {
  assertEquals(isPublicFor(defaultAudiences()), true);
  assertEquals(isPublicFor({ ...defaultAudiences(), identity: "after_hi" }), false);
  assertEquals(isPublicFor({ ...defaultAudiences(), identity: "only_me" }), false);
});

// ---------------------------------------------------------------------------
// PUT /identity/card v2 body
// ---------------------------------------------------------------------------

Deno.test("card body: a partial patch of any of the nine sections", () => {
  assertEquals(
    validateCardPut({
      pace: "slow",
      dynamics: ["switch", "gentle"],
      practices: ["rope", "toys", "aftercare is important to me"],
      privacy: ["keep this between us"],
    }),
    {
      pace: "slow",
      dynamics: ["switch", "gentle"],
      practices: ["rope", "toys", "aftercare is important to me"],
      privacy: ["keep this between us"],
    },
  );
});

Deno.test("card body: dynamics and practices are uncapped within their lists", () => {
  assertEquals(validateCardPut({ dynamics: [...DYNAMICS_OPTIONS] }).dynamics?.length, 26);
  assertEquals(
    validateCardPut({ practices: [...PRACTICE_OPTIONS] }).practices?.length,
    PRACTICE_OPTIONS.length,
  );
  rejectsCard({ practices: ["skydiving"] }, "unknown value");
});

Deno.test("card body: the v1 body is refused with a pointer to v2", () => {
  rejectsCard(
    { into: ["men"], safer_sex: [], kinks: [], hard_nos: [] },
    "The v1 card body is retired",
  );
  rejectsCard({}, "at least one section");
  rejectsCard({ pronouns: [] }, "Unknown key");
});

Deno.test("hard nos: every fixed chip at once, plus up to five typed of at most 60", () => {
  const typed = ["no a", "no b", "no c", "no d", "x".repeat(HARD_NO_MAX_LENGTH)];
  const body = { hard_nos: [...HARD_NO_OPTIONS, ...typed] };
  assertEquals(validateCardPut(body).hard_nos, [...HARD_NO_OPTIONS, ...typed]);
  assertEquals(HARD_NO_MAX_TYPED, 5);
  rejectsCard({ hard_nos: [...typed, "no f"] }, "at most 5 typed entries");
  rejectsCard({ hard_nos: ["x".repeat(61)] }, "at most 60");
});

Deno.test("hard nos: a typed duplicate of a fixed chip collapses case-insensitively", () => {
  assertEquals(validateCardPut({ hard_nos: ["NO CALLS"] }).hard_nos, ["no calls"]);
  rejectsCard({ hard_nos: ["no calls", "No Calls"] }, "duplicate");
  rejectsCard({ hard_nos: ["no\ncalls at night"] }, "control characters");
});

Deno.test("card sections other than hard nos are fixed lists", () => {
  rejectsCard({ privacy: ["don't tell my mum"] }, "unknown value");
  rejectsCard({ hosting: "maybe" }, "unknown value");
  rejectsCard({ pace: ["slow"] }, "string or null");
});

Deno.test("applyCardPut: keys present replace, keys absent stay", () => {
  const before = { ...emptyCard(), pace: "slow", hard_nos: ["no calls"] };
  const out = applyCardPut({ pace: null, safer_sex: ["condoms"] }, before);
  assertEquals(out.pace, null);
  assertEquals(out.hard_nos, ["no calls"]);
  assertEquals(out.safer_sex, ["condoms"]);
});

// ---------------------------------------------------------------------------
// Typed entries and the word filter's input
// ---------------------------------------------------------------------------

Deno.test("newTypedEntries: only typed text not already stored is sent to the filter", () => {
  const before = stored({ pronouns: ["ey/em"], languages: ["english", "farsi"] });
  const after = stored({
    pronouns: ["ey/em", "she/her"],
    orientation: ["sapphic"],
    languages: ["english", "farsi", "yoruba"],
  });
  assertEquals(
    newTypedEntries(
      IDENTITY_FIELD_SPECS,
      IDENTITY_FIELDS,
      before as unknown as Record<string, string[]>,
      after as unknown as Record<string, string[]>,
    ),
    ["sapphic", "yoruba"],
  );
  assertEquals(
    newTypedEntries(
      CARD_SECTION_SPECS,
      CARD_SECTIONS,
      emptyCard() as unknown as Record<string, string[]>,
      { ...emptyCard(), hard_nos: ["no calls", "no loud music"] } as unknown as Record<
        string,
        string[]
      >,
    ),
    ["no loud music"],
  );
});

Deno.test("the dirty-text message is the 0018 RPCs' neutral refusal", () => {
  assertEquals(DIRTY_TEXT_MESSAGE, "that text can't be used");
});

// ---------------------------------------------------------------------------
// Reading a stored v2 payload is shape-only, never re-validated
// ---------------------------------------------------------------------------

Deno.test("read v2: a retired chip still reads back; malformed values degrade to empty", () => {
  const out = readIdentityV2({
    pronouns: ["retired-chip"],
    relationship: "a retired single",
    faith: 7,
    languages: "english",
  });
  assertEquals(out.pronouns, ["retired-chip"]);
  assertEquals(out.relationship, "a retired single");
  assertEquals(out.faith, null);
  assertEquals(out.languages, []);
  assertEquals(readIdentityV2(null), emptyIdentity());
  assertEquals(readCardV2("nonsense"), emptyCard());
  assertEquals(readCardV2({ pace: "retired pace", practices: ["gone"] }).practices, [
    "gone",
  ]);
});

Deno.test("PRONOUN_OPTIONS keeps the v1 four", () => {
  for (const p of ["he/him", "she/her", "they/them", "ask me"]) {
    assert((PRONOUN_OPTIONS as readonly string[]).includes(p), p);
  }
});
