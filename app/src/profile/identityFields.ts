import {
  AUDIENCE_CARDS,
  AUDIENCES,
  CARD_GROUP_ORDER,
  CARD_GROUPS,
  CARD_SECTIONS,
  COMMUNICATION_MAX_ITEMS,
  COMMUNICATION_OPTIONS,
  DEFAULT_AUDIENCE,
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
  WEIGHT_PARENTS,
  WHEN_FREE_OPTIONS,
} from '../settings/vocab';

/**
 * The restructured profile (payload v2): every public-profile field, public
 * card, audience, private-card section and group, as types and specs. Built
 * only from `settings/vocab.ts` (the synced copy of the identity function's
 * `vocab.ts`), mirroring the function's own `fields.ts`, so the editors and
 * renderers check exactly what the server checks. Plan:
 * `docs/design/profile-restructure/reconcile.md` C1-C3 and the owner rulings;
 * contracts: `supabase/functions/identity/README.md`.
 *
 * Re-exported from `profile/fields.ts`. Display labels live in
 * `settings/profileLabels.ts` (the owner's wording, ruling 3), surfaced
 * through `me/card/fieldLabels.ts`.
 *
 * None of these fields carry completion weight and none may be used to filter,
 * sort or search (brief §6, reconcile C8).
 */

// -----------------------------------------------------------------------------
// Names
// -----------------------------------------------------------------------------

/** `public.profile_audience`: who sees one public card. */
export type Audience = (typeof AUDIENCES)[number];
/** The four public cards that carry an audience. "before you message me" has none: always everyone. */
export type AudienceCard = (typeof AUDIENCE_CARDS)[number];
/** The four audience columns of `user_identity` (owner only). */
export type Audiences = Record<AudienceCard, Audience>;

/** The five public cards, in render order (after `about`). */
export type IdentityCard = (typeof IDENTITY_CARD_ORDER)[number];
/** The 16 identity payload keys. */
export type IdentityField = (typeof IDENTITY_FIELDS)[number];
/** The payload keys one public card renders. */
export type IdentityCardField<C extends IdentityCard> = (typeof IDENTITY_CARDS)[C][number];
/** `faith_weight` / `politics_weight`: rendered as the sub-line under their parent, never as a row. */
export type WeightField = keyof typeof WEIGHT_PARENTS;

/** The 9 private-card payload keys, in group order (hard nos then privacy last). */
export type CardSection = (typeof CARD_SECTIONS)[number];
/** The private-card groups, in render order. */
export type CardGroup = (typeof CARD_GROUP_ORDER)[number];
export type CardGroupSection<G extends CardGroup> = (typeof CARD_GROUPS)[G][number];
/** getting closer: always included in a share. */
export type StandardSection = CardGroupSection<'standard'>;
/** intimacy: ticked per share, revealed by the recipient's tap. */
export type GatedSection = CardGroupSection<'gated'>;
/** boundaries: always attached to a share. */
export type BoundarySection = CardGroupSection<'always_attached'>;
/** The practice picker's sub-headers (storage is flat, under `practices`). */
export type PracticeGroup = (typeof PRACTICE_GROUP_ORDER)[number];

/** Every key of either payload. */
export type ProfileKey = IdentityField | CardSection;
/** Keys holding one value (`string | null`) rather than a list. */
export type SingleField = (typeof SINGLE_FIELDS)[number];
/** What a key holds: one value or null for a single-select key, else a list (empty = unset). */
export type FieldValue<K extends ProfileKey> = K extends SingleField ? string | null : string[];

// -----------------------------------------------------------------------------
// Payloads
// -----------------------------------------------------------------------------

/** Identity payload v2, flat. Values are the stored labels (or typed text), never slugs. */
export type IdentityPayload = { [K in IdentityField]: FieldValue<K> };
/** Private-card payload v2, flat. */
export type CardPayload = { [K in CardSection]: FieldValue<K> };
/** One public card's values. */
export type IdentityCardValues<C extends IdentityCard> = { [K in IdentityCardField<C>]: FieldValue<K> };
/** Every public card's values, keyed by card (`GET /identity/:id`'s `cards`). */
export type IdentityCards = { [C in IdentityCard]: IdentityCardValues<C> };

