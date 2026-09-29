import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getConversation, type ConversationDetail } from '../api/conversations';
import { isUnavailableError, mapSupabaseError } from '../api/errors';
import { sendMessage } from '../api/messages';
import type { StoryReply } from '../albums/StoryReplyBar';
import { refreshBadges } from '../badges/badgeCounts';
import { composerState, MAX_BODY_LENGTH } from './rules';

/** Whether `viewerId` may write in this thread right now, and with what cap: exactly the composer's rule. */
export function threadReplyRules(
  conversation: ConversationDetail | null | undefined,
  viewerId: string | null | undefined
): { canReply: boolean; maxLength: number } {
  const no = { canReply: false, maxLength: MAX_BODY_LENGTH };
  if (!conversation || !viewerId) return no;
  if (conversation.userAId !== viewerId && conversation.userBId !== viewerId) return no;
  const composer = composerState(
    {
      state: conversation.state,
      user_a_id: conversation.userAId,
      user_b_id: conversation.userBId,
      opened_by_id: conversation.openedById,
      blocked_by: conversation.blockedBy,
    },
    viewerId,
    conversation.lastMessage
  );
  return composer.canSend ? { canReply: true, maxLength: composer.maxLength } : no;
}

export interface UseMediaReplyOptions {
  conversationId: string | null | undefined;
  /** The message the viewer is showing. */
  messageId: string | null | undefined;
  viewerId: string | null | undefined;
  enabled: boolean;
}

/**
 * The full-screen chat media viewer's reply bar (decision 93): a message in
 * the same thread with `reply_to_message_id` set to the media being shown.
 * `null` (no bar) unless the thread's composer would let the viewer send
 * right now, the same rule the thread uses; a locked thread just has no bar.
 *
 * Replying never counts a view and never opens anything: the send is a
 * plain insert, and afterwards only the thread's lists are refreshed, never
 * this message's own row (re-reading it is what would re-run the viewer's
 * open). A refusal is the app's neutral error; when it means the thread is
 * no longer there, the conversation is re-read so the bar goes with it.
 */
export function useMediaReply({ conversationId, messageId, viewerId, enabled }: UseMediaReplyOptions): {
  reply: StoryReply | null;
  conversation: ConversationDetail | null | undefined;
} {
  const queryClient = useQueryClient();
  const active = enabled && !!conversationId && !!messageId && !!viewerId;

  const { data: conversation } = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: () => getConversation(conversationId as string),
    enabled: active,
    staleTime: 60_000,
  });

  const rules = threadReplyRules(active ? conversation : null, viewerId);

  const onSend = useCallback(
    async (text: string) => {
      if (!conversationId || !messageId) throw mapSupabaseError(new Error('no conversation'));
      try {
        await sendMessage({ conversationId, body: text, replyTo: { messageId } });
      } catch (error) {
        const mapped = mapSupabaseError(error);
        if (isUnavailableError(mapped)) {
          void queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] });
          void queryClient.invalidateQueries({ queryKey: ['conversations'] });
        }
        throw mapped;
      }
      void queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
      void queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      refreshBadges(queryClient);
    },
    [conversationId, messageId, queryClient]
  );

  const { canReply, maxLength } = rules;
  const reply = useMemo(() => (canReply ? { onSend, maxLength } : null), [canReply, onSend, maxLength]);
  return { reply, conversation };
}
