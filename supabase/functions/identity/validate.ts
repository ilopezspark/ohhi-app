// Request-body schemas for payload v2, the v1 onboarding body, and the
// shape-only readers for stored payloads.
// docs/design/profile-restructure/reconcile.md C1-C3, C6, C9 and the owner rulings.
//
// The vocabularies themselves live in vocab.ts (pure data) and are re-exported
// from here, so `import { PRONOUN_OPTIONS } from "./validate.ts"` keeps working.
//
// Every violation is a 400 with field-level detail in the message. Unknown
// top-level keys are rejected, not ignored. Write-your-own entries are only
// length- and shape-checked here; the word filter (0018) runs in router.ts,
// inside the write transaction, because it needs the database.

import {
  type Audience,
  type AudienceCard,
  type Audiences,
  CARD_SECTION_SPECS,
  type CardPayloadV2,
  type CardSection,
  emptyCard,
  emptyIdentity,
  type FieldSpec,
  type FieldValue,
  IDENTITY_FIELD_SPECS,
  type IdentityField,
  type IdentityPayloadV2,
} from "./fields.ts";
import {
  AUDIENCE_CARDS,
  AUDIENCES,
  CARD_SECTIONS,
  CHIP_MAX_LENGTH,
  IDENTITY_FIELDS,
  WEIGHT_PARENTS,
} from "./vocab.ts";

export * from "./vocab.ts";

/** The neutral refusal every 0018 write path uses; never echoes the text. */
export const DIRTY_TEXT_MESSAGE = "that text can't be used";

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/** Control characters (including tab/newline) are never allowed in a typed entry. */
// deno-lint-ignore no-control-regex
const CONTROL_CHAR_RE = /[\u0000-\u001F\u007F]/;

function asObject(body: unknown, what = "Body"): Record<string, unknown> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new ValidationError(`${what} must be a JSON object.`);
  }
  return body as Record<string, unknown>;
}

function rejectUnknownKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  hint = "",
): void {
  const unknown = Object.keys(obj).filter((k) => !allowed.includes(k));
  if (unknown.length > 0) {
    throw new ValidationError(`Unknown key(s): ${unknown.sort().join(", ")}.${hint}`);
  }
}

function requireKeys(obj: Record<string, unknown>, required: readonly string[]): void {
  const missing = required.filter((k) => !Object.hasOwn(obj, k));
  if (missing.length > 0) {
    throw new ValidationError(`Missing key(s): ${missing.join(", ")}.`);
  }
}

/** Trims and collapses internal whitespace runs to one space. */
export function normalizeTyped(item: string): string {
  return item.trim().replace(/\s+/g, " ");
}

/** The fixed option matching `item` case-insensitively, if any. */
function canonicalOption(options: readonly string[], item: string): string | undefined {
  const key = item.toLowerCase();
  return options.find((o) => o.toLowerCase() === key);
}

/**
 * Validates one field's value against its spec.
 *
 * single: a string on the list, or null.
 * multi, fixed only: an array of distinct strings, each on the list (exact).
 * multi, write your own: each entry is either a fixed option (matched
 *   case-insensitively and stored under the list's own spelling) or a typed
 *   entry: no control characters, trimmed, whitespace collapsed, 1..maxLength
 *   characters. De-duplicated case-insensitively. At most `typed.maxCount`
 *   typed entries and at most `maxItems` in total.
 */
export function validateField(spec: FieldSpec, value: unknown, field: string): FieldValue {
  if (spec.kind === "single") {
    if (value === null) return null;
    if (typeof value !== "string") {
      throw new ValidationError(`${field} must be a string or null.`);
    }
    if (!spec.options.includes(value)) {
      throw new ValidationError(`${field} contains an unknown value.`);
    }
    return value;
  }

  if (!Array.isArray(value)) {
    throw new ValidationError(`${field} must be an array of strings.`);
  }
  if (spec.maxItems !== null && value.length > spec.maxItems) {
    throw new ValidationError(
      `${field} accepts at most ${spec.maxItems} items, got ${value.length}.`,
    );
  }
  const seen = new Set<string>();
  const out: string[] = [];
  let typedCount = 0;
  for (const item of value) {
    if (typeof item !== "string") {
      throw new ValidationError(`${field} must contain only strings.`);
    }
    let stored: string;
    if (spec.typed) {
      if (CONTROL_CHAR_RE.test(item)) {
        throw new ValidationError(`${field} items must not contain control characters.`);
      }
      const normalized = normalizeTyped(item);
      if (normalized.length === 0) {
        throw new ValidationError(`${field} items must be at least 1 character.`);
      }
      const canonical = canonicalOption(spec.options, normalized);
      if (canonical) {
        stored = canonical;
      } else {
        if (normalized.length > spec.typed.maxLength) {
          throw new ValidationError(
            `${field} typed entries must be at most ${spec.typed.maxLength} characters.`,
          );
        }
        typedCount += 1;
        stored = normalized;
      }
    } else {
      if (item.length > CHIP_MAX_LENGTH) {
        throw new ValidationError(
          `${field} items must be at most ${CHIP_MAX_LENGTH} characters.`,
        );
      }
      if (!spec.options.includes(item)) {
        throw new ValidationError(`${field} contains an unknown value.`);
      }
      stored = item;
    }
    const key = stored.toLowerCase();
    if (seen.has(key)) {
      throw new ValidationError(`${field} contains a duplicate value.`);
    }
    seen.add(key);
    out.push(stored);
  }
  if (spec.typed && typedCount > spec.typed.maxCount) {
    throw new ValidationError(
      `${field} accepts at most ${spec.typed.maxCount} typed ${
        spec.typed.maxCount === 1 ? "entry" : "entries"
      }.`,
    );
  }
  return out;
}

