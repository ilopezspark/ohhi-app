import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../api/account', () => ({ deleteMyAccount: jest.fn() }));
jest.mock('../settings/signOut', () => ({ signOutAndReset: jest.fn() }));

import { deleteMyAccount } from '../api/account';
import { signOutAndReset } from '../settings/signOut';
import DeleteAccountScreen from '../app/settings/account';

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DeleteAccountScreen />
    </QueryClientProvider>
  );
}

describe('DeleteAccountScreen', () => {
  const callOrder: string[] = [];

  beforeEach(() => {
    jest.clearAllMocks();
    callOrder.length = 0;
    (deleteMyAccount as jest.Mock).mockImplementation(async () => {
      callOrder.push('delete_my_account');
    });
    (signOutAndReset as jest.Mock).mockImplementation(async () => {
      callOrder.push('sign_out');
    });
  });

  it('requires a second confirmation tap before calling the RPC', async () => {
    const { getByTestId, queryByTestId } = await renderScreen();

    expect(queryByTestId('account-delete-confirm')).toBeNull();
    expect(deleteMyAccount).not.toHaveBeenCalled();

    await fireEvent.press(getByTestId('account-delete-start'));

    expect(getByTestId('account-delete-confirm')).toBeTruthy();
    expect(deleteMyAccount).not.toHaveBeenCalled();
  });

  it('calls delete_my_account() then signs out, in that order — never the reverse', async () => {
    const { getByTestId } = await renderScreen();

    await fireEvent.press(getByTestId('account-delete-start'));
    await fireEvent.press(getByTestId('account-delete-confirm'));

    await waitFor(() => expect(signOutAndReset).toHaveBeenCalled());
    expect(callOrder).toEqual(['delete_my_account', 'sign_out']);
  });

  it('does not sign out when the RPC itself fails', async () => {
    (deleteMyAccount as jest.Mock).mockRejectedValue(new Error("That didn't work."));
    const { getByTestId } = await renderScreen();

    await fireEvent.press(getByTestId('account-delete-start'));
    await fireEvent.press(getByTestId('account-delete-confirm'));

    await waitFor(() => expect(getByTestId('account-delete-error')).toBeTruthy());
    expect(signOutAndReset).not.toHaveBeenCalled();
  });

  it('states the 30-day window and the re-signup-purges-and-restarts behavior in the copy', async () => {
    const { getByText } = await renderScreen();
    expect(getByText(/30 days/)).toBeTruthy();
    expect(getByText(/permanently erases the old account/)).toBeTruthy();
  });
});
