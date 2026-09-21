import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let capturedFocusCallback: (() => void) | null = null;

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useFocusEffect: (cb: () => void) => {
    capturedFocusCallback = cb;
  },
}));
jest.mock('../api/client', () => ({ supabase: {}, SUPABASE_URL: 'https://example.test' }));
jest.mock('../api/his', () => ({
  listReceivedHis: jest.fn(),
  dismissHi: jest.fn(),
  hiBack: jest.fn(),
}));
jest.mock('../api/photos', () => ({ signedPhotoUrls: jest.fn() }));

import { router } from 'expo-router';
import { dismissHi, hiBack, listReceivedHis } from '../api/his';
import { signedPhotoUrls } from '../api/photos';
import HisScreen from '../app/(tabs)/his';

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <HisScreen />
    </QueryClientProvider>
  );
}

const hiRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'hi-1',
  createdAt: '2026-09-20T10:00:00Z',
  expiresAt: '2026-09-27T10:00:00Z',
  fromUserId: 'sender-1',
  firstName: 'Bea',
  photoPath: 'sender-1/0.jpg',
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  capturedFocusCallback = null;
  (signedPhotoUrls as jest.Mock).mockResolvedValue({});
});

describe('HisScreen', () => {
  it('shows the empty state when there are no received hi\'s', async () => {
    (listReceivedHis as jest.Mock).mockResolvedValue([]);
    const { findByTestId } = await renderScreen();
    await findByTestId('his-empty');
  });

  it('renders received hi rows with the sender\'s first name', async () => {
    (listReceivedHis as jest.Mock).mockResolvedValue([hiRow()]);
    const { findByTestId, getByText } = await renderScreen();
    await findByTestId('his-row-hi-1');
    expect(getByText('Bea')).toBeTruthy();
  });

  it('refetches when the screen regains focus (§2: no realtime in v1)', async () => {
    (listReceivedHis as jest.Mock).mockResolvedValue([]);
    await renderScreen();
    await waitFor(() => expect(listReceivedHis).toHaveBeenCalledTimes(1));

    await act(async () => {
      capturedFocusCallback?.();
    });

    await waitFor(() => expect((listReceivedHis as jest.Mock).mock.calls.length).toBeGreaterThan(1));
  });

  it('dismisses a hi optimistically, removing the row before the server responds', async () => {
    (listReceivedHis as jest.Mock).mockResolvedValue([hiRow()]);
    let resolveDismiss: (() => void) | undefined;
    (dismissHi as jest.Mock).mockReturnValue(new Promise<void>((resolve) => (resolveDismiss = resolve)));

    const { findByTestId, queryByTestId } = await renderScreen();
    await findByTestId('his-row-hi-1');

    await fireEvent.press(await findByTestId('his-row-dismiss-hi-1'));

    // Removed immediately, before dismissHi's promise has even resolved.
    await waitFor(() => expect(queryByTestId('his-row-hi-1')).toBeNull());
    expect(dismissHi).toHaveBeenCalledWith('hi-1');

    resolveDismiss?.();
  });

  it('rolls back the optimistic dismiss when the server refuses', async () => {
    (listReceivedHis as jest.Mock).mockResolvedValue([hiRow()]);
    (dismissHi as jest.Mock).mockRejectedValue(new Error("That didn't work."));

    const { findByTestId } = await renderScreen();
    await findByTestId('his-row-hi-1');

    await fireEvent.press(await findByTestId('his-row-dismiss-hi-1'));

    // The rejected mutation's onError restores the pre-dismiss list.
    await waitFor(() => expect(dismissHi).toHaveBeenCalledWith('hi-1'));
    await findByTestId('his-row-hi-1');
  });

  it('hi\'s back and navigates to the resulting conversation', async () => {
    (listReceivedHis as jest.Mock).mockResolvedValue([hiRow()]);
    (hiBack as jest.Mock).mockResolvedValue('conv-9');

    const { findByTestId } = await renderScreen();
    await findByTestId('his-row-hi-1');

    await fireEvent.press(await findByTestId('his-row-hiback-hi-1'));

    await waitFor(() => expect(hiBack).toHaveBeenCalledWith('hi-1'));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/chat/conv-9'));
  });
});
