import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let mockSegments: string[] = ['(tabs)', 'grid'];
let mockParams: Record<string, string> = {};
let mockUserId: string | null | undefined = 'self';
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useSegments: () => mockSegments,
  useRootNavigationState: () => ({ key: 'root' }),
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (cb: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual('react');
    useEffect(() => cb(), [cb]);
  },
}));
jest.mock('../routing/sessionUser', () => ({ useSessionUserId: () => mockUserId }));
jest.mock('../api/me', () => ({ me: jest.fn() }));
jest.mock('../api/verification', () => {
  class VerificationAttemptsExhaustedError extends Error {}
  return { startAndOpenVerification: jest.fn(), VerificationAttemptsExhaustedError };
});
jest.mock('../settings/signOut', () => ({ signOutAndReset: jest.fn().mockResolvedValue(undefined) }));

import { Linking } from 'react-native';
import { router } from 'expo-router';
import { me } from '../api/me';
import { signOutAndReset } from '../settings/signOut';
import { AccessGate } from '../routing/AccessGate';
import RestrictedScreen from '../app/restricted';
import VerifyIdScreen from '../app/verify-id';

/**
 * The layout-level gate in action (decision 97), the closed screen and the
 * standalone verify screen.
 */

const meRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'self',
  status: 'active',
  verification_status: 'verified',
  verification_attempts_left: 3,
  campus_id: 'c1',
  campus_slug: 'clc',
  campus_label: 'College of Lake County',
  here_now: false,
  goals_count: 1,
  tags_count: 3,
  photos_count: 1,
  ...overrides,
});

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSegments = ['(tabs)', 'grid'];
  mockParams = {};
  mockUserId = 'self';
});

describe('AccessGate — deep links and tabs cannot get around it', () => {
  it('lets a verified adult stay on the grid, uncovered', async () => {
    (me as jest.Mock).mockResolvedValue(meRow());
    const screen = await renderWithClient(<AccessGate />);
    await waitFor(() => expect(me).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId('access-gate-cover')).toBeNull());
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('covers a protected screen until the first me() answers', async () => {
    (me as jest.Mock).mockReturnValue(new Promise(() => {}));
    const screen = await renderWithClient(<AccessGate />);
    expect(screen.getByTestId('access-gate-cover')).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it.each([
    [['(tabs)', 'grid'], { status: 'onboarding', verification_status: 'unverified' }, { pathname: '/(onboarding)' }],
    [['profile', '[id]'], { status: 'onboarding', verification_status: 'id_pending' }, { pathname: '/(onboarding)' }],
    [['chat', '[id]'], { status: 'active', verification_status: 'id_failed' }, { pathname: '/verify-id' }],
    [['(tabs)', 'his'], { status: 'paused', verification_status: 'manual_review' }, { pathname: '/verify-id' }],
    [['me', 'settings'], { status: 'closed_age', verification_status: 'id_failed' }, { pathname: '/restricted', params: { status: 'closed_age' } }],
    [['(onboarding)', 'goals'], { status: 'closed_age', verification_status: 'id_failed' }, { pathname: '/restricted', params: { status: 'closed_age' } }],
    [['verify-id'], { status: 'active', verification_status: 'verified' }, { pathname: '/(tabs)/grid' }],
    [['(onboarding)', 'finish'], { status: 'active', verification_status: 'verified' }, { pathname: '/(tabs)/grid' }],
  ])('at %j with %j, sends the person to %j', async (segments, state, href) => {
    mockSegments = segments;
    (me as jest.Mock).mockResolvedValue(meRow(state));
    const screen = await renderWithClient(<AccessGate />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(href));
    expect(router.replace).toHaveBeenCalledTimes(1);
    // Covered while it moves them, so the wrong screen never shows.
    expect(screen.getByTestId('access-gate-cover')).toBeTruthy();
  });

  it('sends someone signed out on a deep link to sign in, without asking for me()', async () => {
    mockUserId = null;
    mockSegments = ['profile', '[id]'];
    await renderWithClient(<AccessGate />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith({ pathname: '/(auth)/welcome' }));
    expect(me).not.toHaveBeenCalled();
  });

  it.each([[['(auth)', 'otp']], [[]]])('leaves the sign-in screens and the boot screen alone (%j)', async (segments) => {
    mockSegments = segments;
    (me as jest.Mock).mockResolvedValue(meRow({ status: 'onboarding', verification_status: 'unverified' }));
    const screen = await renderWithClient(<AccessGate />);
    await waitFor(() => expect(me).toHaveBeenCalled());
    expect(screen.queryByTestId('access-gate-cover')).toBeNull();
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe('the closed screen (closed_age)', () => {
  it('says plainly that ohhi is for people 18 and over, with support and log out', async () => {
    mockParams = { status: 'closed_age' };
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const screen = await renderWithClient(<RestrictedScreen />);
    expect(screen.getByTestId('restricted-title')).toHaveTextContent('ohhi is for people 18 and over');
    expect(screen.getByTestId('restricted-body')).toHaveTextContent(
      "this account can't be used. if you think this is a mistake, contact support."
    );
    await fireEvent.press(screen.getByTestId('restricted-support'));
    expect(openURL).toHaveBeenCalledWith('mailto:support@sayohhi.com');

    await fireEvent.press(screen.getByTestId('restricted-log-out'));
    await waitFor(() => expect(signOutAndReset).toHaveBeenCalled());
    openURL.mockRestore();
  });

  it('offers no account deletion and no way on to the app', async () => {
    mockParams = { status: 'closed_age' };
    const screen = await renderWithClient(<RestrictedScreen />);
    expect(screen.queryByText(/delete/i)).toBeNull();
    expect(screen.queryByText(/verify|try again/i)).toBeNull();
  });
});

describe('the standalone verify screen (an active account that is not verified)', () => {
  it('shows the current state with its action and a way to log out', async () => {
    (me as jest.Mock).mockResolvedValue(meRow({ verification_status: 'id_failed', verification_attempts_left: 2 }));
    const screen = await renderWithClient(<VerifyIdScreen />);
    await waitFor(() => expect(screen.getByTestId('verify-id-retry')).toBeTruthy());
    expect(screen.getByTestId('verify-id-tries-left')).toHaveTextContent('2 tries left');
    await fireEvent.press(screen.getByTestId('verify-id-log-out'));
    await waitFor(() => expect(signOutAndReset).toHaveBeenCalled());
  });

  it('waits on a closer look with no button to press', async () => {
    (me as jest.Mock).mockResolvedValue(meRow({ verification_status: 'manual_review' }));
    const screen = await renderWithClient(<VerifyIdScreen />);
    await waitFor(() => expect(screen.getByTestId('verify-id-state-closer_look')).toBeTruthy());
    expect(screen.queryByTestId('verify-id-retry')).toBeNull();
    expect(screen.queryByTestId('verify-id-start')).toBeNull();
    expect(screen.queryByTestId('verify-id-next')).toBeNull();
  });
});
