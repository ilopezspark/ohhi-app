import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockMaybeSingle = jest.fn();
const mockSelectEq = jest.fn((..._args: unknown[]) => ({ maybeSingle: mockMaybeSingle }));
const mockSelect = jest.fn((..._args: unknown[]) => ({ eq: mockSelectEq }));
const mockFrom = jest.fn((..._args: unknown[]) => ({ select: mockSelect }));

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
}));
jest.mock('../api/client', () => ({ supabase: { from: (...args: unknown[]) => mockFrom(...args) } }));
jest.mock('../api/session', () => ({ currentUserId: jest.fn() }));
jest.mock('../api/identity', () => ({ getIdentity: jest.fn() }));
jest.mock('../api/identityWrite', () => ({ putIdentity: jest.fn() }));

import { router } from 'expo-router';
import { currentUserId } from '../api/session';
import { getIdentity } from '../api/identity';
import { putIdentity } from '../api/identityWrite';
import AboutYouEditorScreen from '../app/profile-editor/about';
import { ORIENTATION_CHIPS, ORIENTATION_MAX_ITEMS, PRONOUN_OPTIONS } from '../settings/vocab';

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AboutYouEditorScreen />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  (currentUserId as jest.Mock).mockResolvedValue('me-1');
  (getIdentity as jest.Mock).mockResolvedValue(null);
  mockMaybeSingle.mockResolvedValue({ data: null, error: null });
});

describe('AboutYouEditorScreen', () => {
  it('defaults "show on my profile" to off when nothing was ever written', async () => {
    const { findByTestId } = await renderScreen();
    const toggle = await findByTestId('about-editor-is-public');
    expect(toggle.props.accessibilityState?.checked).toBe(false);
  });

  it("loads the caller's current pronoun/orientation/is_public values", async () => {
    (getIdentity as jest.Mock).mockResolvedValue({ pronouns: 'she/her', orientation: ['bi'] });
    mockMaybeSingle.mockResolvedValue({ data: { is_public: true }, error: null });
    const { findByTestId } = await renderScreen();

    const toggle = await findByTestId('about-editor-is-public');
    expect(toggle.props.accessibilityState?.checked).toBe(true);
    expect((await findByTestId(`about-editor-pronoun-${PRONOUN_OPTIONS[1]}`)).props.accessibilityState.checked).toBe(true);
    expect((await findByTestId('about-editor-orientation-bi')).props.accessibilityState.checked).toBe(true);
  });

  it('caps the free-text pronoun alternative at 40 characters with inline copy', async () => {
    const { findByTestId, findByText } = await renderScreen();
    const input = await findByTestId('about-editor-pronoun-custom-input');
    await fireEvent.changeText(input, 'x'.repeat(41));
    await findByText(/keep it under 40 characters/);
  });

  it('limits orientation to 3 selections — a fourth tap is a no-op', async () => {
    const { findByTestId } = await renderScreen();
    for (const option of ORIENTATION_CHIPS.slice(0, ORIENTATION_MAX_ITEMS + 1)) {
      await fireEvent.press(await findByTestId(`about-editor-orientation-${option}`));
    }
    for (const option of ORIENTATION_CHIPS.slice(0, ORIENTATION_MAX_ITEMS)) {
      expect((await findByTestId(`about-editor-orientation-${option}`)).props.accessibilityState.checked).toBe(true);
    }
    expect(
      (await findByTestId(`about-editor-orientation-${ORIENTATION_CHIPS[ORIENTATION_MAX_ITEMS]}`)).props
        .accessibilityState.checked
    ).toBe(false);
  });

  it('PUTs the full identity payload on done, with is_public carried from the toggle', async () => {
    (putIdentity as jest.Mock).mockResolvedValue({ user_id: 'me-1', key_version: 1, fields_filled: 2, updated_at: 'now' });
    const { findByTestId } = await renderScreen();

    await fireEvent.press(await findByTestId(`about-editor-pronoun-${PRONOUN_OPTIONS[0]}`));
    await fireEvent.press(await findByTestId(`about-editor-orientation-${ORIENTATION_CHIPS[0]}`));
    await fireEvent.press(await findByTestId('about-editor-is-public'));
    await fireEvent.press(await findByTestId('about-editor-done'));

    await waitFor(() =>
      expect(putIdentity).toHaveBeenCalledWith({
        pronouns: PRONOUN_OPTIONS[0],
        orientation: [ORIENTATION_CHIPS[0]],
        is_public: true,
      })
    );
    await waitFor(() => expect(router.back).toHaveBeenCalled());
  });

  it('never offers a "single" option among the pronoun/orientation chips', async () => {
    const { queryByTestId } = await renderScreen();
    await waitFor(() => expect(mockMaybeSingle).toHaveBeenCalled());
    expect(queryByTestId('about-editor-pronoun-single')).toBeNull();
    expect(queryByTestId('about-editor-orientation-single')).toBeNull();
  });

  it('confirms before discarding a dirty edit on cancel', async () => {
    const { findByTestId } = await renderScreen();
    await fireEvent.press(await findByTestId(`about-editor-pronoun-${PRONOUN_OPTIONS[0]}`));
    await fireEvent.press(await findByTestId('about-editor-cancel'));
    expect(Alert.alert).toHaveBeenCalled();
    expect(router.back).not.toHaveBeenCalled();
  });
});
