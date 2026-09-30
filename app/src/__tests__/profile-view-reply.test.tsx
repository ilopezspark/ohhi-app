import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ProfileView } from '../profile/view/ProfileView';
import type { ProfileViewData } from '../profile/view/model';
import {
  indexReplyTargets,
  photoReplySubject,
  profileReplyMode,
  profileReplyTarget,
  promptReplySubject,
  type ProfileReplyOptions,
} from '../profile/view/reply';
import { MAX_BODY_LENGTH, MAX_OPENER_LENGTH } from '../chat/rules';

/**
 * Reply actions on the profile (migration 0024, decision 100): only what
 * `profile_reply_targets` lists gets one, a tap hands up the right subject,
 * and the owner's own preview has none.
 */

const ME = 'me';
const THEM = 'them';

const PROMPTS = [
  { promptId: 'cafe_order', question: 'my order at the campus cafe', answer: 'oat latte' },
  { promptId: 'sunday', question: 'a slow sunday', answer: 'long walk, no phone', gated: true },
];

const MAYA: ProfileViewData = {
  userId: 'u-maya',
  firstName: 'maya',
  gradYear: 2027,
  statusLine: 'at the library till 10',
  tier: 'on_campus',
  hereNow: false,
  isOnline: false,
  verified: true,
  goals: ['friends'],
  majorLabel: 'nursing',
  tagLabels: ['gym'],
  sharedLines: [],
  identityCards: {},
  identityAudiences: null,
  campusShort: 'CLC',
  photoPaths: ['p0', 'p1', 'p2'],
  photoUrls: {},
  placeLine: null,
  prompts: PROMPTS,
  usualPlaces: null,
  gateOpen: true,
  joinedMonth: null,
  joinedRecency: null,
  about: null,
};

const INDEX = indexReplyTargets([
  { kind: 'user_prompt', targetId: 'up-cafe', promptId: 'cafe_order' },
  { kind: 'user_photo', targetId: 'ph-0', photoPath: 'p0' },
  { kind: 'user_photo', targetId: 'ph-2', photoPath: 'p2' },
]);

async function renderView(props: Partial<Parameters<typeof ProfileView>[0]> = {}) {
  const onReply = jest.fn();
  const reply: ProfileReplyOptions = { index: INDEX, onReply };
  const screen = await render(<ProfileView data={MAYA} onBack={jest.fn()} onOverflow={jest.fn()} reply={reply} {...props} />);
  return { screen, onReply };
}

describe('reply targets (pure)', () => {
  it('indexes prompts by prompt id and photos by path', () => {
    expect(INDEX).toEqual({ prompts: { cafe_order: 'up-cafe' }, photos: { p0: 'ph-0', p2: 'ph-2' } });
    expect(indexReplyTargets(undefined)).toEqual({ prompts: {}, photos: {} });
  });

  it('only a listed prompt or photo is a subject', () => {
    expect(promptReplySubject(PROMPTS[0]!, INDEX)).toEqual({
      kind: 'prompt',
      targetId: 'up-cafe',
      promptId: 'cafe_order',
      question: 'my order at the campus cafe',
      answer: 'oat latte',
    });
    expect(promptReplySubject(PROMPTS[1]!, INDEX)).toBeNull();
    expect(photoReplySubject('p2', 2, INDEX)).toEqual({ kind: 'photo', targetId: 'ph-2', path: 'p2', position: 2 });
    expect(photoReplySubject('p1', 1, INDEX)).toBeNull();
    expect(photoReplySubject(undefined, 0, INDEX)).toBeNull();
  });

  it('a subject sends exactly its own reply column', () => {
    expect(profileReplyTarget({ kind: 'prompt', targetId: 'up', promptId: 'x', question: 'q', answer: 'a' })).toEqual({
      userPromptId: 'up',
    });
    expect(profileReplyTarget({ kind: 'photo', targetId: 'ph', path: 'p', position: 0 })).toEqual({ userPhotoId: 'ph' });
  });

  describe('profileReplyMode', () => {
    const rules = (overrides: Record<string, unknown> = {}) => ({
      state: 'open' as const,
      user_a_id: ME,
      user_b_id: THEM,
      opened_by_id: ME,
      blocked_by: null,
      ...overrides,
    });

    it('is the opener where Message would start a conversation', () => {
      expect(profileReplyMode('hi_and_message', null, ME, null)).toEqual({ mode: 'opener', maxLength: MAX_OPENER_LENGTH });
      expect(profileReplyMode('message_opener', null, ME, null)).toEqual({ mode: 'opener', maxLength: MAX_OPENER_LENGTH });
    });

    it('is nothing where no message can go', () => {
      expect(profileReplyMode('hi_sent', null, ME, null)).toBeNull();
      expect(profileReplyMode('message_pending', null, ME, null)).toBeNull();
      expect(profileReplyMode('none', null, ME, null)).toBeNull();
      // A thread not read yet.
      expect(profileReplyMode('message', null, ME, null)).toBeNull();
    });

    it('goes into a thread whose composer takes a message from me', () => {
      expect(profileReplyMode('message', rules(), ME, { sender_id: THEM })).toEqual({ mode: 'thread', maxLength: MAX_BODY_LENGTH });
      // They opened, I reply: the reply opens the thread.
      expect(
        profileReplyMode('message', rules({ state: 'awaiting_reply', opened_by_id: THEM }), ME, { sender_id: THEM })
      ).toEqual({ mode: 'thread', maxLength: MAX_BODY_LENGTH });
      // I answered their hi and nothing has been said: I may write first.
      expect(profileReplyMode('message', rules({ state: 'awaiting_reply', opened_by_id: THEM }), ME, null)).toEqual({
        mode: 'thread',
        maxLength: MAX_BODY_LENGTH,
      });
      // I opened and nothing is sent yet: my first message is still the one message.
      expect(profileReplyMode('message', rules({ state: 'awaiting_reply' }), ME, null)).toEqual({
        mode: 'opener',
        maxLength: MAX_OPENER_LENGTH,
      });
    });

    it('is nothing for a locked thread', () => {
      expect(profileReplyMode('message', rules({ state: 'awaiting_reply' }), ME, { sender_id: ME })).toBeNull();
      expect(profileReplyMode('message', rules({ state: 'expired' }), ME, { sender_id: THEM })).toBeNull();
    });
  });
});

