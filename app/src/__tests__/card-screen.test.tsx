import { act, render, waitFor, fireEvent } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) },
  useLocalSearchParams: jest.fn(),
  // The card is always the focused screen in these tests.
  useFocusEffect: (cb: () => void) => {
    const { useEffect } = jest.requireActual('react');
    useEffect(() => cb(), [cb]);
  },
}));
jest.mock('../api/client', () => ({ supabase: {}, SUPABASE_URL: 'https://example.test' }));
jest.mock('../api/profileCard', () => ({ getProfileCard: jest.fn() }));
jest.mock('../api/identity', () => ({ getIdentity: jest.fn() }));
jest.mock('../api/his', () => ({ sendHi: jest.fn() }));
jest.mock('../api/conversations', () => ({ startConversation: jest.fn() }));
jest.mock('../api/messages', () => ({ sendMessage: jest.fn() }));
jest.mock('../api/photos', () => ({ signedPhotoUrls: jest.fn() }));
jest.mock('../api/me', () => ({ me: jest.fn() }));
jest.mock('../api/tags', () => ({ getUserTags: jest.fn(), listTagsForCampus: jest.fn() }));

import { router, useLocalSearchParams } from 'expo-router';
import { me } from '../api/me';
import { getUserTags, listTagsForCampus } from '../api/tags';
import { getProfileCard } from '../api/profileCard';
import { getIdentity } from '../api/identity';
import { sendHi } from '../api/his';
import { startConversation } from '../api/conversations';
import { sendMessage } from '../api/messages';
import { signedPhotoUrls } from '../api/photos';
import ProfileScreen from '../app/profile/[id]';
import { GoneError, RefusedError } from '../api/errors';

const TARGET = '44444444-4444-4444-8444-444444444444';

function renderScreen(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(
    <QueryClientProvider client={client}>
      <ProfileScreen />
    </QueryClientProvider>
  );
}

