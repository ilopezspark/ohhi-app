/**
 * Payload-shape tests for the chat api layer, against a mocked Supabase
 * client. These assert the *contract with the schema* — which columns a write
 * may carry, which path a `chat-media` object lands at, how the list select is
 * shaped — not that the network works.
 */

const ME = 'aaaaaaaa-0000-4000-8000-000000000001';
const THEM = 'bbbbbbbb-0000-4000-8000-000000000002';
const CONV = 'cccccccc-0000-4000-8000-000000000003';

// ---------------------------------------------------------------------------
// A tiny PostgREST-shaped fake: every builder method records its call and
// returns `this`, and the terminal await resolves whatever the test queued.
// ---------------------------------------------------------------------------
interface Recorded {
  table: string;
  calls: [string, unknown[]][];
}

const mockRecorded: Recorded[] = [];
let mockQueued: Record<string, { data: unknown; error: unknown }> = {};

function mockBuilderFor(table: string) {
  const entry: Recorded = { table, calls: [] };
  mockRecorded.push(entry);

  const result = () => mockQueued[table] ?? { data: null, error: null };

  const builder: Record<string, unknown> = {
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
  };

  for (const method of [
    'select',
    'insert',
    'upsert',
    'update',
    'eq',
    'in',
    'lt',
    'not',
    'is',
    'order',
    'limit',
    'single',
    'maybeSingle',
  ]) {
    builder[method] = (...args: unknown[]) => {
      entry.calls.push([method, args]);
      return builder;
    };
  }

  return builder;
}

const mockStorageUpload = jest.fn();
const mockStorageSignedUrls = jest.fn();
const mockRpc = jest.fn();

jest.mock('../api/client', () => ({
  SUPABASE_URL: 'https://example.test',
  supabase: {
    auth: {
      getSession: jest.fn(() =>
        Promise.resolve({
          data: { session: { user: { id: 'aaaaaaaa-0000-4000-8000-000000000001' } } },
          error: null,
        })
      ),
    },
    from: (table: string) => mockBuilderFor(table),
    rpc: (...args: unknown[]) => mockRpc(...args),
    storage: {
      from: (bucket: string) => ({
        upload: (...args: unknown[]) => mockStorageUpload(bucket, ...args),
        createSignedUrls: (...args: unknown[]) => mockStorageSignedUrls(bucket, ...args),
      }),
    },
  },
}));

jest.mock('../photos/resize', () => ({
  resizeForUpload: jest.fn(() => Promise.resolve({ uri: 'file:///resized.jpg', width: 10, height: 10 })),
}));

// The thumbnail's pixels (docs/thumbnails.md): a re-encode of the upload.
const mockManipulate = jest.fn((..._args: unknown[]) => Promise.resolve({ uri: 'file:///thumb.jpg', width: 480, height: 360 }));
jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: (...args: unknown[]) => mockManipulate(...args),
  SaveFormat: { JPEG: 'jpeg' },
}));

// Every upload reads its body through the one shared helper (native: file
// bytes via expo-file-system; web: fetch().blob()) — its own per-platform
// behavior is covered in `storage-read-upload.test.ts`.
const mockReadUploadBody = jest.fn((_uri: string, _options?: { maxBytes?: number }) => Promise.resolve('BLOB'));
jest.mock('../storage/readUpload', () => ({
  readUploadBody: (uri: string, options?: { maxBytes?: number }) => mockReadUploadBody(uri, options),
  UploadTooLargeError: class UploadTooLargeError extends Error {},
}));

// Video streams from disk through a signed upload URL; that route's own
// behavior is covered in `storage-upload-local-file.test.ts`.
const mockUploadLocalFile = jest.fn((_input: Record<string, unknown>) => Promise.resolve());
jest.mock('../storage/uploadLocalFile', () => ({
  uploadLocalFile: (input: Record<string, unknown>) => mockUploadLocalFile(input),
}));

import { clearSignedUrlCache } from '../storage/signedUrlCache';
import { getConversation, listConversations, startConversation } from '../api/conversations';
import {
  getMessageMedia,
  listMessages,
  listRecentlySharedMedia,
  markRead,
  sendMessage,
  MESSAGE_PAGE_SIZE,
  RECENTLY_SHARED_LIMIT,
} from '../api/messages';
import {
  CHAT_MEDIA_BUCKET,
  CHAT_MEDIA_LIMITED_BUCKET,
  chatMediaPath,
  chatMediaPosterPath,
  resendChatMedia,
  signedChatMediaUrls,
  uploadChatMedia,
  uploadChatMediaPoster,
} from '../api/chatMedia';

