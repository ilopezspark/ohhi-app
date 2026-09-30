/**
 * The pure rules behind replies and badges (decision 93): how a quote
 * resolves in every state, the reply bar's words, the drag's thresholds,
 * where the hold menu sits, and badge formatting and optimistic updates.
 */
import { QueryClient } from '@tanstack/react-query';
import type { MessageQuote } from '../api/replies';
import type { ThreadMessage } from '../chat/MessageBubble';
import {
  keptThumbPath,
  mediaLabel,
  messageLine,
  quoteAccessibilityLabel,
  quoteName,
  replyDraftFor,
  replyIdsOf,
  replyingToLabel,
  replyName,
  resolveQuote,
} from '../chat/replies';
import {
  IOS_BACK_EDGE,
  releaseStartsReply,
  replyArrowProgress,
  replyDragOffset,
  REPLY_DRAG_ACTIVATE,
  REPLY_DRAG_MAX,
  REPLY_DRAG_TRIGGER,
  shouldClaimReplyDrag,
} from '../chat/replyDrag';
import { MENU_MARGIN, MENU_WIDTH, menuHeight, menuPosition } from '../chat/menuPlacement';
import {
  BADGE_COUNTS_KEY,
  chatsTabLabel,
  formatBadge,
  hisTabLabel,
  markHiHandledOptimistically,
  markThreadReadOptimistically,
  unreadRowLabel,
  withHiHandled,
  withThreadRead,
} from '../badges/badgeCounts';

const ME = 'me';
const THEM = 'them';

const msg = (overrides: Partial<ThreadMessage> = {}): ThreadMessage => ({
  id: 'm1',
  conversation_id: 'c',
  sender_id: THEM,
  body: 'hello there',
  media_path: null,
  media_kind: null,
  view_limit: null,
  views_used: 0,
  media_duration_ms: null,
  media_bytes: null,
  media_width: null,
  media_height: null,
  media_poster_path: null,
  created_at: '2026-09-29T10:00:00.000Z',
  reply_to_message_id: null,
  reply_to_album_photo_id: null,
  reply_kind: null,
  ...overrides,
});

const quote = (overrides: Partial<MessageQuote> = {}): MessageQuote => ({
  messageId: 'r1',
  replyKind: 'message',
  available: true,
  quotedMessageId: 'q1',
  quotedAlbumPhotoId: null,
  quotedSenderId: THEM,
  quotedCreatedAt: '2026-09-29T09:00:00.000Z',
  excerpt: 'the original',
  mediaKind: null,
  isLimited: false,
  mediaPath: null,
  mediaPosterPath: null,
  albumId: null,
  promptQuestion: null,
  promptAnswer: null,
  photoPath: null,
  ...overrides,
});

const replyRow = msg({ id: 'r1', reply_to_message_id: 'q1', reply_kind: 'message' });
const none = new Map<string, ThreadMessage>();

