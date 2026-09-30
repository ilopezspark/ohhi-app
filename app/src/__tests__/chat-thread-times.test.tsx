import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Send times, day separators and the typing indicator in the thread (owner
 * ruling, 30 September 2026). "Now" is pinned to Wednesday 30 September
 * 2026, 3:00 pm local time; only `Date` is faked until a test needs timers.
 */

const CONV = 'cccccccc-0000-4000-8000-000000000003';
const ME = 'aaaaaaaa-0000-4000-8000-000000000001';
const THEM = 'bbbbbbbb-0000-4000-8000-000000000002';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) },
  useLocalSearchParams: () => ({ id: 'cccccccc-0000-4000-8000-000000000003' }),
  useFocusEffect: (cb: () => void) => {
    const { useEffect } = jest.requireActual('react');
    useEffect(() => cb(), [cb]);
  },
}));

// A fake supabase-js client for the typing channel only (`chat/useTyping.ts`).
interface FakeChannel {
  topic: string;
  options: unknown;
  broadcast: ((message: unknown) => void) | null;
  status: ((status: string) => void) | null;
  on: jest.Mock;
  subscribe: jest.Mock;
  send: jest.Mock;
}
const mockClient = {
  channels: [] as FakeChannel[],
  joinStatus: 'SUBSCRIBED',
  sendResult: (): Promise<unknown> => Promise.resolve('ok'),
  channel: jest.fn(),
  removeChannel: jest.fn(() => Promise.resolve('ok')),
  realtime: { setAuth: jest.fn(() => Promise.resolve()) },
};
jest.mock('../api/client', () => ({
  get supabase() {
    return mockClient;
  },
  SUPABASE_URL: 'https://example.test',
}));
jest.mock('../api/conversations', () => ({ getConversation: jest.fn() }));
jest.mock('../api/messages', () => ({
  listMessages: jest.fn(),
  listRecentlySharedMedia: jest.fn(),
  markRead: jest.fn(),
  sendMessage: jest.fn(),
}));
jest.mock('../api/chatMedia', () => ({
  CHAT_MEDIA_BUCKET: 'chat-media',
  CHAT_MEDIA_LIMITED_BUCKET: 'chat-media-limited',
  resendChatMedia: jest.fn(),
  signedChatMediaUrls: jest.fn(),
  uploadChatMedia: jest.fn(),
  uploadChatMediaPoster: jest.fn(),
}));
jest.mock('../api/me', () => ({ me: jest.fn() }));
jest.mock('../api/photos', () => ({ signedPhotoUrls: jest.fn() }));
jest.mock('../api/albums', () => ({ listMyAlbums: jest.fn(), getAlbum: jest.fn() }));
jest.mock('../api/shares', () => ({
  shareAlbum: jest.fn(),
  shareCard: jest.fn(),
  listSharesForSubject: jest.fn(() => Promise.resolve([])),
  shareCardSections: jest.fn(() => []),
}));
jest.mock('../api/identity', () => ({ getCard: jest.fn(), revealCardSection: jest.fn() }));
jest.mock('../chat/shareFeed', () => ({ listShareFeed: jest.fn(() => Promise.resolve([])) }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('../chat/video', () => ({
  checkVideo: jest.fn(() => ({ ok: true })),
  VIDEO_REJECTION_COPY: { duration: 'too long', size: 'too big' },
  generateVideoPoster: jest.fn(() => Promise.resolve(null)),
}));

let threadHandlers: { onMessage: (m: unknown) => void; onInvalidate?: () => void } | null = null;
jest.mock('../chat/useChatRealtime', () => ({
  useConversationRealtime: (_id: string, options: never) => {
    threadHandlers = options;
  },
}));

import { router } from 'expo-router';
import { getConversation } from '../api/conversations';
import { listMessages, markRead, sendMessage } from '../api/messages';
import { signedChatMediaUrls } from '../api/chatMedia';
import { me } from '../api/me';
import { signedPhotoUrls } from '../api/photos';
import { listShareFeed } from '../chat/shareFeed';
import { formatMessageTime } from '../chat/time';
import ChatThreadScreen from '../app/chat/[id]';

const NOW = new Date(2026, 8, 30, 15, 0, 0);
/** Local wall-clock time on a day in September 2026, as the ISO string the server sends. */
const at = (day: number, hour: number, minute = 0, month = 8, year = 2026) =>
  new Date(year, month, day, hour, minute).toISOString();

/** Fakes `Date` only: promises, timers and React Query run for real. */
const DATE_ONLY = [
  'hrtime',
  'nextTick',
  'performance',
  'queueMicrotask',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'requestIdleCallback',
  'cancelIdleCallback',
  'setImmediate',
  'clearImmediate',
  'setInterval',
  'clearInterval',
  'setTimeout',
  'clearTimeout',
] as const;

const conversation = (overrides: Record<string, unknown> = {}) => ({
  id: CONV,
  state: 'open',
  openedById: ME,
  blockedBy: null,
  userAId: ME,
  userBId: THEM,
  lastMessageAt: at(30, 14, 41),
  createdAt: at(20, 10),
  other: { id: THEM, firstName: 'Ada', photoPath: null },
  lastMessage: null,
  lastReadAt: null,
  ...overrides,
});

const message = (overrides: Record<string, unknown> = {}) => ({
  id: 'm1',
  conversation_id: CONV,
  sender_id: THEM,
  body: 'hey',
  media_path: null,
  media_kind: null,
  view_limit: null,
  views_used: 0,
  media_duration_ms: null,
  media_bytes: null,
  media_width: null,
  media_height: null,
  media_poster_path: null,
  created_at: at(30, 14, 41),
  ...overrides,
});

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <ChatThreadScreen />
    </QueryClientProvider>
  );
}

