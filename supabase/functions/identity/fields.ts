// Payload v2 field catalogue and the `fields_filled` computation.
// docs/edge-identity-plan.md §4; docs/design/profile-restructure/reconcile.md C1, C3.
//
// `vocab.ts` holds the raw lists (pure data). This module turns them into one
// spec per payload key (single or multi, cap, typed-entry rules), which is
// what validate.ts checks writes against, plus the payload types.
//
// `fields_filled` = the count of non-empty keys in the row's payload:
//   identity -> 16 keys, so 0..16
//   card     ->  9 keys, so 0..9
// Migration 0003's `fields_filled_range` CHECK constraints (0..2 / 0..4) must
// be widened to these bounds before a v2 write can land (reconcile C3).

import {
  AUDIENCE_CARDS,
  AUDIENCES,
  CARD_GROUP_ORDER,
  CARD_GROUPS,
  CARD_SECTIONS,
  COMMUNICATION_MAX_ITEMS,
  COMMUNICATION_OPTIONS,
  DRINKING_OPTIONS,
  DYNAMICS_OPTIONS,
  FAITH_OPTIONS,
  FAITH_WEIGHT_OPTIONS,
  FOUR_TWENTY_OPTIONS,
  HARD_NO_MAX_LENGTH,
  HARD_NO_MAX_TYPED,
  HARD_NO_OPTIONS,
  HOSTING_OPTIONS,
  IDENTITY_CARD_ORDER,
  IDENTITY_CARDS,
  IDENTITY_FIELDS,
  INTERESTED_IN_OPTIONS,
  KIDS_OPTIONS,
  LANGUAGE_MAX_ITEMS,
  LANGUAGE_MAX_LENGTH,
  LANGUAGE_MAX_TYPED,
  LANGUAGE_OPTIONS,
  LIVING_SITUATION_OPTIONS,
  ORIENTATION_CHIP_MAX_LENGTH,
  ORIENTATION_CHIPS,
  ORIENTATION_MAX_ITEMS,
  ORIENTATION_MAX_TYPED,
  PACE_OPTIONS,
  PHOTOS_CONTENT_MAX_ITEMS,
  PHOTOS_CONTENT_OPTIONS,
  POLITICS_OPTIONS,
  POLITICS_WEIGHT_OPTIONS,
  PRACTICE_GROUP_ORDER,
  PRACTICE_GROUPS,
  PRIVACY_OPTIONS,
  PRONOUN_MAX_ITEMS,
  PRONOUN_MAX_LENGTH,
  PRONOUN_MAX_TYPED,
  PRONOUN_OPTIONS,
  RELATIONSHIP_OPTIONS,
  SAFER_SEX_OPTIONS,
  SHOWS_INTEREST_OPTIONS,
  SINGLE_FIELDS,
  SMOKING_OPTIONS,
  WHEN_FREE_OPTIONS,
} from "./vocab.ts";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type IdentityField = typeof IDENTITY_FIELDS[number];
export type CardSection = typeof CARD_SECTIONS[number];
export type Audience = typeof AUDIENCES[number];
export type AudienceCard = typeof AUDIENCE_CARDS[number];
export type IdentityCard = typeof IDENTITY_CARD_ORDER[number];
export type CardGroup = typeof CARD_GROUP_ORDER[number];
export type GatedSection = typeof CARD_GROUPS.gated[number];
export type SingleField = typeof SINGLE_FIELDS[number];

/** The four plaintext audience columns of `public.user_identity` (0023). */
export type Audiences = Record<AudienceCard, Audience>;

/** Identity payload v2: what `payload_ciphertext` decrypts to once `payload_version = 2`. */
export interface IdentityPayloadV2 {
  pronouns: string[];
  orientation: string[];
  interested_in: string[];
  relationship: string | null;
  languages: string[];
  faith: string | null;
  faith_weight: string | null;
  politics: string | null;
  politics_weight: string | null;
  drinking: string | null;
  smoking: string | null;
  four_twenty: string | null;
  kids: string | null;
  when_free: string[];
  communication: string[];
  photos_content: string[];
}

/** Private-card payload v2. */
export interface CardPayloadV2 {
  shows_interest: string[];
  pace: string | null;
  living_situation: string | null;
  hosting: string | null;
  safer_sex: string[];
  dynamics: string[];
  practices: string[];
  hard_nos: string[];
  privacy: string[];
}

export type FieldValue = string | null | string[];

// -----------------------------------------------------------------------------
// Specs
// -----------------------------------------------------------------------------

/** A "write your own" allowance on a multi-select field. */
export interface TypedSpec {
  /** Max characters of one typed entry, after trimming and collapsing whitespace. */
  maxLength: number;
  /** Max typed entries in the field. */
  maxCount: number;
}

export type FieldSpec =
  | { kind: "single"; options: readonly string[] }
  | {
    kind: "multi";
    options: readonly string[];
    /** Max entries in total, fixed and typed together; null = uncapped within the list. */
    maxItems: number | null;
    /** null = fixed list only. */
    typed: TypedSpec | null;
  };

const single = (options: readonly string[]): FieldSpec => ({ kind: "single", options });
const multi = (
  options: readonly string[],
  maxItems: number | null = null,
  typed: TypedSpec | null = null,
): FieldSpec => ({ kind: "multi", options, maxItems, typed });

