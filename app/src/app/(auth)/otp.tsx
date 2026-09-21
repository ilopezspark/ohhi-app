import { useEffect, useRef, useState } from 'react';
import { StyleSheet, TextInput, View, type NativeSyntheticEvent, type TextInputKeyPressEventData } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase } from '../../api/client';
import { resolveEntryHref } from '../../routing/bootstrap';
import { Button, Text } from '../../ui';
import { colors, fontFamilies, radii, shadows, spacing } from '../../theme/tokens';
import { OnboardingScreen } from '../../onboarding/components/OnboardingScreen';

const CODE_LENGTH = 6;
const RESEND_SECONDS = 60;

/**
 * `Onb-Code.html`. Verify code, architecture plan §4 step 2. Design step 1
 * of 8, matching `Onb-Email.html`'s own bar (see `OnboardingHeader`'s doc
 * comment — the mock doesn't advance the bar between email and code entry).
 *
 * **Deviation from existing behaviour, flagged in the report**: the previous
 * screen accepted a free-form 6-10 digit code (`/^\d{6,10}$/`, since
 * Supabase's OTP length is a per-project setting that can be 6-10 digits).
 * The design's own input is a fixed 6-box grid with no affordance for a
 * longer code. This screen narrows to exactly 6 digits to match the design
 * — Supabase's default (and this project's apparent configuration, per the
 * mock) is 6 — rather than inventing a >6-digit UI the design doesn't show.
 * `verifyOtp` itself is untouched; only the client-side length gate moved
 * from a range to a fixed 6.
 *
 * Adds a resend affordance the previous screen didn't have (the design
 * shows one) — same `signInWithOtp` call `(auth)/email.tsx` already uses,
 * gated by a plain local countdown (no server-provided expiry exists to
 * read).
 */
export default function OtpScreen() {
  const { email } = useLocalSearchParams<{ email?: string }>();
  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(''));
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resendSeconds, setResendSeconds] = useState(RESEND_SECONDS);
  const [resending, setResending] = useState(false);
  const inputRefs = useRef<Array<TextInput | null>>([]);

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = setInterval(() => setResendSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [resendSeconds]);

  const code = digits.join('');
  const isValid = new RegExp(`^\\d{${CODE_LENGTH}}$`).test(code) && !!email;
  const submitDisabled = !isValid || submitting;

  function setDigitAt(index: number, value: string) {
    setDigits((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  function handleChangeDigit(index: number, raw: string) {
    const clean = raw.replace(/\D/g, '');
    if (clean.length <= 1) {
      setDigitAt(index, clean);
      if (clean && index < CODE_LENGTH - 1) inputRefs.current[index + 1]?.focus();
      return;
    }
    // Pasted/autofilled multiple digits at once — distribute from this box on.
    const chars = clean.slice(0, CODE_LENGTH - index).split('');
    setDigits((prev) => {
      const next = [...prev];
      chars.forEach((char, offset) => {
        next[index + offset] = char;
      });
      return next;
    });
    const lastFilled = Math.min(index + chars.length, CODE_LENGTH - 1);
    inputRefs.current[lastFilled]?.focus();
  }

  function handleKeyPress(index: number, event: NativeSyntheticEvent<TextInputKeyPressEventData>) {
    if (event.nativeEvent.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }

  function goBack() {
    router.replace({ pathname: '/(auth)/email' } as never);
  }

  async function handleSubmit() {
    if (submitDisabled || !email) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email,
        token: code,
        type: 'email',
      });
      if (error) throw error;
      // On success there is a session; run begin_signup() -> me() -> route,
      // the same sequence the root layout runs on cold start.
      const href = await resolveEntryHref(data.session);
      router.replace(href as never);
    } catch {
      setErrorMessage("That code didn't work. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    if (resending || resendSeconds > 0 || !email) return;
    setResending(true);
    setErrorMessage(null);
    try {
      const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
      if (error) throw error;
      setResendSeconds(RESEND_SECONDS);
    } catch {
      setErrorMessage('Something went wrong. Please try again.');
    } finally {
      setResending(false);
    }
  }

  const minutes = Math.floor(resendSeconds / 60);
  const seconds = resendSeconds % 60;
  const countdown = `${minutes}:${String(seconds).padStart(2, '0')}`;

  return (
    <OnboardingScreen
      step={1}
      onBack={goBack}
      backTestID="otp-back"
      testID="otp-screen"
      footer={
        <Button
          label="verify"
          onPress={handleSubmit}
          loading={submitting}
          disabled={submitDisabled}
          testID="otp-submit"
        />
      }
    >
      <Text variant="headline" style={styles.title}>
        check your email
      </Text>
      <Text variant="helper">
        we sent a 6-digit code to <Text variant="helper" color={colors.ink} style={styles.bold}>{email ?? 'your email'}</Text>
      </Text>
      <View style={styles.digitRow}>
        {digits.map((digit, index) => (
          <TextInput
            key={index}
            ref={(ref) => {
              inputRefs.current[index] = ref;
            }}
            testID={`otp-input-${index}`}
            accessibilityLabel="digit"
            style={[styles.digitInput, digit ? null : styles.digitInputEmpty]}
            keyboardType="number-pad"
            maxLength={CODE_LENGTH}
            value={digit}
            onChangeText={(value) => handleChangeDigit(index, value)}
            onKeyPress={(event) => handleKeyPress(index, event)}
          />
        ))}
      </View>
      {errorMessage ? (
        <Text testID="otp-error" variant="helper" color={colors.danger}>
          {errorMessage}
        </Text>
      ) : (
        <Text variant="helper">
          didn&apos;t get it?{' '}
          <Text
            variant="helper"
            color={resendSeconds > 0 ? colors.subtle : colors.signalPressed}
            style={styles.bold}
            onPress={handleResend}
            testID="otp-resend"
          >
            resend
          </Text>{' '}
          {resendSeconds > 0 ? `in ${countdown}` : ''}
        </Text>
      )}
    </OnboardingScreen>
  );
}

const styles = StyleSheet.create({
  title: { marginTop: spacing.md },
  bold: { fontFamily: fontFamilies.outfitSemiBold },
  digitRow: { flexDirection: 'row', gap: spacing.smMd },
  digitInput: {
    flex: 1,
    height: 60,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    color: colors.ink,
    fontSize: 26,
    fontWeight: '700',
    textAlign: 'center',
    ...shadows.sm,
  },
  digitInputEmpty: { borderWidth: 0 },
});