/**
 * `PUT /identity` v2 body: any subset of the 16 keys plus an optional partial
 * `audiences`. A key present replaces the field (`null` / `[]` clears it); a
 * key absent is kept. At least one field or audience. A weight needs its parent.
 */
export type IdentityPatch = Partial<IdentityPayload> & { audiences?: Partial<Audiences> };
/** `PUT /identity/card` body: any subset of the nine sections, at least one. */
export type CardPatch = Partial<CardPayload>;

// -----------------------------------------------------------------------------
// Specs (same rules as the function's `fields.ts`)
// -----------------------------------------------------------------------------

/** A "write your own" allowance. */
export interface TypedEntrySpec {
  /** Max characters of one typed entry, after trimming and collapsing whitespace. */
  maxLength: number;
  /** Max typed entries in the field. */
  maxCount: number;
}

export type FieldSpec =
  | { multiple: false; options: readonly string[] }
  | {
      multiple: true;
      options: readonly string[];
      /** Max entries in total, fixed and typed together; null = uncapped within the list. */
      maxItems: number | null;
      /** null = fixed list only. */
      typed: TypedEntrySpec | null;
    };

const one = (options: readonly string[]): FieldSpec => ({ multiple: false, options });
const many = (options: readonly string[], maxItems: number | null = null, typed: TypedEntrySpec | null = null): FieldSpec => ({
  multiple: true,
  options,
  maxItems,
  typed,
});

/** The practice list, flat, in picker order (`toys` sits under `other`, D11). */
export const PRACTICE_OPTIONS: readonly string[] = PRACTICE_GROUP_ORDER.flatMap((group) => PRACTICE_GROUPS[group]);

export const IDENTITY_FIELD_SPECS: Record<IdentityField, FieldSpec> = {
  pronouns: many(PRONOUN_OPTIONS, PRONOUN_MAX_ITEMS, { maxLength: PRONOUN_MAX_LENGTH, maxCount: PRONOUN_MAX_TYPED }),
  orientation: many(ORIENTATION_CHIPS, ORIENTATION_MAX_ITEMS, {
    maxLength: ORIENTATION_CHIP_MAX_LENGTH,
    maxCount: ORIENTATION_MAX_TYPED,
  }),
  interested_in: many(INTERESTED_IN_OPTIONS),
  relationship: one(RELATIONSHIP_OPTIONS),
  languages: many(LANGUAGE_OPTIONS, LANGUAGE_MAX_ITEMS, { maxLength: LANGUAGE_MAX_LENGTH, maxCount: LANGUAGE_MAX_TYPED }),
  faith: one(FAITH_OPTIONS),
  faith_weight: one(FAITH_WEIGHT_OPTIONS),
  politics: one(POLITICS_OPTIONS),
  politics_weight: one(POLITICS_WEIGHT_OPTIONS),
  drinking: one(DRINKING_OPTIONS),
  smoking: one(SMOKING_OPTIONS),
  four_twenty: one(FOUR_TWENTY_OPTIONS),
  kids: one(KIDS_OPTIONS),
  when_free: many(WHEN_FREE_OPTIONS),
  communication: many(COMMUNICATION_OPTIONS, COMMUNICATION_MAX_ITEMS),
  photos_content: many(PHOTOS_CONTENT_OPTIONS, PHOTOS_CONTENT_MAX_ITEMS),
};

export const CARD_SECTION_SPECS: Record<CardSection, FieldSpec> = {
  shows_interest: many(SHOWS_INTEREST_OPTIONS),
  pace: one(PACE_OPTIONS),
  living_situation: one(LIVING_SITUATION_OPTIONS),
  hosting: one(HOSTING_OPTIONS),
  safer_sex: many(SAFER_SEX_OPTIONS),
  dynamics: many(DYNAMICS_OPTIONS),
  practices: many(PRACTICE_OPTIONS),
  // Fixed chips uncapped (all 20 may be picked); at most 5 typed (D8).
  hard_nos: many(HARD_NO_OPTIONS, null, { maxLength: HARD_NO_MAX_LENGTH, maxCount: HARD_NO_MAX_TYPED }),
  privacy: many(PRIVACY_OPTIONS),
};

/** The public card a payload key renders on. */
export const IDENTITY_FIELD_CARD = Object.fromEntries(
  IDENTITY_CARD_ORDER.flatMap((card) => (IDENTITY_CARDS[card] as readonly IdentityField[]).map((field) => [field, card]))
) as Record<IdentityField, IdentityCard>;

