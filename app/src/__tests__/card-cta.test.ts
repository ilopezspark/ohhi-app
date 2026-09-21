import { cardCta } from '../card/cta';

describe('cardCta', () => {
  // `docs/app-social-plan.md` §1's CTA table (decision 49), every my_hi_state
  // x conversation_id combination.
  it('resolves to message whenever conversation_id is set, regardless of my_hi_state', () => {
    const states = [null, 'sent', 'answered', 'dismissed', 'expired'] as const;
    for (const state of states) {
      expect(cardCta(state, 'conv-1')).toEqual({ kind: 'message', conversationId: 'conv-1' });
    }
  });

  it('resolves to hi_and_message — both equal openers — when there is no conversation and no prior hi', () => {
    expect(cardCta(null, null)).toEqual({ kind: 'hi_and_message' });
  });

  it('resolves to hi_sent (disabled, no Message) when a hi was sent and no conversation exists yet', () => {
    expect(cardCta('sent', null)).toEqual({ kind: 'hi_sent' });
  });

  it('resolves to message_pending — the transitional hi_back() race — for answered with no conversation', () => {
    expect(cardCta('answered', null)).toEqual({ kind: 'message_pending' });
  });

  it('resolves to message_opener (Message only, no Hi) for a dismissed hi with no conversation', () => {
    expect(cardCta('dismissed', null)).toEqual({ kind: 'message_opener' });
  });

  it('resolves to message_opener (Message only, no Hi) for an expired hi with no conversation', () => {
    expect(cardCta('expired', null)).toEqual({ kind: 'message_opener' });
  });
});