/** The practice list, flat, in picker order (storage is flat; D11 adds "toys"). */
export const PRACTICE_OPTIONS: readonly string[] = PRACTICE_GROUP_ORDER.flatMap(
  (group) => PRACTICE_GROUPS[group],
);

export const IDENTITY_FIELD_SPECS: Record<IdentityField, FieldSpec> = {
  pronouns: multi(PRONOUN_OPTIONS, PRONOUN_MAX_ITEMS, {
    maxLength: PRONOUN_MAX_LENGTH,
    maxCount: PRONOUN_MAX_TYPED,
  }),
  orientation: multi(ORIENTATION_CHIPS, ORIENTATION_MAX_ITEMS, {
    maxLength: ORIENTATION_CHIP_MAX_LENGTH,
    maxCount: ORIENTATION_MAX_TYPED,
  }),
  interested_in: multi(INTERESTED_IN_OPTIONS),
  relationship: single(RELATIONSHIP_OPTIONS),
  languages: multi(LANGUAGE_OPTIONS, LANGUAGE_MAX_ITEMS, {
    maxLength: LANGUAGE_MAX_LENGTH,
    maxCount: LANGUAGE_MAX_TYPED,
  }),
  faith: single(FAITH_OPTIONS),
  faith_weight: single(FAITH_WEIGHT_OPTIONS),
  politics: single(POLITICS_OPTIONS),
  politics_weight: single(POLITICS_WEIGHT_OPTIONS),
  drinking: single(DRINKING_OPTIONS),
  smoking: single(SMOKING_OPTIONS),
  four_twenty: single(FOUR_TWENTY_OPTIONS),
  kids: single(KIDS_OPTIONS),
  when_free: multi(WHEN_FREE_OPTIONS),
  communication: multi(COMMUNICATION_OPTIONS, COMMUNICATION_MAX_ITEMS),
  photos_content: multi(PHOTOS_CONTENT_OPTIONS, PHOTOS_CONTENT_MAX_ITEMS),
};

export const CARD_SECTION_SPECS: Record<CardSection, FieldSpec> = {
  shows_interest: multi(SHOWS_INTEREST_OPTIONS),
  pace: single(PACE_OPTIONS),
  living_situation: single(LIVING_SITUATION_OPTIONS),
  hosting: single(HOSTING_OPTIONS),
  safer_sex: multi(SAFER_SEX_OPTIONS),
  dynamics: multi(DYNAMICS_OPTIONS),
  practices: multi(PRACTICE_OPTIONS),
  // Fixed chips uncapped (all 20 may be chosen); at most 5 typed (D8).
  hard_nos: multi(HARD_NO_OPTIONS, null, {
    maxLength: HARD_NO_MAX_LENGTH,
    maxCount: HARD_NO_MAX_TYPED,
  }),
  privacy: multi(PRIVACY_OPTIONS),
};

/** The public card a payload key renders on. */
export const IDENTITY_FIELD_CARD: Record<IdentityField, IdentityCard> = Object.fromEntries(
  IDENTITY_CARD_ORDER.flatMap((card) =>
    (IDENTITY_CARDS[card] as readonly IdentityField[]).map((field) => [field, card])
  ),
) as Record<IdentityField, IdentityCard>;

/** The private-card group a section belongs to. */
export const CARD_SECTION_GROUP: Record<CardSection, CardGroup> = Object.fromEntries(
  CARD_GROUP_ORDER.flatMap((group) =>
    (CARD_GROUPS[group] as readonly CardSection[]).map((section) => [section, group])
  ),
) as Record<CardSection, CardGroup>;

export function isGatedSection(value: string): value is GatedSection {
  return (CARD_GROUPS.gated as readonly string[]).includes(value);
}

// -----------------------------------------------------------------------------
// Empty payloads and defaults
// -----------------------------------------------------------------------------

function emptyFor<K extends string>(
  keys: readonly K[],
  specs: Record<K, FieldSpec>,
): Record<K, FieldValue> {
  const out = {} as Record<K, FieldValue>;
  for (const key of keys) out[key] = specs[key].kind === "single" ? null : [];
  return out;
}

export function emptyIdentity(): IdentityPayloadV2 {
  return emptyFor(IDENTITY_FIELDS, IDENTITY_FIELD_SPECS) as unknown as IdentityPayloadV2;
}

export function emptyCard(): CardPayloadV2 {
  return emptyFor(CARD_SECTIONS, CARD_SECTION_SPECS) as unknown as CardPayloadV2;
}

export function defaultAudiences(): Audiences {
  return {
    identity: "everyone",
    background: "everyone",
    lifestyle: "everyone",
    around: "everyone",
  };
}

// -----------------------------------------------------------------------------
// fields_filled
// -----------------------------------------------------------------------------

export const IDENTITY_MAX_FIELDS = IDENTITY_FIELDS.length; // 16
export const CARD_MAX_FIELDS = CARD_SECTIONS.length; // 9

/** A single value is filled when it is a non-empty string; a multi when non-empty. */
export function isFilled(value: unknown): boolean {
  if (typeof value === "string") return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return false;
}

/** 0..16, one per non-empty key. */
export function identityFieldsFilled(payload: IdentityPayloadV2): number {
  return IDENTITY_FIELDS.filter((field) => isFilled(payload[field])).length;
}

/** 0..9, one per non-empty section. */
export function cardFieldsFilled(payload: CardPayloadV2): number {
  return CARD_SECTIONS.filter((section) => isFilled(payload[section])).length;
}
