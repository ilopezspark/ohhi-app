// Payload v1 -> v2 mapping. Pure: no I/O, no crypto, no database.
// docs/design/profile-restructure/reconcile.md B1 (the table this implements),
// C7 (the backfill that uses it) and D11 (toys, tested dates).
//
// Used in two places:
//   - on read: a row still at `payload_version = 1` is mapped before it is
//     returned or merged into a write (router.ts). No word filter runs on
//     this path: stored text is not re-checked (the 0018 rule).
//   - by backfill_v2.ts, which also runs the word filter over a free-text
//     pronoun and passes the dirty ones in `opts.dirty`.
//
// The report lists FIELD NAMES only, never values, because it ends up in a
// plaintext `user_notices.payload` (reconcile C2):
//   moved     v2 fields newly on the public profile from the private card
//             (only `interested_in`; decided by the backfill, which knows
//             the identity card's audience)
//   held_back v2 fields where a value was kept out and has to be re-entered
//             (`pronouns` too long / dirty, `interested_in` when moving it
//             would publish it, `hard_nos` past the typed cap)
//   removed   v1 fields where a value had no v2 home and was dropped

import {
  type CardPayloadV2,
  emptyCard,
  emptyIdentity,
  type IdentityPayloadV2,
} from "./fields.ts";
import { normalizeTyped, readCardV2, readIdentityV2 } from "./validate.ts";
import {
  HARD_NO_MAX_LENGTH,
  HARD_NO_MAX_TYPED,
  HARD_NO_OPTIONS,
  INTERESTED_IN_OPTIONS,
  ORIENTATION_CHIPS,
  ORIENTATION_MAX_ITEMS,
  PRONOUN_MAX_LENGTH,
  PRONOUN_OPTIONS,
  SAFER_SEX_OPTIONS,
} from "./vocab.ts";

// -----------------------------------------------------------------------------
// The v1 shapes (validate.ts before payload v2), kept for mapping and tests
// -----------------------------------------------------------------------------

export interface IdentityPayloadV1 {
  pronouns: string | null;
  orientation: string[];
}

export const CARD_FIELDS_V1 = ["into", "safer_sex", "kinks", "hard_nos"] as const;
export type CardFieldV1 = typeof CARD_FIELDS_V1[number];
export type CardPayloadV1 = Record<CardFieldV1, string[]>;

/** v1 `safer_sex` accepted `tested <mon> '<yy>`; v2 retires it (D11). */
export const V1_SAFER_SEX_TESTED_PATTERN =
  /^tested (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec) '\d{2}$/;

/** B1: every v1 `kinks` chip and where it lands in v2. "toys" per D11. */
export const V1_KINK_MAP: Record<
  string,
  { section: "dynamics" | "practices"; label: string }
> = {
  "vanilla": { section: "dynamics", label: "vanilla" },
  "dom": { section: "dynamics", label: "dominant" },
  "sub": { section: "dynamics", label: "submissive" },
  "switch": { section: "dynamics", label: "switch" },
  "open to discuss": {
    section: "dynamics",
    label: "would rather talk about it than pick from a list",
  },
  "light bondage": { section: "practices", label: "bondage" },
  "roleplay": { section: "practices", label: "roleplay" },
  "exhibitionism": { section: "practices", label: "exhibitionism" },
  "voyeurism": { section: "practices", label: "voyeurism" },
  "toys": { section: "practices", label: "toys" },
};

const strings = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

/** Shape-only read of a stored v1 identity payload. */
export function readIdentityV1(value: unknown): IdentityPayloadV1 {
  const obj = asRecord(value);
  return {
    pronouns: typeof obj.pronouns === "string" && obj.pronouns.length > 0
      ? obj.pronouns
      : null,
    orientation: strings(obj.orientation),
  };
}

