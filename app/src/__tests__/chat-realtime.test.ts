jest.mock('../api/client', () => ({ supabase: {}, SUPABASE_URL: 'https://example.test' }));

import { RealtimeManager, parseMessagePayload } from '../realtime';

type ChangeHandler = (message: unknown) => void;

const CONV_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const CONV_B = 'bbbbbbbb-0000-4000-8000-000000000002';

function makeClient() {
  const handlers: ChangeHandler[] = [];
  const statusCallbacks: ((status: string) => void)[] = [];
  const filters: Record<string, unknown>[] = [];
  const topics: string[] = [];

  const makeChannel = () => {
    const channel: Record<string, unknown> = {};
    channel.on = jest.fn((type: string, filter: Record<string, unknown>, handler: ChangeHandler) => {
      filters.push({ type, ...filter });
      handlers.push(handler);
      return channel;
    });
    channel.subscribe = jest.fn((callback: (status: string) => void) => {
      statusCallbacks.push(callback);
      return channel;
    });
    return channel;
  };

  const client = {
    channel: jest.fn((topic: string) => {
      topics.push(topic);
      return makeChannel();
    }),
    removeChannel: jest.fn(() => Promise.resolve('ok')),
    realtime: { setAuth: jest.fn(() => Promise.resolve()) },
  };

  return {
    client,
    topics,
    filters,
    emit: (index: number, message: unknown) => handlers[index]?.(message),
    emitStatus: (index: number, status: string) => statusCallbacks[index]?.(status),
  };
}

const insert = (overrides: Record<string, unknown> = {}) => ({
  new: {
    id: 'm1',
    conversation_id: CONV_A,
    sender_id: 'sender',
    body: 'hey',
    media_path: null,
    created_at: '2026-09-20T11:00:00.000Z',
    ...overrides,
  },
});

describe('parseMessagePayload', () => {
  it('reads a postgres_changes INSERT record', () => {
    expect(parseMessagePayload(insert())).toEqual({
      id: 'm1',
      conversation_id: CONV_A,
      sender_id: 'sender',
      body: 'hey',
      media_path: null,
      created_at: '2026-09-20T11:00:00.000Z',
    });
  });

  it('normalises a media-only row', () => {
    const event = parseMessagePayload(insert({ body: null, media_path: `${CONV_A}/m1.jpg` }));
    expect(event).toMatchObject({ body: null, media_path: `${CONV_A}/m1.jpg` });
  });

  it.each([
    ['null', null],
    ['no record', {}],
    ['missing id', insert({ id: undefined })],
    ['missing conversation_id', insert({ conversation_id: undefined })],
    ['missing sender_id', insert({ sender_id: 7 })],
    ['missing created_at', insert({ created_at: null })],
  ])('returns null for %s', (_label, message) => {
    expect(parseMessagePayload(message)).toBeNull();
  });
});

describe('RealtimeManager — per-thread subscriptions', () => {
  it('subscribes to messages inserts filtered by conversation_id', () => {
    const { client, topics, filters } = makeClient();
    const manager = new RealtimeManager(client as never);

    manager.subscribeConversation(CONV_A, { onMessage: jest.fn() });

    expect(topics).toEqual([`messages:conversation:${CONV_A}`]);
    expect(filters[0]).toEqual({
      type: 'postgres_changes',
      event: 'INSERT',
      schema: 'public',
      table: 'messages',
      filter: `conversation_id=eq.${CONV_A}`,
    });
    // postgres_changes applies the select policy per subscriber, which needs
    // the socket's token.
    expect(client.realtime.setAuth).toHaveBeenCalled();
  });

  it('is not a private channel — private governs broadcast, not replication', () => {
    const { client } = makeClient();
    new RealtimeManager(client as never).subscribeConversation(CONV_A, { onMessage: jest.fn() });
    expect(client.channel).toHaveBeenCalledWith(`messages:conversation:${CONV_A}`);
  });

  it('forwards well-formed inserts and swallows malformed ones', () => {
    const { client, emit } = makeClient();
    const onMessage = jest.fn();
    new RealtimeManager(client as never).subscribeConversation(CONV_A, { onMessage });

    emit(0, insert());
    emit(0, { new: { nonsense: true } });

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }));
  });

  it('signals an invalidation on every successful (re)subscribe', () => {
    const { client, emitStatus } = makeClient();
    const onInvalidate = jest.fn();
    const onStatusChange = jest.fn();
    new RealtimeManager(client as never).subscribeConversation(CONV_A, {
      onMessage: jest.fn(),
      onInvalidate,
      onStatusChange,
    });

    emitStatus(0, 'SUBSCRIBED');
    expect(onInvalidate).toHaveBeenCalledWith('subscribed');
    expect(onStatusChange).toHaveBeenCalledWith('subscribed');

    emitStatus(0, 'CHANNEL_ERROR');
    expect(onStatusChange).toHaveBeenLastCalledWith('error');
    emitStatus(0, 'CLOSED');
    expect(onStatusChange).toHaveBeenLastCalledWith('closed');
    expect(onInvalidate).toHaveBeenCalledTimes(1);
  });

  it('holds one channel per conversation and swaps handlers on re-subscribe', () => {
    const { client } = makeClient();
    const manager = new RealtimeManager(client as never);

    manager.subscribeConversation(CONV_A, { onMessage: jest.fn() });
    manager.subscribeConversation(CONV_B, { onMessage: jest.fn() });
    manager.subscribeConversation(CONV_A, { onMessage: jest.fn() });

    expect(client.channel).toHaveBeenCalledTimes(2);
    expect(manager.conversationTopics()).toEqual([
      `messages:conversation:${CONV_A}`,
      `messages:conversation:${CONV_B}`,
    ]);
  });

  it('unsubscribes one thread without touching the other', () => {
    const { client, emit } = makeClient();
    const manager = new RealtimeManager(client as never);
    const onA = jest.fn();
    const onB = jest.fn();

    const stopA = manager.subscribeConversation(CONV_A, { onMessage: onA });
    manager.subscribeConversation(CONV_B, { onMessage: onB });

    stopA();

    expect(client.removeChannel).toHaveBeenCalledTimes(1);
    expect(manager.conversationTopics()).toEqual([`messages:conversation:${CONV_B}`]);

    emit(0, insert());
    expect(onA).not.toHaveBeenCalled();
    emit(1, insert({ conversation_id: CONV_B }));
    expect(onB).toHaveBeenCalledTimes(1);
  });

  it('unsubscribing twice is harmless', () => {
    const { client } = makeClient();
    const manager = new RealtimeManager(client as never);
    const stop = manager.subscribeConversation(CONV_A, { onMessage: jest.fn() });
    stop();
    stop();
    expect(client.removeChannel).toHaveBeenCalledTimes(1);
  });
});