type Screen = Awaited<ReturnType<typeof renderScreen>>;

/** The rows the inverted list was handed, newest first, by key. */
const rowKeys = (screen: Screen) =>
  (screen.getByTestId('thread-list').props.data as { key: string }[]).map((row) => row.key);

/** Renders and waits for the typing channel to be joined. */
async function renderJoined() {
  const screen = await renderScreen();
  await screen.findByTestId('thread-list');
  await waitFor(() => expect(mockClient.channel).toHaveBeenCalled());
  return { screen, channel: mockClient.channels[mockClient.channels.length - 1]! };
}

const typingFrom = (userId: string) => ({
  type: 'broadcast',
  event: 'typing',
  payload: { user_id: userId, at: Date.now() },
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: NOW, doNotFake: [...DATE_ONLY] });
  threadHandlers = null;
  mockClient.channels = [];
  mockClient.joinStatus = 'SUBSCRIBED';
  mockClient.sendResult = () => Promise.resolve('ok');
  mockClient.channel.mockImplementation((topic: string, options: unknown) => {
    const channel: FakeChannel = {
      topic,
      options,
      broadcast: null,
      status: null,
      on: jest.fn((_type: string, _filter: unknown, callback: (message: unknown) => void) => {
        channel.broadcast = callback;
        return channel;
      }),
      subscribe: jest.fn((callback: (status: string) => void) => {
        channel.status = callback;
        callback(mockClient.joinStatus);
        return channel;
      }),
      send: jest.fn(() => mockClient.sendResult()),
    };
    mockClient.channels.push(channel);
    return channel;
  });
  (me as jest.Mock).mockResolvedValue({ id: ME, status: 'active', verification_status: 'verified' });
  (getConversation as jest.Mock).mockResolvedValue(conversation());
  (listMessages as jest.Mock).mockResolvedValue({ messages: [message()], nextCursor: null });
  (markRead as jest.Mock).mockResolvedValue(undefined);
  (sendMessage as jest.Mock).mockResolvedValue(message({ id: 'sent', sender_id: ME }));
  (signedChatMediaUrls as jest.Mock).mockResolvedValue({});
  (signedPhotoUrls as jest.Mock).mockResolvedValue({});
  (listShareFeed as jest.Mock).mockResolvedValue([]);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('thread — send times', () => {
  const threeMessages = [
    message({ id: 'm3', sender_id: ME, body: 'see you there', created_at: at(30, 14, 41) }),
    message({ id: 'm2', sender_id: THEM, body: 'the library?', created_at: at(30, 14, 30) }),
    message({ id: 'm1', sender_id: THEM, body: 'hey', created_at: at(30, 9, 5) }),
  ];

  it('always shows the newest message’s time, and no other', async () => {
    (listMessages as jest.Mock).mockResolvedValue({ messages: threeMessages, nextCursor: null });
    const screen = await renderScreen();

    const time = await screen.findByTestId('message-time-m3');
    expect(time).toHaveTextContent(formatMessageTime(at(30, 14, 41)));
    expect(screen.queryByTestId('message-time-m2')).toBeNull();
    expect(screen.queryByTestId('message-time-m1')).toBeNull();
  });

  it('reads as a 12-hour clock', async () => {
    (listMessages as jest.Mock).mockResolvedValue({ messages: threeMessages, nextCursor: null });
    const screen = await renderScreen();
    expect((await screen.findByTestId('message-time-m3')).props.children).toMatch(/^2:41\s?pm$|^14:41$/);
  });

  it('shows an older message’s time on a tap, one at a time, and hides it on a second tap', async () => {
    (listMessages as jest.Mock).mockResolvedValue({ messages: threeMessages, nextCursor: null });
    const screen = await renderScreen();
    await screen.findByTestId('message-time-m3');

    await fireEvent.press(screen.getByTestId('message-hold-m1'));
    expect(screen.getByTestId('message-time-m1')).toHaveTextContent(formatMessageTime(at(30, 9, 5)));

    // Only one open at a time: m2 takes over from m1.
    await fireEvent.press(screen.getByTestId('message-hold-m2'));
    expect(screen.getByTestId('message-time-m2')).toBeTruthy();
    expect(screen.queryByTestId('message-time-m1')).toBeNull();

    await fireEvent.press(screen.getByTestId('message-hold-m2'));
    expect(screen.queryByTestId('message-time-m2')).toBeNull();
    // The newest keeps its time throughout.
    expect(screen.getByTestId('message-time-m3')).toBeTruthy();
  });

  it('keeps a photo’s tap for opening it; its time toggles on press and hold', async () => {
    (listMessages as jest.Mock).mockResolvedValue({
      messages: [
        message({ id: 'm2', body: 'newest', created_at: at(30, 14, 41) }),
        message({
          id: 'm1',
          body: null,
          media_path: `${CONV}/m1.jpg`,
          media_kind: 'photo',
          media_width: 100,
          media_height: 100,
          created_at: at(30, 11, 0),
        }),
      ],
      nextCursor: null,
    });
    const screen = await renderScreen();
    const media = await screen.findByTestId('message-media-m1');

    await fireEvent.press(media);
    expect(router.push).toHaveBeenCalledWith(`/chat/${CONV}/media/m1`);
    expect(screen.queryByTestId('message-time-m1')).toBeNull();

    await fireEvent(media, 'longPress');
    expect(screen.getByTestId('message-time-m1')).toHaveTextContent(formatMessageTime(at(30, 11, 0)));
    await fireEvent(media, 'longPress');
    expect(screen.queryByTestId('message-time-m1')).toBeNull();
  });

  it('keeps a share bubble’s tap for opening it; its time toggles on press and hold', async () => {
    (listShareFeed as jest.Mock).mockResolvedValue([
      { id: 's1', kind: 'private_card', ownerId: THEM, viewerId: ME, subjectId: THEM, createdAt: at(30, 10, 0) },
    ]);
    const screen = await renderScreen();
    const share = await screen.findByTestId('share-bubble-press-s1');
    // The newer message holds the always-on time.
    expect(screen.getByTestId('message-time-m1')).toBeTruthy();
    expect(screen.queryByTestId('share-time-s1')).toBeNull();

    await fireEvent(share, 'longPress');
    expect(screen.getByTestId('share-time-s1')).toHaveTextContent(formatMessageTime(at(30, 10, 0)));
    await fireEvent(share, 'longPress');
    expect(screen.queryByTestId('share-time-s1')).toBeNull();
  });

  it('shows no time on a message that is still sending', async () => {
    let resolveSend: (value: unknown) => void = () => undefined;
    (sendMessage as jest.Mock).mockImplementation(() => new Promise((resolve) => (resolveSend = resolve)));
    const screen = await renderScreen();
    await screen.findByTestId('message-time-m1');

    await fireEvent.changeText(screen.getByTestId('composer-input'), 'on my way');
    await fireEvent.press(screen.getByTestId('composer-send'));

    const sending = (screen.getByTestId('thread-list').props.data as { key: string }[])[0]!;
    expect(sending.key).toMatch(/^m-/);
    expect(screen.queryByTestId(`message-time-${sending.key.slice(2)}`)).toBeNull();
    // The newest settled message keeps its time meanwhile.
    expect(screen.getByTestId('message-time-m1')).toBeTruthy();
    await act(async () => resolveSend(message({ id: 'sent', sender_id: ME })));
  });
});

