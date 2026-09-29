/**
 * Replies and badges, the api layer (migration 0017, decision 93,
 * `docs/chat-replies-and-badges.md`): the reply reference on send, the reply
 * columns on every message read, the `message_quotes` wrapper and the
 * `my_badge_counts` wrapper.
 */
const ME = 'aaaaaaaa-0000-4000-8000-000000000001';
const CONV = 'cccccccc-0000-4000-8000-000000000003';

const mockInsert = jest.fn();
const mockSelect = jest.fn();
const mockRpc = jest.fn();
let mockInsertResult: { data: unknown; error: unknown } = { data: { id: 'm1' }, error: null };

jest.mock('../api/client', () => ({
  SUPABASE_URL: 'https://example.test',
  supabase: {
    auth: {
      getSession: jest.fn(() =>
        Promise.resolve({ data: { session: { user: { id: 'aaaaaaaa-0000-4000-8000-000000000001' } } }, error: null })
      ),
    },
    from: () => ({
      insert: (payload: unknown) => {
        mockInsert(payload);
        return {
          select: (columns: string) => {
            mockSelect(columns);
            return { single: () => Promise.resolve(mockInsertResult) };
          },
        };
      },
    }),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

import { replyColumns, sendMessage } from '../api/messages';
import { messageQuotes, MESSAGE_QUOTES_MAX_IDS } from '../api/replies';
import { myBadgeCounts, NO_BADGES } from '../api/badges';
import { RefusedError } from '../api/errors';

beforeEach(() => {
  jest.clearAllMocks();
  mockInsertResult = { data: { id: 'm1' }, error: null };
});

const payload = () => mockInsert.mock.calls[0]![0] as Record<string, unknown>;

describe('sendMessage — the reply reference', () => {
  it('sends no reply column at all for an ordinary message', async () => {
    await sendMessage({ conversationId: CONV, body: 'hi' });
    expect(payload()).not.toHaveProperty('reply_to_message_id');
    expect(payload()).not.toHaveProperty('reply_to_album_photo_id');
    expect(payload()).not.toHaveProperty('reply_kind');
  });

  it('sends reply_to_message_id for a message reply, and nothing else about it', async () => {
    await sendMessage({ conversationId: CONV, body: 'yes', replyTo: { messageId: 'q1' } });
    expect(payload().reply_to_message_id).toBe('q1');
    expect(payload()).not.toHaveProperty('reply_to_album_photo_id');
    // Server-only: sending it is a permission error.
    expect(payload()).not.toHaveProperty('reply_kind');
    expect(payload().sender_id).toBe(ME);
  });

  it('sends reply_to_album_photo_id for an album photo reply', async () => {
    await sendMessage({ conversationId: CONV, body: 'love this one', replyTo: { albumPhotoId: 'p1' } });
    expect(payload().reply_to_album_photo_id).toBe('p1');
    expect(payload()).not.toHaveProperty('reply_to_message_id');
    expect(payload()).not.toHaveProperty('reply_kind');
  });

  it('lets a reply carry media, the media columns unchanged', async () => {
    await sendMessage({
      conversationId: CONV,
      id: 'm2',
      mediaPath: `${CONV}/m2.jpg`,
      mediaKind: 'photo',
      viewLimit: 1,
      replyTo: { messageId: 'q1' },
    });
    expect(payload()).toMatchObject({ media_path: `${CONV}/m2.jpg`, view_limit: 1, reply_to_message_id: 'q1' });
  });

  it('reads the reply columns back with the row', async () => {
    await sendMessage({ conversationId: CONV, body: 'x' });
    const columns = mockSelect.mock.calls[0]![0] as string;
    for (const column of ['reply_to_message_id', 'reply_to_album_photo_id', 'reply_kind']) {
      expect(columns).toContain(column);
    }
  });

  it('turns a refused reference into the one generic refusal', async () => {
    mockInsertResult = { data: null, error: { code: '42501', message: 'not allowed' } };
    await expect(sendMessage({ conversationId: CONV, body: 'x', replyTo: { messageId: 'nope' } })).rejects.toBeInstanceOf(
      RefusedError
    );
  });

  it('replyColumns never sets both references', () => {
    expect(replyColumns(null)).toEqual({});
    expect(replyColumns({ messageId: 'a' })).toEqual({ reply_to_message_id: 'a' });
    expect(replyColumns({ albumPhotoId: 'b' })).toEqual({ reply_to_album_photo_id: 'b' });
  });
});

const quoteRow = (overrides: Record<string, unknown> = {}) => ({
  message_id: 'r1',
  reply_kind: 'message',
  available: true,
  quoted_message_id: 'q1',
  quoted_album_photo_id: null,
  quoted_sender_id: ME,
  quoted_created_at: '2026-09-29T10:00:00.000Z',
  excerpt: 'the original',
  media_kind: null,
  is_limited: false,
  media_path: null,
  media_poster_path: null,
  album_id: null,
  ...overrides,
});

describe('messageQuotes', () => {
  it('makes no request for no ids', async () => {
    expect(await messageQuotes([])).toEqual({});
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('asks once for the page, de-duplicated, and keys the answer by reply id', async () => {
    mockRpc.mockResolvedValue({ data: [quoteRow()], error: null });
    const quotes = await messageQuotes(['r1', 'r1', 'r2']);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('message_quotes', { p_message_ids: ['r1', 'r2'] });
    expect(quotes.r1).toMatchObject({ replyKind: 'message', available: true, quotedMessageId: 'q1', excerpt: 'the original' });
    // Left out by the server (not a reply, or no longer readable): just missing.
    expect(quotes.r2).toBeUndefined();
  });

  it('sends more than 200 ids in batches of 200', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    const ids = Array.from({ length: MESSAGE_QUOTES_MAX_IDS + 5 }, (_, i) => `r${i}`);
    await messageQuotes(ids);
    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect((mockRpc.mock.calls[0]![1] as { p_message_ids: string[] }).p_message_ids).toHaveLength(200);
    expect((mockRpc.mock.calls[1]![1] as { p_message_ids: string[] }).p_message_ids).toHaveLength(5);
  });

  it('keeps nothing from an unavailable quote', async () => {
    mockRpc.mockResolvedValue({
      data: [quoteRow({ available: false, quoted_message_id: 'leak', excerpt: 'leak', media_path: 'leak' })],
      error: null,
    });
    const { r1 } = await messageQuotes(['r1']);
    expect(r1).toMatchObject({ available: false, quotedMessageId: null, excerpt: null, mediaPath: null });
  });

  it('never passes a path on for limited media, even if one came back', async () => {
    mockRpc.mockResolvedValue({
      data: [quoteRow({ media_kind: 'photo', is_limited: true, media_path: 'x/limited.jpg', excerpt: null })],
      error: null,
    });
    const { r1 } = await messageQuotes(['r1']);
    expect(r1).toMatchObject({ isLimited: true, mediaKind: 'photo', mediaPath: null, mediaPosterPath: null });
  });

  it('maps an album photo quote', async () => {
    mockRpc.mockResolvedValue({
      data: [
        quoteRow({
          reply_kind: 'album_photo',
          quoted_message_id: null,
          quoted_album_photo_id: 'p1',
          media_kind: 'photo',
          media_path: 'owner/album/p1.jpg',
          album_id: 'a1',
          excerpt: null,
        }),
      ],
      error: null,
    });
    const { r1 } = await messageQuotes(['r1']);
    expect(r1).toMatchObject({ replyKind: 'album_photo', quotedAlbumPhotoId: 'p1', albumId: 'a1', mediaPath: 'owner/album/p1.jpg' });
  });

  it('throws the mapped error when the call fails', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied' } });
    await expect(messageQuotes(['r1'])).rejects.toBeInstanceOf(RefusedError);
  });
});

describe('myBadgeCounts', () => {
  it('reads the one row', async () => {
    mockRpc.mockResolvedValue({
      data: [{ unread_chats: 2, unread_messages: 7, his_waiting: 3, total: 5 }],
      error: null,
    });
    expect(await myBadgeCounts()).toEqual({ unreadChats: 2, unreadMessages: 7, hisWaiting: 3, total: 5 });
    expect(mockRpc).toHaveBeenCalledWith('my_badge_counts');
  });

  it('reads an empty answer, or nonsense, as nothing to show', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    expect(await myBadgeCounts()).toEqual(NO_BADGES);
    mockRpc.mockResolvedValue({ data: [{ unread_chats: -1, unread_messages: null, his_waiting: 'x', total: NaN }], error: null });
    expect(await myBadgeCounts()).toEqual(NO_BADGES);
  });

  it('throws the mapped error when the call fails', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied' } });
    await expect(myBadgeCounts()).rejects.toBeInstanceOf(RefusedError);
  });
});
