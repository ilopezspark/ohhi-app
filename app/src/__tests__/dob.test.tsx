import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { TextInput } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
}));

jest.mock('../api/onboarding', () => ({
  setDateOfBirth: jest.fn().mockResolvedValue(undefined),
}));

import { router } from 'expo-router';
import { setDateOfBirth } from '../api/onboarding';
import DobScreen from '../app/(onboarding)/dob';
import { birthdayToDob } from '../onboarding/birthday';

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DobScreen />
    </QueryClientProvider>
  );
}

type Screen = Awaited<ReturnType<typeof renderScreen>>;

async function type(screen: Screen, month: string, day: string, year: string) {
  await fireEvent.changeText(screen.getByTestId('dob-month'), month);
  await fireEvent.changeText(screen.getByTestId('dob-day'), day);
  await fireEvent.changeText(screen.getByTestId('dob-year'), year);
}

const submitDisabled = (screen: Screen) => screen.getByTestId('dob-submit').props.accessibilityState?.disabled;

/** The testIDs of the boxes `focus()` was called on, in call order (the jest TextInput mock shares one `focus` mock across instances). */
function focusedTestIDs(): string[] {
  const focus = TextInput.prototype.focus as unknown as jest.Mock;
  return focus.mock.contexts.map((ctx: { props?: { testID?: string } }) => ctx?.props?.testID ?? '');
}

