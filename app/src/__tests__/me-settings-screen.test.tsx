import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() } }));
jest.mock('../me/settings/useSettingsData', () => ({ useSettingsData: jest.fn() }));
jest.mock('../api/account', () => ({ deleteMyAccount: jest.fn() }));
jest.mock('../settings/signOut', () => ({ signOutAndReset: jest.fn() }));

import { router } from 'expo-router';
import { useSettingsData } from '../me/settings/useSettingsData';
import { deleteMyAccount } from '../api/account';
import { signOutAndReset } from '../settings/signOut';
import SettingsScreen from '../app/me/settings';
import { colors } from '../theme/tokens';

function baseData(overrides: Partial<ReturnType<typeof useSettingsData>> = {}) {
  return {
    isLoading: false,
    meData: {
      id: 'u1',
      status: 'active',
      verification_status: 'verified',
      campus_id: 'c1',
      campus_slug: 'clc',
      campus_label: 'CLC',
      here_now: true,
      goals_count: 1,
      tags_count: 1,
      photos_count: 2,
    },
    campus: { name: 'College of Lake County', city: 'Grayslake', state: 'IL', slug: 'clc' },
    schoolEmail: 'ilopez@clcillinois.edu',
    blockedCount: 2,
    hereNow: true,
    paused: false,
    presenceError: null,
    onToggleHereNow: jest.fn(),
    onTogglePause: jest.fn(),
    hiAndChatsOn: true,
    someoneNewOn: false,
    notificationError: null,
    onToggleHiAndChats: jest.fn(),
    onToggleSomeoneNew: jest.fn(),
    ...overrides,
  };
}

function mockData(overrides: Partial<ReturnType<typeof useSettingsData>> = {}) {
  (useSettingsData as jest.Mock).mockReturnValue(baseData(overrides));
}

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SettingsScreen />
    </QueryClientProvider>
  );
}

describe('SettingsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders every group', async () => {
    mockData();
    const { getByTestId } = await renderScreen();
    expect(getByTestId('settings-row-campus')).toBeTruthy();
    expect(getByTestId('settings-row-verification')).toBeTruthy();
    expect(getByTestId('settings-row-school-email')).toBeTruthy();
    expect(getByTestId('settings-row-here-now')).toBeTruthy();
    expect(getByTestId('settings-row-pause-grid')).toBeTruthy();
    expect(getByTestId('settings-row-hi-and-chats')).toBeTruthy();
    expect(getByTestId('settings-row-someone-new')).toBeTruthy();
    expect(getByTestId('settings-row-blocked')).toBeTruthy();
    expect(getByTestId('settings-row-report')).toBeTruthy();
    expect(getByTestId('settings-row-info-privacy')).toBeTruthy();
    expect(getByTestId('settings-row-info-terms')).toBeTruthy();
  });

  it('renders the "delete my account" row in colors.danger', async () => {
    mockData();
    const { getByText } = await renderScreen();
    const node = getByText('delete my account');
    expect([node.props.style].flat()).toEqual(expect.arrayContaining([expect.objectContaining({ color: colors.danger })]));
  });

  it('navigates to the campus, verification, blocked, report and info screens', async () => {
    mockData();
    const { getByTestId } = await renderScreen();
    await fireEvent.press(getByTestId('settings-row-campus'));
    expect(router.push).toHaveBeenCalledWith('/me/campus');
    await fireEvent.press(getByTestId('settings-row-verification'));
    expect(router.push).toHaveBeenCalledWith('/me/verification');
    await fireEvent.press(getByTestId('settings-row-blocked'));
    expect(router.push).toHaveBeenCalledWith('/me/blocked');
    await fireEvent.press(getByTestId('settings-row-report'));
    expect(router.push).toHaveBeenCalledWith('/me/report-help');
    await fireEvent.press(getByTestId('settings-row-info-privacy'));
    expect(router.push).toHaveBeenCalledWith('/me/info/privacy');
  });

  it('toggling here now / pause my grid / notifications calls straight through to the hook', async () => {
    const data = baseData();
    (useSettingsData as jest.Mock).mockReturnValue(data);
    const { getByTestId } = await renderScreen();

    await fireEvent(getByTestId('settings-row-here-now-accessory'), 'press');
    expect(data.onToggleHereNow).toHaveBeenCalledWith(false);

    await fireEvent(getByTestId('settings-row-pause-grid-accessory'), 'press');
    expect(data.onTogglePause).toHaveBeenCalledWith(true);

    await fireEvent(getByTestId('settings-row-hi-and-chats-accessory'), 'press');
    expect(data.onToggleHiAndChats).toHaveBeenCalledWith(false);

    await fireEvent(getByTestId('settings-row-someone-new-accessory'), 'press');
    expect(data.onToggleSomeoneNew).toHaveBeenCalledWith(true);
  });

  it('requires a second tap before deleting the account', async () => {
    mockData();
    const { getByTestId, queryByTestId } = await renderScreen();
    expect(queryByTestId('settings-delete-account-confirm')).toBeNull();
    expect(deleteMyAccount).not.toHaveBeenCalled();

    await fireEvent.press(getByTestId('settings-delete-account-start'));
    expect(getByTestId('settings-delete-account-confirm')).toBeTruthy();
    expect(deleteMyAccount).not.toHaveBeenCalled();
  });

  it('deletes the account then signs out, in that order', async () => {
    const order: string[] = [];
    (deleteMyAccount as jest.Mock).mockImplementation(async () => {
      order.push('delete_my_account');
    });
    (signOutAndReset as jest.Mock).mockImplementation(async () => {
      order.push('sign_out');
    });
    mockData();
    const { getByTestId } = await renderScreen();

    await fireEvent.press(getByTestId('settings-delete-account-start'));
    await fireEvent.press(getByTestId('settings-delete-account-confirm'));

    await waitFor(() => expect(signOutAndReset).toHaveBeenCalled());
    expect(order).toEqual(['delete_my_account', 'sign_out']);
  });

  it('does not sign out when the delete RPC itself fails', async () => {
    (deleteMyAccount as jest.Mock).mockRejectedValue(new Error("That didn't work."));
    mockData();
    const { getByTestId } = await renderScreen();

    await fireEvent.press(getByTestId('settings-delete-account-start'));
    await fireEvent.press(getByTestId('settings-delete-account-confirm'));

    await waitFor(() => expect(getByTestId('settings-delete-error')).toBeTruthy());
    expect(signOutAndReset).not.toHaveBeenCalled();
  });

  // Ported from the old /settings/account suite (settings-account-delete.test.tsx),
  // whose screen is now a redirect to here: the confirm step must still state
  // the 30-day window and that signing back in purges and restarts.
  it('states the 30-day window and the purge-and-restart behaviour in the confirm copy', async () => {
    mockData();
    const { getByTestId, getByText } = await renderScreen();
    await fireEvent.press(getByTestId('settings-delete-account-start'));
    expect(getByText(/30 days/)).toBeTruthy();
    expect(getByText(/purges the old account for good and starts you fresh/)).toBeTruthy();
  });
});

describe('settings — heading', () => {
  it('has a back arrow that goes back (it was a bare circle)', async () => {
    mockData();
    const { getByLabelText } = await renderScreen();
    await fireEvent.press(getByLabelText('Back'));
    expect(router.back).toHaveBeenCalled();
  });
});
