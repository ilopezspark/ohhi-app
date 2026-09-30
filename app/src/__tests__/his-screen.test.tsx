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
  HIS_SENT_QUERY_KEY: ['his_sent'],
  listReceivedHis: jest.fn(),
  listSentHis: jest.fn(),
  dismissHi: jest.fn(),
  hiBack: jest.fn(),
}));
jest.mock('../api/photos', () => ({ signedPhotoUrls: jest.fn() }));

import { router } from 'expo-router';
import { dismissHi, hiBack, listReceivedHis, listSentHis } from '../api/his';
import { signedPhotoUrls } from '../api/photos';
import HisScreen from '../app/(tabs)/his';
import { GoneError } from '../api/errors';

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

const sentRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'sent-1',
  createdAt: '2026-09-20T10:00:00Z',
  expiresAt: '2026-09-27T10:00:00Z',
  toUserId: 'recipient-1',
  firstName: 'Cy',
  photoPath: 'recipient-1/0.jpg',
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  capturedFocusCallback = null;
  (listSentHis as jest.Mock).mockResolvedValue([]);
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
    expect(getByText('bea')).toBeTruthy();
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

describe("HisScreen — received and sent tabs", () => {
  async function openSent(view: Awaited<ReturnType<typeof render>>) {
    await fireEvent.press(await view.findByTestId('his-tab-sent'));
  }

  it('shows received by default, with its rows and no sent rows', async () => {
    (listReceivedHis as jest.Mock).mockResolvedValue([hiRow()]);
    (listSentHis as jest.Mock).mockResolvedValue([sentRow()]);
    const { findByTestId, getByText, getByTestId, queryByTestId } = await renderScreen();
    await findByTestId('his-row-hi-1');
    expect(getByText('received')).toBeTruthy();
    expect(getByText('sent')).toBeTruthy();
    expect(getByTestId('his-tab-received').props.accessibilityState).toMatchObject({ selected: true });
    expect(getByTestId('his-tab-sent').props.accessibilityState).toMatchObject({ selected: false });
    expect(queryByTestId('his-sent-row-sent-1')).toBeNull();
  });

  it('switching to sent shows the sent rows and hides the received ones', async () => {
    (listReceivedHis as jest.Mock).mockResolvedValue([hiRow()]);
    (listSentHis as jest.Mock).mockResolvedValue([sentRow()]);
    const view = await renderScreen();
    await view.findByTestId('his-row-hi-1');
    await openSent(view);
    await view.findByTestId('his-sent-row-sent-1');
    expect(view.getByText('cy')).toBeTruthy();
    expect(view.queryByTestId('his-row-hi-1')).toBeNull();
    expect(view.getByTestId('his-tab-sent').props.accessibilityState).toMatchObject({ selected: true });

    // And back again.
    await fireEvent.press(view.getByTestId('his-tab-received'));
    await view.findByTestId('his-row-hi-1');
    expect(view.queryByTestId('his-sent-row-sent-1')).toBeNull();
  });

  it('puts no count in either tab label', async () => {
    (listReceivedHis as jest.Mock).mockResolvedValue([hiRow(), hiRow({ id: 'hi-2' })]);
    (listSentHis as jest.Mock).mockResolvedValue([sentRow()]);
    const { findByTestId, getByTestId } = await renderScreen();
    await findByTestId('his-row-hi-1');
    expect(getByTestId('his-tab-received')).toHaveTextContent(/^received$/);
    expect(getByTestId('his-tab-sent')).toHaveTextContent(/^sent$/);
  });

  it('starts on received again on each mount', async () => {
    (listReceivedHis as jest.Mock).mockResolvedValue([hiRow()]);
    (listSentHis as jest.Mock).mockResolvedValue([sentRow()]);
    const first = await renderScreen();
    await first.findByTestId('his-row-hi-1');
    await openSent(first);
    await first.findByTestId('his-sent-row-sent-1');
    await first.unmount();
    const second = await renderScreen();
    await second.findByTestId('his-row-hi-1');
    expect(second.queryByTestId('his-sent-row-sent-1')).toBeNull();
  });

  it('says it is waiting, with how long ago it was sent, and never a dismissed state', async () => {
    (listReceivedHis as jest.Mock).mockResolvedValue([hiRow()]);
    (listSentHis as jest.Mock).mockResolvedValue([
      sentRow({ createdAt: new Date(Date.now() - 3 * 86_400_000).toISOString() }),
    ]);
    const view = await renderScreen();
    await openSent(view);
    const waiting = await view.findByTestId('his-sent-waiting-sent-1');
    expect(waiting.props.children).toBe('waiting · sent 3 days ago');
    expect(view.queryByText(/dismissed|declined|expired|ignored/i)).toBeNull();
  });

  it("tapping a sent row opens that person's profile", async () => {
    (listReceivedHis as jest.Mock).mockResolvedValue([]);
    (listSentHis as jest.Mock).mockResolvedValue([sentRow()]);
    const view = await renderScreen();
    await openSent(view);
    await fireEvent.press(await view.findByTestId('his-sent-row-sent-1'));
    expect(router.push).toHaveBeenCalledWith('/profile/recipient-1');
  });

  it('gives a sent row no actions: no hi back, no dismiss, no unsend', async () => {
    (listReceivedHis as jest.Mock).mockResolvedValue([hiRow()]);
    (listSentHis as jest.Mock).mockResolvedValue([sentRow()]);
    const view = await renderScreen();
    await openSent(view);
    await view.findByTestId('his-sent-row-sent-1');
    expect(view.queryByTestId('his-row-hiback-sent-1')).toBeNull();
    expect(view.queryByTestId('his-row-dismiss-sent-1')).toBeNull();
    expect(view.queryByText('Hi back')).toBeNull();
    expect(view.queryByText('Dismiss')).toBeNull();
    expect(view.queryByText(/unsend|undo|cancel|withdraw/i)).toBeNull();
  });

  it("received tab with nothing shows its own empty state, even when hi's were sent", async () => {
    (listReceivedHis as jest.Mock).mockResolvedValue([]);
    (listSentHis as jest.Mock).mockResolvedValue([sentRow()]);
    const { findByTestId, queryByTestId, getByText } = await renderScreen();
    await findByTestId('his-empty');
    expect(getByText("no hi's yet")).toBeTruthy();
    expect(queryByTestId('his-sent-empty')).toBeNull();
  });

  it("sent tab with nothing shows its own empty state, even when hi's were received", async () => {
    (listReceivedHis as jest.Mock).mockResolvedValue([hiRow()]);
    (listSentHis as jest.Mock).mockResolvedValue([]);
    const view = await renderScreen();
    await view.findByTestId('his-row-hi-1');
    await waitFor(() => expect(listSentHis).toHaveBeenCalled());
    await openSent(view);
    await view.findByTestId('his-sent-empty');
    expect(view.getByText("you haven't sent any hi's")).toBeTruthy();
    expect(view.queryByTestId('his-empty')).toBeNull();
  });

  it('a failing sent list does not break the received list, and reads as empty on the sent tab', async () => {
    (listReceivedHis as jest.Mock).mockResolvedValue([hiRow()]);
    (listSentHis as jest.Mock).mockRejectedValue(new Error('network'));
    const view = await renderScreen();
    await view.findByTestId('his-row-hi-1');
    await openSent(view);
    await view.findByTestId('his-sent-empty');
  });

  it('refetches the sent list on focus too', async () => {
    (listReceivedHis as jest.Mock).mockResolvedValue([]);
    await renderScreen();
    await waitFor(() => expect(listSentHis).toHaveBeenCalledTimes(1));
    await act(async () => {
      capturedFocusCallback?.();
    });
    await waitFor(() => expect((listSentHis as jest.Mock).mock.calls.length).toBeGreaterThan(1));
  });
});