function callsFor(table: string): [string, unknown[]][] {
  return mockRecorded.filter((entry) => entry.table === table).flatMap((entry) => entry.calls);
}

function argsOf(table: string, method: string): unknown[] | undefined {
  return callsFor(table).find(([name]) => name === method)?.[1];
}

beforeEach(() => {
  mockRecorded.length = 0;
  mockQueued = {};
  mockStorageUpload.mockReset().mockResolvedValue({ error: null });
  mockStorageSignedUrls.mockReset();
  clearSignedUrlCache();
  mockRpc.mockReset();
  mockReadUploadBody.mockClear();
  mockUploadLocalFile.mockClear();
  mockManipulate.mockClear();
});

// ---------------------------------------------------------------------------

describe('listConversations', () => {
  const row = (overrides: Record<string, unknown> = {}) => ({
    id: CONV,
    user_a_id: ME,
    user_b_id: THEM,
    opened_by_id: ME,
    opened_via: 'first_message',
    state: 'open',
    blocked_by: null,
    last_message_at: '2026-09-20T11:00:00.000Z',
    created_at: '2026-09-20T10:00:00.000Z',
    messages: [
      {
        id: 'm1',
        conversation_id: CONV,
        sender_id: THEM,
        body: 'hey',
        media_path: null,
        created_at: '2026-09-20T11:00:00.000Z',
      },
    ],
    message_reads: [],
    ...overrides,
  });

  it('orders by last activity and limits the embedded messages to one per row', async () => {
    mockQueued = { conversations: { data: [row()], error: null } };
    await listConversations();

    const orders = callsFor('conversations').filter(([name]) => name === 'order');
    expect(orders[0]?.[1]).toEqual([
      'last_message_at',
      { ascending: false, nullsFirst: false },
    ]);
    // "Latest message per conversation" in one request: PostgREST applies a
    // referenced-table order + limit per parent row.
    expect(orders[1]?.[1]).toEqual([
      'created_at',
      { referencedTable: 'messages', ascending: false },
    ]);
    expect(argsOf('conversations', 'limit')).toEqual([1, { referencedTable: 'messages' }]);
  });

  it('selects only the column-granted profile fields, and position-0 photos', async () => {
    mockQueued = { conversations: { data: [row()], error: null } };
    await listConversations();

    // `profiles` is column-granted; anything outside that list fails the select.
    expect(argsOf('profiles', 'select')).toEqual(['id, first_name']);
    expect(argsOf('profiles', 'in')).toEqual(['id', [THEM]]);
    expect(argsOf('user_photos', 'eq')).toEqual(['position', 0]);
  });

  it('is one request per table regardless of list length — never N+1', async () => {
    const rows = ['c1', 'c2', 'c3', 'c4'].map((id) =>
      row({ id, user_b_id: `other-${id}`, messages: [], message_reads: [] })
    );
    mockQueued = { conversations: { data: rows, error: null } };
    await listConversations();

    expect(mockRecorded.filter((entry) => entry.table === 'conversations')).toHaveLength(1);
    expect(mockRecorded.filter((entry) => entry.table === 'profiles')).toHaveLength(1);
    expect(mockRecorded.filter((entry) => entry.table === 'user_photos')).toHaveLength(1);
  });

  it('selects the unread_count computed field with the row (migration 0017), in the same request', async () => {
    mockQueued = { conversations: { data: [row()], error: null } };
    await listConversations();
    const select = String(argsOf('conversations', 'select')?.[0] ?? '');
    expect(select).toMatch(/\bunread_count\b/);
    expect(mockRecorded.filter((entry) => entry.table === 'conversations')).toHaveLength(1);
  });

  it('takes the unread count from the server, not from the last message', async () => {
    mockQueued = { conversations: { data: [row({ unread_count: 3 })], error: null } };
    const [item] = await listConversations();
    expect(item!.unreadCount).toBe(3);
    expect(item!.lastReadAt).toBeNull();
    expect(item!.other.id).toBe(THEM);
  });

  it('reads a missing, zero or nonsense count as nothing unread', async () => {
    for (const unread_count of [undefined, null, 0, -2]) {
      mockQueued = { conversations: { data: [row({ unread_count })], error: null } };
      const [item] = await listConversations();
      expect(item!.unreadCount).toBe(0);
    }
  });

  it('has no client-side unread boolean any more (the server count replaces it)', async () => {
    mockQueued = {
      conversations: {
        data: [row({ unread_count: 0, message_reads: [{ user_id: ME, last_read_at: '2026-09-20T12:00:00.000Z' }] })],
        error: null,
      },
    };
    const [item] = await listConversations();
    expect(item).not.toHaveProperty('unread');
    expect(item!.lastReadAt).toBe('2026-09-20T12:00:00.000Z');
  });

  it('survives a refused profile row rather than dropping the conversation', async () => {
    mockQueued = {
      conversations: { data: [row()], error: null },
      profiles: { data: [], error: null },
      user_photos: { data: [], error: null },
    };
    const [item] = await listConversations();
    expect(item!.other).toEqual({ id: THEM, firstName: null, photoPath: null });
  });
});

