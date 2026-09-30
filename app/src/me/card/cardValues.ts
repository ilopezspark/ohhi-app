import { CARD_GROUPS, CARD_SECTIONS } from '../../settings/vocab';
import { CARD_SECTION_SPECS, isFilled, type CardPatch, type CardPayload, type CardSection, type GatedSection } from '../../profile/fields';

/**
 * Pure helpers over private-card values (payload v2), shared by the editor,
 * `PrivateCardView` and the share sheet. No API imports, so the view stays
 * renderable anywhere.
 */

/** A section's values as a list: a single value is one entry, unset is none. */
export function sectionValues(value: string | string[] | null | undefined): string[] {
  if (Array.isArray(value)) return value;
  return typeof value === 'string' && value.length > 0 ? [value] : [];
}

/** Whether a section holds anything. */
export function sectionHasContent(card: Partial<CardPayload> | null | undefined, section: CardSection): boolean {
  return !!card && isFilled(card[section]);
}

/** The intimacy sections a share can tick: only the ones with something in them, in group order. */
export function tickableSections(card: Partial<CardPayload> | null | undefined): GatedSection[] {
  return CARD_GROUPS.gated.filter((section) => sectionHasContent(card, section));
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, i) => item === b[i]);
  return (a ?? null) === (b ?? null);
}

/** The partial `PUT /identity/card` body: only the sections that changed. Empty when nothing did. */
export function cardPatch(initial: CardPayload, current: CardPayload): CardPatch {
  const patch: Record<string, unknown> = {};
  for (const section of CARD_SECTIONS) {
    if (!sameValue(initial[section], current[section])) patch[section] = current[section];
  }
  return patch as CardPatch;
}

/**
 * Keeps a list in its picker's order (fixed options first, as listed), with
 * anything typed after them in the order it was added, so the card reads the
 * same way the editor lists it.
 */
export function inOptionOrder(section: CardSection, values: readonly string[]): string[] {
  const options = CARD_SECTION_SPECS[section].options;
  const listed = options.filter((option) => values.includes(option));
  const typed = values.filter((value) => !options.includes(value));
  return [...listed, ...typed];
}
