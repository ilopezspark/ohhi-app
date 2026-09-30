import { useState } from 'react';
import { fireEvent, render, waitFor, within } from '@testing-library/react-native';

jest.mock('../api/client', () => ({ supabase: {} }));
jest.mock('../api/tags', () => ({
  ...jest.requireActual('../api/tags'),
  suggestTag: jest.fn(),
}));

import { suggestTag, type Tag } from '../api/tags';
import { InvalidInputError } from '../api/errors';
import { TagPicker } from '../tags/TagPicker';

const CATEGORIES = [
  ['sports', 'sports'],
  ['fitness', 'fitness'],
  ['music', 'music'],
  ['film_tv', 'film & tv'],
  ['the_honest_ones', 'the honest ones'],
] as const;

const CATALOG: Tag[] = CATEGORIES.flatMap(([slug, label], c) =>
  Array.from({ length: 4 }, (_, i) => ({
    id: `${slug}-${i}`,
    label: slug === 'the_honest_ones' && i === 0 ? 'catching the bus' : `${label} ${i}`,
    category: slug,
    categoryLabel: label,
    categoryOrder: c + 1,
    sortOrder: i + 1,
  }))
);

function Harness({ initial = [] as string[], min = 3, onSubmit = jest.fn(), verb = 'continue' as 'continue' | 'done' }) {
  const [selected, setSelected] = useState<string[]>(initial);
  return (
    <TagPicker
      testID="picker"
      title="what are you into"
      closeLabel="back"
      onClose={jest.fn()}
      catalog={CATALOG}
      selected={selected}
      onChange={setSelected}
      min={min}
      minNote="pick at least three to continue."
      verb={verb}
      onSubmit={onSubmit}
    />
  );
}

beforeEach(() => jest.clearAllMocks());

