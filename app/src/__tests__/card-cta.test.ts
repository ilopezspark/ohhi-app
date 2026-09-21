import { cardCta } from '../card/cta';

describe('cardCta', () => {
  // `docs/app-social-plan.md` §1's CTA table, every my_hi_state x
  // conversation_id combination.
  it('resolves to message whenever conversation_id is set, regardless of my_hi_state', () => {
    const states = [null, 'sent', 'answered', 'dismissed', 'expired'] as const;
    for (const state of states) {
      expect(cardCta(state, 'conv-1')).toEqual({ kind: 'message', conversationId: 'conv-1' });
    }
  });

  it('resolves to hi when there is no conversation and no prior hi', () => {
    expect(cardCta(null, null)).toEqual({ kind: 'hi' });
  });

  it('resolves to hi_sent (disabled) when a hi was sent and no conversation exists yet', () => {
    expect(cardCta('sent', null)).toEqual({ kind: 'hi_sent' });
  });

  it('resolves to message_pending — the transitional hi_back() race — for answered with no conversation', () => {
    expect(cardCta('answered', null)).toEqual({ kind: 'message_pending' });
  });

  it('resolves to none for a dismissed hi with no conversation', () => {
    expect(cardCta('dismissed', null)).toEqual({ kind: 'none' });
  });

  it('resolves to none for an expired hi with no conversation', () => {
    expect(cardCta('expired', null)).toEqual({ kind: 'none' });
  });
});
