import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
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
jest.mock('../api/verification', () => {
  class VerificationAttemptsExhaustedError extends Error {}
  return { startAndOpenVerification: jest.fn(), VerificationAttemptsExhaustedError };
});

import { router } from 'expo-router';
import { me } from '../api/me';
import { startAndOpenVerification, VerificationAttemptsExhaustedError } from '../api/verification';
import VerifyStep from '../app/(onboarding)/verify';
import { VERIFY_POLL_MS } from '../routing/access';
import { resetVerificationSession, verificationAttemptedThisSession } from '../verify/session';
import { triesLeftLine, VERIFY_COPY, VERIFY_SMALL_PRINT, VERIFY_START_ERROR, verifyView } from '../verify/verifyState';

/**
 * The onboarding `verify` step (decision 97, `docs/age-gate-contract.md` rows
 * 6 to 10): every state's copy, the Persona hand-off, moving on, polling and
 * when the polling stops.
 */

const meRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'self',
  status: 'onboarding',
  verification_status: 'unverified',
  verification_attempts_left: 3,
  campus_id: 'c1',
  campus_slug: 'clc',
  campus_label: 'College of Lake County',
  here_now: false,
  goals_count: 0,
  tags_count: 0,
  photos_count: 0,
  ...overrides,
});

function renderStep() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <VerifyStep />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  resetVerificationSession();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('verifyView', () => {
  it.each([
    ['unverified', 3, 'start'],
    ['email_verified', 3, 'start'],
    ['id_pending', 3, 'checking'],
    ['manual_review', 3, 'closer_look'],
    ['id_failed', 2, 'retry'],
    ['id_failed', 1, 'retry'],
    ['id_failed', 0, 'final'],
    ['verified', 3, 'verified'],
  ] as const)('%s with %i tries left is %s', (status, attemptsLeft, view) => {
    expect(verifyView({ status, attemptsLeft })).toBe(view);
  });

  it('shows the final state once the function says no tries are left, whatever me() says', () => {
    expect(verifyView({ status: 'id_failed', attemptsLeft: 2, exhausted: true })).toBe('final');
    expect(verifyView({ status: 'unverified', attemptsLeft: 3, exhausted: true })).toBe('final');
  });

  it('counts an older me() with no attempts column as tries left', () => {
    expect(verifyView({ status: 'id_failed', attemptsLeft: undefined })).toBe('retry');
  });

  it('says "{n} tries left" and "1 try left"', () => {
    expect(triesLeftLine(2)).toBe('2 tries left');
    expect(triesLeftLine(1)).toBe('1 try left');
  });
});

