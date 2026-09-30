import { assertEquals } from "@std/assert";
import {
  CARD_MAX_FIELDS,
  CARD_SECTION_GROUP,
  cardFieldsFilled,
  emptyCard,
  emptyIdentity,
  IDENTITY_FIELD_CARD,
  IDENTITY_MAX_FIELDS,
  identityFieldsFilled,
  isFilled,
  isGatedSection,
} from "./fields.ts";
import { CARD_SECTIONS, IDENTITY_FIELDS } from "./vocab.ts";

Deno.test("bounds match migration 0023's widened fields_filled_range (0..16, 0..9)", () => {
  assertEquals(IDENTITY_MAX_FIELDS, 16);
  assertEquals(CARD_MAX_FIELDS, 9);
});

Deno.test("identity: all-empty is 0", () => {
  assertEquals(identityFieldsFilled(emptyIdentity()), 0);
});

Deno.test("identity: each field alone counts once", () => {
  for (const field of IDENTITY_FIELDS) {
    const payload = emptyIdentity() as unknown as Record<string, unknown>;
    payload[field] = Array.isArray(payload[field]) ? ["x"] : "x";
    assertEquals(
      identityFieldsFilled(payload as unknown as ReturnType<typeof emptyIdentity>),
      1,
      field,
    );
  }
});

Deno.test("identity: all-filled is 16; chip count never inflates it", () => {
  const payload = emptyIdentity() as unknown as Record<string, unknown>;
  for (const field of IDENTITY_FIELDS) {
    payload[field] = Array.isArray(payload[field]) ? ["a", "b", "c"] : "x";
  }
  assertEquals(
    identityFieldsFilled(payload as unknown as ReturnType<typeof emptyIdentity>),
    IDENTITY_MAX_FIELDS,
  );
});

Deno.test("card: all-empty is 0, each section once, all-filled is 9", () => {
  assertEquals(cardFieldsFilled(emptyCard()), 0);
  const full = emptyCard() as unknown as Record<string, unknown>;
  for (const section of CARD_SECTIONS) {
    const one = emptyCard() as unknown as Record<string, unknown>;
    one[section] = Array.isArray(one[section]) ? ["x"] : "x";
    assertEquals(
      cardFieldsFilled(one as unknown as ReturnType<typeof emptyCard>),
      1,
      section,
    );
    full[section] = Array.isArray(full[section]) ? ["x", "y"] : "x";
  }
  assertEquals(cardFieldsFilled(full as unknown as ReturnType<typeof emptyCard>), 9);
});

Deno.test("an empty string and an empty array are not filled", () => {
  assertEquals(isFilled(""), false);
  assertEquals(isFilled([]), false);
  assertEquals(isFilled(null), false);
  assertEquals(isFilled("slow"), true);
  assertEquals(isFilled(["x"]), true);
});

Deno.test("catalogue: every key knows its card or group", () => {
  assertEquals(IDENTITY_FIELD_CARD.pronouns, "identity");
  assertEquals(IDENTITY_FIELD_CARD.faith_weight, "background");
  assertEquals(IDENTITY_FIELD_CARD.four_twenty, "lifestyle");
  assertEquals(IDENTITY_FIELD_CARD.communication, "around");
  assertEquals(IDENTITY_FIELD_CARD.photos_content, "before_you_message");
  assertEquals(CARD_SECTION_GROUP.hosting, "standard");
  assertEquals(CARD_SECTION_GROUP.practices, "gated");
  assertEquals(CARD_SECTION_GROUP.privacy, "always_attached");
  assertEquals(isGatedSection("safer_sex"), true);
  assertEquals(isGatedSection("hard_nos"), false);
  assertEquals(isGatedSection("constructor"), false);
});