describe('resolveQuote', () => {
  it('is null for a message that is not a reply', () => {
    expect(resolveQuote(msg(), undefined, none)).toBeNull();
  });

  it('text: the excerpt, flattened to one line', () => {
    const view = resolveQuote(replyRow, quote({ excerpt: 'two\nlines' }), none);
    expect(view).toMatchObject({ state: 'message', line: 'two lines', thumbPath: null, limited: false });
  });

  it('kept photo: its path for the thumbnail, named photo when there is no text', () => {
    const view = resolveQuote(replyRow, quote({ excerpt: null, mediaKind: 'photo', mediaPath: 'c/q1.jpg' }), none);
    expect(view).toMatchObject({ state: 'message', line: 'photo', thumbPath: 'c/q1.jpg', limited: false });
  });

  it('kept video: the poster, never the video itself', () => {
    const view = resolveQuote(
      replyRow,
      quote({ excerpt: null, mediaKind: 'video', mediaPath: 'c/q1.mp4', mediaPosterPath: 'c/q1-poster.jpg' }),
      none
    );
    expect(view).toMatchObject({ line: 'video', thumbPath: 'c/q1-poster.jpg' });
  });

  it('limited: no thumbnail; the words sharpen when the original is loaded', () => {
    const limited = quote({ excerpt: null, mediaKind: 'photo', isLimited: true });
    expect(resolveQuote(replyRow, limited, none)).toMatchObject({ limited: true, thumbPath: null, line: 'limited photo' });
    const loaded = new Map([['q1', msg({ id: 'q1', body: null, media_path: 'c/q1.jpg', media_kind: 'photo', view_limit: 2 })]]);
    expect(resolveQuote(replyRow, limited, loaded)).toMatchObject({ line: 'view twice photo' });
  });

  it('unavailable: nothing else', () => {
    expect(resolveQuote(replyRow, quote({ available: false }), none)).toEqual({ state: 'unavailable' });
  });

  it('album photo: its path, album and photo, from the live answer only', () => {
    const albumReply = msg({ id: 'r1', reply_to_album_photo_id: 'p1', reply_kind: 'album_photo' });
    const view = resolveQuote(
      albumReply,
      quote({ replyKind: 'album_photo', quotedMessageId: null, quotedAlbumPhotoId: 'p1', mediaPath: 'o/a/p1.jpg', albumId: 'a' }),
      none
    );
    expect(view).toEqual({ state: 'album_photo', albumId: 'a', photoId: 'p1', senderId: THEM, thumbPath: 'o/a/p1.jpg' });
    // Never drawn locally.
    expect(resolveQuote(albumReply, undefined, none)).toEqual({ state: 'loading' });
  });

  it('draws a message quote from the loaded original while the answer is on its way', () => {
    const loaded = new Map([['q1', msg({ id: 'q1', body: 'loaded' })]]);
    expect(resolveQuote(replyRow, undefined, loaded)).toMatchObject({ state: 'message', line: 'loaded', senderId: THEM });
    expect(resolveQuote(replyRow, undefined, none)).toEqual({ state: 'loading' });
  });

  it('the live answer wins over the loaded original', () => {
    const loaded = new Map([['q1', msg({ id: 'q1', body: 'loaded' })]]);
    expect(resolveQuote(replyRow, quote({ available: false }), loaded)).toEqual({ state: 'unavailable' });
  });

  it('a reply whose target was deleted (kind kept, reference nulled) is unavailable', () => {
    expect(resolveQuote(msg({ reply_kind: 'album_photo' }), undefined, none)).toEqual({ state: 'unavailable' });
  });
});

describe('reply words', () => {
  it('names the media', () => {
    expect(mediaLabel('photo')).toBe('photo');
    expect(mediaLabel('video')).toBe('video');
    expect(mediaLabel('photo', 1)).toBe('view once photo');
    expect(mediaLabel('video', 2)).toBe('view twice video');
    expect(mediaLabel('photo', null, true)).toBe('limited photo');
  });

  it('a message as one line', () => {
    expect(messageLine(msg({ body: '  a\n b ' }))).toBe('a b');
    expect(messageLine(msg({ body: null, media_path: 'x.jpg', media_kind: 'photo', view_limit: 1 }))).toBe('view once photo');
  });

  it('only kept media has a thumbnail', () => {
    expect(keptThumbPath(msg({ media_path: 'x.jpg', media_kind: 'photo' }))).toBe('x.jpg');
    expect(keptThumbPath(msg({ media_path: 'x.mp4', media_kind: 'video', media_poster_path: 'x-poster.jpg' }))).toBe('x-poster.jpg');
    expect(keptThumbPath(msg({ media_path: 'x.jpg', media_kind: 'photo', view_limit: 1 }))).toBeNull();
  });

  it('names people lowercase, and me as yourself / you', () => {
    expect(replyName(THEM, ME, 'Maya')).toBe('maya');
    expect(replyName(ME, ME, 'Maya')).toBe('yourself');
    expect(replyName(THEM, ME, null)).toBe('someone');
    expect(quoteName(ME, ME, 'Maya')).toBe('you');
    expect(quoteName(THEM, ME, 'MAYA')).toBe('maya');
    expect(replyingToLabel('maya')).toBe('replying to maya');
  });

  it('the draft for replying to a message', () => {
    expect(replyDraftFor(msg({ id: 'x', media_path: 'c/x.jpg', media_kind: 'photo', body: null }), ME, 'Ada')).toEqual({
      target: { messageId: 'x' },
      name: 'ada',
      line: 'photo',
      thumbPath: 'c/x.jpg',
    });
  });

  it('screen reader labels say no reason', () => {
    expect(quoteAccessibilityLabel({ state: 'unavailable' }, 'ada')).toBe('reply, unavailable');
    expect(quoteAccessibilityLabel({ state: 'loading' }, 'ada')).toBe('reply');
  });

  it('asks only about settled replies', () => {
    expect(
      replyIdsOf([
        { id: 'a', reply_kind: 'message' },
        { id: 'b', reply_kind: null },
        { id: 'c', reply_kind: 'album_photo', pending: true },
        { id: 'd', reply_kind: 'album_photo' },
      ])
    ).toEqual(['a', 'd']);
  });
});

