import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * The chat list's time next to each thread's last message (owner ruling,
 * 30 September 2026): today's clock time, "yesterday", a short weekday
 * within the week, then "sep 12". "Now" is Wednesday 30 September 2026,
 * 3:00 pm local; only `Date` is faked.
 */

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useFocusEffect: (cb: () => void) => {
    const { useEffect } = jest.requireActual('react');
    useEffect(() => cb(), [cb]);
  },
}));
jest.mock('../api/client', () => ({ supabase: {}, SUPABASE_URL: 'https://example.test' }));
jest.mock('../api/conversations', () => ({ listConversations: jest.fn() }));
jest.mock('../api/me', () => ({ me: jest.fn() }));
jest.mock('../api/photos', () => ({ signedPhotoUrls: jest.fn() }));
jest.mock('../chat/useChatRealtime', () => ({ useMessageListRealtime: () => undefined }));

import { listConversations } from '../api/conversations';
import { me } from '../api/me';
import { signedPhotoUrls } from '../api/photos';
import { formatMessageTime } from '../chat/time';
import ChatsScreen from '../app/(tabs)/chats';

const ME = 'aaaaaaaa-0000-4000-8000-000000000001';
const THEM = 'bbbbbbbb-0000-4000-8000-000000000002';
const NOW = new Date(2026, 8, 30, 15, 0, 0);
const at = (day: number, hour: number, minute = 0, month = 8, year = 2026) =>
  new Date(year, month, day, hour, minute).toISOString();

const item = (id: string, createdAt: string | null, lastMessageAt: string | null = createdAt) => ({
  id,
  state: 'open',
  openedById: ME,
  blockedBy: null,
  userAId: ME,
  userBId: THEM,
  lastMessageAt,
  createdAt: at(1, 10),
  other: { id: THEM, firstName: 'Ada', photoPath: null },
  lastMessage: createdAt
    ? { id: `m-${id}`, conversation_id: id, sender_id: THEM, body: 'hey', media_path: null, created_at: createdAt }
    : null,
  lastReadAt: null,
  unreadCount: 0,
});

async function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <ChatsScreen />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({
    now: NOW,
    doNotFake: [
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
    ],
  });
  (me as jest.Mock).mockResolvedValue({ id: ME, status: 'active', verification_status: 'verified' });
  (signedPhotoUrls as jest.Mock).mockResolvedValue({});
});

afterEach(() => {
  jest.useRealTimers();
});

describe('chat list — last message time', () => {
  it('labels today, yesterday, this week, earlier and another year', async () => {
    (listConversations as jest.Mock).mockResolvedValue([
      item('today', at(30, 14, 41)),
      item('yesterday', at(29, 23, 50)),
      item('monday', at(28, 9, 0)),
      item('lastweek', at(23, 9, 0)),
      item('older', at(12, 9, 0)),
      item('lastyear', at(12, 9, 0, 8, 2025)),
    ]);
    const screen = await renderScreen();

    const today = await screen.findByTestId('conversation-time-today');
    expect(today).toHaveTextContent(formatMessageTime(at(30, 14, 41)));
    expect(today.props.children).toMatch(/^2:41\s?pm$|^14:41$/);
    expect(screen.getByTestId('conversation-time-yesterday')).toHaveTextContent('yesterday');
    expect(screen.getByTestId('conversation-time-monday')).toHaveTextContent('mon');
    expect(screen.getByTestId('conversation-time-lastweek')).toHaveTextContent('sep 23');
    expect(screen.getByTestId('conversation-time-older')).toHaveTextContent('sep 12');
    expect(screen.getByTestId('conversation-time-lastyear')).toHaveTextContent('sep 12, 2025');
  });

  it('reads the last message’s own time, falling back to the thread’s', async () => {
    (listConversations as jest.Mock).mockResolvedValue([
      item('own', at(29, 9, 0), at(30, 14, 0)),
      item('fallback', null, at(29, 9, 0)),
      item('none', null, null),
    ]);
    const screen = await renderScreen();

    expect(await screen.findByTestId('conversation-time-own')).toHaveTextContent('yesterday');
    expect(screen.getByTestId('conversation-time-fallback')).toHaveTextContent('yesterday');
    expect(screen.getByTestId('conversation-time-none').props.children).toBe('');
  });
});
