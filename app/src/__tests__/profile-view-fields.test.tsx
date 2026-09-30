import { Text as RNText } from 'react-native';
import { render, within } from '@testing-library/react-native';
import { ProfileView } from '../profile/view/ProfileView';
import { placePrompts } from '../profile/view/sections';
import type { ProfileViewData } from '../profile/view/model';

/**
 * Profile redesign phase 2 (migration 0015): the place line, prompt cards
 * between the photos, `around campus`, the join month and the recency
 * notice. `profile-view.test.tsx` covers the phase 1 layout.
 */

const MAYA: ProfileViewData = {
  userId: 'u-maya',
  firstName: 'maya',
  gradYear: 2027,
  statusLine: 'at the library till 10 if anyone wants to pretend to study',
  tier: 'on_campus',
  hereNow: true,
  isOnline: true,
  verified: true,
  goals: ['friends', 'study'],
  majorLabel: 'nursing',
  tagLabels: ['gym', 'coffee'],
  sharedLines: ["you're both into gym"],
  pronouns: 'she/her',
  orientation: [],
  campusShort: 'CLC',
  photoPaths: ['p0', 'p1', 'p2'],
  photoUrls: {},
  placeLine: null,
  prompts: [],
  usualPlaces: null,
  gateOpen: false,
  joinedMonth: null,
  joinedRecency: null,
  about: null,
};

const LUIS: ProfileViewData = {
  ...MAYA,
  userId: 'u-luis',
  firstName: 'luis',
  statusLine: null,
  tier: 'nearby',
  hereNow: false,
  goals: [],
  majorLabel: 'business',
  tagLabels: [],
  sharedLines: [],
  pronouns: null,
  photoPaths: ['p0'],
};

const PROMPTS = [
  { promptId: 'ruining_my_life', question: "the class that's ruining my life right now", answer: 'anatomy. every bone in my hand' },
  { promptId: 'find_me_on_campus', question: "you'll find me on campus at", answer: 'the second floor, third table' },
  { promptId: 'cafe_order', question: 'my order at the campus cafe', answer: 'oat latte' },
];

function renderView(data: ProfileViewData, props: Partial<Parameters<typeof ProfileView>[0]> = {}) {
  return render(
    <ProfileView
      data={data}
      onBack={jest.fn()}
      onOverflow={jest.fn()}
      renderActions={() => <RNText testID="actions">actions</RNText>}
      {...props}
    />
  );
}

function detailIds(screen: Awaited<ReturnType<typeof renderView>>): (string | null)[] {
  return screen.getByTestId('profile-details').children.map((child) => {
    const node = typeof child === 'string' ? null : child.children[0];
    return node && typeof node !== 'string' ? node.props.testID : null;
  });
}

const thisYear = new Date().getFullYear();

describe('ProfileView — the place line (ruling 4)', () => {
  it('replaces the tier word: {place} · {major} {yy}', async () => {
    const screen = await renderView({ ...MAYA, placeLine: 'library, 2nd floor' });
    expect(screen.getByTestId('profile-meta')).toHaveTextContent("library, 2nd floor · nursing '27");
    expect(screen.getByTestId('profile-place-line')).toHaveTextContent('library, 2nd floor');
    expect(screen.queryByTestId('profile-tier-pill')).toBeNull();
  });

  it('keeps the tier word for a screen reader', async () => {
    const screen = await renderView({ ...MAYA, placeLine: 'library, 2nd floor' });
    expect(screen.getByLabelText("library, 2nd floor, on campus, nursing '27")).toBeTruthy();
  });

  it('falls back to the tier word without a place line', async () => {
    const screen = await renderView({ ...MAYA, tier: 'nearby', placeLine: null });
    expect(screen.getByTestId('profile-meta')).toHaveTextContent("nearby · nursing '27");
    expect(screen.queryByTestId('profile-place-line')).toBeNull();
  });

  it('never shows a place when there is no tier word (away)', async () => {
    const screen = await renderView({ ...MAYA, tier: 'away', placeLine: 'library, 2nd floor' });
    expect(screen.queryByTestId('profile-place-line')).toBeNull();
    expect(screen.getByTestId('profile-meta')).toHaveTextContent("nursing '27");
    expect(screen.getByTestId('profile-meta')).not.toHaveTextContent(/library/);
  });
});

