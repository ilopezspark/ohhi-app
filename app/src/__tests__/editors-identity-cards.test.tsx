import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) },
  useNavigation: () => ({ dispatch: jest.fn() }),
}));
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }));
jest.mock('../api/client', () => ({ supabase: {} }));
jest.mock('../api/identity', () => ({ getMyIdentity: jest.fn(), getCard: jest.fn() }));
jest.mock('../api/session', () => ({ currentUserId: jest.fn(() => Promise.resolve('me-1')) }));
jest.mock('../api/identityWrite', () => ({ putIdentity: jest.fn(), getMyCard: jest.fn() }));
jest.mock('../me/editor/ProfileEditorDraftContext', () => ({ useProfileEditorDraftContext: jest.fn() }));
jest.mock('../me/editor/useMyPhotos', () => ({
  useMyPhotos: () => ({ photos: [], urls: {}, isLoading: false, isLoaded: true, refetch: jest.fn(), invalidate: jest.fn() }),
}));

import { router } from 'expo-router';
import { getCard, getMyIdentity } from '../api/identity';
import { getMyCard, putIdentity } from '../api/identityWrite';
import AroundEditorScreen from '../app/profile-editor/around';
import BackgroundEditorScreen from '../app/profile-editor/background';
import BeforeYouMessageEditorScreen from '../app/profile-editor/before-you-message';
import LifestyleEditorScreen from '../app/profile-editor/lifestyle';
import { AUDIENCE_LABELS, IDENTITY_CARD_LABELS, IDENTITY_FIELD_LABELS } from '../me/card/fieldLabels';
import { identityCardSummaries } from '../me/card/summary';
import { EditSections } from '../me/editor/EditSections';
import {
  buildCardPatch,
  cardDraftFrom,
  cardFillCount,
  fieldsWithNewTypedEntries,
  IDENTITY_CARD_ROUTES,
  rowFields,
  withFieldValue,
} from '../me/editor/identityCardDraft';
import { useProfileEditorDraftContext } from '../me/editor/ProfileEditorDraftContext';
import { PREVIEW_IDENTITY_KEY } from '../me/editor/useIdentityCardEditor';
import { EMPTY_ABOUT } from '../profile/about';
import {
  defaultAudiences,
  emptyIdentityCards,
  IDENTITY_FIELD_SPECS,
  type Audiences,
  type IdentityCards,
} from '../profile/fields';
import {
  COMMUNICATION_MAX_ITEMS,
  COMMUNICATION_OPTIONS,
  DRINKING_OPTIONS,
  FAITH_OPTIONS,
  FAITH_WEIGHT_OPTIONS,
  FOUR_TWENTY_OPTIONS,
  IDENTITY_CARD_ORDER,
  KIDS_OPTIONS,
  LANGUAGE_MAX_LENGTH,
  LANGUAGE_OPTIONS,
  PHOTOS_CONTENT_MAX_ITEMS,
  PHOTOS_CONTENT_OPTIONS,
  POLITICS_OPTIONS,
  POLITICS_WEIGHT_OPTIONS,
  SMOKING_OPTIONS,
  WHEN_FREE_OPTIONS,
} from '../settings/vocab';

function identity(cards: Partial<IdentityCards> = {}, audiences: Partial<Audiences> = {}) {
  return {
    user_id: 'me-1',
    cards: { ...emptyIdentityCards(), ...cards },
    audiences: { ...defaultAudiences(), ...audiences },
    is_public: null,
    pronouns: null,
    orientation: [],
  };
}

function withClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function checked(node: { props: { accessibilityState?: { checked?: boolean } } }) {
  return node.props.accessibilityState?.checked === true;
}

async function patchSent(): Promise<Record<string, unknown>> {
  await waitFor(() => expect(putIdentity).toHaveBeenCalledTimes(1));
  return (putIdentity as jest.Mock).mock.calls[0][0];
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  (getMyIdentity as jest.Mock).mockResolvedValue(identity());
  (getMyCard as jest.Mock).mockResolvedValue(null);
  (getCard as jest.Mock).mockResolvedValue(null);
  (putIdentity as jest.Mock).mockResolvedValue({ user_id: 'me-1', key_version: 1, fields_filled: 1, updated_at: 'now' });
});

