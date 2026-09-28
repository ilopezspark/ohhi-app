// Copied from `supabase/functions/identity/validate.ts` (decisions 20-21,
// 48; vocabulary values per docs/design/me-redesign/brief.md rulings 1, 3, 4,
// 5, 6 and the `08-edit-private-card.png` artboard). The identity edge
// function has no `GET .../vocab` route — decision 48 says the editors must
// render "whatever `validate.ts` exports … never copy baked into the plan
// docs' examples", so this file is a literal copy of that module's
// vocabulary constants, kept in sync by `src/__tests__/editors-vocab.test.ts`,
// which reads both files' source and fails the build the moment they
// diverge. If `validate.ts` changes, update this file to match and re-run
// that test — do not edit `validate.ts` from here (it's the other agent's
// function, owned by the edge-function build).

/** Decision 20 / artboard order: a short fixed pronoun list, plus a free-text opt-out. */
export const PRONOUN_OPTIONS = ['he/him', 'she/her', 'they/them', 'ask me'] as const;

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
export const ORIENTATION_CHIPS = ['bi', 'straight', 'gay', 'queer', 'asexual', 'rather not say'] as const;

export const ORIENTATION_MAX_ITEMS = 3;

export const CARD_FIELDS = ['into', 'safer_sex', 'kinks', 'hard_nos'] as const;
export type CardField = (typeof CARD_FIELDS)[number];

/** Decision 21 / ruling 4: 0-8 chips per array, each at most 40 characters. */
export const CARD_MAX_ITEMS = 8;
export const CARD_CHIP_MAX_LENGTH = CHIP_MAX_LENGTH;

/**
 * Fixed per-field allow-lists, matching the redesign artboards (ruling 3
 * keeps `kinks` as-is; ruling 4 makes `hard_nos` accept typed entries in
 * addition to its fixed suggestions below — see `SAFER_SEX_TESTED_PATTERN`
 * and `CARD_FIELD_ENTRY_RULES` for how the two exceptions apply).
 */
export const CARD_CHIPS: Record<CardField, readonly string[]> = {
  into: ['men', 'women', 'nonbinary people', 'everyone'],
  safer_sex: ['condoms', 'on prep', 'on birth control', 'ask me'],
  kinks: [
    'vanilla',
    'light bondage',
    'roleplay',
    'toys',
    'exhibitionism',
    'voyeurism',
    'dom',
    'sub',
    'switch',
    'open to discuss',
  ],
  /** Fixed suggestions only — ruling 4 lets a card also carry typed entries. */
  hard_nos: ['no pics unasked', 'no substances', 'nothing off campus'],
};

/** Three-letter lowercase month abbreviations accepted by the `tested` pattern. */
export const SAFER_SEX_TESTED_MONTHS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
] as const;

/**
 * `safer_sex` also accepts `tested <mon> '<yy>` (e.g. "tested apr '26"): a
 * lowercase three-letter month from `SAFER_SEX_TESTED_MONTHS`, a literal
 * space, an apostrophe, and a two-digit year. It is a pattern, not a fixed
 * chip, so it is not listed in `CARD_CHIPS.safer_sex`.
 */
export const SAFER_SEX_TESTED_PATTERN = new RegExp(
  `^tested (${SAFER_SEX_TESTED_MONTHS.join('|')}) '\\d{2}$`
);

/**
 * Per-field entry rules for the editor: whether the field accepts a typed
 * "+ add your own" entry (only `hard_nos`, ruling 4), and, for `safer_sex`,
 * the `tested <mon> '<yy>` pattern it accepts alongside its fixed chips so
 * the editor can build that chip without duplicating the regex logic.
 */
export interface CardFieldEntryRules {
  /** True only for `hard_nos` — the editor should render a "+ add your own" chip. */
  readonly typed: boolean;
  /** Present only for `safer_sex` — an additional pattern-based chip the field accepts. */
  readonly pattern?: RegExp;
  /** Human-readable form of `pattern`, for building the "tested" chip's placeholder/label. */
  readonly patternDescription?: string;
}

export const CARD_FIELD_ENTRY_RULES: Record<CardField, CardFieldEntryRules> = {
  into: { typed: false },
  safer_sex: {
    typed: false,
    pattern: SAFER_SEX_TESTED_PATTERN,
    patternDescription: "tested <mon> '<yy>",
  },
  kinks: { typed: false },
  hard_nos: { typed: true },
};
