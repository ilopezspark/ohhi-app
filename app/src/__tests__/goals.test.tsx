import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
}));

// api/goals.ts imports the real supabase client (via ./client), which
// throws outside a real Expo config-eval context (no Constants.expoConfig
// under Jest) -- mock it out so requireActual below doesn't touch it.
jest.mock('../api/client', () => ({ supabase: {} }));

jest.mock('../api/goals', () => {
  const actual = jest.requireActual('../api/goals');
  return {
    ...actual,
    setUserGoals: jest.fn().mockResolvedValue(undefined),
  };
});

import { router } from 'expo-router';
import { setUserGoals } from '../api/goals';
import GoalsScreen from '../app/(onboarding)/goals';

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <GoalsScreen />
    </QueryClientProvider>
  );
}

describe('GoalsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps submit disabled until at least one goal is selected', async () => {
    const { getByTestId } = await renderScreen();
    expect(getByTestId('goals-submit').props.accessibilityState?.disabled).toBe(true);

    await fireEvent.press(getByTestId('goal-chip-friends'));
    await waitFor(() => expect(getByTestId('goals-submit').props.accessibilityState?.disabled).toBe(false));
  });

  it('toggles a chip back off on a second press', async () => {
    const { getByTestId } = await renderScreen();
    await fireEvent.press(getByTestId('goal-chip-friends'));
    await waitFor(() => expect(getByTestId('goals-submit').props.accessibilityState?.disabled).toBe(false));

    await fireEvent.press(getByTestId('goal-chip-friends'));
    await waitFor(() => expect(getByTestId('goals-submit').props.accessibilityState?.disabled).toBe(true));
  });

  it('saves the selected goals and navigates to the photo step on submit', async () => {
    const { getByTestId } = await renderScreen();
    await fireEvent.press(getByTestId('goal-chip-friends'));
    await fireEvent.press(getByTestId('goal-chip-study'));
    await waitFor(() => expect(getByTestId('goals-submit').props.accessibilityState?.disabled).toBe(false));

    await fireEvent.press(getByTestId('goals-submit'));

    await waitFor(() => expect(setUserGoals).toHaveBeenCalledWith(['friends', 'study']));
    // Design step order (docs/design/system.md, index.html's contact sheet):
    // basics -> here for -> about you -> photos. `identity.tsx` now slots in
    // between goals and photo.
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/(onboarding)/identity'));
  });
});
