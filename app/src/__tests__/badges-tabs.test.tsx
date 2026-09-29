/**
 * The tab bar badges and the app icon seam (migration 0017, decision 93):
 * Chats shows `unread_chats`, Hi's shows `his_waiting`, hidden at 0 and `9+`
 * above nine, with lowercase screen reader labels; the counts refresh on any
 * message event, on a reconnect and whenever a tab gains focus; the app icon
 * follows `total`.
 */
import { act, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

type Options = Record<string, unknown>;
const mockScreens: Record<string, Options> = {};
let mockListeners: { focus?: () => void } | null = null;

jest.mock('expo-router', () => {
  const Tabs = ({ children, screenListeners }: { children: React.ReactNode; screenListeners?: { focus?: () => void } }) => {
    mockListeners = screenListeners ?? null;
    return children;
  };
  Tabs.Screen = ({ name, options }: { name: string; options: Options }) => {
    mockScreens[name] = options;
    return null;
  };
  return { Tabs };
});
jest.mock('../api/client', () => ({ supabase: {}, SUPABASE_URL: 'https://example.test' }));
jest.mock('../api/badges', () => ({ myBadgeCounts: jest.fn() }));
jest.mock('../badges/appBadge', () => ({ setAppBadge: jest.fn(() => Promise.resolve()) }));

let mockListHandlers: { onMessage: (m: unknown) => void; onInvalidate?: (r: string) => void } | null = null;
jest.mock('../chat/useChatRealtime', () => ({
  useMessageListRealtime: (options: never) => {
    mockListHandlers = options;
  },
}));

import { myBadgeCounts } from '../api/badges';
import { setAppBadge } from '../badges/appBadge';
import TabsLayout from '../app/(tabs)/_layout';
import { colors } from '../theme/tokens';

function renderLayout() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const screen = render(
    <QueryClientProvider client={client}>
      <TabsLayout />
    </QueryClientProvider>
  );
  return { screen, client };
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of Object.keys(mockScreens)) delete mockScreens[key];
  mockListeners = null;
  mockListHandlers = null;
  (myBadgeCounts as jest.Mock).mockResolvedValue({ unreadChats: 3, unreadMessages: 8, hisWaiting: 12, total: 15 });
});

describe('tab badges', () => {
  it('Chats shows unread chats, Hi’s shows waiting hi’s (9+ above nine), with plain labels', async () => {
    await renderLayout();
    await waitFor(() => expect(mockScreens.chats?.tabBarBadge).toBe('3'));
    expect(mockScreens.chats?.tabBarAccessibilityLabel).toBe('chats, 3 unread');
    expect(mockScreens.his?.tabBarBadge).toBe('9+');
    expect(mockScreens.his?.tabBarAccessibilityLabel).toBe("hi's, 12 waiting");
    expect((mockScreens.chats?.tabBarBadgeStyle as Options).backgroundColor).toBe(colors.signal);
    // Only the two tabs carry badges.
    expect(mockScreens.grid?.tabBarBadge).toBeUndefined();
    expect(mockScreens.settings?.tabBarBadge).toBeUndefined();
  });

  it('hides a badge at 0', async () => {
    (myBadgeCounts as jest.Mock).mockResolvedValue({ unreadChats: 0, unreadMessages: 0, hisWaiting: 0, total: 0 });
    await renderLayout();
    await waitFor(() => expect(myBadgeCounts).toHaveBeenCalled());
    await act(async () => {});
    expect(mockScreens.chats?.tabBarBadge).toBeUndefined();
    expect(mockScreens.his?.tabBarBadge).toBeUndefined();
    expect(mockScreens.chats?.tabBarAccessibilityLabel).toBe('chats');
  });

  it('sets the app icon to the total', async () => {
    await renderLayout();
    await waitFor(() => expect(setAppBadge).toHaveBeenCalledWith(15));
  });

  it('refreshes on any message event, on a reconnect, and when a tab gains focus', async () => {
    await renderLayout();
    await waitFor(() => expect(myBadgeCounts).toHaveBeenCalledTimes(1));

    (myBadgeCounts as jest.Mock).mockResolvedValue({ unreadChats: 4, unreadMessages: 9, hisWaiting: 12, total: 16 });
    await act(async () => mockListHandlers?.onMessage({ id: 'x' }));
    await waitFor(() => expect(mockScreens.chats?.tabBarBadge).toBe('4'));
    expect(myBadgeCounts).toHaveBeenCalledTimes(2);

    await act(async () => mockListHandlers?.onInvalidate?.('foreground'));
    await waitFor(() => expect(myBadgeCounts).toHaveBeenCalledTimes(3));

    await act(async () => mockListeners?.focus?.());
    await waitFor(() => expect(myBadgeCounts).toHaveBeenCalledTimes(4));
  });
});

describe('the app icon seam', () => {
  it('is a quiet no-op until expo-notifications is installed', async () => {
    const { setAppBadge: real } = jest.requireActual('../badges/appBadge');
    await expect(real(5)).resolves.toBeUndefined();
  });
});