/** Entries of a multi field that are not on its fixed list (the typed ones). */
export function typedEntries(spec: FieldSpec, value: FieldValue): string[] {
  if (spec.kind !== "multi" || !spec.typed || !Array.isArray(value)) return [];
  return value.filter((v) => !spec.options.includes(v));
}

/**
 * Typed entries present in `next` but not in `stored`, across every field
 * that accepts them. Only these go through the word filter: text already
 * stored is not re-checked (the 0018 rule, reconcile C6).
 */
export function newTypedEntries<K extends string>(
  specs: Record<K, FieldSpec>,
  keys: readonly K[],
  stored: Record<K, FieldValue>,
  next: Record<K, FieldValue>,
): string[] {
  const out: string[] = [];
  for (const key of keys) {
    const before = new Set(typedEntries(specs[key], stored[key]));
    for (const entry of typedEntries(specs[key], next[key])) {
      if (!before.has(entry)) out.push(entry);
    }
  }
  return out;
}

function validateAudiences(value: unknown): Partial<Audiences> {
  const obj = asObject(value, "audiences");
  rejectUnknownKeys(obj, AUDIENCE_CARDS);
  const out: Partial<Audiences> = {};
  for (const card of AUDIENCE_CARDS) {
    if (!Object.hasOwn(obj, card)) continue;
    const audience = obj[card];
    if (
      typeof audience !== "string" || !(AUDIENCES as readonly string[]).includes(audience)
    ) {
      throw new ValidationError(
        `audiences.${card} must be one of ${AUDIENCES.join(", ")}.`,
      );
    }
    out[card] = audience as Audience;
  }
  return out;
}

// -----------------------------------------------------------------------------
// PUT /identity
// -----------------------------------------------------------------------------

/**
 * The v1 body onboarding sends (reconcile C9), still accepted exactly:
 * `{pronouns: string|null, orientation: string[], is_public: boolean}`, all
 * three keys required. Checked against the v2 vocabularies: the pronoun is a
 * listed option or one typed entry of at most 16 characters.
 */
export interface IdentityPutV1 {
  kind: "v1";
  pronoun: string | null;
  orientation: string[];
  isPublic: boolean;
}

/** A v2 partial patch: any subset of the 16 fields, plus any of the four audiences. */
export interface IdentityPutV2 {
  kind: "v2";
  patch: Partial<IdentityPayloadV2>;
  audiences: Partial<Audiences>;
}

export type IdentityPut = IdentityPutV1 | IdentityPutV2;

export const IDENTITY_V1_KEYS = ["pronouns", "orientation", "is_public"] as const;

/** Validates a PUT /identity body. The presence of `is_public` selects the v1 body. */
export function validateIdentityPut(body: unknown): IdentityPut {
  const obj = asObject(body);

  if (Object.hasOwn(obj, "is_public")) {
    rejectUnknownKeys(obj, IDENTITY_V1_KEYS);
    requireKeys(obj, IDENTITY_V1_KEYS);
    const { pronouns, orientation, is_public: isPublic } = obj;
    if (pronouns !== null && typeof pronouns !== "string") {
      throw new ValidationError("pronouns must be a string or null.");
    }
    if (pronouns === "") {
      throw new ValidationError("pronouns must be null rather than an empty string.");
    }
    if (typeof isPublic !== "boolean") {
      throw new ValidationError("is_public must be a boolean.");
    }
    const pronoun = pronouns === null
      ? null
      : (validateField(IDENTITY_FIELD_SPECS.pronouns, [pronouns], "pronouns") as string[])[
        0
      ];
    return {
      kind: "v1",
      pronoun,
      orientation: validateField(
        IDENTITY_FIELD_SPECS.orientation,
        orientation,
        "orientation",
      ) as string[],
      isPublic,
    };
  }

  rejectUnknownKeys(obj, [...IDENTITY_FIELDS, "audiences"]);
  const patch: Record<string, FieldValue> = {};
  for (const field of IDENTITY_FIELDS) {
    if (!Object.hasOwn(obj, field)) continue;
    patch[field] = validateField(IDENTITY_FIELD_SPECS[field], obj[field], field);
  }
  const audiences = Object.hasOwn(obj, "audiences") ? validateAudiences(obj.audiences) : {};
  if (Object.keys(patch).length === 0 && Object.keys(audiences).length === 0) {
    throw new ValidationError("Body must set at least one field or audience.");
  }
  return { kind: "v2", patch: patch as Partial<IdentityPayloadV2>, audiences };
}

