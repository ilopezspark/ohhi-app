/**
 * Profile replies, the api layer (migration 0024, decision 100): the two new
 * reply columns on send and on read, `profile_reply_targets`, the new
 * `message_quotes` columns, and the pure quote resolution for them.
 */
const CONV = 'cccccccc-0000-4000-8000-000000000003';
const THEM = 'bbbbbbbb-0000-4000-8000-000000000002';

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
import { getProfileReplyTargets } from '../api/profileCard';
import { messageQuotes } from '../api/replies';
import { RefusedError } from '../api/errors';
import { replyKindFor, replyReferenceColumns, replyTargetOf, resolveQuote } from '../chat/replies';

beforeEach(() => {
  jest.clearAllMocks();
  mockInsertResult = { data: { id: 'm1' }, error: null };
});

const payload = () => mockInsert.mock.calls[0]![0] as Record<string, unknown>;

describe('sendMessage — profile reply columns', () => {
  it('sends a prompt reply with only reply_to_user_prompt_id, never reply_kind', async () => {
    await sendMessage({ conversationId: CONV, body: 'same', replyTo: { userPromptId: 'up-1' } });
    expect(payload()).toMatchObject({ reply_to_user_prompt_id: 'up-1', body: 'same' });
    for (const column of ['reply_to_user_photo_id', 'reply_to_message_id', 'reply_to_album_photo_id', 'reply_kind']) {
      expect(payload()).not.toHaveProperty(column);
    }
  });

  it('sends a photo reply with only reply_to_user_photo_id', async () => {
    await sendMessage({ conversationId: CONV, body: 'nice', replyTo: { userPhotoId: 'ph-1' } });
    expect(payload()).toMatchObject({ reply_to_user_photo_id: 'ph-1' });
    expect(payload()).not.toHaveProperty('reply_to_user_prompt_id');
  });

  it('reads both new columns back with the row', async () => {
    await sendMessage({ conversationId: CONV, body: 'x' });
    const columns = mockSelect.mock.calls[0]![0] as string;
    expect(columns).toContain('reply_to_user_prompt_id');
    expect(columns).toContain('reply_to_user_photo_id');
  });

  it('a refused profile reference is the one generic refusal', async () => {
    mockInsertResult = { data: null, error: { code: '42501', message: 'not allowed' } };
    await expect(sendMessage({ conversationId: CONV, body: 'x', replyTo: { userPromptId: 'gated' } })).rejects.toBeInstanceOf(
      RefusedError
    );
  });

  it('replyColumns maps each of the four targets to its one column', () => {
    expect(replyColumns({ userPromptId: 'a' })).toEqual({ reply_to_user_prompt_id: 'a' });
    expect(replyColumns({ userPhotoId: 'b' })).toEqual({ reply_to_user_photo_id: 'b' });
    expect(replyColumns({ messageId: 'c' })).toEqual({ reply_to_message_id: 'c' });
    expect(replyColumns({ albumPhotoId: 'd' })).toEqual({ reply_to_album_photo_id: 'd' });
  });

  it('the thread’s optimistic row and retry keep the reference and kind', () => {
    expect(replyKindFor({ userPromptId: 'a' })).toBe('user_prompt');
    expect(replyKindFor({ userPhotoId: 'b' })).toBe('user_photo');
    expect(replyKindFor(null)).toBeNull();
    const columns = replyReferenceColumns({ userPhotoId: 'b' });
    expect(columns).toEqual({
      reply_to_message_id: null,
      reply_to_album_photo_id: null,
      reply_to_user_prompt_id: null,
      reply_to_user_photo_id: 'b',
    });
    expect(replyTargetOf(columns)).toEqual({ userPhotoId: 'b' });
    expect(replyTargetOf({ ...columns, reply_to_user_photo_id: null, reply_to_user_prompt_id: 'a' })).toEqual({
      userPromptId: 'a',
    });
  });
});

describe('getProfileReplyTargets', () => {
  it('calls profile_reply_targets and keeps prompts and photos in order', async () => {
    mockRpc.mockResolvedValue({
      data: [
        { kind: 'user_prompt', target_id: 'up-1', prompt_id: 'cafe_order', photo_path: null },
        { kind: 'user_photo', target_id: 'ph-0', prompt_id: null, photo_path: `${THEM}/0.jpg` },
      ],
      error: null,
    });
    expect(await getProfileReplyTargets(THEM)).toEqual([
      { kind: 'user_prompt', targetId: 'up-1', promptId: 'cafe_order' },
      { kind: 'user_photo', targetId: 'ph-0', photoPath: `${THEM}/0.jpg` },
    ]);
    expect(mockRpc).toHaveBeenCalledWith('profile_reply_targets', { p_target: THEM });
  });

  it('drops rows of an unknown kind or missing their key', async () => {
    mockRpc.mockResolvedValue({
      data: [
        { kind: 'user_tag', target_id: 't-1', prompt_id: null, photo_path: null },
        { kind: 'user_prompt', target_id: 'up-1', prompt_id: null, photo_path: null },
        { kind: 'user_photo', target_id: 'ph-0', prompt_id: null, photo_path: null },
      ],
      error: null,
    });
    expect(await getProfileReplyTargets(THEM)).toEqual([]);
  });

  it('nothing is an empty list, and a failure is the mapped error', async () => {
    mockRpc.mockResolvedValueOnce({ data: [], error: null });
    expect(await getProfileReplyTargets(THEM)).toEqual([]);
    mockRpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'not allowed' } });
    await expect(getProfileReplyTargets(THEM)).rejects.toBeInstanceOf(RefusedError);
  });
});