/** Shape-only read of a stored v1 card payload. */
export function readCardV1(value: unknown): CardPayloadV1 {
  const obj = asRecord(value);
  return {
    into: strings(obj.into),
    safer_sex: strings(obj.safer_sex),
    kinks: strings(obj.kinks),
    hard_nos: strings(obj.hard_nos),
  };
}

// -----------------------------------------------------------------------------
// Report
// -----------------------------------------------------------------------------

export interface MapReport {
  moved: string[];
  held_back: string[];
  removed: string[];
}

export function emptyReport(): MapReport {
  return { moved: [], held_back: [], removed: [] };
}

export function reportIsEmpty(r: MapReport): boolean {
  return r.moved.length === 0 && r.held_back.length === 0 && r.removed.length === 0;
}

/** Adds a field name to one list of the report, once. */
export function note(r: MapReport, list: keyof MapReport, field: string): void {
  if (!r[list].includes(field)) r[list].push(field);
}

export function mergeReports(...reports: MapReport[]): MapReport {
  const out = emptyReport();
  for (const r of reports) {
    for (const list of ["moved", "held_back", "removed"] as const) {
      for (const field of r[list]) note(out, list, field);
    }
  }
  return out;
}

// -----------------------------------------------------------------------------
// Identity
// -----------------------------------------------------------------------------

// deno-lint-ignore no-control-regex
const CONTROL_CHAR_RE = /[\u0000-\u001F\u007F]/;

function canonical(options: readonly string[], item: string): string | undefined {
  const key = item.toLowerCase();
  return options.find((o) => o.toLowerCase() === key);
}

/**
 * The free-text pronoun a v1 row would carry into v2 as a typed entry, before
 * the word filter: normalized, not a listed option, no control characters and
 * at most 16 characters. The backfill runs `private.text_is_clean` over these
 * and passes the dirty ones back as `opts.dirty`. Empty when there is none.
 */
export function pronounFilterCandidates(v1: unknown): string[] {
  const { pronouns } = readIdentityV1(v1);
  if (pronouns === null || CONTROL_CHAR_RE.test(pronouns)) return [];
  const normalized = normalizeTyped(pronouns);
  if (normalized.length === 0 || normalized.length > PRONOUN_MAX_LENGTH) return [];
  if (canonical(PRONOUN_OPTIONS, normalized)) return [];
  return [normalized];
}

/**
 * B1, identity rows:
 *   pronouns   he/him, she/her, they/them, ask me -> same, as a one-item list.
 *              Free text -> one typed entry if it is at most 16 characters,
 *              has no control character and is not in `opts.dirty`;
 *              otherwise held back (`pronouns`).
 *   orientation  every v1 chip exists in v2 -> same. Anything else (a
 *              pre-redesign value) is removed (`orientation`).
 */
export function mapIdentityV1(
  v1: unknown,
  opts: { dirty?: ReadonlySet<string> } = {},
): { payload: IdentityPayloadV2; report: MapReport } {
  const old = readIdentityV1(v1);
  const payload = emptyIdentity();
  const report = emptyReport();

  if (old.pronouns !== null) {
    const normalized = CONTROL_CHAR_RE.test(old.pronouns)
      ? ""
      : normalizeTyped(old.pronouns);
    const listed = normalized ? canonical(PRONOUN_OPTIONS, normalized) : undefined;
    if (listed) {
      payload.pronouns = [listed];
    } else if (
      normalized.length > 0 &&
      normalized.length <= PRONOUN_MAX_LENGTH &&
      !(opts.dirty?.has(normalized))
    ) {
      payload.pronouns = [normalized];
    } else {
      note(report, "held_back", "pronouns");
    }
  }

  for (const chip of old.orientation) {
    const listed = canonical(ORIENTATION_CHIPS, chip);
    if (!listed) {
      note(report, "removed", "orientation");
      continue;
    }
    if (payload.orientation.includes(listed)) continue;
    if (payload.orientation.length >= ORIENTATION_MAX_ITEMS) {
      note(report, "removed", "orientation");
      continue;
    }
    payload.orientation.push(listed);
  }

  return { payload, report };
}

