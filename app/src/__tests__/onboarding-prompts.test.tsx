import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
}));
jest.mock('../api/client', () => ({ supabase: {} }));
jest.mock('../api/profileFields', () => ({
  listActivePrompts: jest.fn(),
  getMyProfileFields: jest.fn(),
  setMyPrompts: jest.fn(),
}));

import { router } from 'expo-router';
import { getMyProfileFields, listActivePrompts, setMyPrompts } from '../api/profileFields';
import PromptsScreen from '../app/(onboarding)/prompts';
import { markSaved, mergeStored, payloadFor, isDirty, type PromptEntry } from '../onboarding/prompts';
import { stepToPath } from '../onboarding/stepResolver';

const BANK = [
  { id: 'cafe_order', question: 'my cafe order', gated: false, sort_order: 1 },
  { id: 'ruining_my_life', question: 'currently ruining my life', gated: false, sort_order: 2 },
  { id: 'find_me_on_campus', question: 'you can find me on campus at', gated: true, sort_order: 3 },
  { id: 'fourth', question: 'a fourth question', gated: false, sort_order: 4 },
];

const EMPTY_FIELDS = { placeLine: null, placeLineUntil: null, placeLineShown: false, usualPlaces: [], prompts: [], joinedMonth: null, joinedRecency: null };

async function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const screen = await render(
    <QueryClientProvider client={client}>
      <PromptsScreen />
    </QueryClientProvider>
  );
  // Let the two reads settle inside act, so nothing updates after the test ends.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return screen;
}

async function addPrompt(screen: Awaited<ReturnType<typeof renderScreen>>, id: string) {
  await fireEvent.press(screen.getByTestId('prompts-add'));
  await fireEvent.press(await screen.findByTestId(`prompts-option-${id}`));
}

beforeEach(() => {
  jest.clearAllMocks();
  (listActivePrompts as jest.Mock).mockResolvedValue(BANK);
  (getMyProfileFields as jest.Mock).mockResolvedValue(EMPTY_FIELDS);
  (setMyPrompts as jest.Mock).mockImplementation(async (answers: { promptId: string; answer: string }[]) => answers);
});

