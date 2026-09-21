// Request-body schemas and the chip vocabularies.
// docs/edge-identity-plan.md §3/§7 Q1-Q2, decisions 20 and 21.
//
// The vocabularies are a function-side constant, versioned with this function's
// deploys, not a DB table: there is no product-owned equivalent of `tags` for
// these fields yet (decision 21, "until product defines the real taxonomy").
// The lists below are PROVISIONAL placeholders — replace them wholesale when
// product ships the taxonomy; nothing else in the function reads them.
//
// Every violation is a 400 with field-level detail in the message. Unknown
// top-level keys are rejected, not ignored.

/** Decision 20: a short fixed pronoun list, plus a free-text opt-out. */
export const PRONOUN_OPTIONS = [
  "she/her",
  "he/him",
  "they/them",
  "ask me",
] as const;

/** One length cap for every chip and for the decision-20 free-text opt-out. */
export const CHIP_MAX_LENGTH = 40;

/** Cap on the decision-20 free-text pronoun opt-out. */
export const PRONOUN_MAX_LENGTH = CHIP_MAX_LENGTH;

/** Cap on an orientation chip. */
export const ORIENTATION_CHIP_MAX_LENGTH = CHIP_MAX_LENGTH;

/** Decision 14/20: orientation is chips only, up to three, from a fixed list. */
export const ORIENTATION_CHIPS = [
  "gay",
  "bi",
  "pan",
  "queer",
  "straight",
  "ace",
  "demi",
  "fluid",
  "questioning",
  "prefer not to say",
] as const;

export const ORIENTATION_MAX_ITEMS = 3;

export const CARD_FIELDS = ["into", "safer_sex", "kinks", "hard_nos"] as const;
export type CardField = typeof CARD_FIELDS[number];

/** Decision 21: 0-8 chips per array, each at most 40 characters. */
export const CARD_MAX_ITEMS = 8;
export const CARD_CHIP_MAX_LENGTH = CHIP_MAX_LENGTH;

/** Provisional per-field allow-lists (decision 21). Replace with the real taxonomy. */
export const CARD_CHIPS: Record<CardField, readonly string[]> = {
  into: [
    "top",
    "bottom",
    "vers",
    "vers top",
    "vers bottom",
    "side",
    "making out",
    "oral",
    "mutual",
    "cuddling",
    "dates first",
  ],
  safer_sex: [
    "condoms",
    "condoms for anal",
    "on prep",
    "on doxypep",
    "undetectable",
    "recently tested",
    "test regularly",
    "no fluid exchange",
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
  hard_nos: [
    "no bareback",
    "no drugs",
    "no pain",
    "no choking",
    "no photos",
    "no public play",
    "no group",
    "ask first",
  ],
};

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
  allowed: readonly string[],
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
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      throw new ValidationError(`${field} must contain only strings.`);
    }
    if (item.length > maxLength) {
      throw new ValidationError(`${field} items must be at most ${maxLength} characters.`);
    }
    if (!allowed.includes(item)) {
      throw new ValidationError(`${field} contains an unknown value.`);
    }
    if (out.includes(item)) {
      throw new ValidationError(`${field} contains a duplicate value.`);
    }
    out.push(item);
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
    out[field] = chipArray(
      obj[field],
      field,
      CARD_CHIPS[field],
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