// -----------------------------------------------------------------------------
// Card
// -----------------------------------------------------------------------------

function pushOnce(list: string[], value: string): void {
  if (!list.includes(value)) list.push(value);
}

/**
 * B1, card rows:
 *   into       -> `interestedIn` (returned separately: it belongs on the
 *                 identity payload, and whether it may move there depends on
 *                 the identity card's audience; see backfill_v2.ts). A value
 *                 outside the v2 list is removed (`into`).
 *   safer_sex  condoms, on prep, on birth control, ask me -> same;
 *              `tested <mon> '<yy>` -> "tested recently" (D11); anything else
 *              removed (`safer_sex`).
 *   kinks      split per V1_KINK_MAP into dynamics / practices; anything else
 *              removed (`kinks`).
 *   hard_nos   a listed v2 hard no (matched case-insensitively) -> that chip;
 *              typed text -> a typed entry, up to 5 (v2's cap) and 60
 *              characters; the rest held back (`hard_nos`). Typed text is not
 *              filtered here: it is checked on the next write (0018 rule).
 */
export function mapCardV1(
  v1: unknown,
): { payload: CardPayloadV2; interestedIn: string[]; report: MapReport } {
  const old = readCardV1(v1);
  const payload = emptyCard();
  const report = emptyReport();
  const interestedIn: string[] = [];

  for (const chip of old.into) {
    const listed = canonical(INTERESTED_IN_OPTIONS, chip);
    if (listed) pushOnce(interestedIn, listed);
    else note(report, "removed", "into");
  }

  for (const chip of old.safer_sex) {
    if (V1_SAFER_SEX_TESTED_PATTERN.test(chip)) {
      pushOnce(payload.safer_sex, "tested recently");
      continue;
    }
    const listed = canonical(SAFER_SEX_OPTIONS, chip);
    if (listed) pushOnce(payload.safer_sex, listed);
    else note(report, "removed", "safer_sex");
  }

  for (const chip of old.kinks) {
    const key = chip.toLowerCase();
    const target = Object.hasOwn(V1_KINK_MAP, key) ? V1_KINK_MAP[key] : undefined;
    if (target) pushOnce(payload[target.section], target.label);
    else note(report, "removed", "kinks");
  }

  let typed = 0;
  const seen = new Set<string>();
  for (const raw of old.hard_nos) {
    const normalized = CONTROL_CHAR_RE.test(raw) ? "" : normalizeTyped(raw);
    if (normalized.length === 0) {
      note(report, "removed", "hard_nos");
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const listed = canonical(HARD_NO_OPTIONS, normalized);
    if (listed) {
      payload.hard_nos.push(listed);
    } else if (typed < HARD_NO_MAX_TYPED && normalized.length <= HARD_NO_MAX_LENGTH) {
      typed += 1;
      payload.hard_nos.push(normalized);
    } else {
      note(report, "held_back", "hard_nos");
    }
  }

  return { payload, interestedIn, report };
}

// -----------------------------------------------------------------------------
// Read either version
// -----------------------------------------------------------------------------

/** A decrypted identity payload in the v2 shape, whatever its stored version. */
export function identityFromStored(
  payloadVersion: number,
  decrypted: unknown,
): IdentityPayloadV2 {
  return payloadVersion >= 2 ? readIdentityV2(decrypted) : mapIdentityV1(decrypted).payload;
}

/**
 * A decrypted card payload in the v2 shape, whatever its stored version. A v1
 * card's `into` is not part of the card any more; only the backfill moves it.
 */
export function cardFromStored(payloadVersion: number, decrypted: unknown): CardPayloadV2 {
  return payloadVersion >= 2 ? readCardV2(decrypted) : mapCardV1(decrypted).payload;
}