describe('TagPicker', () => {
  it('opens the first three sections, collapses the rest, and shows a count per section', async () => {
    const screen = await render(<Harness />);
    expect(screen.getByTestId('picker-chip-sports-0')).toBeTruthy();
    expect(screen.getByTestId('picker-chip-music-3')).toBeTruthy();
    expect(screen.queryByTestId('picker-chip-film_tv-0')).toBeNull();
    expect(screen.getByTestId('picker-section-film_tv-count')).toHaveTextContent('4');
    expect(screen.getByTestId('picker-section-film_tv').props.accessibilityState).toMatchObject({ expanded: false });
    expect(screen.getByTestId('picker-section-sports').props.accessibilityState).toMatchObject({ expanded: true });

    // (collapse one first: the list is virtualised and a test renderer has no scroll)
    await fireEvent.press(screen.getByTestId('picker-section-sports'));
    expect(screen.queryByTestId('picker-chip-sports-0')).toBeNull();
    await fireEvent.press(screen.getByTestId('picker-section-film_tv'));
    expect(screen.getByTestId('picker-chip-film_tv-0')).toBeTruthy();
    expect(screen.getByTestId('picker-section-film_tv').props.accessibilityState).toMatchObject({ expanded: true });
  });

  it('picks in order into the sticky tray with a live counter; x removes; the CTA carries the counter', async () => {
    const onSubmit = jest.fn();
    const screen = await render(<Harness onSubmit={onSubmit} />);
    expect(screen.getByTestId('picker-submit')).toHaveTextContent('continue · 0 of 10');
    expect(screen.getByTestId('picker-min-note')).toHaveTextContent('pick at least three to continue.');

    await fireEvent.press(screen.getByTestId('picker-chip-music-1'));
    await fireEvent.press(screen.getByTestId('picker-chip-sports-2'));
    const chip = screen.getByTestId('picker-chip-music-1');
    expect(chip.props.accessibilityRole).toBe('togglebutton');
    expect(chip.props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId('picker-tray')).toHaveTextContent(/music 1.*sports 2/);
    expect(screen.getByTestId('picker-counter')).toHaveTextContent('2 of 10');

    // disabled below the minimum
    await fireEvent.press(screen.getByTestId('picker-submit'));
    expect(onSubmit).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('picker-tray-music-1'));
    expect(screen.getByTestId('picker-counter')).toHaveTextContent('1 of 10');
    await fireEvent.press(screen.getByTestId('picker-chip-fitness-0'));
    await fireEvent.press(screen.getByTestId('picker-chip-fitness-1'));
    expect(screen.getByTestId('picker-submit')).toHaveTextContent('continue · 3 of 10');
    expect(screen.queryByTestId('picker-min-note')).toBeNull();
    await fireEvent.press(screen.getByTestId('picker-submit'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('at 10, other chips are disabled with a quiet note', async () => {
    const ten = CATALOG.slice(0, 10).map((t) => t.id);
    const screen = await render(<Harness initial={ten} verb="done" />);
    expect(screen.getByTestId('picker-max-note')).toHaveTextContent("that's 10. remove one to pick another.");
    expect(screen.getByTestId('picker-submit')).toHaveTextContent('done · 10 of 10');
    const unpicked = screen.getByTestId('picker-chip-music-3');
    expect(unpicked.props.accessibilityState).toMatchObject({ disabled: true, selected: false });
    await fireEvent.press(unpicked);
    expect(screen.getByTestId('picker-counter')).toHaveTextContent('10 of 10');
  });

  it('mirrors the editor minimum: a user holding 1 may save 1', async () => {
    const onSubmit = jest.fn();
    const screen = await render(<Harness initial={['sports-0']} min={1} verb="done" onSubmit={onSubmit} />);
    await fireEvent.press(screen.getByTestId('picker-submit'));
    expect(onSubmit).toHaveBeenCalled();
    // still asks for three
    expect(screen.getByTestId('picker-min-note')).toBeTruthy();
  });

  it('search filters across every category (inside labels, any case) and opens the matching sections', async () => {
    const screen = await render(<Harness />);
    await fireEvent.changeText(screen.getByTestId('picker-search'), 'BUS');
    expect(screen.getByTestId('picker-chip-the_honest_ones-0')).toBeTruthy();
    expect(screen.queryByTestId('picker-chip-sports-0')).toBeNull();
    expect(screen.getByTestId('picker-section-the_honest_ones-count')).toHaveTextContent('1');

    await fireEvent.changeText(screen.getByTestId('picker-search'), 'zzz');
    expect(screen.getByTestId('picker-empty')).toHaveTextContent(/no interest by that name yet/);
    expect(screen.getByTestId('picker-empty-suggest')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('picker-search-clear'));
    expect(screen.getByTestId('picker-chip-sports-0')).toBeTruthy();
  });
});

describe('suggest a tag', () => {
  it('sends to the queue, confirms neutrally, and never touches the selection', async () => {
    (suggestTag as jest.Mock).mockResolvedValue(undefined);
    const screen = await render(<Harness />);
    await fireEvent.changeText(screen.getByTestId('picker-search'), 'rollerblading');
    await fireEvent.press(screen.getByTestId('picker-empty-suggest'));
    // pre-filled from the search
    expect(screen.getByTestId('picker-suggest-sheet-label-input').props.value).toBe('rollerblading');
    await fireEvent.press(screen.getByTestId('picker-suggest-sheet-category-sports'));
    await fireEvent.press(screen.getByTestId('picker-suggest-sheet-send'));
    await waitFor(() => expect(screen.getByTestId('picker-suggest-sheet-sent')).toBeTruthy());
    expect(suggestTag).toHaveBeenCalledWith('rollerblading', 'sports');
    expect(screen.getByTestId('picker-suggest-sheet-sent')).toHaveTextContent(/won't be added to your profile/);
    expect(screen.getByTestId('picker-counter')).toHaveTextContent('0 of 10');
  });

  it('shows a refusal on the field, keeps the text, and never echoes a term', async () => {
    (suggestTag as jest.Mock).mockRejectedValue(new InvalidInputError("that text can't be used."));
    const screen = await render(<Harness />);
    await fireEvent.press(screen.getByTestId('picker-suggest'));
    await fireEvent.changeText(screen.getByTestId('picker-suggest-sheet-label-input'), 'some text');
    await fireEvent.press(screen.getByTestId('picker-suggest-sheet-send'));
    const sheet = await screen.findByTestId('picker-suggest-sheet');
    await waitFor(() => expect(within(sheet).getByText("that text can't be used.")).toBeTruthy());
    expect(screen.getByTestId('picker-suggest-sheet-label-input').props.value).toBe('some text');
    expect(suggestTag).toHaveBeenCalledWith('some text', null);
  });

  it('handles the rate limit with neutral copy', async () => {
    (suggestTag as jest.Mock).mockRejectedValue(
      new InvalidInputError('you already have a few suggestions waiting. try again once they have been looked at.')
    );
    const screen = await render(<Harness />);
    await fireEvent.press(screen.getByTestId('picker-suggest'));
    await fireEvent.changeText(screen.getByTestId('picker-suggest-sheet-label-input'), 'x');
    await fireEvent.press(screen.getByTestId('picker-suggest-sheet-send'));
    await waitFor(() => expect(screen.getByText(/suggestions waiting/)).toBeTruthy());
  });
});