describe('placePrompts', () => {
  it('pairs each answer with the photo above it first (the artboard)', () => {
    expect(placePrompts([true, false, true], 1)).toEqual([[], [0], [], []]);
    expect(placePrompts([true, false, true], 2)).toEqual([[], [0], [], [1]]);
  });

  it('then uses the gap after into, so three answers never touch', () => {
    expect(placePrompts([true, false, true], 3)).toEqual([[], [0], [1], [2]]);
  });

  it('with fewer separators, uses the gap before the first card, then the end', () => {
    expect(placePrompts([false], 3)).toEqual([[0], [1, 2]]);
    expect(placePrompts([], 2)).toEqual([[0, 1]]);
    expect(placePrompts([true, true], 3)).toEqual([[0], [1], [2]]);
  });

  it('places nothing for no answers', () => {
    expect(placePrompts([true, false, true], 0)).toEqual([[], [], [], []]);
  });
});

describe('ProfileView — prompts between the photos (04)', () => {
  it('with two answers and three photos: photo 2, prompt, into, photo 3, prompt (the artboard)', async () => {
    const screen = await renderView({ ...MAYA, prompts: PROMPTS.slice(0, 2) });
    expect(detailIds(screen)).toEqual([
      'profile-shared',
      'profile-basics',
      'profile-photo-card-1',
      'profile-prompt-0',
      'profile-into',
      'profile-photo-card-2',
      'profile-prompt-1',
      'profile-footer',
    ]);
  });

  it('with three answers no two prompts touch', async () => {
    const screen = await renderView({ ...MAYA, prompts: PROMPTS });
    expect(detailIds(screen)).toEqual([
      'profile-shared',
      'profile-basics',
      'profile-photo-card-1',
      'profile-prompt-0',
      'profile-into',
      'profile-prompt-1',
      'profile-photo-card-2',
      'profile-prompt-2',
      'profile-footer',
    ]);
  });

  it('with one photo, prompts sit either side of into, in order', async () => {
    const screen = await renderView({ ...MAYA, photoPaths: ['p0'], prompts: PROMPTS });
    expect(detailIds(screen)).toEqual([
      'profile-shared',
      'profile-basics',
      'profile-prompt-0',
      'profile-into',
      'profile-prompt-1',
      'profile-prompt-2',
      'profile-footer',
    ]);
  });

  it('draws the question small and the answer large, with no gated note for a viewer', async () => {
    const screen = await renderView({ ...MAYA, prompts: [{ ...PROMPTS[1], gated: true }] });
    expect(screen.getByTestId('profile-prompt-0-question')).toHaveTextContent("you'll find me on campus at");
    expect(screen.getByTestId('profile-prompt-0-answer')).toHaveTextContent('the second floor, third table');
    expect(screen.queryByTestId('profile-prompt-0-note')).toBeNull();
  });

  it('in preview, a gated prompt carries the note', async () => {
    const screen = await renderView({ ...MAYA, prompts: [{ ...PROMPTS[1], gated: true }, PROMPTS[0]] }, { preview: true });
    expect(screen.getByTestId('profile-prompt-0-note')).toHaveTextContent('only shown after a hi has been answered.');
    expect(screen.queryByTestId('profile-prompt-1-note')).toBeNull();
  });

  it('a prompt counts as filled in: no sparse notice', async () => {
    const screen = await renderView({ ...LUIS, prompts: [PROMPTS[0]] });
    expect(screen.queryByTestId('profile-sparse-notice')).toBeNull();
  });
});

