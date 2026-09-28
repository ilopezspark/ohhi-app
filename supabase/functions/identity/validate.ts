// Request-body schemas and the chip vocabularies.
// docs/edge-identity-plan.md §3/§7 Q1-Q2, decisions 20 and 21; vocabulary
// values per docs/design/me-redesign/brief.md rulings 1, 3, 4, 5, 6 and the
// `08-edit-private-card.png` artboard (28 September 2026).
//
// The vocabularies are a function-side constant, versioned with this function's
// deploys, not a DB table: there is no product-owned equivalent of `tags` for
// these fields yet (decision 21, "until product defines the real taxonomy").
// `hard_nos` is the one exception (ruling 4): it also accepts typed entries
// alongside its fixed suggestions. Everything else below is still a fixed
// allow-list, now matching the redesign artboards rather than a placeholder.
//
// Every violation is a 400 with field-level detail in the message. Unknown
// top-level keys are rejected, not ignored.

/** Decision 20 / artboard order: a short fixed pronoun list, plus a free-text opt-out. */
export const PRONOUN_OPTIONS = [
  "he/him",
  "she/her",
  "they/them",
  "ask me",
] as const;

/** One length cap for every chip and for the decision-20 free-text opt-out. */
export const CHIP_MAX_LENGTH = 40;

/** Cap on the decision-20 free-text pronoun opt-out. */
export const PRONOUN_MAX_LENGTH = CHIP_MAX_LENGTH;

/** Cap on an orientation chip. */
export const ORIENTATION_CHIP_MAX_LENGTH = CHIP_MAX_LENGTH;

/**
 * Ruling 6 / artboard order: orientation ("i'm") is chips only, up to three,
 * from a fixed list. "single" is deliberately never offered (ruling 6).
 */
export const ORIENTATION_CHIPS = [
  "bi",
  "straight",
  "gay",
  "queer",
  "asexual",
  "rather not say",
] as const;

export const ORIENTATION_MAX_ITEMS = 3;

export const CARD_FIELDS = ["into", "safer_sex", "kinks", "hard_nos"] as const;
export type CardField = typeof CARD_FIELDS[number];

/** Decision 21 / ruling 4: 0-8 chips per array, each at most 40 characters. */
export const CARD_MAX_ITEMS = 8;
export const CARD_CHIP_MAX_LENGTH = CHIP_MAX_LENGTH;

/**
 * Fixed per-field allow-lists, matching the redesign artboards (ruling 3 keeps
 * `kinks` as-is; ruling 4 makes `hard_nos` accept typed entries in addition to
 * its fixed suggestions below — see `SAFER_SEX_TESTED_PATTERN` and
 * `hardNosArray`/`validateCardRequest` for how the two exceptions apply).
 */
export const CARD_CHIPS: Record<CardField, readonly string[]> = {
  into: [
    "men",
    "women",
    "nonbinary people",
    "everyone",
  ],
  safer_sex: [
    "condoms",
    "on prep",
    "on birth control",
    "ask me",
  ],
  kinks: [
    "vanilla",
    "light bondage",
    "roleplay",
    "toys",
    "exhibitionism",
    "voyeurism",
    "dom",
    "sub",
    "switch",
    "open to discuss",
  ],
  /** Fixed suggestions only — ruling 4 lets a card also carry typed entries. */
  hard_nos: [
    "no pics unasked",
    "no substances",
    "nothing off campus",
  ],
};

/** Three-letter lowercase month abbreviations accepted by the `tested` pattern. */
export const SAFER_SEX_TESTED_MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
] as const;

/**
 * `safer_sex` also accepts `tested <mon> '<yy>` (e.g. "tested apr '26"): a
 * lowercase three-letter month from `SAFER_SEX_TESTED_MONTHS`, a literal
 * space, an apostrophe, and a two-digit year. It is a pattern, not a fixed
 * chip, so it is not listed in `CARD_CHIPS.safer_sex`.
 */
