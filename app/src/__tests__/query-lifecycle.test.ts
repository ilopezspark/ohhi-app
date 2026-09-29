import { focusManager, onlineManager, QueryClient, QueryObserver } from '@tanstack/react-query';

/**
 * `query/lifecycle.ts`: React Query's React Native wiring. Foreground and
 * reconnect are how every screen learns that someone vanished (decision 90:
 * nothing is pushed), so the wiring itself is worth pinning down.
 */

let mockAppStateHandler: ((status: string) => void) | null = null;
const mockAppStateRemove = jest.fn();
let mockNetInfoHandler: ((state: { isConnected: boolean | null }) => void) | null = null;
const mockNetInfoUnsubscribe = jest.fn();

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn((handler: (state: { isConnected: boolean | null }) => void) => {
      mockNetInfoHandler = handler;
      return mockNetInfoUnsubscribe;
    }),
  },
}));

import { AppState, Platform } from 'react-native';
import { isAppActive, isOnline, wireQueryLifecycle } from '../query/lifecycle';

describe('isAppActive', () => {
  it('is focused only while the app is active', () => {
    expect(isAppActive('active')).toBe(true);
    expect(isAppActive('background')).toBe(false);
    expect(isAppActive('inactive')).toBe(false);
  });
});

describe('isOnline', () => {
  it('treats an unknown connection (null, NetInfo still checking) as online, so a cold start never pauses every query', () => {
    expect(isOnline({ isConnected: null })).toBe(true);
    expect(isOnline({ isConnected: true })).toBe(true);
    expect(isOnline({ isConnected: false })).toBe(false);
  });
});

describe('wireQueryLifecycle', () => {
  beforeAll(() => {
    // jest-expo's default preset renders as iOS; the wiring is native-only.
    expect(Platform.OS).not.toBe('web');
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((
      _event: string,
      handler: (status: string) => void
    ) => {
      mockAppStateHandler = handler;
      return { remove: mockAppStateRemove };
    }) as never);
    wireQueryLifecycle();
    // Idempotent: a second call must not stack a second pair of listeners.
    wireQueryLifecycle();
  });

  it('drives focusManager from AppState: foreground is a window focus', () => {
    // focusManager only subscribes its event listener once something listens to it.
    const unsubscribe = focusManager.subscribe(() => {});
    expect(mockAppStateHandler).not.toBeNull();

    mockAppStateHandler?.('background');
    expect(focusManager.isFocused()).toBe(false);
    mockAppStateHandler?.('active');
    expect(focusManager.isFocused()).toBe(true);
    unsubscribe();
  });

  it('drives onlineManager from NetInfo: queries pause offline and resume on reconnect', () => {
    const unsubscribe = onlineManager.subscribe(() => {});
    expect(mockNetInfoHandler).not.toBeNull();

    mockNetInfoHandler?.({ isConnected: false });
    expect(onlineManager.isOnline()).toBe(false);
    mockNetInfoHandler?.({ isConnected: true });
    expect(onlineManager.isOnline()).toBe(true);
    unsubscribe();
  });

  it('refetches a stale, mounted query when the app comes back to the foreground', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    client.mount();
    const queryFn = jest.fn().mockResolvedValue(['row']);
    const observer = new QueryObserver(client, { queryKey: ['conversations'], queryFn });
    const unsubscribe = observer.subscribe(() => {});
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(queryFn).toHaveBeenCalledTimes(1);

    mockAppStateHandler?.('background');
    mockAppStateHandler?.('active');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(queryFn).toHaveBeenCalledTimes(2);

    unsubscribe();
    client.unmount();
  });
});