describe('the reply drag', () => {
  const base = { dy: 0, startX: 120, platform: 'android' };

  it('claims the touch only after a clear move to the right', () => {
    expect(shouldClaimReplyDrag({ ...base, dx: REPLY_DRAG_ACTIVATE - 1 })).toBe(false);
    expect(shouldClaimReplyDrag({ ...base, dx: REPLY_DRAG_ACTIVATE })).toBe(true);
    expect(shouldClaimReplyDrag({ ...base, dx: -40 })).toBe(false);
  });

  it('never takes a mostly vertical move from the list', () => {
    expect(shouldClaimReplyDrag({ ...base, dx: 20, dy: 15 })).toBe(false);
    expect(shouldClaimReplyDrag({ ...base, dx: 30, dy: 10 })).toBe(true);
  });

  it('leaves the left edge to the iOS back gesture', () => {
    expect(shouldClaimReplyDrag({ ...base, platform: 'ios', startX: IOS_BACK_EDGE - 1, dx: 40 })).toBe(false);
    expect(shouldClaimReplyDrag({ ...base, platform: 'ios', startX: IOS_BACK_EDGE + 1, dx: 40 })).toBe(true);
    expect(shouldClaimReplyDrag({ ...base, platform: 'android', startX: 2, dx: 40 })).toBe(true);
  });

  it('follows the finger, then resists, and never goes past its limit or backwards', () => {
    expect(replyDragOffset(-30)).toBe(0);
    expect(replyDragOffset(40)).toBe(40);
    expect(replyDragOffset(REPLY_DRAG_TRIGGER + 20)).toBeLessThan(REPLY_DRAG_TRIGGER + 20);
    expect(replyDragOffset(1000)).toBe(REPLY_DRAG_MAX);
  });

  it('starts a reply only when let go past the trigger', () => {
    expect(releaseStartsReply(REPLY_DRAG_TRIGGER - 1)).toBe(false);
    expect(releaseStartsReply(REPLY_DRAG_TRIGGER)).toBe(true);
    expect(replyArrowProgress(0)).toBe(0);
    expect(replyArrowProgress(REPLY_DRAG_TRIGGER / 2)).toBeCloseTo(0.5);
    expect(replyArrowProgress(REPLY_DRAG_TRIGGER * 2)).toBe(1);
  });
});

