/**
 * Replies and read badges in the thread (migration 0017, decision 93,
 * `docs/chat-replies-and-badges.md`): press and hold for the menu, the reply
 * bar's lifecycle, the reference on send (text and media), quotes in every
 * state, following a quote back, and the optimistic read.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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
jest.mock('../api/client', () => ({ supabase: {}, SUPABASE_URL: 'https://example.test' }));
jest.mock('../api/conversations', () => ({ getConversation: jest.fn() }));
jest.mock('../api/messages', () => ({
  listMessages: jest.fn(),
  listRecentlySharedMedia: jest.fn(),
  markRead: jest.fn(),
  sendMessage: jest.fn(),
}));
jest.mock('../api/replies', () => ({ messageQuotes: jest.fn() }));
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
jest.mock('../api/albums', () => ({ listMyAlbums: jest.fn(), getAlbum: jest.fn(), signedAlbumPhotoUrls: jest.fn() }));
jest.mock('../api/shares', () => ({ shareAlbum: jest.fn(), sharePrivateCard: jest.fn() }));
jest.mock('../api/identity', () => ({ getSharedPrivateCard: jest.fn() }));
jest.mock('../chat/shareFeed', () => ({ listShareFeed: jest.fn(() => Promise.resolve([])) }));
jest.mock('../chat/clipboard', () => ({ copyText: jest.fn(() => Promise.resolve(true)) }));
jest.mock('../chat/haptics', () => ({ lightTap: jest.fn() }));
jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
}));
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
import * as ImagePicker from 'expo-image-picker';
import { getConversation } from '../api/conversations';
import { listMessages, listRecentlySharedMedia, markRead, sendMessage } from '../api/messages';
import { messageQuotes } from '../api/replies';
import { signedChatMediaUrls, uploadChatMedia } from '../api/chatMedia';
import { me } from '../api/me';
import { signedPhotoUrls } from '../api/photos';
import { listMyAlbums, signedAlbumPhotoUrls } from '../api/albums';
import { copyText } from '../chat/clipboard';
import { lightTap } from '../chat/haptics';
import ChatThreadScreen from '../app/chat/[id]';

const conversation = (overrides: Record<string, unknown> = {}) => ({
  id: CONV,
  state: 'open',
  openedById: ME,
  blockedBy: null,
  userAId: ME,
  userBId: THEM,
  lastMessageAt: '2026-09-29T11:00:00.000Z',
  createdAt: '2026-09-29T10:00:00.000Z',
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
  created_at: '2026-09-29T11:00:00.000Z',
  reply_to_message_id: null,
  reply_to_album_photo_id: null,
  reply_kind: null,
  ...overrides,
});

const quote = (overrides: Record<string, unknown> = {}) => ({
  messageId: 'r1',
  replyKind: 'message',
  available: true,
  quotedMessageId: 'q1',
  quotedAlbumPhotoId: null,
  quotedSenderId: THEM,
  quotedCreatedAt: '2026-09-29T10:00:00.000Z',
  excerpt: 'the original',
  mediaKind: null,
  isLimited: false,
  mediaPath: null,
  mediaPosterPath: null,
  albumId: null,
  ...overrides,
});

const reply = (overrides: Record<string, unknown> = {}) =>
  message({
    id: 'r1',
    sender_id: ME,
    body: 'my answer',
    created_at: '2026-09-29T11:30:00.000Z',
    reply_to_message_id: 'q1',
    reply_kind: 'message',
    ...overrides,
  });

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
}

function renderScreen(client = newClient()) {
  return render(
    <QueryClientProvider client={client}>
      <ChatThreadScreen />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  threadHandlers = null;
  (me as jest.Mock).mockResolvedValue({ id: ME, status: 'active', verification_status: 'verified' });
  (getConversation as jest.Mock).mockResolvedValue(conversation());
  (listMessages as jest.Mock).mockResolvedValue({ messages: [message()], nextCursor: null });
  (markRead as jest.Mock).mockResolvedValue(undefined);
  (sendMessage as jest.Mock).mockResolvedValue(message({ id: 'sent', sender_id: ME }));
  (signedChatMediaUrls as jest.Mock).mockResolvedValue({});
  (signedAlbumPhotoUrls as jest.Mock).mockResolvedValue({});
  (signedPhotoUrls as jest.Mock).mockResolvedValue({});
  (listMyAlbums as jest.Mock).mockResolvedValue([]);
  (listRecentlySharedMedia as jest.Mock).mockResolvedValue([]);
  (messageQuotes as jest.Mock).mockResolvedValue({});
});

type Screen = Awaited<ReturnType<typeof renderScreen>>;

/** Press and hold a message's bubble; the menu opens beside it. */
async function hold(screen: Screen, id: string) {
  await fireEvent(await screen.findByTestId(`message-hold-${id}`), 'longPress');
  return screen.findByTestId('message-menu');
}

