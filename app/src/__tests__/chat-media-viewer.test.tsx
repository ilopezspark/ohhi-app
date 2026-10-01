/**
 * The full-screen media viewer (`docs/chat-media-plan.md` §4/§7):
 * `app/chat/[id]/media/[messageId].tsx`. Covers both read paths (keep-in-chat
 * through `chat-media`, limited through `media-open`), the generic 404
 * handling, the recipient-exhausted signal, and that closing the screen
 * refreshes the thread's cache rather than leaving a stale `views_used`.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const CONV = 'cccccccc-0000-4000-8000-000000000003';
const ME = 'aaaaaaaa-0000-4000-8000-000000000001';
const THEM = 'bbbbbbbb-0000-4000-8000-000000000002';

const mockUseLocalSearchParams = jest.fn();
const mockRouterBack = jest.fn();
const mockRouterReplace = jest.fn();
const mockCanGoBack = jest.fn(() => true);
jest.mock('expo-router', () => ({
  router: { back: (...args: unknown[]) => mockRouterBack(...args), replace: (...args: unknown[]) => mockRouterReplace(...args), canGoBack: () => mockCanGoBack(), push: jest.fn() },
  useLocalSearchParams: (...args: unknown[]) => mockUseLocalSearchParams(...args),
}));

const mockPreventScreenCapture = jest.fn((_key?: string) => Promise.resolve());
const mockAllowScreenCapture = jest.fn((_key?: string) => Promise.resolve());
jest.mock('expo-screen-capture', () => ({
  preventScreenCaptureAsync: (key: string) => mockPreventScreenCapture(key),
  allowScreenCaptureAsync: (key: string) => mockAllowScreenCapture(key),
}));

jest.mock('expo-video', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    useVideoPlayer: (_source: unknown, setup?: (player: unknown) => void) => {
      const player = { play: jest.fn() };
      setup?.(player);
      return player;
    },
    VideoView: (props: { testID?: string }) => React.createElement(View, { testID: props.testID }),
  };
});

jest.mock('../api/client', () => ({ supabase: {}, SUPABASE_URL: 'https://example.test' }));
jest.mock('../api/messages', () => ({ getMessageMedia: jest.fn(), sendMessage: jest.fn() }));
jest.mock('../api/conversations', () => ({ getConversation: jest.fn() }));
jest.mock('../api/chatMedia', () => ({ signedChatMediaUrls: jest.fn() }));
jest.mock('../api/mediaOpen', () => ({ openLimitedMedia: jest.fn() }));
jest.mock('../api/me', () => ({ me: jest.fn() }));

import { getMessageMedia, sendMessage } from '../api/messages';
import { getConversation } from '../api/conversations';
import { signedChatMediaUrls } from '../api/chatMedia';
import { openLimitedMedia } from '../api/mediaOpen';
import { me } from '../api/me';
import { useRecipientExhaustedStore } from '../chat/recipientExhausted';
import ChatMediaViewerScreen from '../app/chat/[id]/media/[messageId]';

const message = (overrides: Record<string, unknown> = {}) => ({
  id: 'm1',
  conversation_id: CONV,
  sender_id: THEM,
  body: null,
  media_path: `${CONV}/m1.jpg`,
  media_kind: 'photo',
  view_limit: null,
  views_used: 0,
  media_duration_ms: null,
  media_bytes: null,
  media_width: null,
  media_height: null,
  media_poster_path: null,
  created_at: '2026-09-28T10:00:00.000Z',
  ...overrides,
});

async function renderScreen(messageId = 'm1') {
  mockUseLocalSearchParams.mockReturnValue({ id: CONV, messageId });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const invalidateSpy = jest.spyOn(client, 'invalidateQueries');
  const screen = await render(
    <QueryClientProvider client={client}>
      <ChatMediaViewerScreen />
    </QueryClientProvider>
  );
  return { screen, client, invalidateSpy };
}

const conversation = (overrides: Record<string, unknown> = {}) => ({
  id: CONV,
  state: 'open',
  openedById: ME,
  blockedBy: null,
  userAId: ME,
  userBId: THEM,
  lastMessageAt: '2026-09-28T10:00:00.000Z',
  createdAt: '2026-09-28T09:00:00.000Z',
  other: { id: THEM, firstName: 'Ada', photoPath: null },
  lastMessage: null,
  lastReadAt: null,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  useRecipientExhaustedStore.setState({ exhausted: {} });
  (me as jest.Mock).mockResolvedValue({ id: ME });
  (getConversation as jest.Mock).mockResolvedValue(conversation());
  (sendMessage as jest.Mock).mockResolvedValue({ id: 'r1' });
});

describe('viewer — keep-in-chat media', () => {
  it('signs through chat-media for a photo and renders it', async () => {
    (getMessageMedia as jest.Mock).mockResolvedValue(message());
    (signedChatMediaUrls as jest.Mock).mockResolvedValue({ [`${CONV}/m1.jpg`]: 'https://signed/m1.jpg' });

    const { screen } = await renderScreen();

    await waitFor(() => expect(screen.getByTestId('chat-media-viewer-image')).toBeTruthy());
    expect(screen.getByTestId('chat-media-viewer-image').props.source).toEqual([{ uri: 'https://signed/m1.jpg' }]);
    expect(openLimitedMedia).not.toHaveBeenCalled();
  });

  it('renders the video player for a keep-in-chat video', async () => {
    (getMessageMedia as jest.Mock).mockResolvedValue(
      message({ media_kind: 'video', media_path: `${CONV}/m1.mp4` })
    );
    (signedChatMediaUrls as jest.Mock).mockResolvedValue({ [`${CONV}/m1.mp4`]: 'https://signed/m1.mp4' });

    const { screen } = await renderScreen();
    await waitFor(() => expect(screen.getByTestId('chat-media-viewer-video')).toBeTruthy());
  });

  it('shows the generic failure when the path no longer signs', async () => {
    (getMessageMedia as jest.Mock).mockResolvedValue(message());
    (signedChatMediaUrls as jest.Mock).mockResolvedValue({});

    const { screen } = await renderScreen();
    await waitFor(() => expect(screen.getByTestId('chat-media-viewer-failed')).toBeTruthy());
    expect(screen.getByText("Couldn't open that.")).toBeTruthy();
  });
});

describe('viewer — limited media', () => {
  it('opens through media-open and renders the returned URL', async () => {
    (getMessageMedia as jest.Mock).mockResolvedValue(message({ view_limit: 1, views_used: 0, sender_id: THEM }));
    (openLimitedMedia as jest.Mock).mockResolvedValue({
      url: 'https://signed/limited.jpg',
      kind: 'photo',
      expiresIn: 60,
      viewsRemaining: 0,
    });

    const { screen } = await renderScreen();
    await waitFor(() => expect(screen.getByTestId('chat-media-viewer-image')).toBeTruthy());
    expect(screen.getByTestId('chat-media-viewer-image').props.source).toEqual([{ uri: 'https://signed/limited.jpg' }]);
    expect(signedChatMediaUrls).not.toHaveBeenCalled();
  });

  it('shows the generic "couldn\'t open" copy on a 404, and marks the recipient exhausted', async () => {
    (getMessageMedia as jest.Mock).mockResolvedValue(message({ view_limit: 1, views_used: 1, sender_id: THEM }));
    (openLimitedMedia as jest.Mock).mockResolvedValue(null);

    const { screen } = await renderScreen();
    await waitFor(() => expect(screen.getByTestId('chat-media-viewer-failed')).toBeTruthy());
    expect(useRecipientExhaustedStore.getState().exhausted['m1']).toBe(true);
  });

  it('does not mark exhausted when the sender previews their own (unopenable) send', async () => {
    (getMessageMedia as jest.Mock).mockResolvedValue(message({ view_limit: 1, views_used: 0, sender_id: ME }));
    (openLimitedMedia as jest.Mock).mockResolvedValue(null);

    const { screen } = await renderScreen();
    await waitFor(() => expect(screen.getByTestId('chat-media-viewer-failed')).toBeTruthy());
    expect(useRecipientExhaustedStore.getState().exhausted['m1']).toBeUndefined();
  });

  it('never calls signedChatMediaUrls for limited media (chat-media-limited has no select policy)', async () => {
    (getMessageMedia as jest.Mock).mockResolvedValue(message({ view_limit: 2, views_used: 0, sender_id: THEM }));
    (openLimitedMedia as jest.Mock).mockResolvedValue({ url: 'https://signed/x.jpg', kind: 'photo', expiresIn: 60, viewsRemaining: 1 });

    const { screen } = await renderScreen();
    await waitFor(() => expect(screen.getByTestId('chat-media-viewer-image')).toBeTruthy());
    expect(signedChatMediaUrls).not.toHaveBeenCalled();
  });
});

describe('viewer — screen capture and cleanup', () => {
  it('prevents screen capture for the lifetime of the screen', async () => {
    (getMessageMedia as jest.Mock).mockResolvedValue(message());
    (signedChatMediaUrls as jest.Mock).mockResolvedValue({ [`${CONV}/m1.jpg`]: 'https://signed/m1.jpg' });

    const { screen } = await renderScreen();
    expect(mockPreventScreenCapture).toHaveBeenCalledWith('chat-media-viewer');
    expect(mockAllowScreenCapture).not.toHaveBeenCalled();
    await screen.unmount();
    expect(mockAllowScreenCapture).toHaveBeenCalledWith('chat-media-viewer');
  });

  it('never lets a screen capture failure escape (web answers "not available")', async () => {
    mockPreventScreenCapture.mockImplementationOnce(() => Promise.reject(new Error('not available on web')));
    (getMessageMedia as jest.Mock).mockResolvedValue(message());
    (signedChatMediaUrls as jest.Mock).mockResolvedValue({ [`${CONV}/m1.jpg`]: 'https://signed/m1.jpg' });

    const { screen } = await renderScreen();
    await waitFor(() => expect(screen.getByTestId('chat-media-viewer-image')).toBeTruthy());
  });

  it('skips screen capture entirely on web', async () => {
    const { Platform } = require('react-native');
    const original = Platform.OS;
    Platform.OS = 'web';
    try {
      (getMessageMedia as jest.Mock).mockResolvedValue(message());
      (signedChatMediaUrls as jest.Mock).mockResolvedValue({ [`${CONV}/m1.jpg`]: 'https://signed/m1.jpg' });
      const { screen } = await renderScreen();
      await waitFor(() => expect(screen.getByTestId('chat-media-viewer-image')).toBeTruthy());
      expect(mockPreventScreenCapture).not.toHaveBeenCalled();
    } finally {
      Platform.OS = original;
    }
  });

  it('refreshes the thread and message caches on unmount, discarding the URL', async () => {
    (getMessageMedia as jest.Mock).mockResolvedValue(message());
    (signedChatMediaUrls as jest.Mock).mockResolvedValue({ [`${CONV}/m1.jpg`]: 'https://signed/m1.jpg' });

    const { screen, invalidateSpy } = await renderScreen();
    await waitFor(() => expect(screen.getByTestId('chat-media-viewer-image')).toBeTruthy());

    await screen.unmount();

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['messages', CONV] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['message-media', 'm1'] });
  });
});

describe('viewer — reply (migration 0017, decision 93)', () => {
  it('replies to the message on screen, in its thread', async () => {
    (getMessageMedia as jest.Mock).mockResolvedValue(message());
    (signedChatMediaUrls as jest.Mock).mockResolvedValue({ [`${CONV}/m1.jpg`]: 'https://signed/m1.jpg' });

    const { screen, invalidateSpy } = await renderScreen();
    const input = await screen.findByTestId('chat-media-viewer-reply-input');
    expect(input.props.accessibilityLabel).toBe('reply to ada');

    await fireEvent.changeText(input, ' nice ');
    await act(async () => {
      fireEvent.press(screen.getByTestId('chat-media-viewer-reply-send'));
    });

    expect(sendMessage).toHaveBeenCalledWith({ conversationId: CONV, body: 'nice', replyTo: { messageId: 'm1' } });
    expect(await screen.findByTestId('chat-media-viewer-reply-sent')).toHaveTextContent('sent');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['messages', CONV] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['badge-counts'] });
  });

  it('says yourself on my own media', async () => {
    (getMessageMedia as jest.Mock).mockResolvedValue(message({ sender_id: ME }));
    (signedChatMediaUrls as jest.Mock).mockResolvedValue({ [`${CONV}/m1.jpg`]: 'https://signed/m1.jpg' });

    const { screen } = await renderScreen();
    const input = await screen.findByTestId('chat-media-viewer-reply-input');
    expect(input.props.accessibilityLabel).toBe('reply to yourself');
  });

  it('replying to limited media never opens it again (no view used) and never re-reads its row', async () => {
    (getMessageMedia as jest.Mock).mockResolvedValue(message({ view_limit: 2, views_used: 0, sender_id: THEM }));
    (openLimitedMedia as jest.Mock).mockResolvedValue({
      url: 'https://signed/limited.jpg',
      kind: 'photo',
      expiresIn: 60,
      viewsRemaining: 1,
    });

    const { screen, invalidateSpy } = await renderScreen();
    await waitFor(() => expect(screen.getByTestId('chat-media-viewer-image')).toBeTruthy());
    expect(openLimitedMedia).toHaveBeenCalledTimes(1);

    const input = await screen.findByTestId('chat-media-viewer-reply-input');
    await fireEvent.changeText(input, 'ha');
    await act(async () => {
      fireEvent.press(screen.getByTestId('chat-media-viewer-reply-send'));
    });
    expect(sendMessage).toHaveBeenCalledWith({ conversationId: CONV, body: 'ha', replyTo: { messageId: 'm1' } });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['message-media', 'm1'] });
    expect(openLimitedMedia).toHaveBeenCalledTimes(1);
  });

  it('no reply bar where the thread does not let them write', async () => {
    (getConversation as jest.Mock).mockResolvedValue(conversation({ state: 'expired' }));
    (getMessageMedia as jest.Mock).mockResolvedValue(message());
    (signedChatMediaUrls as jest.Mock).mockResolvedValue({ [`${CONV}/m1.jpg`]: 'https://signed/m1.jpg' });

    const { screen } = await renderScreen();
    await waitFor(() => expect(screen.getByTestId('chat-media-viewer-image')).toBeTruthy());
    await waitFor(() => expect(getConversation).toHaveBeenCalled());
    expect(screen.queryByTestId('chat-media-viewer-reply')).toBeNull();
  });

  it('a refused reply says only that it did not send', async () => {
    const { RefusedError } = jest.requireActual('../api/errors');
    (sendMessage as jest.Mock).mockRejectedValue(new RefusedError());
    (getMessageMedia as jest.Mock).mockResolvedValue(message());
    (signedChatMediaUrls as jest.Mock).mockResolvedValue({ [`${CONV}/m1.jpg`]: 'https://signed/m1.jpg' });

    const { screen } = await renderScreen();
    const input = await screen.findByTestId('chat-media-viewer-reply-input');
    await fireEvent.changeText(input, 'hm');
    await act(async () => {
      fireEvent.press(screen.getByTestId('chat-media-viewer-reply-send'));
    });
    expect(await screen.findByTestId('chat-media-viewer-reply-failed')).toHaveTextContent("that didn't send. try again.");
  });

  it('back goes to the chats tab when there is no history (reload, deep link)', async () => {
    (getMessageMedia as jest.Mock).mockResolvedValue(message());
    (signedChatMediaUrls as jest.Mock).mockResolvedValue({ [`${CONV}/m1.jpg`]: 'https://signed/m1.jpg' });
    const { screen } = await renderScreen();

    await fireEvent.press(await screen.findByTestId('chat-media-viewer-back'));
    expect(mockRouterBack).toHaveBeenCalledTimes(1);

    mockCanGoBack.mockReturnValueOnce(false);
    await fireEvent.press(screen.getByTestId('chat-media-viewer-back'));
    expect(mockRouterBack).toHaveBeenCalledTimes(1);
    expect(mockRouterReplace).toHaveBeenCalledWith('/(tabs)/chats');
  });
});
