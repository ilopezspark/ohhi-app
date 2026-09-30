import { Text as RNText } from 'react-native';
import { fireEvent, render, within } from '@testing-library/react-native';
import { ProfileView } from '../profile/view/ProfileView';
import type { ProfileViewData } from '../profile/view/model';
import {
  AUDIENCE_NOTES,
  beforeYouMessageItems,
  beforeYouMessageLine,
  identityCardModels,
  identityRowModels,
  joinValue,
} from '../profile/view/identityCards';
import { emptyIdentityCards, type IdentityCards } from '../profile/fields';
import { colors } from '../theme/tokens';

/**
 * Profile restructure, phase 4b: the five public cards after `about`
 * (identity, background, lifestyle, when i'm around, before you message me),
 * rendered exactly as `GET /identity/:id` returned them, and the "before you
 * message me" strip docked above say-hi (reconcile C4).
 */

function cardOf<C extends keyof IdentityCards>(card: C, values: Partial<IdentityCards[C]>): IdentityCards[C] {
  return { ...emptyIdentityCards()[card], ...values };
}

const FULL: Partial<IdentityCards> = {
  identity: cardOf('identity', {
    pronouns: ['she/her', 'they/them'],
    orientation: ['bi'],
    interested_in: ['women', 'nonbinary people'],
    relationship: 'single',
  }),
  background: cardOf('background', {
    languages: ['english', 'tagalog'],
    faith: 'catholic',
    faith_weight: 'somewhat',
    politics: 'left',
    politics_weight: null,
  }),
  lifestyle: cardOf('lifestyle', { drinking: 'socially', smoking: null, four_twenty: null, kids: 'not sure' }),
  around: cardOf('around', { when_free: ['evenings', 'weekends only'], communication: ["i'm direct"] }),
  before_you_message: cardOf('before_you_message', {
    photos_content: ['ask before you send anything', "don't screenshot", 'nothing with my face'],
  }),
};

const BASE: ProfileViewData = {
  userId: 'u-maya',
  firstName: 'maya',
  gradYear: 2027,
  statusLine: 'at the library',
  tier: 'on_campus',
  hereNow: false,
  isOnline: false,
  verified: true,
  goals: ['friends'],
  majorLabel: 'nursing',
  tagLabels: ['gym'],
  sharedLines: [],
  identityCards: FULL,
  identityAudiences: null,
  campusShort: 'CLC',
  photoPaths: ['p0', 'p1'],
  photoUrls: {},
  placeLine: null,
  prompts: [],
  usualPlaces: null,
  gateOpen: false,
  joinedMonth: null,
  joinedRecency: null,
  about: {
    major: { id: 'p-nursing', label: 'nursing' },
    minor: null,
    graduatingTerm: 'spring',
    graduatingYear: 2027,
    graduatingUnsure: false,
    workType: null,
    jobTitle: null,
    workHours: [],
  },
};

function renderView(data: ProfileViewData, props: Partial<Parameters<typeof ProfileView>[0]> = {}) {
  return render(
    <ProfileView
      data={data}
      onBack={jest.fn()}
      onOverflow={jest.fn()}
      renderActions={() => <RNText testID="actions">say hi</RNText>}
      {...props}
    />
  );
}

function detailIds(screen: Awaited<ReturnType<typeof renderView>>, prefix = 'profile'): (string | null)[] {
  return screen.getByTestId(`${prefix}-details`).children.map((child) => {
    const node = typeof child === 'string' ? null : child.children[0];
    return node && typeof node !== 'string' ? node.props.testID : null;
  });
}

const flat = (node: { props: { style?: unknown } }) => Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean));

describe('identity cards — order and skipping', () => {
  it('renders the five cards after about, in the brief order, before the photos', async () => {
    const screen = await renderView(BASE);
    expect(detailIds(screen)).toEqual([
      'profile-about',
      'profile-card-identity',
      'profile-card-background',
      'profile-card-lifestyle',
      'profile-card-around',
      'profile-card-before_you_message',
      'profile-photo-card-1',
      'profile-into',
      'profile-footer',
    ]);
  });

  it('uses the owner labels for card titles', async () => {
    const screen = await renderView(BASE);
    expect(within(screen.getByTestId('profile-card-identity')).getByText('identity')).toBeTruthy();
    expect(within(screen.getByTestId('profile-card-around')).getByText("when i'm around")).toBeTruthy();
    expect(within(screen.getByTestId('profile-card-before_you_message')).getByText('before you message me')).toBeTruthy();
  });

  it('skips a card whose fields are all empty, and a card that did not come back at all', async () => {
    const screen = await renderView({
      ...BASE,
      identityCards: { ...FULL, lifestyle: cardOf('lifestyle', {}), around: undefined },
    });
    expect(screen.queryByTestId('profile-card-lifestyle')).toBeNull();
    expect(screen.queryByTestId('profile-card-around')).toBeNull();
    expect(screen.getByTestId('profile-card-background')).toBeTruthy();
  });

  it('skips a row with no value and never draws a placeholder', async () => {
    const screen = await renderView(BASE);
    const lifestyle = screen.getByTestId('profile-card-lifestyle');
    expect(screen.getByTestId('profile-card-lifestyle-drinking')).toHaveTextContent(/socially/);
    expect(screen.getByTestId('profile-card-lifestyle-kids')).toHaveTextContent(/not sure/);
    expect(screen.queryByTestId('profile-card-lifestyle-smoking')).toBeNull();
    expect(screen.queryByTestId('profile-card-lifestyle-four_twenty')).toBeNull();
    expect(lifestyle).not.toHaveTextContent(/n\/a|not set|smoking|420/);
  });

  it('with no identity cards at all, nothing new is drawn and there is no basics card', async () => {
    const screen = await renderView({ ...BASE, identityCards: {} });
    expect(detailIds(screen)).toEqual(['profile-about', 'profile-photo-card-1', 'profile-into', 'profile-footer']);
    expect(screen.queryByTestId('profile-basics')).toBeNull();
  });
});

