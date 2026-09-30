/**
 * Replying to a prompt answer or a photo from someone's profile (migration
 * 0024, decision 100): the targets gate the actions, a tap opens the message
 * sheet with the quote, and the send carries the right reply column, as the
 * opener and into an existing thread. A refusal is the neutral line, in the
 * sheet, with the draft kept.
 */
import { render, waitFor, fireEvent, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) },
  useLocalSearchParams: jest.fn(),
  useFocusEffect: (cb: () => void) => {
    const { useEffect } = jest.requireActual('react');
    useEffect(() => cb(), [cb]);
  },
}));
jest.mock('../api/client', () => ({ supabase: {}, SUPABASE_URL: 'https://example.test' }));
jest.mock('../api/profileCard', () => ({ getProfileCard: jest.fn(), getProfileReplyTargets: jest.fn() }));
jest.mock('../api/identity', () => ({ getIdentity: jest.fn() }));
jest.mock('../api/his', () => ({ sendHi: jest.fn() }));
jest.mock('../api/conversations', () => ({ startConversation: jest.fn(), getConversation: jest.fn() }));
jest.mock('../api/messages', () => ({ sendMessage: jest.fn() }));
jest.mock('../api/photos', () => ({ signedPhotoUrls: jest.fn() }));
jest.mock('../api/me', () => ({ me: jest.fn() }));
jest.mock('../api/tags', () => ({ getUserTags: jest.fn(), listTagCatalog: jest.fn() }));
jest.mock('../api/about', () => ({ getMyAbout: jest.fn() }));

import { router, useLocalSearchParams } from 'expo-router';
import { me } from '../api/me';
import { getUserTags, listTagCatalog } from '../api/tags';
import { getMyAbout } from '../api/about';
import { EMPTY_ABOUT } from '../profile/about';
import { getProfileCard, getProfileReplyTargets } from '../api/profileCard';
import { getIdentity } from '../api/identity';
import { getConversation, startConversation } from '../api/conversations';
import { sendMessage } from '../api/messages';
import { signedPhotoUrls } from '../api/photos';
import { RefusedError, UnknownError } from '../api/errors';
import ProfileScreen from '../app/profile/[id]';

const ME = 'aaaaaaaa-0000-4000-8000-000000000001';
const TARGET = '44444444-4444-4444-8444-444444444444';
const PHOTO_0 = `${TARGET}/0.jpg`;
const PHOTO_1 = `${TARGET}/1.jpg`;
const PHOTO_2 = `${TARGET}/2.jpg`;

const card = (overrides: Record<string, unknown> = {}) => ({
  user_id: TARGET,
  first_name: 'Ada',
  grad_year: 2028,
  status_line: 'hello there',
  tier: 'on_campus',
  here_now: false,
  is_online: false,
  photos: [PHOTO_0, PHOTO_1, PHOTO_2],
  tag_labels: ['coffee'],
  goals: ['friends'],
  prompts: [
    { prompt_id: 'cafe_order', question: 'my order at the campus cafe', answer: 'oat latte' },
    { prompt_id: 'sunday', question: 'a perfect sunday', answer: 'long walk, no phone' },
  ],
  my_hi_state: null,
  conversation_id: null,
  ...overrides,
});

// `cafe_order`, photo 0 and photo 1 may be replied to; `sunday` and photo 2 may not.
const TARGETS = [
  { kind: 'user_prompt', targetId: 'up-cafe', promptId: 'cafe_order' },
  { kind: 'user_photo', targetId: 'ph-0', photoPath: PHOTO_0 },
  { kind: 'user_photo', targetId: 'ph-1', photoPath: PHOTO_1 },
];

const thread = (overrides: Record<string, unknown> = {}) => ({
  id: 'conv-1',
  state: 'open',
  openedById: ME,
  blockedBy: null,
  userAId: ME,
  userBId: TARGET,
  lastMessageAt: '2026-09-29T11:00:00.000Z',
  createdAt: '2026-09-29T10:00:00.000Z',
  other: { id: TARGET, firstName: 'Ada', photoPath: null },
  lastMessage: { sender_id: TARGET },
  lastReadAt: null,
  ...overrides,
});

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProfileScreen />
    </QueryClientProvider>
  );
}

/** Wait for the card and its targets to both be on screen. */
async function ready(screen: Awaited<ReturnType<typeof renderScreen>>) {
  await screen.findByTestId('profile-prompt-0-reply');
}

beforeEach(() => {
  jest.clearAllMocks();
  (useLocalSearchParams as jest.Mock).mockReturnValue({ id: TARGET });
  (signedPhotoUrls as jest.Mock).mockImplementation((paths: string[]) =>
    Promise.resolve(Object.fromEntries(paths.map((path) => [path, `https://signed/${path}`])))
  );
  (getIdentity as jest.Mock).mockResolvedValue(null);
  (me as jest.Mock).mockResolvedValue({ id: ME, campus_id: 'campus-1', campus_slug: 'clc' });
  (listTagCatalog as jest.Mock).mockResolvedValue([]);
  (getUserTags as jest.Mock).mockResolvedValue([]);
  (getMyAbout as jest.Mock).mockResolvedValue(EMPTY_ABOUT);
  (getProfileCard as jest.Mock).mockResolvedValue(card());
  (getProfileReplyTargets as jest.Mock).mockResolvedValue(TARGETS);
  (getConversation as jest.Mock).mockResolvedValue(null);
});

