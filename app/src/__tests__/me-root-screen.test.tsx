import { fireEvent, render } from '@testing-library/react-native';

jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() } }));
jest.mock('../me/root/useMeData', () => ({ useMeData: jest.fn() }));

import { router } from 'expo-router';
import { useMeData } from '../me/root/useMeData';
import MeScreen from '../app/(tabs)/settings';

function baseData(overrides: Partial<ReturnType<typeof useMeData>> = {}) {
  return {
    isLoading: false,
    firstName: 'izaac',
    verified: true,
    identityText: "CLC · cs '27",
    photoUrl: undefined,
    tint: '#E8C9B4',
    completionPercent: 80,
    nextBestCopy: 'one more photo and you stop looking half-finished on the grid.',
    statusLine: 'at the library',
    privateCardShareCount: 3,
    albumCount: 2,
    sharedAlbumCount: 1,
    refetch: jest.fn(),
    ...overrides,
  };
}

function mockData(overrides: Partial<ReturnType<typeof useMeData>> = {}) {
  (useMeData as jest.Mock).mockReturnValue(baseData(overrides));
}

describe('MeScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders an incomplete profile with its next-best line', async () => {
    mockData();
    const { getByTestId } = await render(<MeScreen />);
    expect(getByTestId('me-completion-label').props.children).toBe('80%');
    expect(getByTestId('me-next-best')).toBeTruthy();
  });

  it('hides the next-best line at 100% complete', async () => {
    mockData({ completionPercent: 100, nextBestCopy: null });
    const { queryByTestId, getByTestId } = await render(<MeScreen />);
    expect(getByTestId('me-completion-label').props.children).toBe('100%');
    expect(queryByTestId('me-next-best')).toBeNull();
  });

  it('shows "add a status" when there is no status line', async () => {
    mockData({ statusLine: null });
    const { getByText } = await render(<MeScreen />);
    expect(getByText('add a status')).toBeTruthy();
  });

  it('shows the real status line when one exists', async () => {
    mockData({ statusLine: 'free between classes' });
    const { getByText, queryByText } = await render(<MeScreen />);
    expect(getByText('free between classes')).toBeTruthy();
    expect(queryByText('add a status')).toBeNull();
  });

  it('shows "not shared with anyone" at zero private-card shares', async () => {
    mockData({ privateCardShareCount: 0 });
    const { getByText } = await render(<MeScreen />);
    expect(getByText('not shared with anyone')).toBeTruthy();
  });

  it('shows the share count when the private card has been shared', async () => {
    mockData({ privateCardShareCount: 1 });
    const { getByText } = await render(<MeScreen />);
    expect(getByText('shared with 1 person')).toBeTruthy();
  });

  it('hides the verified check for an unverified profile', async () => {
    mockData({ verified: false });
    const { queryByTestId } = await render(<MeScreen />);
    expect(queryByTestId('me-verified-check')).toBeNull();
  });

  it('shows the verified check for a verified profile', async () => {
    mockData({ verified: true });
    const { getByTestId } = await render(<MeScreen />);
    expect(getByTestId('me-verified-check')).toBeTruthy();
  });

  it('navigates to /me/settings from the gear', async () => {
    mockData();
    const { getByTestId } = await render(<MeScreen />);
    await fireEvent.press(getByTestId('me-settings-gear'));
    expect(router.push).toHaveBeenCalledWith('/me/settings');
  });

  it('navigates to /profile-editor from "edit profile"', async () => {
    mockData();
    const { getByTestId } = await render(<MeScreen />);
    await fireEvent.press(getByTestId('me-edit-profile'));
    expect(router.push).toHaveBeenCalledWith('/profile-editor');
  });

  it('pushes the preview screen from "see how you look on the grid"', async () => {
    mockData();
    const { getByTestId } = await render(<MeScreen />);
    await fireEvent.press(getByTestId('me-preview'));
    expect(router.push).toHaveBeenCalledWith('/profile-preview');
  });

  it('navigates to /quick-status from the status row', async () => {
    mockData();
    const { getByTestId } = await render(<MeScreen />);
    await fireEvent.press(getByTestId('me-status-row'));
    expect(router.push).toHaveBeenCalledWith('/quick-status');
  });

  it('navigates to the private card and albums rows', async () => {
    mockData();
    const { getByTestId } = await render(<MeScreen />);
    await fireEvent.press(getByTestId('me-row-private-card'));
    expect(router.push).toHaveBeenCalledWith('/me/private-card');
    await fireEvent.press(getByTestId('me-row-albums'));
    expect(router.push).toHaveBeenCalledWith('/settings/albums');
  });
});