describe('HisScreen — vanishing (migration 0014, decision 90)', () => {
  it('a hi back answered "hi not found" (the sender vanished) just drops the row: no copy, no retry, no navigation', async () => {
    (listReceivedHis as jest.Mock).mockResolvedValueOnce([hiRow(), hiRow({ id: 'hi-2', fromUserId: 'sender-2' })]);
    // The refetch after the failure no longer returns the vanished sender's hi.
    (listReceivedHis as jest.Mock).mockResolvedValue([hiRow({ id: 'hi-2', fromUserId: 'sender-2' })]);
    (hiBack as jest.Mock).mockRejectedValue(new GoneError());

    const { findByTestId, queryByTestId, queryByText } = await renderScreen();
    await findByTestId('his-row-hi-1');
    await fireEvent.press(await findByTestId('his-row-hiback-hi-1'));

    await waitFor(() => expect(queryByTestId('his-row-hi-1')).toBeNull());
    expect(await findByTestId('his-row-hi-2')).toBeTruthy();
    expect(hiBack).toHaveBeenCalledTimes(1);
    expect(router.push).not.toHaveBeenCalled();
    expect(queryByText(/banned|suspended|deleted|blocked|available/i)).toBeNull();
  });

  it('keeps the row after a failure that is not about the hi being gone', async () => {
    (listReceivedHis as jest.Mock).mockResolvedValue([hiRow()]);
    (hiBack as jest.Mock).mockRejectedValue(new Error('network'));

    const { findByTestId } = await renderScreen();
    await fireEvent.press(await findByTestId('his-row-hiback-hi-1'));

    await waitFor(() => expect(hiBack).toHaveBeenCalledTimes(1));
    expect(await findByTestId('his-row-hi-1')).toBeTruthy();
  });
});

describe('HisScreen — the Hi’s badge (migration 0017, decision 93)', () => {
  function renderWithCounts() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['badge-counts'], { unreadChats: 1, unreadMessages: 1, hisWaiting: 2, total: 3 });
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    const screen = render(
      <QueryClientProvider client={client}>
        <HisScreen />
      </QueryClientProvider>
    );
    return { screen, client, invalidate };
  }

  it('dismissing a hi lowers the badge at once, then re-reads the counts', async () => {
    (listReceivedHis as jest.Mock).mockResolvedValue([hiRow()]);
    (dismissHi as jest.Mock).mockResolvedValue(undefined);
    const { screen, client, invalidate } = renderWithCounts();
    const view = await screen;
    await fireEvent.press(await view.findByTestId('his-row-dismiss-hi-1'));
    await waitFor(() =>
      expect(client.getQueryData(['badge-counts'])).toMatchObject({ hisWaiting: 1, total: 2 })
    );
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['badge-counts'] }));
  });

  it('a hi back lowers the badge too, then re-reads the counts', async () => {
    (listReceivedHis as jest.Mock).mockResolvedValue([hiRow()]);
    (hiBack as jest.Mock).mockResolvedValue('conv-9');
    const { screen, client, invalidate } = renderWithCounts();
    const view = await screen;
    await fireEvent.press(await view.findByTestId('his-row-hiback-hi-1'));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/chat/conv-9'));
    expect(client.getQueryData(['badge-counts'])).toMatchObject({ hisWaiting: 1, total: 2 });
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['badge-counts'] }));
  });
});