async function startReplyTo(screen: Screen, id: string) {
  await hold(screen, id);
  await fireEvent.press(screen.getByTestId('message-menu-reply'));
  return screen.findByTestId('reply-bar');
}

describe('thread — press and hold', () => {
  it('opens a small menu with reply and copy, with a light haptic', async () => {
    const screen = await renderScreen();
    await hold(screen, 'm1');
    expect(screen.getByTestId('message-menu-reply')).toBeTruthy();
    expect(screen.getByTestId('message-menu-copy')).toBeTruthy();
    expect(lightTap).toHaveBeenCalled();
    // Nothing invented: no delete, edit or reactions.
    expect(screen.queryByText(/delete|edit|react/i)).toBeNull();
  });

  it('copies the text and closes', async () => {
    const screen = await renderScreen();
    await hold(screen, 'm1');
    await fireEvent.press(screen.getByTestId('message-menu-copy'));
    expect(copyText).toHaveBeenCalledWith('hey');
    expect(screen.queryByTestId('message-menu')).toBeNull();
  });

  it('closes on a tap outside', async () => {
    const screen = await renderScreen();
    await hold(screen, 'm1');
    await fireEvent.press(screen.getByTestId('message-menu-backdrop'));
    expect(screen.queryByTestId('message-menu')).toBeNull();
  });

  it('offers no copy for a photo with no text', async () => {
    (listMessages as jest.Mock).mockResolvedValue({
      messages: [message({ body: null, media_path: `${CONV}/m1.jpg`, media_kind: 'photo' })],
      nextCursor: null,
    });
    const screen = await renderScreen();
    await fireEvent(await screen.findByTestId('message-media-m1'), 'longPress');
    await screen.findByTestId('message-menu');
    expect(screen.getByTestId('message-menu-reply')).toBeTruthy();
    expect(screen.queryByTestId('message-menu-copy')).toBeNull();
  });

  it('offers only copy in a thread the composer cannot write in', async () => {
    (getConversation as jest.Mock).mockResolvedValue(conversation({ state: 'expired' }));
    const screen = await renderScreen();
    await hold(screen, 'm1');
    expect(screen.queryByTestId('message-menu-reply')).toBeNull();
    expect(screen.getByTestId('message-menu-copy')).toBeTruthy();
  });

  it('opens nothing at all when there is nothing to offer', async () => {
    (getConversation as jest.Mock).mockResolvedValue(conversation({ state: 'expired' }));
    (listMessages as jest.Mock).mockResolvedValue({
      messages: [message({ body: null, media_path: `${CONV}/m1.jpg`, media_kind: 'photo' })],
      nextCursor: null,
    });
    const screen = await renderScreen();
    await fireEvent(await screen.findByTestId('message-media-m1'), 'longPress');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
    });
    expect(screen.queryByTestId('message-menu')).toBeNull();
  });
});

