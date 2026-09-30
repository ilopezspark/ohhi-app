import type { OwnIdentity } from '../../api/identity';
import { IDENTITY_CARDS, WEIGHT_PARENTS } from '../../settings/vocab';
import {
  IDENTITY_FIELD_SPECS,
  isAudienceCard,
  isFilled,
  type Audience,
  type IdentityCard,
  type IdentityField,
  type IdentityPatch,
  type WeightField,
} from '../../profile/fields';

/**
 * Pure logic behind the five public-card editors (phase 4c of
 * `docs/design/profile-restructure/reconcile.md`): one card's draft values,
 * its audience, what changed, and the partial `PUT /identity` patch that
 * sends only that card. The screens and the editor's section list share it,
 * so the counts on the list and the fields on a screen never disagree.
 */

/** One card's values: a single-select key holds `string | null`, a list key `string[]`. */
export type CardValues = Partial<Record<IdentityField, string | null | string[]>>;

export interface CardDraft {
  values: CardValues;
  /** `null` for "before you message me", which has no audience (always everyone once filled). */
  audience: Audience | null;
}

/** What the draft reads from the owner's `GET /identity/:me`. */
export type OwnIdentityCards = Pick<OwnIdentity, 'cards' | 'audiences'>;

/**
 * Each card's editor route. The identity card keeps `/profile-editor/about`
 * (the old pronouns and orientation screen) so existing links still land on it.
 */
export const IDENTITY_CARD_ROUTES: Record<IdentityCard, string> = {
  identity: '/profile-editor/about',
  background: '/profile-editor/background',
  lifestyle: '/profile-editor/lifestyle',
  around: '/profile-editor/around',
  before_you_message: '/profile-editor/before-you-message',
};

/** Every payload key the card holds, weights included, in row order. */
export function cardFields(card: IdentityCard): IdentityField[] {
  return [...(IDENTITY_CARDS[card] as readonly IdentityField[])];
}

export function isWeightField(field: string): field is WeightField {
  return field in WEIGHT_PARENTS;
}

/** The weight shown under a parent (`faith` -> `faith_weight`), or null. */
export function weightOf(field: IdentityField): WeightField | null {
  const entry = (Object.entries(WEIGHT_PARENTS) as [WeightField, IdentityField][]).find(([, parent]) => parent === field);
  return entry ? entry[0] : null;
}

/** The card's own rows: every key except the weights, which sit under their parent. */
export function rowFields(card: IdentityCard): IdentityField[] {
  return cardFields(card).filter((field) => !isWeightField(field));
}

/** The card's draft as the owner's response holds it (every card is present for the owner). */
export function cardDraftFrom(identity: OwnIdentityCards, card: IdentityCard): CardDraft {
  const stored = (identity.cards[card] ?? {}) as Record<string, unknown>;
  const values: CardValues = {};
  for (const field of cardFields(card)) {
    const raw = stored[field];
    if (IDENTITY_FIELD_SPECS[field].multiple) {
      values[field] = Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : [];
    } else {
      values[field] = typeof raw === 'string' && raw.length > 0 ? raw : null;
    }
  }
  return { values, audience: isAudienceCard(card) ? identity.audiences[card] : null };
}

/**
 * Sets one field. Clearing a parent clears its weight too: the function
 * refuses a weight without its parent, and the weight row is hidden then.
 */
export function withFieldValue(values: CardValues, field: IdentityField, next: string | null | string[]): CardValues {
  const out: CardValues = { ...values, [field]: next };
  const weight = weightOf(field);
  if (weight && !isFilled(next)) out[weight] = null;
  return out;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    const left = Array.isArray(a) ? a : [];
    const right = Array.isArray(b) ? b : [];
    return left.length === right.length && left.every((item, i) => item === right[i]);
  }
  return (a ?? null) === (b ?? null);
}

/** The card's keys whose value differs from what was loaded, in row order. */
export function changedFields(card: IdentityCard, initial: CardDraft, current: CardDraft): IdentityField[] {
  return cardFields(card).filter((field) => !sameValue(initial.values[field], current.values[field]));
}

export function isDraftDirty(card: IdentityCard, initial: CardDraft, current: CardDraft): boolean {
  return changedFields(card, initial, current).length > 0 || initial.audience !== current.audience;
}

/**
 * The `PUT /identity` v2 patch for one card: only the keys of this card that
 * changed, plus this card's audience when it changed. Never a key of another
 * card, never `is_public`. `null` when nothing changed (nothing to send).
 * Unchanged keys stay out, so a stored typed entry is not sent (and not
 * re-filtered) just because a neighbouring field was edited.
 */
export function buildCardPatch(card: IdentityCard, initial: CardDraft, current: CardDraft): IdentityPatch | null {
  const patch: Record<string, unknown> = {};
  for (const field of changedFields(card, initial, current)) {
    const value = current.values[field];
    patch[field] = IDENTITY_FIELD_SPECS[field].multiple ? (Array.isArray(value) ? value : []) : (value ?? null);
  }
  if (isAudienceCard(card) && current.audience && current.audience !== initial.audience) {
    patch.audiences = { [card]: current.audience };
  }
  return Object.keys(patch).length > 0 ? (patch as IdentityPatch) : null;
}

/** Filled rows out of the card's rows (a weight never counts on its own: it belongs to its parent's row). */
export function cardFillCount(card: IdentityCard, values: CardValues): { filled: number; total: number } {
  const rows = rowFields(card);
  return { filled: rows.filter((field) => isFilled(values[field])).length, total: rows.length };
}

/**
 * Fields whose typed ("write your own") entries changed in this draft: the
 * only places a word-filter refusal can come from, so that is where its line
 * is shown. The function never says which entry it refused.
 */
export function fieldsWithNewTypedEntries(card: IdentityCard, initial: CardDraft, current: CardDraft): IdentityField[] {
  return changedFields(card, initial, current).filter((field) => {
    const spec = IDENTITY_FIELD_SPECS[field];
    if (!spec.multiple || !spec.typed) return false;
    const before = new Set(Array.isArray(initial.values[field]) ? (initial.values[field] as string[]) : []);
    const now = Array.isArray(current.values[field]) ? (current.values[field] as string[]) : [];
    const listed = new Set(spec.options.map((option) => option.toLowerCase()));
    return now.some((value) => !before.has(value) && !listed.has(value.toLowerCase()));
  });
}
