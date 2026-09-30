/**
 * An album video quoted in the thread (migration 0025): the quote signs the
 * video's poster, never the mp4, draws it with a small play mark, and a tap
 * still opens the album story at that item. Photo quotes stay as they were.
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native';
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
jest.mock('../chat/useChatRealtime', () => ({ useConversationRealtime: jest.fn() }));

import { router } from 'expo-router';
import { getConversation } from '../api/conversations';
import { listMessages, listRecentlySharedMedia, markRead, sendMessage } from '../api/messages';
import { messageQuotes } from '../api/replies';
import { signedChatMediaUrls } from '../api/chatMedia';
import { me } from '../api/me';
import { signedPhotoUrls } from '../api/photos';
import { listMyAlbums, signedAlbumPhotoUrls } from '../api/albums';
import ChatThreadScreen from '../app/chat/[id]';

const message = (overrides: Record<string, unknown> = {}) => ({
  id: 'r1',
  conversation_id: CONV,
  sender_id: ME,
  body: 'love this one',
  media_path: null,
  media_kind: null,
  view_limit: null,
  views_used: 0,
  media_duration_ms: null,
  media_bytes: null,
  media_width: null,
  media_height: null,
  media_poster_path: null,
  created_at: '2026-09-29T11:30:00.000Z',
  reply_to_message_id: null,
  reply_to_album_photo_id: 'v1',
  reply_kind: 'album_photo',
  ...overrides,
});

const quote = (overrides: Record<string, unknown> = {}) => ({
  messageId: 'r1',
  replyKind: 'album_photo',
  available: true,
  quotedMessageId: null,
  quotedAlbumPhotoId: 'v1',
  quotedSenderId: THEM,
  quotedCreatedAt: '2026-09-29T10:00:00.000Z',
  excerpt: null,
  mediaKind: 'video',
  isLimited: false,
  mediaPath: `${THEM}/a1/v1.mp4`,
  mediaPosterPath: `${THEM}/a1/v1-poster.jpg`,
  albumId: 'a1',
  ...overrides,
});

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return render(
    <QueryClientProvider client={client}>
      <ChatThreadScreen />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  (me as jest.Mock).mockResolvedValue({ id: ME, status: 'active', verification_status: 'verified' });
  (getConversation as jest.Mock).mockResolvedValue({
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
  });
  (listMessages as jest.Mock).mockResolvedValue({ messages: [message()], nextCursor: null });
  (markRead as jest.Mock).mockResolvedValue(undefined);
  (sendMessage as jest.Mock).mockResolvedValue(message({ id: 'sent' }));
  (signedChatMediaUrls as jest.Mock).mockResolvedValue({});
  (signedPhotoUrls as jest.Mock).mockResolvedValue({});
  (listMyAlbums as jest.Mock).mockResolvedValue([]);
  (listRecentlySharedMedia as jest.Mock).mockResolvedValue([]);
  (messageQuotes as jest.Mock).mockResolvedValue({ r1: quote() });
  (signedAlbumPhotoUrls as jest.Mock).mockImplementation(async (paths: string[]) =>
    Object.fromEntries(paths.map((path) => [path, `https://signed/${path}`]))
  );
});

describe('thread — album video quote', () => {
  it('signs the poster (never the mp4), draws it with a play mark, and opens the story at the video', async () => {
    const screen = await renderScreen();
    await waitFor(() =>
      expect(screen.getByTestId('message-quote-r1-image').props.source).toEqual({
        uri: `https://signed/${THEM}/a1/v1-poster.jpg`,
      })
    );
    expect(screen.getByTestId('message-quote-r1-play')).toBeTruthy();
    expect(screen.getByTestId('message-quote-r1-line')).toHaveTextContent('album video');

    const signed = (signedAlbumPhotoUrls as jest.Mock).mock.calls.flatMap((call) => call[0] as string[]);
    expect(signed).toEqual([`${THEM}/a1/v1-poster.jpg`]);

    await fireEvent.press(screen.getByTestId('message-quote-r1'));
    expect(router.push).toHaveBeenCalledWith(`/chat/${CONV}/album/a1?photo=v1`);
  });

  it('a video with no poster signs nothing and keeps a play placeholder', async () => {
    (messageQuotes as jest.Mock).mockResolvedValue({ r1: quote({ mediaPosterPath: null }) });
    const screen = await renderScreen();
    expect(await screen.findByTestId('message-quote-r1-placeholder')).toBeTruthy();
    expect(screen.queryByTestId('message-quote-r1-image')).toBeNull();
    expect(screen.queryByTestId('message-quote-r1-play')).toBeNull();
    expect(signedAlbumPhotoUrls).not.toHaveBeenCalled();
  });

  it('a photo quote is unchanged: its own path, no play mark', async () => {
    (messageQuotes as jest.Mock).mockResolvedValue({
      r1: quote({ quotedAlbumPhotoId: 'p1', mediaKind: 'photo', mediaPath: `${THEM}/a1/p1.jpg`, mediaPosterPath: null }),
    });
    const screen = await renderScreen();
    await waitFor(() =>
      expect(screen.getByTestId('message-quote-r1-image').props.source).toEqual({ uri: `https://signed/${THEM}/a1/p1.jpg` })
    );
    expect(screen.queryByTestId('message-quote-r1-play')).toBeNull();
    expect(screen.getByTestId('message-quote-r1-line')).toHaveTextContent('album photo');
  });

  it('an unavailable video quote still says unavailable and nothing else', async () => {
    (messageQuotes as jest.Mock).mockResolvedValue({ r1: quote({ available: false }) });
    const screen = await renderScreen();
    await waitFor(() => expect(screen.getByTestId('message-quote-r1-line')).toHaveTextContent('unavailable'));
    expect(screen.queryByTestId('message-quote-r1-play')).toBeNull();
    expect(signedAlbumPhotoUrls).not.toHaveBeenCalled();
  });
});