describe('getConversation', () => {
  it('returns null for an unreadable row instead of throwing', async () => {
    mockQueued = { conversations: { data: null, error: null } };
    expect(await getConversation(CONV)).toBeNull();
  });
});

describe('startConversation', () => {
  it('calls the RPC and sends no message of its own', async () => {
    mockRpc.mockResolvedValue({ data: CONV, error: null });
    expect(await startConversation(THEM)).toBe(CONV);
    expect(mockRpc).toHaveBeenCalledWith('start_conversation', { p_recipient: THEM });
    expect(mockRecorded.some((entry) => entry.table === 'messages')).toBe(false);
  });
});

describe('listMessages', () => {
  it('reads one page newest-first, scoped to the conversation', async () => {
    mockQueued = { messages: { data: [], error: null } };
    await listMessages(CONV);

    expect(argsOf('messages', 'eq')).toEqual(['conversation_id', CONV]);
    expect(argsOf('messages', 'order')).toEqual(['created_at', { ascending: false }]);
    expect(argsOf('messages', 'limit')).toEqual([MESSAGE_PAGE_SIZE]);
    // No cursor on the first page.
    expect(callsFor('messages').some(([name]) => name === 'lt')).toBe(false);
  });

  it('pages with a keyset cursor, not an offset', async () => {
    mockQueued = { messages: { data: [], error: null } };
    await listMessages(CONV, '2026-09-20T10:00:00.000Z');
    expect(argsOf('messages', 'lt')).toEqual(['created_at', '2026-09-20T10:00:00.000Z']);
  });

  it('reports a next cursor only when the page was full', async () => {
    const full = Array.from({ length: MESSAGE_PAGE_SIZE }, (_, index) => ({
      id: `m${index}`,
      conversation_id: CONV,
      sender_id: THEM,
      body: 'x',
      media_path: null,
      created_at: `2026-09-20T10:00:${String(index).padStart(2, '0')}.000Z`,
    }));
    mockQueued = { messages: { data: full, error: null } };
    expect((await listMessages(CONV)).nextCursor).toBe(full[full.length - 1]!.created_at);

    mockQueued = { messages: { data: full.slice(0, 2), error: null } };
    expect((await listMessages(CONV)).nextCursor).toBeNull();
  });
});