// -----------------------------------------------------------------------------
// Pure logic
// -----------------------------------------------------------------------------

describe('identityCardDraft', () => {
  const stored = identity(
    {
      background: { languages: ['english'], faith: FAITH_OPTIONS[0], faith_weight: FAITH_WEIGHT_OPTIONS[0], politics: null, politics_weight: null },
      lifestyle: { drinking: DRINKING_OPTIONS[0], smoking: null, four_twenty: null, kids: null },
    },
    { background: 'after_hi' }
  );

  it('rows are the card fields minus the weights, in the brief order', () => {
    expect(rowFields('identity')).toEqual(['pronouns', 'orientation', 'interested_in', 'relationship']);
    expect(rowFields('background')).toEqual(['languages', 'faith', 'politics']);
    expect(rowFields('lifestyle')).toEqual(['drinking', 'smoking', 'four_twenty', 'kids']);
    expect(rowFields('around')).toEqual(['when_free', 'communication']);
    expect(rowFields('before_you_message')).toEqual(['photos_content']);
  });

  it('reads a card and its audience; before you message me has none', () => {
    expect(cardDraftFrom(stored, 'background')).toEqual({
      values: { languages: ['english'], faith: FAITH_OPTIONS[0], faith_weight: FAITH_WEIGHT_OPTIONS[0], politics: null, politics_weight: null },
      audience: 'after_hi',
    });
    expect(cardDraftFrom(stored, 'before_you_message').audience).toBeNull();
  });

  it('clearing a parent clears its weight', () => {
    const values = cardDraftFrom(stored, 'background').values;
    expect(withFieldValue(values, 'faith', null)).toMatchObject({ faith: null, faith_weight: null });
    expect(withFieldValue(values, 'faith', FAITH_OPTIONS[1])).toMatchObject({ faith_weight: FAITH_WEIGHT_OPTIONS[0] });
  });

  it('the patch holds only the changed keys of that card, plus its audience when changed', () => {
    const initial = cardDraftFrom(stored, 'lifestyle');
    expect(buildCardPatch('lifestyle', initial, initial)).toBeNull();
    const edited = { values: withFieldValue(initial.values, 'kids', KIDS_OPTIONS[1]), audience: 'only_me' as const };
    expect(buildCardPatch('lifestyle', initial, edited)).toEqual({ kids: KIDS_OPTIONS[1], audiences: { lifestyle: 'only_me' } });
  });

  it('counts filled rows (a weight is part of its parent) and finds new typed entries', () => {
    const initial = cardDraftFrom(stored, 'background');
    expect(cardFillCount('background', initial.values)).toEqual({ filled: 2, total: 3 });
    const edited = { ...initial, values: withFieldValue(initial.values, 'languages', ['english', 'klingon', 'french']) };
    expect(fieldsWithNewTypedEntries('background', initial, edited)).toEqual(['languages']);
    const listedOnly = { ...initial, values: withFieldValue(initial.values, 'languages', ['english', 'french']) };
    expect(fieldsWithNewTypedEntries('background', initial, listedOnly)).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// The four other card editors
// -----------------------------------------------------------------------------

describe('/profile-editor/background', () => {
  const ID = 'editor-card-background';

  it('renders languages, faith and politics from the specs; each weight only once its parent has a value', async () => {
    const screen = await withClient(<BackgroundEditorScreen />);
    await screen.findByTestId(`${ID}-audience`);
    for (const option of LANGUAGE_OPTIONS) expect(screen.getByTestId(`${ID}-languages-${option}`)).toBeTruthy();
    for (const option of FAITH_OPTIONS) expect(screen.getByTestId(`${ID}-faith-${option}`)).toBeTruthy();
    for (const option of POLITICS_OPTIONS) expect(screen.getByTestId(`${ID}-politics-${option}`)).toBeTruthy();
    expect(screen.getByTestId(`${ID}-languages-typed-input`)).toBeTruthy();

    expect(screen.queryByTestId(`${ID}-faith_weight`)).toBeNull();
    expect(screen.queryByTestId(`${ID}-politics_weight`)).toBeNull();
    await fireEvent.press(screen.getByTestId(`${ID}-faith-${FAITH_OPTIONS[0]}`));
    expect(screen.getByTestId(`${ID}-faith_weight-section`)).toHaveTextContent(new RegExp(IDENTITY_FIELD_LABELS.faith_weight));
    for (const option of FAITH_WEIGHT_OPTIONS) expect(screen.getByTestId(`${ID}-faith_weight-${option}`)).toBeTruthy();
    expect(screen.queryByTestId(`${ID}-politics_weight`)).toBeNull();

    await fireEvent.press(screen.getByTestId(`${ID}-politics-${POLITICS_OPTIONS[1]}`));
    for (const option of POLITICS_WEIGHT_OPTIONS) expect(screen.getByTestId(`${ID}-politics_weight-${option}`)).toBeTruthy();

    // deselecting the parent hides its weight again
    await fireEvent.press(screen.getByTestId(`${ID}-faith-${FAITH_OPTIONS[0]}`));
    expect(screen.queryByTestId(`${ID}-faith_weight`)).toBeNull();
  });

  it('clearing a stored parent sends its weight cleared too, and nothing from any other card', async () => {
    (getMyIdentity as jest.Mock).mockResolvedValue(
      identity({
        background: { languages: [], faith: FAITH_OPTIONS[3], faith_weight: FAITH_WEIGHT_OPTIONS[1], politics: null, politics_weight: null },
        identity: { pronouns: ['she/her'], orientation: [], interested_in: [], relationship: null },
      })
    );
    const screen = await withClient(<BackgroundEditorScreen />);
    expect(checked(await screen.findByTestId(`${ID}-faith_weight-${FAITH_WEIGHT_OPTIONS[1]}`))).toBe(true);
    await fireEvent.press(screen.getByTestId(`${ID}-faith-${FAITH_OPTIONS[3]}`));
    await fireEvent.press(screen.getByTestId(`${ID}-save`));
    expect(await patchSent()).toEqual({ faith: null, faith_weight: null });
    await waitFor(() => expect(router.back).toHaveBeenCalled());
  });

  it(`a typed language is capped at ${LANGUAGE_MAX_LENGTH} characters and joins the list`, async () => {
    const screen = await withClient(<BackgroundEditorScreen />);
    const input = await screen.findByTestId(`${ID}-languages-typed-input`);
    await fireEvent.changeText(input, 'y'.repeat(LANGUAGE_MAX_LENGTH + 1));
    expect(screen.getByText(`keep it to ${LANGUAGE_MAX_LENGTH} characters.`)).toBeTruthy();
    await fireEvent.changeText(input, 'klingon');
    await fireEvent.press(screen.getByTestId(`${ID}-languages-typed-add`));
    expect(checked(screen.getByTestId(`${ID}-languages-klingon`))).toBe(true);
    await fireEvent.press(screen.getByTestId(`${ID}-save`));
    expect(await patchSent()).toEqual({ languages: ['klingon'] });
  });
});

describe('/profile-editor/lifestyle', () => {
  const ID = 'editor-card-lifestyle';

  it('renders four single-select fields from the specs, no write your own', async () => {
    const screen = await withClient(<LifestyleEditorScreen />);
    await screen.findByTestId(`${ID}-audience`);
    const lists = { drinking: DRINKING_OPTIONS, smoking: SMOKING_OPTIONS, four_twenty: FOUR_TWENTY_OPTIONS, kids: KIDS_OPTIONS };
    for (const [field, options] of Object.entries(lists)) {
      expect(IDENTITY_FIELD_SPECS[field as keyof typeof lists].multiple).toBe(false);
      for (const option of options) expect(screen.getByTestId(`${ID}-${field}-${option}`)).toBeTruthy();
      expect(screen.queryByTestId(`${ID}-${field}-typed-input`)).toBeNull();
    }
    await fireEvent.press(screen.getByTestId(`${ID}-kids-${KIDS_OPTIONS[0]}`));
    await fireEvent.press(screen.getByTestId(`${ID}-kids-${KIDS_OPTIONS[1]}`));
    expect(checked(screen.getByTestId(`${ID}-kids-${KIDS_OPTIONS[0]}`))).toBe(false);
    expect(checked(screen.getByTestId(`${ID}-kids-${KIDS_OPTIONS[1]}`))).toBe(true);
  });

  it('the audience row saves the audience with the one changed field', async () => {
    const screen = await withClient(<LifestyleEditorScreen />);
    await fireEvent.press(await screen.findByTestId(`${ID}-audience-choice-after_hi`));
    expect(screen.getByTestId(`${ID}-audience-hint`)).toHaveTextContent(/after a hi has been answered/);
    await fireEvent.press(screen.getByTestId(`${ID}-drinking-${DRINKING_OPTIONS[2]}`));
    await fireEvent.press(screen.getByTestId(`${ID}-save`));
    expect(await patchSent()).toEqual({ drinking: DRINKING_OPTIONS[2], audiences: { lifestyle: 'after_hi' } });
  });

  it('tapping the picked audience again keeps it (there is always one)', async () => {
    const screen = await withClient(<LifestyleEditorScreen />);
    await fireEvent.press(await screen.findByTestId(`${ID}-audience-choice-everyone`));
    expect(checked(screen.getByTestId(`${ID}-audience-choice-everyone`))).toBe(true);
    expect(screen.getByTestId(`${ID}-save`).props.accessibilityState?.disabled).toBe(true);
  });
});

describe('/profile-editor/around', () => {
  const ID = 'editor-card-around';

  it(`when i'm free is multi and uncapped; communication is multi, capped at ${COMMUNICATION_MAX_ITEMS}`, async () => {
    const screen = await withClient(<AroundEditorScreen />);
    await screen.findByTestId(`${ID}-audience`);
    for (const option of WHEN_FREE_OPTIONS) await fireEvent.press(screen.getByTestId(`${ID}-when_free-${option}`));
    for (const option of WHEN_FREE_OPTIONS) expect(checked(screen.getByTestId(`${ID}-when_free-${option}`))).toBe(true);

    for (const option of COMMUNICATION_OPTIONS.slice(0, COMMUNICATION_MAX_ITEMS + 1)) {
      await fireEvent.press(screen.getByTestId(`${ID}-communication-${option}`));
    }
    expect(checked(screen.getByTestId(`${ID}-communication-${COMMUNICATION_OPTIONS[COMMUNICATION_MAX_ITEMS]}`))).toBe(false);
    expect(screen.getByTestId(`${ID}-communication-label-note`)).toHaveTextContent(`${COMMUNICATION_MAX_ITEMS} of ${COMMUNICATION_MAX_ITEMS}`);

    await fireEvent.press(screen.getByTestId(`${ID}-save`));
    expect(Object.keys(await patchSent()).sort()).toEqual(['communication', 'when_free']);
  });
});

describe('/profile-editor/before-you-message', () => {
  const ID = 'editor-card-before-you-message';

  it('shows photos & content as requests the app cannot guarantee, with no audience row', async () => {
    const screen = await withClient(<BeforeYouMessageEditorScreen />);
    await screen.findByTestId(`${ID}-photos_content`);
    expect(screen.queryByTestId(`${ID}-audience`)).toBeNull();
    expect(screen.getByTestId(`${ID}-note-0`)).toHaveTextContent(/requests, not guarantees/);
    expect(screen.getByTestId(`${ID}-note-0`)).toHaveTextContent(/can't stop a screenshot/);
    expect(screen.getByTestId(`${ID}-note-1`)).toHaveTextContent(/everyone who opens your profile/);
    for (const option of PHOTOS_CONTENT_OPTIONS) expect(screen.getByTestId(`${ID}-photos_content-${option}`)).toBeTruthy();
    expect(screen.getByTestId(`${ID}-photos_content-label-note`)).toHaveTextContent(`0 of ${PHOTOS_CONTENT_MAX_ITEMS}`);
  });

  it('saves the picks without any audience, then refreshes the owner reads and the preview', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    const screen = await render(
      <QueryClientProvider client={client}>
        <BeforeYouMessageEditorScreen />
      </QueryClientProvider>
    );
    await fireEvent.press(await screen.findByTestId(`${ID}-photos_content-${PHOTOS_CONTENT_OPTIONS[1]}`));
    await fireEvent.press(screen.getByTestId(`${ID}-save`));
    expect(await patchSent()).toEqual({ photos_content: [PHOTOS_CONTENT_OPTIONS[1]] });
    await waitFor(() => expect(router.back).toHaveBeenCalled());
    const keys = invalidate.mock.calls.map((call) => call[0]?.queryKey);
    expect(keys).toEqual(expect.arrayContaining([['me', 'about'], ['identity'], PREVIEW_IDENTITY_KEY]));
  });
});

// -----------------------------------------------------------------------------
// The section list
// -----------------------------------------------------------------------------

describe('identityCardSummaries', () => {
  it('one row per card in the brief order, with counts and the audience word', () => {
    const rows = identityCardSummaries(
      identity(
        {
          identity: { pronouns: ['she/her'], orientation: ['bi'], interested_in: [], relationship: null },
          background: { languages: [], faith: FAITH_OPTIONS[0], faith_weight: FAITH_WEIGHT_OPTIONS[0], politics: null, politics_weight: null },
          before_you_message: { photos_content: [PHOTOS_CONTENT_OPTIONS[0], PHOTOS_CONTENT_OPTIONS[1]] },
        },
        { identity: 'only_me', lifestyle: 'after_hi' }
      )
    );
    expect(rows.map((row) => row.card)).toEqual([...IDENTITY_CARD_ORDER]);
    expect(rows.map((row) => row.subtitle)).toEqual([
      `2 of 4 filled in · ${AUDIENCE_LABELS.only_me}`,
      `1 of 3 filled in · ${AUDIENCE_LABELS.everyone}`,
      `0 of 4 filled in · ${AUDIENCE_LABELS.after_hi}`,
      `0 of 2 filled in · ${AUDIENCE_LABELS.everyone}`,
      `2 picked · ${AUDIENCE_LABELS.everyone}`,
    ]);
    expect(identityCardSummaries(identity())[4].subtitle).toBe('nothing picked yet');
  });
});

describe('EditSections: the five public cards under about you', () => {
  function mockDraft() {
    (useProfileEditorDraftContext as jest.Mock).mockReturnValue({
      loading: false,
      ready: true,
      userId: 'u1',
      firstName: 'izaac',
      catalog: [],
      fieldErrors: {},
      minTags: 0,
      photoCount: 1,
      draft: { statusLine: '', goals: [], tagIds: [], placeLine: '', usualPlaces: [], prompts: [], about: EMPTY_ABOUT },
      setGoals: jest.fn(),
      completion: { percent: 50, items: [], nextBest: null },
    });
  }

  it('lists school and work, then the five cards in order, with counts, and opens each editor', async () => {
    mockDraft();
    (getMyIdentity as jest.Mock).mockResolvedValue(
      identity({ lifestyle: { drinking: DRINKING_OPTIONS[0], smoking: SMOKING_OPTIONS[0], four_twenty: null, kids: null } }, { lifestyle: 'after_hi' })
    );
    const screen = await withClient(<EditSections />);
    await waitFor(() => expect(screen.getByTestId('editor-card-lifestyle-row')).toHaveTextContent(/2 of 4 filled in/));
    expect(screen.getByTestId('editor-card-lifestyle-row')).toHaveTextContent(new RegExp(AUDIENCE_LABELS.after_hi));
    expect(screen.getByTestId('editor-card-identity-row')).toHaveTextContent(/0 of 4 filled in/);
    // the private card row counts the nine v2 sections
    await waitFor(() => expect(screen.getByTestId('editor-private-card-row')).toHaveTextContent(/0 of 9 filled in/));

    const json = JSON.stringify(screen.toJSON());
    const positions = ['editor-school-work-row', ...IDENTITY_CARD_ORDER.map((card) => `editor-card-${card}-row`)].map((id) =>
      json.indexOf(`"${id}"`)
    );
    expect(positions.every((pos) => pos >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);

    for (const card of IDENTITY_CARD_ORDER) {
      expect(screen.getByTestId(`editor-card-${card}-row`)).toHaveTextContent(new RegExp(`^${IDENTITY_CARD_LABELS[card]}`));
      await fireEvent.press(screen.getByTestId(`editor-card-${card}-row`));
    }
    expect((router.push as jest.Mock).mock.calls.map((c) => c[0])).toEqual(IDENTITY_CARD_ORDER.map((card) => IDENTITY_CARD_ROUTES[card]));
    // no completion weight and no nag on any of it (C8)
    expect(screen.queryByTestId('editor-section-about-weight')).toBeNull();
    expect(screen.queryByTestId('editor-section-about-dot')).toBeNull();
  });
});
