import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Forces the web branch in dob.tsx (this gates the only place
// `@react-native-community/datetimepicker` is required), so this test never
// needs to touch the native module — it's the "web input path" the
// onboarding-grid plan §7 test plan calls for.
jest.mock('../onboarding/platform', () => ({ isWeb: () => true }));

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
}));

jest.mock('../api/onboarding', () => ({
  setDateOfBirth: jest.fn().mockResolvedValue(undefined),
}));

import { router } from 'expo-router';
import { setDateOfBirth } from '../api/onboarding';
import DobScreen from '../app/(onboarding)/dob';

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DobScreen />
    </QueryClientProvider>
  );
}

describe('DobScreen (web input path)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps submit disabled until a well-formed date is entered', async () => {
    const { getByTestId } = await renderScreen();
    expect(getByTestId('dob-submit').props.accessibilityState?.disabled).toBe(true);

    await fireEvent.changeText(getByTestId('dob-input'), 'not-a-date');
    expect(getByTestId('dob-submit').props.accessibilityState?.disabled).toBe(true);

    await fireEvent.changeText(getByTestId('dob-input'), '2000-01-01');
    await waitFor(() => expect(getByTestId('dob-submit').props.accessibilityState?.disabled).toBe(false));
  });

  it('shows a non-blocking under-18 hint for a recent DOB', async () => {
    const recentYear = new Date().getFullYear() - 1;
    const { getByTestId } = await renderScreen();

    await fireEvent.changeText(getByTestId('dob-input'), `${recentYear}-01-01`);
    await waitFor(() => expect(getByTestId('dob-under-eighteen-hint')).toBeTruthy());
    // Still submittable -- the server is the authority (onboarding-grid plan §1.4).
    expect(getByTestId('dob-submit').props.accessibilityState?.disabled).toBe(false);
  });

  it('writes the DOB and navigates to the name step on submit', async () => {
    const { getByTestId } = await renderScreen();
    await fireEvent.changeText(getByTestId('dob-input'), '2000-01-01');
    await waitFor(() => expect(getByTestId('dob-submit').props.accessibilityState?.disabled).toBe(false));

    await fireEvent.press(getByTestId('dob-submit'));

    await waitFor(() => expect(setDateOfBirth).toHaveBeenCalledWith('2000-01-01'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/(onboarding)/name'));
  });
});
