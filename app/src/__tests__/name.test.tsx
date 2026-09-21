import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
}));

jest.mock('../api/profile', () => ({
  updateProfile: jest.fn().mockResolvedValue(undefined),
}));

import { router } from 'expo-router';
import { updateProfile } from '../api/profile';
import NameScreen from '../app/(onboarding)/name';

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NameScreen />
    </QueryClientProvider>
  );
}

describe('NameScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps submit disabled until the first name is 2-20 characters', async () => {
    const { getByTestId } = await renderScreen();
    expect(getByTestId('name-submit').props.accessibilityState?.disabled).toBe(true);

    await fireEvent.changeText(getByTestId('name-input'), 'a');
    await waitFor(() => expect(getByTestId('name-error')).toBeTruthy());
    expect(getByTestId('name-submit').props.accessibilityState?.disabled).toBe(true);

    await fireEvent.changeText(getByTestId('name-input'), 'Sam');
    await waitFor(() => expect(getByTestId('name-submit').props.accessibilityState?.disabled).toBe(false));
  });

  it('rejects a grad year outside the reasonable range and blocks submit', async () => {
    const { getByTestId } = await renderScreen();
    await fireEvent.changeText(getByTestId('name-input'), 'Sam');
    await fireEvent.changeText(getByTestId('grad-year-input'), '1899');

    await waitFor(() => expect(getByTestId('grad-year-error')).toBeTruthy());
    expect(getByTestId('name-submit').props.accessibilityState?.disabled).toBe(true);
  });

  it('updates the profile and navigates to goals on submit (grad year optional)', async () => {
    const { getByTestId } = await renderScreen();
    await fireEvent.changeText(getByTestId('name-input'), 'Sam');
    await waitFor(() => expect(getByTestId('name-submit').props.accessibilityState?.disabled).toBe(false));

    await fireEvent.press(getByTestId('name-submit'));

    await waitFor(() => expect(updateProfile).toHaveBeenCalledWith({ first_name: 'Sam', grad_year: null }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/(onboarding)/goals'));
  });
});
