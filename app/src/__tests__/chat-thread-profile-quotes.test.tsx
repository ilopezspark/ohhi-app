/**
 * Profile replies in the thread (migration 0024, decision 100): a message
 * sent from someone's profile quotes their prompt answer (question small,
 * answer under it) or their profile photo (a `profile-photos` thumbnail and
 * `photo`), live from `message_quotes`. An unavailable one says only
 * `unavailable`. None of them is tappable.
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
jest.mock('../api/shares', () => ({ shareAlbum: jest.fn(), shareCard: jest.fn() }));
jest.mock('../api/identity', () => ({ getCard: jest.fn(), revealCardSection: jest.fn() }));
jest.mock('../chat/shareFeed', () => ({ listShareFeed: jest.fn(() => Promise.resolve([])) }));
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
jest.mock('../chat/useChatRealtime', () => ({ useConversationRealtime: () => undefined }));

import { router } from 'expo-router';
import { getConversation } from '../api/conversations';
import { listMessages, listRecentlySharedMedia, markRead } from '../api/messages';
import { messageQuotes } from '../api/replies';
import { signedChatMediaUrls } from '../api/chatMedia';
import { me } from '../api/me';
import { signedPhotoUrls } from '../api/photos';
import { listMyAlbums, signedAlbumPhotoUrls } from '../api/albums';
import ChatThreadScreen from '../app/chat/[id]';

const conversation = {
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
};

const message = (overrides: Record<string, unknown> = {}) => ({
  id: 'm1',
  conversation_id: CONV,
  sender_id: ME,
  body: 'same order here',
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
  reply_to_user_prompt_id: null,
  reply_to_user_photo_id: null,
  reply_kind: null,
  ...overrides,
});

const quote = (overrides: Record<string, unknown> = {}) => ({
  messageId: 'r1',
  replyKind: 'user_prompt',
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
  ...overrides,
});

const promptReply = message({ id: 'r1', reply_to_user_prompt_id: 'up-1', reply_kind: 'user_prompt' });
const photoReply = message({ id: 'r1', body: 'where is this', reply_to_user_photo_id: 'ph-1', reply_kind: 'user_photo' });

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
  (getConversation as jest.Mock).mockResolvedValue(conversation);
  (markRead as jest.Mock).mockResolvedValue(undefined);
  (signedChatMediaUrls as jest.Mock).mockResolvedValue({});
  (signedAlbumPhotoUrls as jest.Mock).mockResolvedValue({});
  (signedPhotoUrls as jest.Mock).mockImplementation((paths: string[]) =>
    Promise.resolve(Object.fromEntries(paths.map((path) => [path, `https://signed/${path}`])))
  );
  (listMyAlbums as jest.Mock).mockResolvedValue([]);
  (listRecentlySharedMedia as jest.Mock).mockResolvedValue([]);
});

describe('thread — profile reply quotes', () => {
  it('draws a prompt quote: the question small, the answer under it, above the bubble', async () => {
    (listMessages as jest.Mock).mockResolvedValue({ messages: [promptReply], nextCursor: null });
    (messageQuotes as jest.Mock).mockResolvedValue({
      r1: quote({ promptQuestion: 'my order at the campus cafe', promptAnswer: 'oat latte' }),
    });
    const screen = await renderScreen();

    await waitFor(() => expect(screen.getByTestId('message-quote-r1-question')).toHaveTextContent('my order at the campus cafe'));
    expect(screen.getByTestId('message-quote-r1-line')).toHaveTextContent('oat latte');
    expect(messageQuotes).toHaveBeenCalledWith(['r1']);
    // Not a button: nothing in the thread to jump to.
    const node = screen.getByTestId('message-quote-r1');
    expect(node.props.accessibilityRole).toBeUndefined();
    expect(node.props.accessibilityLabel).toBe("reply to ada's answer, my order at the campus cafe, oat latte");
  });

  it('draws a photo quote from profile-photos, with its thumbnail and "photo"', async () => {
    (listMessages as jest.Mock).mockResolvedValue({ messages: [photoReply], nextCursor: null });
    (messageQuotes as jest.Mock).mockResolvedValue({
      r1: quote({ replyKind: 'user_photo', mediaKind: 'photo', photoPath: `${THEM}/1.jpg` }),
    });
    const screen = await renderScreen();

    const image = await screen.findByTestId('message-quote-r1-image');
    expect(image.props.source).toEqual({ uri: `https://signed/${THEM}/1.jpg` });
    expect(signedPhotoUrls).toHaveBeenCalledWith([`${THEM}/1.jpg`]);
    expect(signedAlbumPhotoUrls).not.toHaveBeenCalled();
    expect(screen.getByTestId('message-quote-r1-line')).toHaveTextContent('photo');

    await fireEvent.press(screen.getByTestId('message-quote-r1'));
    expect(router.push).not.toHaveBeenCalled();
  });

  it('says only unavailable when the answer is gone', async () => {
    (listMessages as jest.Mock).mockResolvedValue({ messages: [promptReply], nextCursor: null });
    (messageQuotes as jest.Mock).mockResolvedValue({ r1: quote({ available: false }) });
    const screen = await renderScreen();

    await waitFor(() => expect(screen.getByTestId('message-quote-r1-line')).toHaveTextContent('unavailable'));
    expect(screen.queryByTestId('message-quote-r1-question')).toBeNull();
    expect(screen.queryByTestId('message-quote-r1-thumb')).toBeNull();
  });

  it('says only unavailable when the photo reference was nulled, before any answer', async () => {
    (listMessages as jest.Mock).mockResolvedValue({
      messages: [message({ id: 'r1', reply_kind: 'user_photo' })],
      nextCursor: null,
    });
    (messageQuotes as jest.Mock).mockReturnValue(new Promise(() => {}));
    const screen = await renderScreen();

    await waitFor(() => expect(screen.getByTestId('message-quote-r1-line')).toHaveTextContent('unavailable'));
  });
});