describe('identity cards — rows', () => {
  it('joins multi-values with " · " and shows the field name as the sub-line', async () => {
    const screen = await renderView(BASE);
    const pronouns = screen.getByTestId('profile-card-identity-pronouns');
    expect(pronouns).toHaveTextContent('she/her · they/thempronouns');
    expect(screen.getByTestId('profile-card-identity-interested_in')).toHaveTextContent('women · nonbinary peopleinterested in');
    expect(screen.getByTestId('profile-card-around-when_free')).toHaveTextContent("evenings · weekends onlywhen i'm free");
    // The owner's labels verbatim (ruling 3), "single" included.
    expect(screen.getByTestId('profile-card-identity-relationship')).toHaveTextContent('singlerelationship');
  });

  it('renders faith_weight / politics_weight as the sub-line under their parent, never as rows', async () => {
    const screen = await renderView(BASE);
    expect(screen.getByTestId('profile-card-background-faith')).toHaveTextContent('catholicfaith · somewhat');
    // No weight set: the sub-line is just the field name.
    expect(screen.getByTestId('profile-card-background-politics')).toHaveTextContent('leftpolitics');
    expect(screen.queryByTestId('profile-card-background-faith_weight')).toBeNull();
    expect(screen.queryByTestId('profile-card-background-politics_weight')).toBeNull();
  });

  it('identityRowModels: field order, empties skipped, weights folded', () => {
    const models = identityRowModels('background', FULL.background as unknown as Record<string, unknown>);
    expect(models).toEqual([
      { field: 'languages', value: 'english · tagalog', secondary: 'languages' },
      { field: 'faith', value: 'catholic', secondary: 'faith · somewhat' },
      { field: 'politics', value: 'left', secondary: 'politics' },
    ]);
  });

  it('joinValue: single, list, empty', () => {
    expect(joinValue('socially')).toBe('socially');
    expect(joinValue(['a', 'b'])).toBe('a · b');
    expect(joinValue([])).toBeNull();
    expect(joinValue(null)).toBeNull();
    expect(joinValue(['  '])).toBeNull();
  });
});

