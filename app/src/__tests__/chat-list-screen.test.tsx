import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
}));
jest.mock('../api/client', () => ({ supabase: {}, SUPABASE_URL: 'https://example.test' }));
jest.mock('../api/conversations', () => ({ listConversations: jest.fn() }));
jest.mock('../api/me', () => ({ me: jest.fn() }));
jest.mock('../api/photos', () => ({ signedPhotoUrls: jest.fn() }));

let listHandlers: { onMessage: (m: unknown) => void; onInvalidate?: () => void } | null = null;
jest.mock('../chat/useChatRealtime', () => ({
  useMessageListRealtime: (options: never) => {
    listHandlers = options;
  },
}));

import { router } from 'expo-router';
import { listConversations } from '../api/conversations';
import { me } from '../api/me';
import { signedPhotoUrls } from '../api/photos';
import ChatsScreen from '../app/(tabs)/chats';

const ME = 'aaaaaaaa-0000-4000-8000-000000000001';
const THEM = 'bbbbbbbb-0000-4000-8000-000000000002';

const item = (overrides: Record<string, unknown> = {}) => ({
  id: 'conv-1',
  state: 'open',
  openedById: ME,
  blockedBy: null,
  userAId: ME,
  userBId: THEM,
  lastMessageAt: '2026-09-20T11:00:00.000Z',
  createdAt: '2026-09-20T10:00:00.000Z',
  other: { id: THEM, firstName: 'Ada', photoPath: `${THEM}/0.jpg` },
  lastMessage: {
    id: 'm1',
    conversation_id: 'conv-1',
    sender_id: THEM,
    body: 'hey there',
    media_path: null,
    created_at: '2026-09-20T11:00:00.000Z',
  },
  lastReadAt: null,
  unread: true,
  ...overrides,
});

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ChatsScreen />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  listHandlers = null;
  (me as jest.Mock).mockResolvedValue({ id: ME, status: 'active', verification_status: 'verified' });
  (signedPhotoUrls as jest.Mock).mockResolvedValue({ [`${THEM}/0.jpg`]: 'https://signed/them' });
  (listConversations as jest.Mock).mockResolvedValue([item()]);
});

describe('chat list', () => {
  it('renders a preview and an unread badge', async () => {
    const screen = await renderScreen();
    expect(await screen.findByTestId('conversation-preview-conv-1')).toHaveTextContent('hey there');
    expect(screen.getByTestId('conversation-unread-conv-1')).toBeTruthy();
  });

  it('shows "Photo" for a media-only last message', async () => {
    (listConversations as jest.Mock).mockResolvedValue([
      item({
        lastMessage: {
          id: 'm1',
          conversation_id: 'conv-1',
          sender_id: THEM,
          body: null,
          media_path: 'conv-1/m1.jpg',
          created_at: '2026-09-20T11:00:00.000Z',
        },
      }),
    ]);
    const screen = await renderScreen();
    expect(await screen.findByTestId('conversation-preview-conv-1')).toHaveTextContent('Photo');
  });

  it('shows no unread badge when I sent the last message', async () => {
    (listConversations as jest.Mock).mockResolvedValue([item({ unread: false })]);
    const screen = await renderScreen();
    await screen.findByTestId('conversation-row-conv-1');
    expect(screen.queryByTestId('conversation-unread-conv-1')).toBeNull();
  });

  it('chips an expired thread with one neutral word', async () => {
    (listConversations as jest.Mock).mockResolvedValue([item({ state: 'expired' })]);
    const screen = await renderScreen();
    expect(await screen.findByTestId('conversation-chip-conv-1')).toHaveTextContent('Closed');
  });

  it('chips a closed_deleted thread with the same word — the two are not distinguishable', async () => {
    (listConversations as jest.Mock).mockResolvedValue([item({ state: 'closed_deleted' })]);
    const screen = await renderScreen();
    expect(await screen.findByTestId('conversation-chip-conv-1')).toHaveTextContent('Closed');
  });

  it('renders a shadow-accepted thread with no chip at all (decision 12)', async () => {
    (listConversations as jest.Mock).mockResolvedValue([
      item({ state: 'closed_block', blockedBy: THEM }),
    ]);
    const screen = await renderScreen();
    await screen.findByTestId('conversation-row-conv-1');
    expect(screen.queryByTestId('conversation-chip-conv-1')).toBeNull();
  });

  it('never renders copy that could reveal a block', async () => {
    (listConversations as jest.Mock).mockResolvedValue([
      item({ state: 'closed_block', blockedBy: ME }),
      item({ id: 'conv-2', state: 'expired' }),
    ]);
    const screen = await renderScreen();
    await screen.findByTestId('conversation-row-conv-1');
    for (const word of ['block', 'Blocked', 'report', 'deleted']) {
      expect(screen.queryByText(new RegExp(word, 'i'))).toBeNull();
    }
  });

  it('shows the empty state with no conversations', async () => {
    (listConversations as jest.Mock).mockResolvedValue([]);
    const screen = await renderScreen();
    expect(await screen.findByTestId('chats-empty')).toBeTruthy();
  });

  it('navigates to the thread route on press', async () => {
    const screen = await renderScreen();
    const row = await screen.findByTestId('conversation-row-conv-1');
    await fireEvent.press(row);
    expect(router.push).toHaveBeenCalledWith('/chat/conv-1');
  });

  it('patches the affected row in place on a realtime insert, without refetching', async () => {
    const screen = await renderScreen();
    await screen.findByTestId('conversation-row-conv-1');
    (listConversations as jest.Mock).mockClear();

    listHandlers?.onMessage({
      id: 'm2',
      conversation_id: 'conv-1',
      sender_id: THEM,
      body: 'a newer one',
      media_path: null,
      created_at: '2026-09-20T12:00:00.000Z',
    });

    await waitFor(() =>
      expect(screen.getByTestId('conversation-preview-conv-1')).toHaveTextContent('a newer one')
    );
    expect(listConversations).not.toHaveBeenCalled();
  });

  it('refetches when the message belongs to a conversation it does not hold', async () => {
    const screen = await renderScreen();
    await screen.findByTestId('conversation-row-conv-1');
    (listConversations as jest.Mock).mockClear();

    listHandlers?.onMessage({
      id: 'm9',
      conversation_id: 'conv-unknown',
      sender_id: THEM,
      body: 'first contact',
      media_path: null,
      created_at: '2026-09-20T12:00:00.000Z',
    });

    await waitFor(() => expect(listConversations).toHaveBeenCalled());
  });

  it('does not mark my own realtime echo as unread', async () => {
    (listConversations as jest.Mock).mockResolvedValue([item({ unread: false })]);
    const screen = await renderScreen();
    await screen.findByTestId('conversation-row-conv-1');

    listHandlers?.onMessage({
      id: 'm3',
      conversation_id: 'conv-1',
      sender_id: ME,
      body: 'mine',
      media_path: null,
      created_at: '2026-09-20T12:00:00.000Z',
    });

    await waitFor(() =>
      expect(screen.getByTestId('conversation-preview-conv-1')).toHaveTextContent('mine')
    );
    expect(screen.queryByTestId('conversation-unread-conv-1')).toBeNull();
  });
});
