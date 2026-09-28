/**
 * `docs/design/me-redesign/brief.md`'s completion math — one pure function,
 * shared by the Me tab's top-level bar (`ui/CompletionBar`) and the editor's
 * per-section `+N%` labels (`ui/SectionLabel`'s `weight` prop). Weights are
 * exactly the brief's table; pronouns, orientation and the private card
 * carry no weight at all (they're optional and private by default, and
 * nobody should feel nudged into filling them in).
 */

export type CompletionKey = 'photo1' | 'photo2' | 'photo3' | 'status' | 'hereFor' | 'tags';

export interface ProfileCompletionInput {
  /**
   * How many photo rows exist, 0-3 — **a photo counts when a row exists at
   * that position regardless of moderation state** (brief, "completion
   * math"): a `pending` upload still counts toward completion even though
   * it isn't on the grid yet.
   */
  photoCount: number;
  hasStatus: boolean;
  /** At least one `user_goals` row exists (any stored value, including the retired `group` — completion isn't the place ruling 7's "never offered" applies). */
  hasHereFor: boolean;
  /** At least one `user_tags` row exists. */
  hasTags: boolean;
}

export interface CompletionItem {
  key: CompletionKey;
  weight: number;
  done: boolean;
}

export interface NextBest {
  key: CompletionKey;
  weight: number;
  copy: string;
}

export interface ProfileCompletionResult {
  /** 0-100, the sum of every done item's weight. */
  percent: number;
  /** Every item, in the brief's own weight order (highest first) — `nextBest` is simply the first undone one. */
  items: CompletionItem[];
  /** The single highest-value missing item (Me tab's one line of copy beneath the bar), or `null` when everything's filled in. */
  nextBest: NextBest | null;
}

/** The brief's completion table, in highest-weight-first order (also the tie-break order: `photo2` before `photo3`, then `status`/`hereFor`/`tags` in that fixed order). */
const WEIGHTS: Record<CompletionKey, number> = {
  photo1: 30,
  photo2: 20,
  photo3: 20,
  status: 10,
  hereFor: 10,
  tags: 10,
};

const ITEM_ORDER: CompletionKey[] = ['photo1', 'photo2', 'photo3', 'status', 'hereFor', 'tags'];

/** One line of product-voice copy per possible `nextBest` — lowercase, no exclamation points, no banned words. */
const NEXT_BEST_COPY: Record<CompletionKey, string> = {
  photo1: "a first photo means people actually know who they're saying hi to.",
  photo2: 'one more photo and you stop looking half-finished on the grid.',
  photo3: 'a third photo rounds you out — most profiles stop at two.',
  status: 'a status line is usually the reason someone says hi.',
  hereFor: "say what you're here for so people know why to say hi.",
  tags: 'a tag or two helps people place you faster.',
};

function itemDone(key: CompletionKey, input: ProfileCompletionInput): boolean {
  switch (key) {
    case 'photo1':
      return input.photoCount >= 1;
    case 'photo2':
      return input.photoCount >= 2;
    case 'photo3':
      return input.photoCount >= 3;
    case 'status':
      return input.hasStatus;
    case 'hereFor':
      return input.hasHereFor;
    case 'tags':
      return input.hasTags;
  }
}

/** The pure completion function the Me bar and the editor's `sectionWeight` both build on. */
export function profileCompletion(input: ProfileCompletionInput): ProfileCompletionResult {
  const items: CompletionItem[] = ITEM_ORDER.map((key) => ({
    key,
    weight: WEIGHTS[key],
    done: itemDone(key, input),
  }));

  const percent = items.reduce((sum, item) => sum + (item.done ? item.weight : 0), 0);
  const firstUndone = items.find((item) => !item.done);

  return {
    percent,
    items,
    nextBest: firstUndone ? { key: firstUndone.key, weight: firstUndone.weight, copy: NEXT_BEST_COPY[firstUndone.key] } : null,
  };
}

/** The editor's sections — `photos` groups the three photo slots, everything else is one item per section. */
export type CompletionSection = 'photos' | 'status' | 'hereFor' | 'tags';

const SECTION_KEYS: Record<CompletionSection, CompletionKey[]> = {
  photos: ['photo1', 'photo2', 'photo3'],
  status: ['status'],
  hereFor: ['hereFor'],
  tags: ['tags'],
};

/**
 * The weight of the next unfilled item in `section` — the editor's `+N%`
 * label (`SectionLabel`'s `weight` prop). `0` when the section has nothing
 * left to fill (the label should then show no weight badge at all — pass
 * `undefined`, not `0`, to `SectionLabel` in that case).
 */
export function sectionWeight(section: CompletionSection, input: ProfileCompletionInput): number {
  const { items } = profileCompletion(input);
  const keys = SECTION_KEYS[section];
  const nextUnfilled = items.find((item) => keys.includes(item.key) && !item.done);
  return nextUnfilled ? nextUnfilled.weight : 0;
}
