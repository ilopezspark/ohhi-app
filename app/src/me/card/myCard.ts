import { useQuery } from '@tanstack/react-query';
import { getCard } from '../../api/identity';
import { currentUserId } from '../../api/session';
import { emptyCardPayload, type CardPayload } from '../../profile/fields';
import { queryKeys } from '../queryKeys';

export { cardPatch, inOptionOrder, sectionHasContent, sectionValues, tickableSections } from './cardValues';

/**
 * The owner's own private card, payload v2 (`GET /identity/card/:me`, all
 * nine sections), for the editor, the `/me/private-card` preview and the
 * share sheet's ticking step.
 *
 * Its query key sits under `queryKeys.me.card`, so invalidating that key
 * (the editor's save) refreshes this too. It is its own key because
 * `me/card/summary.ts` still keeps the v1 shape under `queryKeys.me.card`
 * itself; the two must never share a cache entry.
 */
export const MY_CARD_QUERY_KEY = [...queryKeys.me.card, 'v2'] as const;

/** Every section, unset ones empty. The owner's 404 means "never written", which reads as an empty card. */
export async function fetchMyCard(): Promise<CardPayload> {
  const card = await getCard(await currentUserId());
  return { ...emptyCardPayload(), ...(card?.sections ?? {}) } as CardPayload;
}

export function useMyCard() {
  return useQuery({ queryKey: MY_CARD_QUERY_KEY, queryFn: fetchMyCard });
}