describe('before you message me', () => {
  it('the card lists every request in boundary colours', async () => {
    const screen = await renderView(BASE);
    const card = screen.getByTestId('profile-card-before_you_message');
    expect(flat(card)).toMatchObject({ borderColor: colors.boundaryBg });
    const title = within(card).getByText('before you message me');
    expect(flat(title).color).toBe(colors.boundaryInk);
    expect(screen.getByTestId('profile-card-before_you_message-item-0')).toHaveTextContent('ask before you send anything');
    expect(screen.getByTestId('profile-card-before_you_message-item-2')).toHaveTextContent('nothing with my face');
  });

  it('docks a one-line strip in the action bar, above say-hi: the first request and +N', async () => {
    const screen = await renderView(BASE);
    const content = screen.getByTestId('profile-action-bar-content');
    const strip = within(content).getByTestId('profile-before-you-message-strip');
    expect(screen.getByTestId('profile-before-you-message-strip-text')).toHaveTextContent(
      'before you message me · ask before you send anything +2'
    );
    expect(screen.getByTestId('profile-before-you-message-strip-text').props.numberOfLines).toBe(1);
    // Strip first, then the say-hi actions.
    const children = content.children.filter((child) => typeof child !== 'string');
    expect(children[0]).toBe(strip);
    expect(within(content).getByTestId('actions')).toBeTruthy();
  });

  it('is in view at every scroll position (it lives in the sticky bar, not the scroll)', async () => {
    const screen = await renderView(BASE);
    await fireEvent.scroll(screen.getByTestId('profile-scroll'), {
      nativeEvent: { contentOffset: { x: 0, y: 3000 }, contentSize: { height: 4000, width: 390 }, layoutMeasurement: { height: 844, width: 390 } },
    });
    expect(screen.getByTestId('profile-before-you-message-strip')).toBeTruthy();
    expect(within(screen.getByTestId('profile-scroll')).queryByTestId('profile-before-you-message-strip')).toBeNull();
  });

  it('tapping the strip opens a small sheet with the full list; the backdrop closes it', async () => {
    const screen = await renderView(BASE);
    expect(screen.queryByTestId('profile-before-you-message-sheet')).toBeNull();
    await fireEvent.press(screen.getByTestId('profile-before-you-message-strip'));
    const sheet = screen.getByTestId('profile-before-you-message-sheet');
    expect(within(sheet).getByText('before you message me')).toBeTruthy();
    expect(screen.getByTestId('profile-before-you-message-sheet-list-item-0')).toHaveTextContent('ask before you send anything');
    expect(screen.getByTestId('profile-before-you-message-sheet-list-item-1')).toHaveTextContent("don't screenshot");
    expect(screen.getByTestId('profile-before-you-message-sheet-list-item-2')).toHaveTextContent('nothing with my face');
    await fireEvent.press(screen.getByTestId('profile-before-you-message-sheet-backdrop'));
    expect(screen.queryByTestId('profile-before-you-message-sheet')).toBeNull();
  });

  it('with one request there is no +N', async () => {
    const screen = await renderView({
      ...BASE,
      identityCards: { before_you_message: cardOf('before_you_message', { photos_content: ["don't screenshot"] }) },
    });
    expect(screen.getByTestId('profile-before-you-message-strip-text')).toHaveTextContent("before you message me · don't screenshot");
    expect(screen.getByTestId('profile-before-you-message-strip-text')).not.toHaveTextContent('+');
  });

  it('the bar does not grow when nothing is set', async () => {
    const screen = await renderView({ ...BASE, identityCards: { identity: FULL.identity } });
    expect(screen.queryByTestId('profile-before-you-message-strip')).toBeNull();
    expect(screen.queryByTestId('profile-card-before_you_message')).toBeNull();
    const content = screen.getByTestId('profile-action-bar-content');
    expect(content.children.filter((child) => typeof child !== 'string')).toHaveLength(1);
  });

  it('in preview the strip is in the greyed, untouchable bar and opens nothing', async () => {
    const screen = await renderView(BASE, { preview: true, testIDPrefix: 'profile-preview' });
    const bar = screen.getByTestId('profile-preview-action-bar', { includeHiddenElements: true });
    expect(bar.props.pointerEvents).toBe('none');
    expect(within(bar).getByTestId('profile-preview-before-you-message-strip', { includeHiddenElements: true })).toBeTruthy();
  });

  it('beforeYouMessageLine / items', () => {
    expect(beforeYouMessageLine([])).toBeNull();
    expect(beforeYouMessageLine(['a', 'b', 'c'])).toEqual({ lead: 'before you message me', rest: 'a +2' });
    expect(beforeYouMessageLine(['a', 'b', 'c'], true)).toEqual({ lead: 'before you message me', rest: 'a · b · c' });
    expect(beforeYouMessageItems({})).toEqual([]);
    expect(beforeYouMessageItems(FULL)).toHaveLength(3);
  });
});

describe('identity cards — audience notes (owner preview only)', () => {
  const audiences = { identity: 'everyone', background: 'after_hi', lifestyle: 'only_me', around: 'everyone' } as const;

  it('in preview, a card not shown to everyone carries its note', async () => {
    const screen = await renderView({ ...BASE, identityAudiences: audiences }, { preview: true, testIDPrefix: 'profile-preview' });
    expect(screen.queryByTestId('profile-preview-card-identity-note')).toBeNull();
    expect(screen.getByTestId('profile-preview-card-background-note')).toHaveTextContent('shown after a hi is answered');
    expect(screen.getByTestId('profile-preview-card-lifestyle-note')).toHaveTextContent('only you can see this');
    expect(screen.queryByTestId('profile-preview-card-around-note')).toBeNull();
    // Before you message me has no audience: always everyone, no note.
    expect(screen.queryByTestId('profile-preview-card-before_you_message-note')).toBeNull();
  });

  it('never on someone else’s profile, even if audiences were somehow present', async () => {
    const screen = await renderView({ ...BASE, identityAudiences: audiences });
    expect(screen.queryByTestId('profile-card-background-note')).toBeNull();
    expect(screen.queryByTestId('profile-card-lifestyle-note')).toBeNull();
  });

  it('identityCardModels maps audiences to notes, and none without audiences', () => {
    const withAudiences = identityCardModels(FULL, 'p', audiences);
    expect(withAudiences.map((m) => [m.card, m.note])).toEqual([
      ['identity', null],
      ['background', AUDIENCE_NOTES.after_hi],
      ['lifestyle', AUDIENCE_NOTES.only_me],
      ['around', null],
    ]);
    expect(identityCardModels(FULL, 'p').every((m) => m.note === null)).toBe(true);
  });
});