const quoteRow = (overrides: Record<string, unknown> = {}) => ({
  message_id: 'r1',
  reply_kind: 'user_prompt',
  available: true,
  quoted_message_id: null,
  quoted_album_photo_id: null,
  quoted_sender_id: THEM,
  quoted_created_at: null,
  excerpt: null,
  media_kind: null,
  is_limited: false,
  media_path: null,
  media_poster_path: null,
  album_id: null,
  quote_kind: 'user_prompt',
  prompt_question: 'my order at the campus cafe',
  prompt_answer: 'oat latte',
  photo_path: null,
  ...overrides,
});

describe('messageQuotes — profile quotes', () => {
  it('maps a prompt quote', async () => {
    mockRpc.mockResolvedValue({ data: [quoteRow()], error: null });
    const { r1 } = await messageQuotes(['r1']);
    expect(r1).toMatchObject({
      replyKind: 'user_prompt',
      available: true,
      quotedSenderId: THEM,
      promptQuestion: 'my order at the campus cafe',
      promptAnswer: 'oat latte',
      photoPath: null,
    });
  });

  it('maps a photo quote', async () => {
    mockRpc.mockResolvedValue({
      data: [
        quoteRow({
          reply_kind: 'user_photo',
          quote_kind: 'user_photo',
          media_kind: 'photo',
          prompt_question: null,
          prompt_answer: null,
          photo_path: `${THEM}/1.jpg`,
        }),
      ],
      error: null,
    });
    const { r1 } = await messageQuotes(['r1']);
    expect(r1).toMatchObject({ replyKind: 'user_photo', mediaKind: 'photo', photoPath: `${THEM}/1.jpg`, mediaPath: null });
  });

  it('keeps nothing from an unavailable profile quote', async () => {
    mockRpc.mockResolvedValue({
      data: [quoteRow({ available: false, prompt_question: 'leak', prompt_answer: 'leak', photo_path: 'leak' })],
      error: null,
    });
    const { r1 } = await messageQuotes(['r1']);
    expect(r1).toMatchObject({ available: false, promptQuestion: null, promptAnswer: null, photoPath: null, quotedSenderId: null });
  });

  it('reads an older server row (no new columns) without breaking', async () => {
    const row = quoteRow({ reply_kind: 'message', quoted_message_id: 'q1', excerpt: 'hi' });
    delete (row as Record<string, unknown>).quote_kind;
    delete (row as Record<string, unknown>).prompt_question;
    delete (row as Record<string, unknown>).prompt_answer;
    delete (row as Record<string, unknown>).photo_path;
    mockRpc.mockResolvedValue({ data: [row], error: null });
    const { r1 } = await messageQuotes(['r1']);
    expect(r1).toMatchObject({ replyKind: 'message', promptQuestion: null, promptAnswer: null, photoPath: null });
  });
});

describe('resolveQuote — profile quotes', () => {
  const reply = (overrides: Record<string, unknown> = {}) => ({
    reply_kind: 'user_prompt',
    reply_to_message_id: null,
    reply_to_album_photo_id: null,
    reply_to_user_prompt_id: 'up-1',
    reply_to_user_photo_id: null,
    ...overrides,
  });
  const base = {
    messageId: 'r1',
    available: true,
    quotedMessageId: null,
    quotedAlbumPhotoId: null,
    quotedSenderId: THEM,
    quotedCreatedAt: null,
    excerpt: null,
    mediaKind: null,
    isLimited: false,
    mediaPath: null,
    mediaPosterPath: null,
    albumId: null,
    promptQuestion: null,
    promptAnswer: null,
    photoPath: null,
  };
  const none = new Map();

  it('a prompt quote carries the question and the answer', () => {
    expect(
      resolveQuote(reply(), { ...base, replyKind: 'user_prompt', promptQuestion: 'q?', promptAnswer: ' an\n answer ' }, none)
    ).toEqual({ state: 'prompt', senderId: THEM, question: 'q?', answer: 'an answer' });
  });

  it('a photo quote carries its profile-photos path', () => {
    expect(
      resolveQuote(
        reply({ reply_kind: 'user_photo', reply_to_user_prompt_id: null, reply_to_user_photo_id: 'ph-1' }),
        { ...base, replyKind: 'user_photo', mediaKind: 'photo', photoPath: 'p/1.jpg' },
        none
      )
    ).toEqual({ state: 'profile_photo', senderId: THEM, thumbPath: 'p/1.jpg' });
  });

  it('waits for the server, never drawing a profile quote locally', () => {
    expect(resolveQuote(reply(), undefined, none)).toEqual({ state: 'loading' });
  });

  it('is unavailable when the server says so, or the reference was nulled', () => {
    expect(resolveQuote(reply(), { ...base, replyKind: 'user_prompt', available: false }, none)).toEqual({ state: 'unavailable' });
    expect(resolveQuote(reply({ reply_to_user_prompt_id: null }), undefined, none)).toEqual({ state: 'unavailable' });
    // Available but nothing to show: never an empty quote.
    expect(resolveQuote(reply(), { ...base, replyKind: 'user_prompt' }, none)).toEqual({ state: 'unavailable' });
  });
});
