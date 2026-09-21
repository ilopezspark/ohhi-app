import { assertEquals, assertThrows } from "@std/assert";
import {
  CARD_CHIPS,
  CARD_FIELDS,
  CARD_MAX_ITEMS,
  CHIP_MAX_LENGTH,
  ORIENTATION_CHIPS,
  ORIENTATION_MAX_ITEMS,
  PRONOUN_OPTIONS,
  readCardPayload,
  readIdentityPayload,
  validateCardRequest,
  validateIdentityRequest,
  ValidationError,
} from "./validate.ts";

const emptyCard = { into: [], safer_sex: [], kinks: [], hard_nos: [] };

function rejects(body: unknown, fragment?: string) {
  assertThrows(() => validateIdentityRequest(body), ValidationError, fragment);
}
function rejectsCard(body: unknown, fragment?: string) {
  assertThrows(() => validateCardRequest(body), ValidationError, fragment);
}

// ---------------------------------------------------------------------------
// Vocabularies (decisions 20-21)
// ---------------------------------------------------------------------------

Deno.test("vocabulary: decision 20's four pronoun options are present", () => {
  assertEquals([...PRONOUN_OPTIONS], ["she/her", "he/him", "they/them", "ask me"]);
});

Deno.test("vocabulary: every constant chip is within the 40-character cap", () => {
  for (const chip of ORIENTATION_CHIPS) {
    assertEquals(chip.length <= CHIP_MAX_LENGTH, true, chip);
  }
  for (const field of CARD_FIELDS) {
    for (const chip of CARD_CHIPS[field]) {
      assertEquals(chip.length <= CHIP_MAX_LENGTH, true, chip);
    }
  }
});

// ---------------------------------------------------------------------------
// Identity: accepts
// ---------------------------------------------------------------------------

Deno.test("identity: minimal valid body", () => {
  assertEquals(
    validateIdentityRequest({ pronouns: null, orientation: [], is_public: false }),
    { pronouns: null, orientation: [], is_public: false },
  );
});

Deno.test("identity: maximal valid body (listed pronoun, three orientation chips)", () => {
  const body = {
    pronouns: "they/them",
    orientation: [...ORIENTATION_CHIPS].slice(0, ORIENTATION_MAX_ITEMS),
    is_public: true,
  };
  assertEquals(validateIdentityRequest(body), body);
});

Deno.test("identity: decision 20's free-text opt-out is accepted under the cap", () => {
  const custom = "xe/xem";
  assertEquals(
    validateIdentityRequest({ pronouns: custom, orientation: [], is_public: false })
      .pronouns,
    custom,
  );
  const atCap = "p".repeat(CHIP_MAX_LENGTH);
  assertEquals(
    validateIdentityRequest({ pronouns: atCap, orientation: [], is_public: false })
      .pronouns,
    atCap,
  );
});

// ---------------------------------------------------------------------------
// Identity: rejects
// ---------------------------------------------------------------------------

Deno.test("identity: rejects a non-object body", () => {
  for (const body of [null, "she/her", 7, true, [], undefined]) {
    rejects(body, "JSON object");
  }
});

Deno.test("identity: rejects an unknown top-level key", () => {
  rejects(
    { pronouns: null, orientation: [], is_public: false, kinks: [] },
    "Unknown key",
  );
});

Deno.test("identity: rejects a missing key", () => {
  rejects({ orientation: [], is_public: false }, "Missing key");
  rejects({ pronouns: null, is_public: false }, "Missing key");
  rejects({ pronouns: null, orientation: [] }, "Missing key");
});

Deno.test("identity: rejects wrong JSON types", () => {
  rejects({ pronouns: 42, orientation: [], is_public: false }, "pronouns");
  rejects({ pronouns: null, orientation: "bi", is_public: false }, "orientation");
  rejects({ pronouns: null, orientation: [1], is_public: false }, "only strings");
  rejects({ pronouns: null, orientation: [], is_public: "yes" }, "is_public");
});

Deno.test("identity: rejects an empty-string pronoun (null means unset)", () => {
  rejects({ pronouns: "", orientation: [], is_public: false }, "null rather than");
});

