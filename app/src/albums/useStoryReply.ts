import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { findConversationIdWith } from '../api/albumOwner';
import { getConversation } from '../api/conversations';
import { isUnavailableError, mapSupabaseError } from '../api/errors';
import { sendMessage } from '../api/messages';
import type { StoryReply } from './StoryReplyBar';
import { replyRules } from './storyReply';

export interface UseStoryReplyOptions {
  /** Known when the album was opened from a thread. Otherwise it is looked up from the owner. */
  conversationId?: string | null;
  ownerId: string | null | undefined;
  viewerId: string | null | undefined;
  /** Off while the album is loading or gone. */
  enabled: boolean;
}

/**
 * The story's reply bar for someone looking at an album shared with them:
 * `null` (no bar) unless there is a conversation with the owner that the
 * viewer may write to right now (`storyReply.replyRules`).
 *
 * The conversation is read with the thread screen's own query
 * (`['conversation', id]`, `getConversation`), so from a thread it is
 * normally cached already. From the albums list there is no id, so it is
 * looked up first (`findConversationIdWith`); no conversation, no bar.
 *
 * Sending is the ordinary `sendMessage` with a plain `body`: the schema
 * has no way for a message to point at an album or one of its photos, so
 * the reply goes as text on its own. Afterwards the thread's caches are
 * refreshed so the message is there when the story closes. A refusal is
 * rethrown as the app's neutral error (`mapSupabaseError`) for the bar's
 * one-line failure; when it is one of the "not there any more" outcomes
 * (decision 90) the conversation is re-read too, and if it has gone the bar
 * goes with it. Nothing ever says why.
 */
export function useStoryReply({ conversationId, ownerId, viewerId, enabled }: UseStoryReplyOptions): StoryReply | null {
  const queryClient = useQueryClient();
  const active = enabled && !!ownerId && !!viewerId && ownerId !== viewerId;

  const { data: foundId } = useQuery({
    queryKey: ['album-owner-conversation', ownerId],
    queryFn: () => findConversationIdWith(ownerId as string),
    enabled: active && !conversationId,
    staleTime: 60_000,
  });
  const id = conversationId || foundId || null;

  const { data: conversation } = useQuery({
    queryKey: ['conversation', id],
    queryFn: () => getConversation(id as string),
    enabled: active && !!id,
    staleTime: 60_000,
  });

  const rules = replyRules(active ? conversation : null, viewerId, ownerId);

  const onSend = useCallback(
    async (text: string) => {
      if (!id) throw mapSupabaseError(new Error('no conversation'));
      try {
        await sendMessage({ conversationId: id, body: text });
      } catch (error) {
        const mapped = mapSupabaseError(error);
        if (isUnavailableError(mapped)) {
          void queryClient.invalidateQueries({ queryKey: ['conversation', id] });
          void queryClient.invalidateQueries({ queryKey: ['album-owner-conversation', ownerId] });
          void queryClient.invalidateQueries({ queryKey: ['conversations'] });
        }
        throw mapped;
      }
      void queryClient.invalidateQueries({ queryKey: ['messages', id] });
      void queryClient.invalidateQueries({ queryKey: ['conversation', id] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
    [id, ownerId, queryClient]
  );

  const canReply = rules.canReply && !!id;
  const maxLength = rules.maxLength;
  return useMemo(() => (canReply ? { onSend, maxLength } : null), [canReply, onSend, maxLength]);
}
