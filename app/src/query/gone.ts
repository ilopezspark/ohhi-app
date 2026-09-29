import { useCallback, useEffect, useRef, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { focusManager, onlineManager, type QueryClient, type QueryKey } from '@tanstack/react-query';
import type { ConversationListItem } from '../api/conversations';
import type { GridRow } from '../api/grid';
import type { ReceivedHi } from '../api/his';
import { refreshBadges } from '../badges/badgeCounts';

/**
 * "Gone" handling (migration 0014, decision 90).
 *
 * When someone is suspended, banned or deletes their account, nothing is
 * pushed to anyone: their rows simply stop being returned. So a screen finds
 * out on its next read, and the rule for what it does then is the same
 * everywhere:
 *
 * - a list just refetches; the row is no longer in the data;
 * - a detail screen (a thread, a profile card, a shared album) whose read
 *   comes back empty drops what it held from the React Query cache and goes
 *   back, with no explanation. Nothing here may ever say why: the same
 *   empty read covers a block, a revoke, an expired share and a bad id.
 *
 * If copy is ever needed, it is `GONE_COPY`, and nothing more specific.
 */
export const GONE_COPY = "this isn't available anymore.";

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** Keeps a callback's latest identity in a ref, so effects can run it without re-subscribing. */
function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

/**
 * Refetch whenever the screen regains focus (a tab switch, or coming back
 * from a pushed screen). Tab screens stay mounted, so React Query's
 * refetch-on-mount alone never runs again for them. The first focus is
 * skipped: that is the mount, and the query is already fetching.
 */
export function useRefetchOnFocus(refetch: () => unknown): void {
  const latest = useLatest(refetch);
  const first = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      void latest.current();
    }, [latest])
  );
}

/**
 * Runs `callback` when the app comes back to the foreground or the network
 * comes back, through the same `focusManager`/`onlineManager` React Query
 * uses (wired in `query/lifecycle.ts`). For the few screens that hold server
 * data in local state rather than in React Query.
 */
export function useOnAppActive(callback: () => unknown): void {
  const latest = useLatest(callback);
  useEffect(() => {
    const offFocus = focusManager.subscribe((focused) => {
      if (focused) void latest.current();
    });
    const offOnline = onlineManager.subscribe((online) => {
      if (online) void latest.current();
    });
    return () => {
      offFocus();
      offOnline();
    };
  }, [latest]);
}

/**
 * A one-way "gone" latch for a detail screen. Read `gone` *before* the
 * screen's own `useQuery` calls and pass `enabled: !gone` to them, then call
 * `latch(condition)` once the results are known (during render is fine: it
 * only sets this component's own state). Once latched the queries stay
 * disabled, so dropping them from the cache cannot make them refetch, come
 * back empty again and loop.
 */
export function useGoneLatch(): { gone: boolean; latch: (condition: boolean) => void } {
  const [gone, setGone] = useState(false);
  const latch = useCallback(
    (condition: boolean) => {
      if (condition && !gone) setGone(true);
    },
    [gone]
  );
  return { gone, latch };
}

/** Back if there is somewhere to go back to, otherwise the fallback list. */
export function leaveScreen(fallback: string): void {
  if (router.canGoBack()) router.back();
  else router.replace(fallback as never);
}

/**
 * When `gone` turns true: run `forget` (drop the cache entries) once, then
 * leave the screen the next time it is focused. Leaving waits for focus so
 * a screen that finds out while another sits on top of it (a profile under
 * its own thread) does not pop the wrong screen.
 */
export function useLeaveWhenGone(gone: boolean, forget: () => void, fallback: string): void {
  const latestForget = useLatest(forget);
  const forgotten = useRef(false);
  const left = useRef(false);

  useEffect(() => {
    if (!gone || forgotten.current) return;
    forgotten.current = true;
    latestForget.current();
  }, [gone, latestForget]);

  useFocusEffect(
    useCallback(() => {
      if (!gone || left.current) return;
      left.current = true;
      leaveScreen(fallback);
    }, [gone, fallback])
  );
}

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

/**
 * Drops every query under `queryKey`: removed outright where nothing is
 * observing it (or its observer is a gone screen that disabled it), and
 * invalidated where a mounted screen still reads it, so that screen refetches
 * and reaches its own "gone" state rather than showing a stale copy.
 */
export function dropQueries(queryClient: QueryClient, queryKey: QueryKey): void {
  queryClient.removeQueries({ queryKey, type: 'inactive' });
  void queryClient.invalidateQueries({ queryKey, type: 'active' });
}

function filterList<T>(queryClient: QueryClient, queryKey: QueryKey, keep: (item: T) => boolean): void {
  queryClient.setQueriesData<T[]>({ queryKey }, (current) => {
    if (!Array.isArray(current)) return current;
    const next = current.filter(keep);
    return next.length === current.length ? current : next;
  });
}

/**
 * A thread that came back unreadable: out of the chat list, and every
 * per-thread cache removed outright. Only the thread screen itself reads
 * those keys, and it has latched `gone` (its queries are disabled from that
 * render on), so nothing can re-read them. Its unread count leaves with its
 * row, and the tab badges are re-read (the server no longer counts it).
 */
export function forgetConversation(queryClient: QueryClient, conversationId: string): void {
  filterList<ConversationListItem>(queryClient, ['conversations'], (item) => item.id !== conversationId);
  void queryClient.invalidateQueries({ queryKey: ['conversations'] });
  for (const key of [
    ['conversation', conversationId],
    ['messages', conversationId],
    ['chat-share-feed', conversationId],
    ['message-quotes', conversationId],
  ]) {
    queryClient.removeQueries({ queryKey: key });
  }
  refreshBadges(queryClient);
}

/** Someone the grid no longer returns: their tile goes now, and the grid re-reads for the counts. */
export function forgetGridRow(queryClient: QueryClient, userId: string): void {
  filterList<GridRow>(queryClient, ['grid_for_me'], (row) => row.user_id !== userId);
  void queryClient.invalidateQueries({ queryKey: ['grid_for_me'] });
}

/**
 * A profile card that came back empty: its grid tile and card caches go.
 * Nothing else, because an empty card is not only a vanished person (a
 * paused or away person has no card either, and their hi's stay).
 */
export function forgetProfile(queryClient: QueryClient, userId: string): void {
  forgetGridRow(queryClient, userId);
  dropQueries(queryClient, ['profile_card', userId]);
  dropQueries(queryClient, ['identity', userId]);
}

/**
 * The other person in a thread that vanished: their profile caches, their
 * hi's to me, a private card they shared with me, and every share list and
 * count that may still name them (their albums shared with me, my shares to
 * them, the Me counts built on both).
 */
export function forgetPerson(queryClient: QueryClient, userId: string): void {
  forgetProfile(queryClient, userId);
  filterList<ReceivedHi>(queryClient, ['his_received'], (hi) => hi.fromUserId !== userId);
  void queryClient.invalidateQueries({ queryKey: ['his_received'] });
  refreshBadges(queryClient);
  dropQueries(queryClient, ['shared-private-card', userId]);
  for (const key of [
    ['me', 'shares'],
    ['me', 'albums_summary'],
    ['shared_with_me_albums'],
    ['my_album_share_counts'],
    ['chat-share-albums'],
  ]) {
    void queryClient.invalidateQueries({ queryKey: key });
  }
}