export const SAFER_SEX_TESTED_PATTERN = new RegExp(
  `^tested (${SAFER_SEX_TESTED_MONTHS.join("|")}) '\\d{2}$`,
);

function isSaferSexChip(item: string): boolean {
  return CARD_CHIPS.safer_sex.includes(item) || SAFER_SEX_TESTED_PATTERN.test(item);
}

/** Control characters (including tab/newline) are never allowed in a typed hard-no. */
// deno-lint-ignore no-control-regex
const CONTROL_CHAR_RE = /[\u0000-\u001F\u007F]/;

export interface IdentityPayload {
  pronouns: string | null;
  orientation: string[];
}

/** PUT /identity body: the encrypted payload plus the `is_public` column. */
export interface IdentityRequest extends IdentityPayload {
  is_public: boolean;
}

export type CardPayload = Record<CardField, string[]>;

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

function asObject(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new ValidationError("Body must be a JSON object.");
  }
  return body as Record<string, unknown>;
}

function rejectUnknownKeys(obj: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(obj).filter((k) => !allowed.includes(k));
  if (unknown.length > 0) {
    throw new ValidationError(`Unknown key(s): ${unknown.sort().join(", ")}.`);
  }
}

function requireKeys(obj: Record<string, unknown>, required: readonly string[]): void {
  const missing = required.filter((k) => !Object.hasOwn(obj, k));
  if (missing.length > 0) {
    throw new ValidationError(`Missing key(s): ${missing.join(", ")}.`);
  }
}

/** A chip array: right type, within maxItems, within maxLength, on the allow-list. */
function chipArray(
  value: unknown,
  field: string,
  allowed: readonly string[] | ((item: string) => boolean),
  maxItems: number,
  maxLength: number,
): string[] {
  if (!Array.isArray(value)) {
    throw new ValidationError(`${field} must be an array of strings.`);
  }
  if (value.length > maxItems) {
    throw new ValidationError(
      `${field} accepts at most ${maxItems} items, got ${value.length}.`,
    );
  }
  const isAllowed = typeof allowed === "function"
    ? allowed
    : (item: string) => allowed.includes(item);
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      throw new ValidationError(`${field} must contain only strings.`);
    }
    if (item.length > maxLength) {
      throw new ValidationError(`${field} items must be at most ${maxLength} characters.`);
    }
    if (!isAllowed(item)) {
      throw new ValidationError(`${field} contains an unknown value.`);
    }
    if (out.includes(item)) {
      throw new ValidationError(`${field} contains a duplicate value.`);
    }
    out.push(item);
  }
  return out;
}

/**
 * Ruling 4: `hard_nos` accepts typed entries alongside its fixed suggestions.
 * A typed entry is trimmed, has its internal whitespace runs collapsed to a
 * single space, must be 1-40 characters after that, and must contain no
 * control character (including a newline) anywhere in the original string.
 * The whole group (fixed selections plus typed entries) is de-duplicated
 * case-insensitively — a typed entry that case-insensitively matches a fixed
 * suggestion is stored under the fixed suggestion's own spelling.
 */
function hardNosArray(
  value: unknown,
  field: string,
  fixed: readonly string[],
  maxItems: number,
  maxLength: number,
): string[] {
  if (!Array.isArray(value)) {
    throw new ValidationError(`${field} must be an array of strings.`);
  }
  if (value.length > maxItems) {
    throw new ValidationError(
      `${field} accepts at most ${maxItems} items, got ${value.length}.`,
    );
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      throw new ValidationError(`${field} must contain only strings.`);
    }
    if (CONTROL_CHAR_RE.test(item)) {
      throw new ValidationError(`${field} items must not contain control characters.`);
    }
    const trimmed = item.trim().replace(/ {2,}/g, " ");
    if (trimmed.length === 0) {
      throw new ValidationError(`${field} items must be at least 1 character.`);
    }
    if (trimmed.length > maxLength) {
      throw new ValidationError(`${field} items must be at most ${maxLength} characters.`);
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      throw new ValidationError(`${field} contains a duplicate value.`);
    }
    seen.add(key);
    const canonical = fixed.find((f) => f.toLowerCase() === key);
    out.push(canonical ?? trimmed);
  }
  return out;
}

