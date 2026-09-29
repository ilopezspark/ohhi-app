import type { QueryClient } from '@tanstack/react-query';
import type { BadgeCounts } from '../api/badges';
import type { ConversationListItem } from '../api/conversations';

/**
 * Badge rules (migration 0017, decision 93, `docs/chat-replies-and-badges.md`
 * §2), kept free of React so they can be tested on their own.
 *
 * The counts come from the server (`my_badge_counts()`); the app only
 * formats them, refreshes them after its own actions, and lowers them at once
 * when it opens an unread thread so the tab badge drops without waiting.
 */

export const BADGE_COUNTS_KEY = ['badge-counts'] as const;

/** Above this a badge reads `9+`. */
export const BADGE_CAP = 9;

/** What a badge shows: nothing at 0, the number up to 9, then `9+`. */
export function formatBadge(count: number | null | undefined): string | undefined {
  if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) return undefined;
  return count > BADGE_CAP ? `${BADGE_CAP}+` : String(Math.floor(count));
}

/** The Chats tab's screen reader label. */
export function chatsTabLabel(unreadChats: number | null | undefined): string {
  return unreadChats && unreadChats > 0 ? `chats, ${unreadChats} unread` : 'chats';
}

/** The Hi's tab's screen reader label. */
export function hisTabLabel(hisWaiting: number | null | undefined): string {
  return hisWaiting && hisWaiting > 0 ? `hi's, ${hisWaiting} waiting` : "hi's";
}

/** A conversation row's unread count, for a screen reader. */
export function unreadRowLabel(count: number): string {
  return `${count} unread`;
}

/** The counts with one thread's `unread` messages read. Never below zero. */
export function withThreadRead(counts: BadgeCounts, unread: number): BadgeCounts {
  if (unread <= 0 || counts.unreadChats <= 0) return counts;
  const unreadChats = counts.unreadChats - 1;
  return {
    unreadChats,
    unreadMessages: Math.max(0, counts.unreadMessages - unread),
    hisWaiting: counts.hisWaiting,
    total: unreadChats + counts.hisWaiting,
  };
}

/** The counts with one waiting hi answered or dismissed. Never below zero. */
export function withHiHandled(counts: BadgeCounts): BadgeCounts {
  if (counts.hisWaiting <= 0) return counts;
  const hisWaiting = counts.hisWaiting - 1;
  return { ...counts, hisWaiting, total: counts.unreadChats + hisWaiting };
}

/** Re-reads the counts. Call after anything the app itself did that can change them. */
export function refreshBadges(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: BADGE_COUNTS_KEY });
}

/**
 * Opening a thread: its row's count goes to 0 and the tab badge drops now,
 * before `markRead` has even gone. Any count request already in flight is
 * cancelled first, so an answer from before the read cannot put the badge
 * back up for a moment. The caller refreshes once the read has landed (and
 * on failure, which puts the true count back).
 *
 * Returns how many unread messages the row had, or 0 when the row is not
 * cached or had nothing unread (then nothing is changed).
 */
export function markThreadReadOptimistically(queryClient: QueryClient, conversationId: string): number {
  const row = queryClient
    .getQueryData<ConversationListItem[]>(['conversations'])
    ?.find((item) => item.id === conversationId);
  const unread = row?.unreadCount ?? 0;
  if (unread <= 0) return 0;

  void queryClient.cancelQueries({ queryKey: BADGE_COUNTS_KEY });
  queryClient.setQueryData<ConversationListItem[]>(['conversations'], (current) =>
    current?.map((item) => (item.id === conversationId ? { ...item, unreadCount: 0 } : item))
  );
  const counts = queryClient.getQueryData<BadgeCounts>(BADGE_COUNTS_KEY);
  if (counts) queryClient.setQueryData<BadgeCounts>(BADGE_COUNTS_KEY, withThreadRead(counts, unread));
  return unread;
}

/** A hi answered or dismissed: the Hi's badge drops now; the caller refreshes after. */
export function markHiHandledOptimistically(queryClient: QueryClient): void {
  const current = queryClient.getQueryData<BadgeCounts>(BADGE_COUNTS_KEY);
  if (!current) return;
  void queryClient.cancelQueries({ queryKey: BADGE_COUNTS_KEY });
  queryClient.setQueryData<BadgeCounts>(BADGE_COUNTS_KEY, withHiHandled(current));
}
