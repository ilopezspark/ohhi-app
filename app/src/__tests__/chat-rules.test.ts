import {
  COMPOSER_LOCKED_COPY,
  MAX_BODY_LENGTH,
  MAX_OPENER_LENGTH,
  composerState,
  conversationChip,
  isLockedThread,
  isUnread,
  messagePreview,
  type ComposerBlockedReason,
  type ConversationRules,
  type ConversationState,
} from '../chat/rules';

const OPENER = 'aaaaaaaa-0000-4000-8000-000000000001';
const RECIPIENT = 'bbbbbbbb-0000-4000-8000-000000000002';
const STRANGER = 'cccccccc-0000-4000-8000-000000000003';

function conversation(
  state: ConversationState,
  overrides: Partial<ConversationRules> = {}
): ConversationRules {
  return {
    state,
    // `conversations_ordered_pair` guarantees user_a_id < user_b_id; the opener
    // can be either side, which is exactly what these cases vary.
    user_a_id: OPENER,
    user_b_id: RECIPIENT,
    opened_by_id: OPENER,
    blocked_by: null,
    ...overrides,
  };
}

const openerSent = { sender_id: OPENER };
const recipientSent = { sender_id: RECIPIENT };

describe('composerState — every state x role x last-sender combination', () => {
  type Case = [
    label: string,
    state: ConversationState,
    me: string,
    last: { sender_id: string } | null,
    expected: { canSend: boolean; reason?: ComposerBlockedReason; maxLength: number; media: boolean },
    overrides: Partial<ConversationRules>,
  ];

  const cases: Case[] = [
    // ---- awaiting_reply -------------------------------------------------
    [
      'awaiting_reply / opener / nothing sent -> may send the 240-char opener',
      'awaiting_reply',
      OPENER,
      null,
      { canSend: true, maxLength: MAX_OPENER_LENGTH, media: false },
      {},
    ],
    [
      'awaiting_reply / opener / opener already sent -> waiting for a reply',
      'awaiting_reply',
      OPENER,
      openerSent,
      { canSend: false, reason: 'awaiting_reply', maxLength: MAX_BODY_LENGTH, media: false },
      {},
    ],
    [
      'awaiting_reply / recipient / nothing sent -> waiting for the opener (hi_back)',
      'awaiting_reply',
      RECIPIENT,
      null,
      { canSend: false, reason: 'awaiting_opener', maxLength: MAX_BODY_LENGTH, media: false },
      {},
    ],
    [
      'awaiting_reply / recipient / opener sent -> may reply, full length, no media yet',
      'awaiting_reply',
      RECIPIENT,
      openerSent,
      { canSend: true, maxLength: MAX_BODY_LENGTH, media: false },
      {},
    ],
    [
      // Cannot occur (advance_conversation would have flipped the row to
      // `open`), but the rule must not accidentally unlock the opener.
      'awaiting_reply / opener / last message is the recipient’s -> still may send',
      'awaiting_reply',
      OPENER,
      recipientSent,
      { canSend: true, maxLength: MAX_OPENER_LENGTH, media: false },
      {},
    ],

    // ---- open -----------------------------------------------------------
    [
      'open / opener -> both sides send freely, media enabled',
      'open',
      OPENER,
      recipientSent,
      { canSend: true, maxLength: MAX_BODY_LENGTH, media: true },
      {},
    ],
    [
      'open / recipient -> both sides send freely, media enabled',
      'open',
      RECIPIENT,
      openerSent,
      { canSend: true, maxLength: MAX_BODY_LENGTH, media: true },
      {},
    ],
    [
      'open / no messages yet',
      'open',
      RECIPIENT,
      null,
      { canSend: true, maxLength: MAX_BODY_LENGTH, media: true },
      {},
    ],

    // ---- closed_block ---------------------------------------------------
    [
      'closed_block / I am the blocker -> locked, neutral copy',
      'closed_block',
      OPENER,
      openerSent,
      { canSend: false, reason: 'closed', maxLength: MAX_BODY_LENGTH, media: false },
      { blocked_by: OPENER },
    ],
    [
      'closed_block / I am the blocked party -> shadow-accepted, identical to open',
      'closed_block',
      RECIPIENT,
      openerSent,
      { canSend: true, maxLength: MAX_BODY_LENGTH, media: true },
      { blocked_by: OPENER },
    ],
    [
      'closed_block / blocked party is the opener -> still shadow-accepted',
      'closed_block',
      OPENER,
      openerSent,
      { canSend: true, maxLength: MAX_BODY_LENGTH, media: true },
      { blocked_by: RECIPIENT },
    ],

    // ---- expired / closed_deleted ---------------------------------------
    [
      'expired / opener -> locked',
      'expired',
      OPENER,
      null,
      { canSend: false, reason: 'expired', maxLength: MAX_BODY_LENGTH, media: false },
      {},
    ],
    [
      'expired / recipient -> locked',
      'expired',
      RECIPIENT,
      openerSent,
      { canSend: false, reason: 'expired', maxLength: MAX_BODY_LENGTH, media: false },
      {},
    ],
    [
      'closed_deleted / opener -> locked',
      'closed_deleted',
      OPENER,
      openerSent,
      { canSend: false, reason: 'closed', maxLength: MAX_BODY_LENGTH, media: false },
      {},
    ],
    [
      'closed_deleted / recipient -> locked',
      'closed_deleted',
      RECIPIENT,
      openerSent,
      { canSend: false, reason: 'closed', maxLength: MAX_BODY_LENGTH, media: false },
      {},
    ],

    // ---- not a participant ---------------------------------------------
    [
      'open / not a participant -> locked (defensive; the row is unreadable)',
      'open',
      STRANGER,
      openerSent,
      { canSend: false, reason: 'closed', maxLength: MAX_BODY_LENGTH, media: false },
      {},
    ],
  ];

  it.each(cases)('%s', (_label, state, me, last, expected, overrides) => {
    const result = composerState(conversation(state, overrides), me, last);
    expect(result.canSend).toBe(expected.canSend);
    expect(result.reason).toBe(expected.reason);
    expect(result.maxLength).toBe(expected.maxLength);
    expect(result.canAttachMedia).toBe(expected.media);
  });

  it('treats an undefined last message the same as none', () => {
    expect(composerState(conversation('awaiting_reply'), RECIPIENT).reason).toBe('awaiting_opener');
    expect(composerState(conversation('awaiting_reply'), OPENER).canSend).toBe(true);
  });

  it('never enables media outside an open (or shadow-accepted) thread', () => {
    const states: ConversationState[] = ['awaiting_reply', 'expired', 'closed_deleted'];
    for (const state of states) {
      for (const me of [OPENER, RECIPIENT]) {
        expect(composerState(conversation(state), me, openerSent).canAttachMedia).toBe(false);
      }
    }
  });
});