describe('thread — day separators', () => {
  it('heads each day once the thread spans more than one, newest first', async () => {
    (listMessages as jest.Mock).mockResolvedValue({
      messages: [
        message({ id: 'a', created_at: at(30, 14, 41) }),
        message({ id: 'b', created_at: at(30, 8, 0) }),
        message({ id: 'c', created_at: at(29, 23, 50) }),
        message({ id: 'd', created_at: at(28, 12, 0) }),
        message({ id: 'e', created_at: at(12, 12, 0) }),
        message({ id: 'f', created_at: at(12, 9, 0, 8, 2025) }),
      ],
      nextCursor: null,
    });
    const screen = await renderScreen();
    await screen.findByTestId('message-a');

    expect(rowKeys(screen)).toEqual([
      'm-a',
      'm-b',
      'd-2026-09-30',
      'm-c',
      'd-2026-09-29',
      'm-d',
      'd-2026-09-28',
      'm-e',
      'd-2026-09-12',
      'm-f',
      'd-2025-09-12',
    ]);
    expect(screen.getByTestId('thread-day-2026-09-30')).toHaveTextContent('today');
    expect(screen.getByTestId('thread-day-2026-09-29')).toHaveTextContent('yesterday');
    expect(screen.getByTestId('thread-day-2026-09-28')).toHaveTextContent('monday');
    expect(screen.getByTestId('thread-day-2026-09-12')).toHaveTextContent('sep 12');
    // The eleventh row is past the list's first render window: read its label off the data.
    const rows = screen.getByTestId('thread-list').props.data as { key: string; label?: string }[];
    expect(rows.find((row) => row.key === 'd-2025-09-12')?.label).toBe('sep 12, 2025');
  });

  it('adds none when every message is from the same day', async () => {
    (listMessages as jest.Mock).mockResolvedValue({
      messages: [
        message({ id: 'a', created_at: at(30, 14, 41) }),
        message({ id: 'b', created_at: at(30, 0, 5) }),
      ],
      nextCursor: null,
    });
    const screen = await renderScreen();
    await screen.findByTestId('message-a');
    expect(rowKeys(screen)).toEqual(['m-a', 'm-b']);
    expect(screen.queryByText('today')).toBeNull();
  });

  it('splits on the local day, so 11:50 pm and 12:10 am are two days', async () => {
    (listMessages as jest.Mock).mockResolvedValue({
      messages: [
        message({ id: 'a', created_at: at(30, 0, 10) }),
        message({ id: 'b', created_at: at(29, 23, 50) }),
      ],
      nextCursor: null,
    });
    const screen = await renderScreen();
    await screen.findByTestId('message-a');
    expect(rowKeys(screen)).toEqual(['m-a', 'd-2026-09-30', 'm-b', 'd-2026-09-29']);
  });
});