describe('the hold menu placement', () => {
  const window = { width: 360, height: 780, top: 48, bottom: 34 };

  it('sits below the message on its side', () => {
    expect(menuPosition({ x: 16, y: 200, width: 180, height: 40 }, window, false, 2)).toEqual({ left: 16, top: 248 });
    const mine = menuPosition({ x: 160, y: 200, width: 184, height: 40 }, window, true, 2);
    expect(mine.left).toBe(160 + 184 - MENU_WIDTH);
  });

  it('goes above when there is no room below', () => {
    const at = menuPosition({ x: 16, y: 690, width: 180, height: 40 }, window, false, 2);
    expect(at.top).toBe(690 - 8 - menuHeight(2));
  });

  it('stays inside a narrow window', () => {
    const at = menuPosition({ x: 300, y: 200, width: 200, height: 40 }, { ...window, width: 320 }, false, 2);
    expect(at.left + MENU_WIDTH).toBeLessThanOrEqual(320 - MENU_MARGIN);
    const tall = menuPosition({ x: 16, y: 60, width: 180, height: 700 }, window, false, 2);
    expect(tall.top).toBeGreaterThanOrEqual(window.top + MENU_MARGIN);
  });
});

describe('badges', () => {
  it('hides at 0, counts to 9, then 9+', () => {
    expect(formatBadge(0)).toBeUndefined();
    expect(formatBadge(undefined)).toBeUndefined();
    expect(formatBadge(-1)).toBeUndefined();
    expect(formatBadge(1)).toBe('1');
    expect(formatBadge(9)).toBe('9');
    expect(formatBadge(10)).toBe('9+');
    expect(formatBadge(250)).toBe('9+');
  });

  it('labels the tabs for a screen reader, lowercase', () => {
    expect(chatsTabLabel(3)).toBe('chats, 3 unread');
    expect(chatsTabLabel(0)).toBe('chats');
    expect(hisTabLabel(1)).toBe("hi's, 1 waiting");
    expect(hisTabLabel(0)).toBe("hi's");
    expect(unreadRowLabel(4)).toBe('4 unread');
  });

  it('reading a thread takes one chat and its messages off, never below zero', () => {
    const counts = { unreadChats: 2, unreadMessages: 5, hisWaiting: 1, total: 3 };
    expect(withThreadRead(counts, 3)).toEqual({ unreadChats: 1, unreadMessages: 2, hisWaiting: 1, total: 2 });
    expect(withThreadRead(counts, 0)).toBe(counts);
    expect(withThreadRead({ unreadChats: 0, unreadMessages: 0, hisWaiting: 2, total: 2 }, 3)).toEqual({
      unreadChats: 0,
      unreadMessages: 0,
      hisWaiting: 2,
      total: 2,
    });
  });

  it('answering a hi takes one off the hi badge', () => {
    expect(withHiHandled({ unreadChats: 1, unreadMessages: 1, hisWaiting: 2, total: 3 })).toEqual({
      unreadChats: 1,
      unreadMessages: 1,
      hisWaiting: 1,
      total: 2,
    });
    const none = { unreadChats: 1, unreadMessages: 1, hisWaiting: 0, total: 1 };
    expect(withHiHandled(none)).toBe(none);
  });

  it('an optimistic read changes nothing for a thread with nothing unread, or one not in the list', () => {
    const client = new QueryClient();
    client.setQueryData(['conversations'], [{ id: 'c1', unreadCount: 0 }]);
    client.setQueryData(BADGE_COUNTS_KEY, { unreadChats: 1, unreadMessages: 1, hisWaiting: 0, total: 1 });
    expect(markThreadReadOptimistically(client, 'c1')).toBe(0);
    expect(markThreadReadOptimistically(client, 'nope')).toBe(0);
    expect(client.getQueryData(BADGE_COUNTS_KEY)).toEqual({ unreadChats: 1, unreadMessages: 1, hisWaiting: 0, total: 1 });
    client.clear();
  });

  it('an optimistic hi lowers the hi badge', () => {
    const client = new QueryClient();
    markHiHandledOptimistically(client);
    expect(client.getQueryData(BADGE_COUNTS_KEY)).toBeUndefined();
    client.setQueryData(BADGE_COUNTS_KEY, { unreadChats: 0, unreadMessages: 0, hisWaiting: 2, total: 2 });
    markHiHandledOptimistically(client);
    expect(client.getQueryData(BADGE_COUNTS_KEY)).toEqual({ unreadChats: 0, unreadMessages: 0, hisWaiting: 1, total: 1 });
    client.clear();
  });
});
