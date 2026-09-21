import type { Database } from '../types/database';

export type HiState = Database['public']['Enums']['hi_state'];

export type CardCta =
  | { kind: 'hi_and_message' }
  | { kind: 'hi_sent' }
  | { kind: 'message_opener' }
  | { kind: 'message'; conversationId: string }
  | { kind: 'message_pending' }
  | { kind: 'none' };

/**
 * The profile-card CTA state machine (`docs/app-social-plan.md` §1's table),
 * a pure function of the two fields `profile_card_for` returns for this
 * purpose. `my_hi_state` only ever reflects a hi the *viewer* sent (decision
 * 46) — an incoming hi from the target is invisible here and only surfaces
 * on the Hi's tab; a card opened from a hi-received context still resolves
 * to `hi_and_message` here, which is correct.
 *
 * Decision 49: Hi and Message are two equal, low-friction openers offered
 * together — not a fallback pair. After either is sent, the sender is
 * locked out with that person until the other side responds (a hi back, or
 * a reply to the opener's first message — `src/chat/rules.ts`'s
 * `awaiting_reply` gate handles the message side once a conversation
 * exists).
 *
 * | `conversation_id` | `my_hi_state`        | CTA                                              |
 * |---|---|---|
 * | set   | any               | `message` -> "Message" (navigates to the thread)             |
 * | null  | null              | `hi_and_message` -> "Hi" + "Message" (both openers)          |
 * | null  | `sent`            | `hi_sent` -> "Hi sent" (disabled), no Message                |
 * | null  | `answered`        | `message_pending` -> transitional, refetch                   |
 * | null  | `dismissed`/`expired` | `message_opener` -> "Message" only (no Hi)               |
 *
 * `conversation_id` wins whenever it's set, regardless of `my_hi_state` (the
 * table's first row). The `answered` + null-conversation combination is the
 * one transitional case: `hi_back()` sets both atomically in one
 * transaction, so a null conversation id alongside `answered` is a stale
 * read racing the two selects, not a legitimate steady state — the caller
 * should refetch once and expect `conversation_id` to be populated.
 *
 * `dismissed`/`expired` no longer resolve to `none`: `enforce_hi_rules()`
 * refuses a repeat hi to that recipient (decision 6), so "Hi" stays
 * withheld, but `start_conversation()` has no such check — it only refuses
 * on a block or an existing conversation, neither of which applies here — so
 * a fresh Message opener is offered instead of nothing.
 *
 * A block never reaches this function — the card itself is zero rows first.
 */
export function cardCta(myHiState: HiState | null, conversationId: string | null): CardCta {
  if (conversationId) return { kind: 'message', conversationId };

  switch (myHiState) {
    case null:
      return { kind: 'hi_and_message' };
    case 'sent':
      return { kind: 'hi_sent' };
    case 'answered':
      return { kind: 'message_pending' };
    case 'dismissed':
    case 'expired':
      return { kind: 'message_opener' };
    default:
      return { kind: 'none' };
  }
}
