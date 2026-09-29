import type { ConversationDetail } from '../api/conversations';
import { composerState, MAX_BODY_LENGTH } from '../chat/rules';

/**
 * Whether `viewerId` may reply to `ownerId`'s album in `conversation`, and
 * with what cap. The reply bar is offered only when this says yes:
 *
 * - never to the owner looking at their own album;
 * - only in a conversation that is exactly the two of them;
 * - only where the thread's own composer would let the viewer send a text
 *   message right now (`chat/rules.composerState`, the client mirror of
 *   `enforce_message_rules`). A closed or expired thread, or one waiting on
 *   the other side, has no reply bar, and nothing says why.
 *
 * The blocked side of a `closed_block` thread gets the bar, exactly as its
 * thread keeps its composer (decision 12): taking it away would be the tell.
 */
export function replyRules(
  conversation: ConversationDetail | null | undefined,
  viewerId: string | null | undefined,
  ownerId: string | null | undefined
): { canReply: boolean; maxLength: number } {
  const no = { canReply: false, maxLength: MAX_BODY_LENGTH };
  if (!conversation || !viewerId || !ownerId || viewerId === ownerId) return no;
  const pair = [conversation.userAId, conversation.userBId];
  if (!pair.includes(viewerId) || !pair.includes(ownerId)) return no;
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