/**
 * Applies a validated PUT /identity to the stored payload and audiences.
 * Pure. Throws ValidationError when a weight is set without its parent.
 *
 * v1 body:
 *   - pronouns: null clears them. A string equal to the stored first pronoun
 *     keeps the stored list (an old client round-trips only the first one);
 *     any other string replaces the list with just that pronoun.
 *   - orientation replaces the stored list.
 *   - is_public true -> identity audience `everyone`; false -> `only_me`,
 *     except that a stored `after_hi` stays `after_hi` (it is already not
 *     public). Other audiences and every other field are untouched.
 * v2 body: each key present replaces that field; audiences merge per card.
 *   Clearing `faith`/`politics` clears its weight too.
 */
export function applyIdentityPut(
  put: IdentityPut,
  stored: IdentityPayloadV2,
  storedAudiences: Audiences,
): { payload: IdentityPayloadV2; audiences: Audiences } {
  const payload: IdentityPayloadV2 = { ...stored };
  const audiences: Audiences = { ...storedAudiences };

  if (put.kind === "v1") {
    if (put.pronoun === null) payload.pronouns = [];
    else if (stored.pronouns[0] !== put.pronoun) payload.pronouns = [put.pronoun];
    payload.orientation = put.orientation;
    audiences.identity = put.isPublic
      ? "everyone"
      : storedAudiences.identity === "after_hi"
      ? "after_hi"
      : "only_me";
    return { payload, audiences };
  }

  Object.assign(payload, put.patch);
  for (
    const [weight, parent] of Object.entries(WEIGHT_PARENTS) as [
      "faith_weight" | "politics_weight",
      "faith" | "politics",
    ][]
  ) {
    if (payload[parent] !== null) continue;
    if (Object.hasOwn(put.patch, weight) && put.patch[weight] !== null) {
      throw new ValidationError(`${weight} needs ${parent} to be set.`);
    }
    payload[weight] = null;
  }
  for (const card of Object.keys(put.audiences) as AudienceCard[]) {
    audiences[card] = put.audiences[card] as Audience;
  }
  return { payload, audiences };
}

/** `is_public` stays in step with the identity card's audience (the old app reads it). */
export function isPublicFor(audiences: Audiences): boolean {
  return audiences.identity === "everyone";
}

// -----------------------------------------------------------------------------
// PUT /identity/card
// -----------------------------------------------------------------------------

const RETIRED_CARD_KEYS = ["into", "kinks"];

/** Validates a PUT /identity/card v2 body: any subset of the nine sections. */
export function validateCardPut(body: unknown): Partial<CardPayloadV2> {
  const obj = asObject(body);
  const retired = RETIRED_CARD_KEYS.some((k) => Object.hasOwn(obj, k));
  rejectUnknownKeys(
    obj,
    CARD_SECTIONS,
    retired ? " The v1 card body is retired; send the v2 sections." : "",
  );
  const patch: Record<string, FieldValue> = {};
  for (const section of CARD_SECTIONS) {
    if (!Object.hasOwn(obj, section)) continue;
    patch[section] = validateField(CARD_SECTION_SPECS[section], obj[section], section);
  }
  if (Object.keys(patch).length === 0) {
    throw new ValidationError("Body must set at least one section.");
  }
  return patch as Partial<CardPayloadV2>;
}

export function applyCardPut(
  patch: Partial<CardPayloadV2>,
  stored: CardPayloadV2,
): CardPayloadV2 {
  return { ...stored, ...patch };
}

// -----------------------------------------------------------------------------
// Shape-only reads of a stored v2 payload
// -----------------------------------------------------------------------------

// A stored payload predates any later vocabulary change, so reads are
// shape-only: they must not re-run the allow-list, or a chip retired by
// product would make an existing row unreadable.

function readShape<K extends string>(
  value: unknown,
  keys: readonly K[],
  specs: Record<K, FieldSpec>,
  base: Record<K, FieldValue>,
): Record<K, FieldValue> {
  const obj = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const out = { ...base };
  for (const key of keys) {
    const raw = obj[key];
    if (specs[key].kind === "single") {
      out[key] = typeof raw === "string" && raw.length > 0 ? raw : null;
    } else {
      out[key] = Array.isArray(raw)
        ? raw.filter((v): v is string => typeof v === "string")
        : [];
    }
  }
  return out;
}

export function readIdentityV2(value: unknown): IdentityPayloadV2 {
  return readShape(
    value,
    IDENTITY_FIELDS,
    IDENTITY_FIELD_SPECS,
    emptyIdentity() as unknown as Record<IdentityField, FieldValue>,
  ) as unknown as IdentityPayloadV2;
}

export function readCardV2(value: unknown): CardPayloadV2 {
  return readShape(
    value,
    CARD_SECTIONS,
    CARD_SECTION_SPECS,
    emptyCard() as unknown as Record<CardSection, FieldValue>,
  ) as unknown as CardPayloadV2;
}
