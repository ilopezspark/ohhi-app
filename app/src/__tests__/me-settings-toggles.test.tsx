import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../api/client', () => ({ supabase: {} }));
jest.mock('../api/me', () => ({ me: jest.fn() }));
jest.mock('../api/presence', () => ({
  getMyPresence: jest.fn(),
  setHereNow: jest.fn(),
  pauseGrid: jest.fn(),
}));
jest.mock('../api/blocks', () => ({ listBlockedUsers: jest.fn() }));
jest.mock('../api/notificationPrefs', () => {
  const actual = jest.requireActual('../api/notificationPrefs');
  return {
    ...actual,
    getOrCreateNotificationPrefs: jest.fn(),
    updateNotificationPrefs: jest.fn(),
  };
});
jest.mock('../me/settings/queries', () => ({
  getSchoolEmail: jest.fn().mockResolvedValue('ilopez@clcillinois.edu'),
  getCampusDetail: jest.fn().mockResolvedValue(null),
}));

import { me } from '../api/me';
import { getMyPresence, pauseGrid, setHereNow } from '../api/presence';
import { listBlockedUsers } from '../api/blocks';
import { getOrCreateNotificationPrefs, updateNotificationPrefs } from '../api/notificationPrefs';
import { usePresenceStore } from '../presence/store';
import { useSettingsData } from '../me/settings/useSettingsData';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const BASE_PREFS = {
  user_id: 'u1',
  hi_received: true,
  hi_back: true,
  new_message: true,
  someone_new_nearby: false,
};

describe('useSettingsData — optimistic toggles', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    usePresenceStore.getState().reset();
    (me as jest.Mock).mockResolvedValue({
      id: 'u1',
      status: 'active',
      verification_status: 'verified',
      campus_id: 'c1',
      campus_slug: 'clc',
      campus_label: 'CLC',
      here_now: false,
      goals_count: 0,
      tags_count: 0,
      photos_count: 0,
    });
    (getMyPresence as jest.Mock).mockResolvedValue({ tier: 'on_campus', tier_computed_at: null, is_visible: true });
    (listBlockedUsers as jest.Mock).mockResolvedValue([]);
    (getOrCreateNotificationPrefs as jest.Mock).mockResolvedValue({ ...BASE_PREFS });
  });

  it('flips "here now" optimistically, ahead of the round trip', async () => {
    (setHereNow as jest.Mock).mockResolvedValue(undefined);
    const { result } = await renderHook(() => useSettingsData(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      result.current.onToggleHereNow(true);
    });
    await waitFor(() => expect(result.current.hereNow).toBe(true));
    await waitFor(() => expect(setHereNow).toHaveBeenCalledWith(true));
  });

  it('rolls back "here now" on failure and surfaces an error', async () => {
    (setHereNow as jest.Mock).mockRejectedValue(new Error('nope'));
    const { result } = await renderHook(() => useSettingsData(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      result.current.onToggleHereNow(true);
    });
    await waitFor(() => expect(result.current.hereNow).toBe(false));
    expect(result.current.presenceError).toBeTruthy();
  });

  it('"pause my grid" calls pauseGrid with the inverse of the toggle value', async () => {
    (pauseGrid as jest.Mock).mockResolvedValue(undefined);
    const { result } = await renderHook(() => useSettingsData(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      result.current.onTogglePause(true);
    });
    await waitFor(() => expect(result.current.paused).toBe(true));
    await waitFor(() => expect(pauseGrid).toHaveBeenCalledWith(false));
  });

  it('rolls back "pause my grid" on failure', async () => {
    (pauseGrid as jest.Mock).mockRejectedValue(new Error('nope'));
    const { result } = await renderHook(() => useSettingsData(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      result.current.onTogglePause(true);
    });
    await waitFor(() => expect(result.current.paused).toBe(false));
    expect(result.current.presenceError).toBeTruthy();
  });

  it('the combined "hi\'s and chats" toggle writes hi_received, hi_back and new_message together', async () => {
    (updateNotificationPrefs as jest.Mock).mockResolvedValue(undefined);
    const { result } = await renderHook(() => useSettingsData(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      result.current.onToggleHiAndChats(false);
    });
    await waitFor(() =>
      expect(updateNotificationPrefs).toHaveBeenCalledWith({
        hi_received: false,
        hi_back: false,
        new_message: false,
      })
    );
  });

  it('rolls back the combined toggle in the cache on failure', async () => {
    (updateNotificationPrefs as jest.Mock).mockRejectedValue(new Error('nope'));
    const { result } = await renderHook(() => useSettingsData(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hiAndChatsOn).toBe(true);

    await act(async () => {
      result.current.onToggleHiAndChats(false);
    });
    await waitFor(() => expect(result.current.hiAndChatsOn).toBe(true));
    await waitFor(() => expect(result.current.notificationError).toBeTruthy());
  });

  it('"someone new around" writes only someone_new_nearby', async () => {
    (updateNotificationPrefs as jest.Mock).mockResolvedValue(undefined);
    const { result } = await renderHook(() => useSettingsData(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.someoneNewOn).toBe(false);

    await act(async () => {
      result.current.onToggleSomeoneNew(true);
    });
    await waitFor(() => expect(updateNotificationPrefs).toHaveBeenCalledWith({ someone_new_nearby: true }));
  });

  it('reports the blocked count from listBlockedUsers()', async () => {
    (listBlockedUsers as jest.Mock).mockResolvedValue([{ blocked_id: 'a' }, { blocked_id: 'b' }]);
    const { result } = await renderHook(() => useSettingsData(), { wrapper });
    await waitFor(() => expect(result.current.blockedCount).toBe(2));
  });
});
