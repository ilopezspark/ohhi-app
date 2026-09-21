import { fireEvent, render } from '@testing-library/react-native';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
}));

import { router } from 'expo-router';
import WelcomeScreen from '../app/(auth)/welcome';

describe('WelcomeScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('pushes to the email step on continue (not replace, so email can go back here)', async () => {
    const { getByTestId } = await render(<WelcomeScreen />);

    await fireEvent.press(getByTestId('welcome-continue'));

    expect(router.push).toHaveBeenCalledWith('/(auth)/email');
    expect(router.replace).not.toHaveBeenCalled();
  });
});