describe('profile reply actions', () => {
  it('reads the targets beside the card', async () => {
    const screen = await renderScreen();
    await ready(screen);
    expect(getProfileReplyTargets).toHaveBeenCalledWith(TARGET);
  });

  it('gives a reply action only to the prompts and photos the targets list', async () => {
    const screen = await renderScreen();
    await ready(screen);
    // Prompts: cafe_order yes, sunday no.
    expect(screen.getByTestId('profile-prompt-0-reply')).toBeTruthy();
    expect(screen.queryByTestId('profile-prompt-1-reply')).toBeNull();
    // Gallery photos: position 1 yes, position 2 no.
    expect(screen.getByTestId('profile-photo-card-1-reply')).toBeTruthy();
    expect(screen.queryByTestId('profile-photo-card-2-reply')).toBeNull();
    // The hero is on photo 0, which is listed.
    expect(screen.getByTestId('profile-photo-reply')).toBeTruthy();
  });

  it('shows the hero action only while the photo on screen is a target', async () => {
    (getProfileReplyTargets as jest.Mock).mockResolvedValue([
      TARGETS[0],
      { kind: 'user_photo', targetId: 'ph-1', photoPath: PHOTO_1 },
    ]);
    const screen = await renderScreen();
    await ready(screen);
    expect(screen.queryByTestId('profile-photo-reply')).toBeNull();
    await fireEvent.press(screen.getByTestId('profile-photo-next'));
    expect(screen.getByTestId('profile-photo-reply')).toBeTruthy();
  });

  it('draws no reply action at all with no targets', async () => {
    (getProfileReplyTargets as jest.Mock).mockResolvedValue([]);
    const screen = await renderScreen();
    await screen.findByTestId('profile-prompt-0');
    await waitFor(() => expect(getProfileReplyTargets).toHaveBeenCalled());
    expect(screen.queryByTestId('profile-prompt-0-reply')).toBeNull();
    expect(screen.queryByTestId('profile-photo-reply')).toBeNull();
    expect(screen.queryByTestId('profile-photo-card-1-reply')).toBeNull();
  });

  it('draws none after a hi that is still waiting (no conversation, no Message)', async () => {
    (getProfileCard as jest.Mock).mockResolvedValue(card({ my_hi_state: 'sent' }));
    const screen = await renderScreen();
    await screen.findByTestId('profile-prompt-0');
    await waitFor(() => expect(getProfileReplyTargets).toHaveBeenCalled());
    expect(screen.queryByTestId('profile-prompt-0-reply')).toBeNull();
    expect(screen.queryByTestId('profile-photo-reply')).toBeNull();
  });

  it('draws none into a thread that would not take my message (the opener, already sent)', async () => {
    (getProfileCard as jest.Mock).mockResolvedValue(card({ conversation_id: 'conv-1' }));
    (getConversation as jest.Mock).mockResolvedValue(
      thread({ state: 'awaiting_reply', openedById: ME, lastMessage: { sender_id: ME } })
    );
    const screen = await renderScreen();
    await screen.findByTestId('profile-prompt-0');
    await waitFor(() => expect(getConversation).toHaveBeenCalledWith('conv-1'));
    expect(screen.queryByTestId('profile-prompt-0-reply')).toBeNull();
    expect(screen.queryByTestId('profile-photo-card-1-reply')).toBeNull();
  });
});

describe('the reply sheet', () => {
  it('opens on a prompt with its question and answer quoted', async () => {
    const screen = await renderScreen();
    await ready(screen);
    await fireEvent.press(screen.getByTestId('profile-prompt-0-reply'));

    const sheet = await screen.findByTestId('profile-message-sheet');
    expect(within(sheet).getByTestId('profile-message-sheet-quote-question').props.children).toBe('my order at the campus cafe');
    expect(within(sheet).getByTestId('profile-message-sheet-quote-answer').props.children).toBe('oat latte');
    // No conversation yet: the one-message sheet.
    expect(within(sheet).getByTestId('profile-message-sheet-title').props.children).toBe('one message to ada');
  });

  it('opens on a gallery photo with its thumbnail quoted', async () => {
    const screen = await renderScreen();
    await ready(screen);
    await fireEvent.press(screen.getByTestId('profile-photo-card-1-reply'));

    const image = await screen.findByTestId('profile-message-sheet-quote-image');
    expect(image.props.source).toEqual({ uri: `https://signed/${PHOTO_1}` });
    expect(screen.getByTestId('profile-message-sheet-quote-caption').props.children).toBe("ada's photo");
  });

  it('the plain message sheet has no quote', async () => {
    const screen = await renderScreen();
    await ready(screen);
    await fireEvent.press(await screen.findByTestId('profile-cta-message'));
    await screen.findByTestId('profile-message-sheet');
    expect(screen.queryByTestId('profile-message-sheet-quote')).toBeNull();
  });
});