describe('the verify step, not started (row 10)', () => {
  it('explains the government-issued photo id and the selfie, with the small print', async () => {
    (me as jest.Mock).mockResolvedValue(meRow());
    const screen = await renderStep();
    await waitFor(() => expect(screen.getByTestId('verify-start')).toBeTruthy());
    expect(screen.getByTestId('verify-title')).toHaveTextContent("check it's you");
    expect(screen.getByTestId('verify-body')).toHaveTextContent(VERIFY_COPY.start.body);
    expect(screen.getByTestId('verify-body')).toHaveTextContent(/government-issued photo id/);
    expect(screen.getByTestId('verify-small-print')).toHaveTextContent(VERIFY_SMALL_PRINT);
    expect(screen.queryByText(/student id/i)).toBeNull();
    expect(screen.getByTestId('onboarding-progress').props.accessibilityLabel).toBe('step 3 of 10');
  });

  it('opens Persona through the one integration, then moves on to goals whatever the state is', async () => {
    (me as jest.Mock).mockResolvedValue(meRow());
    (startAndOpenVerification as jest.Mock).mockImplementation(async () => {
      (me as jest.Mock).mockResolvedValue(meRow({ verification_status: 'id_pending' }));
      return { verification_id: 'v1', provider: 'persona', session_url: 'https://x', attempt: 1 };
    });
    const screen = await renderStep();
    await waitFor(() => expect(screen.getByTestId('verify-start')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('verify-start'));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/(onboarding)/goals'));
    expect(startAndOpenVerification).toHaveBeenCalledTimes(1);
    expect(verificationAttemptedThisSession()).toBe(true);
  });

  it('shows a neutral "that didn\'t work" line when starting fails (not deployed, not configured), and stays', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    (me as jest.Mock).mockResolvedValue(meRow());
    (startAndOpenVerification as jest.Mock).mockRejectedValue(new Error('persona not configured'));
    const screen = await renderStep();
    await waitFor(() => expect(screen.getByTestId('verify-start')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('verify-start'));

    await waitFor(() => expect(screen.getByTestId('verify-error')).toHaveTextContent(VERIFY_START_ERROR));
    expect(VERIFY_START_ERROR).toBe("that didn't work. try again.");
    // Not a dead end: the button is still there to try again.
    expect(screen.getByTestId('verify-start')).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
    // The cause is logged in development only.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[verify]'), expect.any(Error));
    warn.mockRestore();
  });

  it('shows the final state when the function says there are no tries left (422)', async () => {
    (me as jest.Mock).mockResolvedValue(meRow({ verification_status: 'id_failed', verification_attempts_left: 1 }));
    (startAndOpenVerification as jest.Mock).mockRejectedValue(new VerificationAttemptsExhaustedError());
    const screen = await renderStep();
    await waitFor(() => expect(screen.getByTestId('verify-retry')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('verify-retry'));

    await waitFor(() => expect(screen.getByTestId('verify-state-final')).toBeTruthy());
    expect(screen.queryByTestId('verify-retry')).toBeNull();
    expect(screen.queryByTestId('verify-error')).toBeNull();
  });
});

describe('the verify step, checking (row 6)', () => {
  it('says a check is running and lets the profile carry on', async () => {
    (me as jest.Mock).mockResolvedValue(meRow({ verification_status: 'id_pending' }));
    const screen = await renderStep();
    await waitFor(() => expect(screen.getByTestId('verify-state-checking')).toBeTruthy());
    expect(screen.getByTestId('verify-title')).toHaveTextContent('checking your id');
    expect(screen.getByTestId('verify-body')).toHaveTextContent(/you can keep setting up your profile.$/);

    await fireEvent.press(screen.getByTestId('verify-next'));
    expect(router.replace).toHaveBeenCalledWith('/(onboarding)/goals');
    expect(startAndOpenVerification).not.toHaveBeenCalled();
  });

  it('polls me() every few seconds while pending, moves on by itself once verified, and stops polling', async () => {
    jest.useFakeTimers();
    (me as jest.Mock).mockResolvedValue(meRow({ verification_status: 'id_pending' }));
    const screen = await renderStep();
    await waitFor(() => expect(screen.getByTestId('verify-state-checking')).toBeTruthy());
    const afterMount = (me as jest.Mock).mock.calls.length;

    await act(async () => {
      jest.advanceTimersByTime(VERIFY_POLL_MS);
    });
    await waitFor(() => expect((me as jest.Mock).mock.calls.length).toBeGreaterThan(afterMount));

    (me as jest.Mock).mockResolvedValue(meRow({ verification_status: 'verified' }));
    await act(async () => {
      jest.advanceTimersByTime(VERIFY_POLL_MS);
    });
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/(onboarding)/goals'));

    const resolvedAt = (me as jest.Mock).mock.calls.length;
    await act(async () => {
      jest.advanceTimersByTime(VERIFY_POLL_MS * 4);
    });
    expect((me as jest.Mock).mock.calls.length).toBe(resolvedAt);
  });

  it('stops polling when the check fails', async () => {
    jest.useFakeTimers();
    (me as jest.Mock).mockResolvedValue(meRow({ verification_status: 'id_pending' }));
    const screen = await renderStep();
    await waitFor(() => expect(screen.getByTestId('verify-state-checking')).toBeTruthy());

    (me as jest.Mock).mockResolvedValue(meRow({ verification_status: 'id_failed', verification_attempts_left: 2 }));
    await act(async () => {
      jest.advanceTimersByTime(VERIFY_POLL_MS);
    });
    await waitFor(() => expect(screen.getByTestId('verify-retry')).toBeTruthy());
    const failedAt = (me as jest.Mock).mock.calls.length;

    await act(async () => {
      jest.advanceTimersByTime(VERIFY_POLL_MS * 4);
    });
    expect((me as jest.Mock).mock.calls.length).toBe(failedAt);
  });
});

describe('the verify step, a closer look (row 7)', () => {
  it('says a person is reviewing, offers no retry, and does not poll', async () => {
    jest.useFakeTimers();
    (me as jest.Mock).mockResolvedValue(meRow({ verification_status: 'manual_review' }));
    const screen = await renderStep();
    await waitFor(() => expect(screen.getByTestId('verify-state-closer_look')).toBeTruthy());
    expect(screen.getByTestId('verify-title')).toHaveTextContent('taking a closer look');
    expect(screen.getByTestId('verify-body')).toHaveTextContent("a person is reviewing your id. you'll get in as soon as it's done.");
    expect(screen.queryByTestId('verify-retry')).toBeNull();
    expect(screen.queryByTestId('verify-start')).toBeNull();

    const shown = (me as jest.Mock).mock.calls.length;
    await act(async () => {
      jest.advanceTimersByTime(VERIFY_POLL_MS * 4);
    });
    expect((me as jest.Mock).mock.calls.length).toBe(shown);
  });
});

describe('the verify step, try again (row 8)', () => {
  it.each([
    [2, '2 tries left'],
    [1, '1 try left'],
  ])('shows %i tries left and a try again button', async (left, line) => {
    (me as jest.Mock).mockResolvedValue(meRow({ verification_status: 'id_failed', verification_attempts_left: left }));
    const screen = await renderStep();
    await waitFor(() => expect(screen.getByTestId('verify-retry')).toBeTruthy());
    expect(screen.getByTestId('verify-title')).toHaveTextContent("we couldn't verify your id");
    expect(screen.getByTestId('verify-body')).toHaveTextContent(VERIFY_COPY.retry.body);
    expect(screen.getByTestId('verify-tries-left')).toHaveTextContent(line);
    expect(screen.getByText('try again')).toBeTruthy();
  });
});

describe('the verify step, no tries left (row 9)', () => {
  it('shows the final copy and a support link, and no button', async () => {
    (me as jest.Mock).mockResolvedValue(meRow({ verification_status: 'id_failed', verification_attempts_left: 0 }));
    const screen = await renderStep();
    await waitFor(() => expect(screen.getByTestId('verify-state-final')).toBeTruthy());
    expect(screen.getByTestId('verify-body')).toHaveTextContent('there are no tries left. if you think this is a mistake, contact support.');
    expect(screen.getByTestId('verify-support')).toBeTruthy();
    expect(screen.queryByTestId('verify-retry')).toBeNull();
    expect(screen.queryByTestId('verify-start')).toBeNull();
    expect(screen.queryByTestId('verify-next')).toBeNull();
  });
});

describe('the verify step, already verified', () => {
  it('moves on to goals by itself', async () => {
    (me as jest.Mock).mockResolvedValue(meRow({ verification_status: 'verified' }));
    await renderStep();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/(onboarding)/goals'));
  });
});
