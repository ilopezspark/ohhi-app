import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  useNavigation: () => ({ dispatch: jest.fn() }),
}));
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }));
jest.mock('../api/client', () => ({ supabase: {} }));
jest.mock('../api/profileFields', () => ({ listActivePrompts: jest.fn() }));
jest.mock('../me/editor/ProfileEditorDraftContext', () => ({ useProfileEditorDraftContext: jest.fn() }));
jest.mock('../me/editor/useMyPhotos', () => ({
  useMyPhotos: () => ({ photos: [], urls: {}, isLoading: false, isLoaded: true, refetch: jest.fn(), invalidate: jest.fn() }),
}));
jest.mock('../me/card/summary', () => ({
  usePrivateCardSummary: () => ({ filled: 0, total: 4 }),
  useAboutSummary: () => ({ isPublic: false, filled: 0 }),
}));

import { router } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { listActivePrompts } from '../api/profileFields';
import { useProfileEditorDraftContext } from '../me/editor/ProfileEditorDraftContext';
import { EditSections } from '../me/editor/EditSections';
import { clockLabel, placeLineStatus, placeLineStatusCopy } from '../me/editor/PlaceLineField';
import { moveItem } from '../me/editor/listEdit';
import { queryKeys } from '../me/queryKeys';
import EditPlaceScreen from '../app/profile-editor/place';
import EditPromptsScreen from '../app/profile-editor/prompts';
import EditUsualPlacesScreen from '../app/profile-editor/usual-places';

const PROMPT_OPTIONS = [
  { id: 'ruining_my_life', question: "the class that's ruining my life right now", gated: false, sort_order: 1 },
  { id: 'find_me_on_campus', question: "you'll find me on campus at", gated: true, sort_order: 2 },
  { id: 'cafe_order', question: 'my order at the campus cafe', gated: false, sort_order: 6 },
];

function draftState(overrides: Record<string, unknown> = {}, draft: Record<string, unknown> = {}) {
  return {
    loading: false,
    ready: true,
    userId: 'u1',
    firstName: 'izaac',
    campusTags: [],
    photoCount: 1,
    draft: { statusLine: '', goals: [], tagIds: [], placeLine: '', usualPlaces: [], prompts: [], ...draft },
    fieldsMeta: { savedPlaceLine: null, placeLineUntil: null, placeLineShown: false, joinedMonth: null, joinedRecency: null },
    setPlaceLine: jest.fn(),
    setUsualPlaces: jest.fn(),
    setPrompts: jest.fn(),
    refreshPlaceLine: jest.fn(),
    setStatusLine: jest.fn(),
    setGoals: jest.fn(),
    setTagIds: jest.fn(),
    ...overrides,
  };
}

/** The prompts screen's list query, pre-seeded (`seed`) so it never resolves after a test has ended. */
function withQuery(ui: ReactElement, seed = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  if (seed) client.setQueryData(queryKeys.me.promptOptions, PROMPT_OPTIONS);
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  (listActivePrompts as jest.Mock).mockResolvedValue(PROMPT_OPTIONS);
});
afterEach(() => alertSpy.mockRestore());

describe('place line status', () => {
  const now = new Date('2026-09-29T18:00:00Z');

  it('says nothing for an edited or empty field', () => {
    expect(placeLineStatus({ value: 'gym', savedPlaceLine: 'library', placeLineUntil: null, placeLineShown: true }, now)).toBeNull();
    expect(placeLineStatus({ value: '', savedPlaceLine: null, placeLineUntil: null, placeLineShown: false }, now)).toBeNull();
  });

  it('showing, expired, or away (the two hours still running but not shown)', () => {
    const base = { value: 'library', savedPlaceLine: 'library' };
    expect(placeLineStatus({ ...base, placeLineUntil: '2026-09-29T19:00:00Z', placeLineShown: true }, now)?.kind).toBe('showing');
    expect(placeLineStatus({ ...base, placeLineUntil: '2026-09-29T17:00:00Z', placeLineShown: false }, now)?.kind).toBe('expired');
    expect(placeLineStatus({ ...base, placeLineUntil: '2026-09-29T19:00:00Z', placeLineShown: false }, now)?.kind).toBe('away');
  });

  it('explains why in neutral words', () => {
    expect(placeLineStatusCopy({ kind: 'expired' })).toMatch(/more than 2 hours. save it again/);
    expect(placeLineStatusCopy({ kind: 'away' })).toMatch(/not on campus or nearby/);
  });

  it('clockLabel is lowercase 12-hour time', () => {
    const d = new Date(2026, 8, 29, 15, 5);
    expect(clockLabel(d.toISOString())).toBe('3:05 pm');
    expect(clockLabel(new Date(2026, 8, 29, 0, 30).toISOString())).toBe('12:30 am');
  });
});