describe('thread — typing', () => {
  it('joins the private conversation topic', async () => {
    await renderJoined();
    expect(mockClient.channel).toHaveBeenCalledWith(`conversation:${CONV}`, { config: { private: true } });
    expect(mockClient.channels[0]!.on).toHaveBeenCalledWith('broadcast', { event: 'typing' }, expect.any(Function));
  });

  it('shows three dots at the bottom on the other person’s broadcast', async () => {
    const { screen, channel } = await renderJoined();
    expect(screen.queryByTestId('thread-typing')).toBeNull();

    await act(async () => channel.broadcast!(typingFrom(THEM)));
    expect(screen.getByTestId('thread-typing')).toBeTruthy();
    expect(rowKeys(screen)[0]).toBe('typing');
  });

  it('ignores my own broadcasts', async () => {
    const { screen, channel } = await renderJoined();
    await act(async () => channel.broadcast!(typingFrom(ME)));
    expect(screen.queryByTestId('thread-typing')).toBeNull();
  });

  it('ignores a malformed broadcast', async () => {
    const { screen, channel } = await renderJoined();
    await act(async () => channel.broadcast!({ event: 'typing', payload: { at: 1 } }));
    expect(screen.queryByTestId('thread-typing')).toBeNull();
  });

  it('goes 4 s after the last event', async () => {
    const { screen, channel } = await renderJoined();
    jest.useFakeTimers({ now: Date.now(), doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });

    await act(async () => channel.broadcast!(typingFrom(THEM)));
    await act(async () => jest.advanceTimersByTime(3000));
    // A fresh event restarts the clock.
    await act(async () => channel.broadcast!(typingFrom(THEM)));
    await act(async () => jest.advanceTimersByTime(3900));
    expect(screen.getByTestId('thread-typing')).toBeTruthy();

    await act(async () => jest.advanceTimersByTime(200));
    expect(screen.queryByTestId('thread-typing')).toBeNull();
  });

  it('hides the moment their message arrives', async () => {
    const { screen, channel } = await renderJoined();
    await act(async () => channel.broadcast!(typingFrom(THEM)));
    expect(screen.getByTestId('thread-typing')).toBeTruthy();

    await act(async () =>
      threadHandlers!.onMessage({
        id: 'm9',
        conversation_id: CONV,
        sender_id: THEM,
        body: 'hi',
        media_path: null,
        created_at: new Date().toISOString(),
        view_limit: null,
        views_used: 0,
        eventType: 'INSERT',
      })
    );
    expect(screen.queryByTestId('thread-typing')).toBeNull();
  });

  it('broadcasts at most once every 2 s while typing', async () => {
    const { screen, channel } = await renderJoined();
    const input = screen.getByTestId('composer-input');

    await fireEvent.changeText(input, 'h');
    await fireEvent.changeText(input, 'he');
    await fireEvent.changeText(input, 'hey');
    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(channel.send).toHaveBeenCalledWith({
      type: 'broadcast',
      event: 'typing',
      payload: { user_id: ME, at: Date.now() },
    });

    jest.setSystemTime(Date.now() + 1500);
    await fireEvent.changeText(input, 'hey t');
    expect(channel.send).toHaveBeenCalledTimes(1);

    jest.setSystemTime(Date.now() + 600);
    await fireEvent.changeText(input, 'hey th');
    expect(channel.send).toHaveBeenCalledTimes(2);
  });

  it('sends nothing for an empty or blank field', async () => {
    const { screen, channel } = await renderJoined();
    await fireEvent.changeText(screen.getByTestId('composer-input'), '   ');
    await fireEvent.changeText(screen.getByTestId('composer-input'), '');
    expect(channel.send).not.toHaveBeenCalled();
  });

  it('sends nothing while the composer is locked', async () => {
    (getConversation as jest.Mock).mockResolvedValue(conversation({ state: 'awaiting_reply', openedById: ME }));
    (listMessages as jest.Mock).mockResolvedValue({ messages: [message({ sender_id: ME })], nextCursor: null });
    const { screen, channel } = await renderJoined();

    expect(screen.getByTestId('composer-locked')).toBeTruthy();
    expect(screen.queryByTestId('composer-input')).toBeNull();
    expect(channel.send).not.toHaveBeenCalled();
  });

  it('swallows a refused join: no dots, no sends, no error line', async () => {
    mockClient.joinStatus = 'CHANNEL_ERROR';
    const { screen, channel } = await renderJoined();

    await fireEvent.changeText(screen.getByTestId('composer-input'), 'hey');
    expect(channel.send).not.toHaveBeenCalled();
    expect(screen.queryByText(/error|wrong|couldn/i)).toBeNull();
    expect(screen.getByTestId('composer-input')).toBeTruthy();
  });

  it('swallows a refused send (a blocked party’s app looks unchanged)', async () => {
    (getConversation as jest.Mock).mockResolvedValue(conversation({ state: 'closed_block', blockedBy: THEM }));
    mockClient.sendResult = () => Promise.reject(new Error('unauthorized'));
    const { screen, channel } = await renderJoined();

    await fireEvent.changeText(screen.getByTestId('composer-input'), 'hey');
    await act(async () => undefined);
    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/error|wrong|couldn/i)).toBeNull();
  });

  it('survives a client that cannot open the channel at all', async () => {
    mockClient.channel.mockImplementation(() => {
      throw new Error('no realtime');
    });
    const screen = await renderScreen();
    await screen.findByTestId('message-m1');
    await fireEvent.changeText(screen.getByTestId('composer-input'), 'hey');
    expect(screen.queryByTestId('thread-typing')).toBeNull();
  });

  it('leaves the channel on unmount', async () => {
    const { screen, channel } = await renderJoined();
    await screen.unmount();
    expect(mockClient.removeChannel).toHaveBeenCalledWith(channel);
  });
});
