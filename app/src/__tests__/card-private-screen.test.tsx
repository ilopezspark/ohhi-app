import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// useFocusEffect runs its callback once on mount (the first focus) and keeps
// the latest one so a test can simulate coming back to the screen.
let mockFocusCallback: (() => void) | null = null;
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  useFocusEffect: (cb: () => void) => {
    const { useEffect } = jest.requireActual('react');
    useEffect(() => {
      mockFocusCallback = cb;
      cb();
    }, [cb]);
  },
}));
jest.mock('../api/identity', () => ({ getCard: jest.fn() }));
jest.mock('../api/profile', () => ({ getFirstName: jest.fn() }));
jest.mock('../api/session', () => ({ currentUserId: jest.fn() }));
jest.mock('../api/shares', () => ({ revokeShare: jest.fn() }));
jest.mock('../me/card/sharedWith', () => ({ listPrivateCardSharedWith: jest.fn() }));

import { router } from 'expo-router';
import { getCard } from '../api/identity';
import { getFirstName } from '../api/profile';
import { currentUserId } from '../api/session';
import { revokeShare } from '../api/shares';
import { listPrivateCardSharedWith } from '../me/card/sharedWith';
import PrivateCardScreen from '../app/me/private-card';

/** `getCard` for the owner: every section (empty here), no covers. */
const EMPTY_CARD = { user_id: 'me-1', sections: {}, gated: [] };
const FILLED_CARD = { user_id: 'me-1', sections: { pace: 'slow', safer_sex: ['condoms'], hard_nos: ['no calls'] }, gated: [] };

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PrivateCardScreen />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFocusCallback = null;
  (currentUserId as jest.Mock).mockResolvedValue('me-1');
  (getFirstName as jest.Mock).mockResolvedValue('izaac');
});