/** The private-card group a section belongs to. */
export const CARD_SECTION_GROUP = Object.fromEntries(
  CARD_GROUP_ORDER.flatMap((group) => (CARD_GROUPS[group] as readonly CardSection[]).map((section) => [section, group]))
) as Record<CardSection, CardGroup>;

// -----------------------------------------------------------------------------
// Guards
// -----------------------------------------------------------------------------

export function isSingleField(key: string): key is SingleField {
  return (SINGLE_FIELDS as readonly string[]).includes(key);
}

export function isGatedSection(value: unknown): value is GatedSection {
  return typeof value === 'string' && (CARD_GROUPS.gated as readonly string[]).includes(value);
}

export function isAudience(value: unknown): value is Audience {
  return typeof value === 'string' && (AUDIENCES as readonly string[]).includes(value);
}

/** False only for `before_you_message`, which is always shown to everyone once filled. */
export function isAudienceCard(card: IdentityCard): card is AudienceCard {
  return (AUDIENCE_CARDS as readonly string[]).includes(card);
}

// -----------------------------------------------------------------------------
// Empty values and defaults
// -----------------------------------------------------------------------------

function emptyValue(key: string): string | null | string[] {
  return isSingleField(key) ? null : [];
}

export function emptyIdentityPayload(): IdentityPayload {
  return Object.fromEntries(IDENTITY_FIELDS.map((field) => [field, emptyValue(field)])) as IdentityPayload;
}

export function emptyCardPayload(): CardPayload {
  return Object.fromEntries(CARD_SECTIONS.map((section) => [section, emptyValue(section)])) as CardPayload;
}

/** Every public card, every field unset (the owner's view of a row never written). */
export function emptyIdentityCards(): IdentityCards {
  return Object.fromEntries(
    IDENTITY_CARD_ORDER.map((card) => [card, Object.fromEntries(IDENTITY_CARDS[card].map((field) => [field, emptyValue(field)]))])
  ) as IdentityCards;
}

/** A card whose audience was never set shows to everyone (ruling 1). */
export function defaultAudiences(): Audiences {
  return Object.fromEntries(AUDIENCE_CARDS.map((card) => [card, DEFAULT_AUDIENCE])) as Audiences;
}

/** A single value is filled when it is a non-empty string; a list when it is non-empty. */
export function isFilled(value: unknown): boolean {
  if (typeof value === 'string') return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return false;
}

/** Whether any key of one card (or any object of values) holds something: the renderer skips cards where this is false. */
export function hasAnyValue(values: object | null | undefined): boolean {
  return !!values && Object.values(values).some(isFilled);
}

/** Flattens `cards` (whatever subset came back) into a full payload; absent cards read as unset. */
export function identityPayloadFromCards(cards: Partial<IdentityCards>): IdentityPayload {
  const payload = emptyIdentityPayload() as Record<IdentityField, unknown>;
  for (const card of IDENTITY_CARD_ORDER) {
    const values = cards[card] as Record<string, unknown> | undefined;
    if (!values) continue;
    for (const field of IDENTITY_CARDS[card]) {
      if (field in values) payload[field] = values[field];
    }
  }
  return payload as IdentityPayload;
}

