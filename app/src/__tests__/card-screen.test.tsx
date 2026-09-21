import { render, waitFor, fireEvent } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: jest.fn(),
}));
jest.mock('../api/client', () => ({ supabase: {}, SUPABASE_URL: 'https://example.test' }));
jest.mock('../api/profileCard', () => ({ getProfileCard: jest.fn() }));
jest.mock('../api/identity', () => ({ getIdentity: jest.fn() }));
jest.mock('../api/his', () => ({ sendHi: jest.fn() }));
jest.mock('../api/photos', () => ({ signedPhotoUrls: jest.fn() }));

import { router, useLocalSearchParams } from 'expo-router';
import { getProfileCard } from '../api/profileCard';
import { getIdentity } from '../api/identity';
import { sendHi } from '../api/his';
import { signedPhotoUrls } from '../api/photos';
import ProfileScreen from '../app/profile/[id]';

const TARGET = '44444444-4444-4444-8444-444444444444';

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProfileScreen />
    </QueryClientProvider>
  );
}

const card = (overrides: Record<string, unknown> = {}) => ({
  user_id: TARGET,
  first_name: 'Ada',
  grad_year: 2028,
  status_line: 'hello there',
  tier: 'on_campus',
  here_now: false,
  photos: [] as string[],
  tag_labels: ['coffee'],
  goals: ['friends'],
  my_hi_state: null,
  conversation_id: null,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  (useLocalSearchParams as jest.Mock).mockReturnValue({ id: TARGET });
  (signedPhotoUrls as jest.Mock).mockResolvedValue({});
  (getIdentity as jest.Mock).mockResolvedValue(null);
});

describe('ProfileScreen', () => {
  it('shows a loading state before the card resolves', async () => {
    (getProfileCard as jest.Mock).mockReturnValue(new Promise(() => {}));
    const { findByTestId } = await renderScreen();
    await findByTestId('profile-loading');
  });

  it('renders the neutral unavailable screen on a null (zero-row) card, never a reason', async () => {
    (getProfileCard as jest.Mock).mockResolvedValue(null);
    const { findByTestId, queryByTestId } = await renderScreen();
    await findByTestId('profile-unavailable');
    expect(queryByTestId('profile-cta')).toBeNull();
  });

  it('renders the card fields for a visible card', async () => {
    (getProfileCard as jest.Mock).mockResolvedValue(card());
    const { findByTestId, getByText } = await renderScreen();
    await findByTestId('profile-screen');
    expect(getByText(/Ada/)).toBeTruthy();
    await findByTestId('profile-status-line');
  });

  it('hides the identity row when getIdentity resolves to null (404 — collapsed silently)', async () => {
    (getProfileCard as jest.Mock).mockResolvedValue(card());
    (getIdentity as jest.Mock).mockResolvedValue(null);
    const { findByTestId, queryByTestId } = await renderScreen();
    await findByTestId('profile-screen');
    await waitFor(() => expect(getIdentity).toHaveBeenCalled());
    expect(queryByTestId('profile-identity')).toBeNull();
  });

  it('shows the identity row when getIdentity resolves with data', async () => {
    (getProfileCard as jest.Mock).mockResolvedValue(card());
    (getIdentity as jest.Mock).mockResolvedValue({ pronouns: 'she/her', orientation: ['bi'] });
    const { findByTestId } = await renderScreen();
    await findByTestId('profile-identity');
  });

  it('shows the Hi CTA when there is no prior hi and no conversation', async () => {
    (getProfileCard as jest.Mock).mockResolvedValue(card({ my_hi_state: null, conversation_id: null }));
    const { findByTestId } = await renderScreen();
    const cta = await findByTestId('profile-cta');
    expect(cta.props.accessibilityState?.disabled).toBeFalsy();
  });

  it('sends a hi when the Hi CTA is tapped', async () => {
    (getProfileCard as jest.Mock).mockResolvedValue(card({ my_hi_state: null, conversation_id: null }));
    (sendHi as jest.Mock).mockResolvedValue(undefined);
    const { findByTestId } = await renderScreen();
    const cta = await findByTestId('profile-cta');
    await fireEvent.press(cta);
    await waitFor(() => expect(sendHi).toHaveBeenCalledWith(TARGET));
  });

  it('shows a disabled "Hi sent" CTA when my_hi_state is sent', async () => {
    (getProfileCard as jest.Mock).mockResolvedValue(card({ my_hi_state: 'sent', conversation_id: null }));
    const { findByTestId } = await renderScreen();
    const cta = await findByTestId('profile-cta');
    expect(cta.props.accessibilityState?.disabled).toBe(true);
  });

  it('renders no CTA for a dismissed hi with no conversation', async () => {
    (getProfileCard as jest.Mock).mockResolvedValue(card({ my_hi_state: 'dismissed', conversation_id: null }));
    const { findByTestId, queryByTestId } = await renderScreen();
    await findByTestId('profile-screen');
    expect(queryByTestId('profile-cta')).toBeNull();
  });

  it('renders no CTA for an expired hi with no conversation', async () => {
    (getProfileCard as jest.Mock).mockResolvedValue(card({ my_hi_state: 'expired', conversation_id: null }));
    const { findByTestId, queryByTestId } = await renderScreen();
    await findByTestId('profile-screen');
    expect(queryByTestId('profile-cta')).toBeNull();
  });

  it('navigates to the chat thread when Message is tapped with an existing conversation', async () => {
    (getProfileCard as jest.Mock).mockResolvedValue(card({ my_hi_state: 'sent', conversation_id: 'conv-1' }));
    const { findByTestId } = await renderScreen();
    const cta = await findByTestId('profile-cta');
    await fireEvent.press(cta);
    expect(router.push).toHaveBeenCalledWith('/chat/conv-1');
  });

  it('navigates to the block route with context=profile from the overflow menu', async () => {
    (getProfileCard as jest.Mock).mockResolvedValue(card());
    const { findByTestId } = await renderScreen();
    await findByTestId('profile-screen');
    const trigger = await findByTestId('profile-overflow-trigger');
    await fireEvent.press(trigger);
    const blockItem = await findByTestId('profile-overflow-block');
    await fireEvent.press(blockItem);
    expect(router.push).toHaveBeenCalledWith(`/settings/block/${TARGET}?context=profile`);
  });

  it('navigates to the report route with context=profile from the overflow menu', async () => {
    (getProfileCard as jest.Mock).mockResolvedValue(card());
    const { findByTestId } = await renderScreen();
    await findByTestId('profile-screen');
    const trigger = await findByTestId('profile-overflow-trigger');
    await fireEvent.press(trigger);
    const reportItem = await findByTestId('profile-overflow-report');
    await fireEvent.press(reportItem);
    expect(router.push).toHaveBeenCalledWith(`/settings/report/${TARGET}?context=profile`);
  });
});
