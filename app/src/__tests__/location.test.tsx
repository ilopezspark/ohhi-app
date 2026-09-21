import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
}));

const mockRequestPermission = jest.fn().mockResolvedValue('granted');
jest.mock('../presence', () => ({
  getPresenceController: () => ({ requestPermission: (...args: unknown[]) => mockRequestPermission(...args) }),
}));

const mockSetMyTier = jest.fn().mockResolvedValue(undefined);
jest.mock('../api/presence', () => ({
  setMyTier: (...args: unknown[]) => mockSetMyTier(...args),
}));

import { router } from 'expo-router';
import LocationScreen from '../app/(onboarding)/location';

describe('LocationScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequestPermission.mockResolvedValue('granted');
    mockSetMyTier.mockResolvedValue(undefined);
  });

  it('requests foreground permission through the presence controller and continues to finish', async () => {
    const { getByTestId } = await render(<LocationScreen />);

    await fireEvent.press(getByTestId('location-allow'));

    await waitFor(() => expect(mockRequestPermission).toHaveBeenCalled());
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/(onboarding)/finish'));
    expect(mockSetMyTier).not.toHaveBeenCalled();
  });

  it('writes tier "away" directly on skip (decision 43), without prompting for permission', async () => {
    const { getByTestId } = await render(<LocationScreen />);

    await fireEvent.press(getByTestId('location-skip'));

    await waitFor(() => expect(mockSetMyTier).toHaveBeenCalledWith('away'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/(onboarding)/finish'));
    expect(mockRequestPermission).not.toHaveBeenCalled();
  });

  it('still continues to finish if the permission request itself throws', async () => {
    mockRequestPermission.mockRejectedValueOnce(new Error('boom'));
    const { getByTestId } = await render(<LocationScreen />);

    await fireEvent.press(getByTestId('location-allow'));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/(onboarding)/finish'));
  });

  it('navigates back to status', async () => {
    const { getByTestId } = await render(<LocationScreen />);
    await fireEvent.press(getByTestId('location-back'));
    expect(router.replace).toHaveBeenCalledWith('/(onboarding)/status');
  });
});