describe('ProfileView reply actions', () => {
  it('puts a reply action on each listed prompt and gallery photo, and nothing else', async () => {
    const { screen } = await renderView();
    expect(screen.getByTestId('profile-prompt-0-reply')).toBeTruthy();
    expect(screen.queryByTestId('profile-prompt-1-reply')).toBeNull();
    expect(screen.queryByTestId('profile-photo-card-1-reply')).toBeNull();
    expect(screen.getByTestId('profile-photo-card-2-reply')).toBeTruthy();
  });

  it('hands up the prompt it sits on', async () => {
    const { screen, onReply } = await renderView();
    await screen.findByTestId('profile-prompt-0-reply');
    await fireEvent.press(screen.getByTestId('profile-prompt-0-reply'));
    expect(onReply).toHaveBeenCalledWith({
      kind: 'prompt',
      targetId: 'up-cafe',
      promptId: 'cafe_order',
      question: 'my order at the campus cafe',
      answer: 'oat latte',
    });
  });

  it('hands up the photo it sits on, from the gallery and from the hero', async () => {
    const { screen, onReply } = await renderView();
    await fireEvent.press(screen.getByTestId('profile-photo-card-2-reply'));
    expect(onReply).toHaveBeenLastCalledWith({ kind: 'photo', targetId: 'ph-2', path: 'p2', position: 2 });
    await fireEvent.press(screen.getByTestId('profile-photo-reply'));
    expect(onReply).toHaveBeenLastCalledWith({ kind: 'photo', targetId: 'ph-0', path: 'p0', position: 0 });
  });

  it('keeps the hero action in the top right, under the … button', async () => {
    const { screen } = await renderView();
    const style = StyleSheet.flatten(screen.getByTestId('profile-photo-reply').props.style);
    expect(style.position).toBe('absolute');
    expect(style.right).toBeGreaterThan(0);
    // 26 under the top inset for the … row, 44 for the button, then a gap.
    expect(style.top).toBeGreaterThan(26 + 44);
  });

  it('the hero action follows the photo on screen', async () => {
    const { screen } = await renderView();
    expect(screen.getByTestId('profile-photo-reply')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('profile-photo-next'));
    expect(screen.queryByTestId('profile-photo-reply')).toBeNull();
    await fireEvent.press(screen.getByTestId('profile-photo-next'));
    expect(screen.getByTestId('profile-photo-reply')).toBeTruthy();
  });

  it('has none without reply options', async () => {
    const { screen } = await renderView({ reply: undefined });
    expect(screen.queryByTestId('profile-prompt-0-reply')).toBeNull();
    expect(screen.queryByTestId('profile-photo-card-2-reply')).toBeNull();
    expect(screen.queryByTestId('profile-photo-reply')).toBeNull();
  });

  it('has none in the owner’s own preview, even when given options', async () => {
    const { screen } = await renderView({ preview: true, onOverflow: undefined });
    expect(screen.getByTestId('profile-prompt-0')).toBeTruthy();
    expect(screen.queryByTestId('profile-prompt-0-reply')).toBeNull();
    expect(screen.queryByTestId('profile-prompt-1-reply')).toBeNull();
    expect(screen.queryByTestId('profile-photo-card-2-reply')).toBeNull();
    expect(screen.queryByTestId('profile-photo-reply')).toBeNull();
  });
});
