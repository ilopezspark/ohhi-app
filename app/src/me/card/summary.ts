import { useQuery } from '@tanstack/react-query';
import { getMyIdentity } from '../../api/identity';
import { isAudienceCard, type Audience, type IdentityCard } from '../../profile/fields';
import { CARD_SECTIONS, IDENTITY_CARD_ORDER } from '../../settings/vocab';
import { cardDraftFrom, cardFillCount, type OwnIdentityCards } from '../editor/identityCardDraft';
import { queryKeys } from '../queryKeys';
import { AUDIENCE_LABELS, IDENTITY_CARD_LABELS } from './fieldLabels';
import { sectionHasContent, useMyCard } from './myCard';

/**
 * `N of 9 filled in` for the editor's `private card` row: a section counts
 * once it holds something. Reads the owner's v2 card (`myCard.ts`, all nine
 * sections; a never-written card is all empty, not an error). Display copy
 * only: the private card carries no completion weight.
 */
export function usePrivateCardSummary(): { filled: number; total: number } {
  const card = useMyCard().data;
  const filled = CARD_SECTIONS.filter((section) => sectionHasContent(card, section)).length;
  return { filled, total: CARD_SECTIONS.length };
}

/**
 * The owner's five public cards and their audiences (`GET /identity/:me`),
 * under `queryKeys.me.about` (the key that held pronouns and orientation
 * before the restructure). The editor's section list and the five card
 * editors share this one entry, and a card editor's save invalidates it.
 */
export const myIdentityQuery = { queryKey: queryKeys.me.about, queryFn: getMyIdentity } as const;

export interface IdentityCardSummary {
  card: IdentityCard;
  label: string;
  /** Filled rows (a weight is part of its parent's row), or picks for "before you message me". */
  filled: number;
  total: number;
  /** Who sees the card; `null` for "before you message me", which is always everyone once filled. */
  audience: Audience | null;
  /** The row's subtitle: the count, then the audience word as the small secondary. */
  subtitle: string;
}

/**
 * One summary per public card, in the brief's order. Display copy only: none
 * of these fields carries completion weight (reconcile C8), so nothing here
 * feeds `completion.ts` or nudges anyone to fill a card in.
 */
export function identityCardSummaries(identity: OwnIdentityCards): IdentityCardSummary[] {
  return IDENTITY_CARD_ORDER.map((card) => {
    const draft = cardDraftFrom(identity, card);
    if (!isAudienceCard(card)) {
      const picks = Object.values(draft.values).reduce<number>(
        (sum, value) => sum + (Array.isArray(value) ? value.length : value ? 1 : 0),
        0
      );
      const subtitle = picks === 0 ? 'nothing picked yet' : `${picks} picked · ${AUDIENCE_LABELS.everyone}`;
      return { card, label: IDENTITY_CARD_LABELS[card], filled: picks, total: picks, audience: null, subtitle };
    }
    const { filled, total } = cardFillCount(card, draft.values);
    const audience = draft.audience ?? 'everyone';
    return {
      card,
      label: IDENTITY_CARD_LABELS[card],
      filled,
      total,
      audience,
      subtitle: `${filled} of ${total} filled in · ${AUDIENCE_LABELS[audience]}`,
    };
  });
}

/** The section list's rows: `null` while loading or when the read failed (the rows then show no subtitle). */
export function useIdentityCardSummaries(): IdentityCardSummary[] | null {
  const query = useQuery(myIdentityQuery);
  return query.data ? identityCardSummaries(query.data) : null;
}