// Migration 0009: `tier` is the effective tier (`on_campus`/`nearby`/`away`
// only) and the card also carries `is_online` (active within 15 minutes).
const card = (overrides: Record<string, unknown> = {}) => ({
  user_id: TARGET,
  first_name: 'Ada',
  grad_year: 2028,
  status_line: 'hello there',
  tier: 'on_campus',
  here_now: false,
  is_online: false,
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
  (me as jest.Mock).mockResolvedValue({ id: 'me-1', campus_id: 'campus-1', campus_slug: 'clc' });
  (listTagsForCampus as jest.Mock).mockResolvedValue([
    { id: 't-coffee', label: 'coffee', category: 'interest', campus_id: null },
    { id: 't-gym', label: 'gym', category: 'interest', campus_id: null },
    { id: 't-nursing', label: 'nursing', category: 'major', campus_id: null },
  ]);
  (getUserTags as jest.Mock).mockResolvedValue([]);
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
    const { findByTestId } = await renderScreen();
    await findByTestId('profile-screen');
    expect(await findByTestId('profile-name')).toHaveTextContent('Ada');
    await findByTestId('profile-status-line');
  });

  it('renders the migration 0015 fields from the card row (place line, prompts, usual places, join month)', async () => {
    (getProfileCard as jest.Mock).mockResolvedValue(
      card({
        place_line: 'library, 2nd floor',
        prompts: [{ prompt_id: 'cafe_order', question: 'my order at the campus cafe', answer: 'oat latte' }],
        usual_places: ['library', 'the gym'],
        gate_open: true,
        joined_month: `${new Date().getFullYear()}-01-01`,
        joined_recency: null,
      })
    );
    const { findByTestId } = await renderScreen();
    expect(await findByTestId('profile-place-line')).toHaveTextContent('library, 2nd floor');
    expect(await findByTestId('profile-prompt-0-answer')).toHaveTextContent('oat latte');
    expect(await findByTestId('profile-around-campus-places')).toHaveTextContent('library, the gym');
    expect(await findByTestId('profile-footer-verified')).toHaveTextContent('verified student at CLC · on ohhi since january');
  });

  it('draws no around-campus card for a gated (null) usual_places', async () => {
    (getProfileCard as jest.Mock).mockResolvedValue(card({ usual_places: null, gate_open: false }));
    const { findByTestId, queryByTestId } = await renderScreen();
    await findByTestId('profile-footer');
    expect(queryByTestId('profile-around-campus')).toBeNull();
  });

  describe('the hero mirrors the tile (migration 0009)', () => {
    it('shows the tier pill for on_campus/nearby', async () => {
      (getProfileCard as jest.Mock).mockResolvedValue(card({ tier: 'on_campus' }));
      const { findByTestId } = await renderScreen();
      await findByTestId('profile-tier-pill');
    });

    it('omits the tier pill entirely for away — no word to show', async () => {
      (getProfileCard as jest.Mock).mockResolvedValue(card({ tier: 'away' }));
      const { findByTestId, queryByTestId } = await renderScreen();
      await findByTestId('profile-screen');
      expect(queryByTestId('profile-tier-pill')).toBeNull();
    });

    it('shows a quiet online dot only when here_now is false and is_online is true', async () => {
      (getProfileCard as jest.Mock).mockResolvedValue(
        card({ here_now: false, is_online: true })
      );
      const { findByTestId } = await renderScreen();
      await findByTestId('profile-online-dot');
    });

    it('hides the online dot when offline', async () => {
      (getProfileCard as jest.Mock).mockResolvedValue(
        card({ here_now: false, is_online: false })
      );
      const { findByTestId, queryByTestId } = await renderScreen();
      await findByTestId('profile-screen');
      expect(queryByTestId('profile-online-dot')).toBeNull();
    });

    it('hides the online dot when here_now is true — the here-now badge takes precedence', async () => {
      (getProfileCard as jest.Mock).mockResolvedValue(card({ here_now: true, is_online: true }));
      const { findByTestId, queryByTestId } = await renderScreen();
      await findByTestId('profile-here-now-badge');
      expect(queryByTestId('profile-online-dot')).toBeNull();
    });
  });

  it('hides the identity row when getIdentity resolves to null (404 — collapsed silently)', async () => {
    (getProfileCard as jest.Mock).mockResolvedValue(card());
    (getIdentity as jest.Mock).mockResolvedValue(null);
    const { findByTestId, queryByTestId } = await renderScreen();
    await findByTestId('profile-screen');
    await waitFor(() => expect(getIdentity).toHaveBeenCalled());
    expect(queryByTestId('profile-identity')).toBeNull();
  });

  it('shows pronouns and orientation as rows in the basics card when getIdentity resolves with data', async () => {
    (getProfileCard as jest.Mock).mockResolvedValue(card());
    (getIdentity as jest.Mock).mockResolvedValue({ pronouns: 'she/her', orientation: ['bi'] });
    const { findByTestId } = await renderScreen();
    expect(await findByTestId('profile-identity')).toHaveTextContent('she/her');
    expect(await findByTestId('profile-identity-orientation')).toHaveTextContent(/bi/);
  });

  it('shows both Hi and Message as equal openers when there is no prior hi and no conversation', async () => {
    (getProfileCard as jest.Mock).mockResolvedValue(card({ my_hi_state: null, conversation_id: null }));
    const { findByTestId } = await renderScreen();
    const hiCta = await findByTestId('profile-cta-hi');
    const messageCta = await findByTestId('profile-cta-message');
    expect(hiCta.props.accessibilityState?.disabled).toBeFalsy();
    expect(messageCta.props.accessibilityState?.disabled).toBeFalsy();
  });

  it('sends a hi when the Hi CTA is tapped', async () => {
    (getProfileCard as jest.Mock).mockResolvedValue(card({ my_hi_state: null, conversation_id: null }));
    (sendHi as jest.Mock).mockResolvedValue(undefined);
    const { findByTestId } = await renderScreen();
    const cta = await findByTestId('profile-cta-hi');
    await fireEvent.press(cta);
    await waitFor(() => expect(sendHi).toHaveBeenCalledWith(TARGET));
  });

  it('opens the one-message sheet (not a direct startConversation call) when Message is tapped with no conversation yet', async () => {
    (getProfileCard as jest.Mock).mockResolvedValue(card({ my_hi_state: null, conversation_id: null }));
    const { findByTestId, queryByTestId } = await renderScreen();
    const cta = await findByTestId('profile-cta-message');

    expect(queryByTestId('profile-message-sheet')).toBeNull();
    await fireEvent.press(cta);

    await findByTestId('profile-message-sheet');
    expect(startConversation).not.toHaveBeenCalled();
  });

  it('calls startConversation, then sendMessage with the typed draft, then navigates to the new thread, in that order', async () => {
    (getProfileCard as jest.Mock).mockResolvedValue(card({ my_hi_state: null, conversation_id: null }));
    (startConversation as jest.Mock).mockResolvedValue('conv-new');
    (sendMessage as jest.Mock).mockResolvedValue({ id: 'msg-1' });
    const { findByTestId } = await renderScreen();
    const cta = await findByTestId('profile-cta-message');
    await fireEvent.press(cta);

    const input = await findByTestId('profile-message-sheet-input');
    await fireEvent.changeText(input, 'hey, saw you at orientation');

    const send = await findByTestId('profile-message-sheet-send');
    await fireEvent.press(send);

    await waitFor(() => expect(startConversation).toHaveBeenCalledWith(TARGET));
    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith({
        conversationId: 'conv-new',
        body: 'hey, saw you at orientation',
      })
    );
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/chat/conv-new'));

    const startOrder = (startConversation as jest.Mock).mock.invocationCallOrder[0];
    const sendOrder = (sendMessage as jest.Mock).mock.invocationCallOrder[0];
    const pushOrder = (router.push as jest.Mock).mock.invocationCallOrder.find(
      (order, i) => (router.push as jest.Mock).mock.calls[i]?.[0] === '/chat/conv-new'
    );
    expect(startOrder).toBeLessThan(sendOrder);
    expect(sendOrder).toBeLessThan(pushOrder as number);
  });

  it('keeps the sheet\'s send disabled until a draft is typed', async () => {
    (getProfileCard as jest.Mock).mockResolvedValue(card({ my_hi_state: null, conversation_id: null }));
    const { findByTestId } = await renderScreen();
    const cta = await findByTestId('profile-cta-message');
    await fireEvent.press(cta);

    const send = await findByTestId('profile-message-sheet-send');
    expect(send.props.accessibilityState?.disabled).toBe(true);

    const input = await findByTestId('profile-message-sheet-input');
    await fireEvent.changeText(input, 'hi!');
    expect(send.props.accessibilityState?.disabled).toBe(false);
  });

  it('navigates to the thread with the draft preserved when sendMessage fails after the conversation was created', async () => {
    (getProfileCard as jest.Mock).mockResolvedValue(card({ my_hi_state: null, conversation_id: null }));
    (startConversation as jest.Mock).mockResolvedValue('conv-new');
    (sendMessage as jest.Mock).mockRejectedValue(new Error("That didn't work."));
    const { findByTestId } = await renderScreen();
    const cta = await findByTestId('profile-cta-message');
    await fireEvent.press(cta);

    const input = await findByTestId('profile-message-sheet-input');
    await fireEvent.changeText(input, 'hey there');

    const send = await findByTestId('profile-message-sheet-send');
    await fireEvent.press(send);

    await waitFor(() => expect(sendMessage).toHaveBeenCalled());
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith({
        pathname: '/chat/[id]',
        params: { id: 'conv-new', draft: 'hey there' },
      })
    );
    // Not the generic refetch-and-show-error path — the conversation exists now.
    expect(getProfileCard).toHaveBeenCalledTimes(1);
  });

  it('shows a disabled "Hi sent" CTA with no Message button when my_hi_state is sent — locked out of both openers', async () => {
    (getProfileCard as jest.Mock).mockResolvedValue(card({ my_hi_state: 'sent', conversation_id: null }));
    const { findByTestId, queryByTestId } = await renderScreen();
    const cta = await findByTestId('profile-cta-hi');
    expect(cta.props.accessibilityState?.disabled).toBe(true);
    expect(queryByTestId('profile-cta-message')).toBeNull();
  });

  it('shows Message only (no Hi) for a dismissed hi with no conversation, opening the one-message sheet', async () => {
    (getProfileCard as jest.Mock).mockResolvedValue(card({ my_hi_state: 'dismissed', conversation_id: null }));
    (startConversation as jest.Mock).mockResolvedValue('conv-new');
    (sendMessage as jest.Mock).mockResolvedValue({ id: 'msg-1' });
    const { findByTestId, queryByTestId } = await renderScreen();
    await findByTestId('profile-screen');
    expect(queryByTestId('profile-cta-hi')).toBeNull();
    const cta = await findByTestId('profile-cta-message');
    await fireEvent.press(cta);

    const input = await findByTestId('profile-message-sheet-input');
    await fireEvent.changeText(input, 'hi there');

    const send = await findByTestId('profile-message-sheet-send');
    await fireEvent.press(send);
    await waitFor(() => expect(startConversation).toHaveBeenCalledWith(TARGET));
  });

  it('shows Message only (no Hi) for an expired hi with no conversation', async () => {
    (getProfileCard as jest.Mock).mockResolvedValue(card({ my_hi_state: 'expired', conversation_id: null }));
    const { findByTestId, queryByTestId } = await renderScreen();
    await findByTestId('profile-screen');
    expect(queryByTestId('profile-cta-hi')).toBeNull();
    await findByTestId('profile-cta-message');
  });

  it('navigates to the chat thread when Message is tapped with an existing conversation', async () => {
    (getProfileCard as jest.Mock).mockResolvedValue(card({ my_hi_state: 'sent', conversation_id: 'conv-1' }));
    const { findByTestId, queryByTestId } = await renderScreen();
    expect(queryByTestId('profile-cta-hi')).toBeNull();
    const cta = await findByTestId('profile-cta-message');
    await fireEvent.press(cta);
    expect(router.push).toHaveBeenCalledWith('/chat/conv-1');
    expect(startConversation).not.toHaveBeenCalled();
  });

  it('refetches the card once when startConversation is refused, without leaking why', async () => {
    (getProfileCard as jest.Mock)
      .mockResolvedValueOnce(card({ my_hi_state: null, conversation_id: null }))
      .mockResolvedValueOnce(card({ my_hi_state: null, conversation_id: 'conv-existing' }));
    (startConversation as jest.Mock).mockRejectedValue(new Error("That didn't work."));
    const { findByTestId } = await renderScreen();
    const cta = await findByTestId('profile-cta-message');
    await fireEvent.press(cta);

    const input = await findByTestId('profile-message-sheet-input');
    await fireEvent.changeText(input, 'hi there');

    const send = await findByTestId('profile-message-sheet-send');
    await fireEvent.press(send);

    await waitFor(() => expect(getProfileCard).toHaveBeenCalledTimes(2));
    await findByTestId('profile-message-error');
    expect(sendMessage).not.toHaveBeenCalled();
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

describe('ProfileScreen — profile redesign, phase 1', () => {
  it('finds the major from the campus tag catalog: it goes in the pin line, not the chips or into', async () => {
    (getProfileCard as jest.Mock).mockResolvedValue(card({ tag_labels: ['nursing', 'coffee'] }));
    const screen = await renderScreen();
    await waitFor(() => expect(screen.getByTestId('profile-meta')).toHaveTextContent("on campus · nursing '28"));
    expect(screen.getByTestId('profile-tags')).not.toHaveTextContent(/nursing/);
    expect(screen.getByTestId('profile-into')).not.toHaveTextContent(/nursing/);
    expect(screen.getByTestId('profile-basics-major')).toHaveTextContent(/nursing/);
  });

  it('keeps every tag a chip when the catalog read fails (never blocks the screen)', async () => {
    (listTagsForCampus as jest.Mock).mockRejectedValue(new Error('offline'));
    (getProfileCard as jest.Mock).mockResolvedValue(card({ tag_labels: ['nursing', 'coffee'] }));
    const screen = await renderScreen();
    await screen.findByTestId('profile-screen');
    expect(screen.getByTestId('profile-tags')).toHaveTextContent(/nursing/);
    await screen.findByTestId('profile-cta-hi');
  });

  it('what you two share: computed from my tags against theirs, hidden when nothing matches', async () => {
    (getUserTags as jest.Mock).mockResolvedValue([{ tag_id: 't-coffee', position: 0 }]);
    (getProfileCard as jest.Mock).mockResolvedValue(card({ tag_labels: ['coffee', 'gym'] }));
    const screen = await renderScreen();
    expect(await screen.findByTestId('profile-shared')).toHaveTextContent(/you're both into coffee/);
    expect(screen.getByTestId('profile-shared')).not.toHaveTextContent(/gym/);
  });

  it('hides what you two share when nothing is shared', async () => {
    (getUserTags as jest.Mock).mockResolvedValue([{ tag_id: 't-gym', position: 0 }]);
    (getProfileCard as jest.Mock).mockResolvedValue(card({ tag_labels: ['coffee'] }));
    const screen = await renderScreen();
    await waitFor(() => expect(getUserTags).toHaveBeenCalled());
    await screen.findByTestId('profile-into');
    expect(screen.queryByTestId('profile-shared')).toBeNull();
  });

  it('the footer names the campus and its report or block link opens the same sheet as the overflow', async () => {
    (getProfileCard as jest.Mock).mockResolvedValue(card());
    const screen = await renderScreen();
    await waitFor(() => expect(screen.getByTestId('profile-footer-verified')).toHaveTextContent('verified student at CLC'));
    await fireEvent.press(screen.getByTestId('profile-report-block'));
    await fireEvent.press(await screen.findByTestId('profile-overflow-report'));
    expect(router.push).toHaveBeenCalledWith(`/settings/report/${TARGET}?context=profile`);
  });

  it('the back button leaves the screen', async () => {
    (getProfileCard as jest.Mock).mockResolvedValue(card());
    const screen = await renderScreen();
    await fireEvent.press(await screen.findByTestId('profile-back'));
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('the unavailable screen has its own back button (the stack header is off)', async () => {
    (getProfileCard as jest.Mock).mockResolvedValue(null);
    const screen = await renderScreen();
    await screen.findByTestId('profile-unavailable');
    await fireEvent.press(screen.getByTestId('profile-plain-back'));
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('a sparse profile shows the notice and the goals fallback', async () => {
    (getProfileCard as jest.Mock).mockResolvedValue(
      card({ first_name: 'luis', status_line: null, tag_labels: ['nursing'], goals: [], photos: ['p0'] })
    );
    const screen = await renderScreen();
    expect(await screen.findByTestId('profile-sparse-notice')).toHaveTextContent("luis hasn't filled much in yet. not a red flag.");
    expect(screen.getByTestId('profile-goals')).toHaveTextContent('here for — still figuring it out');
  });

  it('keeps the hi-sent state in the sticky bar after scrolling onto paper', async () => {
    (getProfileCard as jest.Mock).mockResolvedValue(card({ my_hi_state: 'sent' }));
    const screen = await renderScreen();
    await screen.findByTestId('profile-cta-hi');
    await fireEvent.scroll(screen.getByTestId('profile-scroll'), {
      nativeEvent: { contentOffset: { x: 0, y: 3000 }, contentSize: { height: 4000, width: 390 }, layoutMeasurement: { height: 844, width: 390 } },
    });
    await screen.findByTestId('profile-header');
    expect(screen.getByTestId('profile-cta-hi').props.accessibilityState?.disabled).toBe(true);
    expect(screen.getByTestId('profile-cta-hi')).toHaveTextContent('hi sent');
    expect(screen.queryByTestId('profile-cta-message')).toBeNull();
  });
});

describe('ProfileScreen — gone (migration 0014, decision 90)', () => {
  const NO_REASON = /banned|suspended|deleted|blocked/i;

  function clientWithGrid() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    client.setQueryData(['grid_for_me'], [{ user_id: TARGET }, { user_id: 'someone-else' }]);
    return client;
  }

  it('an empty first read keeps the neutral screen (a paused person has no card either) and drops the stale tile', async () => {
    (getProfileCard as jest.Mock).mockResolvedValue(null);
    const client = clientWithGrid();
    const screen = await renderScreen(client);

    expect(await screen.findByTestId('profile-unavailable')).toHaveTextContent("this profile isn't available.");
    await waitFor(() => expect(client.getQueryData(['grid_for_me'])).toEqual([{ user_id: 'someone-else' }]));
    expect(router.back).not.toHaveBeenCalled();
    expect(screen.queryByText(NO_REASON)).toBeNull();
  });

  it('a card that was on screen and refetches empty leaves quietly and drops out of the cache', async () => {
    (getProfileCard as jest.Mock).mockResolvedValue(card());
    const client = clientWithGrid();
    const screen = await renderScreen(client);
    await screen.findByTestId('profile-screen');

    (getProfileCard as jest.Mock).mockResolvedValue(null);
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['profile_card', TARGET] });
    });

    await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('profile-gone')).toBeTruthy();
    expect(screen.queryByTestId('profile-unavailable')).toBeNull();
    expect(client.getQueryData(['profile_card', TARGET])).toBeUndefined();
    expect(client.getQueryData(['grid_for_me'])).toEqual([{ user_id: 'someone-else' }]);
    expect(screen.queryByText(NO_REASON)).toBeNull();
  });

  it('falls back to the grid when there is nothing to go back to', async () => {
    (router.canGoBack as jest.Mock).mockReturnValueOnce(false);
    (getProfileCard as jest.Mock).mockResolvedValueOnce(card()).mockResolvedValue(null);
    const client = clientWithGrid();
    const screen = await renderScreen(client);
    await screen.findByTestId('profile-screen');
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['profile_card', TARGET] });
    });
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/grid'));
  });

  it('a refused hi re-checks the card once, and leaves when the person is gone; never retried', async () => {
    (getProfileCard as jest.Mock).mockResolvedValueOnce(card()).mockResolvedValue(null);
    (sendHi as jest.Mock).mockRejectedValue(new RefusedError());
    const screen = await renderScreen();
    await fireEvent.press(await screen.findByTestId('profile-cta-hi'));

    await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));
    expect(sendHi).toHaveBeenCalledTimes(1);
    expect(getProfileCard).toHaveBeenCalledTimes(2);
  });

  it('a refused hi toward someone still there keeps the neutral error line and stays', async () => {
    (getProfileCard as jest.Mock).mockResolvedValue(card());
    (sendHi as jest.Mock).mockRejectedValue(new RefusedError());
    const screen = await renderScreen();
    await fireEvent.press(await screen.findByTestId('profile-cta-hi'));

    expect(await screen.findByTestId('profile-hi-error')).toHaveTextContent("That didn't work.");
    await waitFor(() => expect(getProfileCard).toHaveBeenCalledTimes(2));
    expect(router.back).not.toHaveBeenCalled();
    expect(sendHi).toHaveBeenCalledTimes(1);
  });

  it('a first message answered "conversation not found" does not land in the dead thread; it re-checks the card', async () => {
    (getProfileCard as jest.Mock).mockResolvedValueOnce(card()).mockResolvedValue(null);
    (startConversation as jest.Mock).mockResolvedValue('conv-new');
    (sendMessage as jest.Mock).mockRejectedValue(new GoneError());
    const screen = await renderScreen();
    await fireEvent.press(await screen.findByTestId('profile-cta-message'));
    await fireEvent.changeText(await screen.findByTestId('profile-message-sheet-input'), 'hey');
    await fireEvent.press(await screen.findByTestId('profile-message-sheet-send'));

    await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));
    expect(router.push).not.toHaveBeenCalledWith(expect.objectContaining({ pathname: '/chat/[id]' }));
    expect(router.push).not.toHaveBeenCalledWith('/chat/conv-new');
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});
