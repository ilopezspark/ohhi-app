import type { Database } from '../types/database';

export type HiState = Database['public']['Enums']['hi_state'];

export type CardCta =
  | { kind: 'hi' }
  | { kind: 'hi_sent' }
  | { kind: 'message'; conversationId: string }
  | { kind: 'message_pending' }
  | { kind: 'none' };

/**
 * The profile-card CTA state machine (`docs/app-social-plan.md` §1's table),
 * a pure function of the two fields `profile_card_for` returns for this
 * purpose. `my_hi_state` only ever reflects a hi the *viewer* sent (decision
 * 46) — an incoming hi from the target is invisible here and only surfaces
 * on the Hi's tab; a card opened from a hi-received context still resolves
 * to `hi` here, which is correct.
 *
 * | `conversation_id` | `my_hi_state`        | CTA                                    |
 * |---|---|---|
 * | set   | any               | `message` -> "Message"                     |
 * | null  | null              | `hi` -> "Hi"                                |
 * | null  | `sent`            | `hi_sent` -> "Hi sent" (disabled)           |
 * | null  | `answered`        | `message_pending` -> transitional, refetch  |
 * | null  | `dismissed`/`expired` | `none` -> no CTA                       |
 *
 * `conversation_id` wins whenever it's set, regardless of `my_hi_state` (the
 * table's first row). The `answered` + null-conversation combination is the
 * one transitional case: `hi_back()` sets both atomically in one
 * transaction, so a null conversation id alongside `answered` is a stale
 * read racing the two selects, not a legitimate steady state — the caller
 * should refetch once and expect `conversation_id` to be populated.
 *
 * A block never reaches this function — the card itself is zero rows first.
 */
export function cardCta(myHiState: HiState | null, conversationId: string | null): CardCta {
  if (conversationId) return { kind: 'message', conversationId };

  switch (myHiState) {
    case null:
      return { kind: 'hi' };
    case 'sent':
      return { kind: 'hi_sent' };
    case 'answered':
      return { kind: 'message_pending' };
    case 'dismissed':
    case 'expired':
    default:
      return { kind: 'none' };
  }
}