describe('onboarding prompts step', () => {
  it('asks whether they want to answer a few prompts, on step 8 of 10', async () => {
    const screen = await renderScreen();
    expect(screen.getByText('want to answer a few prompts?')).toBeTruthy();
    expect(screen.getByTestId('onboarding-progress').props.accessibilityLabel).toBe('step 8 of 10');
    expect(screen.getByTestId('prompts-count')).toHaveTextContent('0 of 3');
  });

  it('renders the whole bank in the picker, with the gated note on gated questions', async () => {
    const screen = await renderScreen();
    await fireEvent.press(screen.getByTestId('prompts-add'));
    await screen.findByTestId('prompts-option-cafe_order');
    const ids = screen.getAllByTestId(/^prompts-option-/).map((node) => node.props.testID);
    expect(ids).toEqual(BANK.map((b) => `prompts-option-${b.id}`));
    expect(screen.getAllByText('only shown after a hi has been answered.')).toHaveLength(1);
  });

  it('shows the gated note on an answer card, and not on the others', async () => {
    const screen = await renderScreen();
    await addPrompt(screen, 'find_me_on_campus');
    await addPrompt(screen, 'cafe_order');
    expect(screen.getByTestId('prompts-item-0-gated')).toHaveTextContent('only shown after a hi has been answered.');
    expect(screen.queryByTestId('prompts-item-1-gated')).toBeNull();
    expect(screen.queryByTestId('prompts-picker')).toBeNull();
  });

  it('limits the answer to 140 characters and stops offering prompts at three', async () => {
    const screen = await renderScreen();
    await addPrompt(screen, 'cafe_order');
    expect(screen.getByTestId('prompts-item-0-input').props.maxLength).toBe(140);
    await addPrompt(screen, 'ruining_my_life');
    await addPrompt(screen, 'find_me_on_campus');
    expect(screen.queryByTestId('prompts-add')).toBeNull();
  });

  it('saves an answer through set_my_prompts, the same call the editor makes, then sends the stored ones with the next', async () => {
    const screen = await renderScreen();
    await addPrompt(screen, 'cafe_order');
    expect(screen.queryByTestId('prompts-item-0-save')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('prompts-item-0-input'), ' oat milk latte ');
    await fireEvent.press(screen.getByTestId('prompts-item-0-save'));
    await waitFor(() => expect(setMyPrompts).toHaveBeenCalledWith([{ promptId: 'cafe_order', answer: 'oat milk latte' }]));
    await screen.findByTestId('prompts-item-0-saved');

    await addPrompt(screen, 'ruining_my_life');
    await fireEvent.changeText(screen.getByTestId('prompts-item-1-input'), 'my thesis');
    await fireEvent.press(screen.getByTestId('prompts-item-1-save'));
    await waitFor(() =>
      expect(setMyPrompts).toHaveBeenLastCalledWith([
        { promptId: 'cafe_order', answer: 'oat milk latte' },
        { promptId: 'ruining_my_life', answer: 'my thesis' },
      ])
    );
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('continues to location without saving when nothing was answered', async () => {
    const screen = await renderScreen();
    await fireEvent.press(screen.getByTestId('prompts-continue'));
    expect(router.replace).toHaveBeenCalledWith('/(onboarding)/location');
    expect(setMyPrompts).not.toHaveBeenCalled();
  });

  it('continue saves an answer still in its box, then goes to location', async () => {
    const screen = await renderScreen();
    await addPrompt(screen, 'cafe_order');
    await fireEvent.changeText(screen.getByTestId('prompts-item-0-input'), 'flat white');
    await fireEvent.press(screen.getByTestId('prompts-continue'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/(onboarding)/location'));
    expect(setMyPrompts).toHaveBeenCalledWith([{ promptId: 'cafe_order', answer: 'flat white' }]);
  });

  it('continue does not send a prompt whose answer is blank', async () => {
    const screen = await renderScreen();
    await addPrompt(screen, 'cafe_order');
    await fireEvent.changeText(screen.getByTestId('prompts-item-0-input'), '   ');
    await fireEvent.press(screen.getByTestId('prompts-continue'));
    expect(router.replace).toHaveBeenCalledWith('/(onboarding)/location');
    expect(setMyPrompts).not.toHaveBeenCalled();
  });

  it('skip for now goes to location without saving', async () => {
    const screen = await renderScreen();
    await addPrompt(screen, 'cafe_order');
    await fireEvent.changeText(screen.getByTestId('prompts-item-0-input'), 'flat white');
    await fireEvent.press(screen.getByTestId('prompts-skip'));
    expect(router.replace).toHaveBeenCalledWith('/(onboarding)/location');
    expect(setMyPrompts).not.toHaveBeenCalled();
  });

  it('stays on the step and says so when a save fails', async () => {
    (setMyPrompts as jest.Mock).mockRejectedValueOnce(new Error('network'));
    const screen = await renderScreen();
    await addPrompt(screen, 'cafe_order');
    await fireEvent.changeText(screen.getByTestId('prompts-item-0-input'), 'flat white');
    await fireEvent.press(screen.getByTestId('prompts-continue'));
    await screen.findByTestId('prompts-error');
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('shows answers already stored (coming back from location) and removes a stored one on the server', async () => {
    (getMyProfileFields as jest.Mock).mockResolvedValue({
      ...EMPTY_FIELDS,
      prompts: [
        { position: 0, promptId: 'cafe_order', question: 'my cafe order', gated: false, answer: 'flat white' },
        { position: 1, promptId: 'ruining_my_life', question: 'currently ruining my life', gated: false, answer: 'my thesis' },
      ],
    });
    const screen = await renderScreen();
    await waitFor(() => expect(screen.getByTestId('prompts-item-0-input').props.value).toBe('flat white'));
    expect(screen.getByTestId('prompts-count')).toHaveTextContent('2 of 3');
    await fireEvent.press(screen.getByTestId('prompts-item-0-remove'));
    await waitFor(() => expect(setMyPrompts).toHaveBeenCalledWith([{ promptId: 'ruining_my_life', answer: 'my thesis' }]));
  });

  it('goes back to status', async () => {
    const screen = await renderScreen();
    await fireEvent.press(screen.getByTestId('prompts-back'));
    expect(router.replace).toHaveBeenCalledWith('/(onboarding)/status');
  });

  it('is the route status hands on to, and the route location goes back to', () => {
    expect(stepToPath('prompts')).toBe('/(onboarding)/prompts');
  });
});

describe('the prompts step answer list', () => {
  const entry = (over: Partial<PromptEntry>): PromptEntry => ({
    promptId: 'a',
    question: 'q',
    gated: false,
    answer: '',
    savedAnswer: null,
    ...over,
  });

  it('is dirty only for a non-blank answer that differs from the stored one', () => {
    expect(isDirty(entry({ answer: '  ' }))).toBe(false);
    expect(isDirty(entry({ answer: 'x' }))).toBe(true);
    expect(isDirty(entry({ answer: ' x ', savedAnswer: 'x' }))).toBe(false);
    expect(isDirty(entry({ answer: 'y', savedAnswer: 'x' }))).toBe(true);
  });

  it('sends stored answers with the one being saved, in order, leaving out unsaved blanks', () => {
    const entries = [
      entry({ promptId: 'a', answer: 'one', savedAnswer: 'one' }),
      entry({ promptId: 'b', answer: 'typed', savedAnswer: null }),
      entry({ promptId: 'c', answer: 'draft', savedAnswer: null }),
    ];
    expect(payloadFor(entries, 1)).toEqual([
      { promptId: 'a', answer: 'one' },
      { promptId: 'b', answer: 'typed' },
    ]);
    expect(payloadFor(entries, 'all')).toHaveLength(3);
    expect(payloadFor(entries, 'none')).toEqual([{ promptId: 'a', answer: 'one' }]);
  });

  it('falls back to the stored answer when the box was emptied', () => {
    expect(payloadFor([entry({ answer: '', savedAnswer: 'kept' })], 'all')).toEqual([{ promptId: 'a', answer: 'kept' }]);
  });

  it('marks sent answers stored and merges stored answers ahead of new ones', () => {
    const marked = markSaved([entry({ promptId: 'a', answer: 'x' })], [{ promptId: 'a', answer: 'x' }]);
    expect(marked[0].savedAnswer).toBe('x');
    const merged = mergeStored(
      [entry({ promptId: 'n', answer: 'new' }), entry({ promptId: 'a', answer: 'typing' })],
      [{ promptId: 'a', question: 'q', gated: false, answer: 'old' }]
    );
    expect(merged.map((e) => e.promptId)).toEqual(['a', 'n']);
    expect(merged[0]).toMatchObject({ answer: 'old', savedAnswer: 'old' });
  });
});