Deno.test("identity: rejects a pronoun over the length cap", () => {
  rejects(
    { pronouns: "p".repeat(CHIP_MAX_LENGTH + 1), orientation: [], is_public: false },
    "at most",
  );
});

Deno.test("identity: rejects an unknown orientation chip", () => {
  rejects({ pronouns: null, orientation: ["martian"], is_public: false }, "unknown value");
});

Deno.test("identity: rejects more than three orientation chips (decision 14/20)", () => {
  rejects(
    {
      pronouns: null,
      orientation: [...ORIENTATION_CHIPS].slice(0, ORIENTATION_MAX_ITEMS + 1),
      is_public: false,
    },
    "at most 3",
  );
});

Deno.test("identity: rejects a duplicated orientation chip", () => {
  rejects({ pronouns: null, orientation: ["bi", "bi"], is_public: false }, "duplicate");
});

// ---------------------------------------------------------------------------
// Card: accepts
// ---------------------------------------------------------------------------

Deno.test("card: minimal valid body (all four arrays empty)", () => {
  assertEquals(validateCardRequest(emptyCard), emptyCard);
});

Deno.test("card: maximal valid body (8 chips per array, decision 21)", () => {
  const body = Object.fromEntries(
    CARD_FIELDS.map((f) => [f, [...CARD_CHIPS[f]].slice(0, CARD_MAX_ITEMS)]),
  );
  assertEquals(validateCardRequest(body), body);
  for (const field of CARD_FIELDS) {
    assertEquals((body as Record<string, string[]>)[field].length, CARD_MAX_ITEMS);
  }
});

// ---------------------------------------------------------------------------
// Card: rejects
// ---------------------------------------------------------------------------

Deno.test("card: rejects an unknown top-level key", () => {
  rejectsCard({ ...emptyCard, pronouns: null }, "Unknown key");
});

Deno.test("card: rejects a missing field", () => {
  const { into: _drop, ...rest } = emptyCard;
  rejectsCard(rest, "Missing key");
});

Deno.test("card: rejects wrong JSON types", () => {
  rejectsCard({ ...emptyCard, into: "top" }, "array of strings");
  rejectsCard({ ...emptyCard, kinks: [null] }, "only strings");
  rejectsCard({ ...emptyCard, hard_nos: {} }, "array of strings");
});

Deno.test("card: rejects an over-length array (more than 8 chips)", () => {
  rejectsCard(
    { ...emptyCard, into: Array.from({ length: CARD_MAX_ITEMS + 1 }, (_, i) => `x${i}`) },
    "at most 8",
  );
});

Deno.test("card: rejects a chip over 40 characters before it reaches the allow-list", () => {
  rejectsCard({ ...emptyCard, into: ["x".repeat(CHIP_MAX_LENGTH + 1)] }, "40 characters");
});

Deno.test("card: rejects an unknown chip value", () => {
  rejectsCard({ ...emptyCard, safer_sex: ["whatever"] }, "unknown value");
});

Deno.test("card: rejects a chip valid for a different field", () => {
  // `top` is an `into` chip, never a `hard_nos` one.
  rejectsCard({ ...emptyCard, hard_nos: ["top"] }, "unknown value");
});

Deno.test("card: rejects a duplicated chip", () => {
  rejectsCard({ ...emptyCard, into: ["top", "top"] }, "duplicate");
});

// ---------------------------------------------------------------------------
// Reading a stored payload is shape-only, never re-validated
// ---------------------------------------------------------------------------

Deno.test("read: a retired chip in a stored row still reads back", () => {
  assertEquals(
    readIdentityPayload({ pronouns: "ze/zir", orientation: ["retired-chip"] }),
    { pronouns: "ze/zir", orientation: ["retired-chip"] },
  );
  assertEquals(
    readCardPayload({ into: ["retired"], safer_sex: [], kinks: [], hard_nos: [] }).into,
    ["retired"],
  );
});

Deno.test("read: a malformed stored payload degrades to empty, never throws", () => {
  assertEquals(readIdentityPayload(null), { pronouns: null, orientation: [] });
  assertEquals(readIdentityPayload({ orientation: "bi" }), {
    pronouns: null,
    orientation: [],
  });
  assertEquals(readCardPayload("nonsense"), emptyCard);
});