/** Validates a PUT /identity body. Throws ValidationError on any violation. */
export function validateIdentityRequest(body: unknown): IdentityRequest {
  const obj = asObject(body);
  rejectUnknownKeys(obj, ["pronouns", "orientation", "is_public"]);
  requireKeys(obj, ["pronouns", "orientation", "is_public"]);

  const { pronouns, orientation, is_public: isPublic } = obj;

  if (pronouns !== null && typeof pronouns !== "string") {
    throw new ValidationError("pronouns must be a string or null.");
  }
  if (typeof pronouns === "string") {
    if (pronouns.length === 0) {
      throw new ValidationError("pronouns must be null rather than an empty string.");
    }
    // Decision 20: the fixed list, or a free-text opt-out under the cap.
    if (pronouns.length > PRONOUN_MAX_LENGTH) {
      throw new ValidationError(
        `pronouns must be at most ${PRONOUN_MAX_LENGTH} characters.`,
      );
    }
  }
  if (typeof isPublic !== "boolean") {
    throw new ValidationError("is_public must be a boolean.");
  }

  return {
    pronouns: (pronouns as string | null) ?? null,
    orientation: chipArray(
      orientation,
      "orientation",
      ORIENTATION_CHIPS,
      ORIENTATION_MAX_ITEMS,
      ORIENTATION_CHIP_MAX_LENGTH,
    ),
    is_public: isPublic,
  };
}

/** Validates a PUT /card body. Throws ValidationError on any violation. */
export function validateCardRequest(body: unknown): CardPayload {
  const obj = asObject(body);
  rejectUnknownKeys(obj, CARD_FIELDS);
  requireKeys(obj, CARD_FIELDS);

  const out = {} as CardPayload;
  for (const field of CARD_FIELDS) {
    if (field === "hard_nos") {
      // Ruling 4: the only field that accepts typed entries.
      out[field] = hardNosArray(
        obj[field],
        field,
        CARD_CHIPS.hard_nos,
        CARD_MAX_ITEMS,
        CARD_CHIP_MAX_LENGTH,
      );
      continue;
    }
    out[field] = chipArray(
      obj[field],
      field,
      // `safer_sex` also accepts the `tested <mon> '<yy>` pattern; every
      // other field (`into`, `kinks`) stays a plain fixed-list check.
      field === "safer_sex" ? isSaferSexChip : CARD_CHIPS[field],
      CARD_MAX_ITEMS,
      CARD_CHIP_MAX_LENGTH,
    );
  }
  return out;
}

/**
 * Coerces a decrypted blob back into the response shape. A stored payload
 * predates any later vocabulary change, so this is shape-only — it must not
 * re-run the allow-list, or a chip retired by product would make an existing
 * row unreadable.
 */
export function readIdentityPayload(value: unknown): IdentityPayload {
  const obj = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const pronouns = typeof obj.pronouns === "string" ? obj.pronouns : null;
  const orientation = Array.isArray(obj.orientation)
    ? obj.orientation.filter((v): v is string => typeof v === "string")
    : [];
  return { pronouns, orientation };
}

/** Shape-only read of a stored card payload; see `readIdentityPayload`. */
export function readCardPayload(value: unknown): CardPayload {
  const obj = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const out = {} as CardPayload;
  for (const field of CARD_FIELDS) {
    const raw = obj[field];
    out[field] = Array.isArray(raw)
      ? raw.filter((v): v is string => typeof v === "string")
      : [];
  }
  return out;
}
