import { CARD_GROUP_ORDER, CARD_GROUPS, IDENTITY_CARD_ORDER, IDENTITY_CARDS } from '../../settings/vocab';
import type { CardField } from '../../settings/vocab';
import {
  AUDIENCE_LABELS,
  CARD_GROUP_LABELS,
  CARD_SECTION_LABELS,
  IDENTITY_CARD_LABELS,
  IDENTITY_FIELD_LABELS,
} from '../../settings/profileLabels';
import type { CardGroup, CardSection, IdentityCard, IdentityField } from '../../profile/fields';

/**
 * Labels for the restructured profile (payload v2), in render order. The
 * words themselves are the owner's (ruling 3) and live in
 * `settings/profileLabels.ts`; the order comes from `settings/vocab.ts`
 * (`CARD_GROUP_ORDER`/`CARD_GROUPS`, `IDENTITY_CARD_ORDER`/`IDENTITY_CARDS`),
 * so a renderer never hard-codes either.
 */

export { AUDIENCE_LABELS, CARD_GROUP_LABELS, CARD_SECTION_LABELS, IDENTITY_CARD_LABELS, IDENTITY_FIELD_LABELS };

export interface CardSectionRow {
  section: CardSection;
  group: CardGroup;
  label: string;
}

/**
 * All nine private-card sections in group order: getting closer (standard),
 * intimacy (gated), boundaries (always attached), with hard nos then privacy
 * last (me-redesign ruling 5, extended to privacy).
 */
export const CARD_SECTION_ROWS: readonly CardSectionRow[] = CARD_GROUP_ORDER.flatMap((group) =>
  (CARD_GROUPS[group] as readonly CardSection[]).map((section) => ({ section, group, label: CARD_SECTION_LABELS[section] }))
);

export interface IdentityCardRow {
  card: IdentityCard;
  label: string;
  fields: readonly { field: IdentityField; label: string }[];
}

/**
 * The five public cards in render order (identity, background, lifestyle,
 * when i'm around, before you message me), each with its fields' labels in
 * row order. `faith_weight`/`politics_weight` are listed for editors; a
 * renderer shows them as the sub-line under their parent (`WEIGHT_PARENTS`).
 */
export const IDENTITY_CARD_ROWS: readonly IdentityCardRow[] = IDENTITY_CARD_ORDER.map((card) => ({
  card,
  label: IDENTITY_CARD_LABELS[card],
  fields: (IDENTITY_CARDS[card] as readonly IdentityField[]).map((field) => ({ field, label: IDENTITY_FIELD_LABELS[field] })),
}));

/**
 * @deprecated Payload v1 group labels, for the pre-restructure private-card
 * screens only. Use `CARD_SECTION_LABELS` / `CARD_SECTION_ROWS`.
 */
export const CARD_FIELD_LABELS: Record<CardField, string> = {
  into: 'into',
  safer_sex: 'safer sex',
  kinks: 'kinks',
  hard_nos: 'hard nos',
};
