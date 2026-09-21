/**
 * Pure composer/state rules for conversations — no React, no Supabase.
 *
 * This is the client mirror of `public.enforce_message_rules()` in
 * `supabase/migrations/20260918000002_core_schema.sql`, so the composer never
 * lets the user hit a refusal the client could have predicted. The server stays
 * authoritative: everything here is an affordance decision, never a security
 * one.
 *
 * The trigger, in its own order:
 *
 * 1. sender is verified                       -> not modelled here (no such
 *    input; the thread is unreachable for an unverified user, who has no grid
 *    and no profile card to open a conversation from).
 * 2. sender is a participant                  -> `reason: 'closed'` (defensive;
 *    a non-participant cannot read the row at all).
 * 3. `awaiting_reply` + sender is the opener + the opener already sent one
 *    message -> refused; and the opener's first message must be non-null and
 *    <= 240 characters.
 * 4. `media_path` is only accepted while `state = 'open'` (the `chat-media`
 *    storage write policy checks the same thing).
 * 5. `closed_block` + sender is `blocked_by` -> refused. The *other* side
 *    (the blocked party) is accepted: decision 12's shadow-accept.
 * 6. `expired` / `closed_deleted` -> refused.
 *
 * One rule here is **stricter than the trigger on purpose**: `awaiting_opener`.
 * After `hi_back()` the conversation exists with the original sender as
 * `opened_by_id` and no messages yet. The trigger would accept a message from
 * the recipient (step 3 only fires for the opener), and `advance_conversation`
 * would flip the thread straight to `open` — but plan §2/§3 say the hi'd-back
 * recipient gets no compose box until the opener has spoken ("Waiting for them
 * to say hi first"). That is a product rule, so it lives here and nowhere else.
 */

export type ConversationState =
  | 'awaiting_reply'
  | 'open'
  | 'expired'
  | 'closed_block'
  | 'closed_deleted';

/** The shape `composerState` needs — a subset of a `conversations` row. */
export interface ConversationRules {
  state: ConversationState;
  user_a_id: string;
  user_b_id: string;
  opened_by_id: string;
  blocked_by: string | null;
}

/** The shape `composerState` needs of the most recent message, if any. */
export interface LastMessageRules {
  sender_id: string;
}

export type ComposerBlockedReason = 'awaiting_opener' | 'awaiting_reply' | 'closed' | 'expired';

export interface ComposerState {
  canSend: boolean;
  reason?: ComposerBlockedReason;
  /**
   * Hard character cap for the composer. 240 for the opener's first message
   * (trigger step 3), otherwise `messages_body_length`'s 1000.
   */
  maxLength: number;
  /** Trigger step 4 + the `chat-media write by open participant` policy. */
  canAttachMedia: boolean;
}

/** `messages_body_length`: `char_length(body) <= 1000`. */
export const MAX_BODY_LENGTH = 1000;
/** `enforce_message_rules` step 3: the opener's first message. */
export const MAX_OPENER_LENGTH = 240;

function isParticipant(conversation: ConversationRules, meId: string): boolean {
  return conversation.user_a_id === meId || conversation.user_b_id === meId;
}

export function composerState(
  conversation: ConversationRules,
  meId: string,
  lastMessage?: LastMessageRules | null
): ComposerState {
  const locked = (reason: ComposerBlockedReason): ComposerState => ({
    canSend: false,
    reason,
    maxLength: MAX_BODY_LENGTH,
    canAttachMedia: false,
  });

  if (!isParticipant(conversation, meId)) return locked('closed');

  switch (conversation.state) {
    case 'awaiting_reply': {
      // In `awaiting_reply` any existing message is necessarily the opener's:
      // a message from the other side would have flipped the row to `open`
      // (`advance_conversation`). The sender check is belt-and-braces.
      const openerHasSent = !!lastMessage && lastMessage.sender_id === conversation.opened_by_id;

      if (meId === conversation.opened_by_id) {
        if (openerHasSent) return locked('awaiting_reply');
        return { canSend: true, maxLength: MAX_OPENER_LENGTH, canAttachMedia: false };
      }

      // Recipient. See the `awaiting_opener` note in the file header.
      if (!openerHasSent) return locked('awaiting_opener');
      // The reply is what opens the thread, so media is still refused here.
      return { canSend: true, maxLength: MAX_BODY_LENGTH, canAttachMedia: false };
    }

    case 'open':
      return { canSend: true, maxLength: MAX_BODY_LENGTH, canAttachMedia: true };

    case 'closed_block': {
      // The blocker cannot send — and in practice never gets here, because
      // `can_read_conversation` hides the row from them entirely.
      if (meId === conversation.blocked_by) return locked('closed');
      // Decision 12 shadow-accept: for the blocked party the thread must look
      // *completely* unchanged, so the composer stays live and media stays
      // attachable even though the trigger will refuse a `media_path` here.
      // Disabling the attach button would be the tell; a generic "couldn't
      // send" that looks like any other failure is not. See `chatMedia.ts`.
      return { canSend: true, maxLength: MAX_BODY_LENGTH, canAttachMedia: true };
    }

    case 'expired':
      return locked('expired');

    case 'closed_deleted':
      return locked('closed');

    default:
      return locked('closed');
  }
}

/**
 * Copy for a locked composer.
 *
 * `closed` and `expired` deliberately share one string: plan §3 says an
 * expired/deleted thread shows "no reason … a distinguishing banner would leak
 * what decision 13 hides", and the same sentence must cover the (unreachable)
 * blocker case so no wording can ever be read back as "you blocked them".
 */
export const COMPOSER_LOCKED_COPY: Record<ComposerBlockedReason, string> = {
  awaiting_opener: 'Waiting for them to say hi first.',
  awaiting_reply: 'Waiting for a reply.',
  closed: 'This conversation is closed.',
  expired: 'This conversation is closed.',
};

/**
 * The list chip for a conversation, or null for no chip.
 *
 * `closed_block` renders **no chip at all** for the blocked party — that is the
 * whole point of decision 12 — and the blocker never sees the row. All three
 * lockable states share one neutral word so the chip cannot be decoded.
 */
export function conversationChip(conversation: ConversationRules, meId: string): string | null {
  if (conversation.state === 'expired' || conversation.state === 'closed_deleted') return 'Closed';
  if (conversation.state === 'closed_block' && meId === conversation.blocked_by) return 'Closed';
  return null;
}

/** Read-only threads render "quietly" (decisions 13/36): no banner, no reason. */
export function isLockedThread(conversation: ConversationRules, meId: string): boolean {
  return !composerState(conversation, meId).canSend;
}

export interface PreviewMessage {
  body: string | null;
  media_path: string | null;
}

/** One-line list preview. Media-only messages have no body to show. */
export function messagePreview(message: PreviewMessage | null | undefined): string {
  if (!message) return 'No messages yet';
  const body = message.body?.trim();
  if (body) return body;
  if (message.media_path) return 'Photo';
  return '';
}

/**
 * Unread, exactly as plan §3 defines it: the thread has a message, it is newer
 * than my `message_reads.last_read_at` (a missing row means never read), and
 * the last message is not my own.
 */
export function isUnread(input: {
  lastMessageAt: string | null;
  lastReadAt: string | null;
  lastSenderId: string | null;
  meId: string;
}): boolean {
  if (!input.lastMessageAt) return false;
  if (input.lastSenderId === input.meId) return false;
  if (!input.lastReadAt) return true;
  return input.lastMessageAt > input.lastReadAt;
}
