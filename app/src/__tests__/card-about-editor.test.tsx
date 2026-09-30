import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) },
  useNavigation: () => ({ dispatch: jest.fn() }),
}));
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }));
jest.mock('../api/client', () => ({ supabase: {} }));
jest.mock('../api/identity', () => ({ getMyIdentity: jest.fn() }));
jest.mock('../api/identityWrite', () => ({ putIdentity: jest.fn(), getMyCard: jest.fn() }));

import { router } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { getMyIdentity } from '../api/identity';
import { putIdentity } from '../api/identityWrite';
import { InvalidInputError, WORD_FILTER_LINE } from '../api/errors';
import IdentityCardEditorScreen from '../app/profile-editor/about';
import { AUDIENCE_LABELS, IDENTITY_FIELD_LABELS } from '../me/card/fieldLabels';
import { defaultAudiences, emptyIdentityCards, type Audiences, type IdentityCards } from '../profile/fields';
import {
  INTERESTED_IN_OPTIONS,
  ORIENTATION_CHIPS,
  ORIENTATION_MAX_ITEMS,
  PRONOUN_MAX_ITEMS,
  PRONOUN_MAX_LENGTH,
  PRONOUN_OPTIONS,
  RELATIONSHIP_OPTIONS,
} from '../settings/vocab';

const ID = 'editor-card-identity';

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

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <IdentityCardEditorScreen />
    </QueryClientProvider>
  );
}

function checked(node: { props: { accessibilityState?: { checked?: boolean } } }) {
  return node.props.accessibilityState?.checked === true;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  (getMyIdentity as jest.Mock).mockResolvedValue(identity());
  (putIdentity as jest.Mock).mockResolvedValue({ user_id: 'me-1', key_version: 1, fields_filled: 1, updated_at: 'now' });
});

