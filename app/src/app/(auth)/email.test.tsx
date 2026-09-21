import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
}));

jest.mock('../../api/client', () => ({
  supabase: {
    auth: {
      signInWithOtp: jest.fn().mockResolvedValue({ error: null }),
    },
  },
}));

jest.mock('../../api/campuses', () => {
  const actual = jest.requireActual('../../api/campuses');
  return {
    ...actual,
    listCampuses: jest.fn().mockResolvedValue([
      {
        id: 'campus-1',
        slug: 'clc',
        name: 'City Life College',
        email_domains: ['clc.edu'],
        status: 'live',
      },
    ]),
  };
});

import { router } from 'expo-router';
import { supabase } from '../../api/client';
import EmailScreen from './email';

describe('EmailScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps submit disabled until a matching campus email is entered', async () => {
    const { getByTestId } = await render(<EmailScreen />);

    expect(getByTestId('email-submit').props.accessibilityState?.disabled).toBe(true);

    await fireEvent.changeText(getByTestId('email-input'), 'not-an-email');
    expect(getByTestId('email-submit').props.accessibilityState?.disabled).toBe(true);

    await fireEvent.changeText(getByTestId('email-input'), 'student@unknown-school.edu');
    await waitFor(() => expect(getByTestId('email-hint')).toBeTruthy());
    expect(getByTestId('email-submit').props.accessibilityState?.disabled).toBe(true);

    await fireEvent.changeText(getByTestId('email-input'), 'student@clc.edu');
    await waitFor(() => expect(getByTestId('email-submit').props.accessibilityState?.disabled).toBe(false));
  });

  it('shows a campus-domain hint once a matching school email is entered', async () => {
    const { getByTestId } = await render(<EmailScreen />);
    await fireEvent.changeText(getByTestId('email-input'), 'student@clc.edu');
    await waitFor(() => expect(getByTestId('email-hint').props.children).toContain('City Life College'));
  });

  it('shows a "not live yet" hint for a non-matching domain without disabling silently', async () => {
    const { getByTestId } = await render(<EmailScreen />);
    await fireEvent.changeText(getByTestId('email-input'), 'student@somewhere-else.edu');
    await waitFor(() =>
      expect(getByTestId('email-hint').props.children).toContain("isn't on OhHi yet")
    );
  });

  it('sends the OTP and navigates to the otp screen on submit', async () => {
    const { getByTestId } = await render(<EmailScreen />);
    await fireEvent.changeText(getByTestId('email-input'), 'student@clc.edu');
    await waitFor(() => expect(getByTestId('email-submit').props.accessibilityState?.disabled).toBe(false));

    await fireEvent.press(getByTestId('email-submit'));

    await waitFor(() =>
      expect(supabase.auth.signInWithOtp).toHaveBeenCalledWith({
        email: 'student@clc.edu',
        options: { shouldCreateUser: true },
      })
    );
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/(auth)/otp',
      params: { email: 'student@clc.edu' },
    });
  });
});