describe('ProfileView — around campus (ruling 5)', () => {
  it('renders the places with a sub-line that names them, never a pronoun, after the prompts', async () => {
    const screen = await renderView({ ...MAYA, prompts: PROMPTS.slice(0, 2), usualPlaces: ['library 2nd floor', 'the gym', 'lot 3'] });
    const card = screen.getByTestId('profile-around-campus');
    expect(within(card).getByTestId('profile-around-campus-places')).toHaveTextContent('library 2nd floor, the gym, lot 3');
    expect(card).toHaveTextContent(/where maya usually ends up/);
    expect(card).not.toHaveTextContent(/\b(she|her|he|his|they|their)\b/);
    expect(card).not.toHaveTextContent(/class/);
    const ids = detailIds(screen);
    expect(ids.indexOf('profile-around-campus')).toBe(ids.indexOf('profile-footer') - 1);
    expect(ids.indexOf('profile-around-campus')).toBeGreaterThan(ids.indexOf('profile-prompt-1'));
  });

  it('null draws nothing at all, whether or not the gate is open (no hint either way)', async () => {
    for (const gateOpen of [false, true]) {
      const screen = await renderView({ ...MAYA, usualPlaces: null, gateOpen });
      expect(screen.queryByTestId('profile-around-campus')).toBeNull();
      expect(screen.queryByText(/around campus/)).toBeNull();
      expect(screen.queryByText(/after a hi/)).toBeNull();
    }
  });

  it('shows the gated note only in preview', async () => {
    const viewer = await renderView({ ...MAYA, usualPlaces: ['library'] });
    expect(viewer.queryByTestId('profile-around-campus-note')).toBeNull();
    const owner = await renderView({ ...MAYA, usualPlaces: ['library'] }, { preview: true });
    expect(owner.getByTestId('profile-around-campus-note')).toHaveTextContent('only shown after a hi has been answered.');
  });
});

describe('ProfileView — join date (ruling 3)', () => {
  it('footer: verified student at the campus · on ohhi since the month', async () => {
    const screen = await renderView({ ...MAYA, joinedMonth: `${thisYear}-01-01` });
    expect(screen.getByTestId('profile-footer-verified')).toHaveTextContent('verified student at CLC · on ohhi since january');
  });

  it('adds the year for an earlier year', async () => {
    const screen = await renderView({ ...MAYA, joinedMonth: `${thisYear - 1}-11-01` });
    expect(screen.getByTestId('profile-footer-verified')).toHaveTextContent(
      `verified student at CLC · on ohhi since november ${thisYear - 1}`
    );
  });

  it('the sparse notice says when they joined, and never claims a semester', async () => {
    const screen = await renderView({ ...LUIS, joinedRecency: 'yesterday' });
    expect(screen.getByTestId('profile-sparse-notice')).toHaveTextContent(
      "luis joined yesterday and hasn't filled much in. not a red flag."
    );
    expect(screen.getByTestId('profile-sparse-notice')).not.toHaveTextContent(/semester|first/);
  });

  it('falls back to the phase 1 notice with no recency', async () => {
    const screen = await renderView(LUIS);
    expect(screen.getByTestId('profile-sparse-notice')).toHaveTextContent("luis hasn't filled much in yet. not a red flag.");
  });
});

describe('ProfileView — photo cards', () => {
  it('are portrait (4:5)', async () => {
    const screen = await renderView(MAYA);
    const card = screen.getByTestId('profile-photo-card-1');
    const flat = Object.assign({}, ...[card.props.style].flat(Infinity).filter(Boolean));
    expect(flat.aspectRatio).toBeCloseTo(4 / 5);
  });
});

describe('ProfileView — preview', () => {
  it('has no back or report/block when none is given', async () => {
    const screen = await renderView(MAYA, { preview: true, onBack: undefined, onOverflow: undefined });
    expect(screen.queryByTestId('profile-back')).toBeNull();
    expect(screen.queryByTestId('profile-overflow-trigger')).toBeNull();
    expect(screen.queryByTestId('profile-report-block')).toBeNull();
  });
});
