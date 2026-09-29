import { useMemo, useRef } from 'react';
import { useQueries } from '@tanstack/react-query';
import { messageQuotes, type MessageQuote } from '../api/replies';
import type { MessagePage } from '../api/messages';
import { replyIdsOf } from './replies';

/** Every quote query for one thread sits under this key. */
export function quotesKey(conversationId: string | null | undefined): readonly unknown[] {
  return ['message-quotes', conversationId];
}

/**
 * The live quotes for a thread's replies, keyed by reply id
 * (`docs/chat-replies-and-badges.md` §1).
 *
 * One `message_quotes` call per loaded page that has replies in it (a page
 * is 30 messages; the RPC takes up to 200). A new reply arriving over
 * realtime refetches the first page, whose reply ids change, so it gets its
 * own call. The thread invalidates `quotesKey` on an `UPDATE` of a reply (an
 * album photo deleted under it) and whenever it refetches after a reconnect;
 * the queries also refetch on focus and foreground like any other, because a
 * revoke or a block produces no event on the reply itself.
 *
 * Answers are kept by reply id across refetches, so a quote never blanks out
 * while its page's call is in flight. A newer answer always replaces an
 * older one (an `available: false` included).
 */
export function useThreadQuotes(
  conversationId: string | null | undefined,
  pages: readonly MessagePage[] | undefined,
  enabled: boolean
): Record<string, MessageQuote> {
  const idLists = useMemo(
    () => (pages ?? []).map((page) => replyIdsOf(page.messages)).filter((ids) => ids.length > 0),
    [pages]
  );

  const results = useQueries({
    queries: idLists.map((ids) => ({
      queryKey: [...quotesKey(conversationId), ids.join(',')],
      queryFn: () => messageQuotes(ids),
      enabled: enabled && !!conversationId,
    })),
  });

  const known = useRef<Record<string, MessageQuote>>({});
  const stamp = results.map((result) => result.dataUpdatedAt).join('|');
  return useMemo(() => {
    const next = { ...known.current };
    for (const result of results) {
      if (result.data) Object.assign(next, result.data);
    }
    known.current = next;
    return next;
    // `results` is a new array every render; its answers are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp]);
}
