import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
}));

jest.mock('../api/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    }),
  },
}));

const ME_RESULT = {
  id: 'user-1',
  campus_id: 'campus-1',
  campus_label: 'City Life College',
  campus_slug: 'clc',
  goals_count: 1,
  here_now: false,
  photos_count: 0,
  status: 'onboarding',
  tags_count: 0,
  verification_status: 'unverified',
};

jest.mock('../api/me', () => ({
  me: jest.fn().mockResolvedValue(ME_RESULT),
}));

jest.mock('../api/identity', () => ({
  getIdentity: jest.fn().mockResolvedValue(null),
}));

const mockPutIdentity = jest.fn().mockResolvedValue({
  user_id: 'user-1',
  key_version: 1,
  fields_filled: 0,
  updated_at: 'now',
});
jest.mock('../api/identityWrite', () => ({
  putIdentity: (...args: unknown[]) => mockPutIdentity(...args),
}));

import { router } from 'expo-router';
import IdentityScreen from '../app/(onboarding)/identity';

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <IdentityScreen />
    </QueryClientProvider>
  );
}

describe('IdentityScreen (onboarding)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPutIdentity.mockResolvedValue({ user_id: 'user-1', key_version: 1, fields_filled: 0, updated_at: 'now' });
  });

  it('saves with is_public off by default when nothing is filled in', async () => {
    const { getByTestId } = await renderScreen();
    await waitFor(() => expect(getByTestId('identity-continue').props.accessibilityState?.disabled).toBe(false));

    await fireEvent.press(getByTestId('identity-continue'));

    await waitFor(() =>
      expect(mockPutIdentity).toHaveBeenCalledWith({ pronouns: null, orientation: [], is_public: false })
    );
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/(onboarding)/photo'));
  });

  it('sends the selected pronoun/orientation and the toggled is_public flag', async () => {
    const { getByTestId } = await renderScreen();
    await waitFor(() => expect(getByTestId('identity-continue')).toBeTruthy());

    await fireEvent.press(getByTestId('identity-pronoun-she/her'));
    await fireEvent.press(getByTestId('identity-orientation-bi'));
    await fireEvent.press(getByTestId('identity-is-public'));
    await fireEvent.press(getByTestId('identity-continue'));

    await waitFor(() =>
      expect(mockPutIdentity).toHaveBeenCalledWith({ pronouns: 'she/her', orientation: ['bi'], is_public: true })
    );
  });

  it('skips without writing anything', async () => {
    const { getByTestId } = await renderScreen();
    await waitFor(() => expect(getByTestId('identity-skip')).toBeTruthy());

    await fireEvent.press(getByTestId('identity-skip'));

    expect(mockPutIdentity).not.toHaveBeenCalled();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/(onboarding)/photo'));
  });

  it('rejects a custom pronoun over the length cap and blocks continue', async () => {
    const { getByTestId } = await renderScreen();
    await waitFor(() => expect(getByTestId('identity-pronoun-custom-input')).toBeTruthy());

    await fireEvent.changeText(getByTestId('identity-pronoun-custom-input'), 'x'.repeat(50));

    await waitFor(() => expect(getByTestId('identity-pronoun-error')).toBeTruthy());
    expect(getByTestId('identity-continue').props.accessibilityState?.disabled).toBe(true);
  });
});
