import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useFocusEffect: (cb: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual('react');
    useEffect(() => cb(), [cb]);
  },
}));
jest.mock('../routing/sessionUser', () => ({ useSessionUserId: () => 'self' }));
jest.mock('../api/me', () => ({ me: jest.fn() }));
jest.mock('../api/profile', () => ({ getFirstName: jest.fn().mockResolvedValue('Sam') }));
jest.mock('../api/verification', () => {
  class VerificationAttemptsExhaustedError extends Error {}
  return { startAndOpenVerification: jest.fn(), VerificationAttemptsExhaustedError };
});
const mockRpc = jest.fn();
jest.mock('../api/client', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'self' } }, error: null }) },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: jest.fn().mockResolvedValue({ data: { date_of_birth: '2000-01-01' }, error: null }) }) }),
    }),
  },
}));

import { router } from 'expo-router';
import { me } from '../api/me';
import { completeOnboarding, VerificationRequiredError } from '../api/onboarding';
import FinishScreen from '../app/(onboarding)/finish';
import { resetVerificationSession } from '../verify/session';

/**
 * `finish` waits on verification (decision 97, `docs/age-gate-contract.md`):
 * it never calls `complete_onboarding()` for someone who is not verified,
 * shows the verify state instead, and treats the server's
 * `identity verification is required` refusal as a routing signal, not an
 * error.
 */

const meRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'self',
  status: 'onboarding',
  verification_status: 'verified',
  verification_attempts_left: 2,
  campus_id: 'c1',
  campus_slug: 'clc',
  campus_label: 'College of Lake County',
  here_now: false,
  goals_count: 1,
  tags_count: 3,
  photos_count: 1,
  ...overrides,
});

function renderFinish() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <FinishScreen />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  resetVerificationSession();
});

describe('completeOnboarding — the refusal is its own signal', () => {
  it('turns "identity verification is required" into VerificationRequiredError', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'identity verification is required' } });
    await expect(completeOnboarding()).rejects.toBeInstanceOf(VerificationRequiredError);
  });

  it('maps any other refusal the old way', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'a photo is required' } });
    await expect(completeOnboarding()).rejects.not.toBeInstanceOf(VerificationRequiredError);
  });
});

describe('finish while not verified', () => {
  it.each([
    ['id_pending', 2, 'checking your id'],
    ['manual_review', 2, 'taking a closer look'],
    ['id_failed', 2, "we couldn't verify your id"],
    ['id_failed', 0, "we couldn't verify your id"],
    ['unverified', 3, "check it's you"],
  ])('shows the %s state (%i tries left) instead of the finish button, and never calls complete_onboarding', async (status, left, title) => {
    (me as jest.Mock).mockResolvedValue(meRow({ verification_status: status, verification_attempts_left: left }));
    const screen = await renderFinish();
    await waitFor(() => expect(screen.getByTestId('finish-verify-title')).toHaveTextContent(title));
    expect(screen.queryByTestId('finish-submit')).toBeNull();
    expect(screen.queryByTestId('finish-error')).toBeNull();
    expect(mockRpc).not.toHaveBeenCalledWith('complete_onboarding');
  });

  it('offers row 6\'s continue (resume the check) when no flow came back in this session, e.g. after a relaunch', async () => {
    (me as jest.Mock).mockResolvedValue(meRow({ verification_status: 'id_pending' }));
    const screen = await renderFinish();
    await waitFor(() => expect(screen.getByTestId('finish-verify-resume')).toBeTruthy());
    expect(screen.queryByTestId('finish-verify-next')).toBeNull();
  });

  it('shows the finish button once the check passes', async () => {
    (me as jest.Mock).mockResolvedValue(meRow({ verification_status: 'verified' }));
    const screen = await renderFinish();
    await waitFor(() => expect(screen.getByTestId('finish-submit')).toBeTruthy());
    expect(screen.queryByTestId('finish-verify-title')).toBeNull();
  });
});

describe('finish once verified', () => {
  it('completes and re-reads the access state so the gate takes the person to the grid', async () => {
    (me as jest.Mock).mockResolvedValue(meRow());
    mockRpc.mockResolvedValue({ data: 'active', error: null });
    const screen = await renderFinish();
    await waitFor(() => expect(screen.getByTestId('finish-submit')).toBeTruthy());
    const before = (me as jest.Mock).mock.calls.length;
    (me as jest.Mock).mockResolvedValue(meRow({ status: 'active' }));

    await fireEvent.press(screen.getByTestId('finish-submit'));

    await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('complete_onboarding'));
    await waitFor(() => expect((me as jest.Mock).mock.calls.length).toBeGreaterThan(before));
    expect(screen.queryByTestId('finish-error')).toBeNull();
  });

  it('treats "identity verification is required" as routing back to the verify state, with no error', async () => {
    (me as jest.Mock).mockResolvedValue(meRow());
    mockRpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'identity verification is required' } });
    const screen = await renderFinish();
    await waitFor(() => expect(screen.getByTestId('finish-submit')).toBeTruthy());
    // The server knows better: staff un-verified the account in between.
    (me as jest.Mock).mockResolvedValue(meRow({ verification_status: 'id_failed', verification_attempts_left: 1 }));

    await fireEvent.press(screen.getByTestId('finish-submit'));

    await waitFor(() => expect(screen.getByTestId('finish-verify-title')).toHaveTextContent("we couldn't verify your id"));
    expect(screen.getByTestId('finish-verify-tries-left')).toHaveTextContent('1 try left');
    expect(screen.queryByTestId('finish-error')).toBeNull();
    expect(screen.queryByTestId('finish-recover')).toBeNull();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('still recovers to the unmet step for any other refusal', async () => {
    (me as jest.Mock).mockResolvedValue(meRow({ photos_count: 0 }));
    mockRpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'a photo is required' } });
    const screen = await renderFinish();
    await waitFor(() => expect(screen.getByTestId('finish-submit')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('finish-submit'));

    await waitFor(() => expect(screen.getByTestId('finish-recover')).toBeTruthy());
    expect(screen.getByTestId('finish-error')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('finish-recover'));
    expect(router.replace).toHaveBeenCalledWith('/(onboarding)/photo');
  });
});