// -----------------------------------------------------------------------------
// Tolerant readers for the function's JSON (shape-only, like its own readers:
// a retired chip still reads back; anything malformed reads as unset)
// -----------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One key's value, coerced to its shape: a non-empty string or null, or a list of non-empty strings. */
export function readFieldValue<K extends ProfileKey>(key: K, raw: unknown): FieldValue<K> {
  if (isSingleField(key)) {
    return (typeof raw === 'string' && raw.length > 0 ? raw : null) as FieldValue<K>;
  }
  return (Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string' && item.length > 0) : []) as FieldValue<K>;
}

/** `cards` from `GET /identity/:id`: only the cards present are kept (hidden and empty look the same); each kept card has every key. */
export function readIdentityCards(raw: unknown): Partial<IdentityCards> {
  const out: Partial<Record<IdentityCard, Record<string, unknown>>> = {};
  if (!isRecord(raw)) return out as Partial<IdentityCards>;
  for (const card of IDENTITY_CARD_ORDER) {
    const values = raw[card];
    if (!isRecord(values)) continue;
    out[card] = Object.fromEntries(IDENTITY_CARDS[card].map((field) => [field, readFieldValue(field, values[field])]));
  }
  return out as Partial<IdentityCards>;
}

/** `audiences` (owner only). Missing or unknown values read as the default. */
export function readAudiences(raw: unknown): Audiences {
  const out = defaultAudiences();
  if (!isRecord(raw)) return out;
  for (const card of AUDIENCE_CARDS) {
    const value = raw[card];
    if (isAudience(value)) out[card] = value;
  }
  return out;
}

/** The sections present in a card response (the owner gets all nine; a recipient never gets a gated one here). */
export function readCardSections(raw: unknown): Partial<CardPayload> {
  const out: Partial<Record<CardSection, unknown>> = {};
  if (!isRecord(raw)) return out as Partial<CardPayload>;
  for (const section of CARD_SECTIONS) {
    if (section in raw) out[section] = readFieldValue(section, raw[section]);
  }
  return out as Partial<CardPayload>;
}

/** `gated` from a card response: known gated names only, in group order, no repeats. */
export function readGatedSections(raw: unknown): GatedSection[] {
  if (!Array.isArray(raw)) return [];
  return CARD_GROUPS.gated.filter((section) => raw.includes(section));
}

// -----------------------------------------------------------------------------
// "write your own" entries (pronouns, orientation, languages, hard nos)
// -----------------------------------------------------------------------------

// eslint-disable-next-line no-control-regex -- the function's own control-character check, verbatim.
const CONTROL_CHAR_RE = /[\u0000-\u001F\u007F]/;

/** `not_listed`: the field takes listed options only (no "write your own"). */
export type TypedEntryRejection = 'empty' | 'too_long' | 'control_char' | 'duplicate' | 'too_many' | 'not_listed';

export interface TypedEntryResult {
  ok: boolean;
  /** Trimmed, whitespace collapsed, and in the list's own spelling when it matches an option. Present either way. */
  value: string;
  /** True when `value` is one of the listed options (so it does not count as typed). */
  listed: boolean;
  rejection?: TypedEntryRejection;
}

function canonicalOption(options: readonly string[], value: string): string | null {
  const key = value.toLowerCase();
  return options.find((option) => option.toLowerCase() === key) ?? null;
}

/** The entries of a list that are not on its fixed options (case-insensitive): the typed ones. */
export function typedEntries(values: readonly string[], options: readonly string[]): string[] {
  return values.filter((value) => canonicalOption(options, value) === null);
}

/**
 * Client-side mirror of the function's typed-entry rule, so an editor can
 * refuse a bad entry before the PUT. The server stays authoritative, and the
 * word filter only runs there. Checks, in order: control characters, empty,
 * a listed option matched case-insensitively (returned in the list's
 * spelling; never too long, never counted as typed), length, the typed-count
 * cap, and a case-insensitive duplicate of `existing`. The total `maxItems`
 * cap is the caller's (it applies to listed and typed alike).
 */
export function normalizeTypedEntry(raw: string, spec: FieldSpec, existing: readonly string[]): TypedEntryResult {
  if (CONTROL_CHAR_RE.test(raw)) return { ok: false, value: raw, listed: false, rejection: 'control_char' };

  const normalized = raw.trim().replace(/\s+/g, ' ');
  if (normalized.length === 0) return { ok: false, value: normalized, listed: false, rejection: 'empty' };

  const listed = canonicalOption(spec.options, normalized);
  const value = listed ?? normalized;
  const typed = spec.multiple ? spec.typed : null;

  if (!listed) {
    if (!typed) return { ok: false, value, listed: false, rejection: 'not_listed' };
    if (value.length > typed.maxLength) return { ok: false, value, listed: false, rejection: 'too_long' };
    if (typedEntries(existing, spec.options).length >= typed.maxCount) {
      return { ok: false, value, listed: false, rejection: 'too_many' };
    }
  }

  const key = value.toLowerCase();
  if (existing.some((item) => item.toLowerCase() === key)) {
    return { ok: false, value, listed: listed !== null, rejection: 'duplicate' };
  }
  return { ok: true, value, listed: listed !== null };
}
