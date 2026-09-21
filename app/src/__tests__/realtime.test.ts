jest.mock('../api/client', () => ({ supabase: {}, SUPABASE_URL: 'https://example.test' }));

import { RealtimeManager, parseHereNowPayload } from '../realtime';

type BroadcastHandler = (message: unknown) => void;

interface FakeChannel {
  on: jest.Mock;
  subscribe: jest.Mock;
}

function makeClient() {
  const handlers: Record<string, BroadcastHandler> = {};
  let subscribeCallback: ((status: string) => void) | null = null;

  const channel: FakeChannel = {
    on: jest.fn((type: string, filter: { event: string }, handler: BroadcastHandler) => {
      handlers[`${type}:${filter.event}`] = handler;
      return channel;
    }),
    subscribe: jest.fn((callback: (status: string) => void) => {
      subscribeCallback = callback;
      return channel;
    }),
  };

  const client = {
    channel: jest.fn(() => channel),
    removeChannel: jest.fn(() => Promise.resolve('ok')),
    realtime: { setAuth: jest.fn(() => Promise.resolve()) },
  };

  return {
    client,
    channel,
    emitBroadcast: (message: unknown) => handlers['broadcast:here_now']?.(message),
    emitStatus: (status: string) => subscribeCallback?.(status),
  };
}

const CAMPUS = '11111111-2222-3333-4444-555555555555';

describe('parseHereNowPayload', () => {
  it('reads the trigger payload shape', () => {
    expect(parseHereNowPayload({ payload: { user_id: 'u1', here_now: true } })).toEqual({
      user_id: 'u1',
      here_now: true,
    });
  });

  it('reads the doubly-wrapped shape too', () => {
    expect(
      parseHereNowPayload({ payload: { payload: { user_id: 'u2', here_now: false } } })
    ).toEqual({ user_id: 'u2', here_now: false });
  });

  it.each([
    ['null', null],
    ['no payload', {}],
    ['missing user_id', { payload: { here_now: true } }],
    ['non-boolean here_now', { payload: { user_id: 'u1', here_now: 'yes' } }],
    ['non-string user_id', { payload: { user_id: 7, here_now: true } }],
  ])('returns null for %s', (_label, message) => {
    expect(parseHereNowPayload(message)).toBeNull();
  });
});

describe('RealtimeManager', () => {
  it('subscribes to the campus presence topic as a private channel', () => {
    const { client } = makeClient();
    const manager = new RealtimeManager(client as never);

    manager.subscribeCampusPresence(CAMPUS, { onHereNow: jest.fn() });

    expect(client.channel).toHaveBeenCalledWith(`presence:campus:${CAMPUS}`, {
      config: { private: true },
    });
    // The `campus presence topic` policy needs auth.uid(), so the socket's
    // token has to be set before the join.
    expect(client.realtime.setAuth).toHaveBeenCalled();
    expect(manager.currentTopic()).toBe(`presence:campus:${CAMPUS}`);
  });

  it('listens for the here_now broadcast event only', () => {
    const { client, channel } = makeClient();
    new RealtimeManager(client as never).subscribeCampusPresence(CAMPUS, { onHereNow: jest.fn() });

    expect(channel.on).toHaveBeenCalledTimes(1);
    expect(channel.on).toHaveBeenCalledWith('broadcast', { event: 'here_now' }, expect.any(Function));
  });

  it('forwards well-formed events and swallows malformed ones', () => {
    const { client, emitBroadcast } = makeClient();
    const onHereNow = jest.fn();
    new RealtimeManager(client as never).subscribeCampusPresence(CAMPUS, { onHereNow });

    emitBroadcast({ payload: { user_id: 'u1', here_now: true } });
    emitBroadcast({ payload: { nonsense: true } });

    expect(onHereNow).toHaveBeenCalledTimes(1);
    expect(onHereNow).toHaveBeenCalledWith({ user_id: 'u1', here_now: true });
  });

  it('signals an invalidation on every successful subscribe', () => {
    const { client, emitStatus } = makeClient();
    const onInvalidate = jest.fn();
    const onStatusChange = jest.fn();
    new RealtimeManager(client as never).subscribeCampusPresence(CAMPUS, {
      onHereNow: jest.fn(),
      onInvalidate,
      onStatusChange,
    });

    emitStatus('SUBSCRIBED');
    expect(onInvalidate).toHaveBeenCalledWith('subscribed');
    expect(onStatusChange).toHaveBeenCalledWith('subscribed');

    emitStatus('CHANNEL_ERROR');
    expect(onStatusChange).toHaveBeenLastCalledWith('error');
    emitStatus('CLOSED');
    expect(onStatusChange).toHaveBeenLastCalledWith('closed');
    // Only the successful join invalidates.
    expect(onInvalidate).toHaveBeenCalledTimes(1);
  });

  it('invalidates on foreground reconnect and refreshes the socket token', () => {
    const { client } = makeClient();
    const onInvalidate = jest.fn();
    const manager = new RealtimeManager(client as never);
    manager.subscribeCampusPresence(CAMPUS, { onHereNow: jest.fn(), onInvalidate });
    client.realtime.setAuth.mockClear();

    manager.reconnect();

    expect(client.realtime.setAuth).toHaveBeenCalledTimes(1);
    expect(onInvalidate).toHaveBeenCalledWith('foreground');
  });

  it('reuses the channel when re-subscribing to the same campus', () => {
    const { client } = makeClient();
    const manager = new RealtimeManager(client as never);

    manager.subscribeCampusPresence(CAMPUS, { onHereNow: jest.fn() });
    const second = jest.fn();
    manager.subscribeCampusPresence(CAMPUS, { onHereNow: second });

    expect(client.channel).toHaveBeenCalledTimes(1);
    expect(client.removeChannel).not.toHaveBeenCalled();
  });

  it('tears the old channel down when the campus changes', () => {
    const { client } = makeClient();
    const manager = new RealtimeManager(client as never);

    manager.subscribeCampusPresence(CAMPUS, { onHereNow: jest.fn() });
    manager.subscribeCampusPresence('99999999-8888-7777-6666-555555555555', {
      onHereNow: jest.fn(),
    });

    expect(client.removeChannel).toHaveBeenCalledTimes(1);
    expect(client.channel).toHaveBeenCalledTimes(2);
  });

  it('unsubscribes, stops delivering, and clears the topic', () => {
    const { client, emitBroadcast } = makeClient();
    const onHereNow = jest.fn();
    const manager = new RealtimeManager(client as never);
    const unsubscribe = manager.subscribeCampusPresence(CAMPUS, { onHereNow });

    unsubscribe();

    expect(client.removeChannel).toHaveBeenCalledTimes(1);
    expect(manager.currentTopic()).toBeNull();
    emitBroadcast({ payload: { user_id: 'u1', here_now: true } });
    expect(onHereNow).not.toHaveBeenCalled();
  });

  it('unsubscribing twice is harmless', () => {
    const { client } = makeClient();
    const manager = new RealtimeManager(client as never);
    const unsubscribe = manager.subscribeCampusPresence(CAMPUS, { onHereNow: jest.fn() });
    unsubscribe();
    unsubscribe();
    expect(client.removeChannel).toHaveBeenCalledTimes(1);
  });
});
