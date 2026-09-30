import type { ReactElement } from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn() } }));
jest.mock('../api/notices', () => ({ listUnseenNotices: jest.fn(), dismissNotice: jest.fn() }));

import { router } from 'expo-router';
import { dismissNotice, listUnseenNotices } from '../api/notices';
import {
  noticeFieldLabel,
  noticeLabels,
  ProfileMovedNotice,
  PROFILE_HELD_BACK_COPY,
  PROFILE_MOVED_COPY,
} from '../notices/ProfileMovedNotice';

const NOTICE = {
  id: 'n1',
  kind: 'profile_moved' as const,
  moved: ['interested_in', 'pronouns'],
  heldBack: ['hard_nos'],
  removed: ['toys', 'kinks'],
};

function withClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  (dismissNotice as jest.Mock).mockResolvedValue(true);
});

describe('noticeFieldLabel', () => {
  it('maps v2 names to the label file and v1 names for removed fields', () => {
    expect(noticeFieldLabel('interested_in', 'moved')).toBe('interested in');
    expect(noticeFieldLabel('hard_nos', 'heldBack')).toBe('hard nos');
    expect(noticeFieldLabel('kinks', 'removed')).toBe('kinks');
  });

  it('maps an unknown name to itself, and never reads inherited object keys', () => {
    expect(noticeFieldLabel('toys', 'removed')).toBe('toys');
    expect(noticeFieldLabel('constructor', 'moved')).toBe('constructor');
  });

  it('drops repeated labels', () => {
    expect(noticeLabels(['faith_weight', 'politics_weight'], 'moved')).toEqual(['how much it matters']);
  });
});

describe('ProfileMovedNotice', () => {
  it('shows the brief copy and the three lists by label', async () => {
    (listUnseenNotices as jest.Mock).mockResolvedValue([NOTICE]);
    const screen = await withClient(<ProfileMovedNotice />);

    expect(await screen.findByTestId('profile-moved-notice-body')).toHaveTextContent(PROFILE_MOVED_COPY);
    expect(PROFILE_MOVED_COPY).toBe(
      "some of what you'd filled in has moved to your profile, and a few things were removed. take a look."
    );
    expect(screen.getByTestId('profile-moved-notice-moved-items')).toHaveTextContent('interested in, pronouns');
    expect(screen.getByTestId('profile-moved-notice-held-items')).toHaveTextContent('hard nos');
    expect(screen.getByTestId('profile-moved-notice-held')).toHaveTextContent(/fit the new limits/);
    expect(PROFILE_HELD_BACK_COPY).toMatch(/new limits/);
    expect(screen.getByTestId('profile-moved-notice-removed-items')).toHaveTextContent('toys, kinks');
  });

  it('leaves out a list with nothing in it', async () => {
    (listUnseenNotices as jest.Mock).mockResolvedValue([{ ...NOTICE, heldBack: [], removed: [] }]);
    const screen = await withClient(<ProfileMovedNotice />);
    await screen.findByTestId('profile-moved-notice');
    expect(screen.queryByTestId('profile-moved-notice-held')).toBeNull();
    expect(screen.queryByTestId('profile-moved-notice-removed')).toBeNull();
    expect(screen.getByTestId('profile-moved-notice-moved')).toBeTruthy();
  });

  it('take a look dismisses it and opens the profile editor', async () => {
    (listUnseenNotices as jest.Mock).mockResolvedValue([NOTICE]);
    const screen = await withClient(<ProfileMovedNotice />);
    await fireEvent.press(await screen.findByTestId('profile-moved-notice-look'));
    expect(dismissNotice).toHaveBeenCalledWith('n1');
    expect(router.push).toHaveBeenCalledWith('/profile-editor');
    expect(screen.queryByTestId('profile-moved-notice')).toBeNull();
  });

  it('not now dismisses it too, even if the dismiss call fails', async () => {
    (listUnseenNotices as jest.Mock).mockResolvedValue([NOTICE]);
    (dismissNotice as jest.Mock).mockRejectedValue(new Error('offline'));
    const screen = await withClient(<ProfileMovedNotice />);
    await fireEvent.press(await screen.findByTestId('profile-moved-notice-later'));
    expect(dismissNotice).toHaveBeenCalledWith('n1');
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.queryByTestId('profile-moved-notice')).toBeNull();
  });

  it('shows nothing for other kinds, for no notice, or for a failed read', async () => {
    (listUnseenNotices as jest.Mock).mockResolvedValue([{ id: 't1', kind: 'tags_changed', dropped: [], major: null }]);
    const first = await withClient(<ProfileMovedNotice />);
    await waitFor(() => expect(listUnseenNotices).toHaveBeenCalled());
    expect(first.queryByTestId('profile-moved-notice')).toBeNull();

    (listUnseenNotices as jest.Mock).mockRejectedValue(new Error('offline'));
    const second = await withClient(<ProfileMovedNotice />);
    await waitFor(() => expect(listUnseenNotices).toHaveBeenCalledTimes(2));
    expect(second.queryByTestId('profile-moved-notice')).toBeNull();
  });

  it('waits for a tags notice to be dismissed first (one sheet at a time)', async () => {
    (listUnseenNotices as jest.Mock).mockResolvedValue([
      { id: 't1', kind: 'tags_changed', dropped: [], major: null },
      NOTICE,
    ]);
    const screen = await withClient(<ProfileMovedNotice />);
    await waitFor(() => expect(listUnseenNotices).toHaveBeenCalled());
    expect(screen.queryByTestId('profile-moved-notice')).toBeNull();
  });
});