describe('sendMessage', () => {
  it('sends only the client-settable columns, chat-media-plan §3 included', async () => {
    mockQueued = { messages: { data: { id: 'm1' }, error: null } };
    await sendMessage({ conversationId: CONV, body: 'hello' });

    const payload = argsOf('messages', 'insert')?.[0] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual([
      'body',
      'conversation_id',
      'id',
      'media_bytes',
      'media_duration_ms',
      'media_height',
      'media_kind',
      'media_path',
      'media_poster_path',
      'media_width',
      'sender_id',
      'view_limit',
    ]);
    // Ordering is server time, and `views_used` is only ever advanced by the
    // security-definer `open_limited_media` RPC — neither is client business.
    expect(payload).not.toHaveProperty('created_at');
    expect(payload).not.toHaveProperty('views_used');
    expect(payload.sender_id).toBe(ME);
    expect(payload.conversation_id).toBe(CONV);
    expect(payload.media_path).toBeNull();
    expect(payload.media_kind).toBeNull();
    expect(payload.view_limit).toBeNull();
  });

  it('sends each of the three view-limit choices with the matching media_kind columns', async () => {
    for (const viewLimit of [null, 1, 2] as const) {
      mockRecorded.length = 0;
      mockQueued = { messages: { data: { id: 'm1' }, error: null } };
      await sendMessage({
        conversationId: CONV,
        id: 'm1',
        mediaPath: `${CONV}/m1.jpg`,
        mediaKind: 'photo',
        viewLimit,
        mediaWidth: 800,
        mediaHeight: 600,
      });
      const payload = argsOf('messages', 'insert')?.[0] as Record<string, unknown>;
      expect(payload.view_limit).toBe(viewLimit);
      expect(payload.media_kind).toBe('photo');
      expect(payload.media_width).toBe(800);
      expect(payload.media_height).toBe(600);
    }
  });

  it('sends video columns — duration, bytes, and a poster path', async () => {
    mockQueued = { messages: { data: { id: 'm1' }, error: null } };
    await sendMessage({
      conversationId: CONV,
      id: 'm1',
      mediaPath: `${CONV}/m1.mp4`,
      mediaKind: 'video',
      viewLimit: null,
      mediaDurationMs: 12_000,
      mediaBytes: 4_000_000,
      mediaPosterPath: `${CONV}/m1-poster.jpg`,
    });
    const payload = argsOf('messages', 'insert')?.[0] as Record<string, unknown>;
    expect(payload.media_kind).toBe('video');
    expect(payload.media_duration_ms).toBe(12_000);
    expect(payload.media_bytes).toBe(4_000_000);
    expect(payload.media_poster_path).toBe(`${CONV}/m1-poster.jpg`);
  });

  it('uses a caller-supplied id so a media object can be addressed first', async () => {
    mockQueued = { messages: { data: { id: 'preset' }, error: null } };
    await sendMessage({ conversationId: CONV, id: 'preset', mediaPath: `${CONV}/preset.jpg` });

    const payload = argsOf('messages', 'insert')?.[0] as Record<string, unknown>;
    expect(payload.id).toBe('preset');
    expect(payload.media_path).toBe(`${CONV}/preset.jpg`);
    expect(payload.body).toBeNull();
  });

  it('maps a trigger refusal to the generic error with no sub-reason', async () => {
    mockQueued = {
      messages: {
        data: null,
        error: { code: '42501', message: 'not allowed' },
      },
    };
    await expect(sendMessage({ conversationId: CONV, body: 'x' })).rejects.toMatchObject({
      name: 'RefusedError',
    });
  });

  it('maps a bare-message trigger exception generically too', async () => {
    mockQueued = {
      messages: {
        data: null,
        error: { code: 'P0001', message: 'the opener already sent the first message; wait for a reply' },
      },
    };
    const error = await sendMessage({ conversationId: CONV, body: 'x' }).catch((e) => e);
    // The raw text never becomes UI copy.
    expect(error.message).toBe('Something went wrong. Please try again.');
  });
});

describe('markRead', () => {
  it('writes exactly the three columns the guard and policy allow', async () => {
    mockQueued = { message_reads: { data: null, error: null } };
    await markRead(CONV, { created_at: '2026-09-20T11:00:00.000Z' });

    const [payload, options] = argsOf('message_reads', 'upsert') as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(Object.keys(payload).sort()).toEqual([
      'conversation_id',
      'last_read_at',
      'user_id',
    ]);
    // `message_reads owner insert/update`: user_id must be me.
    expect(payload.user_id).toBe(ME);
    // `message_reads_guard()` keys on (user_id, conversation_id).
    expect(payload.conversation_id).toBe(CONV);
    expect(options).toEqual({ onConflict: 'user_id,conversation_id' });
  });

  it('uses the last message’s server timestamp, not a client clock', async () => {
    mockQueued = { message_reads: { data: null, error: null } };
    await markRead(CONV, { created_at: '2026-09-20T11:00:00.000Z' });
    const payload = argsOf('message_reads', 'upsert')?.[0] as Record<string, unknown>;
    expect(payload.last_read_at).toBe('2026-09-20T11:00:00.000Z');
  });

  it('falls back to now() when there is no message to point at', async () => {
    mockQueued = { message_reads: { data: null, error: null } };
    await markRead(CONV);
    const payload = argsOf('message_reads', 'upsert')?.[0] as Record<string, unknown>;
    expect(typeof payload.last_read_at).toBe('string');
  });
});

