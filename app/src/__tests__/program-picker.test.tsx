import * as fs from 'fs';
import * as path from 'path';
import { BackHandler } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

jest.mock('../api/client', () => ({ supabase: {} }));
jest.mock('../api/about', () => ({ ...jest.requireActual('../api/about'), suggestProgram: jest.fn() }));

import { ProgramSuggestionError, suggestProgram } from '../api/about';
import { UnknownError } from '../api/errors';
import { ProgramPickerSheet, type ProgramPickerSheetProps } from '../me/editor/ProgramPickerSheet';

// 50 programs, as the expanded catalog returns them, in server order.
const NAMED = ['art', 'bio', 'business', 'criminal justice', 'cs', 'early childhood education', 'education', 'nursing', 'welding'];
const PROGRAMS = [...NAMED, ...Array.from({ length: 41 }, (_, i) => `program ${i + 10}`)].map((label, i) => ({
  id: `p${i}`,
  label,
}));
const byLabel = (label: string) => PROGRAMS.find((p) => p.label === label)!;

function renderPicker(props: Partial<ProgramPickerSheetProps> = {}) {
  const onPick = jest.fn();
  const onDismiss = jest.fn();
  const utils = render(
    <ProgramPickerSheet
      testID="pp"
      kind="major"
      programs={PROGRAMS}
      selectedId={null}
      clearLabel="no major"
      onPick={onPick}
      onDismiss={onDismiss}
      {...props}
    />
  );
  return { onPick, onDismiss, utils };
}

beforeEach(() => jest.clearAllMocks());

describe('the list', () => {
  it('is a tall sheet with a labelled search field (not focused), the list and the suggest link', async () => {
    const { utils } = renderPicker();
    const screen = await utils;
    expect(screen.getByTestId('pp-panel')).toBeTruthy();
    expect(screen.getByText('your major')).toBeTruthy();
    const search = screen.getByTestId('pp-search');
    expect(search.props.accessibilityLabel).toBe('search majors');
    expect(search.props.autoFocus).toBeFalsy();
    expect(screen.getByTestId('pp-list')).toBeTruthy();
    expect(screen.getByTestId('pp-p0')).toHaveTextContent('art');
    expect(screen.getByTestId('pp-suggest')).toHaveTextContent('suggest a major');
    expect(screen.getByText("don't see yours?")).toBeTruthy();
  });

  it('rows are buttons with selected state; a tap picks', async () => {
    const { onPick, utils } = renderPicker({ selectedId: 'p7' });
    const screen = await utils;
    const row = screen.getByTestId('pp-p7');
    expect(row.props.accessibilityRole).toBe('button');
    expect(row.props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId('pp-p0').props.accessibilityState).toMatchObject({ selected: false });
    await fireEvent.press(screen.getByTestId('pp-p0'));
    expect(onPick).toHaveBeenCalledWith(byLabel('art'));
  });

  it('the clear row sits at the top, marked when nothing is picked, and picks null', async () => {
    const { onPick, utils } = renderPicker();
    const screen = await utils;
    expect(screen.getByTestId('pp-none')).toHaveTextContent('no major');
    expect(screen.getByTestId('pp-none').props.accessibilityState).toMatchObject({ selected: true });
    await fireEvent.press(screen.getByTestId('pp-none'));
    expect(onPick).toHaveBeenCalledWith(null);
  });

  it('offers no clear row when none is given', async () => {
    const { utils } = renderPicker({ clearLabel: undefined });
    expect((await utils).queryByTestId('pp-none')).toBeNull();
  });

  it('search filters across all 50 (aliases included) and counts the results politely', async () => {
    const { onPick, utils } = renderPicker();
    const screen = await utils;
    await fireEvent.changeText(screen.getByTestId('pp-search'), 'program 49');
    expect(screen.getByTestId('pp-p48')).toHaveTextContent('program 49');
    expect(screen.queryByTestId('pp-p0')).toBeNull();
    expect(screen.queryByTestId('pp-none')).toBeNull();
    expect(screen.getByTestId('pp-count')).toHaveTextContent('1 result');
    expect(screen.getByTestId('pp-count').props.accessibilityLiveRegion).toBe('polite');

    await fireEvent.changeText(screen.getByTestId('pp-search'), 'Computer');
    expect(screen.getByTestId('pp-p4')).toHaveTextContent('cs');
    await fireEvent.press(screen.getByTestId('pp-p4'));
    expect(onPick).toHaveBeenCalledWith(byLabel('cs'));

    await fireEvent.press(screen.getByTestId('pp-search-clear'));
    expect(screen.getByTestId('pp-p0')).toBeTruthy();
  });

  it('the minor picker shows the major disabled with a quiet note, and offers no minor', async () => {
    const { onPick, utils } = renderPicker({ kind: 'minor', majorId: 'p7', clearLabel: 'no minor' });
    const screen = await utils;
    expect(screen.getByText('your minor')).toBeTruthy();
    expect(screen.getByTestId('pp-search').props.accessibilityLabel).toBe('search minors');
    const major = screen.getByTestId('pp-p7');
    expect(major.props.accessibilityState).toMatchObject({ disabled: true });
    expect(major.props.accessibilityLabel).toBe('nursing, your major');
    expect(screen.getByTestId('pp-p7-note')).toHaveTextContent('your major');
    await fireEvent.press(major);
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByTestId('pp-none')).toHaveTextContent('no minor');
    expect(screen.getByTestId('pp-suggest')).toHaveTextContent('suggest a minor');
  });

  it('an empty search says so and offers to suggest it, prefilled', async () => {
    const { utils } = renderPicker();
    const screen = await utils;
    await fireEvent.changeText(screen.getByTestId('pp-search'), ' marine science ');
    expect(screen.getByTestId('pp-empty')).toHaveTextContent(/^nothing called "marine science"/);
    expect(screen.getByTestId('pp-count')).toHaveTextContent('no results');
    // the suggest link stays at the bottom too
    expect(screen.getByTestId('pp-suggest')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('pp-empty-suggest'));
    expect(screen.getByText('suggest a major')).toBeTruthy();
    expect(screen.getByTestId('pp-suggest-label-input').props.value).toBe('marine science');
  });

  it('close and the backdrop dismiss', async () => {
    const { onDismiss, utils } = renderPicker();
    const screen = await utils;
    await fireEvent.press(screen.getByTestId('pp-close'));
    await fireEvent.press(screen.getByTestId('pp-backdrop'));
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });
});