describe('RealtimeManager — list-level subscription', () => {
  it('subscribes to every messages insert with no filter; RLS is the filter', () => {
    const { client, topics, filters } = makeClient();
    new RealtimeManager(client as never).subscribeMessageList({ onMessage: jest.fn() });

    expect(topics).toEqual(['messages:list']);
    expect(filters[0]).toEqual({
      type: 'postgres_changes',
      event: 'INSERT',
      schema: 'public',
      table: 'messages',
    });
    expect(filters[0]).not.toHaveProperty('filter');
  });

  it('keeps exactly one list channel', () => {
    const { client } = makeClient();
    const manager = new RealtimeManager(client as never);
    manager.subscribeMessageList({ onMessage: jest.fn() });
    manager.subscribeMessageList({ onMessage: jest.fn() });
    expect(client.channel).toHaveBeenCalledTimes(1);
  });

  it('delivers to the newest handler after a re-subscribe', () => {
    const { client, emit } = makeClient();
    const manager = new RealtimeManager(client as never);
    const first = jest.fn();
    const second = jest.fn();

    manager.subscribeMessageList({ onMessage: first });
    manager.subscribeMessageList({ onMessage: second });
    emit(0, insert());

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('stops delivering after unsubscribe', () => {
    const { client, emit } = makeClient();
    const manager = new RealtimeManager(client as never);
    const onMessage = jest.fn();
    const stop = manager.subscribeMessageList({ onMessage });

    stop();
    emit(0, insert());

    expect(client.removeChannel).toHaveBeenCalledTimes(1);
    expect(onMessage).not.toHaveBeenCalled();
  });
});

describe('RealtimeManager — foreground and teardown', () => {
  it('invalidates every chat subscriber on foreground reconnect', () => {
    const { client } = makeClient();
    const manager = new RealtimeManager(client as never);
    const threadInvalidate = jest.fn();
    const listInvalidate = jest.fn();

    manager.subscribeConversation(CONV_A, { onMessage: jest.fn(), onInvalidate: threadInvalidate });
    manager.subscribeMessageList({ onMessage: jest.fn(), onInvalidate: listInvalidate });
    client.realtime.setAuth.mockClear();

    manager.reconnect();

    expect(client.realtime.setAuth).toHaveBeenCalledTimes(1);
    expect(threadInvalidate).toHaveBeenCalledWith('foreground');
    expect(listInvalidate).toHaveBeenCalledWith('foreground');
  });

  it('unsubscribeAll tears down presence, threads and the list together', () => {
    const { client } = makeClient();
    const manager = new RealtimeManager(client as never);

    manager.subscribeCampusPresence('11111111-2222-3333-4444-555555555555', {
      onHereNow: jest.fn(),
    });
    manager.subscribeConversation(CONV_A, { onMessage: jest.fn() });
    manager.subscribeConversation(CONV_B, { onMessage: jest.fn() });
    manager.subscribeMessageList({ onMessage: jest.fn() });

    manager.unsubscribeAll();

    expect(client.removeChannel).toHaveBeenCalledTimes(4);
    expect(manager.currentTopic()).toBeNull();
    expect(manager.conversationTopics()).toEqual([]);
  });

  it('leaves campus presence alone when only a thread unsubscribes', () => {
    const { client } = makeClient();
    const manager = new RealtimeManager(client as never);
    const campus = '11111111-2222-3333-4444-555555555555';

    manager.subscribeCampusPresence(campus, { onHereNow: jest.fn() });
    const stop = manager.subscribeConversation(CONV_A, { onMessage: jest.fn() });
    stop();

    expect(manager.currentTopic()).toBe(`presence:campus:${campus}`);
  });
});
