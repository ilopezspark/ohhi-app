import { fireEvent, render } from '@testing-library/react-native';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: jest.fn(),
}));

jest.mock('../api/client', () => ({
  supabase: {
    auth: {
      verifyOtp: jest.fn(),
      signInWithOtp: jest.fn(),
    },
  },
}));

jest.mock('../routing/bootstrap', () => ({
  resolveEntryHref: jest.fn().mockResolvedValue('/(tabs)/grid'),
}));

import { useLocalSearchParams } from 'expo-router';
import OtpScreen from '../app/(auth)/otp';

/**
 * `otp.tsx` reads `EXPO_PUBLIC_OTP_LENGTH` fresh on mount (via
 * `useState(() => otpLength())`), so setting the env var before `render()`
 * is enough — no module-reset/require gymnastics needed.
 */
const ORIGINAL_ENV = process.env.EXPO_PUBLIC_OTP_LENGTH;

describe('OtpScreen with EXPO_PUBLIC_OTP_LENGTH=8 (this project issues 8-digit codes)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.EXPO_PUBLIC_OTP_LENGTH = '8';
    (useLocalSearchParams as jest.Mock).mockReturnValue({ email: 'ada@clc.edu' });
  });

  afterEach(() => {
    process.env.EXPO_PUBLIC_OTP_LENGTH = ORIGINAL_ENV;
  });

  it('renders exactly 8 digit boxes and says "we sent a 8-digit code"', async () => {
    const { getByTestId, queryByTestId, getByText } = await render(<OtpScreen />);

    for (let i = 0; i < 8; i += 1) {
      expect(getByTestId(`otp-input-${i}`)).toBeTruthy();
    }
    expect(queryByTestId('otp-input-8')).toBeNull();
    expect(getByText(/we sent a 8-digit code to/)).toBeTruthy();
  });

  it('accepts an 8-digit paste into the first box and enables verify', async () => {
    const { getByTestId } = await render(<OtpScreen />);

    expect(getByTestId('otp-submit').props.accessibilityState?.disabled).toBe(true);
    await fireEvent.changeText(getByTestId('otp-input-0'), '12345678');

    for (let i = 0; i < 8; i += 1) {
      expect(getByTestId(`otp-input-${i}`).props.value).toBe(String(i + 1));
    }
    expect(getByTestId('otp-submit').props.accessibilityState?.disabled).toBe(false);
  });

  it('rejects a 7-digit code (verify stays disabled)', async () => {
    const { getByTestId } = await render(<OtpScreen />);

    await fireEvent.changeText(getByTestId('otp-input-0'), '1234567');

    expect(getByTestId('otp-submit').props.accessibilityState?.disabled).toBe(true);
  });
});

describe('OtpScreen with the default 6-digit length (no EXPO_PUBLIC_OTP_LENGTH set)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.EXPO_PUBLIC_OTP_LENGTH;
    (useLocalSearchParams as jest.Mock).mockReturnValue({ email: 'ada@clc.edu' });
  });

  afterEach(() => {
    process.env.EXPO_PUBLIC_OTP_LENGTH = ORIGINAL_ENV;
  });

  it('renders exactly 6 digit boxes', async () => {
    const { getByTestId, queryByTestId } = await render(<OtpScreen />);

    for (let i = 0; i < 6; i += 1) {
      expect(getByTestId(`otp-input-${i}`)).toBeTruthy();
    }
    expect(queryByTestId('otp-input-6')).toBeNull();
  });
});
