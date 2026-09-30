import { Alert } from 'react-native';
import { fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) },
}));
jest.mock('../api/identity', () => ({ getCard: jest.fn() }));
jest.mock('../api/identityWrite', () => ({ putCard: jest.fn() }));
jest.mock('../api/session', () => ({ currentUserId: jest.fn(() => Promise.resolve('me-1')) }));

import { router } from 'expo-router';
import { getCard } from '../api/identity';
import { putCard } from '../api/identityWrite';
import { InvalidInputError, WORD_FILTER_LINE } from '../api/errors';
import EditPrivateCardScreen from '../app/profile-editor/private-card';
import { CARD_GROUP_LABELS, CARD_SECTION_LABELS } from '../me/card/fieldLabels';
import {
  CARD_SECTIONS,
  HARD_NO_MAX_LENGTH,
  HARD_NO_MAX_TYPED,
  HARD_NO_OPTIONS,
  HOSTING_OPTIONS,
  PACE_OPTIONS,
  PRACTICE_GROUP_ORDER,
  PRACTICE_GROUPS,
  PRIVACY_OPTIONS,
  SHOWS_INTEREST_OPTIONS,
} from '../settings/vocab';
import { emptyCardPayload, type CardPayload } from '../profile/fields';

const SAVED = { user_id: 'me-1', key_version: 1, fields_filled: 1, updated_at: 'now' };

function mockCard(sections: Partial<CardPayload> = {}) {
  (getCard as jest.Mock).mockResolvedValue({ user_id: 'me-1', sections: { ...emptyCardPayload(), ...sections }, gated: [] });
}

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <EditPrivateCardScreen />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  (putCard as jest.Mock).mockResolvedValue(SAVED);
});

