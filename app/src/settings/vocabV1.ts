// Payload v1 private-card vocabulary: `into`, `safer_sex`, `kinks`, `hard_nos`
// (decisions 20-21, me-redesign rulings 3-4). The identity function no longer
// accepts this shape (`PUT /identity/card` refuses the v1 body; reads map a v1
// row to v2), so nothing here is synced any more. It exists only so the
// pre-restructure screens keep compiling until phase 4d replaces them:
// `profile-editor/private-card.tsx`, `chat/PrivateCardSheet.tsx`,
// `me/card/PrivateCardView.tsx`, `me/card/summary.ts`.
//
// Re-exported from `settings/vocab.ts`. New code uses the v2 names there
// (`CARD_SECTIONS`, `CARD_GROUPS`, the `*_OPTIONS` lists) and the types in
// `profile/fields.ts`.

/** @deprecated v1 card keys. Use `CARD_SECTIONS` (v2). */
export const CARD_FIELDS = ['into', 'safer_sex', 'kinks', 'hard_nos'] as const;
/** @deprecated v1 card key. Use `CardSection` from `profile/fields.ts`. */
export type CardField = (typeof CARD_FIELDS)[number];

/** @deprecated v1: 0-8 chips per array. v2 caps live in `profile/fields.ts#CARD_SECTION_SPECS`. */
export const CARD_MAX_ITEMS = 8;
/** @deprecated v1: 40 characters per chip. v2 is `CHIP_MAX_LENGTH` (60) / `HARD_NO_MAX_LENGTH`. */
export const CARD_CHIP_MAX_LENGTH = 40;

/** @deprecated v1 chip lists. Use the v2 `*_OPTIONS` lists. */
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
  hard_nos: ['no pics unasked', 'no substances', 'nothing off campus'],
};

/** @deprecated v1 only: the dated `tested <mon> '<yy>` chip is retired in v2 (D11). */
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

/** @deprecated v1 only (retired in v2, D11). */
export const SAFER_SEX_TESTED_PATTERN = new RegExp(`^tested (${SAFER_SEX_TESTED_MONTHS.join('|')}) '\\d{2}$`);

/** @deprecated v1 only. */
export interface CardFieldEntryRules {
  readonly typed: boolean;
  readonly pattern?: RegExp;
  readonly patternDescription?: string;
}

/** @deprecated v1 only. */
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
