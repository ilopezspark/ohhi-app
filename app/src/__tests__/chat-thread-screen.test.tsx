import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const CONV = 'cccccccc-0000-4000-8000-000000000003';
const ME = 'aaaaaaaa-0000-4000-8000-000000000001';
const THEM = 'bbbbbbbb-0000-4000-8000-000000000002';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) },
  useLocalSearchParams: () => ({ id: 'cccccccc-0000-4000-8000-000000000003' }),
  // The thread is always the focused screen in these tests.
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
jest.mock('../api/shares', () => ({ shareAlbum: jest.fn(), sharePrivateCard: jest.fn() }));
jest.mock('../api/identity', () => ({ getSharedPrivateCard: jest.fn() }));
jest.mock('../chat/shareFeed', () => ({ listShareFeed: jest.fn(() => Promise.resolve([])) }));
jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
}));
jest.mock('../chat/video', () => ({
  checkVideo: jest.fn(() => ({ ok: true })),
  VIDEO_REJECTION_COPY: {
    duration: 'that video is too long to send. try one under 30 seconds.',
    size: 'that video is too big to send. try a shorter one.',
  },
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
import { resendChatMedia, signedChatMediaUrls, uploadChatMedia, uploadChatMediaPoster } from '../api/chatMedia';
import { me } from '../api/me';
import { signedPhotoUrls } from '../api/photos';
import { listMyAlbums } from '../api/albums';
import { shareAlbum, sharePrivateCard } from '../api/shares';
import { getSharedPrivateCard } from '../api/identity';
import { listShareFeed } from '../chat/shareFeed';
import { checkVideo, generateVideoPoster } from '../chat/video';
import ChatThreadScreen from '../app/chat/[id]';
import { GoneError, RefusedError, mapSupabaseError } from '../api/errors';

const conversation = (overrides: Record<string, unknown> = {}) => ({
  id: CONV,
  state: 'open',
  openedById: ME,
  blockedBy: null,
  userAId: ME,
  userBId: THEM,
  lastMessageAt: '2026-09-20T11:00:00.000Z',
  createdAt: '2026-09-20T10:00:00.000Z',
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
  created_at: '2026-09-20T11:00:00.000Z',
  ...overrides,
});

function renderScreen(client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })) {
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
  (sendMessage as jest.Mock).mockResolvedValue(message({ id: 'sent' }));
  (signedChatMediaUrls as jest.Mock).mockResolvedValue({});
  (signedPhotoUrls as jest.Mock).mockResolvedValue({});
  (listMyAlbums as jest.Mock).mockResolvedValue([]);
  (listRecentlySharedMedia as jest.Mock).mockResolvedValue([]);
  (checkVideo as jest.Mock).mockReturnValue({ ok: true });
  (generateVideoPoster as jest.Mock).mockResolvedValue(null);
});

/** Opens the share tray (the plus button) and taps "a photo or video" — lands on the pick sheet (`Chat-Share.html` + §5/§7's tray). */
async function openMediaPickSheet(screen: Awaited<ReturnType<typeof renderScreen>>) {
  await fireEvent.press(await screen.findByTestId('composer-attach'));
  await fireEvent.press(await screen.findByTestId('share-sheet-photo'));
  await screen.findByTestId('media-pick-sheet');
}