describe('chatMedia', () => {
  it('builds the exact path both storage policies parse', () => {
    expect(chatMediaPath(CONV, 'mmmm')).toBe(`${CONV}/mmmm.jpg`);
    // The policies regex-match segment 1 as a uuid before casting it.
    expect(chatMediaPath(CONV, 'mmmm').split('/')[0]).toBe(CONV);
  });

  it('uploads to chat-media as a jpeg, without upsert, and returns the path', async () => {
    const path = await uploadChatMedia({
      conversationId: CONV,
      messageId: 'mmmm',
      uri: 'file:///pick.jpg',
      width: 4000,
      height: 3000,
    });

    expect(path).toBe(`${CONV}/mmmm.jpg`);
    // The resized (EXIF-stripped) file is what gets read, never the original pick.
    expect(mockReadUploadBody).toHaveBeenCalledWith('file:///resized.jpg', undefined);
    expect(mockStorageUpload).toHaveBeenCalledWith('chat-media', `${CONV}/mmmm.jpg`, 'BLOB', {
      contentType: 'image/jpeg',
      upsert: false,
    });
  });

  it('uploads a kept photo’s thumbnail right after the original (480px, q0.7), upsert off', async () => {
    mockStorageUpload.mockResolvedValue({ error: null });
    await uploadChatMedia({ conversationId: CONV, messageId: 'mmmm', uri: 'file:///pick.jpg', width: 4000, height: 3000 });

    expect(mockStorageUpload.mock.calls.map((call) => [call[0], call[1]])).toEqual([
      ['chat-media', `${CONV}/mmmm.jpg`],
      ['chat-media', `${CONV}/mmmm.thumb.jpg`],
    ]);
    expect(mockStorageUpload.mock.calls[1][3]).toEqual({ contentType: 'image/jpeg', upsert: false });
    // From the resized upload (10x10 here: already under 480, so only re-encoded).
    expect(mockManipulate).toHaveBeenCalledWith('file:///resized.jpg', [], { compress: 0.7, format: 'jpeg' });
  });

  it('never makes a thumbnail for view-once / view-twice media', async () => {
    mockStorageUpload.mockResolvedValue({ error: null });
    await uploadChatMedia({
      conversationId: CONV,
      messageId: 'mmmm',
      uri: 'file:///pick.jpg',
      width: 10,
      height: 10,
      bucket: CHAT_MEDIA_LIMITED_BUCKET,
    });
    expect(mockStorageUpload).toHaveBeenCalledTimes(1);
    expect(mockManipulate).not.toHaveBeenCalled();
  });

  it('still returns the path when the thumbnail upload is refused', async () => {
    mockStorageUpload.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { message: 'refused' } });
    await expect(
      uploadChatMedia({ conversationId: CONV, messageId: 'mmmm', uri: 'file:///pick.jpg', width: 10, height: 10 })
    ).resolves.toBe(`${CONV}/mmmm.jpg`);
  });

  it('throws generically when the write policy refuses (thread not open)', async () => {
    mockStorageUpload.mockResolvedValue({ error: { message: 'new row violates row-level security policy' } });
    await expect(
      uploadChatMedia({ conversationId: CONV, messageId: 'm', uri: 'file:///a.jpg', width: 1, height: 1 })
    ).rejects.toBeTruthy();
  });

  it('degrades to "no URL" rather than an error when signing fails', async () => {
    mockStorageSignedUrls.mockResolvedValue({ data: null, error: { message: 'nope' } });
    expect(await signedChatMediaUrls([`${CONV}/m.jpg`])).toEqual({});
  });

  it('returns a path -> URL map for the paths that signed', async () => {
    mockStorageSignedUrls.mockResolvedValue({
      data: [
        { path: `${CONV}/a.jpg`, signedUrl: 'https://signed/a' },
        { path: `${CONV}/b.jpg`, signedUrl: null },
      ],
      error: null,
    });
    expect(await signedChatMediaUrls([`${CONV}/a.jpg`, `${CONV}/b.jpg`])).toEqual({
      [`${CONV}/a.jpg`]: 'https://signed/a',
    });
  });

  it('signs nothing for an empty list', async () => {
    expect(await signedChatMediaUrls([])).toEqual({});
    expect(mockStorageSignedUrls).not.toHaveBeenCalled();
  });

  it('builds an .mp4 path for a video, and a -poster.jpg path alongside it', () => {
    expect(chatMediaPath(CONV, 'mmmm', 'video')).toBe(`${CONV}/mmmm.mp4`);
    expect(chatMediaPosterPath(CONV, 'mmmm')).toBe(`${CONV}/mmmm-poster.jpg`);
  });

  it('uploads a video as-is (no resize step) with a video/mp4 content type', async () => {
    const path = await uploadChatMedia({
      conversationId: CONV,
      messageId: 'vid1',
      uri: 'file:///pick.mp4',
      width: 1080,
      height: 1920,
      kind: 'video',
    });

    expect(path).toBe(`${CONV}/vid1.mp4`);
    // Streamed from disk as-is (never read into JS memory), with the 50 MB
    // cap checked against the file before anything is sent.
    expect(mockUploadLocalFile).toHaveBeenCalledWith({
      bucket: 'chat-media',
      path: `${CONV}/vid1.mp4`,
      uri: 'file:///pick.mp4',
      contentType: 'video/mp4',
      maxBytes: 50 * 1024 * 1024,
    });
    expect(mockReadUploadBody).not.toHaveBeenCalled();
    expect(mockStorageUpload).not.toHaveBeenCalled();
  });

  it('uploads to chat-media-limited when a limited bucket is requested', async () => {
    await uploadChatMedia({
      conversationId: CONV,
      messageId: 'mmmm',
      uri: 'file:///pick.jpg',
      width: 10,
      height: 10,
      bucket: CHAT_MEDIA_LIMITED_BUCKET,
    });
    expect(mockStorageUpload).toHaveBeenCalledWith(
      'chat-media-limited',
      `${CONV}/mmmm.jpg`,
      'BLOB',
      expect.anything()
    );
  });

  it('uploads a poster frame to the same bucket, -poster.jpg suffix', async () => {
    const path = await uploadChatMediaPoster({ conversationId: CONV, messageId: 'vid1', uri: 'file:///poster.jpg' });
    expect(path).toBe(`${CONV}/vid1-poster.jpg`);
    expect(mockReadUploadBody).toHaveBeenCalledWith('file:///poster.jpg', undefined);
    expect(mockStorageUpload).toHaveBeenCalledWith('chat-media', `${CONV}/vid1-poster.jpg`, 'BLOB', {
      contentType: 'image/jpeg',
      upsert: false,
    });
  });

  it('uploads a kept video poster’s thumbnail after the poster, never one for limited', async () => {
    mockStorageUpload.mockResolvedValue({ error: null });
    await uploadChatMediaPoster({ conversationId: CONV, messageId: 'vid1', uri: 'file:///poster.jpg' });
    expect(mockStorageUpload.mock.calls.map((call) => call[1])).toEqual([`${CONV}/vid1-poster.jpg`, `${CONV}/vid1-poster.thumb.jpg`]);

    mockStorageUpload.mockClear();
    await uploadChatMediaPoster({ conversationId: CONV, messageId: 'vid2', uri: 'file:///poster.jpg', bucket: CHAT_MEDIA_LIMITED_BUCKET });
    expect(mockStorageUpload).toHaveBeenCalledTimes(1);
  });

  describe('resendChatMedia — the recently-shared tray’s resend (CM-2)', () => {
    it('copies the source thumbnail to a kept target after the original', async () => {
      mockStorageUpload.mockResolvedValue({ error: null });
      mockStorageSignedUrls.mockImplementation((_bucket: string, paths: string[]) =>
        Promise.resolve({ data: paths.map((path) => ({ path, signedUrl: `https://signed/${path}` })), error: null })
      );
      await resendChatMedia({
        sourcePath: `${CONV}/orig.jpg`,
        targetConversationId: 'new-conv',
        targetMessageId: 'new-msg',
        kind: 'photo',
        viewLimit: null,
      });
      expect(mockStorageUpload.mock.calls.map((call) => call[1])).toEqual(['new-conv/new-msg.jpg', 'new-conv/new-msg.thumb.jpg']);
      expect(mockReadUploadBody).toHaveBeenCalledWith(`https://signed/${CONV}/orig.thumb.jpg`, undefined);
    });

    it('copies a video’s poster thumbnail, not the mp4’s', async () => {
      mockStorageUpload.mockResolvedValue({ error: null });
      mockStorageSignedUrls.mockImplementation((_bucket: string, paths: string[]) =>
        Promise.resolve({ data: paths.map((path) => ({ path, signedUrl: `https://signed/${path}` })), error: null })
      );
      await resendChatMedia({
        sourcePath: `${CONV}/orig.mp4`,
        sourcePosterPath: `${CONV}/orig-poster.jpg`,
        targetConversationId: 'new-conv',
        targetMessageId: 'new-msg',
        kind: 'video',
        viewLimit: null,
      });
      expect(mockStorageUpload.mock.calls.map((call) => call[1])).toEqual([
        'new-conv/new-msg.mp4',
        'new-conv/new-msg-poster.jpg',
        'new-conv/new-msg-poster.thumb.jpg',
      ]);
    });

    it('never copies a thumbnail to a view-limited target', async () => {
      mockStorageUpload.mockResolvedValue({ error: null });
      mockStorageSignedUrls.mockImplementation((_bucket: string, paths: string[]) =>
        Promise.resolve({ data: paths.map((path) => ({ path, signedUrl: `https://signed/${path}` })), error: null })
      );
      await resendChatMedia({
        sourcePath: `${CONV}/orig.jpg`,
        targetConversationId: 'new-conv',
        targetMessageId: 'new-msg',
        kind: 'photo',
        viewLimit: 1,
      });
      expect(mockStorageUpload).toHaveBeenCalledTimes(1);
      expect(mockStorageSignedUrls).not.toHaveBeenCalledWith(CHAT_MEDIA_BUCKET, [`${CONV}/orig.thumb.jpg`], 600);
    });

    it('skips silently when the source has no thumbnail', async () => {
      mockStorageUpload.mockResolvedValue({ error: null });
      mockStorageSignedUrls.mockImplementation((_bucket: string, paths: string[]) =>
        Promise.resolve({
          data: paths.filter((path) => !path.endsWith('.thumb.jpg')).map((path) => ({ path, signedUrl: `https://signed/${path}` })),
          error: null,
        })
      );
      await expect(
        resendChatMedia({
          sourcePath: `${CONV}/orig.jpg`,
          targetConversationId: 'new-conv',
          targetMessageId: 'new-msg',
          kind: 'photo',
          viewLimit: null,
        })
      ).resolves.toEqual({ mediaPath: 'new-conv/new-msg.jpg', posterPath: null });
      expect(mockStorageUpload).toHaveBeenCalledTimes(1);
    });

    beforeEach(() => {
      mockStorageSignedUrls.mockResolvedValue({
        data: [
          { path: `${CONV}/orig.jpg`, signedUrl: 'https://signed/orig.jpg' },
          { path: `${CONV}/orig.mp4`, signedUrl: 'https://signed/orig.mp4' },
          { path: `${CONV}/orig-poster.jpg`, signedUrl: 'https://signed/orig-poster.jpg' },
        ],
        error: null,
      });
    });

    it('signs the source from chat-media only, never chat-media-limited', async () => {
      await resendChatMedia({
        sourcePath: `${CONV}/orig.jpg`,
        targetConversationId: 'new-conv',
        targetMessageId: 'new-msg',
        kind: 'photo',
        viewLimit: null,
      });
      expect(mockStorageSignedUrls).toHaveBeenCalledWith(CHAT_MEDIA_BUCKET, [`${CONV}/orig.jpg`], 600);
    });

    it('uploads a keep-in-chat resend to chat-media, at the new conversation/message path', async () => {
      const result = await resendChatMedia({
        sourcePath: `${CONV}/orig.jpg`,
        targetConversationId: 'new-conv',
        targetMessageId: 'new-msg',
        kind: 'photo',
        viewLimit: null,
      });
      expect(result.mediaPath).toBe('new-conv/new-msg.jpg');
      // Bytes come from the signed source URL, not a blob round trip.
      expect(mockReadUploadBody).toHaveBeenCalledWith('https://signed/orig.jpg', {});
      expect(mockStorageUpload).toHaveBeenCalledWith('chat-media', 'new-conv/new-msg.jpg', 'BLOB', {
        contentType: 'image/jpeg',
        upsert: false,
      });
    });

    it('uploads a limited resend (view once/twice) to chat-media-limited instead', async () => {
      const result = await resendChatMedia({
        sourcePath: `${CONV}/orig.jpg`,
        targetConversationId: 'new-conv',
        targetMessageId: 'new-msg',
        kind: 'photo',
        viewLimit: 1,
      });
      expect(result.mediaPath).toBe('new-conv/new-msg.jpg');
      expect(mockStorageUpload).toHaveBeenCalledWith('chat-media-limited', 'new-conv/new-msg.jpg', 'BLOB', {
        contentType: 'image/jpeg',
        upsert: false,
      });
    });

    it('also copies a video’s poster when one is given', async () => {
      const result = await resendChatMedia({
        sourcePath: `${CONV}/orig.mp4`,
        sourcePosterPath: `${CONV}/orig-poster.jpg`,
        targetConversationId: 'new-conv',
        targetMessageId: 'new-msg',
        kind: 'video',
        viewLimit: 2,
      });
      expect(result.posterPath).toBe('new-conv/new-msg-poster.jpg');
      expect(mockReadUploadBody).toHaveBeenCalledWith('https://signed/orig.mp4', { maxBytes: 50 * 1024 * 1024 });
      expect(mockReadUploadBody).toHaveBeenCalledWith('https://signed/orig-poster.jpg', undefined);
      expect(mockStorageUpload).toHaveBeenCalledWith(
        'chat-media-limited',
        'new-conv/new-msg-poster.jpg',
        'BLOB',
        expect.objectContaining({ contentType: 'image/jpeg' })
      );
    });

    it('throws generically when the source no longer signs (thread purged, block, etc.)', async () => {
      mockStorageSignedUrls.mockResolvedValue({ data: [], error: null });
      await expect(
        resendChatMedia({
          sourcePath: `${CONV}/orig.jpg`,
          targetConversationId: 'new-conv',
          targetMessageId: 'new-msg',
          kind: 'photo',
          viewLimit: null,
        })
      ).rejects.toBeTruthy();
    });
  });
});