describe('moveItem', () => {
  it('moves within bounds and ignores the rest', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveItem(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
    expect(moveItem(['a', 'b'], 1, 2)).toEqual(['a', 'b']);
  });
});

describe('/profile-editor/place', () => {
  it('shows the field with a 40 counter, the two-hour note, and saves the trimmed line into the draft', async () => {
    const state = draftState();
    (useProfileEditorDraftContext as jest.Mock).mockReturnValue(state);
    const screen = await render(<EditPlaceScreen />);

    const input = screen.getByTestId('editor-place-field-input');
    expect(input.props.maxLength).toBe(40);
    expect(screen.getByTestId('editor-place-field-note')).toHaveTextContent(
      "it shows on your profile for 2 hours after you save it, and only while you're on campus or nearby."
    );
    await fireEvent.changeText(input, '  library, 2nd floor ');
    expect(screen.getByTestId('editor-place-field-counter')).toHaveTextContent('21 / 40');
    await fireEvent.press(screen.getByTestId('editor-place-save'));

    expect(state.setPlaceLine).toHaveBeenCalledWith('library, 2nd floor');
    await waitFor(() => expect(router.back).toHaveBeenCalled());
  });

  it('clear empties the field; saving that clears the line', async () => {
    const state = draftState({}, { placeLine: 'library' });
    (useProfileEditorDraftContext as jest.Mock).mockReturnValue(state);
    const screen = await render(<EditPlaceScreen />);
    await fireEvent.press(screen.getByTestId('editor-place-field-clear'));
    expect(screen.getByTestId('editor-place-field-input').props.value).toBe('');
    await fireEvent.press(screen.getByTestId('editor-place-save'));
    expect(state.setPlaceLine).toHaveBeenCalledWith('');
  });

  it('explains when the saved line is not showing, and saving it again refreshes it', async () => {
    const state = draftState(
      {
        fieldsMeta: {
          savedPlaceLine: 'library',
          placeLineUntil: '2000-01-01T00:00:00Z',
          placeLineShown: false,
          joinedMonth: null,
          joinedRecency: null,
        },
      },
      { placeLine: 'library' }
    );
    (useProfileEditorDraftContext as jest.Mock).mockReturnValue(state);
    const screen = await render(<EditPlaceScreen />);
    expect(screen.getByTestId('editor-place-field-status')).toHaveTextContent(/not showing right now/);
    await fireEvent.press(screen.getByTestId('editor-place-save'));
    expect(state.refreshPlaceLine).toHaveBeenCalled();
    expect(state.setPlaceLine).not.toHaveBeenCalled();
  });

  it('cancel with an edit asks before discarding; without one it just leaves', async () => {
    (useProfileEditorDraftContext as jest.Mock).mockReturnValue(draftState());
    const screen = await render(<EditPlaceScreen />);
    await fireEvent.press(screen.getByTestId('editor-place-cancel'));
    await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));
    expect(alertSpy).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByTestId('editor-place-field-input'), 'gym');
    await fireEvent.press(screen.getByTestId('editor-place-cancel'));
    expect(alertSpy).toHaveBeenCalledWith('discard changes?', expect.any(String), expect.any(Array));
  });

  it('guards the swipe back while edited', async () => {
    (useProfileEditorDraftContext as jest.Mock).mockReturnValue(draftState());
    const screen = await render(<EditPlaceScreen />);
    expect((usePreventRemove as jest.Mock).mock.calls.at(-1)?.[0]).toBe(false);
    await fireEvent.changeText(screen.getByTestId('editor-place-field-input'), 'gym');
    expect((usePreventRemove as jest.Mock).mock.calls.at(-1)?.[0]).toBe(true);
  });
});