/** Pick sheet -> library picker -> preview step, for a given picker result. */
async function pickFromLibrary(screen: Awaited<ReturnType<typeof renderScreen>>, asset: Record<string, unknown>) {
  await openMediaPickSheet(screen);
  (ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
  (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({ canceled: false, assets: [asset] });
  await fireEvent.press(screen.getByTestId('media-pick-library'));
}

describe('thread — composer gating', () => {
  it('is open for both sides in an open thread, with media attach', async () => {
    const screen = await renderScreen();
    expect(await screen.findByTestId('composer-input')).toBeTruthy();
    expect(screen.getByTestId('composer-attach')).toBeTruthy();
  });

  it('caps the opener’s first message at 240 and hides the attach button', async () => {
    (getConversation as jest.Mock).mockResolvedValue(
      conversation({ state: 'awaiting_reply', openedById: ME })
    );
    (listMessages as jest.Mock).mockResolvedValue({ messages: [], nextCursor: null });

    const screen = await renderScreen();
    const input = await screen.findByTestId('composer-input');
    expect(input.props.maxLength).toBe(240);
    expect(screen.queryByTestId('composer-attach')).toBeNull();
  });

  it('locks the opener once they have sent, with "waiting for a reply"', async () => {
    (getConversation as jest.Mock).mockResolvedValue(
      conversation({ state: 'awaiting_reply', openedById: ME })
    );
    (listMessages as jest.Mock).mockResolvedValue({
      messages: [message({ sender_id: ME })],
      nextCursor: null,
    });

    const screen = await renderScreen();
    expect(await screen.findByTestId('composer-locked-awaiting_reply')).toHaveTextContent(
      'Waiting for a reply.'
    );
    expect(screen.queryByTestId('composer-input')).toBeNull();
  });

  it('tells the hi’d-back recipient plainly that the opener speaks first', async () => {
    (getConversation as jest.Mock).mockResolvedValue(
      conversation({ state: 'awaiting_reply', openedById: THEM })
    );
    (listMessages as jest.Mock).mockResolvedValue({ messages: [], nextCursor: null });

    const screen = await renderScreen();
    expect(await screen.findByTestId('composer-locked-awaiting_opener')).toHaveTextContent(
      'Waiting for them to say hi first.'
    );
  });

  it('renders an expired thread read-only, with no reason', async () => {
    (getConversation as jest.Mock).mockResolvedValue(conversation({ state: 'expired' }));
    const screen = await renderScreen();

    expect(await screen.findByTestId('composer-locked')).toBeTruthy();
    expect(screen.queryByTestId('composer-input')).toBeNull();
    // The thread itself stays readable.
    expect(screen.getByTestId('message-m1')).toBeTruthy();
    for (const word of ['block', 'expired', 'deleted', 'report']) {
      expect(screen.queryByText(new RegExp(word, 'i'))).toBeNull();
    }
  });

  it('locks a closed_deleted row defensively with the same neutral line (never delivered since migration 0014)', async () => {
    (getConversation as jest.Mock).mockResolvedValue(conversation({ state: 'closed_deleted' }));
    const screen = await renderScreen();
    expect(await screen.findByTestId('composer-locked')).toHaveTextContent(
      'This conversation is closed.'
    );
  });

  it('renders a shadow-accepted thread exactly like an open one', async () => {
    (getConversation as jest.Mock).mockResolvedValue(
      conversation({ state: 'closed_block', blockedBy: THEM })
    );
    const screen = await renderScreen();

    expect(await screen.findByTestId('composer-input')).toBeTruthy();
    // The attach button stays — disabling it would be the tell.
    expect(screen.getByTestId('composer-attach')).toBeTruthy();
    expect(screen.queryByTestId('composer-locked')).toBeNull();
  });

});

describe('thread — gone (migration 0014, decision 90)', () => {
  const NO_REASON = /banned|suspended|deleted|blocked|available|closed/i;

  it('leaves an unreadable conversation straight away, saying nothing', async () => {
    (getConversation as jest.Mock).mockResolvedValue(null);
    const screen = await renderScreen();
    await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('thread-gone')).toBeTruthy();
    expect(screen.queryByText(NO_REASON)).toBeNull();
  });

  it('falls back to the chat list when there is nothing to go back to', async () => {
    (router.canGoBack as jest.Mock).mockReturnValueOnce(false);
    (getConversation as jest.Mock).mockResolvedValue(null);
    await renderScreen();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/chats'));
    expect(router.back).not.toHaveBeenCalled();
  });

  it('when a refetch comes back empty: drops the thread and the person from the caches and leaves, once', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    client.setQueryData(['conversations'], [{ id: CONV, other: { id: THEM } }, { id: 'other-conv', other: { id: 'x' } }]);
    client.setQueryData(['his_received'], [{ id: 'hi-1', fromUserId: THEM }, { id: 'hi-2', fromUserId: 'x' }]);
    client.setQueryData(['grid_for_me'], [{ user_id: THEM }, { user_id: 'x' }]);

    const screen = await renderScreen(client);
    await screen.findByTestId('composer-input');
    expect(router.back).not.toHaveBeenCalled();

    (getConversation as jest.Mock).mockResolvedValue(null);
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['conversation', CONV] });
    });

    await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('thread-gone')).toBeTruthy();
    expect(client.getQueryData(['conversations'])).toEqual([{ id: 'other-conv', other: { id: 'x' } }]);
    expect(client.getQueryData(['his_received'])).toEqual([{ id: 'hi-2', fromUserId: 'x' }]);
    expect(client.getQueryData(['grid_for_me'])).toEqual([{ user_id: 'x' }]);
    // The data is gone (the still-mounted, disabled observer may hold an empty
    // placeholder until the screen unmounts).
    expect(client.getQueryData(['conversation', CONV])).toBeUndefined();
    expect(client.getQueryData(['messages', CONV])).toBeUndefined();

    // No loop: the dropped queries are disabled, so nothing re-reads them.
    const calls = (getConversation as jest.Mock).mock.calls.length;
    const messageCalls = (listMessages as jest.Mock).mock.calls.length;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect((getConversation as jest.Mock).mock.calls.length).toBe(calls);
    expect((listMessages as jest.Mock).mock.calls.length).toBe(messageCalls);
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('a send answered with "conversation not found" leaves no failed bubble and no retry, and leaves the thread', async () => {
    (sendMessage as jest.Mock).mockRejectedValue(new GoneError());
    const screen = await renderScreen();
    await fireEvent.changeText(await screen.findByTestId('composer-input'), 'still there?');
    await fireEvent.press(screen.getByTestId('composer-send'));

    await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(screen.queryAllByTestId(/^message-retry-/)).toHaveLength(0);
    expect(screen.queryByText(NO_REASON)).toBeNull();
  });

  it('a refused share re-reads the thread, and leaves when the thread is gone', async () => {
    (sharePrivateCard as jest.Mock).mockRejectedValue(new RefusedError());
    const screen = await renderScreen();
    await fireEvent.press(await screen.findByTestId('composer-attach'));
    (getConversation as jest.Mock).mockResolvedValue(null);
    await fireEvent.press(await screen.findByTestId('share-sheet-card'));

    await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));
    expect(sharePrivateCard).toHaveBeenCalledTimes(1);
  });

  it('a refused share in a live thread stays put, with the neutral line', async () => {
    (sharePrivateCard as jest.Mock).mockRejectedValue(new RefusedError());
    const screen = await renderScreen();
    await fireEvent.press(await screen.findByTestId('composer-attach'));
    await fireEvent.press(await screen.findByTestId('share-sheet-card'));

    await waitFor(() => expect(screen.getByText("That didn't work.")).toBeTruthy());
    await waitFor(() => expect((getConversation as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(router.back).not.toHaveBeenCalled();
  });
});

describe('thread — optimistic send', () => {
  it('shows the bubble immediately, then reconciles with the server row', async () => {
    let resolveSend: (value: unknown) => void = () => {};
    (sendMessage as jest.Mock).mockImplementation(
      () => new Promise((resolve) => (resolveSend = resolve))
    );

    const screen = await renderScreen();
    const input = await screen.findByTestId('composer-input');
    await fireEvent.changeText(input, 'hello there');
    await fireEvent.press(screen.getByTestId('composer-send'));

    await waitFor(() => expect(screen.getByText('hello there')).toBeTruthy());
    expect(screen.getAllByTestId(/^message-sending-/).length).toBe(1);

    resolveSend(message({ id: 'server-1', sender_id: ME, body: 'hello there' }));
    await waitFor(() => expect(screen.queryAllByTestId(/^message-sending-/).length).toBe(0));
  });

  it('rolls back to a retryable failure when the trigger refuses', async () => {
    (sendMessage as jest.Mock).mockRejectedValue(new Error("That didn't work."));

    const screen = await renderScreen();
    await fireEvent.changeText(await screen.findByTestId('composer-input'), 'nope');
    await fireEvent.press(screen.getByTestId('composer-send'));

    await waitFor(() => expect(screen.getAllByTestId(/^message-retry-/).length).toBe(1));
    // Generic copy only — the refusal reason is never surfaced.
    expect(screen.getByText(/Couldn't send/)).toBeTruthy();
    expect(screen.queryByText(/not allowed|blocked|opener/i)).toBeNull();
    // The text the user typed is still on screen, not silently discarded.
    expect(screen.getByText('nope')).toBeTruthy();
  });

  it('retries the failed row with the same id, so no duplicate is created', async () => {
    (sendMessage as jest.Mock).mockRejectedValueOnce(new Error('nope'));

    const screen = await renderScreen();
    await fireEvent.changeText(await screen.findByTestId('composer-input'), 'again');
    await fireEvent.press(screen.getByTestId('composer-send'));
    await waitFor(() => expect(screen.getAllByTestId(/^message-retry-/).length).toBe(1));

    const firstId = (sendMessage as jest.Mock).mock.calls[0]![0].id;
    (sendMessage as jest.Mock).mockResolvedValue(message({ id: firstId }));
    await fireEvent.press(screen.getByTestId(`message-retry-${firstId}`));

    await waitFor(() => expect((sendMessage as jest.Mock).mock.calls.length).toBe(2));
    expect((sendMessage as jest.Mock).mock.calls[1]![0].id).toBe(firstId);
  });

  it('sends only body for a text message — never a media path', async () => {
    const screen = await renderScreen();
    await fireEvent.changeText(await screen.findByTestId('composer-input'), 'plain');
    await fireEvent.press(screen.getByTestId('composer-send'));

    await waitFor(() => expect(sendMessage).toHaveBeenCalled());
    expect((sendMessage as jest.Mock).mock.calls[0]![0]).toMatchObject({
      conversationId: CONV,
      body: 'plain',
      mediaPath: null,
    });
  });

  it('will not send whitespace', async () => {
    const screen = await renderScreen();
    await fireEvent.changeText(await screen.findByTestId('composer-input'), '   ');
    await fireEvent.press(screen.getByTestId('composer-send'));
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe('thread — chat media send flow', () => {
  it('opens the pick sheet, offering the recently-shared tray plus library/camera', async () => {
    (listRecentlySharedMedia as jest.Mock).mockResolvedValue([
      {
        messageId: 'old-1',
        conversationId: CONV,
        mediaPath: `${CONV}/old-1.jpg`,
        mediaKind: 'photo',
        mediaWidth: 100,
        mediaHeight: 100,
        mediaPosterPath: null,
        createdAt: '2026-09-19T00:00:00.000Z',
      },
    ]);

    const screen = await renderScreen();
    await openMediaPickSheet(screen);

    expect(screen.getByTestId('media-pick-library')).toBeTruthy();
    expect(screen.getByTestId('media-pick-camera')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('recently-shared-tray')).toBeTruthy());
    expect(screen.getByTestId('recently-shared-item-old-1')).toBeTruthy();
  });

  it('shows the empty state when nothing has been recently shared', async () => {
    const screen = await renderScreen();
    await openMediaPickSheet(screen);
    await waitFor(() => expect(screen.getByTestId('recently-shared-empty')).toBeTruthy());
  });

  it('uploads a picked photo to chat-media (default: keep in chat) and inserts with the same id', async () => {
    const screen = await renderScreen();
    (uploadChatMedia as jest.Mock).mockResolvedValue(`${CONV}/mid.jpg`);

    await pickFromLibrary(screen, { uri: 'file:///pick.jpg', width: 3000, height: 2000, type: 'image' });
    await screen.findByTestId('media-preview-sheet');
    await fireEvent.press(screen.getByTestId('media-preview-send'));

    await waitFor(() => expect(sendMessage).toHaveBeenCalled());
    const uploadArgs = (uploadChatMedia as jest.Mock).mock.calls[0]![0];
    const sendArgs = (sendMessage as jest.Mock).mock.calls[0]![0];
    expect(uploadArgs.conversationId).toBe(CONV);
    expect(uploadArgs.kind).toBe('photo');
    expect(uploadArgs.bucket).toBe('chat-media');
    expect(sendArgs.id).toBe(uploadArgs.messageId);
    expect(sendArgs.mediaPath).toBe(`${CONV}/mid.jpg`);
    expect(sendArgs.mediaKind).toBe('photo');
    expect(sendArgs.viewLimit).toBeNull();
    expect(sendArgs.body).toBeNull();
  });

  it('uploads to chat-media-limited when "view once" is chosen', async () => {
    const screen = await renderScreen();
    (uploadChatMedia as jest.Mock).mockResolvedValue(`${CONV}/mid.jpg`);

    await pickFromLibrary(screen, { uri: 'file:///pick.jpg', width: 100, height: 100, type: 'image' });
    await screen.findByTestId('media-preview-sheet');
    await fireEvent.press(screen.getByTestId('media-preview-option-once'));
    await fireEvent.press(screen.getByTestId('media-preview-send'));

    await waitFor(() => expect(sendMessage).toHaveBeenCalled());
    expect((uploadChatMedia as jest.Mock).mock.calls[0]![0].bucket).toBe('chat-media-limited');
    expect((sendMessage as jest.Mock).mock.calls[0]![0].viewLimit).toBe(1);
  });

  it('uploads to chat-media-limited when "view twice" is chosen', async () => {
    const screen = await renderScreen();
    (uploadChatMedia as jest.Mock).mockResolvedValue(`${CONV}/mid.jpg`);

    await pickFromLibrary(screen, { uri: 'file:///pick.jpg', width: 100, height: 100, type: 'image' });
    await screen.findByTestId('media-preview-sheet');
    await fireEvent.press(screen.getByTestId('media-preview-option-twice'));
    await fireEvent.press(screen.getByTestId('media-preview-send'));

    await waitFor(() => expect(sendMessage).toHaveBeenCalled());
    expect((uploadChatMedia as jest.Mock).mock.calls[0]![0].bucket).toBe('chat-media-limited');
    expect((sendMessage as jest.Mock).mock.calls[0]![0].viewLimit).toBe(2);
  });

  it('generates and uploads a poster for a video, and sends the video columns', async () => {
    const screen = await renderScreen();
    (uploadChatMedia as jest.Mock).mockResolvedValue(`${CONV}/mid.mp4`);
    (uploadChatMediaPoster as jest.Mock).mockResolvedValue(`${CONV}/mid-poster.jpg`);
    (generateVideoPoster as jest.Mock).mockResolvedValue({ uri: 'file:///poster.jpg' });

    await pickFromLibrary(screen, {
      uri: 'file:///pick.mp4',
      width: 1080,
      height: 1920,
      type: 'video',
      duration: 12_000,
      fileSize: 4_000_000,
    });
    await screen.findByTestId('media-preview-sheet');
    await fireEvent.press(screen.getByTestId('media-preview-send'));

    await waitFor(() => expect(sendMessage).toHaveBeenCalled());
    expect((uploadChatMedia as jest.Mock).mock.calls[0]![0].kind).toBe('video');
    expect(uploadChatMediaPoster).toHaveBeenCalled();
    const sendArgs = (sendMessage as jest.Mock).mock.calls[0]![0];
    expect(sendArgs.mediaKind).toBe('video');
    expect(sendArgs.mediaDurationMs).toBe(12_000);
    expect(sendArgs.mediaBytes).toBe(4_000_000);
    expect(sendArgs.mediaPosterPath).toBe(`${CONV}/mid-poster.jpg`);
  });

  it('asks the picker for the chat options (30 s cap; iOS 720p H.264 export)', async () => {
    const screen = await renderScreen();
    await pickFromLibrary(screen, { uri: 'file:///pick.jpg', width: 10, height: 10, type: 'image' });
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(
      expect.objectContaining({ mediaTypes: ['images', 'videos'], videoMaxDuration: 30, videoExportPreset: 6 })
    );
  });

  it('still sends a video when its poster cannot be uploaded, without a poster, quietly', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const screen = await renderScreen();
    (uploadChatMedia as jest.Mock).mockResolvedValue(`${CONV}/mid.mp4`);
    (uploadChatMediaPoster as jest.Mock).mockRejectedValue(
      Object.assign(new Error("Call to function 'FileSystemFile.bytes' has been rejected."), { code: 'ERR_INVALID_PERMISSION' })
    );
    (generateVideoPoster as jest.Mock).mockResolvedValue({ uri: 'file:///poster.jpg' });

    await pickFromLibrary(screen, { uri: 'file:///pick.mp4', width: 1080, height: 1920, type: 'video', duration: 4_000, fileSize: 4_486_337 });
    await screen.findByTestId('media-preview-sheet');
    await fireEvent.press(screen.getByTestId('media-preview-send'));

    await waitFor(() => expect(sendMessage).toHaveBeenCalled());
    const sendArgs = (sendMessage as jest.Mock).mock.calls[0]![0];
    expect(sendArgs.mediaPath).toBe(`${CONV}/mid.mp4`);
    expect(sendArgs.mediaPosterPath).toBeNull();
    expect(screen.queryByTestId('media-preview-error')).toBeNull();
    // Logged in dev at a level that doesn't raise a LogBox banner.
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('poster'));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('ERR_INVALID_PERMISSION'));
    warn.mockRestore();
    log.mockRestore();
  });

  it('logs what the picker handed over, in dev, at the start of a send', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const screen = await renderScreen();
    await pickFromLibrary(screen, {
      uri: 'content://media/external/video/1',
      width: 1080,
      height: 1920,
      type: 'video',
      duration: 4_000,
      fileSize: 4_486_337,
      mimeType: 'video/mp4',
    });
    await screen.findByTestId('media-preview-sheet');
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/picked type=video mime=video\/mp4 size=4486337 dims=1080x1920 durationMs=4000 uri=content:/)
    );
    log.mockRestore();
  });

  it('says a video is too big, and what to do, when the server refuses its size', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    (uploadChatMedia as jest.Mock).mockRejectedValue(
      mapSupabaseError(Object.assign(new Error('The object exceeded the maximum allowed size'), { status: 400, statusCode: '413' }))
    );
    const screen = await renderScreen();
    await pickFromLibrary(screen, { uri: 'file:///pick.mp4', width: 10, height: 10, type: 'video', duration: 4_000 });
    await screen.findByTestId('media-preview-sheet');
    await fireEvent.press(screen.getByTestId('media-preview-send'));
    await waitFor(() =>
      expect(screen.getByTestId('media-preview-error')).toHaveTextContent('that video is too big to send. try a shorter one.')
    );
    expect(sendMessage).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('rejects an over-long video before any upload, with plain copy', async () => {
    (checkVideo as jest.Mock).mockReturnValue({ ok: false, reason: 'duration' });
    const screen = await renderScreen();

    await pickFromLibrary(screen, { uri: 'file:///long.mp4', width: 100, height: 100, type: 'video', duration: 40_000 });

    expect(await screen.findByTestId('media-pick-error')).toHaveTextContent(/30 seconds/);
    expect(uploadChatMedia).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    // Stays on the pick sheet rather than jumping to the preview.
    expect(screen.queryByTestId('media-preview-sheet')).toBeNull();
  });

  it('rejects an over-large video before any upload, with plain copy', async () => {
    (checkVideo as jest.Mock).mockReturnValue({ ok: false, reason: 'size' });
    const screen = await renderScreen();

    await pickFromLibrary(screen, { uri: 'file:///big.mp4', width: 100, height: 100, type: 'video', fileSize: 99_000_000 });

    expect(await screen.findByTestId('media-pick-error')).toHaveTextContent('that video is too big to send. try a shorter one.');
    expect(uploadChatMedia).not.toHaveBeenCalled();
  });

  it('does not insert a row when the upload is refused', async () => {
    (uploadChatMedia as jest.Mock).mockRejectedValue(new Error('refused'));
    const screen = await renderScreen();

    await pickFromLibrary(screen, { uri: 'file:///pick.jpg', width: 10, height: 10, type: 'image' });
    await screen.findByTestId('media-preview-sheet');
    await fireEvent.press(screen.getByTestId('media-preview-send'));

    await waitFor(() => expect(screen.getByTestId('media-preview-error')).toBeTruthy());
    expect(sendMessage).not.toHaveBeenCalled();
    // A refusal reads exactly like a dropped network (decision 24).
    expect(screen.getByTestId('media-preview-error')).toHaveTextContent("couldn't send. try again.");
  });

  it('says so when the server refuses the file type, without the server text', async () => {
    // The shape storage-js rejects with, wrapped the way api/chatMedia wraps it.
    const storageError = Object.assign(new Error('mime type text/plain is not supported'), {
      name: 'StorageApiError',
      status: 400,
      statusCode: '415',
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    (uploadChatMedia as jest.Mock).mockRejectedValue(mapSupabaseError(storageError));
    const screen = await renderScreen();

    await pickFromLibrary(screen, { uri: 'file:///pick.jpg', width: 10, height: 10, type: 'image' });
    await screen.findByTestId('media-preview-sheet');
    await fireEvent.press(screen.getByTestId('media-preview-send'));

    await waitFor(() =>
      expect(screen.getByTestId('media-preview-error')).toHaveTextContent("that file type can't be sent.")
    );
    expect(screen.queryByText(/mime|text\/plain/i)).toBeNull();
    expect(sendMessage).not.toHaveBeenCalled();
    // Development builds name the step and the underlying error.
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/\[upload\] chat media failed at upload: reason=unsupported .*statusCode=415/));
    warn.mockRestore();
  });

  it('does nothing when the picker is cancelled — stays on the pick sheet', async () => {
    const screen = await renderScreen();
    await openMediaPickSheet(screen);
    (ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({ canceled: true });

    await fireEvent.press(screen.getByTestId('media-pick-library'));

    await waitFor(() => expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalled());
    expect(uploadChatMedia).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(screen.getByTestId('media-pick-sheet')).toBeTruthy();
  });

  it('offers the camera as an alternative to the library', async () => {
    const screen = await renderScreen();
    await openMediaPickSheet(screen);
    (ImagePicker.requestCameraPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
    (ImagePicker.launchCameraAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///cam.jpg', width: 100, height: 100, type: 'image' }],
    });
    (uploadChatMedia as jest.Mock).mockResolvedValue(`${CONV}/cam.jpg`);

    await fireEvent.press(screen.getByTestId('media-pick-camera'));
    await screen.findByTestId('media-preview-sheet');
    await fireEvent.press(screen.getByTestId('media-preview-send'));

    await waitFor(() => expect(sendMessage).toHaveBeenCalled());
  });

  it('re-sends a tray item via resendChatMedia rather than re-uploading local bytes', async () => {
    (listRecentlySharedMedia as jest.Mock).mockResolvedValue([
      {
        messageId: 'old-1',
        conversationId: 'old-conv',
        mediaPath: 'old-conv/old-1.jpg',
        mediaKind: 'photo',
        mediaWidth: 200,
        mediaHeight: 200,
        mediaPosterPath: null,
        createdAt: '2026-09-19T00:00:00.000Z',
      },
    ]);
    (signedChatMediaUrls as jest.Mock).mockResolvedValue({ 'old-conv/old-1.jpg': 'https://signed/old-1.jpg' });
    (resendChatMedia as jest.Mock).mockResolvedValue({ mediaPath: `${CONV}/new-1.jpg`, posterPath: null });

    const screen = await renderScreen();
    await openMediaPickSheet(screen);
    await waitFor(() => expect(screen.getByTestId('recently-shared-item-old-1')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('recently-shared-item-old-1'));
    await screen.findByTestId('media-preview-sheet');
    await fireEvent.press(screen.getByTestId('media-preview-send'));

    await waitFor(() => expect(sendMessage).toHaveBeenCalled());
    expect(uploadChatMedia).not.toHaveBeenCalled();
    expect(resendChatMedia).toHaveBeenCalledWith(
      expect.objectContaining({ sourcePath: 'old-conv/old-1.jpg', targetConversationId: CONV, kind: 'photo', viewLimit: null })
    );
    expect((sendMessage as jest.Mock).mock.calls[0]![0].mediaPath).toBe(`${CONV}/new-1.jpg`);
  });
});

describe('thread — reads and realtime', () => {
  it('marks the thread read against the newest message on open', async () => {
    const screen = await renderScreen();
    await screen.findByTestId('message-m1');
    await waitFor(() => expect(markRead).toHaveBeenCalled());
    expect((markRead as jest.Mock).mock.calls[0]![0]).toBe(CONV);
    expect((markRead as jest.Mock).mock.calls[0]![1]).toMatchObject({ id: 'm1' });
  });

  it('does not re-mark the same newest message twice', async () => {
    const screen = await renderScreen();
    await screen.findByTestId('message-m1');
    await waitFor(() => expect(markRead).toHaveBeenCalledTimes(1));
    threadHandlers?.onInvalidate?.();
    await waitFor(() => expect(markRead).toHaveBeenCalledTimes(1));
  });

  it('refetches the thread and the conversation on a realtime insert', async () => {
    const screen = await renderScreen();
    await screen.findByTestId('message-m1');
    (listMessages as jest.Mock).mockClear();
    (getConversation as jest.Mock).mockClear();

    threadHandlers?.onMessage(message({ id: 'm2' }));

    await waitFor(() => expect(listMessages).toHaveBeenCalled());
    await waitFor(() => expect(getConversation).toHaveBeenCalled());
  });

  it('refetches on a realtime UPDATE too, so a sender bubble picks up the new views_used', async () => {
    // The sender's own limited send, unopened.
    (listMessages as jest.Mock).mockResolvedValue({
      messages: [message({ id: 'm1', sender_id: ME, media_path: `${CONV}/m1.jpg`, media_kind: 'photo', view_limit: 1, views_used: 0 })],
      nextCursor: null,
    });

    const screen = await renderScreen();
    await screen.findByText('Photo · view once');
    (listMessages as jest.Mock).mockClear();
    (listMessages as jest.Mock).mockResolvedValue({
      messages: [message({ id: 'm1', sender_id: ME, media_path: `${CONV}/m1.jpg`, media_kind: 'photo', view_limit: 1, views_used: 1 })],
      nextCursor: null,
    });

    // The realtime UPDATE event itself — the handler doesn't need to inspect
    // its payload, it just invalidates and refetches (§3/§5).
    threadHandlers?.onMessage({ id: 'm1', eventType: 'UPDATE', view_limit: 1, views_used: 1 });

    await waitFor(() => expect(listMessages).toHaveBeenCalled());
    await screen.findByText('Opened');
  });

  it('links the header to the other participant’s profile', async () => {
    const screen = await renderScreen();
    await fireEvent.press(await screen.findByTestId('thread-header-profile'));
    expect(router.push).toHaveBeenCalledWith(`/profile/${THEM}`);
  });

  it('routes Block and Report with context=chat', async () => {
    const screen = await renderScreen();
    await fireEvent.press(await screen.findByTestId('thread-overflow'));

    await fireEvent.press(screen.getByTestId('thread-menu-block'));
    expect(router.push).toHaveBeenCalledWith(`/settings/block/${THEM}?context=chat`);

    await fireEvent.press(screen.getByTestId('thread-overflow'));
    await fireEvent.press(screen.getByTestId('thread-menu-report'));
    expect(router.push).toHaveBeenCalledWith(`/settings/report/${THEM}?context=chat`);
  });

  it('paginates with the cursor from the previous page', async () => {
    (listMessages as jest.Mock).mockResolvedValueOnce({
      messages: [message()],
      nextCursor: '2026-09-20T09:00:00.000Z',
    });
    const screen = await renderScreen();
    const list = await screen.findByTestId('thread-list');

    (listMessages as jest.Mock).mockResolvedValueOnce({ messages: [], nextCursor: null });
    await fireEvent(list, 'endReached');

    await waitFor(() => expect((listMessages as jest.Mock).mock.calls.length).toBeGreaterThan(1));
    expect((listMessages as jest.Mock).mock.calls[1]![1]).toBe('2026-09-20T09:00:00.000Z');
  });

  it('renders the thread inverted', async () => {
    const screen = await renderScreen();
    expect((await screen.findByTestId('thread-list')).props.inverted).toBe(true);
  });

  it('opens the media viewer route on a limited bubble tap', async () => {
    (listMessages as jest.Mock).mockResolvedValue({
      messages: [message({ id: 'm1', sender_id: THEM, media_path: `${CONV}/m1.jpg`, media_kind: 'photo', view_limit: 1, views_used: 0 })],
      nextCursor: null,
    });
    const screen = await renderScreen();
    await fireEvent.press(await screen.findByTestId('message-limited-press-m1'));
    expect(router.push).toHaveBeenCalledWith(`/chat/${CONV}/media/m1`);
  });
});

describe('thread — share sheet', () => {
  it('offers a photo, an album, and the private card when the thread is open', async () => {
    const screen = await renderScreen();
    await fireEvent.press(await screen.findByTestId('composer-attach'));

    expect(await screen.findByTestId('share-sheet-photo')).toBeTruthy();
    expect(screen.getByTestId('share-sheet-album')).toBeTruthy();
    expect(screen.getByTestId('share-sheet-card')).toBeTruthy();
  });

  it('shares an album with the other participant and closes the tray', async () => {
    (listMyAlbums as jest.Mock).mockResolvedValue([
      { id: 'album-1', owner_id: ME, name: 'more of me', photo_count: 3, created_at: '2026-09-20T09:00:00.000Z' },
    ]);
    (shareAlbum as jest.Mock).mockResolvedValue({
      id: 'share-1',
      owner_id: ME,
      viewer_id: THEM,
      subject_type: 'album',
      subject_id: 'album-1',
      created_at: '2026-09-20T12:00:00.000Z',
      revoked_at: null,
    });

    const screen = await renderScreen();
    await fireEvent.press(await screen.findByTestId('composer-attach'));
    await fireEvent.press(await screen.findByTestId('share-sheet-album'));
    await fireEvent.press(await screen.findByTestId('share-sheet-album-album-1'));

    await waitFor(() => expect(shareAlbum).toHaveBeenCalledWith('album-1', THEM));
    await waitFor(() => expect(screen.queryByTestId('share-sheet')).toBeNull());
  });

  it('shares the private card with the other participant', async () => {
    (sharePrivateCard as jest.Mock).mockResolvedValue({
      id: 'share-2',
      owner_id: ME,
      viewer_id: THEM,
      subject_type: 'private_card',
      subject_id: ME,
      created_at: '2026-09-20T12:00:00.000Z',
      revoked_at: null,
    });

    const screen = await renderScreen();
    await fireEvent.press(await screen.findByTestId('composer-attach'));
    await fireEvent.press(await screen.findByTestId('share-sheet-card'));

    await waitFor(() => expect(sharePrivateCard).toHaveBeenCalledWith(THEM));
  });

  it('disables album and private-card sharing with neutral copy outside an open thread — never a reason', async () => {
    (getConversation as jest.Mock).mockResolvedValue(
      conversation({ state: 'closed_block', blockedBy: THEM })
    );

    const screen = await renderScreen();
    await fireEvent.press(await screen.findByTestId('composer-attach'));

    const albumRow = await screen.findByTestId('share-sheet-album');
    expect(albumRow.props.accessibilityState?.disabled).toBe(true);
    const cardRow = screen.getByTestId('share-sheet-card');
    expect(cardRow.props.accessibilityState?.disabled).toBe(true);

    await fireEvent.press(albumRow);
    expect(shareAlbum).not.toHaveBeenCalled();
    for (const word of ['block', 'expired', 'deleted']) {
      expect(screen.queryByText(new RegExp(word, 'i'))).toBeNull();
    }
  });
});

describe('private card share bubbles', () => {
  const cardShare = (overrides: Record<string, unknown> = {}) => ({
    id: 'share-card',
    kind: 'private_card',
    ownerId: THEM,
    viewerId: ME,
    subjectId: THEM,
    createdAt: '2026-09-20T10:30:00.000Z',
    ...overrides,
  });

  it("opens the full card they shared with me, through PrivateCardSheet", async () => {
    (listShareFeed as jest.Mock).mockResolvedValue([cardShare()]);
    (getSharedPrivateCard as jest.Mock).mockResolvedValue({ into: ['hiking'], safer_sex: [], kinks: [], hard_nos: ['smoking'] });
    const screen = await renderScreen();

    await fireEvent.press(await screen.findByTestId('share-bubble-press-share-card'));
    await screen.findByTestId('private-card-sheet');
    await screen.findByTestId('private-card-sheet-card-group-hard_nos');
    expect(getSharedPrivateCard).toHaveBeenCalledWith(THEM);
    expect(router.push).not.toHaveBeenCalledWith(`/profile/${THEM}`);
  });

  it('closes the card sheet and drops the bubble when the card read comes back empty, without a word', async () => {
    // The first read has the bubble; every later one (after the card read came
    // back empty) no longer does.
    (listShareFeed as jest.Mock).mockResolvedValueOnce([cardShare()]).mockResolvedValue([]);
    (getSharedPrivateCard as jest.Mock).mockResolvedValue(null);
    const screen = await renderScreen();

    await fireEvent.press(await screen.findByTestId('share-bubble-press-share-card'));

    await waitFor(() => expect(screen.queryByTestId('private-card-sheet')).toBeNull());
    await waitFor(() => expect(screen.queryByTestId('share-bubble-press-share-card')).toBeNull());
    expect(screen.queryByText(/sharing|available/i)).toBeNull();
    // The thread itself is still readable, so it stays.
    expect(router.back).not.toHaveBeenCalled();
  });

  it('my own card bubble opens my private card screen', async () => {
    (listShareFeed as jest.Mock).mockResolvedValue([cardShare({ ownerId: ME, viewerId: THEM, subjectId: ME })]);
    const screen = await renderScreen();

    await fireEvent.press(await screen.findByTestId('share-bubble-press-share-card'));
    expect(router.push).toHaveBeenCalledWith('/me/private-card');
    expect(getSharedPrivateCard).not.toHaveBeenCalled();
  });
});
