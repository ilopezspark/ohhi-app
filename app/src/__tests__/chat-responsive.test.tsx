import { Dimensions } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * `(tabs)/chats.tsx`'s list-only (compact/medium) vs list-detail (expanded)
 * behaviour (`docs/app-responsive-plan.md`'s chat section) — the selected
 * thread renders via the same `ThreadView` `chat/[id].tsx` uses, so this
 * mocks everything both the list and `ThreadView` touch.
 */
const ME = 'aaaaaaaa-0000-4000-8000-000000000001';
const THEM = 'bbbbbbbb-0000-4000-8000-000000000002';
const CONV = 'cccccccc-0000-4000-8000-000000000003';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
}));
jest.mock('../api/client', () => ({ supabase: {}, SUPABASE_URL: 'https://example.test' }));
jest.mock('../api/conversations', () => ({ listConversations: jest.fn(), getConversation: jest.fn() }));
jest.mock('../api/messages', () => ({
  listMessages: jest.fn(),
  markRead: jest.fn(),
  sendMessage: jest.fn(),
}));
jest.mock('../api/chatMedia', () => ({
  signedChatMediaUrls: jest.fn(),
  uploadChatMedia: jest.fn(),
}));
jest.mock('../api/me', () => ({ me: jest.fn() }));
jest.mock('../api/photos', () => ({ signedPhotoUrls: jest.fn() }));
jest.mock('../api/albums', () => ({ listMyAlbums: jest.fn(), getAlbum: jest.fn() }));
jest.mock('../api/shares', () => ({ shareAlbum: jest.fn(), sharePrivateCard: jest.fn() }));
jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));
jest.mock('../chat/useChatRealtime', () => ({
  useMessageListRealtime: () => {},
  useConversationRealtime: () => {},
}));

import { router } from 'expo-router';
import { listConversations, getConversation } from '../api/conversations';
import { listMessages, markRead } from '../api/messages';
import { me } from '../api/me';
import { signedPhotoUrls } from '../api/photos';
import ChatsScreen from '../app/(tabs)/chats';
import { useSelectedConversation } from '../chat/selection';

const conversationListItem = (overrides: Record<string, unknown> = {}) => ({
  id: CONV,
  state: 'open',
  openedById: ME,
  blockedBy: null,
  userAId: ME,
  userBId: THEM,
  lastMessageAt: '2026-09-20T11:00:00.000Z',
  createdAt: '2026-09-20T10:00:00.000Z',
  other: { id: THEM, firstName: 'Ada', photoPath: null },
  lastMessage: {
    id: 'm1',
    conversation_id: CONV,
    sender_id: THEM,
    body: 'hey there',
    media_path: null,
    created_at: '2026-09-20T11:00:00.000Z',
  },
  lastReadAt: null,
  unread: false,
  ...overrides,
});

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

function setDimensions(width: number, height: number) {
  const dims = { width, height, scale: 1, fontScale: 1 };
  Dimensions.set({ window: dims, screen: dims });
}

const ZERO_METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <SafeAreaProvider initialMetrics={ZERO_METRICS}>
      <QueryClientProvider client={client}>
        <ChatsScreen />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  useSelectedConversation.setState({ conversationId: null });
  (me as jest.Mock).mockResolvedValue({ id: ME, status: 'active', verification_status: 'verified' });
  (signedPhotoUrls as jest.Mock).mockResolvedValue({});
  (listConversations as jest.Mock).mockResolvedValue([conversationListItem()]);
  (getConversation as jest.Mock).mockResolvedValue(conversation());
  (listMessages as jest.Mock).mockResolvedValue({ messages: [], nextCursor: null });
  (markRead as jest.Mock).mockResolvedValue(undefined);
});

describe('chats screen at 412px (compact)', () => {
  it('renders list-only and pushes the deep-link route on tap', async () => {
    setDimensions(412, 844);
    const screen = await renderScreen();
    const row = await screen.findByTestId('conversation-row-cccccccc-0000-4000-8000-000000000003');
    expect(screen.queryByTestId('chats-split')).toBeNull();

    await fireEvent.press(row);
    expect(router.push).toHaveBeenCalledWith(`/chat/${CONV}`);
  });
});

describe('chats screen at 880px (expanded)', () => {
  it('renders list+thread side by side, selecting instead of navigating', async () => {
    setDimensions(880, 840);
    const screen = await renderScreen();

    expect(await screen.findByTestId('chats-split')).toBeTruthy();
    // No selection yet: the detail pane shows its own empty state.
    expect(screen.getByTestId('chats-detail-empty')).toBeTruthy();

    const row = await screen.findByTestId('conversation-row-cccccccc-0000-4000-8000-000000000003');
    await fireEvent.press(row);

    expect(router.push).not.toHaveBeenCalled();
    expect(await screen.findByTestId('chats-thread')).toBeTruthy();
    expect(screen.queryByTestId('chats-detail-empty')).toBeNull();
  });
});
