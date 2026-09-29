import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { myBadgeCounts, type BadgeCounts } from '../api/badges';
import { useMessageListRealtime } from '../chat/useChatRealtime';
import { setAppBadge } from './appBadge';
import { BADGE_COUNTS_KEY, refreshBadges } from './badgeCounts';

/**
 * The tab bar's counts, mounted once by the tabs layout for as long as the
 * person is signed in.
 *
 * When they refresh (`docs/chat-replies-and-badges.md` §2):
 * - any message event the app can read (the app-wide `messages` realtime
 *   list channel, shared with the chat list);
 * - the app coming to the foreground (React Query's focus, wired in
 *   `query/lifecycle.ts`) and a reconnect;
 * - a tab gaining focus (the layout's `screenListeners`);
 * - after the app's own read, send, hi, hi back, dismiss and block
 *   (`refreshBadges`). Hi's have no realtime (0017 leaves `his` off the
 *   publication), so for them it is foreground and tab focus.
 *
 * The app icon mirrors `total` through `setAppBadge`.
 */
export function useBadgeCounts(): BadgeCounts | undefined {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: BADGE_COUNTS_KEY, queryFn: myBadgeCounts });

  useMessageListRealtime({
    onMessage: () => refreshBadges(queryClient),
    onInvalidate: () => refreshBadges(queryClient),
  });

  const total = data?.total;
  useEffect(() => {
    if (typeof total === 'number') void setAppBadge(total).catch(() => {});
  }, [total]);

  return data;
}