describe('sending a reply', () => {
  it('as the opener: starts the conversation, sends with the prompt reference, then opens the thread', async () => {
    (startConversation as jest.Mock).mockResolvedValue('conv-new');
    (sendMessage as jest.Mock).mockResolvedValue({ id: 'msg-1' });
    const screen = await renderScreen();
    await ready(screen);
    await fireEvent.press(screen.getByTestId('profile-prompt-0-reply'));
    await fireEvent.changeText(await screen.findByTestId('profile-message-sheet-input'), 'same order here');
    await fireEvent.press(screen.getByTestId('profile-message-sheet-send'));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/chat/conv-new'));
    expect(startConversation).toHaveBeenCalledWith(TARGET);
    expect(sendMessage).toHaveBeenCalledWith({
      conversationId: 'conv-new',
      body: 'same order here',
      replyTo: { userPromptId: 'up-cafe' },
    });
    expect((startConversation as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      (sendMessage as jest.Mock).mock.invocationCallOrder[0]!
    );
    await waitFor(() => expect(screen.queryByTestId('profile-message-sheet')).toBeNull());
  });

  it('into an existing thread: sends with the photo reference and no new conversation', async () => {
    (getProfileCard as jest.Mock).mockResolvedValue(card({ conversation_id: 'conv-1' }));
    (getConversation as jest.Mock).mockResolvedValue(thread());
    (sendMessage as jest.Mock).mockResolvedValue({ id: 'msg-2' });
    const screen = await renderScreen();
    await ready(screen);
    await fireEvent.press(screen.getByTestId('profile-photo-reply'));

    expect((await screen.findByTestId('profile-message-sheet-title')).props.children).toBe('reply to ada');
    await fireEvent.changeText(screen.getByTestId('profile-message-sheet-input'), 'where is this');
    await fireEvent.press(screen.getByTestId('profile-message-sheet-send'));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/chat/conv-1'));
    expect(startConversation).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      body: 'where is this',
      replyTo: { userPhotoId: 'ph-0' },
    });
  });

  it('into an open thread, the cap is the composer’s, not the opener’s 240', async () => {
    (getProfileCard as jest.Mock).mockResolvedValue(card({ conversation_id: 'conv-1' }));
    (getConversation as jest.Mock).mockResolvedValue(thread());
    const screen = await renderScreen();
    await ready(screen);
    await fireEvent.press(screen.getByTestId('profile-prompt-0-reply'));
    await fireEvent.changeText(await screen.findByTestId('profile-message-sheet-input'), 'x'.repeat(300));
    expect(screen.getByText('300 / 1000')).toBeTruthy();
    expect(screen.queryByText(/you get one/)).toBeNull();
  });

  it('a refusal is the neutral line in the sheet, the draft stays, and the targets are read again', async () => {
    (getProfileCard as jest.Mock).mockResolvedValue(card({ conversation_id: 'conv-1' }));
    (getConversation as jest.Mock).mockResolvedValue(thread());
    (sendMessage as jest.Mock).mockRejectedValue(new RefusedError());
    const screen = await renderScreen();
    await ready(screen);
    await fireEvent.press(screen.getByTestId('profile-prompt-0-reply'));
    await fireEvent.changeText(await screen.findByTestId('profile-message-sheet-input'), 'ha');
    await fireEvent.press(screen.getByTestId('profile-message-sheet-send'));

    const error = await screen.findByTestId('profile-message-sheet-error');
    expect(error.props.children).toBe("That didn't work.");
    expect(screen.getByTestId('profile-message-sheet-input').props.value).toBe('ha');
    expect(router.push).not.toHaveBeenCalled();
    await waitFor(() => expect((getProfileReplyTargets as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(2));
    for (const word of ['not allowed', 'gated', 'removed', 'deleted']) {
      expect(screen.queryByText(new RegExp(word, 'i'))).toBeNull();
    }
  });

  it('as the opener, a failed send retries into the conversation it started, never a second one', async () => {
    (startConversation as jest.Mock).mockResolvedValue('conv-new');
    (sendMessage as jest.Mock).mockRejectedValueOnce(new UnknownError()).mockResolvedValueOnce({ id: 'msg-3' });
    const screen = await renderScreen();
    await ready(screen);
    await fireEvent.press(screen.getByTestId('profile-photo-card-1-reply'));
    await fireEvent.changeText(await screen.findByTestId('profile-message-sheet-input'), 'cute dog');
    await fireEvent.press(screen.getByTestId('profile-message-sheet-send'));

    await screen.findByTestId('profile-message-sheet-error');
    await fireEvent.press(screen.getByTestId('profile-message-sheet-send'));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/chat/conv-new'));
    expect(startConversation).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenLastCalledWith({
      conversationId: 'conv-new',
      body: 'cute dog',
      replyTo: { userPhotoId: 'ph-1' },
    });
  });
});
