import { assertEquals } from "@std/assert";
import {
  CARD_MAX_FIELDS,
  cardFieldsFilled,
  IDENTITY_MAX_FIELDS,
  identityFieldsFilled,
} from "./fields.ts";
import { CARD_FIELDS, type CardPayload } from "./validate.ts";

const emptyCard: CardPayload = { into: [], safer_sex: [], kinks: [], hard_nos: [] };

Deno.test("identity: all-empty is 0", () => {
  assertEquals(identityFieldsFilled({ pronouns: null, orientation: [] }), 0);
});

Deno.test("identity: each field alone is 1", () => {
  assertEquals(identityFieldsFilled({ pronouns: "she/her", orientation: [] }), 1);
  assertEquals(identityFieldsFilled({ pronouns: null, orientation: ["bi"] }), 1);
});

Deno.test("identity: all-filled is 2, the migration-0003 upper bound", () => {
  assertEquals(
    identityFieldsFilled({ pronouns: "they/them", orientation: ["queer", "fluid"] }),
    IDENTITY_MAX_FIELDS,
  );
  assertEquals(IDENTITY_MAX_FIELDS, 2);
});

Deno.test("identity: an empty-string pronoun does not count as filled", () => {
  assertEquals(identityFieldsFilled({ pronouns: "", orientation: [] }), 0);
});

Deno.test("card: all-empty is 0", () => {
  assertEquals(cardFieldsFilled(emptyCard), 0);
});

Deno.test("card: one non-empty array per field counts once each", () => {
  for (const field of CARD_FIELDS) {
    assertEquals(cardFieldsFilled({ ...emptyCard, [field]: ["x"] }), 1, field);
  }
});

Deno.test("card: mixed values count only the non-empty arrays", () => {
  assertEquals(
    cardFieldsFilled({ into: ["top"], safer_sex: ["condoms"], kinks: [], hard_nos: [] }),
    2,
  );
  assertEquals(
    cardFieldsFilled({
      into: ["top"],
      safer_sex: [],
      kinks: ["toys"],
      hard_nos: ["no drugs"],
    }),
    3,
  );
});

Deno.test("card: all-filled is 4, the migration-0003 upper bound", () => {
  assertEquals(
    cardFieldsFilled({
      into: ["top"],
      safer_sex: ["condoms"],
      kinks: ["toys"],
      hard_nos: ["no drugs"],
    }),
    CARD_MAX_FIELDS,
  );
  assertEquals(CARD_MAX_FIELDS, 4);
});

Deno.test("the two counts sum to the Me screen's 6", () => {
  assertEquals(IDENTITY_MAX_FIELDS + CARD_MAX_FIELDS, 6);
});

Deno.test("chip count never inflates the field count", () => {
  assertEquals(
    identityFieldsFilled({ pronouns: "she/her", orientation: ["bi", "queer", "fluid"] }),
    2,
  );
  assertEquals(cardFieldsFilled({ ...emptyCard, into: ["a", "b", "c", "d"] }), 1);
});
