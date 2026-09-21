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

const globalAny = globalThis as unknown as { fetch: jest.Mock };
globalAny.fetch = jest.fn(() => Promise.resolve({ blob: () => Promise.resolve('BLOB') })) as never;

import { getConversation, listConversations, startConversation } from '../api/conversations';
import { listMessages, markRead, sendMessage, MESSAGE_PAGE_SIZE } from '../api/messages';
import { chatMediaPath, signedChatMediaUrls, uploadChatMedia } from '../api/chatMedia';

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
  mockRpc.mockReset();
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

  it('marks a thread unread when they spoke last and I never read it', async () => {
    mockQueued = { conversations: { data: [row()], error: null } };
    const [item] = await listConversations();
    expect(item!.unread).toBe(true);
    expect(item!.lastReadAt).toBeNull();
    expect(item!.other.id).toBe(THEM);
  });

  it('is read once my message_reads row is newer than the last message', async () => {
    mockQueued = {
      conversations: {
        data: [
          row({
            message_reads: [{ user_id: ME, last_read_at: '2026-09-20T12:00:00.000Z' }],
          }),
        ],
        error: null,
      },
    };
    const [item] = await listConversations();
    expect(item!.unread).toBe(false);
  });

  it('never counts my own message as unread', async () => {
    mockQueued = {
      conversations: {
        data: [
          row({
            messages: [
              {
                id: 'm1',
                conversation_id: CONV,
                sender_id: ME,
                body: 'mine',
                media_path: null,
                created_at: '2026-09-20T11:00:00.000Z',
              },
            ],
          }),
        ],
        error: null,
      },
    };
    const [item] = await listConversations();
    expect(item!.unread).toBe(false);
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
  it('sends only the five client-settable columns', async () => {
    mockQueued = { messages: { data: { id: 'm1' }, error: null } };
    await sendMessage({ conversationId: CONV, body: 'hello' });

    const payload = argsOf('messages', 'insert')?.[0] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual([
      'body',
      'conversation_id',
      'id',
      'media_path',
      'sender_id',
    ]);
    // Ordering is server time: a client clock would reorder the thread.
    expect(payload).not.toHaveProperty('created_at');
    expect(payload.sender_id).toBe(ME);
    expect(payload.conversation_id).toBe(CONV);
    expect(payload.media_path).toBeNull();
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
    expect(mockStorageUpload).toHaveBeenCalledWith('chat-media', `${CONV}/mmmm.jpg`, 'BLOB', {
      contentType: 'image/jpeg',
      upsert: false,
    });
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
});