describe('/profile-editor/prompts', () => {
  const answered = [
    { promptId: 'find_me_on_campus', question: "you'll find me on campus at", gated: true, answer: 'second floor' },
    { promptId: 'cafe_order', question: 'my order at the campus cafe', gated: false, answer: 'oat latte' },
  ];

  it('lists the answers with a 140 counter and the gated note on gated ones', async () => {
    (useProfileEditorDraftContext as jest.Mock).mockReturnValue(draftState({}, { prompts: answered }));
    const screen = await withQuery(<EditPromptsScreen />);
    expect(screen.getByTestId('editor-prompts-item-0-input').props.maxLength).toBe(140);
    expect(screen.getByTestId('editor-prompts-item-0-counter')).toHaveTextContent('12 / 140');
    expect(screen.getByTestId('editor-prompts-item-0-gated')).toHaveTextContent('only shown after a hi has been answered.');
    expect(screen.queryByTestId('editor-prompts-item-1-gated')).toBeNull();
  });

  it('picks from the active list in sort order, minus the ones already chosen', async () => {
    const state = draftState({}, { prompts: [answered[1]] });
    (useProfileEditorDraftContext as jest.Mock).mockReturnValue(state);
    const screen = await withQuery(<EditPromptsScreen />);
    await fireEvent.press(screen.getByTestId('editor-prompts-add'));
    await screen.findByTestId('editor-prompts-option-ruining_my_life');
    expect(screen.queryByTestId('editor-prompts-option-cafe_order')).toBeNull();
    const ids = screen
      .getAllByTestId(/^editor-prompts-option-/)
      .map((node) => node.props.testID);
    expect(ids).toEqual(['editor-prompts-option-ruining_my_life', 'editor-prompts-option-find_me_on_campus']);

    await fireEvent.press(screen.getByTestId('editor-prompts-option-find_me_on_campus'));
    expect(screen.queryByTestId('editor-prompts-picker')).toBeNull();
    expect(screen.getByTestId('editor-prompts-item-1-gated')).toBeTruthy();
  });

  it('stops at 3: no add button once full', async () => {
    (useProfileEditorDraftContext as jest.Mock).mockReturnValue(
      draftState({}, { prompts: [...answered, { promptId: 'ruining_my_life', question: 'q', gated: false, answer: 'a' }] })
    );
    const screen = await withQuery(<EditPromptsScreen />);
    expect(screen.queryByTestId('editor-prompts-add')).toBeNull();
  });

  it('reorders and removes, then saves the trimmed list in that order', async () => {
    const state = draftState({}, { prompts: answered });
    (useProfileEditorDraftContext as jest.Mock).mockReturnValue(state);
    const screen = await withQuery(<EditPromptsScreen />);

    expect(screen.getByTestId('editor-prompts-item-0-up').props.accessibilityState).toEqual({ disabled: true });
    await fireEvent.press(screen.getByTestId('editor-prompts-item-0-down'));
    await fireEvent.changeText(screen.getByTestId('editor-prompts-item-0-input'), ' oat milk latte ');
    await fireEvent.press(screen.getByTestId('editor-prompts-save'));

    expect(state.setPrompts).toHaveBeenCalledWith([
      { promptId: 'cafe_order', question: 'my order at the campus cafe', gated: false, answer: 'oat milk latte' },
      answered[0],
    ]);

    await fireEvent.press(screen.getByTestId('editor-prompts-item-1-remove'));
    await fireEvent.press(screen.getByTestId('editor-prompts-save'));
    expect((state.setPrompts as jest.Mock).mock.calls.at(-1)?.[0]).toHaveLength(1);
  });

  it('will not save a blank answer, and says so', async () => {
    const state = draftState({}, { prompts: answered });
    (useProfileEditorDraftContext as jest.Mock).mockReturnValue(state);
    const screen = await withQuery(<EditPromptsScreen />);
    await fireEvent.changeText(screen.getByTestId('editor-prompts-item-1-input'), '   ');
    await fireEvent.press(screen.getByTestId('editor-prompts-save'));
    expect(state.setPrompts).not.toHaveBeenCalled();
    expect(screen.getByTestId('editor-prompts-item-1-error')).toHaveTextContent('write an answer, or remove this one.');
  });

  it('shows a retry when the list does not load', async () => {
    (listActivePrompts as jest.Mock).mockRejectedValue(new Error('down'));
    (useProfileEditorDraftContext as jest.Mock).mockReturnValue(draftState());
    const screen = await withQuery(<EditPromptsScreen />, false);
    await screen.findByTestId('editor-prompts-add');
    await fireEvent.press(screen.getByTestId('editor-prompts-add'));
    await screen.findByTestId('editor-prompts-picker-error');
  });
});

