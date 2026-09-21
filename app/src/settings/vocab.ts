// Copied from `supabase/functions/identity/validate.ts` (decisions 20-21,
// 48). The identity edge function has no `GET .../vocab` route — decision 48
// says the editors must render "whatever `validate.ts` exports … never copy
// baked into the plan docs' examples", so this file is a literal copy of
// that module's vocabulary constants, kept in sync by
// `src/__tests__/editors-vocab.test.ts`, which reads both files' source and
// fails the build the moment they diverge. If `validate.ts` changes, update
// this file to match and re-run that test — do not edit `validate.ts` from
// here (it's the other agent's function, owned by the edge-function build).

/** Decision 20: a short fixed pronoun list, plus a free-text opt-out. */
export const PRONOUN_OPTIONS = ['she/her', 'he/him', 'they/them', 'ask me'] as const;

/** One length cap for every chip and for the decision-20 free-text opt-out. */
export const CHIP_MAX_LENGTH = 40;

/** Cap on the decision-20 free-text pronoun opt-out. */
export const PRONOUN_MAX_LENGTH = CHIP_MAX_LENGTH;

/** Cap on an orientation chip. */
export const ORIENTATION_CHIP_MAX_LENGTH = CHIP_MAX_LENGTH;

/** Decision 14/20: orientation is chips only, up to three, from a fixed list. */
export const ORIENTATION_CHIPS = [
  'gay',
  'bi',
  'pan',
  'queer',
  'straight',
  'ace',
  'demi',
  'fluid',
  'questioning',
  'prefer not to say',
] as const;

export const ORIENTATION_MAX_ITEMS = 3;

export const CARD_FIELDS = ['into', 'safer_sex', 'kinks', 'hard_nos'] as const;
export type CardField = (typeof CARD_FIELDS)[number];

/** Decision 21: 0-8 chips per array, each at most 40 characters. */
export const CARD_MAX_ITEMS = 8;
export const CARD_CHIP_MAX_LENGTH = CHIP_MAX_LENGTH;

/** Provisional per-field allow-lists (decision 21). Replace with the real taxonomy. */
export const CARD_CHIPS: Record<CardField, readonly string[]> = {
  into: [
    'top',
    'bottom',
    'vers',
    'vers top',
    'vers bottom',
    'side',
    'making out',
    'oral',
    'mutual',
    'cuddling',
    'dates first',
  ],
  safer_sex: [
    'condoms',
    'condoms for anal',
    'on prep',
    'on doxypep',
    'undetectable',
    'recently tested',
    'test regularly',
    'no fluid exchange',
    'ask me',
  ],
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
  hard_nos: [
    'no bareback',
    'no drugs',
    'no pain',
    'no choking',
    'no photos',
    'no public play',
    'no group',
    'ask first',
  ],
};