describe('suggest a major', () => {
  async function openForm(props: Partial<ProgramPickerSheetProps> = {}) {
    const rendered = renderPicker(props);
    const screen = await rendered.utils;
    await fireEvent.press(screen.getByTestId('pp-suggest'));
    return { ...rendered, screen };
  }

  it('a 60-character field with a counter; says it does not change the profile', async () => {
    const { screen } = await openForm();
    const input = screen.getByTestId('pp-suggest-label-input');
    expect(input.props.maxLength).toBe(60);
    expect(input.props.value).toBe('');
    expect(screen.getByText('0 of 60')).toBeTruthy();
    expect(screen.getByText(/won't change your profile/)).toBeTruthy();
    expect(screen.getByTestId('pp-suggest-send').props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.changeText(input, 'marine biology');
    expect(screen.getByText('14 of 60')).toBeTruthy();
  });

  it('sends label and kind, then returns to the list with a neutral thanks', async () => {
    (suggestProgram as jest.Mock).mockResolvedValue(undefined);
    const { screen, onPick } = await openForm({ kind: 'minor', majorId: 'p7', clearLabel: 'no minor' });
    await fireEvent.changeText(screen.getByTestId('pp-suggest-label-input'), 'spanish');
    await fireEvent.press(screen.getByTestId('pp-suggest-send'));
    expect(suggestProgram).toHaveBeenCalledWith('spanish', 'minor');
    expect(screen.getByTestId('pp-sent')).toHaveTextContent(/thanks\. we'll take a look\./);
    expect(screen.getByTestId('pp-sent')).toHaveTextContent(/pick the closest one for now\./);
    expect(screen.getByTestId('pp-list')).toBeTruthy();
    expect(screen.queryByTestId('pp-suggest-label-input')).toBeNull();
    // nothing was picked
    expect(onPick).not.toHaveBeenCalled();
  });

  it.each([
    ['filtered', "that text can't be used."],
    ['waiting', 'you have a few suggestions waiting already.'],
    ['length', 'keep it between 1 and 60 characters.'],
  ] as const)('a %s refusal shows inline with the text kept', async (reason, copy) => {
    (suggestProgram as jest.Mock).mockRejectedValue(new ProgramSuggestionError(reason));
    const { screen } = await openForm();
    await fireEvent.changeText(screen.getByTestId('pp-suggest-label-input'), 'some text');
    await fireEvent.press(screen.getByTestId('pp-suggest-send'));
    expect(screen.getByText(copy)).toBeTruthy();
    expect(screen.getByTestId('pp-suggest-label-input').props.value).toBe('some text');
    expect(screen.queryByTestId('pp-sent')).toBeNull();
    // editing clears the error
    await fireEvent.changeText(screen.getByTestId('pp-suggest-label-input'), 'some text 2');
    expect(screen.queryByText(copy)).toBeNull();
  });

  it('already on the list (server): shows the line, text kept', async () => {
    (suggestProgram as jest.Mock).mockRejectedValue(new ProgramSuggestionError('listed'));
    const { screen } = await openForm();
    await fireEvent.changeText(screen.getByTestId('pp-suggest-label-input'), 'ocean studies');
    await fireEvent.press(screen.getByTestId('pp-suggest-send'));
    expect(screen.getByText('that one is already on the list.')).toBeTruthy();
    expect(screen.getByTestId('pp-suggest-label-input').props.value).toBe('ocean studies');
  });

  it('already on the list (found here): not sent, and offers to jump to it', async () => {
    const { screen } = await openForm();
    await fireEvent.changeText(screen.getByTestId('pp-suggest-label-input'), 'Program 49');
    await fireEvent.press(screen.getByTestId('pp-suggest-send'));
    expect(suggestProgram).not.toHaveBeenCalled();
    expect(screen.getByText('that one is already on the list.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('pp-suggest-show'));
    expect(screen.getByTestId('pp-search').props.value).toBe('program 49');
    expect(screen.getByTestId('pp-p48')).toBeTruthy();
  });

  it('anything else (not signed in, the function not there yet) is the generic line, never server text', async () => {
    (suggestProgram as jest.Mock).mockRejectedValue(new UnknownError({ message: 'Could not find the function' }));
    const { screen } = await openForm();
    await fireEvent.changeText(screen.getByTestId('pp-suggest-label-input'), 'marine biology');
    await fireEvent.press(screen.getByTestId('pp-suggest-send'));
    expect(screen.getByText("that didn't work.")).toBeTruthy();
    expect(screen.queryByText(/could not find/i)).toBeNull();
  });

  it('back to the list; the back button steps out of the form, then closes the sheet', async () => {
    const { screen, onDismiss } = await openForm();
    await fireEvent.press(screen.getByTestId('pp-suggest-back'));
    expect(screen.getByTestId('pp-list')).toBeTruthy();

    const spy = jest.spyOn(BackHandler, 'addEventListener');
    await fireEvent.press(screen.getByTestId('pp-suggest'));
    const latest = () => spy.mock.calls.at(-1)![1] as () => boolean;
    let handled = false;
    await act(async () => {
      handled = latest()();
    });
    expect(handled).toBe(true);
    expect(screen.getByTestId('pp-list')).toBeTruthy();
    expect(onDismiss).not.toHaveBeenCalled();
    await act(async () => {
      latest()();
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe('one picker everywhere a program is chosen', () => {
  const SRC = path.join(__dirname, '..');
  it.each(['app/profile-editor/school-and-work.tsx', 'app/(onboarding)/tags.tsx'])('%s uses the shared picker', (rel) => {
    const source = fs.readFileSync(path.join(SRC, rel), 'utf8');
    expect(source).toMatch(/import \{ ProgramPickerSheet \} from '\.\.\/\.\.\/me\/editor\/ProgramPickerSheet'/);
    expect(source).toMatch(/<ProgramPickerSheet\b/);
  });

  it('nothing else lists programs for picking', () => {
    const users: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__') walk(full);
        } else if (/\.tsx$/.test(entry.name) && /\blistPrograms\b/.test(fs.readFileSync(full, 'utf8'))) {
          users.push(path.relative(SRC, full).split(path.sep).join('/'));
        }
      }
    };
    walk(SRC);
    expect(users.sort()).toEqual(['app/(onboarding)/tags.tsx', 'app/profile-editor/school-and-work.tsx']);
  });
});