describe('locked copy', () => {
  it('says the same thing for closed and expired, so neither is identifiable', () => {
    expect(COMPOSER_LOCKED_COPY.closed).toBe(COMPOSER_LOCKED_COPY.expired);
  });

  it('never names a block, a report, or a deleted account', () => {
    for (const copy of Object.values(COMPOSER_LOCKED_COPY)) {
      expect(copy.toLowerCase()).not.toMatch(/block|report|delet|ban|suspend/);
    }
  });
});

describe('conversationChip', () => {
  it('shows nothing for a live thread', () => {
    expect(conversationChip(conversation('open'), OPENER)).toBeNull();
    expect(conversationChip(conversation('awaiting_reply'), OPENER)).toBeNull();
  });

  it('shows nothing at all to the blocked party — the row must look untouched', () => {
    expect(
      conversationChip(conversation('closed_block', { blocked_by: OPENER }), RECIPIENT)
    ).toBeNull();
  });

  it('uses one neutral word for expired, deleted and the blocker’s own row', () => {
    expect(conversationChip(conversation('expired'), OPENER)).toBe('Closed');
    expect(conversationChip(conversation('closed_deleted'), OPENER)).toBe('Closed');
    expect(conversationChip(conversation('closed_block', { blocked_by: OPENER }), OPENER)).toBe(
      'Closed'
    );
  });
});

describe('isLockedThread', () => {
  it.each([
    ['open', 'open' as ConversationState, RECIPIENT, false],
    ['expired', 'expired' as ConversationState, RECIPIENT, true],
    ['closed_deleted', 'closed_deleted' as ConversationState, RECIPIENT, true],
  ])('%s', (_label, state, me, expected) => {
    expect(isLockedThread(conversation(state), me)).toBe(expected);
  });

  it('does not treat a shadow-accepted thread as locked', () => {
    expect(
      isLockedThread(conversation('closed_block', { blocked_by: OPENER }), RECIPIENT)
    ).toBe(false);
  });
});

describe('messagePreview', () => {
  it.each([
    ['no message', null, 'No messages yet'],
    ['text', { body: 'hey', media_path: null }, 'hey'],
    ['whitespace-only body with media', { body: '   ', media_path: 'c/m.jpg' }, 'Photo'],
    ['media only', { body: null, media_path: 'c/m.jpg' }, 'Photo'],
    ['nothing at all', { body: null, media_path: null }, ''],
  ])('%s', (_label, message, expected) => {
    expect(messagePreview(message)).toBe(expected);
  });
});

describe('isUnread', () => {
  const T1 = '2026-09-20T10:00:00.000Z';
  const T2 = '2026-09-20T11:00:00.000Z';

  it.each([
    ['never read, they spoke last', T2, null, RECIPIENT, true],
    ['never read, I spoke last', T2, null, OPENER, false],
    ['read after the last message', T1, T2, RECIPIENT, false],
    ['read before the last message', T2, T1, RECIPIENT, true],
    ['read exactly at the last message', T2, T2, RECIPIENT, false],
    ['no messages at all', null, null, null, false],
  ])('%s', (_label, lastMessageAt, lastReadAt, lastSenderId, expected) => {
    expect(isUnread({ lastMessageAt, lastReadAt, lastSenderId, meId: OPENER })).toBe(expected);
  });
});