describe('thread — the reply bar', () => {
  it('says who and what, and sending attaches the reference and clears it', async () => {
    const screen = await renderScreen();
    await startReplyTo(screen, 'm1');
    expect(screen.getByTestId('reply-bar-name')).toHaveTextContent('replying to ada');
    expect(screen.getByTestId('reply-bar-line')).toHaveTextContent('hey');

    await fireEvent.changeText(screen.getByTestId('composer-input'), 'hi back');
    await fireEvent.press(screen.getByTestId('composer-send'));

    await waitFor(() => expect(sendMessage).toHaveBeenCalled());
    expect((sendMessage as jest.Mock).mock.calls[0]![0]).toMatchObject({
      conversationId: CONV,
      body: 'hi back',
      replyTo: { messageId: 'm1' },
    });
    expect(screen.queryByTestId('reply-bar')).toBeNull();
  });

  it('says yourself for my own message', async () => {
    (listMessages as jest.Mock).mockResolvedValue({ messages: [message({ sender_id: ME })], nextCursor: null });
    const screen = await renderScreen();
    await startReplyTo(screen, 'm1');
    expect(screen.getByTestId('reply-bar-name')).toHaveTextContent('replying to yourself');
  });

  it('the x cancels it, and the next send is a plain message', async () => {
    const screen = await renderScreen();
    await startReplyTo(screen, 'm1');
    await fireEvent.press(screen.getByTestId('reply-bar-cancel'));
    expect(screen.queryByTestId('reply-bar')).toBeNull();

    await fireEvent.changeText(screen.getByTestId('composer-input'), 'plain');
    await fireEvent.press(screen.getByTestId('composer-send'));
    await waitFor(() => expect(sendMessage).toHaveBeenCalled());
    expect((sendMessage as jest.Mock).mock.calls[0]![0].replyTo).toBeNull();
  });

  it('names kept media and shows its thumbnail; limited media only by name', async () => {
    (listMessages as jest.Mock).mockResolvedValue({
      messages: [
        message({ id: 'kept', body: null, media_path: `${CONV}/kept.jpg`, media_kind: 'photo' }),
        message({
          id: 'once',
          body: null,
          media_path: `${CONV}/once.jpg`,
          media_kind: 'photo',
          view_limit: 1,
          created_at: '2026-09-29T10:59:00.000Z',
        }),
      ],
      nextCursor: null,
    });
    (signedChatMediaUrls as jest.Mock).mockResolvedValue({ [`${CONV}/kept.jpg`]: 'https://signed/kept.jpg' });
    const screen = await renderScreen();

    await fireEvent(await screen.findByTestId('message-media-kept'), 'longPress');
    await fireEvent.press(await screen.findByTestId('message-menu-reply'));
    expect(await screen.findByTestId('reply-bar-line')).toHaveTextContent('photo');
    await waitFor(() => expect(screen.getByTestId('reply-bar-thumb').props.source).toEqual([{ uri: 'https://signed/kept.jpg' }]));

    await fireEvent(screen.getByTestId('message-limited-press-once'), 'longPress');
    await fireEvent.press(await screen.findByTestId('message-menu-reply'));
    await waitFor(() => expect(screen.getByTestId('reply-bar-line')).toHaveTextContent('view once photo'));
    expect(screen.queryByTestId('reply-bar-thumb')).toBeNull();
  });

  it('a reply can carry media: the picked photo goes with the reference, and the bar clears', async () => {
    const screen = await renderScreen();
    await startReplyTo(screen, 'm1');
    (uploadChatMedia as jest.Mock).mockResolvedValue(`${CONV}/pic.jpg`);

    await fireEvent.press(screen.getByTestId('composer-attach'));
    await fireEvent.press(await screen.findByTestId('share-sheet-photo'));
    await screen.findByTestId('media-pick-sheet');
    (ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///pic.jpg', width: 100, height: 100, type: 'image' }],
    });
    await fireEvent.press(screen.getByTestId('media-pick-library'));
    await screen.findByTestId('media-preview-sheet');
    await fireEvent.press(screen.getByTestId('media-preview-send'));

    await waitFor(() => expect(sendMessage).toHaveBeenCalled());
    expect((sendMessage as jest.Mock).mock.calls[0]![0]).toMatchObject({
      mediaPath: `${CONV}/pic.jpg`,
      replyTo: { messageId: 'm1' },
    });
    await waitFor(() => expect(screen.queryByTestId('reply-bar')).toBeNull());
  });

  it('shows the quote on the sending bubble at once, and a failed reply retries with its reference', async () => {
    (sendMessage as jest.Mock).mockRejectedValueOnce(new Error('nope'));
    const screen = await renderScreen();
    await startReplyTo(screen, 'm1');
    await fireEvent.changeText(screen.getByTestId('composer-input'), 'answer');
    await fireEvent.press(screen.getByTestId('composer-send'));

    await waitFor(() => expect(screen.getAllByTestId(/^message-retry-/)).toHaveLength(1));
    const id = (sendMessage as jest.Mock).mock.calls[0]![0].id as string;
    expect(screen.getByTestId(`message-quote-${id}-line`)).toHaveTextContent('hey');

    (sendMessage as jest.Mock).mockResolvedValue(message({ id, sender_id: ME }));
    await fireEvent.press(screen.getByTestId(`message-retry-${id}`));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));
    expect((sendMessage as jest.Mock).mock.calls[1]![0]).toMatchObject({ id, replyTo: { messageId: 'm1' } });
  });
});