describe('DobScreen (three boxes, no native picker)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (TextInput.prototype.focus as unknown as jest.Mock).mockClear();
  });

  it('shows month, day and year boxes with lowercase captions', async () => {
    const screen = await renderScreen();
    expect(screen.getByTestId('dob-month').props.maxLength).toBe(2);
    expect(screen.getByTestId('dob-day').props.maxLength).toBe(2);
    expect(screen.getByTestId('dob-year').props.maxLength).toBe(4);
    expect(screen.getByTestId('dob-month').props.keyboardType).toBe('number-pad');
    expect(screen.getByText('month')).toBeTruthy();
    expect(screen.getByText('day')).toBeTruthy();
    expect(screen.getByText('year')).toBeTruthy();
  });

  it('keeps submit disabled until all three boxes hold a valid birthday', async () => {
    const screen = await renderScreen();
    expect(submitDisabled(screen)).toBe(true);

    await fireEvent.changeText(screen.getByTestId('dob-month'), '01');
    await fireEvent.changeText(screen.getByTestId('dob-day'), '15');
    expect(submitDisabled(screen)).toBe(true);

    await fireEvent.changeText(screen.getByTestId('dob-year'), '200');
    expect(submitDisabled(screen)).toBe(true);

    await fireEvent.changeText(screen.getByTestId('dob-year'), '2000');
    await waitFor(() => expect(submitDisabled(screen)).toBe(false));
  });

  it('keeps submit disabled for an impossible day (02/30/2004) and for month 13', async () => {
    const screen = await renderScreen();
    await type(screen, '02', '30', '2004');
    expect(submitDisabled(screen)).toBe(true);

    await type(screen, '13', '01', '2004');
    expect(submitDisabled(screen)).toBe(true);

    await type(screen, '02', '29', '2004'); // a leap year
    await waitFor(() => expect(submitDisabled(screen)).toBe(false));
  });

  it('keeps submit disabled for a birthday in the future', async () => {
    const nextYear = String(new Date().getFullYear() + 1);
    const screen = await renderScreen();
    await type(screen, '01', '01', nextYear);
    expect(submitDisabled(screen)).toBe(true);
  });

  it('drops anything that is not a digit', async () => {
    const screen = await renderScreen();
    await fireEvent.changeText(screen.getByTestId('dob-month'), 'a1');
    expect(screen.getByTestId('dob-month').props.value).toBe('1');
  });

  it('moves focus to the next box when one fills, but not before', async () => {
    const screen = await renderScreen();
    await fireEvent.changeText(screen.getByTestId('dob-month'), '1');
    expect(focusedTestIDs()).toEqual([]);

    await fireEvent.changeText(screen.getByTestId('dob-month'), '12');
    expect(focusedTestIDs()).toEqual(['dob-day']);

    await fireEvent.changeText(screen.getByTestId('dob-day'), '31');
    expect(focusedTestIDs()).toEqual(['dob-day', 'dob-year']);

    // The last box has nowhere further to go.
    await fireEvent.changeText(screen.getByTestId('dob-year'), '1999');
    expect(focusedTestIDs()).toEqual(['dob-day', 'dob-year']);
  });

  it('moves back on backspace in an empty box, and only there', async () => {
    const screen = await renderScreen();
    await fireEvent.changeText(screen.getByTestId('dob-month'), '1');
    await fireEvent.changeText(screen.getByTestId('dob-day'), '5');

    // A filled box deletes its own character; focus stays.
    await fireEvent(screen.getByTestId('dob-day'), 'keyPress', { nativeEvent: { key: 'Backspace' } });
    expect(focusedTestIDs()).toEqual([]);

    // An empty year box hands focus back to the day box, the empty day to the month.
    await fireEvent(screen.getByTestId('dob-year'), 'keyPress', { nativeEvent: { key: 'Backspace' } });
    expect(focusedTestIDs()).toEqual(['dob-day']);
    await fireEvent.changeText(screen.getByTestId('dob-day'), '');
    await fireEvent(screen.getByTestId('dob-day'), 'keyPress', { nativeEvent: { key: 'Backspace' } });
    expect(focusedTestIDs()).toEqual(['dob-day', 'dob-month']);

    // The first box has nothing before it.
    await fireEvent.changeText(screen.getByTestId('dob-month'), '');
    await fireEvent(screen.getByTestId('dob-month'), 'keyPress', { nativeEvent: { key: 'Backspace' } });
    expect(focusedTestIDs()).toEqual(['dob-day', 'dob-month']);
  });

  it('shows a non-blocking under-18 hint for a 16-year-old', async () => {
    const sixteen = String(new Date().getFullYear() - 16);
    const screen = await renderScreen();
    expect(screen.queryByTestId('dob-under-eighteen-hint')).toBeNull();

    await type(screen, '01', '01', sixteen);
    await waitFor(() => expect(screen.getByTestId('dob-under-eighteen-hint')).toBeTruthy());
    expect(screen.getByText('ohhi is for people 18 and over.')).toBeTruthy();
    // Still submittable: the server is the authority (onboarding-grid plan §1.4).
    expect(submitDisabled(screen)).toBe(false);
  });

  it('shows no hint for an adult', async () => {
    const screen = await renderScreen();
    await type(screen, '01', '01', '2000');
    await waitFor(() => expect(submitDisabled(screen)).toBe(false));
    expect(screen.queryByTestId('dob-under-eighteen-hint')).toBeNull();
  });

  it('writes the birthday as YYYY-MM-DD and goes to the name step on submit', async () => {
    const screen = await renderScreen();
    await type(screen, '4', '7', '2000'); // one-digit month and day are padded
    await waitFor(() => expect(submitDisabled(screen)).toBe(false));

    await fireEvent.press(screen.getByTestId('dob-submit'));

    await waitFor(() => expect(setDateOfBirth).toHaveBeenCalledWith('2000-04-07'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/(onboarding)/name'));
  });

  it('shows the server error and stays put when the write fails', async () => {
    (setDateOfBirth as jest.Mock).mockRejectedValueOnce(new Error('boom'));
    const screen = await renderScreen();
    await type(screen, '01', '01', '2000');
    await waitFor(() => expect(submitDisabled(screen)).toBe(false));

    await fireEvent.press(screen.getByTestId('dob-submit'));

    await waitFor(() => expect(screen.getByTestId('dob-error')).toBeTruthy());
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe('birthdayToDob', () => {
  const now = new Date(2026, 8, 30); // 30 September 2026

  it('returns YYYY-MM-DD for a real birthday', () => {
    expect(birthdayToDob('09', '30', '2000', now)).toBe('2000-09-30');
    expect(birthdayToDob('9', '3', '2000', now)).toBe('2000-09-03');
  });

  it('accepts today and rejects tomorrow', () => {
    expect(birthdayToDob('09', '30', '2026', now)).toBe('2026-09-30');
    expect(birthdayToDob('10', '01', '2026', now)).toBeNull();
  });

  it('rejects days that do not exist', () => {
    expect(birthdayToDob('02', '30', '2004', now)).toBeNull();
    expect(birthdayToDob('02', '29', '2003', now)).toBeNull();
    expect(birthdayToDob('02', '29', '2004', now)).toBe('2004-02-29');
    expect(birthdayToDob('04', '31', '2000', now)).toBeNull();
    expect(birthdayToDob('01', '00', '2000', now)).toBeNull();
  });

  it('rejects a bad month', () => {
    expect(birthdayToDob('13', '01', '2000', now)).toBeNull();
    expect(birthdayToDob('00', '01', '2000', now)).toBeNull();
  });

  it('needs a four-digit year and nothing else in the boxes', () => {
    expect(birthdayToDob('01', '01', '200', now)).toBeNull();
    expect(birthdayToDob('01', '01', '0099', now)).toBeNull();
    expect(birthdayToDob('', '01', '2000', now)).toBeNull();
    expect(birthdayToDob('01', '', '2000', now)).toBeNull();
    expect(birthdayToDob('01', '01', '', now)).toBeNull();
    expect(birthdayToDob('0a', '01', '2000', now)).toBeNull();
  });
});