describe('PrivateCardScreen', () => {
  it('shows a loading state before the card resolves', async () => {
    (getCard as jest.Mock).mockReturnValue(new Promise(() => {}));
    (listPrivateCardSharedWith as jest.Mock).mockResolvedValue([]);
    const { findByTestId } = await renderScreen();
    await findByTestId('private-card-loading');
  });

  it('shows the empty state with an "add to your card" action when nothing is filled in', async () => {
    (getCard as jest.Mock).mockResolvedValue(EMPTY_CARD);
    (listPrivateCardSharedWith as jest.Mock).mockResolvedValue([]);
    const { findByTestId, queryByTestId } = await renderScreen();
    await findByTestId('private-card-empty');
    expect(queryByTestId('private-card-preview')).toBeNull();

    await fireEvent.press(await findByTestId('private-card-empty-add'));
    expect(router.push).toHaveBeenCalledWith('/profile-editor/private-card');
  });

  it('renders the preview through PrivateCardView when something is filled in', async () => {
    (getCard as jest.Mock).mockResolvedValue(FILLED_CARD);
    (listPrivateCardSharedWith as jest.Mock).mockResolvedValue([]);
    const { findByTestId, queryByTestId } = await renderScreen();
    await findByTestId('private-card-preview');
    expect(queryByTestId('private-card-empty')).toBeNull();
  });

  it("reads the owner's own card (payload v2) and treats a card never written (404) as empty", async () => {
    (getCard as jest.Mock).mockResolvedValue(null);
    (listPrivateCardSharedWith as jest.Mock).mockResolvedValue([]);
    const { findByTestId } = await renderScreen();
    await findByTestId('private-card-empty');
    expect(getCard).toHaveBeenCalledWith('me-1');
  });

  it('the preview shows every section, grouped, with a caption per group saying what a share includes', async () => {
    (getCard as jest.Mock).mockResolvedValue(FILLED_CARD);
    (listPrivateCardSharedWith as jest.Mock).mockResolvedValue([]);
    const { findByTestId, queryByTestId } = await renderScreen();
    await findByTestId('private-card-preview-section-pace-slow');
    // The owner sees intimacy content directly, never a cover.
    await findByTestId('private-card-preview-section-safer_sex-condoms');
    expect(queryByTestId(/^private-card-preview-cover-/)).toBeNull();
    await findByTestId('private-card-preview-caption-standard');
    await findByTestId('private-card-preview-caption-gated');
    await findByTestId('private-card-preview-caption-always_attached');
  });

  it('each person shared with shows the intimacy sections their share ticked', async () => {
    (getCard as jest.Mock).mockResolvedValue(FILLED_CARD);
    (listPrivateCardSharedWith as jest.Mock).mockResolvedValue([
      { shareId: 'share-1', userId: 'u1', firstName: 'maya', sentAt: new Date().toISOString(), sections: ['safer_sex', 'practices'] },
      { shareId: 'share-2', userId: 'u2', firstName: 'jo', sentAt: new Date().toISOString(), sections: [] },
    ]);
    const { findByTestId } = await renderScreen();
    const withTicks = await findByTestId('private-card-shared-line-share-1');
    expect(withTicks.props.children).toMatch(/· safer sex, what i'm into$/);
    const without = await findByTestId('private-card-shared-line-share-2');
    expect(without.props.children).not.toMatch(/·/);
  });

  it('shows "not shared with anyone." when the shared-with list is empty', async () => {
    (getCard as jest.Mock).mockResolvedValue(EMPTY_CARD);
    (listPrivateCardSharedWith as jest.Mock).mockResolvedValue([]);
    const { findByTestId } = await renderScreen();
    await findByTestId('private-card-shared-empty');
  });

  it('lists each person shared with: avatar, first name, relative time, and a take-back action', async () => {
    (getCard as jest.Mock).mockResolvedValue(EMPTY_CARD);
    (listPrivateCardSharedWith as jest.Mock).mockResolvedValue([
      { shareId: 'share-1', userId: 'u1', firstName: 'maya', sentAt: '2026-09-25T12:00:00.000Z' },
    ]);
    const { findByTestId, getByText } = await renderScreen();
    await findByTestId('private-card-shared-share-1');
    expect(getByText('maya')).toBeTruthy();
    await findByTestId('private-card-take-back-share-1');
  });

  it('take back is optimistic: the row disappears immediately, before revokeShare resolves', async () => {
    (getCard as jest.Mock).mockResolvedValue(EMPTY_CARD);
    (listPrivateCardSharedWith as jest.Mock).mockResolvedValue([
      { shareId: 'share-1', userId: 'u1', firstName: 'maya', sentAt: '2026-09-25T12:00:00.000Z' },
    ]);
    let resolveRevoke: () => void = () => {};
    (revokeShare as jest.Mock).mockReturnValue(new Promise<void>((resolve) => (resolveRevoke = resolve)));

    const { findByTestId, queryByTestId } = await renderScreen();
    const takeBack = await findByTestId('private-card-take-back-share-1');
    await fireEvent.press(takeBack);

    await waitFor(() => expect(queryByTestId('private-card-shared-share-1')).toBeNull());
    resolveRevoke();
  });

  it('rolls back and keeps the row when revokeShare fails', async () => {
    (getCard as jest.Mock).mockResolvedValue(EMPTY_CARD);
    (listPrivateCardSharedWith as jest.Mock).mockResolvedValue([
      { shareId: 'share-1', userId: 'u1', firstName: 'maya', sentAt: '2026-09-25T12:00:00.000Z' },
    ]);
    (revokeShare as jest.Mock).mockRejectedValue(new Error("That didn't work."));

    const { findByTestId } = await renderScreen();
    const takeBack = await findByTestId('private-card-take-back-share-1');
    await fireEvent.press(takeBack);

    await findByTestId('private-card-shared-error');
    await findByTestId('private-card-shared-share-1');
  });

  it('removes the section to "not shared with anyone." after the last person is taken back', async () => {
    (getCard as jest.Mock).mockResolvedValue(EMPTY_CARD);
    (listPrivateCardSharedWith as jest.Mock)
      .mockResolvedValueOnce([{ shareId: 'share-1', userId: 'u1', firstName: 'maya', sentAt: '2026-09-25T12:00:00.000Z' }])
      // After a successful revoke the screen invalidates and refetches — the server-side list is now empty.
      .mockResolvedValue([]);
    (revokeShare as jest.Mock).mockResolvedValue(undefined);

    const { findByTestId } = await renderScreen();
    const takeBack = await findByTestId('private-card-take-back-share-1');
    await fireEvent.press(takeBack);

    await findByTestId('private-card-shared-empty');
  });
});

describe('PrivateCardScreen — vanishing (migration 0014, decision 90)', () => {
  it('re-reads "shared with" when the screen is focused again, so someone who vanished just drops off', async () => {
    (getCard as jest.Mock).mockResolvedValue(FILLED_CARD);
    (listPrivateCardSharedWith as jest.Mock).mockResolvedValue([
      { shareId: 's1', userId: 'u1', firstName: 'maya', sentAt: '2026-09-20T10:00:00.000Z' },
    ]);
    const { findByTestId, queryByTestId, queryByText } = await renderScreen();
    await findByTestId('private-card-shared-s1');
    expect(listPrivateCardSharedWith).toHaveBeenCalledTimes(1);

    (listPrivateCardSharedWith as jest.Mock).mockResolvedValue([]);
    await act(async () => mockFocusCallback?.());

    await waitFor(() => expect(queryByTestId('private-card-shared-s1')).toBeNull());
    expect(listPrivateCardSharedWith).toHaveBeenCalledTimes(2);
    expect(await findByTestId('private-card-shared-empty')).toBeTruthy();
    expect(queryByText(/banned|suspended|deleted|blocked/i)).toBeNull();
  });
});