describe('thread — quotes', () => {
  it('asks for the quotes of the replies on a page, once, and draws a text quote', async () => {
    (listMessages as jest.Mock).mockResolvedValue({
      messages: [reply(), message({ id: 'plain', created_at: '2026-09-29T11:10:00.000Z' })],
      nextCursor: null,
    });
    (messageQuotes as jest.Mock).mockResolvedValue({ r1: quote() });
    const screen = await renderScreen();

    await waitFor(() => expect(screen.getByTestId('message-quote-r1-line')).toHaveTextContent('the original'));
    expect(messageQuotes).toHaveBeenCalledWith(['r1']);
    expect(screen.getByTestId('message-quote-r1')).toHaveTextContent(/ada/);
  });

  it('draws a kept photo quote with its thumbnail, signed from chat-media', async () => {
    (listMessages as jest.Mock).mockResolvedValue({ messages: [reply()], nextCursor: null });
    (messageQuotes as jest.Mock).mockResolvedValue({
      r1: quote({ excerpt: null, mediaKind: 'photo', mediaPath: `${CONV}/q1.jpg` }),
    });
    (signedChatMediaUrls as jest.Mock).mockImplementation((paths: string[]) =>
      Promise.resolve(paths.includes(`${CONV}/q1.jpg`) ? { [`${CONV}/q1.jpg`]: 'https://signed/q1.jpg' } : {})
    );
    const screen = await renderScreen();

    await waitFor(() =>
      expect(screen.getByTestId('message-quote-r1-image').props.source).toEqual([{ uri: 'https://signed/q1.jpg' }])
    );
    expect(screen.getByTestId('message-quote-r1-line')).toHaveTextContent('photo');
  });

  it('draws a kept video quote from its poster', async () => {
    (listMessages as jest.Mock).mockResolvedValue({ messages: [reply()], nextCursor: null });
    (messageQuotes as jest.Mock).mockResolvedValue({
      r1: quote({ excerpt: null, mediaKind: 'video', mediaPath: `${CONV}/q1.mp4`, mediaPosterPath: `${CONV}/q1-poster.jpg` }),
    });
    (signedChatMediaUrls as jest.Mock).mockImplementation((paths: string[]) =>
      Promise.resolve(paths.includes(`${CONV}/q1-poster.jpg`) ? { [`${CONV}/q1-poster.jpg`]: 'https://signed/poster.jpg' } : {})
    );
    const screen = await renderScreen();
    await waitFor(() =>
      expect(screen.getByTestId('message-quote-r1-image').props.source).toEqual([{ uri: 'https://signed/poster.jpg' }])
    );
    expect(screen.getByTestId('message-quote-r1-line')).toHaveTextContent('video');
    expect(signedChatMediaUrls).not.toHaveBeenCalledWith(expect.arrayContaining([`${CONV}/q1.mp4`]));
  });

  it('draws limited media as a neutral placeholder, never an image', async () => {
    (listMessages as jest.Mock).mockResolvedValue({ messages: [reply()], nextCursor: null });
    (messageQuotes as jest.Mock).mockResolvedValue({ r1: quote({ excerpt: null, mediaKind: 'photo', isLimited: true }) });
    const screen = await renderScreen();
    await waitFor(() => expect(screen.getByTestId('message-quote-r1-placeholder')).toBeTruthy());
    expect(screen.queryByTestId('message-quote-r1-image')).toBeNull();
    expect(screen.getByTestId('message-quote-r1-line')).toHaveTextContent('limited photo');
  });

  it('says only unavailable when the quote is not available, and cannot be tapped', async () => {
    (listMessages as jest.Mock).mockResolvedValue({ messages: [reply()], nextCursor: null });
    (messageQuotes as jest.Mock).mockResolvedValue({ r1: quote({ available: false, quotedMessageId: null, excerpt: null }) });
    const screen = await renderScreen();
    await waitFor(() => expect(screen.getByTestId('message-quote-r1-line')).toHaveTextContent('unavailable'));
    expect(screen.getByTestId('message-quote-r1')).not.toHaveTextContent(/ada|deleted|revoked|blocked/);
    await fireEvent.press(screen.getByTestId('message-quote-r1'));
    expect(router.push).not.toHaveBeenCalled();
  });

  it('draws an album photo quote from album-photos, and a tap opens the story at that photo', async () => {
    (listMessages as jest.Mock).mockResolvedValue({
      messages: [reply({ reply_to_message_id: null, reply_to_album_photo_id: 'p1', reply_kind: 'album_photo' })],
      nextCursor: null,
    });
    (messageQuotes as jest.Mock).mockResolvedValue({
      r1: quote({
        replyKind: 'album_photo',
        quotedMessageId: null,
        quotedAlbumPhotoId: 'p1',
        excerpt: null,
        mediaKind: 'photo',
        mediaPath: `${THEM}/a1/p1.jpg`,
        albumId: 'a1',
      }),
    });
    (signedAlbumPhotoUrls as jest.Mock).mockResolvedValue({ [`${THEM}/a1/p1.jpg`]: 'https://signed/p1.jpg' });
    const screen = await renderScreen();

    await waitFor(() =>
      expect(screen.getByTestId('message-quote-r1-image').props.source).toEqual([{ uri: 'https://signed/p1.jpg' }])
    );
    expect(screen.getByTestId('message-quote-r1-line')).toHaveTextContent('album photo');
    await fireEvent.press(screen.getByTestId('message-quote-r1'));
    expect(router.push).toHaveBeenCalledWith(`/chat/${CONV}/album/a1?photo=p1`);
  });

  it('draws a message quote from the loaded page while the live answer is on its way', async () => {
    (listMessages as jest.Mock).mockResolvedValue({
      messages: [reply(), message({ id: 'q1', body: 'the loaded original', created_at: '2026-09-29T10:00:00.000Z' })],
      nextCursor: null,
    });
    (messageQuotes as jest.Mock).mockReturnValue(new Promise(() => {}));
    const screen = await renderScreen();
    await waitFor(() => expect(screen.getByTestId('message-quote-r1-line')).toHaveTextContent('the loaded original'));
  });

  it('a tap on a message quote tints the original once it is in the list', async () => {
    (listMessages as jest.Mock).mockResolvedValue({
      messages: [reply(), message({ id: 'q1', body: 'the original', created_at: '2026-09-29T10:00:00.000Z' })],
      nextCursor: null,
    });
    (messageQuotes as jest.Mock).mockResolvedValue({ r1: quote() });
    const screen = await renderScreen();
    await waitFor(() => expect(screen.getByTestId('message-quote-r1-line')).toHaveTextContent('the original'));

    await fireEvent.press(screen.getByTestId('message-quote-r1'));
    expect(await screen.findByTestId('message-highlighted-q1')).toBeTruthy();
  });

  it('loads older pages to find the original', async () => {
    (listMessages as jest.Mock).mockImplementation((_id: string, cursor?: string | null) =>
      Promise.resolve(
        cursor
          ? { messages: [message({ id: 'q1', body: 'way back', created_at: '2026-09-28T10:00:00.000Z' })], nextCursor: null }
          : { messages: [reply()], nextCursor: '2026-09-29T11:30:00.000Z' }
      )
    );
    (messageQuotes as jest.Mock).mockResolvedValue({ r1: quote({ quotedCreatedAt: '2026-09-28T10:00:00.000Z' }) });
    const screen = await renderScreen();
    await waitFor(() => expect(screen.getByTestId('message-quote-r1-line')).toHaveTextContent('the original'));

    await fireEvent.press(screen.getByTestId('message-quote-r1'));
    await waitFor(() => expect(listMessages).toHaveBeenCalledWith(CONV, '2026-09-29T11:30:00.000Z'));
    expect(await screen.findByTestId('message-highlighted-q1')).toBeTruthy();
  });

  it('does nothing when the original cannot be found', async () => {
    (listMessages as jest.Mock).mockResolvedValue({ messages: [reply()], nextCursor: null });
    (messageQuotes as jest.Mock).mockResolvedValue({ r1: quote() });
    const screen = await renderScreen();
    await waitFor(() => expect(screen.getByTestId('message-quote-r1-line')).toHaveTextContent('the original'));
    await fireEvent.press(screen.getByTestId('message-quote-r1'));
    await act(async () => {});
    expect(screen.queryByTestId(/^message-highlighted-/)).toBeNull();
    expect(listMessages).toHaveBeenCalledTimes(1);
  });

  it('asks again when a reply row is updated (an album photo deleted under it)', async () => {
    (listMessages as jest.Mock).mockResolvedValue({ messages: [reply()], nextCursor: null });
    (messageQuotes as jest.Mock).mockResolvedValue({ r1: quote() });
    const screen = await renderScreen();
    await waitFor(() => expect(messageQuotes).toHaveBeenCalledTimes(1));
    (messageQuotes as jest.Mock).mockResolvedValue({ r1: quote({ available: false, quotedMessageId: null, excerpt: null }) });

    await act(async () => {
      threadHandlers?.onMessage({ ...reply(), eventType: 'UPDATE' });
    });
    await waitFor(() => expect(screen.getByTestId('message-quote-r1-line')).toHaveTextContent('unavailable'));
  });
});