describe('/profile-editor/about: the identity card editor', () => {
  it('renders the four identity fields from the specs, with the owner labels', async () => {
    const screen = await renderScreen();
    await screen.findByTestId(`${ID}-audience`);
    for (const field of ['pronouns', 'orientation', 'interested_in', 'relationship'] as const) {
      expect(screen.getByTestId(`${ID}-${field}-label`)).toHaveTextContent(new RegExp(`^${IDENTITY_FIELD_LABELS[field]}`));
    }
    for (const option of PRONOUN_OPTIONS) expect(screen.getByTestId(`${ID}-pronouns-${option}`)).toBeTruthy();
    for (const option of ORIENTATION_CHIPS) expect(screen.getByTestId(`${ID}-orientation-${option}`)).toBeTruthy();
    for (const option of INTERESTED_IN_OPTIONS) expect(screen.getByTestId(`${ID}-interested_in-${option}`)).toBeTruthy();
    // ruling 3: the owner's options as written, "single" included
    for (const option of RELATIONSHIP_OPTIONS) expect(screen.getByTestId(`${ID}-relationship-${option}`)).toBeTruthy();
    // the old switch is gone; the audience row replaces it
    expect(screen.queryByTestId('about-editor-is-public')).toBeNull();
    // write your own only where the spec allows it
    expect(screen.getByTestId(`${ID}-pronouns-typed-input`)).toBeTruthy();
    expect(screen.getByTestId(`${ID}-orientation-typed-input`)).toBeTruthy();
    expect(screen.queryByTestId(`${ID}-interested_in-typed-input`)).toBeNull();
    expect(screen.queryByTestId(`${ID}-relationship-typed-input`)).toBeNull();
  });

  it('loads what is stored, typed entries included, and the audience', async () => {
    (getMyIdentity as jest.Mock).mockResolvedValue(
      identity(
        { identity: { pronouns: ['she/her', 'ey/em'], orientation: ['bi'], interested_in: [], relationship: RELATIONSHIP_OPTIONS[1] } },
        { identity: 'after_hi' }
      )
    );
    const screen = await renderScreen();
    expect(checked(await screen.findByTestId(`${ID}-pronouns-she/her`))).toBe(true);
    expect(checked(screen.getByTestId(`${ID}-pronouns-ey/em`))).toBe(true);
    expect(checked(screen.getByTestId(`${ID}-orientation-bi`))).toBe(true);
    expect(checked(screen.getByTestId(`${ID}-relationship-${RELATIONSHIP_OPTIONS[1]}`))).toBe(true);
    expect(checked(screen.getByTestId(`${ID}-audience-choice-after_hi`))).toBe(true);
    expect(screen.getByTestId(`${ID}-pronouns-label-note`)).toHaveTextContent(`2 of ${PRONOUN_MAX_ITEMS}`);
  });

  it('relationship is single: a second pick replaces the first, and tapping it again clears it', async () => {
    const screen = await renderScreen();
    await fireEvent.press(await screen.findByTestId(`${ID}-relationship-${RELATIONSHIP_OPTIONS[1]}`));
    await fireEvent.press(screen.getByTestId(`${ID}-relationship-${RELATIONSHIP_OPTIONS[2]}`));
    expect(checked(screen.getByTestId(`${ID}-relationship-${RELATIONSHIP_OPTIONS[1]}`))).toBe(false);
    expect(checked(screen.getByTestId(`${ID}-relationship-${RELATIONSHIP_OPTIONS[2]}`))).toBe(true);
    await fireEvent.press(screen.getByTestId(`${ID}-relationship-${RELATIONSHIP_OPTIONS[2]}`));
    expect(checked(screen.getByTestId(`${ID}-relationship-${RELATIONSHIP_OPTIONS[2]}`))).toBe(false);
  });

  it(`orientation is multi, capped at ${ORIENTATION_MAX_ITEMS}: a fourth tap is a no-op`, async () => {
    const screen = await renderScreen();
    await screen.findByTestId(`${ID}-orientation`);
    for (const option of ORIENTATION_CHIPS.slice(0, ORIENTATION_MAX_ITEMS + 1)) {
      await fireEvent.press(screen.getByTestId(`${ID}-orientation-${option}`));
    }
    for (const option of ORIENTATION_CHIPS.slice(0, ORIENTATION_MAX_ITEMS)) {
      expect(checked(screen.getByTestId(`${ID}-orientation-${option}`))).toBe(true);
    }
    expect(checked(screen.getByTestId(`${ID}-orientation-${ORIENTATION_CHIPS[ORIENTATION_MAX_ITEMS]}`))).toBe(false);
  });

  it(`a typed pronoun is capped at ${PRONOUN_MAX_LENGTH} characters, with inline copy`, async () => {
    const screen = await renderScreen();
    const input = await screen.findByTestId(`${ID}-pronouns-typed-input`);
    await fireEvent.changeText(input, 'x'.repeat(PRONOUN_MAX_LENGTH + 1));
    expect(screen.getByText(`keep it to ${PRONOUN_MAX_LENGTH} characters.`)).toBeTruthy();
    await fireEvent.press(screen.getByTestId(`${ID}-pronouns-typed-add`));
    expect(screen.queryByTestId(`${ID}-pronouns-${'x'.repeat(PRONOUN_MAX_LENGTH + 1)}`)).toBeNull();
  });

  it('adds a typed pronoun as a picked chip, normalised, and allows only one of your own', async () => {
    const screen = await renderScreen();
    const input = await screen.findByTestId(`${ID}-pronouns-typed-input`);
    await fireEvent.changeText(input, '  ey/em  ');
    await fireEvent.press(screen.getByTestId(`${ID}-pronouns-typed-add`));
    expect(checked(screen.getByTestId(`${ID}-pronouns-ey/em`))).toBe(true);

    // a listed option typed by hand joins in the list's own spelling and is not "your own"
    await fireEvent.changeText(screen.getByTestId(`${ID}-pronouns-typed-input`), 'She/Her');
    await fireEvent.press(screen.getByTestId(`${ID}-pronouns-typed-add`));
    expect(checked(screen.getByTestId(`${ID}-pronouns-she/her`))).toBe(true);

    await fireEvent.changeText(screen.getByTestId(`${ID}-pronouns-typed-input`), 'ze/zir');
    await fireEvent.press(screen.getByTestId(`${ID}-pronouns-typed-add`));
    expect(screen.getByText(/one of your own at most/)).toBeTruthy();
    expect(screen.queryByTestId(`${ID}-pronouns-ze/zir`)).toBeNull();
  });

  it('saves a partial patch of the identity card only, and goes back', async () => {
    (getMyIdentity as jest.Mock).mockResolvedValue(
      identity({ lifestyle: { drinking: 'socially', smoking: null, four_twenty: null, kids: null } })
    );
    const screen = await renderScreen();
    await fireEvent.press(await screen.findByTestId(`${ID}-pronouns-${PRONOUN_OPTIONS[0]}`));
    await fireEvent.press(screen.getByTestId(`${ID}-orientation-${ORIENTATION_CHIPS[0]}`));
    await fireEvent.press(screen.getByTestId(`${ID}-save`));

    await waitFor(() => expect(putIdentity).toHaveBeenCalledTimes(1));
    const patch = (putIdentity as jest.Mock).mock.calls[0][0];
    expect(patch).toEqual({ pronouns: [PRONOUN_OPTIONS[0]], orientation: [ORIENTATION_CHIPS[0]] });
    expect(patch).not.toHaveProperty('is_public');
    await waitFor(() => expect(router.back).toHaveBeenCalled());
  });

  it('the audience row saves the audience', async () => {
    const screen = await renderScreen();
    expect(checked(await screen.findByTestId(`${ID}-audience-choice-everyone`))).toBe(true);
    expect(screen.getByTestId(`${ID}-audience-choice-only_me`)).toHaveTextContent(AUDIENCE_LABELS.only_me);
    await fireEvent.press(screen.getByTestId(`${ID}-audience-choice-only_me`));
    await fireEvent.press(screen.getByTestId(`${ID}-save`));
    await waitFor(() => expect(putIdentity).toHaveBeenCalledWith({ audiences: { identity: 'only_me' } }));
  });

  it("shows the word filter's line on the field whose typed entry was refused, and stays open", async () => {
    (putIdentity as jest.Mock).mockRejectedValue(new InvalidInputError(WORD_FILTER_LINE));
    const screen = await renderScreen();
    await fireEvent.changeText(await screen.findByTestId(`${ID}-orientation-typed-input`), 'some word');
    await fireEvent.press(screen.getByTestId(`${ID}-orientation-typed-add`));
    await fireEvent.press(screen.getByTestId(`${ID}-save`));

    expect(await screen.findByTestId(`${ID}-orientation-error`)).toHaveTextContent(WORD_FILTER_LINE);
    expect(screen.queryByTestId(`${ID}-pronouns-error`)).toBeNull();
    expect(router.back).not.toHaveBeenCalled();
    // the entry is kept so it can be taken off; taking it off clears the line
    await fireEvent.press(screen.getByTestId(`${ID}-orientation-some word`));
    expect(screen.queryByTestId(`${ID}-orientation-error`)).toBeNull();
  });

  it('save is off until something changes; back with edits asks first', async () => {
    const screen = await renderScreen();
    await screen.findByTestId(`${ID}-audience`);
    const save = screen.getByTestId(`${ID}-save`);
    expect(save.props.accessibilityState?.disabled).toBe(true);

    await fireEvent.press(screen.getByTestId(`${ID}-pronouns-${PRONOUN_OPTIONS[0]}`));
    expect(screen.getByTestId(`${ID}-save`).props.accessibilityState?.disabled).toBe(false);
    const calls = (usePreventRemove as jest.Mock).mock.calls;
    expect(calls[calls.length - 1][0]).toBe(true);

    await fireEvent.press(screen.getByTestId(`${ID}-back`));
    expect(Alert.alert).toHaveBeenCalled();
    expect(router.back).not.toHaveBeenCalled();
  });

  it('a failed first read offers a retry', async () => {
    (getMyIdentity as jest.Mock).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(identity());
    const screen = await renderScreen();
    await fireEvent.press(await screen.findByTestId(`${ID}-retry`));
    expect(await screen.findByTestId(`${ID}-audience`)).toBeTruthy();
  });
});