describe('getMessageMedia', () => {
  it('reads one message by id, every media column included', async () => {
    mockQueued = { messages: { data: { id: 'm1' }, error: null } };
    await getMessageMedia('m1');
    expect(argsOf('messages', 'eq')).toEqual(['id', 'm1']);
    expect((argsOf('messages', 'select')?.[0] as string)).toContain('media_kind');
  });

  it('returns null for an unreadable/missing row instead of throwing', async () => {
    mockQueued = { messages: { data: null, error: null } };
    expect(await getMessageMedia('gone')).toBeNull();
  });
});

describe('listRecentlySharedMedia', () => {
  const trayRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'm1',
    conversation_id: CONV,
    media_path: `${CONV}/m1.jpg`,
    media_kind: 'photo',
    media_width: 800,
    media_height: 600,
    media_poster_path: null,
    created_at: '2026-09-20T11:00:00.000Z',
    ...overrides,
  });

  it('scopes to my own keep-in-chat sends only (CM-7)', async () => {
    mockQueued = { messages: { data: [trayRow()], error: null } };
    await listRecentlySharedMedia();

    expect(argsOf('messages', 'eq')).toEqual(['sender_id', ME]);
    expect(argsOf('messages', 'not')).toEqual(['media_path', 'is', null]);
    expect(argsOf('messages', 'is')).toEqual(['view_limit', null]);
    expect(argsOf('messages', 'order')).toEqual(['created_at', { ascending: false }]);
  });

  it('de-duplicates by media_path to the newest 30 distinct items', async () => {
    const rows = Array.from({ length: 40 }, (_, i) =>
      trayRow({ id: `m${i}`, media_path: `${CONV}/${i % 20}.jpg` })
    );
    mockQueued = { messages: { data: rows, error: null } };
    const items = await listRecentlySharedMedia();

    expect(items.length).toBe(RECENTLY_SHARED_LIMIT <= 20 ? RECENTLY_SHARED_LIMIT : 20);
    const paths = items.map((item) => item.mediaPath);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('maps every column the tray needs', async () => {
    mockQueued = { messages: { data: [trayRow({ media_kind: 'video', media_poster_path: `${CONV}/m1-poster.jpg` })], error: null } };
    const [item] = await listRecentlySharedMedia();
    expect(item).toEqual({
      messageId: 'm1',
      conversationId: CONV,
      mediaPath: `${CONV}/m1.jpg`,
      mediaKind: 'video',
      mediaWidth: 800,
      mediaHeight: 600,
      mediaPosterPath: `${CONV}/m1-poster.jpg`,
      createdAt: '2026-09-20T11:00:00.000Z',
    });
  });
});
