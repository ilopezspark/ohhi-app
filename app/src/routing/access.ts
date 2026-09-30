import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { me as fetchMe, type MeResult } from '../api/me';
import { routeForMe, type RouteResult } from './stateToRoute';
import { useSessionUserId } from './sessionUser';

/**
 * The one `me()` read the age gate routes on (decision 97,
 * `docs/age-gate-contract.md`): the layout-level gate
 * (`routing/AccessGate.tsx`), the verify step and screen, and `finish` all
 * read this query, so a result any of them fetches (a poll, a refetch after
 * the Persona flow returns) moves the gate too. The key sits under `['me']`,
 * so the existing `invalidateQueries({ queryKey: ['me'] })` calls refresh it
 * as well, and carries the signed-in user id, so a sign-in or sign-out
 * starts a fresh read instead of routing on the previous person's state.
 */
export function accessQueryKey(userId: string | null) {
  return ['me', 'access', userId ?? 'signed-out'] as const;
}

/** Every access read, for invalidation without knowing the user id. */
export const ACCESS_QUERY_PREFIX = ['me', 'access'] as const;

/** How often a running ID check is re-read while its screen is shown (contract row 6: "every few seconds"). */
export const VERIFY_POLL_MS = 5_000;

/** A signed-out person has no `me()`; everyone else gets theirs. */
export async function fetchAccessMe(userId: string | null): Promise<MeResult | null> {
  if (!userId) return null;
  return fetchMe();
}

/**
 * The route `me()` asks for, or `null` when the gate should not move anyone:
 * no result yet, or `deleted` (seen only in the moment between
 * `delete_my_account()` and the sign-out that follows it; bootstrap runs
 * `begin_signup()` for a real sign-in, the gate never does).
 */
export function accessRoute(userId: string | null | undefined, me: MeResult | null | undefined): RouteResult | null {
  if (userId === undefined) return null;
  if (userId === null) return { screen: 'auth' };
  if (!me || me.status === 'deleted') return null;
  return routeForMe(me);
}

export interface UseAccessMeOptions {
  /** Poll while an ID check is running (`id_pending`) and the screen is focused. */
  pollWhilePending?: boolean;
}

/**
 * The access read for a screen, with the contract's refresh rules: fresh on
 * mount and on every focus after the first, on app foreground (React
 * Query's focus handling, `query/lifecycle.ts`), and every
 * `VERIFY_POLL_MS` while a check is `id_pending` and the screen is focused.
 * Polling stops as soon as the state is anything else (verified, failed,
 * closed, a closer look) or the screen loses focus or unmounts.
 */
export function useAccessMe(options: UseAccessMeOptions = {}) {
  const [focused, setFocused] = useState(true);
  const firstFocus = useRef(true);
  const access = useAccessQuery({ poll: !!options.pollWhilePending && focused });

  const refetch = access.query.refetch;
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      if (firstFocus.current) {
        firstFocus.current = false;
      } else {
        void refetch();
      }
      return () => setFocused(false);
    }, [refetch])
  );

  return access;
}

/**
 * The access read without any navigation hooks, for the root layout's gate
 * (which sits outside every screen, so it has no focus of its own).
 * `poll` turns on the `id_pending` poll.
 */
export function useAccessQuery({ poll = false }: { poll?: boolean } = {}) {
  const userId = useSessionUserId();
  const query = useQuery({
    queryKey: accessQueryKey(userId ?? null),
    queryFn: () => fetchAccessMe(userId ?? null),
    enabled: userId !== undefined,
    refetchInterval: (q) => (poll && shouldPollVerification(q.state.data?.verification_status) ? VERIFY_POLL_MS : false),
  });
  return { userId, query, me: query.data ?? null, route: accessRoute(userId, query.data) };
}

/** Only a running check is polled; every other state waits for focus or foreground. */
export function shouldPollVerification(status: MeResult['verification_status'] | null | undefined): boolean {
  return status === 'id_pending';
}

/**
 * Re-reads every access query now and waits for it, so a screen about to
 * cross zones (finish -> grid) never lands while the gate still holds the
 * old state.
 */
export async function refreshAccess(queryClient: QueryClient): Promise<MeResult | null | undefined> {
  await queryClient.refetchQueries({ queryKey: ACCESS_QUERY_PREFIX });
  return queryClient
    .getQueriesData<MeResult | null>({ queryKey: ACCESS_QUERY_PREFIX })
    .map(([, data]) => data)
    .find((data) => !!data);
}