describe('thread — read badges', () => {
  it('opening an unread thread drops its row count and the tab badge at once, then re-reads them', async () => {
    let finishRead: () => void = () => {};
    (markRead as jest.Mock).mockImplementation(() => new Promise<void>((resolve) => (finishRead = resolve)));
    const client = newClient();
    client.setQueryData(['conversations'], [{ id: CONV, unreadCount: 3, other: { id: THEM } }]);
    client.setQueryData(['badge-counts'], { unreadChats: 2, unreadMessages: 5, hisWaiting: 1, total: 3 });
    const invalidate = jest.spyOn(client, 'invalidateQueries');

    const screen = await renderScreen(client);
    await screen.findByTestId('message-m1');
    await waitFor(() => expect(markRead).toHaveBeenCalled());

    // Before the read has landed.
    expect(client.getQueryData(['badge-counts'])).toEqual({ unreadChats: 1, unreadMessages: 2, hisWaiting: 1, total: 2 });
    expect(client.getQueryData<{ unreadCount: number }[]>(['conversations'])![0]!.unreadCount).toBe(0);
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['badge-counts'] });

    await act(async () => finishRead());
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['badge-counts'] }));
  });

  it('re-reads the badges after a send', async () => {
    const client = newClient();
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    const screen = await renderScreen(client);
    await fireEvent.changeText(await screen.findByTestId('composer-input'), 'hello');
    invalidate.mockClear();
    await fireEvent.press(screen.getByTestId('composer-send'));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['badge-counts'] }));
  });
});