describe('EditPrivateCardScreen (payload v2)', () => {
  it("reads the owner's own card", async () => {
    mockCard();
    const { findByTestId } = await renderScreen();
    await findByTestId('private-card-editor-screen');
    expect(getCard).toHaveBeenCalledWith('me-1');
  });

  it('renders the nine sections in three groups, in group order, boundaries last, each group captioned', async () => {
    mockCard();
    const { findByTestId, getAllByTestId, getByText } = await renderScreen();
    await findByTestId('private-card-editor-screen');

    const groups = getAllByTestId(/^private-card-editor-group-[a-z_]+$/).map((node) => node.props.testID);
    expect(groups).toEqual([
      'private-card-editor-group-standard',
      'private-card-editor-group-gated',
      'private-card-editor-group-always_attached',
    ]);
    for (const group of ['standard', 'gated', 'always_attached'] as const) {
      expect(getByText(CARD_GROUP_LABELS[group])).toBeTruthy();
      await findByTestId(`private-card-editor-caption-${group}`);
    }

    const sectionIds = getAllByTestId(new RegExp(`^private-card-editor-(${CARD_SECTIONS.join('|')})$`)).map(
      (node) => node.props.testID
    );
    expect(sectionIds).toEqual(CARD_SECTIONS.map((section) => `private-card-editor-${section}`));
    expect(sectionIds.slice(-2)).toEqual(['private-card-editor-hard_nos', 'private-card-editor-privacy']);
    for (const section of CARD_SECTIONS) expect(getByText(CARD_SECTION_LABELS[section])).toBeTruthy();
  });

  it('the captions say standard always goes, intimacy only when ticked, boundaries always attached', async () => {
    mockCard();
    const { findByTestId } = await renderScreen();
    expect((await findByTestId('private-card-editor-caption-standard')).props.children).toMatch(/always goes/);
    expect((await findByTestId('private-card-editor-caption-gated')).props.children).toMatch(/tick/);
    expect((await findByTestId('private-card-editor-caption-always_attached')).props.children).toMatch(/always attached/);
  });

  it('single-select sections (pace, living situation, hosting) keep one value: picking another replaces it', async () => {
    mockCard();
    const { findByTestId } = await renderScreen();
    await fireEvent.press(await findByTestId(`private-card-editor-pace-${PACE_OPTIONS[0]}`));
    await fireEvent.press(await findByTestId(`private-card-editor-pace-${PACE_OPTIONS[1]}`));
    expect((await findByTestId(`private-card-editor-pace-${PACE_OPTIONS[0]}`)).props.accessibilityState?.checked).toBe(false);
    expect((await findByTestId(`private-card-editor-pace-${PACE_OPTIONS[1]}`)).props.accessibilityState?.checked).toBe(true);

    await fireEvent.press(await findByTestId('private-card-editor-save'));
    await waitFor(() => expect(putCard).toHaveBeenCalledWith({ pace: PACE_OPTIONS[1] }));
  });

  it('tapping the picked single value again clears it (sent as null)', async () => {
    mockCard({ hosting: HOSTING_OPTIONS[0] });
    const { findByTestId } = await renderScreen();
    await fireEvent.press(await findByTestId(`private-card-editor-hosting-${HOSTING_OPTIONS[0]}`));
    await fireEvent.press(await findByTestId('private-card-editor-save'));
    await waitFor(() => expect(putCard).toHaveBeenCalledWith({ hosting: null }));
  });

  it('multi-select sections keep several values, in the list order', async () => {
    mockCard();
    const { findByTestId } = await renderScreen();
    await fireEvent.press(await findByTestId(`private-card-editor-shows_interest-${SHOWS_INTEREST_OPTIONS[2]}`));
    await fireEvent.press(await findByTestId(`private-card-editor-shows_interest-${SHOWS_INTEREST_OPTIONS[0]}`));
    await fireEvent.press(await findByTestId('private-card-editor-save'));
    await waitFor(() =>
      expect(putCard).toHaveBeenCalledWith({ shows_interest: [SHOWS_INTEREST_OPTIONS[0], SHOWS_INTEREST_OPTIONS[2]] })
    );
  });

  it("the practice picker is grouped under its sub-headers and stored as one flat list", async () => {
    mockCard();
    const { findByTestId, getByText } = await renderScreen();
    const practices = await findByTestId('private-card-editor-practices');
    for (const group of PRACTICE_GROUP_ORDER) {
      const groupNode = within(practices).getByTestId(`private-card-editor-practices-group-${group}`);
      // "roleplay" is both a sub-header and an option in it.
      expect(within(groupNode).getAllByText(group).length).toBeGreaterThan(0);
      for (const option of PRACTICE_GROUPS[group]) {
        expect(within(groupNode).getByTestId(`private-card-editor-practices-${option}`)).toBeTruthy();
      }
    }
    expect(getByText('sensation')).toBeTruthy();

    await fireEvent.press(await findByTestId(`private-card-editor-practices-${PRACTICE_GROUPS.other[0]}`));
    await fireEvent.press(await findByTestId(`private-card-editor-practices-${PRACTICE_GROUPS.sensation[0]}`));
    await fireEvent.press(await findByTestId('private-card-editor-save'));
    await waitFor(() =>
      expect(putCard).toHaveBeenCalledWith({ practices: [PRACTICE_GROUPS.sensation[0], PRACTICE_GROUPS.other[0]] })
    );
  });

  it('sends only the sections that changed (a partial patch), then goes back', async () => {
    mockCard({ pace: PACE_OPTIONS[2], safer_sex: ['condoms'], hard_nos: ['no calls'] });
    const { findByTestId } = await renderScreen();
    await fireEvent.press(await findByTestId(`private-card-editor-privacy-${PRIVACY_OPTIONS[0]}`));
    await fireEvent.press(await findByTestId('private-card-editor-save'));

    await waitFor(() => expect(putCard).toHaveBeenCalledWith({ privacy: [PRIVACY_OPTIONS[0]] }));
    await waitFor(() => expect(router.back).toHaveBeenCalled());
  });

  it('save with nothing changed goes back without a request', async () => {
    mockCard({ pace: PACE_OPTIONS[2] });
    const { findByTestId } = await renderScreen();
    await fireEvent.press(await findByTestId('private-card-editor-save'));
    expect(putCard).not.toHaveBeenCalled();
    expect(router.back).toHaveBeenCalled();
  });

  describe('hard nos', () => {
    it('offers every fixed chip (uncapped: all of them can be picked)', async () => {
      mockCard({ hard_nos: [...HARD_NO_OPTIONS] });
      const { findByTestId } = await renderScreen();
      for (const option of HARD_NO_OPTIONS) {
        expect((await findByTestId(`private-card-editor-hard_nos-${option}`)).props.accessibilityState?.checked).toBe(true);
      }
      await findByTestId('private-card-editor-hard-nos-add');
    });

    it('adds a trimmed, whitespace-collapsed typed entry as a chip', async () => {
      mockCard();
      const { findByTestId } = await renderScreen();
      await fireEvent.press(await findByTestId('private-card-editor-hard-nos-add'));
      await fireEvent.changeText(await findByTestId('private-card-editor-hard-nos-input-input'), '  no   early mornings  ');
      await fireEvent.press(await findByTestId('private-card-editor-hard-nos-confirm'));
      await findByTestId('private-card-editor-hard_nos-no early mornings');

      await fireEvent.press(await findByTestId('private-card-editor-save'));
      await waitFor(() => expect(putCard).toHaveBeenCalledWith({ hard_nos: ['no early mornings'] }));
    });

    it(`rejects an entry over ${HARD_NO_MAX_LENGTH} characters with the length copy`, async () => {
      mockCard();
      const { findByTestId } = await renderScreen();
      await fireEvent.press(await findByTestId('private-card-editor-hard-nos-add'));
      await fireEvent.changeText(await findByTestId('private-card-editor-hard-nos-input-input'), 'x'.repeat(HARD_NO_MAX_LENGTH + 1));
      await fireEvent.press(await findByTestId('private-card-editor-hard-nos-confirm'));
      const error = await findByTestId('private-card-editor-hard-nos-error');
      expect(error.props.children).toEqual(expect.stringContaining(`${HARD_NO_MAX_LENGTH} characters`));
    });

    it('rejects a case-insensitive duplicate of a picked fixed chip', async () => {
      mockCard({ hard_nos: ['no substances'] });
      const { findByTestId } = await renderScreen();
      await fireEvent.press(await findByTestId('private-card-editor-hard-nos-add'));
      await fireEvent.changeText(await findByTestId('private-card-editor-hard-nos-input-input'), 'NO SUBSTANCES');
      await fireEvent.press(await findByTestId('private-card-editor-hard-nos-confirm'));
      await findByTestId('private-card-editor-hard-nos-error');
    });

    it(`hides "+ write your own" at ${HARD_NO_MAX_TYPED} typed entries, however many fixed chips are picked`, async () => {
      const typed = Array.from({ length: HARD_NO_MAX_TYPED }, (_, i) => `custom no ${i}`);
      mockCard({ hard_nos: [...HARD_NO_OPTIONS, ...typed] });
      const { findByTestId, queryByTestId } = await renderScreen();
      await findByTestId('private-card-editor-hard_nos');
      expect(queryByTestId('private-card-editor-hard-nos-add')).toBeNull();
      await findByTestId(`private-card-editor-hard_nos-${typed[0]}`);
    });

    it(`still offers "+ write your own" under ${HARD_NO_MAX_TYPED} typed entries`, async () => {
      const typed = Array.from({ length: HARD_NO_MAX_TYPED - 1 }, (_, i) => `custom no ${i}`);
      mockCard({ hard_nos: typed });
      const { findByTestId } = await renderScreen();
      await findByTestId('private-card-editor-hard-nos-add');
    });

    it("shows the word filter's refusal on the hard nos and keeps what was typed", async () => {
      mockCard();
      (putCard as jest.Mock).mockRejectedValue(new InvalidInputError(WORD_FILTER_LINE));
      const { findByTestId, queryByTestId } = await renderScreen();
      await fireEvent.press(await findByTestId('private-card-editor-hard-nos-add'));
      await fireEvent.changeText(await findByTestId('private-card-editor-hard-nos-input-input'), 'something rude');
      await fireEvent.press(await findByTestId('private-card-editor-hard-nos-confirm'));
      await fireEvent.press(await findByTestId('private-card-editor-save'));

      const line = await findByTestId('private-card-editor-hard-nos-filter-error');
      expect(line.props.children).toBe(WORD_FILTER_LINE);
      expect(queryByTestId('private-card-editor-error')).toBeNull();
      await findByTestId('private-card-editor-hard_nos-something rude');
      expect(router.back).not.toHaveBeenCalled();
    });
  });

  describe('cancel / dirty-dismiss', () => {
    it('goes back immediately with no confirmation when nothing changed', async () => {
      mockCard();
      const { findByTestId } = await renderScreen();
      await fireEvent.press(await findByTestId('private-card-editor-cancel'));
      expect(Alert.alert).not.toHaveBeenCalled();
      expect(router.back).toHaveBeenCalled();
    });

    it('confirms before discarding when the card was edited', async () => {
      mockCard();
      const { findByTestId } = await renderScreen();
      await fireEvent.press(await findByTestId(`private-card-editor-shows_interest-${SHOWS_INTEREST_OPTIONS[0]}`));
      await fireEvent.press(await findByTestId('private-card-editor-cancel'));
      expect(Alert.alert).toHaveBeenCalled();
      expect(router.back).not.toHaveBeenCalled();
    });

    it('navigates back once the discard action is chosen', async () => {
      mockCard();
      (Alert.alert as jest.Mock).mockImplementation((_title, _msg, buttons) => {
        const discard = buttons?.find((b: { text: string }) => b.text === 'discard');
        discard?.onPress?.();
      });
      const { findByTestId } = await renderScreen();
      await fireEvent.press(await findByTestId(`private-card-editor-shows_interest-${SHOWS_INTEREST_OPTIONS[0]}`));
      await fireEvent.press(await findByTestId('private-card-editor-cancel'));
      expect(router.back).toHaveBeenCalled();
    });
  });

  it('shows the generic refusal copy when the save fails for another reason', async () => {
    mockCard();
    (putCard as jest.Mock).mockRejectedValue(new Error('boom'));
    const { findByTestId, queryByTestId } = await renderScreen();
    await fireEvent.press(await findByTestId(`private-card-editor-shows_interest-${SHOWS_INTEREST_OPTIONS[0]}`));
    await fireEvent.press(await findByTestId('private-card-editor-save'));
    await findByTestId('private-card-editor-error');
    expect(queryByTestId('private-card-editor-hard-nos-filter-error')).toBeNull();
    expect(router.back).not.toHaveBeenCalled();
  });

  it('treats a card never written (404) as empty', async () => {
    (getCard as jest.Mock).mockResolvedValue(null);
    const { findByTestId } = await renderScreen();
    expect((await findByTestId(`private-card-editor-pace-${PACE_OPTIONS[0]}`)).props.accessibilityState?.checked).toBe(false);
  });
});