describe('/profile-editor/usual-places', () => {
  it('edits up to 3 places of 30 characters, with the gate note', async () => {
    const state = draftState({}, { usualPlaces: ['library'] });
    (useProfileEditorDraftContext as jest.Mock).mockReturnValue(state);
    const screen = await render(<EditUsualPlacesScreen />);

    expect(screen.getByTestId('editor-usual-places-item-0-input').props.maxLength).toBe(30);
    expect(screen.getByTestId('editor-usual-places-note')).toHaveTextContent(/once a hi between you two has been answered/);
    await fireEvent.press(screen.getByTestId('editor-usual-places-add'));
    await fireEvent.press(screen.getByTestId('editor-usual-places-add'));
    expect(screen.queryByTestId('editor-usual-places-add')).toBeNull();
    expect(screen.getByTestId('editor-usual-places-item-2')).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('editor-usual-places-item-1-input'), ' the gym ');
    expect(screen.getByTestId('editor-usual-places-item-1-counter')).toHaveTextContent('9 / 30');
    await fireEvent.press(screen.getByTestId('editor-usual-places-save'));
    // the blank third row is dropped
    expect(state.setUsualPlaces).toHaveBeenCalledWith(['library', 'the gym']);
  });

  it('refuses a repeat the way the server would (trimmed, any case)', async () => {
    const state = draftState({}, { usualPlaces: ['library', 'gym'] });
    (useProfileEditorDraftContext as jest.Mock).mockReturnValue(state);
    const screen = await render(<EditUsualPlacesScreen />);
    await fireEvent.changeText(screen.getByTestId('editor-usual-places-item-1-input'), ' Library');
    await fireEvent.press(screen.getByTestId('editor-usual-places-save'));
    expect(state.setUsualPlaces).not.toHaveBeenCalled();
    expect(screen.getByTestId('editor-usual-places-item-1-error')).toHaveTextContent('that place is already on your list.');
  });

  it('removing the last place leaves one empty row, and saving clears the list', async () => {
    const state = draftState({}, { usualPlaces: ['library'] });
    (useProfileEditorDraftContext as jest.Mock).mockReturnValue(state);
    const screen = await render(<EditUsualPlacesScreen />);
    await fireEvent.press(screen.getByTestId('editor-usual-places-item-0-remove'));
    expect(screen.getByTestId('editor-usual-places-item-0-input').props.value).toBe('');
    await fireEvent.press(screen.getByTestId('editor-usual-places-save'));
    expect(state.setUsualPlaces).toHaveBeenCalledWith([]);
  });
});

describe('EditSections — the three new rows', () => {
  it('shows each field with no completion weight and no signal dot, and opens its editor', async () => {
    (useProfileEditorDraftContext as jest.Mock).mockReturnValue({
      ...draftState(
        {},
        {
          placeLine: 'library, 2nd floor',
          usualPlaces: ['library', 'the gym'],
          prompts: [{ promptId: 'cafe_order', question: 'my order at the campus cafe', gated: false, answer: 'x' }],
        }
      ),
      completion: { percent: 50, items: [], nextBest: null },
    });
    const screen = await render(<EditSections />);

    for (const id of ['place', 'prompts', 'usual-places']) {
      expect(screen.queryByTestId(`editor-section-${id}-weight`)).toBeNull();
      expect(screen.queryByTestId(`editor-section-${id}-dot`)).toBeNull();
    }
    expect(screen.getByTestId('editor-place-row')).toHaveTextContent('library, 2nd floor');
    expect(screen.getByTestId('editor-section-prompts-note')).toHaveTextContent('1 of 3');
    expect(screen.getByTestId('editor-usual-places-row')).toHaveTextContent('library, the gym');

    await fireEvent.press(screen.getByTestId('editor-place-row'));
    await fireEvent.press(screen.getByTestId('editor-prompts-row'));
    await fireEvent.press(screen.getByTestId('editor-usual-places-row'));
    expect((router.push as jest.Mock).mock.calls.map((c) => c[0])).toEqual([
      '/profile-editor/place',
      '/profile-editor/prompts',
      '/profile-editor/usual-places',
    ]);
  });

  it('empty rows invite, without nagging', async () => {
    (useProfileEditorDraftContext as jest.Mock).mockReturnValue({
      ...draftState(),
      completion: { percent: 50, items: [], nextBest: null },
    });
    const screen = await render(<EditSections />);
    expect(screen.getByTestId('editor-place-row')).toHaveTextContent('add where you are right now');
    expect(screen.getByTestId('editor-prompts-row')).toHaveTextContent('answer a prompt or two');
    expect(screen.getByTestId('editor-usual-places-row')).toHaveTextContent('add where you usually end up');
  });
});
